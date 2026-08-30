/**
 * MarketingCopilot — the marketing agent, as a conversation.
 *
 * Everything the Marketing Agent page can do is reachable here by asking for it:
 * generate an image, write and publish a post, build a full multi-post campaign
 * plan with media, and reason about which channels are actually producing
 * revenue. The difference from the page is that it starts from *your* data —
 * the leads table — so its advice is grounded in which sources convert rather
 * than in generic best practice.
 *
 * Design choices worth knowing:
 *  • Channel performance is computed here, deterministically, from the leads
 *    (conversion %, revenue, avg deal, staleness). The model receives those
 *    numbers; it never adds up money itself, because LLMs are bad at that and a
 *    wrong revenue figure would be worse than no figure.
 *  • Answers can carry typed visual blocks (see ChatBlocks.tsx) so the agent
 *    replies with a chart or a post preview instead of a paragraph about one.
 *  • Anything that leaves the system — publishing to a live page — is behind an
 *    explicit click *and* a confirm dialog. Nothing auto-publishes from chat.
 */

import { useState, useRef, useEffect } from 'react';
import {
  X, Send, Loader2, Megaphone, Image as ImageIcon, Rocket, Users,
  TrendingUp, ArrowLeft, Calendar, Upload, Share2, Camera, Wand2, RotateCcw,
} from 'lucide-react';
import type { Lead, WorkspaceProfile } from '../types';
import ChatBlockView, { sanitiseBlocks } from './ChatBlocks';
import type { ChatBlock } from './ChatBlocks';
import {
  useChatSession, setMessages, appendMessage, updateSession, setOpen, clearSession,
} from '../lib/chatSessionStore';

const ACCENT = '#c026d3';       // fuchsia — distinct from the sales copilot's teal
const WON_STATUSES = ['לקוח פעיל', 'נסגר', 'עסקה נסגרה'];
const DEAD_STATUSES = ['לא רלוונטי', 'אבוד', 'לא מעוניין'];

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

/* ── What the agent is allowed to propose ─────────────────────────────────── */
interface MktAction {
  type:
    | 'generate_image'    // create a visual right here in the chat
    | 'publish_post'      // push a post to a live FB/IG page (confirmed)
    | 'schedule_post'     // queue a post for the server scheduler to publish
    | 'create_plan'       // full autopilot campaign plan + media + approval
    | 'save_profile'      // teach the agent about the business, persistently
    | 'open_marketing';   // hand off to the full Marketing Agent page
  label?: string;
  prompt?: string;        // generate_image
  platform?: 'facebook' | 'instagram';
  caption?: string;
  hashtags?: string[];
  cta?: string;
  imageUrl?: string;
  imagePrompt?: string;
  hoursFromNow?: number;  // schedule_post
  postsCount?: number;    // create_plan
  cadence?: 'daily' | '3x-week' | 'weekly';
  platforms?: Array<'facebook' | 'instagram'>;
  profile?: {
    productName?: string; productDescription?: string; targetAudience?: string;
    styleKeywords?: string[]; brandColors?: string[]; avoidKeywords?: string[];
  };
  tab?: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  blocks?: ChatBlock[];
  actions?: MktAction[];
  doneIds?: string[];
}

interface Props {
  leads: Lead[];
  workspace?: WorkspaceProfile;
  workspaceId?: string;
  currentUser?: string;
  onToast?: ToastFn;
  onNavigate?: (page: string) => void;
  onClose: () => void;
}

/* ── Channel analytics — computed, never guessed ──────────────────────────── */
function parseLoose(s?: string): number {
  if (!s) return 0;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) { const t = Date.parse(str.slice(0, 10) + 'T00:00:00'); return isNaN(t) ? 0 : t; }
  if (/^\d{10,}$/.test(str)) return Number(str);
  const sep = str.includes('/') ? '/' : '.';
  const p = str.split(sep);
  if (p.length !== 3) { const t = Date.parse(str); return isNaN(t) ? 0 : t; }
  const [d, m, yR] = p.map(Number);
  if (!d || !m || !yR) return 0;
  const t = new Date(yR < 100 ? 2000 + yR : yR, m - 1, d).getTime();
  return isNaN(t) ? 0 : t;
}

