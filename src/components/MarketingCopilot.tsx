/**
 * MarketingCopilot — the marketing agent, as a conversation.
 *
 * Everything the Marketing Agent page can do is reachable here by asking for
 * it, and the user can hand the agent their own materials — a price list, the
 * ads that worked, a brand guide, product photos — so the advice is about
 * *their* business rather than a generic one.
 *
 * Parity with the page, deliberately: ad copy variations and the copy library,
 * campaign briefs, audience building, competitor analysis, retargeting ideas,
 * budget recommendations, page and post performance, comment replies, agent
 * settings, autopilot plans and their approval, publishing and scheduling.
 * Each action writes to the same Firestore documents the page reads, so what
 * is done in chat shows up on the page and vice versa.
 *
 * Design choices worth knowing:
 *  • Channel performance is computed here, deterministically, from the leads.
 *    The model receives those numbers; it never adds up money itself.
 *  • Uploaded files are read ONCE, at upload, into a short summary that goes
 *    into every later prompt (see marketingMaterials.ts). Images uploaded in a
 *    turn are also shown to the model in that turn, so "make me a post like
 *    this" works on the photo just attached.
 *  • Anything that leaves the system — publishing, scheduling, approving a
 *    plan, replying to comments — is behind an explicit click, and publishing
 *    also behind a confirm. Nothing auto-publishes from chat.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Send, Loader2, Megaphone, Image as ImageIcon, Rocket, Users, Paperclip,
  TrendingUp, ArrowLeft, Calendar, Upload, Share2, Camera, Wand2, RotateCcw, Mic, Square, Volume2,
  FileText, BookOpen, Target, Search, BarChart2, MessageSquare, Settings2, CheckCircle2, Coins,
} from 'lucide-react';
import type { Lead, WorkspaceProfile } from '../types';
import ChatBlockView, { sanitiseBlocks } from './ChatBlocks';
import type { ChatBlock } from './ChatBlocks';
import {
  useChatSession, setMessages, appendMessage, updateSession, setOpen, clearSession,
} from '../lib/chatSessionStore';
import { useDraggableWindow } from '../lib/useDraggableWindow';
import { useVoiceChat } from '../lib/useVoiceChat';
import type { MarketingMaterial } from '../lib/marketingMaterials';
import { loadMaterials, addMaterial, materialsContext, kindOf } from '../lib/marketingMaterials';
import type { MarketingAgentConfig } from '../lib/facebookMarketing';
import type { SocialConnection } from '../lib/socialConnections';
import type { AutopilotPlan } from '../lib/marketingAutopilot';
import type { EngineId, EngineStatus, EngineKind } from '../lib/mediaEngines';
import {
  ENGINE_BY_ID, fetchEngineStatus, connectedEngines, getPreferredEngine, setPreferredEngine,
  generateImageWith, generateVideoWith,
} from '../lib/mediaEngines';

const ACCENT = '#c026d3';       // fuchsia — distinct from the sales copilot's teal
const WON_STATUSES = ['לקוח פעיל', 'נסגר', 'עסקה נסגרה'];
const DEAD_STATUSES = ['לא רלוונטי', 'אבוד', 'לא מעוניין'];

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

/* ── What the agent is allowed to propose ─────────────────────────────────── */
interface MktAction {
  type:
    | 'generate_image'    // create a visual right here in the chat
    | 'generate_video'    // start a video with the selected video engine
    | 'publish_post'      // push a post to a live FB/IG page (confirmed)
    | 'schedule_post'     // queue a post for the server scheduler to publish
    | 'create_plan'       // full autopilot campaign plan + media + approval
    | 'approve_plan'      // approve + schedule the latest pending autopilot plan
    | 'save_profile'      // teach the agent about the business, persistently
    | 'ask_materials'     // open the file picker — "show me your price list"
    | 'ad_copy'           // N copy variations → copy library
    | 'campaign_brief'    // full brief → briefs collection
    | 'build_audience'    // audience profile → audiences collection
    | 'analyze_competitor'// analyse a competitor's ad → competitor library
    | 'retargeting_idea'  // a retargeting ad for warm leads
    | 'budget_recommendation'
    | 'page_insights'     // 30-day page numbers
    | 'post_performance'  // last posts, reach/engagement
    | 'reply_comments'    // draft AI replies for new comments
    | 'update_settings'   // patch the agent's configuration
    | 'open_marketing';   // hand off to the full Marketing Agent page
  label?: string;
  prompt?: string;        // generate_image
  platform?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  imageUrl?: string;
  imagePrompt?: string;
  aspect?: '1:1' | '16:9' | '9:16';   // generate_image / generate_video
  duration?: 5 | 10;                    // generate_video
  hoursFromNow?: number;  // schedule_post
  postsCount?: number;    // create_plan
  cadence?: 'daily' | '3x-week' | 'weekly';
  platforms?: Array<'facebook' | 'instagram'>;
  profile?: {
    productName?: string; productDescription?: string; targetAudience?: string;
    styleKeywords?: string[]; brandColors?: string[]; avoidKeywords?: string[];
  };
  // ad_copy / campaign_brief / build_audience / retargeting_idea
  product?: string; audience?: string; goal?: string; budget?: number;
  copyType?: 'headline' | 'body' | 'cta' | 'caption' | 'hook'; count?: number;
  existingCustomers?: string;
  adText?: string; competitorName?: string;                    // analyze_competitor
  campaigns?: { name: string; platform: string; spend: number; leads: number; cpl: number }[]; // budget
  totalBudget?: number;
  settings?: Partial<MarketingAgentConfig>;                     // update_settings
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

/** An image attached to the NEXT message, shown to the model that one time. */
interface PendingImage { name: string; mime: string; data: string; previewUrl: string }

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

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export default function MarketingCopilot({
  leads, workspace, workspaceId, currentUser, onToast, onNavigate, onClose,
}: Props) {
  const { backdropProps, panelProps, handleProps } = useDraggableWindow('marketing');
  /* Session lives in the shared store: closing the window keeps the history and
     lets a running plan/image generation finish in the background. */
  const session = useChatSession<ChatMsg>('marketing');
  const msgs    = session.msgs;
  const busy    = session.busy;
  const working = session.working;

  const askVoice = (t: string) => { void ask(t); };
  const lastReply = [...msgs].reverse().find(m => m.role === 'assistant')?.text;
  const voice = useVoiceChat({
    onSay: t => { setInput(''); void askVoice(t); },
    lastReply,
    busy: busy || Boolean(working),
  });
  const setMsgs   = (u: ChatMsg[] | ((p: ChatMsg[]) => ChatMsg[])) => setMessages<ChatMsg>('marketing', u);
  const setBusy   = (v: boolean) => updateSession('marketing', { busy: v });
  const setWorking = (v: string | null) => updateSession('marketing', { working: v });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── What the agent knows about this workspace, beyond the leads ──────── */
  const [materials, setMaterials]   = useState<MarketingMaterial[]>([]);
  const [cfg, setCfg]               = useState<MarketingAgentConfig | null>(null);
  const [socialConns, setSocial]    = useState<SocialConnection[]>([]);
  const [plans, setPlans]           = useState<AutopilotPlan[]>([]);
  const [pendingImages, setPending] = useState<PendingImage[]>([]);

  /* Which engines the admin connected, and which this workspace prefers.
     The picker only offers connected ones — a choice that fails on click is
     worse than no choice. */
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [imageEngine, setImageEngine]   = useState<EngineId | null>(null);
  const [videoEngine, setVideoEngine]   = useState<EngineId | null>(null);
  useEffect(() => {
    fetchEngineStatus().then(st => {
      setEngineStatus(st);
      setImageEngine(getPreferredEngine(workspaceId ?? '', 'image', st));
      setVideoEngine(getPreferredEngine(workspaceId ?? '', 'video', st));
    }).catch(() => {
      // Status unknown: still offer the free engine so image generation works.
      setEngineStatus({ pollinations: true, imagen: false, dalle: false, ideogram: false, veo: false, kling: false, runway: false });
      setImageEngine('pollinations');
    });
  }, [workspaceId]);
  const pickEngine = (kind: EngineKind, id: EngineId) => {
    setPreferredEngine(workspaceId ?? '', kind, id);
    if (kind === 'image') setImageEngine(id); else setVideoEngine(id);
  };

  const refreshKnowledge = useCallback(async () => {
    if (!workspaceId) return;
    const [{ loadMarketingConfig }, { loadSocialConnections }, { loadAutopilotPlans }] = await Promise.all([
      import('../lib/facebookMarketing'), import('../lib/socialConnections'), import('../lib/marketingAutopilot'),
    ]);
    const [m, c, s, p] = await Promise.all([
      loadMaterials(workspaceId),
      loadMarketingConfig(workspaceId).catch(() => null),
      loadSocialConnections(workspaceId).catch(() => [] as SocialConnection[]),
      loadAutopilotPlans(workspaceId).catch(() => [] as AutopilotPlan[]),
    ]);
    setMaterials(m); setCfg(c); setSocial(s); setPlans(p);
  }, [workspaceId]);

  useEffect(() => { setOpen('marketing', true); return () => setOpen('marketing', false); }, []);
  useEffect(() => { void refreshKnowledge(); }, [refreshKnowledge]);

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
  const otherConnected = socialConns.filter(c => c.connected && !['facebook', 'instagram'].includes(c.platform));
  const pendingPlan = [...plans].filter(p => p.status === 'pending_approval').sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];

