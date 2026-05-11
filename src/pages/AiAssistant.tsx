import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Send, Bot, User, Sparkles, Loader2, AlertCircle,
  Globe, Search, X, Zap,
  Building2, TrendingUp, FileText, MessageSquare,
  Mic, MicOff, CheckCircle2, ListTodo, Tag, StickyNote,
  History, Trash2, Brain, Dna, Copy, ChevronDown, ArrowRight,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, StandaloneTask, TaskPriority, TeamMember, AccountData } from '../types';
import { getApiKey } from '../lib/apiKey';
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, collection, onSnapshot, getDocs, query, orderBy, limit } from 'firebase/firestore';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ToolAction {
  name: string;
  label: string;
  result: string;
  success: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  searches?: string[];
  actions?: ToolAction[];
  timestamp?: string; // ISO string for localStorage serialization
}

interface Session {
  id: string;
  messages: Message[];
  startedAt: string;
  endedAt: string;
  preview: string;      // first user message (up to 120 chars)
  messageCount: number;
}

interface AiAssistantProps {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onAddNote: (leadId: string, noteText: string) => void;
}

/* ─── Tool definitions ───────────────────────────────────────────────────── */
const CRM_TOOLS = [
  {
    name: 'create_task',
    description: 'צור משימה חדשה במערכת ה-CRM. השתמש בכלי זה כשהמשתמש מבקש ליצור, להוסיף או לתזמן משימה.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description:  { type: 'string',  description: 'תיאור המשימה' },
        leadId:       { type: 'string',  description: 'מזהה הליד לשיוך (אופציונלי)' },
        date:         { type: 'string',  description: 'תאריך בפורמט YYYY-MM-DD' },
        time:         { type: 'string',  description: 'שעה בפורמט HH:MM' },
        priority:     { type: 'string',  enum: ['high', 'medium', 'low'], description: 'עדיפות: high=דחוף, medium=בינוני, low=נמוך' },
        assignedTo:   { type: 'string',  description: 'שם האדם שאליו מוקצית המשימה' },
        notes:        { type: 'string',  description: 'הערות נוספות (אופציונלי)' },
      },
      required: ['description', 'date', 'time', 'priority', 'assignedTo'],
    },
  },
  {
    name: 'update_lead_status',
    description: 'עדכן את סטטוס הליד במערכת. השתמש כשהמשתמש רוצה לשנות שלב של ליד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד' },
        status: { type: 'string', enum: ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'] },
      },
      required: ['leadId', 'status'],
    },
  },
  {
    name: 'add_note',
    description: 'הוסף הערה לליד. השתמש כשהמשתמש רוצה לרשום מידע על ליד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד' },
        text:   { type: 'string', description: 'תוכן ההערה' },
      },
      required: ['leadId', 'text'],
    },
  },
  {
    name: 'find_leads',
    description: 'חפש וסנן לידים במערכת. השתמש כשהמשתמש רוצה למצוא לידים לפי שם, סטטוס, תקציב וכו\'.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:     { type: 'string', description: 'מחרוזת חיפוש (שם חברה / איש קשר)' },
        status:    { type: 'string', description: 'סינון לפי סטטוס (אופציונלי)' },
        minBudget: { type: 'number', description: 'תקציב מינימלי בשקלים (אופציונלי)' },
      },
    },
  },
  {
    name: 'get_client_materials',
    description: 'קבל רשימת חומרים, קבצים והצעות מחיר ששמורות ללקוח ספציפי. השתמש כשהמשתמש שואל על קבצים, הדמיות, מסמכים, חוזים, או הצעות מחיר של לקוח.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד' },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'add_to_calendar',
    description: 'פתח אירוע ב-Google Calendar. השתמש כשהמשתמש מבקש להוסיף משימה/פגישה ללוח השנה שלו ב-Google.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:       { type: 'string', description: 'כותרת האירוע' },
        date:        { type: 'string', description: 'תאריך בפורמט YYYY-MM-DD' },
        time:        { type: 'string', description: 'שעה בפורמט HH:MM' },
        description: { type: 'string', description: 'תיאור / פרטי האירוע (אופציונלי)' },
        duration:    { type: 'number', description: 'משך האירוע בדקות (ברירת מחדל: 60)' },
      },
      required: ['title', 'date', 'time'],
    },
  },
];

/* ─── History persistence (localStorage + Firestore) ────────────────────── */
const HISTORY_KEY   = 'ray-ai-history';
const FS_HISTORY_ID = 'ai-history/messages'; // Firestore path: collection/docId
const MAX_HISTORY   = 300; // keep up to 300 messages in current session

function loadLocalHistory(): Message[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch { return []; }
}

function saveLocalHistory(msgs: Message[]) {
  try {
    const toSave = msgs.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded - silently ignore */ }
}