interface ChannelRow {
  source: string; leads: number; won: number; lost: number; open: number;
  conversion: number; revenue: number; avgDeal: number; avgScore: number;
  last30: number; daysSinceLastLead: number;
}

function analyseChannels(leads: Lead[]): ChannelRow[] {
  const now = Date.now();
  const by = new Map<string, Lead[]>();
  for (const l of leads) {
    const s = (l.source || 'לא ידוע').trim() || 'לא ידוע';
    if (!by.has(s)) by.set(s, []);
    by.get(s)!.push(l);
  }
  const rows: ChannelRow[] = [];
  for (const [source, group] of by) {
    const won  = group.filter(l => WON_STATUSES.includes(l.status));
    const lost = group.filter(l => DEAD_STATUSES.includes(l.status));
    const revenue = won.reduce((s, l) => s + (Number(l.budget) || 0), 0);
    const newest = Math.max(0, ...group.map(l => parseLoose(l.createdAt ? String(l.createdAt) : l.lastUpdate)));
    rows.push({
      source,
      leads: group.length,
      won: won.length,
      lost: lost.length,
      open: group.length - won.length - lost.length,
      conversion: group.length ? Math.round((won.length / group.length) * 100) : 0,
      revenue,
      avgDeal: won.length ? Math.round(revenue / won.length) : 0,
      avgScore: Math.round(group.reduce((s, l) => s + (Number(l.aiScore) || 0), 0) / Math.max(group.length, 1)),
      last30: group.filter(l => {
        const t = parseLoose(l.createdAt ? String(l.createdAt) : l.lastUpdate);
        return t && now - t < 30 * 86400000;
      }).length,
      daysSinceLastLead: newest ? Math.floor((now - newest) / 86400000) : -1,
    });
  }
  return rows.sort((a, b) => b.leads - a.leads);
}

