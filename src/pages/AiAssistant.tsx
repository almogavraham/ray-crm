import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../contexts/LangContext';
import {
  Send, Bot, User, Sparkles, Loader2, AlertCircle,
  Globe, Search, X, Zap,
  Building2, TrendingUp, FileText, MessageSquare,
  Mic, MicOff, Volume2, CheckCircle2, ListTodo, Tag, StickyNote,
  History, Trash2, ArrowRight,
  Maximize2, Minimize2, PanelRightClose,
} from 'lucide-react';
import type { Lead, StandaloneTask, TaskPriority, TeamMember, AccountData, LeadActivity } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import { DEFAULT_STATUS_CONFIGS } from '../lib/statusConfig';
import { db } from '../lib/firebase';
import { speak, cancelSpeech, isTTSSupported, waitForVoices } from '../lib/voiceSynth';
import { wakeWordDetector } from '../lib/wakeWord';
import { getMilestoneProgress, MILESTONE_DEFS } from '../lib/insightEngine';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { doc, getDoc, setDoc, collection, onSnapshot, getDocs, query, orderBy, limit, addDoc } from 'firebase/firestore';
import { buildLeadContext } from '../lib/leadContext';
import { buildChatDigest, useBrainSources } from '../lib/chatDigest';

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
  onCreateLead: (lead: Lead) => void;
  onCompleteStandaloneTask?: (taskId: string) => void;
  workspace?: import('../types').WorkspaceProfile | null;
  /** When rendered inside a side panel, provide close/expand handlers */
  onClose?: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  /** Current page context for context injection */
  currentPage?: string;
  /** Pre-computed insights from the insight engine */
  insights?: import('../lib/insightEngine').Insight[];
  /** Pulses true when wake word "HEY RAY" is detected → enters conversation mode */
  wakeActivated?: boolean;
  /** When set, pre-fills the input with this query. nonce must change on every injection. */
  prefillQuery?: { query: string; nonce: number };
  /** Custom status configurations for status context */
  statusConfigs?: StatusConfig[];
  /**
   * Pointer handlers from `useDraggableWindow`, spread on the header so the
   * assistant can be dragged like the other four chats. Absent on phones and
   * wherever the panel is not floating.
   */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
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
  {
    name: 'create_lead',
    description: 'צור ליד חדש במערכת. השתמש כשהמשתמש רוצה להוסיף ליד/לקוח פוטנציאלי חדש לפי הוראה קולית או כתובה.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company:     { type: 'string',  description: 'שם החברה או העסק' },
        contactName: { type: 'string',  description: 'שם איש הקשר' },
        phone:       { type: 'string',  description: 'מספר טלפון' },
        email:       { type: 'string',  description: 'כתובת אימייל (אופציונלי)' },
        budget:      { type: 'number',  description: 'תקציב חודשי משוער בשקלים (אופציונלי)' },
        source:      { type: 'string',  enum: ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'], description: 'מקור הליד' },
        assignedTo:  { type: 'string',  description: 'שם הסוכן לשיוך (אופציונלי, ברירת מחדל: המשתמש הנוכחי)' },
        notes:       { type: 'string',  description: 'הערה ראשונית (אופציונלי)' },
      },
      required: ['company', 'contactName', 'phone'],
    },
  },
  {
    name: 'assign_lead',
    description: 'שייך ליד לסוכן ספציפי. השתמש כשהמשתמש רוצה לשנות את הסוכן האחראי על ליד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId:     { type: 'string', description: 'מזהה הליד' },
        assignedTo: { type: 'string', description: 'שם הסוכן לשיוך' },
      },
      required: ['leadId', 'assignedTo'],
    },
  },
  {
    name: 'update_lead_field',
    description: 'עדכן שדה ספציפי בליד: שם, טלפון, אימייל, תקציב, מקור, תאריך מעקב, הערת מעקב. השתמש כשהמשתמש רוצה לעדכן פרט אחד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד' },
        field:  { type: 'string', enum: ['contactName', 'phone', 'email', 'budget', 'source', 'nextFollowUpDate', 'followUpNote', 'assignedTo'], description: 'השדה לעדכון' },
        value:  { type: 'string', description: 'הערך החדש' },
      },
      required: ['leadId', 'field', 'value'],
    },
  },
  {
    name: 'log_activity',
    description: 'תעד פעילות על ליד: שיחה, מייל, וואטסאפ, פגישה, הערה. השתמש כשהמשתמש מדווח שביצע פנייה או פעולה עם ליד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId:  { type: 'string', description: 'מזהה הליד' },
        type:    { type: 'string', enum: ['call', 'email', 'whatsapp', 'meeting', 'note', 'in_person'], description: 'סוג הפעילות' },
        content: { type: 'string', description: 'תיאור הפעילות' },
      },
      required: ['leadId', 'type', 'content'],
    },
  },
  {
    name: 'complete_task',
    description: 'סמן משימה כהושלמה. השתמש כשהמשתמש מדווח שסיים משימה. השתמש ב-find_leads קודם כדי לאתר את הליד ולקבל את מזהה המשימה.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד שאליו שייכת המשימה (אם רלוונטי)' },
        taskId: { type: 'string', description: 'מזהה המשימה' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_lead_details',
    description: 'קבל פרטים מלאים על ליד ספציפי: סטטוס, פרטי קשר, משימות פתוחות, הערות, היסטוריית פעילות.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId: { type: 'string', description: 'מזהה הליד' },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'get_pipeline_summary',
    description: 'קבל סיכום מלא של צינור המכירות: כמה לידים בכל שלב, תקציב כולל, ההזדמנויות המובילות.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_proposal',
    description: 'צור הצעת מחיר חדשה עבור לקוח. השתמש כשהמשתמש רוצה ליצור הצעת מחיר ולשלוח ללקוח לחתימה. מושך אוטומטית פתרונות מסומנים של הליד.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadId:      { type: 'string', description: 'מזהה הליד (אופציונלי — לשליפת שם, מייל ופתרונות אוטומטית)' },
        clientName:  { type: 'string', description: 'שם הלקוח' },
        clientEmail: { type: 'string', description: 'אימייל הלקוח (אופציונלי)' },
        notes:       { type: 'string', description: 'הערות להצעה (אופציונלי)' },
        validDays:   { type: 'number', description: 'תוקף ההצעה בימים (ברירת מחדל: 14)' },
      },
      required: ['clientName'],
    },
  },
  {
    name: 'get_finance_summary',
    description: 'קבל סיכום הכנסות והוצאות של החודש הנוכחי מהמערכת הפיננסית.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'חודש בפורמט YYYY-MM (ברירת מחדל: החודש הנוכחי)' },
      },
    },
  },
  {
    name: 'get_team_summary',
    description: 'קבל מידע על חברי הצוות, תפקידיהם וביצועיהם.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

/* ─── History persistence (localStorage + Firestore) ────────────────────── */
// All keys/paths are workspace-scoped so different workspaces never share history.
const MAX_HISTORY = 300;

function historyLocalKey(workspaceId?: string) {
  return workspaceId ? `ray-ai-history-${workspaceId}` : 'ray-ai-history';
}

function loadLocalHistory(workspaceId?: string): Message[] {
  try {
    const raw = localStorage.getItem(historyLocalKey(workspaceId));
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch { return []; }
}

function saveLocalHistory(msgs: Message[], workspaceId?: string) {
  try {
    const toSave = msgs.slice(-MAX_HISTORY);
    localStorage.setItem(historyLocalKey(workspaceId), JSON.stringify(toSave));
  } catch { /* quota exceeded - silently ignore */ }
}

async function loadFirestoreHistory(workspaceId?: string): Promise<Message[]> {
  try {
    const path = workspaceId ? `workspaces/${workspaceId}/ai-history` : 'ai-history';
    const snap = await getDoc(doc(db, path, 'messages'));
    if (!snap.exists()) return [];
    const data = snap.data() as { messages?: Message[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch { return []; }
}

async function saveFirestoreHistory(msgs: Message[], workspaceId?: string) {
  try {
    const toSave = msgs.slice(-MAX_HISTORY);
    const path = workspaceId ? `workspaces/${workspaceId}/ai-history` : 'ai-history';
    await setDoc(doc(db, path, 'messages'), {
      messages: toSave,
      updatedAt: new Date().toISOString(),
    });
  } catch { /* network issue - silently ignore */ }
}

/* ─── Session persistence ─────────────────────────────────────────────────── */
async function saveSessionToFirestore(messages: Message[], workspaceId?: string): Promise<string | null> {
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
    const colPath = workspaceId ? `workspaces/${workspaceId}/ai-sessions` : 'ai-sessions';
    await setDoc(doc(db, colPath, sessionId), session);
    return sessionId;
  } catch { return null; }
}

async function loadSessionsFromFirestore(workspaceId?: string): Promise<Session[]> {
  try {
    const colPath = workspaceId ? `workspaces/${workspaceId}/ai-sessions` : 'ai-sessions';
    const q    = query(collection(db, colPath), orderBy('startedAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Session);
  } catch { return []; }
}

/* ─── Build system prompt ────────────────────────────────────────────────── */
function buildSystemBlocks(
  leads: Lead[],
  currentUser: string,
  accounts: AccountData[] = [],
  workspace?: import('../types').WorkspaceProfile | null,
  statusConfigs: StatusConfig[] = DEFAULT_STATUS_CONFIGS,
  question = '',
) {
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ai = workspace?.aiProfile;

  // ── Build workspace-aware identity block ──────────────────────────────
  const businessName      = workspace?.name ?? 'RAY CRM';
  const industry          = workspace?.industry ?? 'שיווק דיגיטלי';
  const services          = (workspace?.businessSolutions ?? []).join(', ') || null;
  const prompt            = workspace?.prompt ?? null;
  const aiInstructions    = workspace?.aiInstructions ?? null;

  const identityBlock = `אתה עוזר AI מומחה ואישי של ${currentUser} ב${businessName} — מערכת RAY CRM.
היום: ${today}
אתה עונה תמיד בעברית, בצורה מובנית, חכמה וממוקדת.
הטון שלך: ${ai?.tone ?? 'מקצועי וידידותי'}.

══ פרטי הסביבה ══
שם העסק: ${businessName}
תחום: ${industry}
${services ? `שירותים/מוצרים: ${services}` : ''}
${prompt ? `תיאור העסק: ${prompt}` : ''}
${aiInstructions ? `\n══ הנחיות אישיות מהמשתמש ══\n${aiInstructions}` : ''}

══ פרופיל AI — הבנת העסק ══
${ai?.idealClient      ? `👤 לקוח אידיאלי: ${ai.idealClient}` : ''}
${ai?.painPoints       ? `🎯 בעיות שפותרים: ${ai.painPoints}` : ''}
${ai?.uniqueValue      ? `⭐ ייחוד מהמתחרים: ${ai.uniqueValue}` : ''}
${ai?.salesProcess     ? `🔄 תהליך מכירה: ${ai.salesProcess}` : ''}
${ai?.avgDealSize      ? `💰 גודל עסקה ממוצע: ${ai.avgDealSize}` : ''}
${ai?.commonObjections ? `🛡️ התנגדויות נפוצות: ${ai.commonObjections}` : ''}

══ הנחיות פעולה ══
**אתה יכול לבצע פעולות אמיתיות במערכת:**
- ✅ ליצור משימות חדשות (create_task)
- ✅ לעדכן סטטוס לידים (update_lead_status)
- ✅ להוסיף הערות ללידים (add_note)
- ✅ לחפש ולסנן לידים (find_leads)
- ✅ ליצור ליד חדש (create_lead)
- ✅ לשייך ליד לסוכן (assign_lead)
- ✅ לעדכן שדה בליד (update_lead_field)
- ✅ לתעד פעילות על ליד (log_activity)
- ✅ לסמן משימה כהושלמה (complete_task)
- ✅ לקבל פרטי ליד מלאים (get_lead_details)
- ✅ לסכם את הפייפליין (get_pipeline_summary)
- ✅ לקבל חומרי לקוח (get_client_materials)
- ✅ **ליצור הצעת מחיר** (create_proposal) — שולף פתרונות אוטומטית מהליד
- ✅ **לקבל סיכום פיננסי** (get_finance_summary) — הכנסות/הוצאות חודשיות
- ✅ **לקבל מידע על הצוות** (get_team_summary)
- 📅 להוסיף אירועים ל-Google Calendar (add_to_calendar)
- 🌐 לחפש מידע עדכני באינטרנט (web_search)

**כשהמשתמש מבקש פעולה — בצע אותה מיד! אל תשאל אם לבצע — בצע ואחר כך דווח.**
**כשאתה לא בטוח במידע (כמו תאריך, שם ליד) — שאל לפני שאתה מבצע.**

סטטוסים זמינים:\n${statusConfigs.map(s => `${s.emoji} ${s.label}${s.description ? ': ' + s.description : ''}${s.automation?.nextStatusSuggestion ? ' → הבא מומלץ: ' + s.automation.nextStatusSuggestion : ''}`).join(' | ')}
עדיפויות: high (דחוף) | medium (בינוני) | low (נמוך)

══ מפת המערכת המלאה ══
**לידים ולקוחות:**
- כרטיס ליד: פרטים, סטטוס, תקציב, פתרונות מסומנים, משימות, הערות, יומן פעילות, פגישות
- לחיצה על "הפק הצעת מחיר לחתימה" בכרטיס ליד → פותח עורך הצעה עם הפתרונות שסומנו

**הגדרות סביבת עבודה (Settings):**
- 🏢 פרופיל סביבת עבודה — שם, לוגו, תחום, פרומפט AI
- 👥 ניהול צוות — הזמנה, עריכת שם/תפקיד, קידום/הורדה, ניהול הרשאות פר-משתמש:
  · ניהול לידים: צפייה / הוספה / עריכה / מחיקה
  · דוחות: אנליטיקס / הכנסות / עסקאות
  · כלים: קנבן / משימות / AI / תוכן
  · הגדרות: ניהול הגדרות / אינטגרציות / ייצוא
- 📈 ביצועי צוות — לוח מובילים, כולל חברים ללא לידים
- 💰 הכנסות — ניהול הכנסות/הוצאות, קטלוג מוצרים, תקציב חודשי ושנתי, ייבוא מ-CRM
- 🔔 התראות — העדפות התראות לפי אירוע
- ⚙️ הגדרות מכירה — יעדים, שלבי Pipeline, פולואפ, סוגי התנגדויות
- 📄 הצעות מחיר — יצירת הצעות, עריכה, שליחה לחתימה, מעקב סטטוס
  · סטטוסים: טיוטה / נשלחה / אושרה / נדחתה
  · הגדרות: תוקף ברירת מחדל, הערת סיום
- 🌐 פורטל לקוחות — יצירת פורטל אישי לכל לקוח
- 🎨 מראה ועיצוב — מצב כהה/בהיר
- 👑 תוכנית ותשלום

**כלים נוספים בתפריט הראשי:**
- 📊 דשבורד + אנליטיקס
- 🗂️ לוח קנבן (ניהול לידים בעמודות)
- ✅ משימות (עצמאיות + משויכות ללידים)
- 🤝 עסקאות
- 🤖 עוזרי AI לכל ליד (כרטיס "סוכנים")
- 🎬 AI Studio — יצירת תוכן ווידאו

**פורמט תשובות:**
- כותרות **מודגשות** לנושאים
- רשימות נקודות לפירוטים
- נתונים ספציפיים תמיד עם מספרים ועובדות
- אחרי ביצוע פעולה — אשר בקצרה מה נעשה
- התאם המלצות לתחום ולפרופיל של ${businessName} בלבד`;

  const staticPart = identityBlock;

  // Compute hot-score for system prompt context
  const computeHotScoreForPrompt = (l: Lead): number => {
    const weekAgo = Date.now() - 7 * 86400000;
    const log = (l.activityLog ?? []);
    const lastActTime  = log.length ? new Date(log[log.length - 1].timestamp).getTime() : 0;
    const lastContTime = l.lastContactDate ? new Date(l.lastContactDate).getTime() : 0;
    const mostRecent   = Math.max(lastActTime, lastContTime);
    let score = 0;
    if (mostRecent >= weekAgo)                          score += 40;
    else if (mostRecent >= Date.now() - 14 * 86400000) score += 20;
    score += (l.aiScore ?? 0) * 0.35;
    if (l.status === 'בתהליך')    score += 20;
    if (l.status === 'חדש')       score += 10;
    if ((l.budget ?? 0) >= 15000) score += 15;
    return Math.round(score);
  };

  // The old summary was one line per lead, capped at 80, carrying no notes and
  // no activity-log content — so the assistant could not answer anything about
  // what had actually happened with a customer, and silently ignored lead 81
  // onward. buildLeadContext is what the copilots already use: a compact record
  // for every lead, plus full cards — activity log included — for the ones the
  // question points at.
  const leadsSummary = buildLeadContext(leads, question).text;

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
        <ul key={key++} className="my-1.5 space-y-0.5 pr-2">
          {listItems.map((item, i) => (
            <li key={i} className="flex gap-2 items-start flex-row-reverse">
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
      result.push(<div key={key++} className="font-bold text-sm mt-3 mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>{text}</div>);
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
      parts.push(<strong key={k++} className="font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldIdx + boldMatch[0].length);
    } else if (codeMatch) {
      if (codeIdx > 0) parts.push(<span key={k++}>{remaining.slice(0, codeIdx)}</span>);
      parts.push(<code key={k++} className="px-1.5 py-0.5 rounded text-[11px] font-mono" style={{ background: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>{codeMatch[1]}</code>);
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
    <div
      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-full border font-medium"
      style={
        action.success
          ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }
          : { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }
      }
    >
      {action.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
      {icons[action.name]}
      {action.label}
    </div>
  );
}

/* ─── Message Bubble ─────────────────────────────────────────────────────── */
function MessageBubble({ msg, isStreaming, onSpeak }: { msg: Message; isStreaming?: boolean; onSpeak?: () => void }) {
  const isUser = msg.role === 'user';
  const ts = msg.timestamp ? new Date(msg.timestamp) : null;
  const [speaking, setSpeaking] = useState(false);

  const handleSpeak = () => {
    if (speaking) { cancelSpeech(); setSpeaking(false); return; }
    if (!isTTSSupported()) return;
    setSpeaking(true);
    const clean = msg.content.replace(/\*\*/g, '').replace(/#{1,3}\s/g, '').replace(/\n/g, ' ').slice(0, 600);
    speak(clean, 1.05, 1.1).then(() => setSpeaking(false)).catch(() => setSpeaking(false));
    onSpeak?.();
  };

  return (
    <div className={`flex gap-3 group ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
        style={
          isUser
            ? { background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }
            : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }
        }
      >
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-violet-400" />}
      </div>

      <div className={`max-w-[82%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Web search badges */}
        {!isUser && msg.searches && msg.searches.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-0.5">
            {msg.searches.map((q, i) => (
              <span
                key={i}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full"
                style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#c4b5fd' }}
              >
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
        <div className="relative">
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
            style={
              isUser
                ? { background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)', color: 'white' }
                : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }
            }
          >
            {isUser ? (
              <span dir="rtl" style={{ display: 'block', textAlign: 'right' }}>{msg.content}</span>
            ) : (
              <div className="space-y-0.5" dir="rtl" style={{ textAlign: 'right' }}>
                {renderMarkdown(msg.content)}
                {isStreaming && <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse mr-0.5 rounded-sm" />}
              </div>
            )}
          </div>
          {/* Per-message read button */}
          {isTTSSupported() && !isStreaming && (
            <button
              onClick={handleSpeak}
              title={speaking ? 'עצור קריאה' : 'הקרא הודעה'}
              className="absolute -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full flex items-center justify-center text-[11px]"
              style={{
                [isUser ? 'left' : 'right']: '8px',
                background: speaking ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${speaking ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.15)'}`,
                color: speaking ? '#34d399' : 'rgba(255,255,255,0.5)',
              }}
            >
              {speaking ? '⏹' : '🔊'}
            </button>
          )}
        </div>

        {ts && (
          <span className="text-[10px] px-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {ts.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Searching / Thinking bubble ────────────────────────────────────────── */
function ThinkingBubble({ label }: { label?: string }) {
  const { t } = useLang();
  return (
    <div className="flex gap-3">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <Bot size={14} className="text-violet-400" />
      </div>
      <div
        className="rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3"
        style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}
      >
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: '#8b5cf6', animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        {label
          ? <span className="text-xs flex items-center gap-1.5" style={{ color: '#c4b5fd' }}><Search size={11} />{label}</span>
          : <span className="text-xs" style={{ color: 'rgba(196,181,253,0.7)' }}>{t('ai.thinking')}</span>}
      </div>
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
  const { t } = useLang();
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
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            <ArrowRight size={14} /> {t('ai.backToList')}
          </button>
          <div className="text-right">
            <p className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>{fmtDate(selected.startedAt)}</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{selected.messageCount} {t('ai.messages')} · {fmtTime(selected.startedAt)}</p>
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
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          <ArrowRight size={14} /> {t('ai.backToChat')}
        </button>
        <div className="flex items-center gap-2">
          <History size={14} className="text-violet-400" />
          <span className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('ai.sessionHistory')}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Current session */}
        {currentAsSession && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest px-1 mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('ai.currentSession')}</p>
            <button
              onClick={() => setSelected(currentAsSession)}
              className="w-full text-right rounded-2xl p-4 transition-all"
              style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: '#c4b5fd' }}
                >
                  {currentAsSession.messageCount} {t('ai.messages')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'rgba(255,255,255,0.85)' }}>{currentAsSession.preview || t('ai.currentSession')}</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtTime(currentAsSession.startedAt)}</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Past sessions */}
        {sessionsLoading ? (
          <div className="text-center py-8">
            <Loader2 size={20} className="animate-spin mx-auto" style={{ color: 'rgba(255,255,255,0.3)' }} />
            <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('ai.loadingHistory')}</p>
          </div>
        ) : isEmpty ? (
          <div className="text-center py-16">
            <History size={36} className="mx-auto mb-4" style={{ color: 'rgba(255,255,255,0.15)' }} />
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('ai.noHistory')}</p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {t('ai.historyAutoSave')}
            </p>
          </div>
        ) : (
          <>
            {sessions.length > 0 && (
              <p className="text-[10px] font-bold uppercase tracking-widest px-1 pt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>{t('ai.pastSessions')} ({sessions.length})</p>
            )}
            {sessions.map(session => (
              <button
                key={session.id}
                onClick={() => setSelected(session)}
                className="w-full text-right rounded-2xl p-4 transition-all"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
                    style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}
                  >
                    {session.messageCount} {t('ai.messages')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: 'rgba(255,255,255,0.8)' }}>{session.preview || t('ai.chatTitle')}</p>
                    <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtDate(session.startedAt)} · {fmtTime(session.startedAt)}</p>
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

/* ── Conversation Mode Overlay ──────────────────────────────────────────── */
function ConversationOverlay({
  phase, transcript, onStop,
}: {
  phase: 'idle' | 'listening' | 'thinking' | 'speaking';
  transcript: string;
  onStop: () => void;
}) {
  const phaseConfig = {
    listening: { color: '#3b82f6', glow: 'rgba(59,130,246,0.5)', label: 'מאזין...', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.35)' },
    speaking:  { color: '#a78bfa', glow: 'rgba(139,92,246,0.5)', label: 'מדבר...',  bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.35)' },
    thinking:  { color: '#fbbf24', glow: 'rgba(245,158,11,0.5)', label: 'חושב...',  bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)' },
    idle:      { color: '#818cf8', glow: 'rgba(99,102,241,0.5)', label: 'מוכן...',  bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.35)' },
  };
  const cfg = phaseConfig[phase];

  const PhaseIcon = () => {
    if (phase === 'listening') return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
      </svg>
    );
    if (phase === 'speaking') return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
    );
    if (phase === 'thinking') return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'raySpinWidget 1.2s linear infinite' }}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
    );
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      </svg>
    );
  };

  const waveHeights = [10, 20, 14, 26, 16, 22, 10, 18, 12];
  const waveDelays  = [0.1, 0.3, 0, 0.2, 0.4, 0.15, 0.35, 0.05, 0.25];

  return createPortal(
    <>
      {/* Subtle full-screen dim — allows seeing page underneath */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(2,4,14,0.45)',
        backdropFilter: 'blur(4px)',
      }} onClick={onStop} />

      {/* Compact floating widget */}
      <div dir="rtl" style={{
        position: 'fixed',
        bottom: '90px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 340,
        maxWidth: 'calc(100vw - 32px)',
        borderRadius: 24,
        background: 'linear-gradient(145deg, rgba(8,10,28,0.97) 0%, rgba(14,16,38,0.97) 100%)',
        border: `1.5px solid ${cfg.border}`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 8px 40px rgba(0,0,0,0.6), 0 0 60px ${cfg.glow}`,
        backdropFilter: 'blur(32px)',
        overflow: 'hidden',
        animation: 'widgetEntrance 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
      }}>

        {/* Top accent bar */}
        <div style={{
          height: 2,
          background: `linear-gradient(90deg, transparent, ${cfg.color}, transparent)`,
          opacity: 0.8,
        }} />

        {/* Header row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px 10px',
        }}>
          {/* RAY badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            {/* Mini orb */}
            <div style={{
              position: 'relative', width: 36, height: 36, borderRadius: '50%',
              background: `radial-gradient(circle at 35% 30%, ${cfg.color}44 0%, ${cfg.color}0a 70%)`,
              border: `1.5px solid ${cfg.color}55`,
              boxShadow: `0 0 14px ${cfg.glow}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              animation: 'rayFloatWidget 3s ease-in-out infinite',
            }}>
              {/* Ping ring */}
              <div style={{
                position: 'absolute', inset: -4, borderRadius: '50%',
                border: `1px solid ${cfg.color}`,
                opacity: 0,
                animation: `rayRingWidget 2s ease-out 0s infinite`,
              }} />
              <div style={{
                position: 'absolute', inset: -4, borderRadius: '50%',
                border: `1px solid ${cfg.color}`,
                opacity: 0,
                animation: `rayRingWidget 2s ease-out 0.7s infinite`,
              }} />
              <PhaseIcon />
            </div>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 700, letterSpacing: 1.5 }}>
                R A Y
              </div>
              <div style={{
                color: cfg.color, fontSize: 11, fontWeight: 600,
                textShadow: `0 0 10px ${cfg.glow}`,
                letterSpacing: 0.5,
              }}>
                {cfg.label}
              </div>
            </div>
          </div>

          {/* Close / stop X */}
          <button
            onClick={onStop}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: 'rgba(239,68,68,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 14, fontWeight: 700,
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.22)'; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; }}
            title="עצור שיחה"
          >
            ✕
          </button>
        </div>

        {/* Wave visualizer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 3, padding: '4px 18px 14px', height: 44,
        }}>
          {waveHeights.map((h, i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2,
              background: `linear-gradient(to top, ${cfg.color}99, ${cfg.color})`,
              opacity: phase === 'idle' ? 0.18 : 0.8,
              animation: phase !== 'idle' ? `waveBarWidget 0.9s ease-in-out ${waveDelays[i]}s infinite alternate` : 'none',
              height: phase === 'idle' ? 3 : h,
              transition: 'height 0.3s ease',
            }} />
          ))}
        </div>

        {/* Live transcript */}
        <div style={{
          minHeight: 40,
          padding: '0 18px 14px',
          textAlign: 'center',
        }}>
          {transcript ? (
            <div style={{
              padding: '10px 14px',
              background: cfg.bg,
              borderRadius: 12,
              color: 'rgba(255,255,255,0.88)',
              fontSize: 13, lineHeight: 1.55,
              border: `1px solid ${cfg.color}22`,
              fontStyle: 'italic',
            }}>
              "{transcript}"
            </div>
          ) : (
            <div style={{
              color: 'rgba(255,255,255,0.2)',
              fontSize: 12, letterSpacing: 0.5,
              paddingTop: 8,
            }}>
              {phase === 'listening' ? 'דבר עכשיו...' : phase === 'thinking' ? 'מעבד...' : phase === 'speaking' ? 'מדבר...' : ''}
            </div>
          )}
        </div>

        {/* Bottom accent + stop button */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          padding: '12px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <button
            onClick={onStop}
            style={{
              padding: '8px 28px',
              borderRadius: 100,
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171',
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: 0.5,
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.2)'; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.10)'; }}
          >
            <span style={{ fontSize: 10 }}>■</span>
            עצור שיחה
          </button>
        </div>

        {/* Bottom accent bar */}
        <div style={{
          height: 2,
          background: `linear-gradient(90deg, transparent, ${cfg.color}55, transparent)`,
        }} />
      </div>

      {/* CSS keyframes */}
      <style>{`
        @keyframes widgetEntrance {
          0%   { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.92); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1);    }
        }
        @keyframes rayRingWidget {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(2.2); opacity: 0;   }
        }
        @keyframes rayFloatWidget {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-3px); }
        }
        @keyframes rayPulseWidget {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.06); }
        }
        @keyframes waveBarWidget {
          0%   { transform: scaleY(0.25); }
          100% { transform: scaleY(1);    }
        }
        @keyframes raySpinWidget {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>,
    document.body
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function AiAssistant({
  leads, team, currentUser, standaloneTask: _standaloneTask,
  onCreateTask, onUpdateLead, onAddNote, onCreateLead, onCompleteStandaloneTask, workspace,
  onClose, onExpand, isExpanded,
  currentPage, insights = [], wakeActivated = false,
  prefillQuery,
  statusConfigs = DEFAULT_STATUS_CONFIGS,
  dragHandleProps,
}: AiAssistantProps) {

  const { t, dir } = useLang();
  const wsId = workspace?.id;
  /** Which specialist chats this one can currently read. */
  const brainSources = useBrainSources();
  const [messages,          setMessages]          = useState<Message[]>(() => loadLocalHistory(wsId));
  const [input,             setInput]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [streamingText,     setStreamingText]     = useState('');
  const [searchLabel,       setSearchLabel]       = useState<string | undefined>();
  const [webSearchEnabled,  setWebSearchEnabled]  = useState(true);
  const [currentSearches,   setCurrentSearches]   = useState<string[]>([]);
  const [voiceRecording,    setVoiceRecording]    = useState(false);
  const [voiceMode,         setVoiceMode]         = useState(false); // full TTS voice mode
  const [conversationMode,  setConversationMode]  = useState(false); // Gemini-like live conversation
  const [convPhase,         setConvPhase]         = useState<'idle'|'listening'|'thinking'|'speaking'>('idle');
  const [wakeAnimation,     setWakeAnimation]     = useState(false); // HEY RAY wake flash
  const [speakingMsgId,     setSpeakingMsgId]     = useState<number|null>(null); // per-message TTS
  const convModeRef         = useRef(false); // stable ref for async callbacks
  const convRecogRef        = useRef<unknown>(null); // conversation recognition instance
  const silenceTimerRef     = useRef<ReturnType<typeof setTimeout>|null>(null);
  const isTTSSpeakingRef    = useRef(false); // true while TTS plays → blocks STT from opening (prevents echo)
  const lastConvSpokenIdxRef = useRef(-1);   // index of last message spoken in conversation TTS → prevents re-speaking on re-activation
  const messagesLenRef       = useRef(0);    // kept in sync so convCtrl.start() can read messages.length
  // Mobile TTS: store pending text so user can tap "🔊 שמע" button (TTS requires a gesture on Android)
  const [pendingConvTTS,   setPendingConvTTS]   = useState<string | null>(null);
  const pendingConvTTSRef  = useRef<string | null>(null); // same value, accessible in async callbacks
  const convTTSFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep messagesLenRef in sync so convCtrl.start() can read messages.length without stale closure
  messagesLenRef.current = messages.length;

  // Stable controller ref — avoids TDZ issues with self-referential useCallback in minified bundles
  const convCtrl = useRef<{
    stop: () => void;
    listen: () => void;
    start: (greet?: boolean) => void;
    sendText: (text: string) => void;
  }>({ stop: () => {}, listen: () => {}, start: () => {}, sendText: () => {} });
  const [showHistory,       setShowHistory]       = useState(false);
  const [accounts,          setAccounts]          = useState<AccountData[]>([]);
  const [sessions,          setSessions]          = useState<Session[]>([]);
  const [sessionsLoading,   setSessionsLoading]   = useState(false);
  const [welcomePhase,      setWelcomePhase]      = useState(0);   // 0=avatar,1=greeting,2=insight,3=actions
  const [typedLen,          setTypedLen]          = useState(0);
  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const voiceRecogRef   = useRef<unknown>(null);
  const fsSaveTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from Firestore on mount — only as fallback when localStorage is empty.
  // All paths are workspace-scoped so different workspaces never share history.
  useEffect(() => {
    const localMsgs = loadLocalHistory(wsId);
    if (localMsgs.length > 0) setMessages(localMsgs);

    loadFirestoreHistory(wsId).then(fsMsgs => {
      if (fsMsgs.length > localMsgs.length) {
        setMessages(fsMsgs);
        saveLocalHistory(fsMsgs, wsId);
      }
    }).catch(() => { /* network unavailable — local cache is fine */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // Load session history from Firestore on mount (workspace-scoped)
  useEffect(() => {
    setSessionsLoading(true);
    loadSessionsFromFirestore(wsId)
      .then(s => setSessions(s))
      .finally(() => setSessionsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

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

  // Pick up pre-filled query from sessionStorage (set by insight cards / wake word)
  useEffect(() => {
    const q = sessionStorage.getItem('ray-prefill-query');
    if (q) {
      sessionStorage.removeItem('ray-prefill-query');
      setInput(q);
      // Small delay so the panel finishes opening animation first
      setTimeout(() => inputRef.current?.focus(), 300);
      // Trigger wake animation
      setWakeAnimation(true);
      setTimeout(() => setWakeAnimation(false), 1500);
    }
  }, []); // on mount only — panel just opened

  // React to prop-injected prefill (handles the case where the panel is already open)
  useEffect(() => {
    if (!prefillQuery?.query) return;
    setInput(prefillQuery.query);
    setTimeout(() => inputRef.current?.focus(), 100);
    setWakeAnimation(true);
    setTimeout(() => setWakeAnimation(false), 1500);
  }, [prefillQuery?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conversation mode: after AI responds → TTS → then listen again
  useEffect(() => {
    if (!conversationMode || loading) return;
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last?.role !== 'assistant' || !last.content) return;
    // Guard: skip if we already spoke this message (prevents re-speaking on conversation re-activation)
    if (lastIndex <= lastConvSpokenIdxRef.current) return;
    lastConvSpokenIdxRef.current = lastIndex;

    // Strip markdown AND emojis before TTS — prevents STT picking up emoji descriptions (echo loop)
    const clean = last.content
      .replace(/\*\*/g, '')
      .replace(/#{1,3}\s/g, '')
      .replace(/\n/g, ' ')
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2702}-\u{27B0}\u{FE00}-\u{FEFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setConvPhase('speaking');
    isTTSSpeakingRef.current = true; // block STT while TTS is playing

    const afterSpeak = () => {
      isTTSSpeakingRef.current = false;
      pendingConvTTSRef.current = null;
      setPendingConvTTS(null);
      if (convTTSFallbackRef.current) { clearTimeout(convTTSFallbackRef.current); convTTSFallbackRef.current = null; }
      if (convModeRef.current) setTimeout(() => convCtrl.current.listen(), 400);
    };

    if (isMobile) {
      // Android Chrome blocks speechSynthesis.speak() from async contexts.
      // Solution: show a "🔊 שמע תשובה" tap button — the user tap IS a gesture, so TTS works.
      // Also attempt auto-speak (may work on newer Android); if onend fires first, button is cleared.
      pendingConvTTSRef.current = clean;
      setPendingConvTTS(clean);

      // Attempt auto-speak anyway (works on some Android versions after the unlock)
      speak(clean, 1.0, 1.0, 4000)
        .then(afterSpeak)
        .catch(afterSpeak);

      // Fallback: if neither auto-speak nor tap happens within 10s, proceed to listening
      convTTSFallbackRef.current = setTimeout(() => {
        if (pendingConvTTSRef.current) afterSpeak();
      }, 10000);
    } else {
      // Desktop: auto-speak with longer timeout
      speak(clean, 1.0, 1.0, 8000)
        .then(afterSpeak)
        .catch(afterSpeak);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading, conversationMode]);

  // Voice mode (non-conversation): speak AI responses via TTS
  useEffect(() => {
    if (!voiceMode || conversationMode || !isTTSSupported()) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.content) {
      const clean = last.content.replace(/\*\*/g, '').replace(/#{1,3}\s/g, '').slice(0, 500);
      speak(clean).catch(() => {});
    }
    return () => cancelSpeech();
  }, [messages, voiceMode, conversationMode]);

  // Cleanup conversation on unmount
  useEffect(() => {
    return () => { convModeRef.current = false; cancelSpeech(); };
  }, []);

  // Persist history to localStorage immediately + Firestore with 2s debounce (workspace-scoped)
  useEffect(() => {
    if (messages.length === 0) return;
    saveLocalHistory(messages, wsId);
    if (fsSaveTimer.current) clearTimeout(fsSaveTimer.current);
    fsSaveTimer.current = setTimeout(() => {
      saveFirestoreHistory(messages, wsId);
    }, 2000);
  }, [messages, wsId]);

  /* ── Execute CRM tool ─────────────────────────────────────────────────── */
  const executeCRMTool = useCallback(async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ text: string; label: string; success: boolean }> => {
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

      if (name === 'create_lead') {
        const newLead: Lead = {
          id:            Date.now().toString(),
          company:       String(input.company     ?? ''),
          contactName:   String(input.contactName ?? ''),
          phone:         String(input.phone       ?? ''),
          email:         String(input.email       ?? ''),
          budget:        Number(input.budget      ?? 0),
          source:        (input.source as Lead['source']) ?? 'אורגני',
          status:        'חדש',
          assignedTo:    String(input.assignedTo  ?? currentUser),
          lastUpdate:    new Date().toLocaleDateString('he-IL'),
          createdAt:     Date.now(),
          aiScore:       50,
          notes:         input.notes
            ? [{ id: Date.now().toString(), text: String(input.notes), author: currentUser, timestamp: new Date().toISOString() }]
            : [],
          tasks:         [],
          futureNotes:   [],
          waitingContent: false,
          solutions:     [],
          activityLog:   [],
          meetings:      [],
        };
        onCreateLead(newLead);
        return {
          text:    `✅ ליד חדש נוצר: "${newLead.company}" (${newLead.contactName}, ${newLead.phone}) — שויך ל-${newLead.assignedTo}`,
          label:   `ליד חדש: ${newLead.company}`,
          success: true,
        };
      }

      if (name === 'assign_lead') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        onUpdateLead({ ...lead, assignedTo: String(input.assignedTo) });
        return {
          text:    `✅ הליד "${lead.company}" שויך ל-${input.assignedTo}`,
          label:   `שיוך: ${lead.company} → ${input.assignedTo}`,
          success: true,
        };
      }

      if (name === 'update_lead_field') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        const field = String(input.field);
        const rawValue = String(input.value ?? '');
        const value: string | number = field === 'budget' ? Number(rawValue) : rawValue;
        onUpdateLead({ ...lead, [field]: value, lastUpdate: new Date().toLocaleDateString('he-IL') });
        const fieldLabels: Record<string, string> = {
          contactName: 'שם איש קשר', phone: 'טלפון', email: 'אימייל',
          budget: 'תקציב', source: 'מקור', nextFollowUpDate: 'תאריך מעקב',
          followUpNote: 'הערת מעקב', assignedTo: 'שיוך סוכן',
        };
        return {
          text:    `✅ "${fieldLabels[field] ?? field}" עודכן ל-"${rawValue}" עבור "${lead.company}"`,
          label:   `עדכון: ${lead.company}`,
          success: true,
        };
      }

      if (name === 'log_activity') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        const activity: LeadActivity = {
          id:        Date.now().toString(),
          type:      (input.type as LeadActivity['type']) ?? 'note',
          content:   String(input.content ?? ''),
          author:    currentUser,
          timestamp: new Date().toISOString(),
        };
        onUpdateLead({
          ...lead,
          activityLog:     [...(lead.activityLog ?? []), activity],
          lastContactDate: new Date().toISOString(),
          lastUpdate:      new Date().toLocaleDateString('he-IL'),
        });
        const typeEmoji: Record<string, string> = {
          call: '📞', email: '📧', whatsapp: '💬', meeting: '🤝', note: '📝', in_person: '🏢',
        };
        return {
          text:    `✅ ${typeEmoji[String(input.type)] ?? '📌'} פעילות תועדה עבור "${lead.company}": "${activity.content}"`,
          label:   `תיעוד: ${lead.company}`,
          success: true,
        };
      }

      if (name === 'complete_task') {
        const taskId = String(input.taskId);
        // First: try lead-embedded tasks
        for (const lead of leads) {
          const task = lead.tasks.find(t => t.id === taskId);
          if (task) {
            const updatedTasks = lead.tasks.map(t =>
              t.id === taskId ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
            );
            onUpdateLead({ ...lead, tasks: updatedTasks });
            return {
              text:    `✅ משימה "${task.description}" הושלמה (ליד: ${lead.company})`,
              label:   `משימה הושלמה`,
              success: true,
            };
          }
        }
        // Second: standalone tasks
        const st = _standaloneTask.find(t => t.id === taskId);
        if (st) {
          if (onCompleteStandaloneTask) onCompleteStandaloneTask(taskId);
          return {
            text:    `✅ משימה "${st.description}" הושלמה`,
            label:   `משימה הושלמה`,
            success: true,
          };
        }
        return { text: `❌ משימה לא נמצאה: ${taskId}`, label: 'משימה לא נמצאה', success: false };
      }

      if (name === 'get_lead_details') {
        const lead = leads.find(l => l.id === String(input.leadId));
        if (!lead) return { text: `❌ ליד לא נמצא: ${input.leadId}`, label: 'ליד לא נמצא', success: false };
        const openTasks = lead.tasks.filter(t => !t.completed);
        const recentActivity = (lead.activityLog ?? []).slice(-3)
          .map(a => `  • [${a.type}] ${a.content} (${new Date(a.timestamp).toLocaleDateString('he-IL')})`)
          .join('\n');
        const recentNotes = lead.notes.slice(-3).map(n => `  • ${n.text}`).join('\n');
        return {
          text:
            `**פרטי ליד: ${lead.company}**\n` +
            `איש קשר: ${lead.contactName} | טל: ${lead.phone} | מייל: ${lead.email || '—'}\n` +
            `סטטוס: ${lead.status} | תקציב: ₪${lead.budget.toLocaleString()}/חודש | מקור: ${lead.source}\n` +
            `סוכן: ${lead.assignedTo} | ציון AI: ${lead.aiScore}%\n` +
            `מעקב הבא: ${lead.nextFollowUpDate ?? 'לא נקבע'}${lead.followUpNote ? ` — ${lead.followUpNote}` : ''}\n\n` +
            `**משימות פתוחות (${openTasks.length}):**\n${openTasks.map(t => `  • [${t.id}] [${t.priority ?? 'medium'}] ${t.description} — ${t.date}`).join('\n') || '  אין משימות'}\n\n` +
            `**פעילות אחרונה:**\n${recentActivity || '  אין פעילות'}\n\n` +
            `**הערות אחרונות:**\n${recentNotes || '  אין הערות'}`,
          label:   `פרטי ${lead.company}`,
          success: true,
        };
      }

      if (name === 'get_pipeline_summary') {
        const statuses: Lead['status'][] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
        const rows = statuses.map(s => {
          const group = leads.filter(l => l.status === s);
          const budget = group.reduce((acc, l) => acc + l.budget, 0);
          return `${s}: ${group.length} לידים${budget > 0 ? ` | ₪${budget.toLocaleString()}/חודש` : ''}`;
        });
        const activeLeads = leads.filter(l => l.status !== 'לא רלוונטי');
        const monthlyRevenue = leads.filter(l => l.status === 'לקוח פעיל').reduce((acc, l) => acc + l.budget, 0);
        const topOpps = activeLeads
          .sort((a, b) => b.aiScore - a.aiScore)
          .slice(0, 5)
          .map(l => `  [${l.id}] ${l.company} | ${l.status} | ₪${l.budget.toLocaleString()} | AI: ${l.aiScore}%`)
          .join('\n');
        return {
          text:
            `**סיכום צינור מכירות:**\n\n${rows.join('\n')}\n\n` +
            `**סה"כ פעילים:** ${activeLeads.length} | **הכנסה חודשית (לקוחות פעילים):** ₪${monthlyRevenue.toLocaleString()}\n\n` +
            `**Top 5 הזדמנויות:**\n${topOpps || '  אין לידים פעילים'}`,
          label:   `סיכום צינור`,
          success: true,
        };
      }

      // ── create_proposal ────────────────────────────────────────────────
      if (name === 'create_proposal') {
        if (!workspace?.id) return { text: '❌ לא נמצאה סביבת עבודה', label: 'שגיאה', success: false };
        const lead = input.leadId ? leads.find(l => l.id === String(input.leadId)) : null;
        const clientName  = String(input.clientName  ?? lead?.company ?? '');
        const clientEmail = String(input.clientEmail ?? lead?.email   ?? '');
        const notes       = String(input.notes ?? '');
        const validDays   = Number(input.validDays ?? workspace.salesSettings?.proposalValidDays ?? 30);
        const validUntil  = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
        const token       = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const autoItems = (lead?.solutions ?? []).map((sol: unknown, idx: number) => {
          const s = sol as Record<string, unknown>;
          return {
            id:          `auto-${idx}`,
            name:        typeof sol === 'string' ? sol : (s?.name as string ?? ''),
            description: '',
            price:       typeof s?.price === 'number' ? s.price : (lead?.budget ?? 0),
            priceType:   (s?.priceType as string) || 'monthly',
            quantity:    1,
          };
        });
        const totalMonthly = autoItems.filter(i => i.priceType === 'monthly').reduce((s, i) => s + i.price * i.quantity, 0);
        const totalOneTime = autoItems.filter(i => i.priceType === 'one_time').reduce((s, i) => s + i.price * i.quantity, 0);
        const proposalRef = collection(db, 'workspaces', workspace.id, 'proposals');
        const snap        = await getDocs(proposalRef);
        const nextNum     = `P-${String(snap.size + 1).padStart(4, '0')}`;
        await addDoc(proposalRef, {
          proposalNumber: nextNum, clientName, clientEmail,
          leadId:      lead?.id ?? '',
          items:       autoItems,
          notes,
          footer:      workspace.salesSettings?.proposalFooter ?? '',
          validUntil,
          status:      'draft',
          totalMonthly,
          totalOneTime,
          approvalToken: token,
          createdAt:   new Date().toISOString(),
        });
        return {
          text:
            `✅ **הצעת מחיר ${nextNum} נוצרה בהצלחה!**\n` +
            `לקוח: ${clientName}${clientEmail ? ` (${clientEmail})` : ''}\n` +
            `פריטים: ${autoItems.length} | חודשי: ₪${totalMonthly.toLocaleString()} | חד-פעמי: ₪${totalOneTime.toLocaleString()}\n` +
            `תוקף עד: ${validUntil}\n\n` +
            `ניתן לצפות ולשלוח מלשונית **הצעות מחיר** בהגדרות.`,
          label:   `הצעת מחיר ${nextNum}`,
          success: true,
        };
      }

      // ── get_finance_summary ────────────────────────────────────────────
      if (name === 'get_finance_summary') {
        if (!workspace?.id) return { text: '❌ לא נמצאה סביבת עבודה', label: 'שגיאה', success: false };
        const now       = new Date();
        const monthStr  = String(input.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
        const entriesRef = collection(db, 'workspaces', workspace.id, 'financeEntries');
        const snap       = await getDocs(entriesRef);
        type FinEntry = { type: string; amount: number; date?: string; category?: string; description?: string };
        const entries: FinEntry[] = snap.docs.map(d => d.data() as FinEntry);
        const monthly = entries.filter(e => (e.date ?? '').startsWith(monthStr));
        const income   = monthly.filter(e => e.type === 'income').reduce((s, e) => s + (e.amount ?? 0), 0);
        const expense  = monthly.filter(e => e.type === 'expense').reduce((s, e) => s + (e.amount ?? 0), 0);
        const profit   = income - expense;
        const topIncome  = monthly.filter(e => e.type === 'income').sort((a, b) => b.amount - a.amount).slice(0, 3)
          .map(e => `  • ${e.description ?? e.category ?? '—'}: ₪${(e.amount ?? 0).toLocaleString()}`).join('\n');
        const topExpense = monthly.filter(e => e.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 3)
          .map(e => `  • ${e.description ?? e.category ?? '—'}: ₪${(e.amount ?? 0).toLocaleString()}`).join('\n');
        return {
          text:
            `**סיכום פיננסי — ${monthStr}**\n\n` +
            `💰 הכנסות: ₪${income.toLocaleString()}\n` +
            `📤 הוצאות: ₪${expense.toLocaleString()}\n` +
            `📊 רווח נקי: ₪${profit.toLocaleString()}\n\n` +
            (topIncome  ? `**הכנסות גדולות:**\n${topIncome}\n\n`  : '') +
            (topExpense ? `**הוצאות גדולות:**\n${topExpense}`     : '') +
            (!topIncome && !topExpense ? 'אין נתונים לחודש זה.' : ''),
          label:   `פיננסי ${monthStr}`,
          success: true,
        };
      }

      // ── get_team_summary ───────────────────────────────────────────────
      if (name === 'get_team_summary') {
        if (!team || team.length === 0) return { text: 'אין חברי צוות בסביבה זו.', label: 'צוות', success: true };
        const rows = team.map(m => {
          const myLeads  = leads.filter(l => l.assignedTo === m.name);
          const active   = myLeads.filter(l => l.status === 'לקוח פעיל').length;
          const monthly  = myLeads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
          const permsStr = (m as unknown as { permissions?: Record<string, boolean> }).permissions
            ? Object.entries((m as unknown as { permissions: Record<string, boolean> }).permissions)
                .filter(([, v]) => v).map(([k]) => k).join(', ')
            : 'הרשאות ברירת מחדל';
          return `**${m.name}** (${m.role}) — ${myLeads.length} לידים | ${active} לקוחות פעילים | ₪${monthly.toLocaleString()}/חודש\n  הרשאות: ${permsStr}`;
        });
        const totalActive   = leads.filter(l => l.status === 'לקוח פעיל').length;
        const totalMonthly2 = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
        return {
          text:
            `**צוות ${workspace?.name ?? ''}** — ${team.length} חברים\n\n` +
            rows.join('\n\n') +
            `\n\n**סה"כ לקוחות פעילים:** ${totalActive} | **הכנסה חודשית:** ₪${totalMonthly2.toLocaleString()}`,
          label:   `סיכום צוות`,
          success: true,
        };
      }

      return { text: `❓ כלי לא מוכר: ${name}`, label: 'שגיאה', success: false };
    } catch (e) {
      return { text: `❌ שגיאה: ${e instanceof Error ? e.message : 'Unknown'}`, label: 'שגיאה', success: false };
    }
  }, [leads, team, accounts, _standaloneTask, currentUser, onCreateTask, onUpdateLead, onAddNote, onCreateLead, onCompleteStandaloneTask, workspace]);

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
    client: ReturnType<typeof getAnthropicProxy>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msgs: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemBlocks: any[],
  ): Promise<{ text: string; searches: string[]; actions: ToolAction[]; totalInputTokens: number; totalOutputTokens: number }> => {
    const allSearches: string[] = [];
    const allActions:  ToolAction[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

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

      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

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
        return { text: textParts, searches: allSearches, actions: allActions, totalInputTokens, totalOutputTokens };
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
          const r = await executeCRMTool(tu.name, tu.input);
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

    return { text: 'לא הצלחתי לקבל תשובה סופית. נסה שנית.', searches: allSearches, actions: allActions, totalInputTokens, totalOutputTokens };
  }, [webSearchEnabled, executeCRMTool]);

  /* ── Voice input (single-shot dictation) ────────────────────────────── */
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
  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    // Check token balance before sending
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) {
        setError('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.');
        return;
      }
    }

    setError(null);
    setInput('');
    setCurrentSearches([]);
    setSearchLabel(undefined);

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const updatedMsgs = [...messages, userMsg];
    setMessages(updatedMsgs);
    saveLocalHistory(updatedMsgs, wsId); // save user message immediately (before AI responds)
    setLoading(true);
    setStreamingText('');

    const client = getAnthropicProxy();
    const baseBlocks = buildSystemBlocks(leads, currentUser, accounts, workspace, statusConfigs, text);
    // Inject page context so RAY knows where the user is and what data is visible
    const PAGE_LABELS: Record<string, string> = {
      home: 'דף הבית', dashboard: 'רשימת לידים', kanban: 'לוח קנבן',
      tasks: 'ניהול משימות', analytics: 'ניתוח נתונים', integrations: 'אינטגרציות',
      settings: 'הגדרות', ai: 'עוזר AI', agents: 'סוכנים AI', workflows: 'אוטומציות',
      overview: 'סקירה', deals: 'עסקאות', billing: 'חיוב',
    };
    const pageLabel = currentPage ? (PAGE_LABELS[currentPage] ?? currentPage) : 'לא ידוע';
    const hotCount = leads.filter(l => !['לקוח פעיל','לא רלוונטי'].includes(l.status)).length;
    const overdueCount = leads.flatMap(l => (l.tasks ?? []).filter(t => !t.completed && new Date(t.date + 'T00:00:00') < new Date())).length;
    const pageContextBlock = {
      type: 'text' as const,
      text: `\n══ הקשר דף נוכחי ══\nהמשתמש נמצא כרגע בדף: **${pageLabel}**\nסיכום מהיר: ${leads.length} לידים סה"כ | ${hotCount} פעילים | ${overdueCount} משימות באיחור\n${insights.length > 0 ? `תובנות פעילות: ${insights.slice(0,3).map(i => i.title).join(' | ')}` : ''}\nאם המשתמש שואל שאלה כללית — התייחס לדף שבו הוא נמצא כנקודת ההתחלה.${convModeRef.current ? '\n\n⚠️ מצב שיחה קולית פעיל: ענה בקצרה (1-3 משפטים), ללא אמוג\'ים, ללא תבליטים. תשובות קצרות ומדוברות בלבד.' : ''}`,
    };
    /* The assistant is the brain: it also reads what the four specialist chats
       have been discussing, so "מה סיכמנו עם השיווק?" has an answer here
       instead of only inside RAY MARKETING. A digest, not a transcript — four
       full conversations would dwarf the pipeline data in the same prompt and
       cost real money on every message. Skipped entirely when they are empty,
       rather than sending a heading with nothing under it. */
    const digest = buildChatDigest();
    const systemBlocks = digest
      ? [...baseBlocks, pageContextBlock, { type: 'text' as const, text: digest }]
      : [...baseBlocks, pageContextBlock];

    // Build API messages (only role + content for API)
    const apiMessages = updatedMsgs.map(m => ({ role: m.role, content: m.content }));

    try {
      const { text: result, searches, actions, totalInputTokens, totalOutputTokens } = await runAgentLoop(client, apiMessages, systemBlocks);

      const assistantMsg: Message = {
        role:      'assistant',
        content:   result,
        searches,
        actions:   actions.length > 0 ? actions : undefined,
        timestamp: new Date().toISOString(),
      };
      // Build the final messages array and save immediately to both stores
      // (not just via the debounced useEffect) so nothing is lost if the panel closes quickly
      setMessages(prev => {
        const finalMsgs = [...prev, assistantMsg];
        saveLocalHistory(finalMsgs, wsId);                 // synchronous localStorage write
        saveFirestoreHistory(finalMsgs, wsId).catch(() => {}); // async Firestore write (non-blocking)
        return finalMsgs;
      });

      // Deduct tokens after successful response
      try {
        const cost = calculateCost('claude-opus-4-6', totalInputTokens, totalOutputTokens);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-6', 'AI Assistant chat');
      } catch (trackErr) {
        console.error('Token tracking failed:', trackErr);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.status;

      if (raw.includes('credit balance') || raw.includes('billing') || raw.includes('upgrade or purchase')) {
        setError(workspace?.id
          ? '⚠️ שירות ה-AI אינו זמין כרגע עקב בעיה טכנית. אנא נסה שנית מאוחר יותר או צור קשר עם התמיכה.'
          : '💳 יתרת הקרדיט ב-Anthropic נגמרה. יש להוסיף קרדיט בכתובת: console.anthropic.com → Plans & Billing');
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

  // Keep a stable ref so convCtrl.current.sendText always calls the latest sendMessage
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  /* ── Conversation controller — initialised once, references stable refs ── */
  useEffect(() => {
    // ── stop ────────────────────────────────────────────────────────────────
    convCtrl.current.stop = () => {
      convModeRef.current = false;
      isTTSSpeakingRef.current = false;
      setConversationMode(false);
      setConvPhase('idle');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (convRecogRef.current as any)?.abort();
      convRecogRef.current = null;
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      if (convTTSFallbackRef.current) { clearTimeout(convTTSFallbackRef.current); convTTSFallbackRef.current = null; }
      pendingConvTTSRef.current = null;
      setPendingConvTTS(null);
      cancelSpeech();
      setInput('');
      // Signal App.tsx to restart wake word detection (Chrome: only one SpeechRecognition at a time)
      window.dispatchEvent(new CustomEvent('ray-conv-ended'));
    };

    // ── sendText ─────────────────────────────────────────────────────────────
    convCtrl.current.sendText = (text: string) => {
      sendMessageRef.current(text);
    };

    // ── listen ───────────────────────────────────────────────────────────────
    convCtrl.current.listen = () => {
      if (!convModeRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { convCtrl.current.stop(); return; }
      setConvPhase('listening');
      setInput('');

      // Mobile (Android/iOS): continuous mode is unreliable — causes 'network' errors.
      // Use single-shot mode and auto-restart instead.
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      const rec = new SR();
      rec.lang = 'he-IL';
      rec.continuous = !isMobile;  // false on mobile → single-shot + auto-restart
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      let finalTranscript = '';
      let processed = false; // guard: only send once per session

      const submitTranscript = () => {
        if (processed || !convModeRef.current) return;
        const trimmed = finalTranscript.trim();
        finalTranscript = '';
        if (!trimmed) return;
        const stopWords = ['הפסק', 'עצור', 'stop', 'סטופ', 'להפסיק'];
        if (stopWords.some(w => trimmed.toLowerCase().includes(w))) {
          try { rec.stop(); } catch { /* ignore */ }
          convCtrl.current.stop();
          return;
        }
        if (trimmed.length < 4) { setInput(''); return; } // noise fragment
        processed = true;
        try { rec.stop(); } catch { /* ignore */ }
        convRecogRef.current = null;
        setConvPhase('thinking');
        setInput('');
        convCtrl.current.sendText(trimmed);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        // Barge-in: user speaks while TTS plays → cancel TTS, start fresh listen after brief pause
        if (isTTSSpeakingRef.current) {
          cancelSpeech();
          isTTSSpeakingRef.current = false;
          // The audio we just captured was TTS bleed — reset and give mic a moment to clear
          finalTranscript = '';
          setInput('');
          return;
        }

        let newFinal = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) newFinal += e.results[i][0].transcript;
          else setInput(e.results[i][0].transcript); // show interim in real-time
        }
        if (newFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + newFinal;
          finalTranscript = finalTranscript.trim();
          setInput(finalTranscript);
        }

        // Reset silence timer — submit ~1s after user stops talking
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (finalTranscript.trim()) {
          silenceTimerRef.current = setTimeout(submitTranscript, 950);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        if (processed) return;
        if (e.error === 'no-speech') {
          // Normal timeout — restart silently if still in conversation mode
          if (convModeRef.current && !isTTSSpeakingRef.current) setTimeout(() => convCtrl.current.listen(), 150);
        } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          convCtrl.current.stop();
          setError('הגישה למיקרופון נדחתה. אפשר/י הרשאת מיקרופון בדפדפן ונסה/י שנית.');
        } else if (e.error !== 'aborted') {
          if (convModeRef.current && !isTTSSpeakingRef.current) setTimeout(() => convCtrl.current.listen(), 500);
        }
      };

      rec.onend = () => {
        if (processed) return;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (!convModeRef.current || isTTSSpeakingRef.current) return;
        const trimmed = finalTranscript.trim();
        if (trimmed.length >= 4) {
          // rec ended (e.g. max-duration) with unsubmitted transcript → send it
          submitTranscript();
        } else {
          // Nothing useful — restart
          setTimeout(() => convCtrl.current.listen(), 200);
        }
      };

      try { rec.start(); convRecogRef.current = rec; }
      catch {
        // start() can fail if the previous recognition is still releasing the mic — retry
        if (convModeRef.current) setTimeout(() => convCtrl.current.listen(), 400);
      }
    };

    // ── start ────────────────────────────────────────────────────────────────
    convCtrl.current.start = (greet = true) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        // iOS Safari has no SpeechRecognition at all — show a friendly inline error
        setError('מצב שיחה אינו נתמך בדפדפן זה. נסה/י עם Chrome ב-Android.');
        return;
      }
      // CRITICAL: Chrome allows only one SpeechRecognition at a time.
      // Stop the wake word detector so conversation STT can use the mic exclusively.
      wakeWordDetector.stop();
      convModeRef.current = true;
      // Mark all existing messages as already spoken — prevents re-playing last AI response on re-activation
      lastConvSpokenIdxRef.current = messagesLenRef.current - 1;
      setConversationMode(true);
      setWakeAnimation(true);
      setTimeout(() => setWakeAnimation(false), 1500);

      const startListening = () => {
        isTTSSpeakingRef.current = false;
        if (convModeRef.current) setTimeout(() => convCtrl.current.listen(), 400);
      };

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (greet && !isMobile) {
        // Desktop: play greeting → then start listening
        setConvPhase('speaking');
        isTTSSpeakingRef.current = true;
        speak('שלום, אני REY. במה אוכל לעזור?', 1.0, 1.0, 5000)
          .then(startListening)
          .catch(startListening);
      } else {
        // Mobile: UNLOCK TTS right now while we're inside the user gesture.
        // Mobile browsers require speechSynthesis.speak() to be called directly from
        // a gesture handler. Speaking a silent utterance here "unlocks" the TTS API
        // so that all subsequent async speak() calls (AI responses) will work.
        if ('speechSynthesis' in window) {
          try {
            const unlock = new SpeechSynthesisUtterance(' ');
            unlock.volume = 0.01; // near-silent but not 0 (some browsers ignore volume=0)
            unlock.rate   = 2;    // very fast so it ends immediately
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(unlock);
          } catch { /* ignore — TTS may not be available */ }
        }
        // Now open the mic immediately
        isTTSSpeakingRef.current = false;
        setConvPhase('listening');
        setTimeout(() => convCtrl.current.listen(), 300);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once — all state mutations via setters, self-reference via convCtrl.current

  /* ── HEY RAY wake word → start conversation ─────────────────────────── */
  useEffect(() => {
    if (!wakeActivated) return;
    convCtrl.current.start(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeActivated]);

  const handleKeyDown = (e: { key: string; preventDefault: () => void; shiftKey: boolean }) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = async () => {
    // Save current conversation as a session before clearing
    if (messages.length >= 2) {
      const sessionId = await saveSessionToFirestore(messages, wsId);
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
    localStorage.removeItem(historyLocalKey(wsId));
    if (fsSaveTimer.current) clearTimeout(fsSaveTimer.current);
    const histPath = wsId ? `workspaces/${wsId}/ai-history` : 'ai-history';
    setDoc(doc(db, histPath, 'messages'), { messages: [], updatedAt: new Date().toISOString() }).catch(() => {});
    setError(null);
    setStreamingText('');
    setSearchLabel(undefined);
    setCurrentSearches([]);
    setShowHistory(false);
  };

  /* ── Hot leads by activity log ───────────────────────────────────────────── */
  const computeHotScore = (l: Lead): number => {
    const weekAgo = Date.now() - 7 * 86400000;
    const log = (l.activityLog ?? []);
    const lastActTime  = log.length ? new Date(log[log.length - 1].timestamp).getTime() : 0;
    const lastContTime = l.lastContactDate ? new Date(l.lastContactDate).getTime() : 0;
    const mostRecent   = Math.max(lastActTime, lastContTime);
    let score = 0;
    if (mostRecent >= weekAgo)                             score += 40;
    else if (mostRecent >= Date.now() - 14 * 86400000)    score += 20;
    score += (l.aiScore ?? 0) * 0.35;
    if (l.status === 'בתהליך')  score += 20;
    if (l.status === 'חדש')     score += 10;
    if ((l.budget ?? 0) >= 15000) score += 15;
    if ((l.budget ?? 0) >= 5000)  score += 5;
    return Math.round(score);
  };

  const hotLeadsList = [...leads]
    .filter(l => !['לקוח פעיל','לא רלוונטי'].includes(l.status))
    .map(l => ({ lead: l, score: computeHotScore(l) }))
    .filter(x => x.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  /* ── Suggestion chips — fully dynamic, workspace-aware ─────────────────── */
  const hotLeads  = hotLeadsList.length;
  const openTasks = leads.flatMap(l => l.tasks.filter(t => !t.completed)).length;

  // ── My Day tasks (same as Dashboard) ────────────────────────────────────
  const aiTodayISO = new Date().toISOString().split('T')[0];
  const aiUpcomingTasks = [
    ...leads.flatMap(l =>
      (l.tasks ?? []).filter(t => !t.completed).map(t => ({
        id: t.id,
        description: t.description,
        date: t.date,
        time: t.time ?? '',
        priority: (t.priority ?? 'medium') as import('../types').TaskPriority,
        company: l.company ?? '',
        isToday: t.date === aiTodayISO,
        isOverdue: !!t.date && t.date < aiTodayISO,
      }))
    ),
    ..._standaloneTask.filter(t => !t.completed).map(t => ({
      id: t.id,
      description: t.description ?? '',
      date: t.date ?? '',
      time: t.time ?? '',
      priority: (t.priority ?? 'medium') as import('../types').TaskPriority,
      company: t.leadId ? (leads.find(l => l.id === t.leadId)?.company ?? '') : '',
      isToday: t.date === aiTodayISO,
      isOverdue: !!t.date && t.date < aiTodayISO,
    })),
  ]
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(0, 5);

  // Derive workspace context for personalised chips
  const bizName    = workspace?.name     ?? 'העסק שלנו';
  const industry   = workspace?.industry ?? 'שיווק דיגיטלי';
  const services   = workspace?.businessSolutions ?? [];
  const service1   = services[0] ?? 'שירות ראשי';
  const service2   = services[1] ?? 'שירות שני';

  // Pick a real "in-progress" lead name for action chips (fallback to generic)
  const inProgressLead = leads.find(l => l.status === 'בתהליך');
  const newLead        = leads.find(l => l.status === 'חדש');
  const activeLead     = leads.find(l => l.status === 'לקוח פעיל');
  const leadForTask    = inProgressLead ?? newLead ?? leads[0];
  const leadName       = leadForTask?.company ?? 'הליד הראשון';

  const suggestions = [
    {
      icon: <TrendingUp size={12} />,
      text: `אילו לידים הם הכי חמים עכשיו מתוך ${leads.length} הלידים?`,
      cat: 'crm',
    },
    {
      icon: <ListTodo size={12} />,
      text: `צור משימת מעקב ל${leadName} להיום`,
      cat: 'action',
    },
    {
      icon: <FileText size={12} />,
      text: `נסח הצעת מחיר ל${service1} ל${activeLead?.company ?? 'לקוח פעיל'}`,
      cat: 'crm',
    },
    {
      icon: <Globe size={12} />,
      text: `מה המגמות האחרונות בתחום ${industry} שכדאי לדעת?`,
      cat: 'web',
    },
    {
      icon: <Tag size={12} />,
      text: `עדכן לידים ישנים שלא נסגרו ל"רימרקטינג"`,
      cat: 'action',
    },
    {
      icon: <MessageSquare size={12} />,
      text: `תן לי 5 רעיונות לתוכן שיווקי עבור ${bizName} בתחום ${service2}`,
      cat: 'web',
    },
    {
      icon: <StickyNote size={12} />,
      text: `הוסף הערה ל${leadName} שדיברתי איתם היום`,
      cat: 'action',
    },
    {
      icon: <Building2 size={12} />,
      text: `מה הסטטוס של כל הלקוחות הפעילים ב${bizName}?`,
      cat: 'crm',
    },
  ];

  const isIdle = messages.length === 0 && !loading;

  /* ── Milestones ─────────────────────────────────────────────────────────── */
  const milestoneData = useMemo(() => getMilestoneProgress({
    leads, standaloneTask: _standaloneTask, team, workspace,
  }), [leads, _standaloneTask, team, workspace]); // eslint-disable-line

  /* ── Welcome-screen animation sequence ─────────────────────────────────── */
  const greetingFull = `שלום ${currentUser.split(' ')[0]}! 👋`;
  useEffect(() => {
    if (!isIdle) { setWelcomePhase(0); setTypedLen(0); return; }
    setWelcomePhase(0);
    setTypedLen(0);
    // phase 0→1 (avatar appears): 300ms
    const t0 = setTimeout(() => {
      setWelcomePhase(1);
      // typewriter
      let i = 0;
      const iv = setInterval(() => {
        i++;
        setTypedLen(i);
        if (i >= greetingFull.length) { clearInterval(iv); }
      }, 50);
      // phase 1→2 after greeting done
      const t1 = setTimeout(() => setWelcomePhase(2), greetingFull.length * 50 + 300);
      // phase 2→3 (actions)
      const t2 = setTimeout(() => setWelcomePhase(3), greetingFull.length * 50 + 900);
      return () => { clearInterval(iv); clearTimeout(t1); clearTimeout(t2); };
    }, 300);
    return () => clearTimeout(t0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIdle]);

  return (
    <div
      dir={dir}
      className={`flex flex-col overflow-hidden relative ${
        onClose
          ? 'h-full'   /* side panel: fill parent container */
          : 'h-[calc(100vh-180px)] md:h-[calc(100vh-120px)] md:rounded-2xl'  /* full page */
      }`}
      style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.18)', boxShadow: '0 4px 32px rgba(99,102,241,0.1)' }}
    >
      {/* ── HEY RAY wake animation overlay ──────────────────────────────────── */}
      {wakeAnimation && (
        <div
          className="absolute inset-0 z-50 pointer-events-none rounded-inherit flex items-center justify-center"
          style={{ animation: 'fadeOut 1.5s ease forwards' }}
        >
          <div
            className="absolute inset-0 rounded-inherit"
            style={{ background: 'radial-gradient(circle at center, rgba(99,102,241,0.25) 0%, transparent 70%)', animation: 'ping 0.8s ease' }}
          />
          <div
            className="text-2xl font-black tracking-wider"
            style={{ color: '#a5b4fc', textShadow: '0 0 20px rgba(99,102,241,0.8)', animation: 'fadeSlideUp 0.4s ease' }}
          >
            👋 שלום! איך אעזור?
          </div>
        </div>
      )}

      {/* ── Header — also the drag handle when floating ─────────────────────── */}
      <div
        {...(dragHandleProps ?? {})}
        className="flex items-center justify-between px-3 py-2.5 flex-shrink-0 gap-2"
        style={{
          background: 'rgba(99,102,241,0.08)',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
          ...((dragHandleProps?.style as React.CSSProperties) ?? {}),
        }}
      >
        {/* ── Left: RAY identity ── */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', boxShadow: '0 0 14px rgba(99,102,241,0.45)' }}
          >
            <Sparkles size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>
                {t('ai.chatTitle')}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
            </div>
            {/* Says what this chat can see. The assistant reads the specialist
                chats, and a capability nobody can tell is there is a capability
                nobody uses — so it is named, and named honestly: it lists the
                chats that actually have a conversation to read. */}
            <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {brainSources.length > 0
                ? `המוח המרכזי · קורא גם את ${brainSources.join(' · ')}`
                : 'claude-opus-4-6'}
            </div>
          </div>
        </div>

        {/* ── Right: icon actions ── */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Web search toggle */}
          <button
            onClick={() => setWebSearchEnabled(v => !v)}
            title={webSearchEnabled ? 'כבה חיפוש אינטרנט' : 'הפעל חיפוש אינטרנט'}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={
              webSearchEnabled
                ? { background: 'rgba(139,92,246,0.18)', color: '#c4b5fd' }
                : { color: 'rgba(255,255,255,0.3)' }
            }
          >
            <Globe size={14} />
          </button>

          {/* History toggle */}
          <button
            onClick={() => setShowHistory(v => !v)}
            title={showHistory ? 'סגור היסטוריה' : 'פתח היסטוריה'}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={
              showHistory
                ? { background: 'rgba(139,92,246,0.18)', color: '#c4b5fd' }
                : { color: 'rgba(255,255,255,0.3)' }
            }
          >
            <History size={14} />
          </button>

          {/* Clear — only when there are messages */}
          {messages.length > 0 && !showHistory && (
            <button
              onClick={clearChat}
              title={t('ai.clearHistory')}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-red-500/10"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Divider */}
          {(onExpand || onClose) && (
            <div className="w-px h-5 mx-1 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
          )}

          {/* Panel controls — only when rendered as side panel */}
          {onExpand && (
            <button
              onClick={onExpand}
              title={isExpanded ? 'כווץ' : 'הגדל'}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="סגור"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              <PanelRightClose size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Active searches bar ─────────────────────────────────────────────── */}
      {currentSearches.length > 0 && loading && (
        <div
          className="flex items-center gap-2 px-5 py-2 flex-shrink-0 overflow-x-auto"
          style={{ background: 'rgba(139,92,246,0.08)', borderBottom: '1px solid rgba(139,92,246,0.15)' }}
        >
          <Globe size={12} className="text-violet-400 flex-shrink-0" />
          <span className="text-[11px] flex-shrink-0" style={{ color: '#c4b5fd' }}>{t('ai.searching')}:</span>
          {currentSearches.map((q, i) => (
            <span
              key={i}
              className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: '#c4b5fd' }}
            >
              {q}
            </span>
          ))}
        </div>
      )}

      {/* ── History Panel ──────────────────────────────────────────────────── */}
      {showHistory && (
        <HistoryPanel
          sessions={sessions}
          currentMessages={messages}
          onClose={() => setShowHistory(false)}
          loading={sessionsLoading}
        />
      )}

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {!showHistory && (
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

          {/* ══════════════════════════════════════════════════
               Welcome / onboarding screen (isIdle)
               Phase 0 → avatar pulse
               Phase 1 → typewriter greeting + subtitle
               Phase 2 → insight strip
               Phase 3 → action cards + suggestion chips
          ══════════════════════════════════════════════════ */}
          {isIdle && (
            <div className="flex flex-col items-center justify-start h-full text-center gap-4 pt-4 pb-4 overflow-y-auto">

              {/* ── Avatar with pulse rings ── */}
              <div
                className="relative flex items-center justify-center"
                style={{
                  opacity: welcomePhase >= 0 ? 1 : 0,
                  transform: welcomePhase >= 0 ? 'scale(1)' : 'scale(0.5)',
                  transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                }}
              >
                {/* Outer pulse ring */}
                <div
                  className="absolute rounded-3xl"
                  style={{
                    width: 96, height: 96,
                    background: 'transparent',
                    border: '2px solid rgba(99,102,241,0.25)',
                    animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                  }}
                />
                {/* Mid ring */}
                <div
                  className="absolute rounded-3xl"
                  style={{
                    width: 88, height: 88,
                    background: 'transparent',
                    border: '1.5px solid rgba(139,92,246,0.2)',
                    animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                    animationDelay: '0.4s',
                  }}
                />
                {/* Core avatar */}
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-xl relative z-10"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', boxShadow: '0 0 40px rgba(99,102,241,0.5)' }}
                >
                  <Bot size={34} className="text-white" />
                </div>
                {/* Web-search badge */}
                {webSearchEnabled && (
                  <div
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg flex items-center justify-center z-20"
                    style={{ background: '#10b981', border: '2px solid #0a0f1e' }}
                  >
                    <Globe size={12} className="text-white" />
                  </div>
                )}
              </div>

              {/* ── Typewriter greeting ── */}
              <div
                style={{
                  opacity: welcomePhase >= 1 ? 1 : 0,
                  transform: welcomePhase >= 1 ? 'translateY(0)' : 'translateY(10px)',
                  transition: 'opacity 0.4s ease, transform 0.4s ease',
                }}
              >
                <p className="font-black text-2xl tracking-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>
                  {greetingFull.slice(0, typedLen)}
                  {typedLen < greetingFull.length && (
                    <span className="inline-block w-0.5 h-5 ml-0.5 align-middle rounded-sm" style={{ background: '#a5b4fc', animation: 'blink 0.9s step-end infinite' }} />
                  )}
                </p>
                <p className="text-sm mt-1.5 font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  אני <span style={{ color: '#a5b4fc' }}>REY</span> — העוזר החכם שלך ב{workspace?.name ?? 'המערכת'}
                </p>
              </div>

              {/* ── Insight strip (phase 2+) ── */}
              {welcomePhase >= 2 && (
                <div
                  className="w-full max-w-xs rounded-2xl px-4 py-3 text-right"
                  style={{
                    background: hotLeads > 0
                      ? 'linear-gradient(135deg,rgba(251,146,60,0.1),rgba(239,68,68,0.07))'
                      : 'rgba(99,102,241,0.08)',
                    border: hotLeads > 0
                      ? '1px solid rgba(251,146,60,0.25)'
                      : '1px solid rgba(99,102,241,0.2)',
                    animation: 'fadeSlideUp 0.45s ease both',
                  }}
                >
                  <div className="flex items-center gap-2 justify-end mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      סטטוס מערכת
                    </span>
                    <Zap size={11} style={{ color: hotLeads > 0 ? '#fb923c' : '#818cf8' }} />
                  </div>
                  <div className="flex gap-2 justify-center">
                    {[
                      { val: leads.length,  label: 'לידים',   color: '#a5b4fc', bg: 'rgba(99,102,241,0.12)' },
                      { val: hotLeads,      label: '🔥 חמים', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
                      { val: openTasks,     label: 'משימות',  color: '#34d399', bg: 'rgba(52,211,153,0.1)'  },
                    ].map(s => (
                      <div key={s.label} className="flex-1 rounded-xl py-2 text-center"
                        style={{ background: s.bg, border: `1px solid ${s.color}22` }}>
                        <div className="text-lg font-black" style={{ color: s.color }}>{s.val}</div>
                        <div className="text-[9px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {hotLeads > 0 && (
                    <button
                      onClick={() => { setInput(`אילו לידים הם הכי חמים עכשיו מתוך ${leads.length} הלידים?`); inputRef.current?.focus(); }}
                      className="mt-2 w-full text-xs font-semibold py-1.5 rounded-xl transition-all"
                      style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}
                    >
                      ← ניתוח לידים חמים
                    </button>
                  )}
                </div>
              )}

              {/* ── Milestone progress (phase 2+) ── */}
              {welcomePhase >= 2 && milestoneData.done < milestoneData.total && (
                <div className="w-full max-w-xs" style={{ animation: 'fadeSlideUp 0.4s ease 0.1s both' }}>
                  <div className="flex items-center justify-between mb-1.5 px-0.5">
                    <span className="text-[10px] font-bold" style={{ color: 'rgba(167,139,250,0.8)' }}>
                      הגדרת המערכת — {milestoneData.done}/{milestoneData.total}
                    </span>
                    {milestoneData.nextMilestone && (
                      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        הבא: {milestoneData.nextMilestone.icon} {milestoneData.nextMilestone.label}
                      </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(milestoneData.done / milestoneData.total) * 100}%`,
                        background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
                        boxShadow: '0 0 8px rgba(99,102,241,0.4)',
                      }}
                    />
                  </div>
                  {/* Milestone dots */}
                  <div className="flex justify-between mt-1">
                    {MILESTONE_DEFS.map((m, i) => (
                      <div key={m.id} title={m.label}
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all"
                        style={i < milestoneData.done
                          ? { background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.5)' }
                          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', filter: 'grayscale(1) opacity(0.4)' }
                        }>
                        {m.icon}
                      </div>
                    ))}
                  </div>
                  {milestoneData.nextMilestone && (
                    <button
                      onClick={() => { setInput(`איך אני מבצע: ${milestoneData.nextMilestone!.label}?`); inputRef.current?.focus(); }}
                      className="mt-2 w-full text-[11px] font-semibold py-1.5 rounded-xl transition-all"
                      style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}
                    >
                      ← {milestoneData.nextMilestone.icon} איך מבצעים: {milestoneData.nextMilestone.label}?
                    </button>
                  )}
                </div>
              )}

              {/* ── My Day tasks (phase 2+) ── */}
              {welcomePhase >= 2 && aiUpcomingTasks.length > 0 && (
                <div className="w-full max-w-xs" style={{ animation: 'fadeSlideUp 0.4s ease 0.15s both' }}>
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <span className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {aiUpcomingTasks.length} משימות
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>☀️ היום שלי</span>
                  </div>
                  <div className="space-y-1.5">
                    {aiUpcomingTasks.map(t => (
                      <div key={t.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl"
                        style={{
                          background: t.isOverdue ? 'rgba(239,68,68,0.08)' : t.isToday ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${t.isOverdue ? 'rgba(239,68,68,0.25)' : t.isToday ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)'}`,
                        }}>
                        <span className="text-xs flex-shrink-0">{t.isOverdue ? '⚠️' : t.isToday ? '☀️' : '📅'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{t.description}</p>
                          {t.company && <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{t.company}</p>}
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-lg flex-shrink-0"
                          style={t.priority === 'high'
                            ? { background: 'rgba(239,68,68,0.2)', color: '#f87171' }
                            : t.priority === 'medium'
                              ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                              : { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }
                          }>
                          {t.priority === 'high' ? 'דחוף' : t.priority === 'medium' ? 'בינוני' : 'נמוך'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setInput('מה המשימות שלי להיום?'); inputRef.current?.focus(); }}
                    className="mt-2 w-full text-[11px] font-semibold py-1.5 rounded-xl transition-all"
                    style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}
                  >
                    ← פרט את המשימות שלי
                  </button>
                </div>
              )}

              {/* ── Action category cards (phase 3+) ── */}
              {welcomePhase >= 3 && (
                <>
                  <p className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>במה אני יכול לעזור לך היום?</p>

                  <div className="grid grid-cols-2 gap-2 w-full max-w-xs" style={{ animation: 'fadeSlideUp 0.4s ease both' }}>
                    {[
                      {
                        emoji: '🔥',
                        title: 'ניתוח לידים',
                        desc: 'זהה הזדמנויות',
                        query: `אילו לידים הם הכי חמים עכשיו מתוך ${leads.length} הלידים?`,
                        grad: 'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(239,68,68,0.1))',
                        border: 'rgba(249,115,22,0.3)',
                        glow: 'rgba(249,115,22,0.15)',
                      },
                      {
                        emoji: '✅',
                        title: 'ניהול משימות',
                        desc: 'צור וארגן',
                        query: `צור משימת מעקב ל${leadName} להיום`,
                        grad: 'linear-gradient(135deg,rgba(52,211,153,0.12),rgba(16,185,129,0.08))',
                        border: 'rgba(52,211,153,0.25)',
                        glow: 'rgba(52,211,153,0.12)',
                      },
                      {
                        emoji: '✍️',
                        title: 'תוכן שיווקי',
                        desc: 'הצעות ומסרים',
                        query: `נסח הצעת מחיר ל${service1} ל${activeLead?.company ?? 'לקוח פעיל'}`,
                        grad: 'linear-gradient(135deg,rgba(96,165,250,0.12),rgba(59,130,246,0.08))',
                        border: 'rgba(96,165,250,0.25)',
                        glow: 'rgba(96,165,250,0.12)',
                      },
                      {
                        emoji: '🌐',
                        title: 'מחקר שוק',
                        desc: 'מגמות ותחרות',
                        query: `מה המגמות האחרונות בתחום ${industry} שכדאי לדעת?`,
                        grad: 'linear-gradient(135deg,rgba(139,92,246,0.12),rgba(99,102,241,0.08))',
                        border: 'rgba(139,92,246,0.25)',
                        glow: 'rgba(139,92,246,0.12)',
                      },
                    ].map((card, i) => (
                      <button
                        key={card.title}
                        onClick={() => { setInput(card.query); inputRef.current?.focus(); }}
                        className="relative rounded-2xl p-3 text-right flex flex-col gap-1.5 transition-all duration-200 hover:scale-[1.03] group"
                        style={{
                          background: card.grad,
                          border: `1px solid ${card.border}`,
                          boxShadow: `0 0 0 0 ${card.glow}`,
                          animation: `fadeSlideUp 0.4s ease ${0.06 * i}s both`,
                        }}
                      >
                        <span className="text-xl leading-none">{card.emoji}</span>
                        <div>
                          <div className="text-[13px] font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>{card.title}</div>
                          <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>{card.desc}</div>
                        </div>
                        <ArrowRight size={11} className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'rgba(255,255,255,0.6)', transform: 'rotate(180deg)' }} />
                      </button>
                    ))}
                  </div>

                  {/* Hot leads mini-list */}
                  {hotLeadsList.length > 0 && (
                    <div className="w-full max-w-xs space-y-1" style={{ animation: 'fadeSlideUp 0.45s ease 0.2s both' }}>
                      <p className="text-[10px] font-bold text-right px-1 flex items-center gap-1.5 justify-end"
                         style={{ color: 'rgba(251,146,60,0.7)' }}>
                        לידים דורשים תשומת לב
                        <Zap size={10} className="text-orange-400" />
                      </p>
                      {hotLeadsList.slice(0, 3).map(({ lead: l, score }) => (
                        <button
                          key={l.id}
                          onClick={() => { setInput(`תן לי ניתוח ועצה עבור הליד ${l.company} — ${l.contactName}`); inputRef.current?.focus(); }}
                          className="w-full text-right px-3 py-2 rounded-xl text-xs flex items-center gap-2 transition-all hover:scale-[1.01]"
                          style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.18)', color: 'rgba(255,255,255,0.75)' }}
                        >
                          <span className="flex-shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(249,115,22,0.2)', color: '#fb923c' }}>
                            {score}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">{l.company}</div>
                            <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
                              {l.status} · {l.contactName}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* More suggestions row */}
                  <div className="w-full max-w-xs" style={{ animation: 'fadeSlideUp 0.45s ease 0.3s both' }}>
                    <p className="text-[10px] font-semibold text-right mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>או נסה:</p>
                    <div className="flex flex-col gap-1">
                      {suggestions.slice(4, 7).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                          className="text-[11px] text-right px-3 py-2 rounded-xl transition-all hover:scale-[1.005] flex items-center gap-2"
                          style={
                            s.cat === 'action'
                              ? { background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', color: 'rgba(52,211,153,0.8)' }
                              : s.cat === 'web'
                              ? { background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', color: 'rgba(165,180,252,0.8)' }
                              : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }
                          }
                        >
                          <span className="opacity-60 flex-shrink-0">{s.icon}</span>
                          <span className="truncate">{s.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Team pill */}
                  {team.length > 1 && (
                    <div className="text-[11px] flex items-center gap-1.5 mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      <User size={11} />
                      צוות: {team.map(m => m.name.split(' ')[0]).join(', ')}
                    </div>
                  )}
                </>
              )}
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
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium" style={{ color: '#fca5a5' }}>{t('common.error')}</div>
                <div className="text-xs mt-0.5" style={{ color: 'rgba(252,165,165,0.75)' }}>{error}</div>
                {(error.includes('עמוסים') || error.includes('מכסת')) && (
                  <button
                    onClick={() => { setError(null); sendMessage(); }}
                    disabled={loading}
                    className="mt-2 text-xs px-3 py-1 rounded-lg transition-colors"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                  >
                    {t('common.retry')}
                  </button>
                )}
              </div>
              <button onClick={() => setError(null)} style={{ color: 'rgba(252,165,165,0.6)' }}><X size={14}/></button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input bar ───────────────────────────────────────────── */}
      {!showHistory && (
        <div
          className="px-3 py-2.5 flex-shrink-0"
          style={{ background: 'rgba(10,15,30,0.92)', borderTop: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)', paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
        >
          {/* Conversation mode banner — above input so it's always visible */}
          {conversationMode && (
            <div className="mb-2 flex flex-col gap-1.5">
              <div
                className="rounded-xl px-3 py-1.5 flex items-center gap-2 justify-between"
                style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: convPhase === 'listening' ? '#34d399' : convPhase === 'speaking' ? '#60a5fa' : '#f59e0b',
                      animation: convPhase !== 'thinking' ? 'pulse 1s infinite' : undefined,
                    }}
                  />
                  <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: '#34d399' }}>
                    {convPhase === 'listening' ? 'מקשיב...' : convPhase === 'speaking' ? 'RAY מדבר...' : 'RAY חושב...'}
                  </span>
                  {convPhase === 'listening' && input && (
                    <span className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      "{input}"
                    </span>
                  )}
                </div>
                <button
                  onClick={() => convCtrl.current.stop()}
                  className="flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  עצור
                </button>
              </div>

              {/* Mobile "tap to hear" button — shows when TTS is pending a user gesture */}
              {pendingConvTTS && (
                <button
                  onClick={() => {
                    const text = pendingConvTTSRef.current;
                    if (!text) return;
                    if (convTTSFallbackRef.current) { clearTimeout(convTTSFallbackRef.current); convTTSFallbackRef.current = null; }
                    pendingConvTTSRef.current = null;
                    setPendingConvTTS(null);
                    speak(text, 1.0, 1.0, 10000)
                      .then(() => {
                        isTTSSpeakingRef.current = false;
                        if (convModeRef.current) setTimeout(() => convCtrl.current.listen(), 400);
                      })
                      .catch(() => {
                        isTTSSpeakingRef.current = false;
                        if (convModeRef.current) setTimeout(() => convCtrl.current.listen(), 400);
                      });
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl font-bold text-sm active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,rgba(96,165,250,0.2),rgba(99,102,241,0.2))', border: '1px solid rgba(96,165,250,0.4)', color: '#93c5fd', animation: 'pulse 1.5s infinite' }}
                >
                  <Volume2 size={16} />
                  <span>הקש לשמיעת התשובה</span>
                </button>
              )}
            </div>
          )}

          <div
            className="flex gap-1.5 items-end rounded-xl px-3 py-2.5 transition-all"
            style={
              voiceRecording
                ? { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.4)' }
                : conversationMode
                ? { background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.3)' }
                : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(99,102,241,0.2)' }
            }
          >
            {webSearchEnabled && !voiceRecording && !conversationMode && (
              <Globe size={13} className="text-violet-400 flex-shrink-0 mb-1.5" />
            )}
            {voiceRecording && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0 mb-2" />
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                conversationMode
                  ? (convPhase === 'listening' ? 'מקשיב... דבר עכשיו' : convPhase === 'speaking' ? 'RAY מדבר...' : 'ממתין...')
                  : voiceRecording ? t('ai.voiceRecording')
                  : webSearchEnabled ? t('ai.placeholderWeb')
                  : t('ai.placeholderDefault')
              }
              rows={2}
              className="flex-1 resize-none bg-transparent text-sm focus:outline-none text-right min-w-0"
              style={{ direction: 'rtl', color: 'rgba(255,255,255,0.85)', minHeight: 44, maxHeight: 120, lineHeight: '1.5' }}
            />
            {/* Conversation mode toggle */}
            <button
              onClick={() => conversationMode ? convCtrl.current.stop() : convCtrl.current.start(true)}
              title={conversationMode ? 'עצור שיחה קולית' : 'שיחה קולית (HEY RAY)'}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all active:scale-95 text-[14px] relative"
              style={conversationMode
                ? { background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.5)' }
                : { color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
              }
            >
              {conversationMode ? (
                <span>
                  {convPhase === 'listening' ? '🎙' : convPhase === 'speaking' ? '🔊' : '⏳'}
                </span>
              ) : '🎙'}
              {conversationMode && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400"
                  style={{ animation: 'pulse 1s infinite' }} />
              )}
            </button>
            {/* Single-shot dictation */}
            {!conversationMode && (
              <button
                onClick={toggleVoice}
                title={voiceRecording ? t('common.stop') : t('ai.voiceInput')}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all active:scale-95"
                style={
                  voiceRecording
                    ? { background: '#ef4444' }
                    : { color: 'rgba(255,255,255,0.2)', background: 'transparent' }
                }
              >
                {voiceRecording ? <MicOff size={13} className="text-white" /> : <Mic size={13} />}
              </button>
            )}
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading || conversationMode}
              className="w-8 h-8 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
            >
              {loading
                ? <Loader2 size={13} className="text-white animate-spin" />
                : <Send size={13} className="text-white" />}
            </button>
          </div>

          <div className="flex items-center justify-between mt-1 px-0.5">
            <div className="flex items-center gap-1.5">
              {conversationMode ? (
                <span className="text-[10px] flex items-center gap-1" style={{ color: '#34d399' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  שיחה קולית — אמור "הפסק" לעצירה
                </span>
              ) : voiceRecording ? (
                <span className="text-[10px] text-red-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> {t('ai.recording')}
                </span>
              ) : (
                <span className="text-[10px] flex items-center gap-1" style={{ color: '#a5b4fc' }}>
                  <Zap size={9} /> {t('ai.agentConnected')} · 🎙 שיחה · HEY RAY
                </span>
              )}
            </div>
            {!conversationMode && <p className="text-[10px] hidden sm:block" style={{ color: 'rgba(255,255,255,0.2)' }}>{t('ai.inputHint')}</p>}
          </div>
        </div>
      )}

      {/* Conversation mode overlay — rendered via portal so it covers everything */}
      {conversationMode && (
        <ConversationOverlay
          phase={convPhase}
          transcript={input}
          onStop={() => convCtrl.current.stop()}
        />
      )}
    </div>
  );
}
