import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, Sparkles, Loader2, AlertCircle,
  Globe, Search, RotateCcw, X, Zap,
  Building2, TrendingUp, FileText, MessageSquare,
  Mic, MicOff,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead } from '../types';
import { getApiKey } from '../lib/apiKey';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  searches?: string[];
  searchStatus?: 'searching' | 'done';
  timestamp?: Date;
}

interface AiAssistantProps {
  leads: Lead[];
}

/* ─── System prompt ──────────────────────────────────────────────────────── */
function buildSystemBlocks(leads: Lead[]) {
  const staticPart = `אתה עוזר AI חכם של מערכת CRM בשם RAY Lead Manager. אתה עונה תמיד בעברית, בצורה מובנית וברורה.

RAY Digital היא סוכנות שיווק דיגיטלית AI-First המתמחה בנדל"ן ובתחום הנכסים.
שירותים: דמיות ויזואליות (Renders), אתר פרימיום, קמפיין פרסום ממומן, ניהול מדיה חברתית, קריאייטיב (UGC/ריל/פוסטים), SEO.
לקוחות: קבלנים, יזמי נדל"ן, סוכני נדל"ן, חברות בנייה, פרויקטים למגורים ומסחר.
סטטוסים: חדש → בתהליך → לקוח פעיל | רימרקטינג | לא רלוונטי.

**יכולות שלך:**
- ניתוח וסיכום לידים בצורה חכמה
- זיהוי לידים עם תקציב גבוה ועדיפות גבוהה
- חיפוש מידע עדכני מהאינטרנט על חברות ושווקים בנדל"ן
- ניסוח מיילים ומסרים שיווקיים מקצועיים
- המלצות מבוססות נתונים לסגירת עסקאות
- מחקר שוק הנדל"ן וחדשות רלוונטיות
- ניתוח מתחרים ומגמות בשיווק דיגיטלי לנדל"ן
- ניסוח פוסטים, תסריטים לסרטונים ותוכן שיווקי

**פורמט תשובות:**
- השתמש בכותרות **מודגשות** להדגשה
- השתמש ברשימות נקודות לפירוטים
- הוסף נתונים ספציפיים כשאפשר
- ציין מקורות כשאתה מחפש באינטרנט`;

  const leadsSummary = leads.slice(0, 50).map(l => {
    const tasksOpen = l.tasks.filter(t => !t.completed).length;
    const solutions = l.solutions.map(s => s.name).join(', ') || 'אין';
    const budgetStr = l.budget > 0 ? `₪${l.budget.toLocaleString()}/חודש` : 'לא ידוע';
    return `• ${l.company} (${l.contactName}) | ${l.status} | תקציב: ${budgetStr} | שירותים: ${solutions} | ציון: ${l.aiScore}% | משימות: ${tasksOpen}${l.waitingContent ? ' | ממתין לתוכן' : ''}`;
  }).join('\n');

  const dynamicPart = `\n**נתוני לידים עדכניים (${leads.length} לידים סה"כ):**\n${leadsSummary}`;

  return [
    { type: 'text' as const, text: staticPart, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: dynamicPart },
  ];
}

/* ─── Simple Markdown renderer ───────────────────────────────────────────── */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
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
    if (!trimmed) {
      flushList();
      result.push(<div key={key++} className="h-1.5" />);
      return;
    }

    if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      flushList();
      const text = trimmed.replace(/^#+\s/, '');
      result.push(<div key={key++} className="font-bold text-white text-sm mt-3 mb-1">{text}</div>);
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      listItems.push(trimmed.slice(2));
      return;
    }

    const numMatch = trimmed.match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      listItems.push(numMatch[2]);
      return;
    }

    flushList();
    result.push(<div key={key++} className="leading-relaxed">{applyInline(trimmed)}</div>);
  });

  flushList();
  return result;
}

function applyInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    if (!boldMatch && !codeMatch) {
      parts.push(<span key={k++}>{remaining}</span>);
      break;
    }

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