export default function MarketingCopilot({
  leads, workspace, workspaceId, currentUser, onToast, onNavigate, onClose,
}: Props) {
  /* Session lives in the shared store: closing the window keeps the history and
     lets a running plan/image generation finish in the background. */
  const session = useChatSession<ChatMsg>('marketing');
  const msgs    = session.msgs;
  const busy    = session.busy;
  const working = session.working;
  const setMsgs   = (u: ChatMsg[] | ((p: ChatMsg[]) => ChatMsg[])) => setMessages<ChatMsg>('marketing', u);
  const setBusy   = (v: boolean) => updateSession('marketing', { busy: v });
  const setWorking = (v: string | null) => updateSession('marketing', { working: v });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen('marketing', true); return () => setOpen('marketing', false); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, working]);

  const channels = analyseChannels(leads);
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  const totalWon = channels.reduce((s, c) => s + c.won, 0);
  const pages = workspace?.metaIntegration?.pages ?? [];
  const connectedPage = pages.find(p => p.subscribed) ?? pages[0];
  const igId = connectedPage?.instagramBusinessAccountId;
  const social = { fb: Boolean(connectedPage), ig: Boolean(igId) };

  const say = (text: string, blocks?: ChatBlock[]) =>
    appendMessage<ChatMsg>('marketing', { role: 'assistant', text, blocks });

  /* ── The conversation ───────────────────────────────────────────────────── */
  const ask = async (userText: string | null) => {
    if (busy) return;
    setBusy(true);
    const history = userText ? [...msgs, { role: 'user' as const, text: userText }] : msgs;
    if (userText) setMsgs(history);

    try {
      const [{ getAnthropicProxy }, { gatherBusinessContext }] = await Promise.all([
        import('../lib/anthropicClient'),
        import('../lib/marketingAutopilot'),
      ]);
      const client = getAnthropicProxy();

      let bizCtx = '';
      if (workspaceId) {
        try { bizCtx = (await gatherBusinessContext(workspaceId, workspace)).text; } catch { /* optional */ }
      }

      const socialLine = social.fb || social.ig
        ? `מחובר: ${[social.fb && `פייסבוק (${connectedPage?.name ?? connectedPage?.id})`, social.ig && 'אינסטגרם'].filter(Boolean).join(' + ')}. אתה יכול לפרסם ולתזמן בפועל.`
        : 'לא מחובר עמוד פייסבוק/אינסטגרם. אתה יכול לכתוב תוכן וליצור תמונות, אבל לא לפרסם — הפנה את המשתמש ל-open_marketing כדי לחבר.';

      const system = `אתה "RAY Marketing" — מנהל שיווק בכיר של ${currentUser || 'המשתמש'}, לא בוט תוכן. אתה מדבר עברית, חד, מבוסס-נתונים ובלי מלל מיותר.

## מה מייחד אותך
אתה רואה את **טבלת הלידים האמיתית** — לא רק את הרשתות. לכן העצה שלך תמיד מחוברת לכסף: איזה ערוץ מביא לידים שנסגרים, איפה מבזבזים תקציב, ומה לשנות בתוכן כדי למשוך את הקהל שבאמת קונה. אל תיתן טיפים גנריים — תמיד תתבסס על המספרים שקיבלת.

## הקשר העסקי
${bizCtx || '(אין עדיין פרופיל עסקי מלא — אם חסר לך מידע, שאל את המשתמש והצע save_profile כדי לשמור אותו לתמיד)'}

## מצב הרשתות
${socialLine}

## הנתונים שתקבל
1. **טבלת ביצועי ערוצים** מחושבת מראש: source, leads, won, lost, open, conversion (%), revenue (₪), avgDeal, avgScore, last30, daysSinceLastLead.
   **המספרים האלה נכונים — אל תחשב מחדש ואל תמציא מספרים שלא קיבלת.**
2. **כל הלידים** ברשומה קומפקטית — כולל סטטוס, מקור, **פתרונות שנמכרו ומחיריהם**, התנגדויות, ימים ללא מגע, ההערה האחרונה והפעילות האחרונה.
3. **כרטיסים מלאים** לכמה לידים — כל ההערות וכל יומן הפעילות.

זה מה שהופך אותך למנהל שיווק ולא לכותב תוכן: קרא את ההערות וההתנגדויות של לקוחות שנסגרו מול כאלה שלא, וגזור מזה את המסר, הקהל וההצעה. כשאתה מציע קמפיין או פוסט — בסס אותו על מה שבאמת נאמר בשיחות, וציין על מה התבססת.

## תצוגה ויזואלית — השתמש בה!
מלבד טקסט, אתה יכול להחזיר "blocks" שמוצגים כגרפיקה בצ'אט. אל תתאר מספרים במילים כשאפשר להראות אותם:
- {"type":"bars","title":"...","unit":"₪","items":[{"label":"פייסבוק","value":12000,"hint":"3 עסקאות"}]}
- {"type":"metrics","title":"...","items":[{"label":"המרה","value":"18%","delta":"+4%","tone":"good"}]}  (tone: good|bad|warn|flat)
- {"type":"funnel","steps":[{"label":"לידים","count":100},{"label":"בתהליך","count":40}]}
- {"type":"checklist","title":"מה לעשות השבוע","items":[{"text":"..."}]}
- {"type":"timeline","title":"תוכנית 4 שבועות","items":[{"when":"שבוע 1","what":"..."}]}
- {"type":"compare","title":"...","a":{"label":"אופציה א","points":["..."]},"b":{"label":"אופציה ב","points":["..."]}}
- {"type":"post","platform":"אינסטגרם","caption":"...","hashtags":["..."],"cta":"...","imagePrompt":"english prompt"}
- {"type":"quote","label":"השורה התחתונה","text":"..."}
מקסימום 3 blocks בתשובה.

## פעולות שאתה יכול להציע (המשתמש לוחץ כדי לאשר)
- generate_image: {"prompt":"<פרומפט באנגלית, מפורט, כולל סגנון>","label":"..."} — יוצר תמונה אמיתית בצ'אט
- publish_post: {"platform":"facebook|instagram","caption":"...","hashtags":[...],"imageUrl":"<רק URL שכבר נוצר בשיחה>"} — מפרסם בפועל
- schedule_post: {"platform":"...","caption":"...","hashtags":[...],"hoursFromNow":24,"imageUrl":"..."} — מתזמן לפרסום אוטומטי
- create_plan: {"postsCount":6,"cadence":"3x-week","platforms":["facebook","instagram"]} — בונה תוכנית קמפיין מלאה עם תמונות, לאישור
- save_profile: {"profile":{"productName":"...","targetAudience":"...","styleKeywords":["..."],"brandColors":["#..."]}} — שומר מידע עסקי לצמיתות
- open_marketing: {"tab":"campaigns|autopilot|studio|creative|settings","label":"..."}

כללים:
- אל תציע publish_post עם imageUrl שלא נוצר בשיחה הזו. אם צריך תמונה — קודם generate_image.
- פרומפטים לתמונות תמיד באנגלית, ספציפיים (נושא, קומפוזיציה, תאורה, סגנון, פלטת צבעים).
- קופי בעברית, בטון המותג, עם CTA אחד ברור.
- מקסימום 4 פעולות בתשובה. אם אין פעולה מתבקשת — actions: [].

## פורמט התשובה — JSON בלבד, בלי markdown:
{"reply":"תשובה קצרה וחדה","blocks":[...],"actions":[...]}`;

      const convo: { role: 'user' | 'assistant'; content: string }[] =
        history.map(m => ({ role: m.role, content: m.text }));

      // Marketing advice is only as good as the evidence behind it — give the
      // agent the actual cards (notes, activity, solutions), not just totals.
      const { buildLeadContext } = await import('../lib/leadContext');
      const leadCtx = buildLeadContext(leads, userText ?? '', { maxCompact: 400, maxFull: 5 });

      convo.push({
        role: 'user',
        content:
          `[ביצועי ערוצים — ${leads.length} לידים, ${totalWon} נסגרו, ₪${totalRevenue.toLocaleString('he-IL')} סה"כ]\n`
          + JSON.stringify(channels)
          + `\n\n` + leadCtx.text
          + (userText ? '' : '\n\nפתח בתדריך שיווקי קצר: איזה ערוץ עובד, איזה מבזבז, ומה הצעד הבא. הצג את זה ויזואלית (bars/metrics) והצע פעולות קונקרטיות.'),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-sonnet-4-6', max_tokens: 3000, system, messages: convo,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
      const p = JSON.parse(a !== -1 && b !== -1 ? cleaned.slice(a, b + 1) : cleaned);

      const actions: MktAction[] = (Array.isArray(p.actions) ? p.actions : [])
        .filter((x: MktAction) => x && typeof x.type === 'string')
        .slice(0, 4);

      appendMessage<ChatMsg>('marketing', {
        role: 'assistant', text: p.reply || '—',
        blocks: sanitiseBlocks(p.blocks), actions, doneIds: [],
      });
    } catch (err) {
      console.error('[marketing-copilot]', err);
      appendMessage<ChatMsg>('marketing', { role: 'assistant', text: '⚠️ לא הצלחתי לעבד את זה. נסה שוב או נסח אחרת.' });
    } finally {
      setBusy(false);
    }
  };

  /* Opening briefing — the agent speaks first. */
  useEffect(() => {
    if (session.booted || session.busy) return;   // already briefed, or still briefing
    updateSession('marketing', { booted: true });
    void ask(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Executing an action ────────────────────────────────────────────────── */
  const markDone = (msgIdx: number, key: string) =>
    setMsgs(m => m.map((mm, i) => i === msgIdx ? { ...mm, doneIds: [...(mm.doneIds ?? []), key] } : mm));

  const runAction = async (act: MktAction, msgIdx: number, key: string) => {
    if (working) return;
    try {
      switch (act.type) {
        /* ── Create a real image, inline ──────────────────────────────────── */
        case 'generate_image': {
          if (!act.prompt) return;
          setWorking('יוצר תמונה…');
          const { pollinationsImage } = await import('../lib/marketingAutopilot');
          const url = await pollinationsImage(act.prompt, workspaceId);
          say('הנה התמונה 👇 אם היא מתאימה — אפשר לפרסם או לתזמן אותה.', [
            { type: 'image', url, caption: act.label || act.prompt.slice(0, 80) },
          ]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Publish to a live page. Outward-facing: always confirm. ──────── */
        case 'publish_post': {
          if (!workspace) { onToast?.('אין סביבת עבודה', 'error'); return; }
          const { getPageToken, createFacebookPost, createInstagramPost } = await import('../lib/facebookMarketing');
          const auth = getPageToken(workspace);
          if (!auth) { onToast?.('אין עמוד פייסבוק מחובר', 'error'); onNavigate?.('marketing-agent'); return; }
          const platform = act.platform ?? 'facebook';
          if (platform === 'instagram' && !igId) { onToast?.('אין חשבון אינסטגרם עסקי מחובר', 'error'); return; }
          if (platform === 'instagram' && !act.imageUrl) { onToast?.('אינסטגרם דורש תמונה — צור תמונה קודם', 'error'); return; }

          const tags = (act.hashtags ?? []).map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');
          const message = [act.caption ?? '', tags].filter(Boolean).join('\n\n');
          const where = platform === 'instagram' ? 'אינסטגרם' : `פייסבוק (${connectedPage?.name ?? auth.pageId})`;
          if (!window.confirm(`לפרסם עכשיו ב${where}?\n\n${message.slice(0, 300)}`)) return;

          setWorking('מפרסם…');
          const postId = platform === 'instagram'
            ? await createInstagramPost(igId!, message, auth.token, act.imageUrl)
            : await createFacebookPost(auth.pageId, message, auth.token, act.imageUrl);
          onToast?.(`✅ פורסם ב${where}`, 'success');
          say(`פורסם ✅ (${postId})\nאני אעקוב אחרי הביצועים — שאל אותי בעוד כמה ימים "איך הפוסט האחרון הצליח?".`);
          markDone(msgIdx, key);
          break;
        }

        /* ── Queue it for the server scheduler ────────────────────────────── */
        case 'schedule_post': {
          if (!workspaceId) { onToast?.('אין סביבת עבודה', 'error'); return; }
          const { saveScheduledPost, getPageToken } = await import('../lib/facebookMarketing');
          const { setWorkspaceAutopilotFlag } = await import('../lib/marketingAutopilot');
          const auth = workspace ? getPageToken(workspace) : null;
          const platform = act.platform ?? 'facebook';
          const hours = Math.max(1, Number(act.hoursFromNow) || 24);
          const when = Date.now() + hours * 3600_000;
          const tags = (act.hashtags ?? []).map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');

          setWorking('מתזמן…');
          await saveScheduledPost(workspaceId, {
            message: [act.caption ?? '', tags].filter(Boolean).join('\n\n'),
            scheduledTime: when,
            status: 'pending',
            createdAt: Date.now(),
            platform,
            ...(act.imageUrl ? { imageUrl: act.imageUrl } : {}),
            ...(platform === 'facebook' && auth?.pageId ? { pageId: auth.pageId } : {}),
            ...(platform === 'instagram' && igId ? { igUserId: igId } : {}),
          });
          await setWorkspaceAutopilotFlag(workspaceId, true);  // so the scheduler picks this workspace up
          const label = new Date(when).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          onToast?.(`📅 תוזמן ל-${label}`, 'success');
          say(`תוזמן ל-${label} 📅\nהשרת יפרסם את זה לבד — גם אם המערכת סגורה.`);
          markDone(msgIdx, key);
          break;
        }

        /* ── A full campaign plan: strategy + posts + media + approval ─────── */
        case 'create_plan': {
          if (!workspaceId) { onToast?.('אין סביבת עבודה', 'error'); return; }
          const {
            generateAutopilotPlan, generatePlanMedia, saveAutopilotPlan, notifyOwnerForApproval,
          } = await import('../lib/marketingAutopilot');
          const { loadMarketingConfig } = await import('../lib/facebookMarketing');

          setWorking('בונה אסטרטגיה…');
          const cfg = await loadMarketingConfig(workspaceId);
          const count = Math.min(Math.max(Number(act.postsCount) || 6, 1), 12);
          const plan = await generateAutopilotPlan({
            wid: workspaceId,
            workspace,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: (cfg ?? {}) as any,
            postsCount: count,
            platforms: act.platforms?.length ? act.platforms : ['facebook'],
            cadence: act.cadence ?? '3x-week',
          });

          setWorking(`יוצר תמונות (0/${count})…`);
          await generatePlanMedia(workspaceId, plan, (done, total) =>
            setWorking(`יוצר תמונות (${done}/${total})…`));
          await saveAutopilotPlan(workspaceId, plan);
          try { await notifyOwnerForApproval(workspaceId, workspace, plan); } catch { /* notification is best-effort */ }

          const preview: ChatBlock[] = [
            { type: 'quote', label: plan.title, text: plan.strategy?.summary ?? '' },
            ...plan.posts.slice(0, 2).map(p => ({
              type: 'post' as const,
              platform: p.platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק',
              caption: p.caption, hashtags: p.hashtags, cta: p.cta, imageUrl: p.mediaUrl,
            })),
          ];
          say(`בניתי תוכנית: **${plan.title}** — ${plan.posts.length} פוסטים עם תמונות.\nהנה שניים לדוגמה. כדי לאשר את כולם ולתזמן לפרסום אוטומטי — פתח סוכן שיווק ← אוטופיילוט.`, preview);
          appendMessage<ChatMsg>('marketing', {
            role: 'assistant', text: '',
            actions: [{ type: 'open_marketing', tab: 'autopilot', label: '🚀 פתח לאישור ותזמון' }],
            doneIds: [],
          });
          onToast?.(`✅ תוכנית "${plan.title}" מוכנה לאישור`, 'success');
          markDone(msgIdx, key);
          break;
        }

        /* ── Teach the agent about the business, permanently ──────────────── */
        case 'save_profile': {
          if (!workspaceId || !act.profile) return;
          setWorking('שומר פרופיל…');
          const { loadProductProfile, saveProductProfile } = await import('../lib/mediaGeneration');
          const existing = await loadProductProfile(workspaceId);
          const merged = { ...existing };
          for (const [k, v] of Object.entries(act.profile)) {
            if (v === undefined || v === null || v === '') continue;
            if (Array.isArray(v) && v.length === 0) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (merged as any)[k] = v;
          }
          merged.lastUpdated = Date.now();
          await saveProductProfile(workspaceId, merged);
          onToast?.('✅ הפרופיל העסקי נשמר', 'success');
          say('שמרתי ✅ מעכשיו כל תוכן ותמונה שאייצר יתבססו על זה — גם באוטופיילוט.');
          markDone(msgIdx, key);
          break;
        }

        case 'open_marketing':
          try { sessionStorage.setItem('ray:marketing-tab', act.tab || 'campaigns'); } catch { /* private mode */ }
          onNavigate?.('marketing-agent');
          onClose();
          return;
      }
    } catch (err) {
      console.error('[marketing-action]', err);
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
      say(`⚠️ הפעולה נכשלה: ${(err as Error).message}`);
    } finally {
      setWorking(null);
    }
  };

  const actionLabel = (a: MktAction) => {
    if (a.label) return a.label;
    switch (a.type) {
      case 'generate_image': return '🎨 צור את התמונה';
      case 'publish_post':   return `📤 פרסם ב${a.platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'} עכשיו`;
      case 'schedule_post':  return `📅 תזמן לעוד ${a.hoursFromNow ?? 24} שעות`;
      case 'create_plan':    return `🚀 בנה תוכנית של ${a.postsCount ?? 6} פוסטים`;
      case 'save_profile':   return '💾 שמור את פרטי העסק';
      case 'open_marketing': return '↗ פתח את סוכן השיווק';
    }
  };

  const actionIcon = (t: MktAction['type']) => {
    switch (t) {
      case 'generate_image': return <Wand2 size={11} />;
      case 'publish_post':   return <Upload size={11} />;
      case 'schedule_post':  return <Calendar size={11} />;
      case 'create_plan':    return <Rocket size={11} />;
      default:               return <ArrowLeft size={11} />;
    }
  };

  const quick = [
    'איזה ערוץ מביא לי את הלקוחות הכי טובים?',
    'מה לשפר בשיווק שלי?',
    'צור לי תמונה לפוסט',
    'בנה לי תוכנית קמפיין לשבועיים',
    'כתוב פוסט שמדבר לקהל שנסגר הכי הרבה',
  ];

  const send = () => { const t = input.trim(); if (t) { setInput(''); void ask(t); } };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div dir="rtl" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', height: '92vh' }}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#a21caf,#db2777)' }}>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="text-white/80 hover:text-white p-1"><X size={18} /></button>
            <button
              title="נקה שיחה והתחל מחדש"
              onClick={() => { clearSession('marketing'); setInput(''); }}
              className="text-white/60 hover:text-white p-1"><RotateCcw size={15} /></button>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-white font-black text-sm">RAY Marketing</div>
              <div className="text-fuchsia-100 text-[10px]">מנהל השיווק שלך · מנתח, יוצר, ומפרסם</div>
            </div>
            <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center">
              <Megaphone size={18} className="text-white" />
            </div>
          </div>
        </div>

        {/* Channel chips */}
        <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0 border-b border-slate-100 bg-slate-50">
          <Chip icon={<Users size={10} />} label={`${channels.length} ערוצים`} color="#64748b" />
          {totalRevenue > 0 && <Chip icon={<TrendingUp size={10} />} label={`₪${totalRevenue.toLocaleString('he-IL')}`} color="#10b981" />}
          {channels[0] && <Chip icon={<TrendingUp size={10} />} label={`מוביל: ${channels[0].source}`} color={ACCENT} />}
          <Chip icon={<Share2 size={10} />}  label={social.fb ? 'פייסבוק מחובר' : 'פייסבוק לא מחובר'}   color={social.fb ? '#1877f2' : '#94a3b8'} />
          <Chip icon={<Camera size={10} />} label={social.ig ? 'אינסטגרם מחובר' : 'אינסטגרם לא מחובר'} color={social.ig ? '#e1306c' : '#94a3b8'} />
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: '#faf5ff' }}>
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
                style={m.role === 'user' ? { background: 'linear-gradient(135deg,#a21caf,#db2777)' } : undefined}>
                {m.text}

                {m.blocks?.map((b, j) => (
                  <ChatBlockView key={j} block={b} accent={ACCENT}
                    onCopy={() => onToast?.('הועתק ללוח', 'success')} />
                ))}

                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-1.5">
                    {m.actions.map((a, j) => {
                      const key = `${i}-${j}`;
                      const done = m.doneIds?.includes(key);
                      return (
                        <button key={key} disabled={done || Boolean(working)}
                          onClick={() => void runAction(a, i, key)}
                          className="w-full text-right rounded-xl px-2.5 py-2 text-[11px] font-semibold transition-all disabled:opacity-50"
                          style={done
                            ? { background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }
                            : { background: '#fdf4ff', color: '#a21caf', border: '1px solid #f5d0fe' }}>
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="flex-1">{done ? '✓ בוצע' : actionLabel(a)}</span>
                            {!done && actionIcon(a.type)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {(busy || working) && (
            <div className="flex justify-end">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" style={{ color: ACCENT }} />
                <span className="text-xs text-slate-400">{working ?? 'מנתח את הערוצים...'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-4 py-3 flex-shrink-0 border-t border-slate-200 bg-white">
          <div className="flex flex-wrap gap-1.5 justify-end mb-2">
            {quick.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={busy || Boolean(working)}
                className="text-[10px] px-2 py-1 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-100 disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={send} disabled={busy || Boolean(working) || !input.trim()}
              className="px-4 rounded-xl text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#a21caf,#db2777)' }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="בקש ממני קמפיין, תמונה, ניתוח ערוצים..."
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-200"
              style={{ maxHeight: 100 }} />
          </div>
          <p className="text-[9px] text-slate-400 mt-1.5 text-right flex items-center gap-1 justify-end">
            <ImageIcon size={9} /> תמונות נוצרות חינם · פרסום דורש אישור שלך בלחיצה
          </p>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold"
      style={{ background: `${color}14`, color, border: `1px solid ${color}30` }}>
      {icon}{label}
    </span>
  );
}
