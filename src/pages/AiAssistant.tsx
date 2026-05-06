import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Send, Bot, User, Sparkles, Loader2, AlertCircle,
  Globe, Search, X, Zap,
  Building2, TrendingUp, FileText, MessageSquare,
  Mic, MicOff, CheckCircle2, ListTodo, Tag, StickyNote,
  History, Trash2,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, StandaloneTask, TaskPriority, TeamMember } from '../types';
import { getApiKey } from '../lib/apiKey';

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
];

/* ─── localStorage helpers ───────────────────────────────────────────────── */
const HISTORY_KEY = 'ray-ai-history';
const MAX_HISTORY  = 60;

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch { return []; }
}

function saveHistory(msgs: Message[]) {
  try {
    const toSave = msgs.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded - silently ignore */ }
}

/* ─── Build system prompt ────────────────────────────────────────────────── */
function buildSystemBlocks(leads: Lead[], currentUser: string) {
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

  const dynamicPart = `\n**נתוני לידים (${leads.length} סה"כ):**\n${leadsSummary}`;

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
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function AiAssistant({
  leads, team, currentUser, standaloneTask: _standaloneTask,
  onCreateTask, onUpdateLead, onAddNote,
}: AiAssistantProps) {

  const [messages,          setMessages]          = useState<Message[]>(loadHistory);
  const [input,             setInput]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [streamingText,     setStreamingText]     = useState('');
  const [searchLabel,       setSearchLabel]       = useState<string | undefined>();
  const [webSearchEnabled,  setWebSearchEnabled]  = useState(true);
  const [currentSearches,   setCurrentSearches]   = useState<string[]>([]);
  const [voiceRecording,    setVoiceRecording]    = useState(false);
  const [showHistory,       setShowHistory]       = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const voiceRecogRef  = useRef<unknown>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, searchLabel]);

  // Persist history
  useEffect(() => {
    if (messages.length > 0) saveHistory(messages);
  }, [messages]);

  /* ── Execute CRM tool ─────────────────────────────────────────────────── */
  const executeCRMTool = useCallback((
    name: string,
    input: Record<string, unknown>,
  ): { text: string; label: string; success: boolean } => {
    try {
      if (name === 'create_task') {
        const today = new Date().toISOString().split('T')[0];
        const task: StandaloneTask = {
          id:          Date.now().toString(),
          description: String(input.description ?? ''),
          notes:       input.notes ? String(input.notes) : undefined,
          date:        String(input.date ?? today),
          time:        String(input.time ?? '09:00'),
          priority:    (input.priority as TaskPriority) ?? 'medium',
          completed:   false,
          assignedTo:  String(input.assignedTo ?? currentUser),
          assignedBy:  currentUser,
          leadId:      input.leadId ? String(input.leadId) : undefined,
          createdAt:   new Date().toISOString(),
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

      return { text: `❓ כלי לא מוכר: ${name}`, label: 'שגיאה', success: false };
    } catch (e) {
      return { text: `❌ שגיאה: ${e instanceof Error ? e.message : 'Unknown'}`, label: 'שגיאה', success: false };
    }
  }, [leads, currentUser, onCreateTask, onUpdateLead, onAddNote]);

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
      const response: any = await (client.messages as any).create({
        model:      'claude-opus-4-6',
        max_tokens: 4096,
        system:     systemBlocks,
        messages:   msgs,
        tools,
      });

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
    const systemBlocks = buildSystemBlocks(leads, currentUser);

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
      const msg = err instanceof Error ? err.message : 'שגיאה בתקשורת עם ה-AI';
      if (webSearchEnabled && msg.includes('web_search')) {
        setError('חיפוש אינטרנט אינו זמין. עוצר חיפוש ומנסה שנית...');
        setWebSearchEnabled(false);
      } else {
        setError(msg);
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

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
    setError(null);
    setStreamingText('');
    setSearchLabel(undefined);
    setCurrentSearches([]);
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
    <div className="flex flex-col h-[calc(100vh-64px)] md:h-[calc(100vh-120px)] bg-slate-900 md:rounded-2xl border-0 md:border border-slate-700/50 shadow-2xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60 bg-gradient-to-l from-indigo-900/30 to-slate-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* History toggle */}
          {messages.length > 0 && (
            <button onClick={() => setShowHistory(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg transition-colors ${showHistory ? 'bg-indigo-800/60 text-indigo-300' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
              <History size={12} /> {messages.length} הודעות
            </button>
          )}
          {/* Clear */}
          {messages.length > 0 && (
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

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

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
            <div>
              <div className="text-red-300 font-medium">שגיאה</div>
              <div className="text-red-400/80 text-xs mt-0.5">{error}</div>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-400 flex-shrink-0"><X size={14}/></button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-700/60 px-4 py-3 bg-slate-900 flex-shrink-0">
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
      </div>
    </div>
  );
}
