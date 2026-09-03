/**
 * SalesCopilot — a conversational sales partner that lives on the leads screen.
 *
 * Unlike a Q&A bot, this opens with an unprompted briefing ("here's what needs
 * you today"), reasons over the *whole* pipeline, and can act: it proposes
 * concrete moves as one-click cards (create a task, change a status, flag a
 * lead, schedule a follow-up) that are applied through the same safe-action
 * paths the rest of the app uses.
 *
 * Design choices worth knowing:
 *  • The model never sees raw lead objects — it gets a compact, derived summary
 *    (staleness, no-answer streaks, overdue tasks, score) so a large pipeline
 *    still fits in one request and stays cheap.
 *  • Every suggested action must name a real leadId; anything referencing an
 *    unknown lead is dropped rather than shown, so a hallucinated id can never
 *    mutate data.
 *  • Actions are always confirmed by the user — nothing is auto-applied.
 */

import { useState, useRef, useEffect } from 'react';
import {
  X, Send, Loader2, Sparkles, Users, Flame, Clock, AlertTriangle,
  ArrowLeft, Mail, MessageCircle, DollarSign, RotateCcw, Mic, Square, Volume2 } from 'lucide-react';
import type { Lead, TeamMember, StandaloneTask, TaskPriority } from '../types';
import ChatBlockView, { sanitiseBlocks } from './ChatBlocks';
import type { ChatBlock } from './ChatBlocks';
import {
  useChatSession, setMessages, appendMessage, updateSession, setOpen, clearSession,
} from '../lib/chatSessionStore';
import { useDraggableWindow } from '../lib/useDraggableWindow';
import { useVoiceChat } from '../lib/useVoiceChat';

const ACCENT = '#0f766e';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface CopilotAction {
  type:
    | 'create_task' | 'change_status' | 'flag_lead' | 'mark_hot'
    | 'set_followup' | 'open_lead'
    /** Write an outreach message for this lead, right here in the chat. */
    | 'draft_message';
  leadId: string;
  leadName?: string;
  description?: string;
  status?: string;
  color?: string;
  reason?: string;
  days?: number;
  priority?: TaskPriority;
  /** draft_message */
  channel?: 'whatsapp' | 'email' | 'sms';
  angle?: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  blocks?: ChatBlock[];
  actions?: CopilotAction[];
  doneIds?: string[];
  /** A drafted outreach message, with its send links. */
  draft?: { leadId: string; channel: string; text: string; phone?: string; email?: string };
}

interface Props {
  leads: Lead[];
  team?: TeamMember[];
  statuses: string[];
  currentUser: string;
  /** 'oauth' = can read the inbox, 'smtp' = send only, 'none' = not connected. */
  emailMode: 'oauth' | 'smtp' | 'none';
  emailAddress?: string;
  workspaceId?: string;
  /** Google OAuth client id from workspace.emailConfig — needed to connect in-chat. */
  oauthClientId?: string;
  onUpdateLead?: (lead: Lead) => void;
  onCreateTask?: (task: StandaloneTask) => void;
  onLeadClick?: (lead: Lead) => void;
  onNavigate?: (page: string) => void;
  onToast?: ToastFn;
  onClose: () => void;
}

/* ── Derived signals — the same notions the rest of the app uses ──────────── */
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
const daysAgo = (s?: string) => { const t = parseLoose(s); return t ? Math.floor((Date.now() - t) / 86400000) : -1; };