async function loadFirestoreHistory(): Promise<Message[]> {
  try {
    const snap = await getDoc(doc(db, 'ai-history', 'messages'));
    if (!snap.exists()) return [];
    const data = snap.data() as { messages?: Message[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch { return []; }
}

async function saveFirestoreHistory(msgs: Message[]) {
  try {
    const toSave = msgs.slice(-MAX_HISTORY);
    await setDoc(doc(db, 'ai-history', 'messages'), {
      messages: toSave,
      updatedAt: new Date().toISOString(),
    });
  } catch { /* network issue - silently ignore */ }
}

/* ─── Session persistence ─────────────────────────────────────────────────── */
async function saveSessionToFirestore(messages: Message[]): Promise<string | null> {
  if (messages.length < 2) return null; // skip trivial sessions
  const sessionId = Date.now().toString();
  const firstUserMsg = messages.find(m => m.role === 'user');
  const session: Session = {
    id:           sessionId,
    messages:     messages.slice(-MAX_HISTORY),
    startedAt:    messages[0]?.timestamp   ?? new Date().toISOString(),
    endedAt:      messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
    preview:      firstUserMsg?.content.slice(0, 120) ?? '',
    messageCount: messages.length,
  };
  try {
    await setDoc(doc(db, 'ai-sessions', sessionId), session);
    return sessionId;
  } catch { return null; }
}

async function loadSessionsFromFirestore(): Promise<Session[]> {
  try {
    const q    = query(collection(db, 'ai-sessions'), orderBy('startedAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Session);
  } catch { return []; }
}

/* ─── Build system prompt ────────────────────────────────────────────────── */
function buildSystemBlocks(leads: Lead[], currentUser: string, accounts: AccountData[] = []) {
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const staticPart = `אתה עוזר AI חכם ואישי של ${currentUser} במערכת CRM בשם RAY Lead Manager.
היום: ${today}
אתה עונה תמיד בעברית, בצורה מובנית, חכמה וממוקדת.

RAY Digital היא סוכנות שיווק דיגיטלית AI-First המתמחה בנדל"ן.
שירותים: דמיות ויזואליות (Renders), אתר פרימיום, קמפיין פרסום ממומן, ניהול מדיה חברתית, קריאייטיב (UGC/ריל), SEO.

**אתה יכול לבצע פעולות אמיתיות במערכת:**
- ✅ ליצור משימות חדשות (create_task)
- ✅ לעדכן סטטוס לידים (update_lead_status)
- ✅ להוסיף הערות ללידים (add_note)
- ✅ לחפש ולסנן לידים (find_leads)
- 📅 להוסיף אירועים ל-Google Calendar (add_to_calendar)
- 🌐 לחפש מידע עדכני באינטרנט (web_search)

**כשהמשתמש מבקש פעולה — בצע אותה מיד! אל תשאל אם לבצע — בצע ואחר כך דווח.**
**כשאתה לא בטוח במידע (כמו תאריך, שם ליד) — שאל לפני שאתה מבצע.**

סטטוסים אפשריים: חדש | בתהליך | לקוח פעיל | רימרקטינג | לא רלוונטי
עדיפויות: high (דחוף) | medium (בינוני) | low (נמוך)

**פורמט תשובות:**
- כותרות **מודגשות** לנושאים
- רשימות נקודות לפירוטים
- נתונים ספציפיים — תמיד עם מספרים ועובדות
- אחרי ביצוע פעולה — אשר בקצרה מה נעשה`;

  const leadsSummary = leads.slice(0, 80).map(l => {
    const tasksOpen = l.tasks.filter(t => !t.completed).length;
    const solutions = l.solutions.map(s => s.name).join(', ') || 'אין';
    const budget = l.budget > 0 ? `₪${l.budget.toLocaleString()}/חודש` : 'לא ידוע';
    return `[${l.id}] ${l.company} | ${l.contactName} | ${l.status} | תקציב:${budget} | שירותים:${solutions} | ציון:${l.aiScore}% | משימות:${tasksOpen}${l.waitingContent ? ' | ⏳ממתין לתוכן' : ''}`;
  }).join('\n');

  // Build client accounts context (files + proposals)
  const accountsContext = accounts
    .filter(a => (a.files?.length ?? 0) > 0 || (a.proposals?.length ?? 0) > 0)
    .slice(0, 20)
    .map(a => {
      const lead = leads.find(l => l.id === a.leadId);
      if (!lead) return null;
      const filesCtx = (a.files ?? []).map(f =>
        `  📎 [${f.category}] ${f.title}${f.aiContext ? ` — "${f.aiContext}"` : ''}`
      ).join('\n');
      const proposalsCtx = (a.proposals ?? []).map(p => {
        const total = p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * (1 - (p.discount ?? 0) / 100);
        return `  📋 הצעה: "${p.title}" | סטטוס: ${p.status} | סכום: ₪${Math.round(total).toLocaleString()}`;
      }).join('\n');
      return `\n🏢 ${lead.company} (${lead.status}):\n${filesCtx}${proposalsCtx ? '\n' + proposalsCtx : ''}`;
    }).filter(Boolean).join('\n');

  const dynamicPart = `\n**נתוני לידים (${leads.length} סה"כ):**\n${leadsSummary}${accountsContext ? `\n\n**חומרים והצעות מחיר ללקוחות פעילים:**\n${accountsContext}` : ''}`;

  return [
    { type: 'text' as const, text: staticPart, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: dynamicPart },
  ];
}

/* ─── Simple Markdown renderer ───────────────────────────────────────────── */
function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split('\n');
  const result: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      result.push(
        <ul key={key++} className="my-1.5 space-y-0.5 pr-4">
          {listItems.map((item, i) => (
            <li key={i} className="flex gap-2 items-start">
              <span className="text-indigo-400 mt-1 flex-shrink-0">•</span>
              <span>{applyInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); result.push(<div key={key++} className="h-1.5" />); return; }

    if (/^#{1,3} /.test(trimmed)) {
      flushList();
      const text = trimmed.replace(/^#+\s/, '');
      result.push(<div key={key++} className="font-bold text-white text-sm mt-3 mb-1">{text}</div>);
      return;
    }
    if (/^[-•*] /.test(trimmed)) { listItems.push(trimmed.slice(2)); return; }
    const numMatch = trimmed.match(/^(\d+)\.\s(.+)/);
    if (numMatch) { listItems.push(numMatch[2]); return; }

    flushList();
    result.push(<div key={key++} className="leading-relaxed">{applyInline(trimmed)}</div>);
  });

  flushList();
  return result;
}

function applyInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let remaining = text;
  let k = 0;
  while (remaining.length > 0) {
    const boldMatch  = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch  = remaining.match(/`(.+?)`/);
    if (!boldMatch && !codeMatch) { parts.push(<span key={k++}>{remaining}</span>); break; }
    const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : Infinity;
    const codeIdx = codeMatch ? remaining.indexOf(codeMatch[0]) : Infinity;
    if (boldIdx <= codeIdx && boldMatch) {
      if (boldIdx > 0) parts.push(<span key={k++}>{remaining.slice(0, boldIdx)}</span>);
      parts.push(<strong key={k++} className="font-semibold text-white">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldIdx + boldMatch[0].length);
    } else if (codeMatch) {
      if (codeIdx > 0) parts.push(<span key={k++}>{remaining.slice(0, codeIdx)}</span>);
      parts.push(<code key={k++} className="bg-slate-700 px-1.5 py-0.5 rounded text-[11px] font-mono text-indigo-300">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeIdx + codeMatch[0].length);
    } else break;
  }
  return <>{parts}</>;
}

/* ─── Action chip ────────────────────────────────────────────────────────── */
function ActionChip({ action }: { action: ToolAction }) {
  const icons: Record<string, ReactNode> = {
    create_task:         <ListTodo size={10} />,
    update_lead_status:  <Tag size={10} />,
    add_note:            <StickyNote size={10} />,
    find_leads:          <Search size={10} />,
  };
  return (
    <div className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-full border font-medium ${
      action.success
        ? 'bg-emerald-900/40 border-emerald-700/40 text-emerald-300'
        : 'bg-red-900/40 border-red-700/40 text-red-300'
    }`}>
      {action.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
      {icons[action.name]}
      {action.label}
    </div>
  );
}

/* ─── Message Bubble ─────────────────────────────────────────────────────── */
function MessageBubble({ msg, isStreaming }: { msg: Message; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';
  const ts = msg.timestamp ? new Date(msg.timestamp) : null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-indigo-600 to-indigo-800'
          : 'bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600'
      }`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-indigo-400" />}
      </div>

      <div className={`max-w-[82%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Web search badges */}
        {!isUser && msg.searches && msg.searches.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-0.5">
            {msg.searches.map((q, i) => (
              <span key={i} className="flex items-center gap-1 bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 text-[10px] px-2 py-1 rounded-full">
                <Globe size={9} /> {q}
              </span>
            ))}
          </div>
        )}

        {/* Action chips */}
        {!isUser && msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-0.5">
            {msg.actions.map((a, i) => <ActionChip key={i} action={a} />)}
          </div>
        )}

        {/* Bubble */}
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-indigo-600 text-white rounded-tr-sm'
            : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-tl-sm'
        }`}>
          {isUser ? (
            <span>{msg.content}</span>
          ) : (
            <div className="space-y-0.5">
              {renderMarkdown(msg.content)}
              {isStreaming && <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 rounded-sm" />}
            </div>
          )}
        </div>

        {ts && (
          <span className="text-[10px] text-slate-600 px-1">
            {ts.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Searching / Thinking bubble ────────────────────────────────────────── */
function ThinkingBubble({ label }: { label?: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center flex-shrink-0">
        <Bot size={14} className="text-indigo-400" />
      </div>
      <div className="bg-slate-800 border border-indigo-700/40 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        {label
          ? <span className="text-xs text-indigo-300 flex items-center gap-1.5"><Search size={11} />{label}</span>
          : <span className="text-xs text-slate-400">חושב ומעבד...</span>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MIRROR MODE PANEL
═══════════════════════════════════════════════════════════════════════════ */
function MirrorModePanel({ currentUser }: { currentUser: string }) {
  const [styleExample, setStyleExample] = useState('');
  const [savedStyles,  setSavedStyles]  = useState<string[]>([]);
  const [context,      setContext]      = useState('');
  const [generated,    setGenerated]    = useState('');
  const [genLoading,   setGenLoading]   = useState(false);
  const [initLoading,  setInitLoading]  = useState(true);
  const [copied,       setCopied]       = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'mirror-mode', 'styles')).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as { examples?: string[] };
        setSavedStyles(data.examples ?? []);
      }
    }).finally(() => setInitLoading(false));
  }, []);

  async function saveStyle() {
    if (!styleExample.trim()) return;
    const updated = [...savedStyles, styleExample.trim()].slice(-5);
    setSavedStyles(updated);
    setStyleExample('');
    await setDoc(doc(db, 'mirror-mode', 'styles'), { examples: updated, updatedAt: new Date().toISOString() });
  }

  async function deleteStyle(i: number) {
    const updated = savedStyles.filter((_, idx) => idx !== i);
    setSavedStyles(updated);
    await setDoc(doc(db, 'mirror-mode', 'styles'), { examples: updated, updatedAt: new Date().toISOString() });
  }

  async function generateMessage() {
    if (!context.trim() || savedStyles.length === 0) return;
    const apiKey = getApiKey();
    if (!apiKey) return;
    setGenLoading(true);
    setGenerated('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await (client.messages as any).create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `אתה מומחה Ghostwriting. המשתמש שמך הוא ${currentUser}.\n\nהנה דוגמאות לסגנון הכתיבה שלו:\n${savedStyles.map((s, i) => `דוגמה ${i + 1}:\n${s}`).join('\n\n')}\n\nכעת כתוב הודעה בדיוק בסגנון זה על הנושא הבא:\n"${context}"\n\nחשוב: כתוב רק את ההודעה עצמה, ללא הסברים. שמור על הסגנון, הטון, האורך ואפילו שגיאות כתיב אם קיימות.`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = response.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setGenerated(text);
    } catch { setGenerated('שגיאה ביצירת הודעה. נסה שנית.'); }
    finally { setGenLoading(false); }
  }

  function copyGenerated() {
    navigator.clipboard.writeText(generated).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-500/30">
          <Brain size={24} className="text-white" />
        </div>
        <h2 className="text-white font-bold text-lg">Mirror Mode</h2>
        <p className="text-slate-400 text-sm mt-1">AI שלומד את סגנון הכתיבה שלך ומייצר הודעות בדיוק כמוך</p>
      </div>

      {/* Saved examples */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <Sparkles size={13} className="text-violet-400" /> הסגנון שלי ({savedStyles.length}/5 דוגמאות)
        </h3>
        {initLoading ? (
          <div className="text-center py-4"><Loader2 size={18} className="animate-spin text-slate-500 mx-auto" /></div>
        ) : savedStyles.length === 0 ? (
          <p className="text-slate-500 text-xs text-center py-2">הוסף דוגמאות כתיבה שלך — ווטסאפ, מייל, פוסטים — כדי ש-AI ילמד את הסגנון</p>
        ) : (
          <div className="space-y-2">
            {savedStyles.map((s, i) => (
              <div key={i} className="flex items-start gap-2 bg-slate-700/40 border border-slate-600/50 rounded-xl p-3 group">
                <button onClick={() => deleteStyle(i)} className="flex-shrink-0 w-5 h-5 rounded-md bg-red-900/50 hover:bg-red-700/60 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                  <X size={10} />
                </button>
                <p className="text-slate-300 text-xs leading-relaxed flex-1 text-right">{s.slice(0, 120)}{s.length > 120 ? '...' : ''}</p>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 pt-1">
          <textarea
            value={styleExample}
            onChange={e => setStyleExample(e.target.value)}
            placeholder="הדבק כאן הודעה שכתבת (ווטסאפ, מייל, תגובה) — ה-AI ילמד את הסגנון שלך..."
            rows={3}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/60 resize-none text-right"
          />
          <button
            onClick={saveStyle}
            disabled={!styleExample.trim() || savedStyles.length >= 5}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
          >
            {savedStyles.length >= 5 ? 'מקסימום 5 דוגמאות — מחק ישנות כדי להוסיף' : '+ שמור דוגמה'}
          </button>
        </div>
      </div>

      {/* Generator */}
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <h3 className="text-white font-bold text-sm flex items-center gap-2"><Zap size={13} className="text-indigo-400" /> צור הודעה בסגנון שלך</h3>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="מה אתה רוצה לכתוב? (למשל: הודעת מעקב ללקוח שלא ענה, פוסט על שירות חדש, הצעת מחיר...)"
          rows={3}
          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 resize-none text-right"
        />
        <button
          onClick={generateMessage}
          disabled={genLoading || !context.trim() || savedStyles.length === 0}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {genLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
          {genLoading ? 'מייצר בסגנון שלך...' : savedStyles.length === 0 ? 'הוסף דוגמאות תחילה' : 'צור הודעה'}
        </button>
        {generated && (
          <div className="bg-slate-900 border border-indigo-700/40 rounded-xl p-4 space-y-3">
            <p className="text-slate-200 text-sm leading-relaxed text-right whitespace-pre-wrap">{generated}</p>
            <div className="flex gap-2 justify-start">
              <button onClick={copyGenerated} className="flex items-center gap-1.5 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                <Copy size={11} /> {copied ? 'הועתק ✓' : 'העתק'}
              </button>
              <button onClick={() => { setGenerated(''); setContext(''); }} className="text-xs text-slate-500 px-2 py-1.5 rounded-lg hover:bg-slate-700 transition-colors">נקה</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DNA MATCH PANEL
═══════════════════════════════════════════════════════════════════════════ */
function DnaMatchPanel({ leads }: { leads: Lead[] }) {
  const [matching, setMatching] = useState(false);
  const [results,  setResults]  = useState<{ leadId: string; score: number; reasons: string }[]>([]);
  const [errMsg,   setErrMsg]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const wonLeads    = leads.filter(l => l.status === 'לקוח פעיל');
  const targetLeads = leads.filter(l => l.status === 'חדש' || l.status === 'בתהליך');

  async function runDnaMatch() {
    const apiKey = getApiKey();
    if (!apiKey) return;
    setMatching(true);
    setErrMsg(null);
    setResults([]);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const wonSummary    = wonLeads.map(l => `[${l.id}] ${l.company} | מקור:${l.source} | תקציב:₪${l.budget} | שירותים:${l.solutions.map(s => s.name).join(',') || 'אין'} | ציון:${l.aiScore}`).join('\n');
      const targetSummary = targetLeads.map(l => `[${l.id}] ${l.company} | ${l.contactName} | מקור:${l.source} | תקציב:₪${l.budget} | שירותים:${l.solutions.map(s => s.name).join(',') || 'אין'} | ציון:${l.aiScore} | סטטוס:${l.status}`).join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await (client.messages as any).create({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `אתה מנהל CRM מומחה. נתח לידים ובצע DNA Match.\n\nלקוחות פעילים (DNA מוצלח):\n${wonSummary}\n\nלידים לניתוח:\n${targetSummary}\n\nעבור כל ליד, תן ציון דמיון (0-100) ומשפט קצר בעברית.\nענה רק בפורמט JSON:\n[{"leadId":"xxx","score":85,"reasons":"דומה ל-[חברה] - אותו מקור ותקציב דומה"}]\nללא הסברים נוספים.`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = response.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { leadId: string; score: number; reasons: string }[];
        setResults(parsed.sort((a, b) => b.score - a.score));
      } else {
        setErrMsg('לא הצלחתי לנתח. נסה שנית.');
      }
    } catch { setErrMsg('שגיאה בניתוח DNA. נסה שנית.'); }
    finally { setMatching(false); }
  }

  const scoreColor = (s: number) => s >= 75 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-red-400';
  const scoreBar   = (s: number) => s >= 75 ? 'bg-emerald-500' : s >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const scoreLabel = (s: number) => s >= 75 ? 'פוטנציאל גבוה' : s >= 50 ? 'פוטנציאל בינוני' : 'פוטנציאל נמוך';

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/30">
          <Dna size={24} className="text-white" />
        </div>
        <h2 className="text-white font-bold text-lg">DNA Match</h2>
        <p className="text-slate-400 text-sm mt-1">AI מנתח את הלידים שלך ומוצא מי הכי דומה ללקוחות שנסגרו בהצלחה</p>
      </div>

      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-emerald-400 font-semibold">{wonLeads.length} לקוחות פעילים כ-DNA בסיס</span>
          <span className="text-slate-400">{targetLeads.length} לידים לניתוח</span>
        </div>
        {wonLeads.length === 0 ? (
          <div className="text-center py-3">
            <p className="text-slate-400 text-sm">אין לקוחות פעילים עדיין.</p>
            <p className="text-slate-500 text-xs mt-1">DNA Match מתחיל לעבוד לאחר שיש לך לקוח פעיל אחד לפחות.</p>
          </div>
        ) : (
          <button
            onClick={runDnaMatch}
            disabled={matching || targetLeads.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {matching ? <Loader2 size={14} className="animate-spin" /> : <Dna size={14} />}
            {matching ? 'מנתח DNA...' : targetLeads.length === 0 ? 'אין לידים לניתוח' : 'הפעל DNA Match'}
          </button>
        )}
        {errMsg && <p className="text-red-400 text-xs text-center">{errMsg}</p>}
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-slate-400 text-xs font-semibold px-1">תוצאות — מדורג מגבוה לנמוך</p>
          {results.map(r => {
            const lead = leads.find(l => l.id === r.leadId);
            if (!lead) return null;
            const isOpen = expanded === r.leadId;
            return (
              <div key={r.leadId} className="bg-slate-800 border border-slate-700/60 rounded-2xl overflow-hidden">
                <button onClick={() => setExpanded(isOpen ? null : r.leadId)} className="w-full text-right p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold px-2 py-0.5 rounded-full bg-slate-700 ${scoreColor(r.score)}`}>{scoreLabel(r.score)}</span>
                      <span className={`text-xl font-black ${scoreColor(r.score)}`}>{r.score}%</span>
                      <ChevronDown size={14} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{lead.company}</p>
                      <p className="text-xs text-slate-500">{lead.contactName} · {lead.status}</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full">
                    <div className={`h-1.5 rounded-full ${scoreBar(r.score)} transition-all duration-500`} style={{ width: `${r.score}%` }} />
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-0 border-t border-slate-700/50">
                    <p className="text-slate-300 text-xs leading-relaxed text-right mt-3">{r.reasons}</p>
                    <div className="mt-2 flex gap-2 flex-wrap justify-end">
                      <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">תקציב: ₪{lead.budget.toLocaleString()}</span>
                      <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">מקור: {lead.source}</span>
                      <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">ציון AI: {lead.aiScore}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY PANEL
═══════════════════════════════════════════════════════════════════════════ */
function HistoryPanel({
  sessions,
  currentMessages,
  onClose,
  loading: sessionsLoading,
}: {
  sessions: Session[];
  currentMessages: Message[];
  onClose: () => void;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<Session | null>(null);

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return iso; }
  };
  const fmtTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  /* ── Session detail view ── */
  if (selected) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 flex-shrink-0">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowRight size={14} /> חזור לרשימה
          </button>
          <div className="text-right">
            <p className="text-white font-bold text-sm">{fmtDate(selected.startedAt)}</p>
            <p className="text-slate-500 text-xs">{selected.messageCount} הודעות · {fmtTime(selected.startedAt)}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {selected.messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
        </div>
      </div>
    );
  }

  /* ── Session list view ── */
  const hasCurrent = currentMessages.length >= 2;
  const currentAsSession: Session | null = hasCurrent ? {
    id:           'current',
    messages:     currentMessages,
    startedAt:    currentMessages[0]?.timestamp   ?? new Date().toISOString(),
    endedAt:      currentMessages[currentMessages.length - 1]?.timestamp ?? new Date().toISOString(),
    preview:      currentMessages.find(m => m.role === 'user')?.content.slice(0, 120) ?? '',
    messageCount: currentMessages.length,
  } : null;

  const isEmpty = !hasCurrent && sessions.length === 0 && !sessionsLoading;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowRight size={14} /> חזור לשיחה
        </button>
        <div className="flex items-center gap-2">
          <History size={14} className="text-indigo-400" />
          <span className="text-white font-bold text-sm">היסטוריית שיחות</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Current session */}
        {currentAsSession && (
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1 mb-2">שיחה נוכחית</p>
            <button
              onClick={() => setSelected(currentAsSession)}
              className="w-full text-right bg-slate-800 hover:bg-slate-700 border border-indigo-600/40 rounded-2xl p-4 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[10px] text-indigo-400 bg-indigo-900/40 border border-indigo-700/40 px-2 py-0.5 rounded-full flex-shrink-0">
                  {currentAsSession.messageCount} הודעות
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium leading-snug line-clamp-2">{currentAsSession.preview || 'שיחה נוכחית'}</p>
                  <p className="text-slate-500 text-xs mt-1">{fmtTime(currentAsSession.startedAt)}</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Past sessions */}
        {sessionsLoading ? (
          <div className="text-center py-8">
            <Loader2 size={20} className="animate-spin text-slate-500 mx-auto" />
            <p className="text-slate-500 text-xs mt-2">טוען היסטוריה...</p>
          </div>
        ) : isEmpty ? (
          <div className="text-center py-16">
            <History size={36} className="text-slate-700 mx-auto mb-4" />
            <p className="text-slate-500 text-sm font-medium">אין היסטוריית שיחות עדיין</p>
            <p className="text-slate-600 text-xs mt-1.5 leading-relaxed">
              כל שיחה תישמר אוטומטית<br />כאשר תלחץ על כפתור "נקה"
            </p>
          </div>
        ) : (
          <>
            {sessions.length > 0 && (
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1 pt-2">שיחות קודמות ({sessions.length})</p>
            )}
            {sessions.map(session => (
              <button
                key={session.id}
                onClick={() => setSelected(session)}
                className="w-full text-right bg-slate-800 hover:bg-slate-700 border border-slate-700/50 hover:border-slate-600/50 rounded-2xl p-4 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] text-slate-500 bg-slate-700/60 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
                    {session.messageCount} הודעות
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium leading-snug line-clamp-2">{session.preview || 'שיחה'}</p>
                    <p className="text-slate-500 text-xs mt-1">{fmtDate(session.startedAt)} · {fmtTime(session.startedAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function AiAssistant({
  leads, team, currentUser, standaloneTask: _standaloneTask,
  onCreateTask, onUpdateLead, onAddNote,
}: AiAssistantProps) {

  const [messages,          setMessages]          = useState<Message[]>(loadLocalHistory);
  const [input,             setInput]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [streamingText,     setStreamingText]     = useState('');
  const [searchLabel,       setSearchLabel]       = useState<string | undefined>();
  const [webSearchEnabled,  setWebSearchEnabled]  = useState(true);
  const [currentSearches,   setCurrentSearches]   = useState<string[]>([]);
  const [voiceRecording,    setVoiceRecording]    = useState(false);
  const [showHistory,       setShowHistory]       = useState(false);
  const [activeView,        setActiveView]        = useState<'chat' | 'mirror' | 'dna'>('chat');
  const [accounts,          setAccounts]          = useState<AccountData[]>([]);
  const [sessions,          setSessions]          = useState<Session[]>([]);
  const [sessionsLoading,   setSessionsLoading]   = useState(false);
  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const voiceRecogRef   = useRef<unknown>(null);
  const fsSaveTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from Firestore on mount (overrides localStorage if Firestore has more recent data)
  useEffect(() => {
    loadFirestoreHistory().then(fsMsgs => {
      if (fsMsgs.length > 0) {
        setMessages(fsMsgs);
        saveLocalHistory(fsMsgs); // sync local cache
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load session history from Firestore on mount
  useEffect(() => {
    setSessionsLoading(true);
    loadSessionsFromFirestore()
      .then(s => setSessions(s))
      .finally(() => setSessionsLoading(false));
  }, []);

  // Load accounts (files, proposals) for AI context
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'accounts'), snap => {
      setAccounts(snap.docs.map(d => d.data() as AccountData));
    });
    return () => unsub();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, searchLabel]);

  // Persist history to localStorage immediately + Firestore with 2s debounce
  useEffect(() => {
    if (messages.length === 0) return;
    saveLocalHistory(messages);
    if (fsSaveTimer.current) clearTimeout(fsSaveTimer.current);
    fsSaveTimer.current = setTimeout(() => {
      saveFirestoreHistory(messages);
    }, 2000);
  }, [messages]);

  /* ── Execute CRM tool ─────────────────────────────────────────────────── */
  const executeCRMTool = useCallback((
    name: string,
    input: Record<string, unknown>,
  ): { text: string; label: string; success: boolean } => {
    try {
      if (name === 'create_task') {
        const today = new Date().toISOString().split('T')[0];
        // Build task without any undefined fields — Firestore rejects undefined values
        const task: StandaloneTask = {
          id:          Date.now().toString(),
          description: String(input.description ?? ''),
          date:        String(input.date ?? today),
          time:        String(input.time ?? '09:00'),
          priority:    (input.priority as TaskPriority) ?? 'medium',
          completed:   false,
          assignedTo:  String(input.assignedTo ?? currentUser),
          assignedBy:  currentUser,
          createdAt:   new Date().toISOString(),
          // Conditionally include optional fields only when they have values
          ...(input.notes   ? { notes:  String(input.notes)  } : {}),
          ...(input.leadId  ? { leadId: String(input.leadId) } : {}),
        };
        onCreateTask(task);
        const assigneeName = task.assignedTo === currentUser ? 'אני' : task.assignedTo;
        return {
          text:    `✅ משימה נוצרה: "${task.description}" ל${assigneeName} ב-${task.date} שעה ${task.time}`,
          label:   `משימה נוצרה`,
          success: true,
        };
      }

      if (name === 'update_lead_status') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        const updated = { ...lead, status: input.status as Lead['status'], lastUpdate: new Date().toLocaleDateString('he-IL') };
        onUpdateLead(updated);
        return {
          text:    `✅ סטטוס "${lead.company}" עודכן ל"${input.status}"`,
          label:   `${lead.company} → ${input.status}`,
          success: true,
        };
      }

      if (name === 'add_note') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        onAddNote(String(input.leadId), String(input.text ?? ''));
        return {
          text:    `✅ הערה נוספה לליד "${lead.company}"`,
          label:   `הערה: ${lead.company}`,
          success: true,
        };
      }

      if (name === 'find_leads') {
        const q      = (String(input.query ?? '')).toLowerCase();
        const status = input.status ? String(input.status) : undefined;
        const minBudget = input.minBudget ? Number(input.minBudget) : undefined;
        const found  = leads.filter(l => {
          const matchQ = !q || l.company.toLowerCase().includes(q) || l.contactName.toLowerCase().includes(q);
          const matchS = !status || l.status === status;
          const matchB = minBudget === undefined || l.budget >= minBudget;
          return matchQ && matchS && matchB;
        });
        const summary = found.slice(0, 15).map(l =>
          `[${l.id}] ${l.company} | ${l.contactName} | ${l.status} | ₪${l.budget.toLocaleString()}/חודש | ציון:${l.aiScore}%`
        ).join('\n');
        return {
          text:    `נמצאו ${found.length} לידים:\n${summary}`,
          label:   `${found.length} לידים נמצאו`,
          success: true,
        };
      }

      if (name === 'add_to_calendar') {
        try {
          const title    = String(input.title ?? '');
          const date     = String(input.date  ?? new Date().toISOString().split('T')[0]);
          const time     = String(input.time  ?? '09:00');
          const details  = input.description ? String(input.description) : '';
          const duration = input.duration ? Number(input.duration) : 60;

          const [year, month, day] = date.split('-').map(Number);
          const [hour, min]        = time.split(':').map(Number);
          const pad = (n: number) => String(n).padStart(2, '0');
          const startStr = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(min)}00`;
          const endDate  = new Date(year, month - 1, day, hour, min + duration);
          const endStr   = `${endDate.getFullYear()}${pad(endDate.getMonth()+1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
          const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(details)}`;

          window.open(url, '_blank', 'noopener,noreferrer');
          return {
            text:    `✅ Google Calendar נפתח עם האירוע "${title}" ב-${date} שעה ${time}`,
            label:   `📅 נוסף ללוח שנה`,
            success: true,
          };
        } catch (e) {
          return { text: `❌ שגיאה: ${e instanceof Error ? e.message : 'Unknown'}`, label: 'שגיאה', success: false };
        }
      }

      if (name === 'get_client_materials') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        const account = accounts.find(a => a.leadId === String(input.leadId));
        if (!account) return { text: `ללקוח "${lead.company}" אין חומרים שמורים עדיין.`, label: 'אין חומרים', success: true };
        const files = account.files ?? [];
        const proposals = account.proposals ?? [];
        const fileList = files.map(f => `📎 ${f.title} (${f.category})${f.aiContext ? `: ${f.aiContext}` : ''}${f.url ? ` — ${f.url}` : ''}`).join('\n') || 'אין קבצים';
        const proposalList = proposals.map(p => {
          const total = p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * (1 - (p.discount ?? 0) / 100);
          const items = p.items.map(i => `  • ${i.name}: ${i.quantity}×₪${i.unitPrice}`).join('\n');
          return `📋 "${p.title}" | ${p.status} | ₪${Math.round(total).toLocaleString()}\n${items}`;
        }).join('\n\n') || 'אין הצעות מחיר';
        return {
          text: `חומרי לקוח "${lead.company}":\n\n**קבצים (${files.length}):**\n${fileList}\n\n**הצעות מחיר (${proposals.length}):**\n${proposalList}`,
          label: `חומרי ${lead.company}`,
          success: true,
        };
      }

      return { text: `❓ כלי לא מוכר: ${name}`, label: 'שגיאה', success: false };
    } catch (e) {
      return { text: `❌ שגיאה: ${e instanceof Error ? e.message : 'Unknown'}`, label: 'שגיאה', success: false };
    }
  }, [leads, accounts, currentUser, onCreateTask, onUpdateLead, onAddNote]);

  /* ── Retry helper ────────────────────────────────────────────────────── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retryWithBackoff = async <T,>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        const isOverloaded =
          (err instanceof Error && (err.message.includes('overloaded') || err.message.includes('529'))) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((err as any)?.status === 529);

        if (isOverloaded && attempt < maxRetries) {
          const delay = (attempt + 1) * 8000; // 8s, 16s, 24s
          setSearchLabel(`שרתי AI עמוסים — מנסה שנית בעוד ${delay / 1000} שניות...`);
          await new Promise(r => setTimeout(r, delay));
          setSearchLabel(undefined);
          continue;
        }
        throw err;
      }
    }
    throw new Error('מספר הניסיונות המרבי חוּצה');
  };

  /* ── Full agentic loop ────────────────────────────────────────────────── */
  const runAgentLoop = useCallback(async (
    client: Anthropic,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msgs: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemBlocks: any[],
  ): Promise<{ text: string; searches: string[]; actions: ToolAction[] }> => {
    const allSearches: string[] = [];
    const allActions:  ToolAction[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [
      ...(webSearchEnabled ? [{ type: 'web_search_20250305', name: 'web_search' }] : []),
      ...CRM_TOOLS,
    ];

    for (let turn = 0; turn < 8; turn++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await retryWithBackoff(() => (client.messages as any).create({
        model:      'claude-opus-4-6',
        max_tokens: 4096,
        system:     systemBlocks,
        messages:   msgs,
        tools,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = response.content || [];

      // Text parts
      const textParts = content
        .filter(b => b.type === 'text')
        .map(b => b.text as string)
        .join('');

      // Tool uses
      const toolUses = content.filter(b => b.type === 'tool_use') as
        { id: string; name: string; input: Record<string, unknown> }[];

      // Tool results already provided by Anthropic (hosted tools like web_search)
      const existingResults = content.filter(b => b.type === 'tool_result');

      if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
        return { text: textParts, searches: allSearches, actions: allActions };
      }

      // Track web searches
      for (const tu of toolUses) {
        if (tu.name === 'web_search') {
          const q = (tu.input?.query as string) || '';
          if (q) { allSearches.push(q); setCurrentSearches(prev => [...prev, q]); setSearchLabel(`מחפש: ${q}`); }
        }
      }

      // Execute CRM tools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const crmResults: any[] = [];
      for (const tu of toolUses) {
        if (tu.name !== 'web_search') {
          setSearchLabel(`מבצע: ${tu.name}...`);
          const r = executeCRMTool(tu.name, tu.input);
          allActions.push({ name: tu.name, label: r.label, result: r.text, success: r.success });
          crmResults.push({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     [{ type: 'text', text: r.text }],
          });
        }
      }

      // Build combined tool results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let toolResultsMsg: any[];
      if (existingResults.length > 0) {
        // Anthropic provided results for hosted tools; add our CRM results too
        toolResultsMsg = [...existingResults, ...crmResults];
      } else {
        // Provide placeholder for web_search + our CRM results
        const webPlaceholders = toolUses
          .filter(tu => tu.name === 'web_search')
          .map(tu => ({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     [{ type: 'text', text: 'Search results provided by Anthropic.' }],
          }));
        toolResultsMsg = [...webPlaceholders, ...crmResults];
      }

      msgs = [
        ...msgs,
        { role: 'assistant', content: content.filter(b => ['text', 'tool_use'].includes(b.type)) },
        { role: 'user',      content: toolResultsMsg },
      ];
    }

    return { text: 'לא הצלחתי לקבל תשובה סופית. נסה שנית.', searches: allSearches, actions: allActions };
  }, [webSearchEnabled, executeCRMTool]);

  /* ── Voice input ──────────────────────────────────────────────────────── */
  const toggleVoice = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('הדפדפן שלך אינו תומך בהקלטה קולית'); return; }
    if (voiceRecording) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (voiceRecogRef.current as any)?.stop();
      setVoiceRecording(false);
      return;
    }
    const recog = new SR();
    recog.lang = 'he-IL';
    recog.continuous = false;
    recog.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recog.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript;
      setInput(prev => prev ? prev + ' ' + text : text);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    recog.onend  = () => setVoiceRecording(false);
    recog.onerror = () => setVoiceRecording(false);
    recog.start();
    voiceRecogRef.current = recog;
    setVoiceRecording(true);
  };

  /* ── Send message ─────────────────────────────────────────────────────── */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('מפתח API חסר. הגדר VITE_ANTHROPIC_API_KEY בקובץ .env ואתחל מחדש.');
      return;
    }
    setError(null);
    setInput('');
    setCurrentSearches([]);
    setSearchLabel(undefined);

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const updatedMsgs = [...messages, userMsg];
    setMessages(updatedMsgs);
    setLoading(true);
    setStreamingText('');

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const systemBlocks = buildSystemBlocks(leads, currentUser, accounts);

    // Build API messages (only role + content for API)
    const apiMessages = updatedMsgs.map(m => ({ role: m.role, content: m.content }));

    try {
      const { text: result, searches, actions } = await runAgentLoop(client, apiMessages, systemBlocks);

      const assistantMsg: Message = {
        role:      'assistant',
        content:   result,
        searches,
        actions:   actions.length > 0 ? actions : undefined,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.status;

      if (raw.includes('credit balance') || raw.includes('billing') || raw.includes('upgrade or purchase')) {
        setError('💳 יתרת הקרדיט ב-Anthropic נגמרה. יש להוסיף קרדיט בכתובת: console.anthropic.com → Plans & Billing');
      } else if (status === 529 || raw.includes('overloaded') || raw.includes('529')) {
        setError('שרתי ה-AI עמוסים כרגע 😓 ניסינו מספר פעמים ולא הצלחנו. נסה שנית בעוד כמה דקות.');
      } else if (status === 401 || raw.includes('authentication') || raw.includes('API key')) {
        setError('מפתח API לא תקין. בדוק את הגדרות VITE_ANTHROPIC_API_KEY.');
      } else if (status === 429 || raw.includes('rate_limit')) {
        setError('חרגת ממכסת הבקשות ל-API. המתן מספר שניות ונסה שנית.');
      } else if (webSearchEnabled && raw.includes('web_search')) {
        setError('חיפוש אינטרנט אינו זמין כרגע. כבה אותו ונסה שנית.');
        setWebSearchEnabled(false);
      } else {
        setError(`שגיאה בתקשורת עם ה-AI: ${raw.slice(0, 120)}`);
      }
    } finally {
      setLoading(false);
      setSearchLabel(undefined);
      setStreamingText('');
    }
  };

  const handleKeyDown = (e: { key: string; preventDefault: () => void; shiftKey: boolean }) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = async () => {
    // Save current conversation as a session before clearing
    if (messages.length >= 2) {
      const sessionId = await saveSessionToFirestore(messages);
      if (sessionId) {
        const newSession: Session = {
          id:           sessionId,
          messages,
          startedAt:    messages[0]?.timestamp   ?? new Date().toISOString(),
          endedAt:      messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
          preview:      messages.find(m => m.role === 'user')?.content.slice(0, 120) ?? '',
          messageCount: messages.length,
        };
        setSessions(prev => [newSession, ...prev].slice(0, 50));
      }
    }
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
    if (fsSaveTimer.current) clearTimeout(fsSaveTimer.current);
    setDoc(doc(db, 'ai-history', 'messages'), { messages: [], updatedAt: new Date().toISOString() }).catch(() => {});
    setError(null);
    setStreamingText('');
    setSearchLabel(undefined);
    setCurrentSearches([]);
    setShowHistory(false);
  };

  /* ── Suggestion chips ─────────────────────────────────────────────────── */
  const hotLeads = leads.filter(l => l.status === 'חדש' || l.status === 'בתהליך').length;
  const openTasks = leads.flatMap(l => l.tasks.filter(t => !t.completed)).length;

  const suggestions = [
    { icon: <TrendingUp size={12} />,    text: 'אילו לידים הם הכי חמים כרגע?',                       cat: 'crm' },
    { icon: <ListTodo size={12} />,      text: `צור לי משימת מעקב לליד הראשון שבתהליך`,              cat: 'action' },
    { icon: <Tag size={12} />,           text: 'עדכן את הלידים הישנים שלא נסגרו ל"רימרקטינג"',       cat: 'action' },
    { icon: <Globe size={12} />,         text: 'מה החדשות האחרונות בשוק הנדל"ן הישראלי?',            cat: 'web' },
    { icon: <FileText size={12} />,      text: 'נסח מייל שיווקי ללקוח קבלן שמחפש דמיות ויזואליות',   cat: 'crm' },
    { icon: <MessageSquare size={12} />, text: 'תן 5 רעיונות לרילס אינסטגרם לפרויקט נדל"ן',          cat: 'web' },
    { icon: <StickyNote size={12} />,    text: 'הוסף הערה לליד הראשון שבתהליך',                       cat: 'action' },
    { icon: <Building2 size={12} />,     text: 'מה הסטטוס של כל הלקוחות הפעילים?',                   cat: 'crm' },
  ];

  const isIdle = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-116px)] md:h-[calc(100vh-120px)] bg-slate-900 md:rounded-2xl border-0 md:border border-slate-700/50 shadow-2xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60 bg-gradient-to-l from-indigo-900/30 to-slate-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* History toggle — always visible */}
          <button onClick={() => setShowHistory(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg transition-colors ${showHistory ? 'bg-indigo-800/60 text-indigo-300' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
            <History size={12} />
            {messages.length > 0 ? `${messages.length} הודעות` : 'היסטוריה'}
          </button>
          {/* Clear — only when there are messages */}
          {messages.length > 0 && !showHistory && (
            <button onClick={clearChat}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-800">
              <Trash2 size={12} /> נקה
            </button>
          )}
          {/* Web search toggle */}
          <button onClick={() => setWebSearchEnabled(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              webSearchEnabled
                ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/40'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-400'
            }`}>
            <Globe size={12} className={webSearchEnabled ? 'text-indigo-400' : 'text-slate-600'} />
            {webSearchEnabled ? 'אינטרנט פעיל' : 'ללא אינטרנט'}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-bold text-white text-sm flex items-center gap-2 justify-end">
              עוזר AI אישי
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="text-[10px] text-slate-500">
              claude-opus-4-6 · כלי CRM {webSearchEnabled && '· חיפוש אינטרנט'}
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-900 flex items-center justify-center shadow-lg">
            <Sparkles size={16} className="text-white" />
          </div>
        </div>
      </div>

      {/* ── AI Intelligence Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-700/60 bg-slate-900/50 flex-shrink-0">
        {([
          { key: 'chat'   as const, icon: <Bot size={12} />,    label: 'שיחה'        },
          { key: 'mirror' as const, icon: <Brain size={12} />,  label: 'Mirror Mode' },
          { key: 'dna'    as const, icon: <Dna size={12} />,    label: 'DNA Match'   },
        ]).map(v => (
          <button
            key={v.key}
            onClick={() => setActiveView(v.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeView === v.key
                ? v.key === 'mirror' ? 'bg-violet-700/70 text-violet-200 border border-violet-600/50'
                : v.key === 'dna'    ? 'bg-emerald-700/70 text-emerald-200 border border-emerald-600/50'
                : 'bg-indigo-700/70 text-indigo-200 border border-indigo-600/50'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
            }`}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {/* ── Active searches bar ─────────────────────────────────────────────── */}
      {currentSearches.length > 0 && loading && (
        <div className="flex items-center gap-2 px-5 py-2 bg-indigo-900/20 border-b border-indigo-700/20 flex-shrink-0 overflow-x-auto">
          <Globe size={12} className="text-indigo-400 flex-shrink-0" />
          <span className="text-[11px] text-indigo-400 flex-shrink-0">מחפש:</span>
          {currentSearches.map((q, i) => (
            <span key={i} className="text-[11px] bg-indigo-800/50 text-indigo-200 px-2 py-0.5 rounded-full whitespace-nowrap border border-indigo-700/30">{q}</span>
          ))}
        </div>
      )}

      {/* ── Mirror Mode ─────────────────────────────────────────────────────── */}
      {activeView === 'mirror' && <MirrorModePanel currentUser={currentUser} />}

      {/* ── DNA Match ───────────────────────────────────────────────────────── */}
      {activeView === 'dna' && <DnaMatchPanel leads={leads} />}

      {/* ── History Panel ──────────────────────────────────────────────────── */}
      {activeView === 'chat' && showHistory && (
        <HistoryPanel
          sessions={sessions}
          currentMessages={messages}
          onClose={() => setShowHistory(false)}
          loading={sessionsLoading}
        />
      )}

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {activeView === 'chat' && !showHistory && <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {/* Welcome / idle state */}
        {isIdle && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-900 flex items-center justify-center shadow-xl">
                <Bot size={32} className="text-white" />
              </div>
              {webSearchEnabled && (
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center border-2 border-slate-900">
                  <Globe size={12} className="text-white" />
                </div>
              )}
            </div>
            <div>
              <p className="text-white font-bold text-xl">שלום {currentUser.split(' ')[0]}! אני העוזר ה-AI שלך 👋</p>
              <p className="text-slate-400 text-sm mt-1.5">
                אני יכול לנתח לידים, ליצור משימות, לעדכן סטטוסים ולחפש מידע באינטרנט
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              {[
                { val: leads.length,   label: 'לידים במערכת' },
                { val: hotLeads,       label: 'לידים פעילים' },
                { val: openTasks,      label: 'משימות פתוחות' },
              ].map(s => (
                <div key={s.label} className="bg-slate-800 rounded-xl p-3 border border-slate-700/50">
                  <div className="text-2xl font-bold text-indigo-400">{s.val}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Capability pills */}
            <div className="flex flex-wrap justify-center gap-2 text-[10px]">
              {[
                { icon: <ListTodo size={10}/>, label: 'יצירת משימות', color: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40' },
                { icon: <Tag size={10}/>,      label: 'עדכון סטטוסים', color: 'text-amber-400 bg-amber-900/30 border-amber-700/40' },
                { icon: <StickyNote size={10}/>,label: 'הוספת הערות',  color: 'text-blue-400 bg-blue-900/30 border-blue-700/40' },
                { icon: <Globe size={10}/>,    label: 'חיפוש אינטרנט', color: 'text-indigo-400 bg-indigo-900/30 border-indigo-700/40' },
              ].map((c, i) => (
                <span key={i} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border font-medium ${c.color}`}>
                  {c.icon} {c.label}
                </span>
              ))}
            </div>

            {/* Team info */}
            {team.length > 1 && (
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <User size={11} className="text-slate-600" />
                צוות: {team.map(m => m.name.split(' ')[0]).join(', ')}
              </div>
            )}

            {/* Suggestion chips */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((s, i) => (
                <button key={i}
                  onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                  className={`text-xs text-right px-3 py-2.5 rounded-xl transition-all flex items-start gap-2 ${
                    s.cat === 'action'
                      ? 'bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/30 text-slate-300 hover:text-white'
                      : s.cat === 'web'
                      ? 'bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-700/40 text-slate-300 hover:text-white'
                      : 'bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 hover:text-white'
                  }`}>
                  <span className={`flex-shrink-0 mt-0.5 ${s.cat === 'action' ? 'text-emerald-400' : s.cat === 'web' ? 'text-indigo-400' : 'text-slate-500'}`}>
                    {s.icon}
                  </span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg}
            isStreaming={i === messages.length - 1 && loading && !!streamingText} />
        ))}

        {/* Streaming */}
        {loading && streamingText && (
          <MessageBubble msg={{ role: 'assistant', content: streamingText }} isStreaming />
        )}

        {/* Thinking */}
        {loading && !streamingText && (
          <ThinkingBubble label={searchLabel} />
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-red-300 font-medium">שגיאה</div>
              <div className="text-red-400/80 text-xs mt-0.5">{error}</div>
              {(error.includes('עמוסים') || error.includes('מכסת')) && (
                <button
                  onClick={() => { setError(null); sendMessage(); }}
                  disabled={loading}
                  className="mt-2 text-xs bg-red-800/60 hover:bg-red-700/60 text-red-200 px-3 py-1 rounded-lg transition-colors"
                >
                  נסה שנית
                </button>
              )}
            </div>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400 flex-shrink-0"><X size={14}/></button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>}

      {/* ── Input bar (chat only) ───────────────────────────────────────────── */}
      {activeView === 'chat' && !showHistory && <div className="border-t border-slate-700/60 px-4 py-3 bg-slate-900 flex-shrink-0">
        <div className={`flex gap-2 items-end bg-slate-800 border rounded-xl px-3 py-2.5 transition-all ${
          voiceRecording
            ? 'border-red-500/60 ring-1 ring-red-500/20'
            : 'border-slate-700/50 focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/20'
        }`}>
          {webSearchEnabled && !voiceRecording && (
            <Globe size={14} className="text-indigo-500 flex-shrink-0 mb-1.5" />
          )}
          {voiceRecording && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0 mb-2.5" />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              voiceRecording ? 'מקליט... דבר עכשיו' :
              webSearchEnabled ? 'שאל כל שאלה, בקש פעולה, או חפש מידע...' :
              'שאל שאלה, בקש ליצור משימה, לעדכן ליד...'
            }
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm focus:outline-none text-right text-slate-200 placeholder-slate-500 max-h-32"
            style={{ direction: 'rtl' }}
          />
          <button onClick={toggleVoice} title={voiceRecording ? 'עצור' : 'הקלטה קולית'}
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all active:scale-95 ${
              voiceRecording ? 'bg-red-500 hover:bg-red-400 animate-pulse' : 'text-slate-500 hover:text-white hover:bg-slate-700'
            }`}>
            {voiceRecording ? <MicOff size={13} className="text-white" /> : <Mic size={13} />}
          </button>
          <button onClick={sendMessage} disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95">
            {loading
              ? <Loader2 size={13} className="text-white animate-spin" />
              : <Send size={13} className="text-white" />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="flex items-center gap-2">
            {voiceRecording ? (
              <span className="text-[10px] text-red-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> מקליט
              </span>
            ) : (
              <span className="text-[10px] text-indigo-500 flex items-center gap-1">
                <Zap size={9} /> סוכן AI מחובר לנתוני CRM
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-600">Enter לשליחה · Shift+Enter שורה חדשה</p>
        </div>
      </div>}
    </div>
  );
}