  const say = (text: string, blocks?: ChatBlock[], actions?: MktAction[]) =>
    appendMessage<ChatMsg>('marketing', { role: 'assistant', text, blocks, actions, doneIds: [] });

  /* ── Uploads: store, learn, and show to the model this turn ──────────── */
  const attachFiles = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (!workspaceId) { onToast?.('אין סביבת עבודה', 'error'); return; }
    // Whatever is typed alongside the upload is the note ("זה המחירון של 2026").
    const note = input.trim() || undefined;
    setInput('');
    setWorking('מעלה חומר…');
    try {
      for (const file of files) {
        const kind = kindOf(file);
        if (kind === 'image') {
          // Shown to the model on the next turn, so "make a post like this" works
          // on the photo just attached — not only on its summary.
          try {
            const data = await fileToBase64(file);
            setPending(p => [...p, { name: file.name, mime: file.type, data, previewUrl: URL.createObjectURL(file) }]);
          } catch { /* preview is a convenience */ }
        }
        const m = await addMaterial(workspaceId, file, note, setWorking);
        say(
          `למדתי מ-"${m.name}" ✅\n${m.summary}`,
          kind === 'image' ? [{ type: 'image', url: m.url, caption: m.name }] : undefined,
        );
      }
      await refreshKnowledge();
      onToast?.(`${files.length === 1 ? 'החומר נשמר' : `${files.length} חומרים נשמרו`} — הסוכן ילמד מהם מעכשיו`, 'success');
    } catch (err) {
      onToast?.(`ההעלאה נכשלה: ${(err as Error).message}`, 'error');
      say(`⚠️ לא הצלחתי לשמור את הקובץ: ${(err as Error).message}`);
    } finally {
      setWorking(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /* ── The conversation ───────────────────────────────────────────────────── */
  const ask = async (userText: string | null) => {
    if (busy) return;
    setBusy(true);
    const attached = pendingImages;
    setPending([]);
    const shownText = userText
      ? (attached.length ? `${userText}\n📎 ${attached.map(a => a.name).join(', ')}` : userText)
      : null;
    const history = shownText ? [...msgs, { role: 'user' as const, text: shownText }] : msgs;
    if (shownText) setMsgs(history);

    try {
      const [{ getAnthropicProxy }, { gatherBusinessContext, contextCompleteness }] = await Promise.all([
        import('../lib/anthropicClient'),
        import('../lib/marketingAutopilot'),
      ]);
      const client = getAnthropicProxy();

      let bizCtx = '';
      let missing: string[] = [];
      if (workspaceId) {
        try {
          const g = await gatherBusinessContext(workspaceId, workspace);
          bizCtx = g.text;
          missing = contextCompleteness(workspace, g.profile).missing;
        } catch { /* optional */ }
      }

      const socialLine = [
        social.fb && `פייסבוק (${connectedPage?.name ?? connectedPage?.id})`,
        social.ig && 'אינסטגרם',
        ...otherConnected.map(c => `${c.platform}${c.accountName ? ` (${c.accountName})` : ''}`),
      ].filter(Boolean).join(' + ');
      const socialCtx = socialLine
        ? `מחובר: ${socialLine}. אתה יכול לפרסם, לתזמן ולקרוא ביצועים בפועל.`
        : 'לא מחובר אף עמוד/רשת. אתה יכול לכתוב תוכן וליצור תמונות, אבל לא לפרסם — הצע open_marketing עם tab "settings" כדי לחבר.';

      const settingsCtx = cfg
        ? `סוכן: ${cfg.agentName || 'RAY'} · טון: ${cfg.replyTone} · אמוג'י: ${cfg.emojiUsage} · CTA: ${cfg.ctaStyle} · האשטגים: ${cfg.hashtagStrategy} · תדירות: ${cfg.postFrequency} · אישור ידני לפני פרסום: ${cfg.requireApproval ? 'כן' : 'לא'} · אוטופיילוט: ${cfg.autopilotEnabled ? 'פעיל' : 'כבוי'}${cfg.contentPillars?.length ? ` · נושאי תוכן: ${cfg.contentPillars.join(', ')}` : ''}`
        : '(אין עדיין הגדרות סוכן — ברירות מחדל)';

      const imgOpts = connectedEngines(engineStatus, 'image').map(e => e.label);
      const vidOpts = connectedEngines(engineStatus, 'video').map(e => e.label);
      const engineCtx = `תמונות: ${imageEngine ? ENGINE_BY_ID[imageEngine].label : 'אין'}${imgOpts.length > 1 ? ` (זמינים: ${imgOpts.join(', ')})` : ''} · וידאו: ${videoEngine ? ENGINE_BY_ID[videoEngine].label : 'לא מחובר מנוע וידאו — אמור שהאדמין צריך לחבר Veo/Kling/Runway בלוח האדמין ← אינטגרציות'}${vidOpts.length > 1 ? ` (זמינים: ${vidOpts.join(', ')})` : ''}`;

      const planCtx = pendingPlan
        ? `יש תוכנית אוטופיילוט שממתינה לאישור: "${pendingPlan.title}" (${pendingPlan.posts.length} פוסטים). אפשר להציע approve_plan.`
        : 'אין תוכנית שממתינה לאישור.';

      const system = `אתה "RAY Marketing" — מנהל שיווק בכיר של ${currentUser || 'המשתמש'}, לא בוט תוכן. אתה מדבר עברית, חד, מבוסס-נתונים ובלי מלל מיותר.
המשתמש עושה **הכל** דרכך — הוא לא אמור לפתוח את דף השיווק. כל מה שהדף יודע, אתה יודע.

## מה מייחד אותך
אתה רואה את **טבלת הלידים האמיתית** ואת **החומרים שהמשתמש העלה** — לא רק את הרשתות. העצה שלך תמיד מחוברת לכסף ולעסק הספציפי הזה. אל תיתן טיפים גנריים.

## הקשר העסקי
${bizCtx || '(אין עדיין פרופיל עסקי)'}
${missing.length ? `\n**חסר לך כדי לעבוד טוב:** ${missing.join(', ')}. שאל, או הצע ask_materials ("העלה לי מחירון / קטלוג / דוגמאות לפוסטים שעבדו") ו-save_profile.` : ''}

${materialsContext(materials) || '## חומרים\nהמשתמש עדיין לא העלה חומרים. אם התוכן שאתה יוצר תלוי במה שהעסק מוכר או בסגנון שלו — הצע ask_materials לפני שאתה ממציא.'}

## מצב הרשתות
${socialCtx}

## הגדרות הסוכן (אפשר לשנות עם update_settings)
${settingsCtx}

## אוטופיילוט
${planCtx}

## מנועי מדיה (המשתמש בוחר בכותרת הצ'אט)
${engineCtx}

## הנתונים שתקבל
1. **טבלת ביצועי ערוצים** מחושבת מראש — **המספרים נכונים, אל תחשב מחדש ואל תמציא.**
2. **כל הלידים** ברשומה קומפקטית, ו**כרטיסים מלאים** לכמה מהם.
${attached.length ? `3. **תמונות שהמשתמש צירף להודעה הזו** — הסתכל עליהן ותתייחס אליהן ישירות.` : ''}

## תצוגה ויזואלית — השתמש בה!
- {"type":"bars","title":"...","unit":"₪","items":[{"label":"פייסבוק","value":12000,"hint":"3 עסקאות"}]}
- {"type":"metrics","title":"...","items":[{"label":"המרה","value":"18%","delta":"+4%","tone":"good"}]}
- {"type":"funnel","steps":[{"label":"לידים","count":100},{"label":"בתהליך","count":40}]}
- {"type":"checklist","title":"...","items":[{"text":"..."}]}
- {"type":"timeline","title":"...","items":[{"when":"שבוע 1","what":"..."}]}
- {"type":"compare","title":"...","a":{"label":"...","points":["..."]},"b":{"label":"...","points":["..."]}}
- {"type":"post","platform":"אינסטגרם","caption":"...","hashtags":["..."],"cta":"...","imagePrompt":"english prompt"}
- {"type":"quote","label":"...","text":"..."}
מקסימום 3 blocks בתשובה.

## פעולות שאתה יכול להציע (המשתמש לוחץ כדי לאשר)
יצירה ופרסום:
- generate_image: {"prompt":"<english, detailed, style>","aspect":"1:1|16:9|9:16","label":"..."} — במנוע התמונות שנבחר
- generate_video: {"prompt":"<english, motion, camera, mood>","aspect":"16:9|9:16","duration":5,"imageUrl":"<אופציונלי: תמונה מהשיחה להנפשה>","label":"..."} — רק אם מחובר מנוע וידאו
- publish_post: {"platform":"facebook|instagram","caption":"...","hashtags":[...],"imageUrl":"<רק URL שנוצר/הועלה בשיחה>"}
- schedule_post: {"platform":"...","caption":"...","hashtags":[...],"hoursFromNow":24,"imageUrl":"..."}
- create_plan: {"postsCount":6,"cadence":"3x-week","platforms":["facebook","instagram"]}
- approve_plan: {} — מאשר ומתזמן את התוכנית שממתינה
קופי ואסטרטגיה (נשמר בספריות של דף השיווק):
- ad_copy: {"product":"...","audience":"...","platform":"facebook|instagram|google|linkedin","goal":"...","copyType":"headline|body|cta|caption|hook","count":5}
- campaign_brief: {"product":"...","goal":"...","audience":"...","budget":3000}
- build_audience: {"product":"...","goal":"...","existingCustomers":"<תיאור הלקוחות שנסגרו, מהלידים>"}
- analyze_competitor: {"competitorName":"...","adText":"<טקסט המודעה שהמשתמש הביא>"}
- retargeting_idea: {"product":"...","audience":"<לידים שלא נסגרו>"}
- budget_recommendation: {"campaigns":[{"name":"...","platform":"...","spend":0,"leads":0,"cpl":0}],"totalBudget":5000} — רק עם מספרים שהמשתמש נתן
ביצועים ותגובות (דורש עמוד מחובר):
- page_insights: {} — 30 יום אחרונים
- post_performance: {} — הפוסטים האחרונים
- reply_comments: {} — מנסח תגובות AI לתגובות חדשות, לאישור
למידה והגדרות:
- ask_materials: {"label":"📎 העלה מחירון / קטלוג / דוגמאות"} — פותח בחירת קבצים
- save_profile: {"profile":{"productName":"...","targetAudience":"...","styleKeywords":["..."],"brandColors":["#..."]}}
- update_settings: {"settings":{"replyTone":"friendly","emojiUsage":"minimal","ctaStyle":"direct","hashtagStrategy":"auto","postFrequency":"3x-week","requireApproval":true,"contentPillars":["..."],"agentInstructions":"..."}}
- open_marketing: {"tab":"campaigns|autopilot|studio|creative|settings","label":"..."} — רק כשבאמת אין דרך לעשות את זה כאן

כללים:
- אל תציע publish_post עם imageUrl שלא נוצר או הועלה בשיחה. אם צריך תמונה — קודם generate_image או ask_materials.
- פרומפטים לתמונות באנגלית, ספציפיים. קופי בעברית, בטון המותג, CTA אחד.
- כשמשהו תלוי במה שהעסק מוכר ואין לך חומרים — בקש אותם, אל תמציא מחירים או מוצרים.
- מקסימום 4 פעולות בתשובה. אם אין — actions: [].

## פורמט התשובה — JSON בלבד, בלי markdown:
{"reply":"תשובה קצרה וחדה","blocks":[...],"actions":[...]}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convo: { role: 'user' | 'assistant'; content: any }[] =
        history.map(m => ({ role: m.role, content: m.text }));

      const { buildLeadContext } = await import('../lib/leadContext');
      const leadCtx = buildLeadContext(leads, userText ?? '', { maxCompact: 400, maxFull: 5 });

      const dataText =
        `[ביצועי ערוצים — ${leads.length} לידים, ${totalWon} נסגרו, ₪${totalRevenue.toLocaleString('he-IL')} סה"כ]\n`
        + JSON.stringify(channels)
        + `\n\n` + leadCtx.text
        + (userText ? '' : '\n\nפתח בתדריך שיווקי קצר: איזה ערוץ עובד, איזה מבזבז, מה חסר לך כדי לעבוד טוב (חומרים/פרופיל), ומה הצעד הבא. הצג ויזואלית והצע פעולות קונקרטיות.');

      // Images attached this turn ride along as vision blocks — the model sees
      // the actual photo, not just the summary written at upload.
      convo.push({
        role: 'user',
        content: attached.length
          ? [
              ...attached.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } })),
              { type: 'text', text: dataText },
            ]
          : dataText,
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

  /* Opening briefing — the agent speaks first.
     Keyed on `booted`, not on mount: "נקה שיחה" resets booted to false, and
     with mount-only deps the cleared chat just sat empty until the window was
     closed and reopened. */
  useEffect(() => {
    if (session.booted || session.busy) return;
    updateSession('marketing', { booted: true });
    void ask(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.booted]);

  /* ── Executing an action ────────────────────────────────────────────────── */
  const markDone = (msgIdx: number, key: string) =>
    setMsgs(m => m.map((mm, i) => i === msgIdx ? { ...mm, doneIds: [...(mm.doneIds ?? []), key] } : mm));

  const needWid = (): string => {
    if (!workspaceId) { onToast?.('אין סביבת עבודה', 'error'); throw new Error('no workspace'); }
    return workspaceId;
  };
  const needPage = async () => {
    const { getPageToken } = await import('../lib/facebookMarketing');
    const auth = workspace ? getPageToken(workspace) : null;
    if (!auth) {
      onToast?.('אין עמוד פייסבוק מחובר', 'error');
      say('אין עמוד פייסבוק מחובר, אז אין לי ממה לקרוא. חבר עמוד בהגדרות ואז נחזור לזה.',
        undefined, [{ type: 'open_marketing', tab: 'settings', label: '🔗 חבר עמוד' }]);
      throw new Error('no page');
    }
    return auth;
  };
  const bizDescription = () =>
    cfg?.businessDescription || workspace?.prompt || workspace?.name || '';

  const runAction = async (act: MktAction, msgIdx: number, key: string) => {
    if (working) return;
    try {
      switch (act.type) {
        /* ── Create a real image, inline ──────────────────────────────────── */
        case 'generate_image': {
          if (!act.prompt) return;
          const wid = needWid();
          const eng = imageEngine ?? 'pollinations';
          setWorking(`יוצר תמונה ב-${ENGINE_BY_ID[eng].label}…`);
          const { url, model } = await generateImageWith(eng, act.prompt, act.aspect ?? '1:1', wid);
          say(`הנה התמונה 👇 (${ENGINE_BY_ID[eng].label}${model ? ` · ${model}` : ''}) אם היא מתאימה — אפשר לפרסם, לתזמן, או להנפיש לסרטון.`, [
            { type: 'image', url, caption: act.label || act.prompt.slice(0, 80) },
          ], videoEngine ? [{ type: 'generate_video', prompt: `${act.prompt}. Subtle natural motion, slow camera push-in.`, imageUrl: url, aspect: '16:9', label: `🎬 הנפש לסרטון (${ENGINE_BY_ID[videoEngine].label})` }] : undefined);
          markDone(msgIdx, key);
          break;
        }

        /* ── A video, with whichever engine the admin connected ───────────── */
        case 'generate_video': {
          if (!act.prompt) return;
          const wid = needWid();
          if (!videoEngine) {
            say('אין מנוע וידאו מחובר. האדמין יכול לחבר Veo, Kling או Runway בלוח האדמין ← אינטגרציות — יש שם הוראות מדויקות לכל אחד.');
            return;
          }
          const eng = videoEngine;
          setWorking(`מייצר וידאו ב-${ENGINE_BY_ID[eng].label}…`);
          const { url } = await generateVideoWith(eng, act.prompt, act.aspect ?? '16:9', wid, {
            duration: act.duration ?? 5, imageUrl: act.imageUrl, onStage: setWorking,
          });
          say(`הסרטון מוכן 🎬 (${ENGINE_BY_ID[eng].label})\n${url}\nאפשר להוריד אותו מהקישור, או לבקש גרסה אחרת.`, [
            { type: 'quote', label: 'פרומפט', text: act.prompt },
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
          const platform = act.platform === 'instagram' ? 'instagram' : 'facebook';
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
          // Close the learning loop: a post published from chat teaches the
          // agent exactly as one published from the page does.
          if (workspaceId) {
            const { recordPublishedPost } = await import('../lib/mediaGeneration');
            await recordPublishedPost(workspaceId, {
              text: message, tone: cfg?.replyTone ?? 'friendly', topic: (act.caption ?? '').slice(0, 80),
              platforms: [platform], ...(act.imageUrl ? { mediaType: 'image', mediaUrl: act.imageUrl } : {}),
              publishedAt: Date.now(),
            });
          }
          onToast?.(`✅ פורסם ב${where}`, 'success');
          say(`פורסם ✅ (${postId})\nבעוד כמה ימים שאל אותי "איך הפוסט האחרון הצליח?" ואביא מספרים.`);
          markDone(msgIdx, key);
          break;
        }

        /* ── Queue it for the server scheduler ────────────────────────────── */
        case 'schedule_post': {
          const wid = needWid();
          const { saveScheduledPost, getPageToken } = await import('../lib/facebookMarketing');
          const { setWorkspaceAutopilotFlag } = await import('../lib/marketingAutopilot');
          const auth = workspace ? getPageToken(workspace) : null;
          const platform = act.platform === 'instagram' ? 'instagram' : 'facebook';
          const hours = Math.max(1, Number(act.hoursFromNow) || 24);
          const when = Date.now() + hours * 3600_000;
          const tags = (act.hashtags ?? []).map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');

          setWorking('מתזמן…');
          await saveScheduledPost(wid, {
            message: [act.caption ?? '', tags].filter(Boolean).join('\n\n'),
            scheduledTime: when,
            status: 'pending',
            createdAt: Date.now(),
            platform,
            ...(act.imageUrl ? { imageUrl: act.imageUrl } : {}),
            ...(platform === 'facebook' && auth?.pageId ? { pageId: auth.pageId } : {}),
            ...(platform === 'instagram' && igId ? { igUserId: igId } : {}),
          });
          await setWorkspaceAutopilotFlag(wid, true);
          const label = new Date(when).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          onToast?.(`📅 תוזמן ל-${label}`, 'success');
          say(`תוזמן ל-${label} 📅\nהשרת יפרסם את זה לבד — גם אם המערכת סגורה.`);
          markDone(msgIdx, key);
          break;
        }

        /* ── A full campaign plan: strategy + posts + media + approval ─────── */
        case 'create_plan': {
          const wid = needWid();
          const {
            generateAutopilotPlan, generatePlanMedia, saveAutopilotPlan, notifyOwnerForApproval,
          } = await import('../lib/marketingAutopilot');
          const { loadMarketingConfig } = await import('../lib/facebookMarketing');

          setWorking('בונה אסטרטגיה…');
          const config = await loadMarketingConfig(wid);
          const count = Math.min(Math.max(Number(act.postsCount) || 6, 1), 12);
          const plan = await generateAutopilotPlan({
            wid, workspace,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config: (config ?? {}) as any,
            postsCount: count,
            platforms: act.platforms?.length ? act.platforms : ['facebook'],
            cadence: act.cadence ?? '3x-week',
          });

          setWorking(`יוצר תמונות (0/${count})…`);
          await generatePlanMedia(wid, plan, (done, total) => setWorking(`יוצר תמונות (${done}/${total})…`));
          await saveAutopilotPlan(wid, plan);
          try { await notifyOwnerForApproval(wid, workspace, plan); } catch { /* best-effort */ }
          await refreshKnowledge();

          const preview: ChatBlock[] = [
            { type: 'quote', label: plan.title, text: plan.strategy?.summary ?? '' },
            ...plan.posts.slice(0, 2).map(p => ({
              type: 'post' as const,
              platform: p.platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק',
              caption: p.caption, hashtags: p.hashtags, cta: p.cta, imageUrl: p.mediaUrl,
            })),
          ];
          say(`בניתי תוכנית: **${plan.title}** — ${plan.posts.length} פוסטים עם תמונות. הנה שניים לדוגמה.`, preview, [
            { type: 'approve_plan', label: `✅ אשר ותזמן את כל ${plan.posts.length} הפוסטים` },
            { type: 'open_marketing', tab: 'autopilot', label: '👀 עבור פוסט-פוסט בדף' },
          ]);
          onToast?.(`✅ תוכנית "${plan.title}" מוכנה לאישור`, 'success');
          markDone(msgIdx, key);
          break;
        }

        /* ── Approve and schedule the plan that is waiting ────────────────── */
        case 'approve_plan': {
          const wid = needWid();
          if (!pendingPlan) { say('אין תוכנית שממתינה לאישור כרגע.'); return; }
          if (!window.confirm(`לאשר ולתזמן את "${pendingPlan.title}" — ${pendingPlan.posts.length} פוסטים לפרסום אוטומטי?`)) return;
          setWorking('מתזמן את התוכנית…');
          const { approveAndSchedule, updateAutopilotPlan } = await import('../lib/marketingAutopilot');
          const { scheduled } = await approveAndSchedule(wid, workspace, pendingPlan);
          await updateAutopilotPlan(wid, pendingPlan.id, { status: 'approved' } as Partial<AutopilotPlan>);
          await refreshKnowledge();
          onToast?.(`✅ ${scheduled} פוסטים תוזמנו`, 'success');
          say(`אושר ✅ ${scheduled} פוסטים תוזמנו לפרסום אוטומטי לפי הקצב שנקבע.`);
          markDone(msgIdx, key);
          break;
        }

        /* ── Copy variations → copy library ───────────────────────────────── */
        case 'ad_copy': {
          const wid = needWid();
          setWorking('כותב וריאציות…');
          const { generateAdCopyVariations, saveCopyItem } = await import('../lib/marketingEnhancements');
          const type = act.copyType ?? 'headline';
          const platform = act.platform ?? 'facebook';
          const variations = await generateAdCopyVariations(
            act.product || bizDescription(), act.audience || '', platform, act.goal || 'לידים', type,
            Math.min(Math.max(Number(act.count) || 5, 1), 8),
          );
          for (const text of variations) {
            await saveCopyItem(wid, { platform, type, text, tags: [act.goal || ''].filter(Boolean), usageCount: 0, createdAt: Date.now() });
          }
          say(`${variations.length} וריאציות ${type} ל${platform} — נשמרו בספריית הקופי.`,
            [{ type: 'checklist', title: 'בחר את מה שמדבר אליך', items: variations.map(text => ({ text })) }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Campaign brief → briefs ──────────────────────────────────────── */
        case 'campaign_brief': {
          const wid = needWid();
          setWorking('כותב בריף…');
          const { generateCampaignBrief, saveBrief } = await import('../lib/marketingEnhancements');
          const brief = await generateCampaignBrief(
            act.product || bizDescription(), act.goal || 'לידים', act.audience || '',
            Number(act.budget) || 0, bizDescription(),
          );
          await saveBrief(wid, { ...brief, createdAt: Date.now() });
          say(`הבריף "${brief.name}" מוכן ונשמר.`, [
            { type: 'quote', label: 'המסר המרכזי', text: brief.keyMessage },
            { type: 'checklist', title: 'KPIs', items: (brief.kpis ?? []).map(text => ({ text })) },
            { type: 'post', platform: (brief.platforms ?? [])[0] ?? '', caption: brief.adCopy, imagePrompt: brief.visualConcept },
          ]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Audience → audiences ─────────────────────────────────────────── */
        case 'build_audience': {
          const wid = needWid();
          setWorking('בונה קהל…');
          const { buildAudienceWithAI, saveAudience } = await import('../lib/marketingEnhancements');
          const won = leads.filter(l => WON_STATUSES.includes(l.status)).slice(0, 15)
            .map(l => `${l.company}${l.source ? ` (${l.source})` : ''}${l.budget ? ` ₪${l.budget}` : ''}`).join('; ');
          const aud = await buildAudienceWithAI(act.product || bizDescription(), act.goal || 'לידים', act.existingCustomers || won);
          await saveAudience(wid, { ...aud, createdAt: Date.now() });
          say(`קהל "${aud.name}" נבנה ונשמר — ${aud.ageRange}, ${aud.gender}, ${aud.locations?.join(', ')}. גודל משוער: ${aud.estimatedSize}.`, [
            { type: 'quote', label: 'מי הם', text: aud.description },
            { type: 'checklist', title: 'תחומי עניין להתמקד בהם', items: (aud.interests ?? []).map(text => ({ text })) },
          ]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Competitor ad → competitor library ───────────────────────────── */
        case 'analyze_competitor': {
          const wid = needWid();
          if (!act.adText) { say('הדבק לי את טקסט המודעה של המתחרה ואנתח אותה.'); return; }
          setWorking('מנתח מודעה…');
          const { analyzeCompetitorAd, saveCompetitorAd } = await import('../lib/marketingEnhancements');
          const analysis = await analyzeCompetitorAd(act.adText, bizDescription());
          await saveCompetitorAd(wid, {
            competitorName: act.competitorName || 'מתחרה', pageName: act.competitorName || '',
            adText: act.adText, startDate: new Date().toISOString().slice(0, 10), platforms: [act.platform ?? 'facebook'],
            analysis, savedAt: Date.now(),
          });
          say('ניתוח המודעה — נשמר בספריית המתחרים.', [{ type: 'quote', label: act.competitorName || 'המתחרה', text: analysis }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Retargeting ad for the leads that did not close ──────────────── */
        case 'retargeting_idea': {
          setWorking('חושב על ריטרגטינג…');
          const { generateRetargetingIdea } = await import('../lib/marketingEnhancements');
          const idea = await generateRetargetingIdea(act.product || bizDescription(), act.audience || 'לידים שלא נסגרו', bizDescription());
          say(`רעיון ריטרגטינג — פונה ל: ${idea.targetSegment}`, [
            { type: 'post', platform: 'ריטרגטינג', caption: `${idea.headline}\n\n${idea.body}`, cta: idea.cta },
          ], [{ type: 'generate_image', prompt: `Ad creative for: ${idea.headline}. Clean, high-contrast, product-focused, modern.`, label: '🎨 צור קריאייטיב למודעה' }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Budget split — only from numbers the user gave ───────────────── */
        case 'budget_recommendation': {
          if (!act.campaigns?.length || !act.totalBudget) { say('כדי להמליץ על חלוקת תקציב אני צריך את ההוצאה והלידים לכל קמפיין, ותקציב כולל.'); return; }
          setWorking('מחשב חלוקה…');
          const { getBudgetRecommendation } = await import('../lib/marketingEnhancements');
          const r = await getBudgetRecommendation(act.campaigns, Number(act.totalBudget));
          say(r.summary, [{
            type: 'bars', title: 'הוצאה מומלצת', unit: '₪',
            items: r.recommendations.map(x => ({ label: x.platform, value: x.recommendedSpend, hint: `היום ₪${x.currentSpend} · ${x.reason}` })),
          }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Page numbers, last 30 days ───────────────────────────────────── */
        case 'page_insights': {
          const auth = await needPage();
          setWorking('קורא נתוני עמוד…');
          const { fetchPageInsights } = await import('../lib/facebookMarketing');
          const ins = await fetchPageInsights(auth.pageId, auth.token);
          say(`${connectedPage?.name ?? 'העמוד'} — 30 הימים האחרונים:`, [{
            type: 'metrics', title: 'ביצועי עמוד', items: [
              { label: 'עוקבים', value: ins.fans.toLocaleString('he-IL'), delta: ins.fansGrowth ? `${ins.fansGrowth > 0 ? '+' : ''}${ins.fansGrowth}` : undefined, tone: ins.fansGrowth > 0 ? 'good' : ins.fansGrowth < 0 ? 'bad' : 'flat' },
              { label: 'חשיפה', value: ins.reach.toLocaleString('he-IL') },
              { label: 'הצגות', value: ins.impressions.toLocaleString('he-IL') },
              { label: 'מעורבות', value: ins.engagement.toLocaleString('he-IL') },
              { label: 'פוסטים', value: String(ins.posts) },
            ],
          }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Last posts, side by side ─────────────────────────────────────── */
        case 'post_performance': {
          const auth = await needPage();
          setWorking('קורא פוסטים…');
          const { fetchPagePosts } = await import('../lib/facebookMarketing');
          const posts = await fetchPagePosts(auth.pageId, auth.token, 8);
          if (!posts.length) { say('אין עדיין פוסטים בעמוד.'); markDone(msgIdx, key); return; }
          const best = [...posts].sort((a, b) => (b.reach || b.likes) - (a.reach || a.likes))[0];
          say(`${posts.length} הפוסטים האחרונים. הכי חזק: "${(best.message || '').slice(0, 60)}…" — ${best.reach.toLocaleString('he-IL')} חשיפה, ${best.likes} לייקים.`, [{
            type: 'bars', title: 'חשיפה לפוסט', unit: '',
            items: posts.map(p => ({ label: (p.message || '(ללא טקסט)').slice(0, 28), value: p.reach || p.likes, hint: `${p.likes}❤ ${p.comments}💬 ${p.shares}↗` })),
          }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Draft replies to new comments, for approval on the page ─────── */
        case 'reply_comments': {
          const wid = needWid();
          const auth = await needPage();
          setWorking('אוסף תגובות…');
          const fb = await import('../lib/facebookMarketing');
          const posts = await fb.fetchPagePosts(auth.pageId, auth.token, 5);
          const comments = (await Promise.all(posts.map(p => fb.fetchPostComments(p.id, auth.token).catch(() => [])))).flat();
          const drafts = await fb.loadCommentDrafts(wid);
          const existing = new Set(drafts.map(d => d.commentId));
          const fresh = comments.filter(c => !existing.has(c.id));
          if (!fresh.length) { say('אין תגובות חדשות שעוד לא טיפלתי בהן.'); markDone(msgIdx, key); return; }
          setWorking(`מנסח ${fresh.length} תגובות…`);
          const config = cfg ?? (await fb.loadMarketingConfig(wid));
          if (!config) { say('אין הגדרות סוכן — הגדר טון ושפה ואז אנסח.'); return; }
          const n = await fb.processCommentsWithAI(wid, fresh, config, bizDescription(), existing);
          say(`ניסחתי ${n} תגובות — ממתינות לאישור שלך לפני שליחה.`, undefined,
            [{ type: 'open_marketing', tab: 'campaigns', label: '💬 אשר תגובות' }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Change how the agent behaves ─────────────────────────────────── */
        case 'update_settings': {
          const wid = needWid();
          if (!act.settings || !Object.keys(act.settings).length) return;
          setWorking('שומר הגדרות…');
          const { loadMarketingConfig, saveMarketingConfig } = await import('../lib/facebookMarketing');
          const current = (await loadMarketingConfig(wid)) ?? ({
            enabled: true, agentName: 'RAY', signature: '', language: 'he',
            businessDescription: workspace?.prompt ?? '', agentInstructions: '', contentPillars: [],
            autoReplyComments: false, replyTone: 'friendly', targetResponseTime: 0, blacklistedWords: '',
            postingGuidelines: '', emojiUsage: 'minimal', ctaStyle: 'direct', hashtagStrategy: 'auto', fixedHashtags: '', maxPostLength: 0,
            autoSchedule: false, postFrequency: '3x-week', bestPostingTimes: ['09:00', '13:00', '19:00'], maxDailyPosts: 1,
            requireApproval: true, sensitiveTopics: '',
          } as MarketingAgentConfig);
          const next = { ...current, ...act.settings };
          await saveMarketingConfig(wid, next);
          await refreshKnowledge();
          const changed = Object.entries(act.settings).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
          onToast?.('✅ ההגדרות נשמרו', 'success');
          say('עודכן ✅ מעכשיו אני עובד ככה:', [{ type: 'checklist', items: changed.map(text => ({ text, done: true })) }]);
          markDone(msgIdx, key);
          break;
        }

        /* ── Teach the agent about the business, permanently ──────────────── */
        case 'save_profile': {
          const wid = needWid();
          if (!act.profile) return;
          setWorking('שומר פרופיל…');
          const { loadProductProfile, saveProductProfile } = await import('../lib/mediaGeneration');
          const existing = await loadProductProfile(wid);
          const merged = { ...existing };
          for (const [k, v] of Object.entries(act.profile)) {
            if (v === undefined || v === null || v === '') continue;
            if (Array.isArray(v) && v.length === 0) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (merged as any)[k] = v;
          }
          merged.lastUpdated = Date.now();
          await saveProductProfile(wid, merged);
          onToast?.('✅ הפרופיל העסקי נשמר', 'success');
          say('שמרתי ✅ מעכשיו כל תוכן ותמונה שאייצר יתבססו על זה — גם באוטופיילוט.');
          markDone(msgIdx, key);
          break;
        }

        case 'ask_materials':
          fileInputRef.current?.click();
          markDone(msgIdx, key);
          return;

        case 'open_marketing':
          try { sessionStorage.setItem('ray:marketing-tab', act.tab || 'campaigns'); } catch { /* private mode */ }
          onNavigate?.('marketing-agent');
          onClose();
          return;
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'no workspace' || msg === 'no page') return;   // already told the user
      console.error('[marketing-action]', err);
      onToast?.(`שגיאה: ${msg}`, 'error');
      say(`⚠️ הפעולה נכשלה: ${msg}`);
    } finally {
      setWorking(null);
    }
  };

  const actionLabel = (a: MktAction) => {
    if (a.label) return a.label;
    switch (a.type) {
      case 'generate_image':        return `🎨 צור את התמונה${imageEngine ? ` (${ENGINE_BY_ID[imageEngine].label})` : ''}`;
      case 'generate_video':        return `🎬 צור סרטון${videoEngine ? ` (${ENGINE_BY_ID[videoEngine].label})` : ''}`;
      case 'publish_post':          return `📤 פרסם ב${a.platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק'} עכשיו`;
      case 'schedule_post':         return `📅 תזמן לעוד ${a.hoursFromNow ?? 24} שעות`;
      case 'create_plan':           return `🚀 בנה תוכנית של ${a.postsCount ?? 6} פוסטים`;
      case 'approve_plan':          return '✅ אשר ותזמן את התוכנית';
      case 'ad_copy':               return `✍️ ${a.count ?? 5} וריאציות ${a.copyType ?? 'headline'}`;
      case 'campaign_brief':        return '📋 כתוב בריף קמפיין';
      case 'build_audience':        return '🎯 בנה קהל יעד';
      case 'analyze_competitor':    return '🔍 נתח את מודעת המתחרה';
      case 'retargeting_idea':      return '🔁 רעיון ריטרגטינג';
      case 'budget_recommendation': return '💰 המלץ על חלוקת תקציב';
      case 'page_insights':         return '📊 נתוני העמוד — 30 יום';
      case 'post_performance':      return '📈 איך הפוסטים האחרונים הצליחו';
      case 'reply_comments':        return '💬 נסח תגובות לתגובות חדשות';
      case 'update_settings':       return '⚙️ עדכן את ההגדרות';
      case 'ask_materials':         return '📎 העלה חומרים ללמידה';
      case 'save_profile':          return '💾 שמור את פרטי העסק';
      case 'open_marketing':        return '↗ פתח את דף השיווק';
    }
  };

  const actionIcon = (t: MktAction['type']) => {
    switch (t) {
      case 'generate_image':
      case 'generate_video':        return <Wand2 size={11} />;
      case 'publish_post':          return <Upload size={11} />;
      case 'schedule_post':         return <Calendar size={11} />;
      case 'create_plan':           return <Rocket size={11} />;
      case 'approve_plan':          return <CheckCircle2 size={11} />;
      case 'ad_copy':               return <FileText size={11} />;
      case 'campaign_brief':        return <BookOpen size={11} />;
      case 'build_audience':        return <Target size={11} />;
      case 'analyze_competitor':    return <Search size={11} />;
      case 'retargeting_idea':      return <RotateCcw size={11} />;
      case 'budget_recommendation': return <Coins size={11} />;
      case 'page_insights':
      case 'post_performance':      return <BarChart2 size={11} />;
      case 'reply_comments':        return <MessageSquare size={11} />;
      case 'update_settings':       return <Settings2 size={11} />;
      case 'ask_materials':         return <Paperclip size={11} />;
      default:                      return <ArrowLeft size={11} />;
    }
  };

  const quick = [
    'איזה ערוץ מביא לי את הלקוחות הכי טובים?',
    'מה חסר לך כדי לשווק אותי טוב?',
    'כתוב לי 5 כותרות למודעה',
    'בנה לי תוכנית קמפיין לשבועיים',
    'איך הפוסטים האחרונים הצליחו?',
  ];

  const send = () => { const t = input.trim(); if (t) { setInput(''); void ask(t); } };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      {...backdropProps} onClick={backdropProps.onClick === undefined ? undefined : onClose}>
      <div dir="rtl" onClick={e => e.stopPropagation()} ref={panelProps.ref}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', height: '92vh', ...panelProps.style }}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); void attachFiles(e.dataTransfer.files); }}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
          {...handleProps}
          style={{ background: 'linear-gradient(135deg,#a21caf,#db2777)', ...handleProps.style }}>
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
              {/* Says what it has learned from. A capability nobody can tell is
                  there is one nobody uses — and "0 חומרים" is the nudge. */}
              <div className="text-fuchsia-100 text-[10px]">
                {materials.length
                  ? `למד מ-${materials.length} חומרים שהעלית · מנתח, יוצר ומפרסם`
                  : 'מנהל השיווק שלך · העלה לי חומרים ואלמד את העסק'}
              </div>
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
          <Chip icon={<Paperclip size={10} />} label={`${materials.length} חומרים`} color={materials.length ? '#7c3aed' : '#94a3b8'} />
          {/* The engine in use, and the switch. Only engines the admin connected
              are offered; an unconnected one would just fail on click. */}
          <EnginePicker kind="image" label="תמונות" current={imageEngine} status={engineStatus} onPick={id => pickEngine('image', id)} />
          <EnginePicker kind="video" label="וידאו" current={videoEngine} status={engineStatus} onPick={id => pickEngine('video', id)} />
          {pendingPlan && <Chip icon={<Rocket size={10} />} label="תוכנית ממתינה לאישור" color="#f59e0b" />}
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
          {/* Images attached to the next message */}
          {pendingImages.length > 0 && (
            <div className="flex gap-1.5 justify-end mb-2 flex-wrap">
              {pendingImages.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.previewUrl} alt={p.name} className="w-12 h-12 rounded-lg object-cover border border-fuchsia-200" />
                  <button onClick={() => setPending(x => x.filter((_, j) => j !== i))}
                    className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-slate-800 text-white text-[9px] flex items-center justify-center">×</button>
                </div>
              ))}
              <span className="text-[10px] text-slate-400 self-center">יצורף להודעה הבאה</span>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 justify-end mb-2">
            {quick.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={busy || Boolean(working)}
                className="text-[10px] px-2 py-1 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 hover:bg-fuchsia-100 disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={voice.toggle}
              title={voice.active ? 'עצור שיחה קולית' : 'דבר עם RAY'}
              aria-pressed={voice.active}
              className="px-3 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
              style={voice.active
                ? { background: '#dc2626', color: '#fff' }
                : { background: 'rgba(0,0,0,0.06)', color: '#475569' }}>
              {voice.speaking ? <Volume2 size={16} />
                : voice.active ? <Square size={15} />
                : <Mic size={16} />}
            </button>
            <button onClick={send} disabled={busy || Boolean(working) || !input.trim()}
              className="px-4 rounded-xl text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#a21caf,#db2777)' }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="בקש קמפיין, קופי, ניתוח, או גרור לכאן מחירון/תמונות כדי שאלמד..."
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-200"
              style={{ maxHeight: 100 }} />
            {/* Upload. What is typed in the box at the moment of upload becomes
                the note attached to the file — "זה המחירון של 2026". */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(working)}
              title="העלה חומרים — מחירון, קטלוג, תמונות, מודעות שעבדו. הסוכן ילמד מהם."
              className="px-3 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
              style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)' }}>
              <Paperclip size={16} />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden"
              accept="image/*,application/pdf,text/*,.md,.csv,video/*"
              onChange={e => void attachFiles(e.target.files)} />
          </div>
          <p className="text-[9px] text-slate-400 mt-1.5 text-right flex items-center gap-1 justify-end">
            <ImageIcon size={9} /> {imageEngine === 'pollinations' || !imageEngine ? 'תמונות נוצרות חינם' : `תמונות ב-${ENGINE_BY_ID[imageEngine].label} (בתשלום לפי שימוש)`} · קבצים שתעלה נשמרים ונלמדים · פרסום דורש אישור שלך בלחיצה
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The engine chip: shows what is in use, opens to the connected alternatives.
 * A native <select> rather than a custom menu — it works with a keyboard, on
 * touch, and inside a draggable window without a positioning library.
 */
function EnginePicker({ kind, label, current, status, onPick }: {
  kind: EngineKind; label: string; current: EngineId | null; status: EngineStatus | null;
  onPick: (id: EngineId) => void;
}) {
  const options = connectedEngines(status, kind);
  const cur = current ? ENGINE_BY_ID[current] : null;
  const color = cur?.color ?? '#94a3b8';
  if (!options.length) {
    return <Chip icon={<Wand2 size={10} />} label={`${label}: לא מחובר`} color="#94a3b8" />;
  }
  return (
    <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer"
      style={{ background: `${color}14`, color, border: `1px solid ${color}30` }}
      title={cur ? `${cur.bestFor}\n${cur.cost}` : ''}>
      <Wand2 size={10} />
      <span>{label}:</span>
      <select
        value={current ?? ''}
        onChange={e => onPick(e.target.value as EngineId)}
        disabled={options.length < 2}
        className="bg-transparent outline-none cursor-pointer font-bold appearance-none pr-0.5"
        style={{ color }}>
        {options.map(e => <option key={e.id} value={e.id} style={{ color: '#111' }}>{e.label}</option>)}
      </select>
      {options.length > 1 && <span style={{ opacity: 0.6 }}>▾</span>}
    </label>
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