function summarise(leads: Lead[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdueTask = (l: Lead) => (l.tasks ?? []).some(t => !t.completed && parseLoose(t.date) && parseLoose(t.date) < today.getTime());
  return leads.map(l => ({
    id: l.id,
    company: l.company,
    contact: l.contactName,
    status: l.status,
    score: l.aiScore ?? 0,
    budget: l.budget ?? 0,
    source: l.source,
    hot: Boolean(l.isHot),
    flagged: l.flagColor ? (l.flagReason || 'מסומן') : null,
    daysSinceUpdate: daysAgo(l.lastUpdate),
    everContacted: Boolean(l.lastContactDate),
    daysSinceContact: l.lastContactDate ? daysAgo(l.lastContactDate) : -1,
    noAnswer: l.noAnswerCount ?? 0,
    openTasks: (l.tasks ?? []).filter(t => !t.completed).length,
    overdueTask: overdueTask(l),
    followUpOverdue: Boolean(l.nextFollowUpDate && Date.parse(l.nextFollowUpDate) < Date.now()),
    objection: l.objection ?? null,
    lastNote: (l.notes ?? []).slice(-1)[0]?.text?.slice(0, 90) ?? null,
    /** Deterministic close likelihood — the same formula the AI panel uses. */
    closeProb: Math.round(closeProbability(l) * 100),
    expectedValue: Math.round((l.budget ?? 0) * closeProbability(l)),
  }));
}

/**
 * Close probability, mirrored from DashboardAiPanel so the chat and the panel
 * can never quote two different numbers for the same lead. Stage sets the base,
 * the AI score nudges it up, and staleness drags it down.
 */
const STAGE_BASE: Record<string, number> = {
  'חדש': 0.15, 'בתהליך': 0.35, 'הצעה נשלחה': 0.55, 'משא ומתן': 0.7,
  'רימרקטינג': 0.2, 'ממתין': 0.25, 'לקוח פעיל': 1, 'לא רלוונטי': 0,
};
function closeProbability(lead: Lead): number {
  const base = STAGE_BASE[lead.status] ?? 0.25;
  if (base === 0 || base === 1) return base;
  const scoreMod = ((lead.aiScore ?? 0) / 100) * 0.25;
  const stalePenalty = Math.min(Math.max(daysAgo(lead.lastUpdate), 0) / 60, 0.25);
  return Math.max(0.02, Math.min(0.95, base + scoreMod - stalePenalty));
}

/** Pipeline aggregates the model is told never to recompute itself. */
function aggregate(leads: Lead[], statuses: string[]) {
  const open = leads.filter(l => !['לקוח פעיל', 'לא רלוונטי'].includes(l.status));
  const forecast = open.reduce((s, l) => s + (l.budget ?? 0) * closeProbability(l), 0);
  const won = leads.filter(l => l.status === 'לקוח פעיל');
  return {
    openCount: open.length,
    openValue: open.reduce((s, l) => s + (l.budget ?? 0), 0),
    forecast: Math.round(forecast),
    wonCount: won.length,
    wonValue: won.reduce((s, l) => s + (l.budget ?? 0), 0),
    conversionPct: leads.length ? Math.round((won.length / leads.length) * 100) : 0,
    byStatus: statuses.map(s => ({ status: s, count: leads.filter(l => l.status === s).length })),
    bySource: Object.entries(
      leads.reduce<Record<string, { n: number; won: number }>>((acc, l) => {
        const k = (l.source || 'לא ידוע').trim() || 'לא ידוע';
        acc[k] ??= { n: 0, won: 0 };
        acc[k].n++;
        if (l.status === 'לקוח פעיל') acc[k].won++;
        return acc;
      }, {}),
    ).map(([source, v]) => ({ source, leads: v.n, won: v.won, conversion: Math.round((v.won / v.n) * 100) }))
      .sort((a, b) => b.leads - a.leads).slice(0, 8),
  };
}

export default function SalesCopilot({
  leads, team, statuses, currentUser, emailMode: emailModeProp, emailAddress,
  workspaceId, oauthClientId,
  onUpdateLead, onCreateTask, onLeadClick, onNavigate, onToast, onClose,
}: Props) {
  const { backdropProps, panelProps, handleProps } = useDraggableWindow('sales');
  /* The conversation lives in the shared store, not here — so closing the
     window neither loses the history nor kills a request already in flight. */
  const session  = useChatSession<ChatMsg>('sales');
  const msgs     = session.msgs;
  const busy     = session.busy;

  // Speak to RAY here the same way as in the personal assistant: the hook runs
  // listen → send → speak the answer → listen again until it is switched off.
  const askVoice = (t: string) => { void ask(t); };
  const lastReply = [...msgs].reverse().find(m => m.role === 'assistant')?.text;
  const voice = useVoiceChat({
    onSay: t => { setInput(''); void askVoice(t); },
    lastReply,
    busy: busy,
  });
  const setMsgs  = (u: ChatMsg[] | ((p: ChatMsg[]) => ChatMsg[])) => setMessages<ChatMsg>('sales', u);
  const setBusy  = (v: boolean) => updateSession('sales', { busy: v });

  const [input, setInput] = useState('');
  const [drafting, setDrafting] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Mark the window open (clears the badge) and closed again on unmount. */
  useEffect(() => { setOpen('sales', true); return () => setOpen('sales', false); }, []);

  /* ── Mail connection, handled entirely inside the chat ──────────────────── */
  const [mailMode, setMailMode] = useState<'oauth' | 'smtp' | 'none'>(emailModeProp);
  const [mailAddr, setMailAddr] = useState(emailAddress);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => { setMailMode(emailModeProp); }, [emailModeProp]);

  /**
   * Google hands browser clients an access token that expires in ~1h and gives no
   * refresh token, so a saved connection *looks* dropped after a while. On open we
   * silently re-mint a token (no popup — allowed because consent was already
   * granted). The actual refreshing lives in lib/gmailKeepAlive.ts, which also
   * runs app-wide on a timer; this just makes sure it has run before we decide
   * what to show, so opening the chat never reports a stale "not connected".
   */
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    void (async () => {
      const { ensureFreshGmailToken, getKeepAliveState } = await import('../lib/gmailKeepAlive');
      await ensureFreshGmailToken(workspaceId, oauthClientId);
      if (!alive) return;
      const st = getKeepAliveState();
      if (st.ok) { setMailMode('oauth'); setMailAddr(st.email); }
    })();
    return () => { alive = false; };
  }, [workspaceId, oauthClientId]);

  /**
   * Connect a mailbox, or switch to a different one.
   *
   * `switching` forces Google's account chooser and then makes the chosen
   * account the ONLY Gmail account for this workspace. That replacement is the
   * point: with two Gmail accounts stored, every reader picks the first one it
   * finds, so a 'switch' that merely appended would leave the old mailbox
   * silently winning. Outlook accounts are untouched, and the email-agent page
   * still manages several accounts for anyone who wants them.
   */
  const connectMail = async (switching = false) => {
    if (!workspaceId) { onToast?.('אין סביבת עבודה מחוברת', 'error'); return; }
    if (!oauthClientId) {
      onToast?.('חסר Google Client ID — הגדר אותו בדף אינטגרציות', 'error');
      onNavigate?.('integrations'); onClose(); return;
    }
    setConnecting(true);
    try {
      const { requestGmailToken, getGmailAddress, loadAgentConfig, saveAgentConfig } =
        await import('../lib/gmailAgent');
      const token = await requestGmailToken(oauthClientId, undefined, switching);
      const email = await getGmailAddress(token);
      if (!email) throw new Error('לא התקבלה כתובת מייל');

      const cfg = (await loadAgentConfig(workspaceId)) ?? ({ accounts: [] } as never);
      const previous = (cfg.accounts ?? []).filter(a => a.provider === 'gmail').map(a => a.email);
      const id = `gmail:${email}`;
      const account = {
        id, provider: 'gmail' as const, email, displayName: email,
        clientId: oauthClientId, connectedAt: Date.now(),
        cachedToken: token, cachedTokenExpiry: Date.now() + 3_480_000,
      };
      const others = (cfg.accounts ?? []).filter(a =>
        switching ? a.provider !== 'gmail' : a.id !== id);
      await saveAgentConfig(workspaceId, { ...cfg, accounts: [...others, account] });

      setMailMode('oauth'); setMailAddr(email);
      const replaced = previous.filter(e => e && e !== email);
      if (switching && replaced.length) {
        onToast?.(`📥 הוחלף ל-${email}`, 'success');
        appendMessage<ChatMsg>('sales', { role: 'assistant', text: `החלפתי מ-${replaced.join(', ')} ל-${email} ✅ מעכשיו אני קורא את התיבה הזו.` });
      } else {
        onToast?.(`📥 המייל ${email} חובר — הסוכן יכול לקרוא מיילים`, 'success');
      appendMessage<ChatMsg>('sales', { role: 'assistant', text: `מעולה — התחברתי ל-${email} ✅\nעכשיו אני יכול לעבור על תיבת הדואר. בקש ממני "תעבור על המיילים החשובים".` });
      }
    } catch (err) {
      const msg = (err as Error).message;
      onToast?.(msg === 'popup_closed' ? 'החיבור בוטל' : `שגיאה בחיבור: ${msg}`, 'error');
    } finally { setConnecting(false); }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  /* ── Headline stats shown in the chip row ──────────────────────────────── */
  const rows = summarise(leads);
  const agg  = aggregate(leads, statuses);
  const stats = {
    total: leads.length,
    hot: rows.filter(r => r.hot).length,
    overdue: rows.filter(r => r.overdueTask || r.followUpOverdue).length,
    stale: rows.filter(r => r.daysSinceUpdate > 14 && !['לקוח פעיל', 'לא רלוונטי'].includes(r.status)).length,
    untouched: rows.filter(r => !r.everContacted).length,
  };

  const ask = async (userText: string | null) => {
    if (busy) return;
    setBusy(true);
    const history = userText ? [...msgs, { role: 'user' as const, text: userText }] : msgs;
    if (userText) setMsgs(history);

    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const client = getAnthropicProxy();

      // Keep the payload bounded: prioritise the leads that actually need attention.

      const emailLine =
        mailMode === 'oauth' ? `מייל מחובר במלואו (${mailAddr}) — קריאה וכתיבה. אם המשתמש מבקש לעבור על מיילים, הפנה אותו ל"סוכן מכירות AI" ← "בדוק מיילים".`
        : mailMode === 'smtp' ? `מייל מחובר לשליחה בלבד (${mailAddr}) דרך App Password. קריאת תיבת הדואר דורשת חיבור OAuth — אם המשתמש מבקש לעבור על מיילים, אמור לו בקצרה שהוא יכול לחבר קריאת מיילים בלחיצה על הכפתור "חבר קריאת מיילים" כאן בצ'אט. אל תתיימר לקרוא מיילים.`
        : 'לא מחובר מייל. אם המשתמש מבקש מיילים — הפנה אותו לכפתור "חבר קריאת מיילים" כאן בצ\'אט.';

      const system = `אתה "RAY SALES" — שותף מכירות בכיר של המשתמש, לא בוט. אתה מדבר עברית, ישיר, חד ומעשי. אתה לא מנומס יתר על המידה ולא מציף במלל.

## מי אתה
מנהל מכירות מנוסה שמסתכל על הפייפליין של ${currentUser} ואומר לו את האמת: מה בוער, מה מבוזבז, איפה הכסף, ומה לעשות עכשיו. אתה יוזם — מצביע על דברים שהוא לא שאל עליהם אם הם חשובים.

## מצב המייל
${emailLine}

## סטטוסים בסביבה: ${statuses.join(' | ')}
${team?.length ? `## צוות: ${team.map(t => t.name).join(' | ')}` : ''}

## הנתונים — יש לך גישה לכרטיס המלא
תקבל שני חלקים:
1. **כל הלידים** ברשומה קומפקטית — סטטוס, מקור, אחראי, תקציב, ציון, ליד חם, סימון, **פתרונות עם מחירים** (monthlyValue/oneTimeValue), ימים מאז עדכון/פנייה, ללא-מענה, התנגדות, אמצעי פנייה, מעקב הבא (שלילי=באיחור), משימות פתוחות/באיחור, מספר הערות ופעילויות, ההערה והפעילות האחרונות, ושדות מותאמים.
2. **כרטיסים מלאים** לכמה לידים רלוונטיים — **כל ההערות, כל יומן הפעילות, והמשימות**. אם המשתמש מזכיר שם חברה, הכרטיס המלא שלה יצורף אוטומטית.
בנוסף aggregate: תחזית הכנסות, פילוח לפי סטטוס, וביצועי מקורות.

השתמש בזה לעומק: קרא הערות ויומן פעילות כדי להבין מה באמת קרה מול הלקוח, לא רק את המספרים.
**המספרים האלה מחושבים במערכת ונכונים — אל תחשב מחדש ואל תמציא מספרים.**

## תצוגה ויזואלית — השתמש בה!
אתה יכול להחזיר "blocks" שמוצגים כגרפיקה בצ'אט. אל תתאר נתונים במילים כשאפשר להראות אותם:
- {"type":"watchlist","title":"מי דורש מעקב","items":[{"leadId":"<id אמיתי>","name":"שם החברה","why":"למה דווקא הוא","urgency":"high","meta":"12 ימים ללא מגע · ₪8,000"}]}
  ← זה הבלוק החשוב ביותר. כשהמשתמש שואל אחרי מי לעקוב / על מה להתמקד — **תמיד** החזר watchlist. הכרטיסים לחיצים ופותחים את הליד.
- {"type":"bars","title":"מקורות הגעה","unit":" לידים","items":[{"label":"פייסבוק","value":42,"hint":"12% המרה"}]}
- {"type":"metrics","title":"תמונת מצב","items":[{"label":"תחזית","value":"₪84,000","delta":"+12%","tone":"good"}]}  (tone: good|bad|warn|flat)
- {"type":"funnel","steps":[{"label":"חדש","count":40},{"label":"בתהליך","count":18}]}
- {"type":"checklist","title":"התוכנית שלך להיום","items":[{"text":"..."}]}
- {"type":"timeline","title":"...","items":[{"when":"היום","what":"..."}]}
- {"type":"compare","title":"...","a":{"label":"...","points":["..."]},"b":{"label":"...","points":["..."]}}
- {"type":"quote","label":"השורה התחתונה","text":"..."}
מקסימום 3 blocks בתשובה.

## מה אתה יכול לעשות
פעולות קונקרטיות שהמשתמש מאשר בלחיצה. השתמש ב-leadId המדויק מהנתונים.
create_task | change_status | flag_lead | mark_hot | set_followup | open_lead | draft_message

## פורמט התשובה — JSON בלבד, בלי markdown:
{"reply":"התשובה שלך בעברית — קצרה וחדה","blocks":[...],"actions":[{"type":"create_task","leadId":"<id אמיתי>","leadName":"<שם החברה>","description":"מה לעשות","priority":"high"}]}

כללי פעולות:
- create_task: description + priority (high/medium/low)
- change_status: status (מהרשימה למעלה)
- flag_lead: color (#ef4444 אדום | #f59e0b כתום | #eab308 צהוב | #10b981 ירוק) + reason
- set_followup: days (מספר)
- mark_hot / open_lead: רק leadId
- draft_message: channel ("whatsapp"|"email"|"sms") + angle (זווית הפנייה, למשל "התייחסות להתנגדות מחיר") — אני אכתוב את ההודעה בפועל
- אל תציע יותר מ-6 פעולות בתשובה אחת. אם אין פעולה מתבקשת — actions: [].
- לעולם אל תמציא leadId. השתמש רק במה שקיבלת.

## תחומי המומחיות שלך
מעקב אחרי לידים תקועים · דירוג הזדמנויות לפי שווי צפוי · תחזית הכנסות · ניתוח התנגדויות · ניסוח הודעות מכירה · אימון אישי (מה לשפר בביצועים שלך) · ניתוח שיחה שהמשתמש מדביק לצ'אט (סנטימנט, התנגדויות, הצעד הבא).`;

      const convo: { role: 'user' | 'assistant'; content: string }[] = history.map(m => ({
        role: m.role, content: m.text,
      }));
      // Always attach fresh pipeline data to the latest turn.
      // Full card access: every lead in compact form, plus expanded histories
      // for the ones this question is actually about (see lib/leadContext.ts).
      const { buildLeadContext } = await import('../lib/leadContext');
      const ctx = buildLeadContext(leads, userText ?? '', { maxCompact: 400, maxFull: 6 });

      convo.push({
        role: 'user',
        content: `[נתוני הפייפליין — ${leads.length} לידים]\n`
          + `aggregate: ${JSON.stringify(agg)}\n\n`
          + ctx.text
          + (userText
            ? ''
            : '\n\nפתח בתדריך קצר: מה הכי דורש תשומת לב עכשיו, ולמה. חובה לכלול blocks — watchlist של מי לעקוב אחריו + metrics של תמונת המצב. הצע פעולות קונקרטיות.'),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-sonnet-4-6', max_tokens: 2000, system, messages: convo,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
      const p = JSON.parse(a !== -1 && b !== -1 ? cleaned.slice(a, b + 1) : cleaned);

      // Drop any action pointing at a lead that doesn't exist — a hallucinated id
      // must never reach the data layer.
      const known = new Set(leads.map(l => l.id));
      const actions: CopilotAction[] = (p.actions ?? [])
        .filter((x: CopilotAction) => x?.leadId && known.has(x.leadId))
        .slice(0, 6);

      appendMessage<ChatMsg>('sales', {
        role: 'assistant', text: p.reply || '—',
        blocks: sanitiseBlocks(p.blocks), actions, doneIds: [],
      });
    } catch (err) {
      console.error('[copilot]', err);
      appendMessage<ChatMsg>('sales', { role: 'assistant', text: '⚠️ לא הצלחתי לעבד את זה. נסה שוב או נסח אחרת.' });
    } finally {
      setBusy(false);
    }
  };

  // Proactive opening briefing — the copilot speaks first.
  useEffect(() => {
    if (session.booted || session.busy) return;   // already briefed, or still briefing
    updateSession('sales', { booted: true });
    if (leads.length) void ask(null);
    else setMsgs([{ role: 'assistant', text: 'אין עדיין לידים במערכת. ברגע שיהיו — אני אנתח אותם ואגיד לך על מה להתמקד.' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.booted]); // re-brief after "נקה שיחה" resets booted — mount-only deps left the cleared chat empty

  /* ── Apply a suggested action ──────────────────────────────────────────── */
  const runAction = async (act: CopilotAction, msgIdx: number, key: string) => {
    const lead = leads.find(l => l.id === act.leadId);
    if (!lead) { onToast?.('הליד לא נמצא', 'error'); return; }

    switch (act.type) {
      case 'open_lead':
        onLeadClick?.(lead); onClose(); return;

      /* Write the actual outreach message — a second, focused generation. */
      case 'draft_message': {
        if (drafting) return;
        setDrafting(key);
        try {
          const { getAnthropicProxy } = await import('../lib/anthropicClient');
          const channel = act.channel ?? 'whatsapp';
          const limits = { whatsapp: '2-4 שורות', sms: 'עד 2 שורות', email: '4-6 שורות + שורת נושא' };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r: any = await (getAnthropicProxy().messages as any).create({
            model: 'claude-sonnet-4-6', max_tokens: 700,
            system: `אתה כותב הודעות מכירה בעברית עבור ${currentUser}. ההודעה חייבת להישמע כאילו אדם כתב אותה: ישירה, אישית, בלי סופרלטיבים ובלי "אני מקווה שהכל טוב". ${limits[channel]}. סיים ב-CTA אחד ברור. החזר אך ורק את גוף ההודעה — בלי הסברים, בלי מרכאות.`,
            messages: [{
              role: 'user',
              content: `כתוב הודעת ${channel} ל${lead.contactName || lead.company}.\n`
                + `חברה: ${lead.company}\nסטטוס: ${lead.status}\n`
                + (lead.objection ? `התנגדות ידועה: ${lead.objection}\n` : '')
                + (lead.budget ? `תקציב: ₪${lead.budget}\n` : '')
                + `ימים מאז עדכון אחרון: ${daysAgo(lead.lastUpdate)}\n`
                + ((lead.notes ?? []).slice(-1)[0]?.text ? `הערה אחרונה: ${(lead.notes ?? []).slice(-1)[0].text}\n` : '')
                + `זווית הפנייה: ${act.angle || 'חידוש קשר וקידום לשלב הבא'}`,
            }],
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = (r.content?.find((b: any) => b.type === 'text')?.text ?? '').trim();
          if (!text) throw new Error('לא התקבלה הודעה');
          appendMessage<ChatMsg>('sales', {
            role: 'assistant',
            text: `הנה טיוטה ל${lead.contactName || lead.company}:`,
            draft: { leadId: lead.id, channel, text, phone: lead.phone, email: lead.email },
          });
        } catch (err) {
          onToast?.(`שגיאה בניסוח: ${(err as Error).message}`, 'error');
        } finally { setDrafting(null); }
        break;
      }
      case 'create_task': {
        const desc = act.description || `מעקב — ${lead.company}`;
        onCreateTask?.({
          id: `${Date.now()}-copilot`, description: desc,
          date: new Date().toISOString().split('T')[0], time: '09:00',
          priority: act.priority || 'medium', completed: false,
          assignedTo: lead.assignedTo || currentUser, assignedBy: 'RAY SALES',
          createdAt: new Date().toISOString(), leadId: lead.id,
        });
        onToast?.(`✓ נוצרה משימה: ${desc}`, 'success');
        break;
      }
      case 'change_status':
        if (act.status) { onUpdateLead?.({ ...lead, status: act.status, lastUpdate: new Date().toLocaleDateString('he-IL') }); onToast?.(`✓ ${lead.company} → ${act.status}`, 'success'); }
        break;
      case 'flag_lead':
        onUpdateLead?.({ ...lead, flagColor: act.color || '#ef4444', flagReason: act.reason || 'סומן על-ידי Copilot' });
        onToast?.(`✓ ${lead.company} סומן`, 'success');
        break;
      case 'mark_hot':
        onUpdateLead?.({ ...lead, isHot: true });
        onToast?.(`🔥 ${lead.company} סומן כחם`, 'success');
        break;
      case 'set_followup': {
        const d = new Date(); d.setDate(d.getDate() + (act.days || 3));
        onUpdateLead?.({ ...lead, nextFollowUpDate: d.toISOString() });
        onToast?.(`📅 מעקב ל-${lead.company} בעוד ${act.days || 3} ימים`, 'success');
        break;
      }
    }
    setMsgs(m => m.map((mm, i) => i === msgIdx ? { ...mm, doneIds: [...(mm.doneIds ?? []), key] } : mm));
  };

  const actionLabel = (a: CopilotAction) => {
    switch (a.type) {
      case 'create_task':   return `📋 צור משימה: ${a.description ?? ''}`;
      case 'change_status': return `🔄 העבר ל"${a.status}"`;
      case 'flag_lead':     return `🎨 סמן${a.reason ? ` — ${a.reason}` : ''}`;
      case 'mark_hot':      return '🔥 סמן כליד חם';
      case 'set_followup':  return `📅 קבע מעקב בעוד ${a.days ?? 3} ימים`;
      case 'open_lead':     return '↗ פתח את הכרטיס';
      case 'draft_message': return `✍️ נסח הודעת ${a.channel === 'email' ? 'מייל' : a.channel === 'sms' ? 'SMS' : 'וואטסאפ'}${a.angle ? ` — ${a.angle}` : ''}`;
    }
  };

  const quick = [
    'אחרי מי אני צריך לעקוב?',
    'מה התחזית שלי לחודש הקרוב?',
    'אילו לידים בסכנה לאבד?',
    'מי הכי קרוב לסגירה?',
    'מאיפה מגיעים הלקוחות הכי טובים?',
    'מה אני צריך לשפר בביצועים שלי?',
    'תעבור על המיילים החשובים',
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      {...backdropProps} onClick={backdropProps.onClick === undefined ? undefined : onClose}>
      <div dir="rtl" onClick={e => e.stopPropagation()} ref={panelProps.ref}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', height: '92vh', ...panelProps.style }}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
          {...handleProps}
          style={{ background: 'linear-gradient(135deg,#0f766e,#0891b2)', ...handleProps.style }}>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="text-white/80 hover:text-white p-1"><X size={18} /></button>
            <button
              title="נקה שיחה והתחל מחדש"
              onClick={() => { clearSession('sales'); setInput(''); }}
              className="text-white/60 hover:text-white p-1"><RotateCcw size={15} /></button>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-white font-black text-sm">RAY SALES</div>
              <div className="text-cyan-100 text-[10px]">שותף המכירות שלך · מנתח, מציע, ומבצע</div>
            </div>
            <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
          </div>
        </div>

        {/* Pipeline chips */}
        <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0 border-b border-slate-100 bg-slate-50">
          <Chip icon={<Users size={10} />} label={`${stats.total} לידים`} color="#64748b" />
          {stats.hot > 0      && <Chip icon={<Flame size={10} />}         label={`${stats.hot} חמים`}       color="#f97316" />}
          {stats.overdue > 0  && <Chip icon={<AlertTriangle size={10} />} label={`${stats.overdue} באיחור`}  color="#ef4444" />}
          {stats.stale > 0    && <Chip icon={<Clock size={10} />}         label={`${stats.stale} תקועים`}    color="#eab308" />}
          {stats.untouched > 0&& <Chip icon={<Mail size={10} />}          label={`${stats.untouched} ללא מגע`} color="#8b5cf6" />}
          {agg.forecast > 0   && <Chip icon={<DollarSign size={10} />}    label={`תחזית ₪${agg.forecast.toLocaleString('he-IL')}`} color="#10b981" />}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: '#f8fafc' }}>
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-teal-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                {m.text}

                {m.blocks?.map((b, j) => (
                  <ChatBlockView key={j} block={b} accent={ACCENT}
                    onLeadClick={id => {
                      const l = leads.find(x => x.id === id);
                      if (l) { onLeadClick?.(l); onClose(); }
                    }}
                    onCopy={() => onToast?.('הועתק ללוח', 'success')} />
                ))}

                {m.draft && <DraftCard draft={m.draft} onToast={onToast} />}

                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-1.5">
                    {m.actions.map((a, j) => {
                      const key = `${i}-${j}`;
                      const done = m.doneIds?.includes(key);
                      return (
                        <button key={key} disabled={done || drafting === key}
                          onClick={() => void runAction(a, i, key)}
                          className="w-full text-right rounded-xl px-2.5 py-2 text-[11px] font-semibold transition-all disabled:opacity-50"
                          style={done
                            ? { background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }
                            : { background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4' }}>
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="flex-1">
                              {done ? '✓ בוצע' : drafting === key ? 'מנסח...' : actionLabel(a)}
                            </span>
                            {!done && (drafting === key
                              ? <Loader2 size={11} className="animate-spin" />
                              : <ArrowLeft size={11} />)}
                          </div>
                          {a.leadName && <div className="text-[10px] opacity-60 mt-0.5">{a.leadName}</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-end">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-teal-500" />
                <span className="text-xs text-slate-400">מנתח את הפייפליין...</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-4 py-3 flex-shrink-0 border-t border-slate-200 bg-white">
          <div className="flex flex-wrap gap-1.5 justify-end mb-2">
            {quick.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={busy}
                className="text-[10px] px-2 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100 disabled:opacity-40">
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
            <button onClick={() => { const t = input.trim(); if (t) { setInput(''); void ask(t); } }}
              disabled={busy || !input.trim()}
              className="px-4 rounded-xl text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0f766e,#0891b2)' }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = input.trim(); if (t) { setInput(''); void ask(t); } } }}
              placeholder="שאל אותי כל דבר על הלידים שלך..."
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-teal-200"
              style={{ maxHeight: 100 }} />
          </div>
          {mailMode === 'oauth' ? (
            <div className="flex items-center gap-2 justify-end mt-1.5">
              <button onClick={() => void connectMail(true)} disabled={connecting}
                title="התחבר לתיבת דואר אחרת"
                className="text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1 flex-shrink-0">
                {connecting ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                {connecting ? 'מחליף...' : 'החלף חשבון'}
              </button>
              <p className="text-[10px] text-emerald-600 text-right flex-1 truncate">
                📥 מייל מחובר: <strong>{mailAddr}</strong> — נשאר מחובר אוטומטית
              </p>
            </div>
          ) : (
            <button onClick={() => void connectMail(true)} disabled={connecting}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#ea4335,#c5221f)' }}>
              {connecting ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
              {connecting ? 'מתחבר...' : '📥 חבר קריאת מיילים (Gmail)'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A drafted outreach message with its send routes. The copilot never sends on
 * the user's behalf — it opens WhatsApp/mail with the text prefilled, so the
 * last look and the send button stay with the person whose name is on it.
 */
function DraftCard({ draft, onToast }: {
  draft: NonNullable<ChatMsg['draft']>;
  onToast?: ToastFn;
}) {
  const phone = (draft.phone ?? '').replace(/\D/g, '');
  const waPhone = phone.startsWith('0') ? '972' + phone.slice(1) : phone;
  return (
    <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/60 overflow-hidden">
      <div className="px-2.5 py-2 text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed text-right">
        {draft.text}
      </div>
      <div className="px-2 py-1.5 flex gap-1.5 justify-end border-t border-teal-100 bg-white/60">
        <button
          onClick={() => { navigator.clipboard?.writeText(draft.text).catch(() => {}); onToast?.('הועתק ללוח', 'success'); }}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
          העתק
        </button>
        {draft.email && (
          <a href={`mailto:${draft.email}?body=${encodeURIComponent(draft.text)}`}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200">
            פתח במייל
          </a>
        )}
        {waPhone && (
          <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(draft.text)}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 flex items-center gap-1">
            <MessageCircle size={10} />שלח בוואטסאפ
          </a>
        )}
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