/* ─── Message Bubble ─────────────────────────────────────────────────────── */
function MessageBubble({ msg, isStreaming }: { msg: Message; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-indigo-600 to-indigo-800'
          : 'bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600'
      }`}>
        {isUser
          ? <User size={14} className="text-white" />
          : <Bot size={14} className="text-indigo-400" />
        }
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>

        {/* Search indicator */}
        {!isUser && msg.searches && msg.searches.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {msg.searches.map((q, i) => (
              <span key={i} className="flex items-center gap-1 bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 text-[10px] px-2 py-1 rounded-full">
                <Globe size={9} />
                {q}
              </span>
            ))}
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
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 rounded-sm" />
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        {msg.timestamp && (
          <span className="text-[10px] text-slate-600 px-1">
            {msg.timestamp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Searching indicator ────────────────────────────────────────────────── */
function SearchingBubble({ query }: { query?: string }) {
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
        {query ? (
          <span className="text-xs text-indigo-300 flex items-center gap-1.5">
            <Search size={11} />
            מחפש: <em className="text-white">{query}</em>
          </span>
        ) : (
          <span className="text-xs text-slate-400">חושב...</span>
        )}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function AiAssistant({ leads }: AiAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [searchState, setSearchState] = useState<{ active: boolean; query?: string }>({ active: false });
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [currentSearches, setCurrentSearches] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const voiceRecogRef = useRef<unknown>(null);

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
      setInput(prev => (prev ? prev + ' ' + text : text));
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    recog.onend = () => setVoiceRecording(false);
    recog.onerror = () => setVoiceRecording(false);
    recog.start();
    voiceRecogRef.current = recog;
    setVoiceRecording(true);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, searchState]);

  /* ── Agentic loop with web search ───────────────────────────────────────── */
  const runWithWebSearch = useCallback(async (
    client: Anthropic,
    msgs: { role: 'user' | 'assistant'; content: string | unknown[] }[],
    systemBlocks: ReturnType<typeof buildSystemBlocks>,
  ): Promise<{ text: string; searches: string[] }> => {
    const allSearches: string[] = [];

    for (let turn = 0; turn < 5; turn++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqPayload: any = {
        model: 'claude-opus-4-6',
        max_tokens: 3000,
        system: systemBlocks,
        messages: msgs,
      };

      if (webSearchEnabled) {
        reqPayload.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await (client.messages as any).create(reqPayload);
      const content: unknown[] = response.content || [];

      // Extract text blocks
      const textParts = content
        .filter((b: unknown) => (b as { type: string }).type === 'text')
        .map((b: unknown) => (b as { text: string }).text)
        .join('');

      // Extract tool_use blocks (web search calls)
      const toolUses = content.filter(
        (b: unknown) => (b as { type: string }).type === 'tool_use'
      ) as { id: string; name: string; input: { query?: string } }[];

      // Extract tool_result blocks (Anthropic provides these for hosted tools)
      const toolResults = content.filter(
        (b: unknown) => (b as { type: string }).type === 'tool_result'
      );

      // Track search queries
      for (const tu of toolUses) {
        if (tu.name === 'web_search' && tu.input?.query) {
          allSearches.push(tu.input.query);
          setCurrentSearches(prev => [...prev, tu.input.query!]);
          setSearchState({ active: true, query: tu.input.query });
        }
      }

      // Done if end_turn or no tool calls
      if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
        return { text: textParts, searches: allSearches };
      }

      // Continue agentic loop for tool_use
      if (response.stop_reason === 'tool_use') {
        // Add assistant's content (text + tool_use)
        msgs = [
          ...msgs,
          {
            role: 'assistant' as const,
            content: content.filter(
              (b: unknown) => ['text', 'tool_use'].includes((b as { type: string }).type)
            ),
          },
        ];

        // If Anthropic already provided tool_results in the same response, include them
        if (toolResults.length > 0) {
          msgs = [...msgs, { role: 'user' as const, content: toolResults }];
        } else {
          // Anthropic-hosted tools: pass empty tool_result to continue
          // (Anthropic will inject the actual search results)
          const emptyResults = toolUses.map(tu => ({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: [{ type: 'text', text: 'Web search results will be provided by Anthropic.' }],
          }));
          msgs = [...msgs, { role: 'user' as const, content: emptyResults }];
        }
      }
    }

    return { text: 'לא הצלחתי לקבל תשובה. נסה שנית.', searches: allSearches };
  }, [webSearchEnabled]);

  /* ── Send message ────────────────────────────────────────────────────────── */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('מפתח API חסר. פתח את קובץ .env והחלף את VITE_ANTHROPIC_API_KEY במפתח שלך (sk-ant-...), ואז הפעל מחדש npm run dev.');
      return;
    }

    setError(null);
    setInput('');
    setCurrentSearches([]);
    setSearchState({ active: false });

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
    const updatedMsgs = [...messages, userMsg];
    setMessages(updatedMsgs);
    setLoading(true);
    setStreamingText('');

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const systemBlocks = buildSystemBlocks(leads);
    const apiMessages = updatedMsgs.map(m => ({ role: m.role, content: m.content }));

    try {
      if (webSearchEnabled) {
        /* ── Web search mode: non-streaming agentic loop ── */
        const { text: result, searches } = await runWithWebSearch(client, apiMessages, systemBlocks);

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: result,
          searches,
          timestamp: new Date(),
        }]);
        setSearchState({ active: false });
      } else {
        /* ── Regular mode: streaming ── */
        let fullText = '';
        const stream = client.messages.stream({
          model: 'claude-opus-4-6',
          max_tokens: 2048,
          system: systemBlocks,
          messages: apiMessages,
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            setStreamingText(fullText);
          }
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: fullText,
          timestamp: new Date(),
        }]);
        setStreamingText('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בתקשורת עם ה-AI';
      // If web search fails (model not supported), retry without it
      if (webSearchEnabled && msg.includes('web_search')) {
        setError('חיפוש אינטרנט לא זמין למודל זה. מנסה ללא חיפוש...');
        setWebSearchEnabled(false);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setSearchState({ active: false });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setStreamingText('');
    setSearchState({ active: false });
    setCurrentSearches([]);
  };

  /* ── Suggestion chips ─────────────────────────────────────────────────── */
  const suggestions = [
    { icon: <TrendingUp size={12} />, text: 'אילו לידים הם הכי חמים כרגע?', cat: 'crm' },
    { icon: <Building2 size={12} />, text: 'מה הסטטוס של הלקוחות שבתהליך?', cat: 'crm' },
    { icon: <Globe size={12} />, text: 'מה החדשות האחרונות בשוק הנדל"ן הישראלי?', cat: 'web' },
    { icon: <Search size={12} />, text: 'מהם הטרנדים בשיווק דיגיטלי לנדל"ן?', cat: 'web' },
    { icon: <FileText size={12} />, text: 'נסח מייל שיווקי ללקוח נדל"ן חדש', cat: 'crm' },
    { icon: <MessageSquare size={12} />, text: 'תן רעיונות לתוכן אינסטגרם לפרויקט נדל"ן', cat: 'web' },
  ];

  const isIdle = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] md:h-[calc(100vh-120px)] bg-slate-900 md:rounded-2xl border-0 md:border border-slate-700/50 shadow-2xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60 bg-gradient-to-l from-indigo-900/30 to-slate-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Clear chat */}
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-slate-800"
            >
              <RotateCcw size={12} />
              נקה שיחה
            </button>
          )}

          {/* Web search toggle */}
          <button
            onClick={() => setWebSearchEnabled(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              webSearchEnabled
                ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/40'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-400'
            }`}
            title={webSearchEnabled ? 'חיפוש אינטרנט פעיל — לחץ לכיבוי' : 'חיפוש אינטרנט כבוי — לחץ להפעלה'}
          >
            <Globe size={12} className={webSearchEnabled ? 'text-indigo-400' : 'text-slate-600'} />
            {webSearchEnabled ? 'חיפוש אינטרנט פעיל' : 'ללא אינטרנט'}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-bold text-white text-sm flex items-center gap-2 justify-end">
              עוזר AI
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="text-[10px] text-slate-500">
              claude-opus-4-6 {webSearchEnabled && '· חיפוש אינטרנט'}
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
            <span key={i} className="text-[11px] bg-indigo-800/50 text-indigo-200 px-2 py-0.5 rounded-full whitespace-nowrap border border-indigo-700/30">
              {q}
            </span>
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
              <p className="text-white font-bold text-xl">שלום! אני עוזר ה-AI שלך</p>
              <p className="text-slate-400 text-sm mt-1.5">
                {webSearchEnabled
                  ? 'אני יכול לנתח את הלידים שלך ולחפש מידע עדכני מהאינטרנט'
                  : 'שאל אותי כל שאלה על הלידים שלך'}
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              {[
                { val: leads.length, label: 'לידים' },
                { val: leads.filter(l => l.status === 'לקוח פעיל').length, label: 'לקוחות פעילים' },
                { val: leads.flatMap(l => l.tasks.filter(t => !t.completed)).length, label: 'משימות פתוחות' },
              ].map(s => (
                <div key={s.label} className="bg-slate-800 rounded-xl p-3 border border-slate-700/50">
                  <div className="text-2xl font-bold text-indigo-400">{s.val}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Suggestion chips */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                  className={`text-xs text-right px-3 py-2.5 rounded-xl transition-all flex items-start gap-2 ${
                    s.cat === 'web'
                      ? 'bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-700/40 text-slate-300 hover:text-white'
                      : 'bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 hover:text-white'
                  }`}
                >
                  <span className={`flex-shrink-0 mt-0.5 ${s.cat === 'web' ? 'text-indigo-400' : 'text-slate-500'}`}>
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
          <MessageBubble
            key={i}
            msg={msg}
            isStreaming={i === messages.length - 1 && loading && !webSearchEnabled && !!streamingText}
          />
        ))}

        {/* Streaming text (regular mode) */}
        {loading && !webSearchEnabled && streamingText && (
          <MessageBubble
            msg={{ role: 'assistant', content: streamingText }}
            isStreaming
          />
        )}

        {/* Searching / thinking indicator */}
        {loading && (webSearchEnabled || !streamingText) && (
          <SearchingBubble query={searchState.active ? searchState.query : undefined} />
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-red-300 font-medium">שגיאה</div>
              <div className="text-red-400/80 text-xs mt-0.5">{error}</div>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-400 flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-700/60 px-4 py-3 bg-slate-900 flex-shrink-0">

        {/* Input row */}
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
            placeholder={voiceRecording ? 'מקליט... דבר עכשיו בעברית' : webSearchEnabled ? 'שאל כל שאלה — אחפש גם באינטרנט...' : 'שאל שאלה על הלידים שלך...'}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm focus:outline-none text-right text-slate-200 placeholder-slate-500 max-h-32"
            style={{ direction: 'rtl' }}
          />
          {/* Mic button */}
          <button
            onClick={toggleVoice}
            title={voiceRecording ? 'עצור הקלטה' : 'הקלטה קולית'}
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all active:scale-95 ${
              voiceRecording
                ? 'bg-red-500 hover:bg-red-400 animate-pulse'
                : 'text-slate-500 hover:text-white hover:bg-slate-700'
            }`}
          >
            {voiceRecording ? <MicOff size={13} className="text-white" /> : <Mic size={13} />}
          </button>
          {/* Send button */}
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
          >
            {loading
              ? <Loader2 size={13} className="text-white animate-spin" />
              : <Send size={13} className="text-white" />
            }
          </button>
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="flex items-center gap-2">
            {voiceRecording ? (
              <span className="text-[10px] text-red-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                מקליט — לחץ על המיקרופון לעצירה
              </span>
            ) : webSearchEnabled ? (
              <span className="text-[10px] text-indigo-500 flex items-center gap-1">
                <Zap size={9} />
                מחפש אינטרנט אוטומטית
              </span>
            ) : (
              <span className="text-[10px] text-slate-600">ידע מ-{leads.length} לידים בלבד</span>
            )}
          </div>
          <p className="text-[10px] text-slate-600">Enter לשליחה · Shift+Enter לשורה חדשה</p>
        </div>
      </div>
    </div>
  );
}
