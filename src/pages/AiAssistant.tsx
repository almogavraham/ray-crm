import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AiAssistantProps {
  leads: Lead[];
}

/** פיצול prompt: חלק סטטי (נשמר ב-cache) + חלק דינמי עם נתוני לידים */
function buildSystemBlocks(leads: Lead[]) {
  const staticPart = `אתה עוזר AI חכם של מערכת CRM בשם cheX לניהול לידים עסקיים. אתה עונה תמיד בעברית.

cheX היא מערכת להפקדת צ'קים דיגיטלית. לקוחות מצלמים צ'קים ומפקידים ישירות לבנק.
מוצרים: cheX (הפקדה דיגיטלית), ci3 (אינטגרציה לנה"ח), סורקי צ'קים (Vision X, Ever-Next).
סטטוסי לידים: חדש → הקמת כספת בבנק → הטמעה → לקוח פעיל | רימרקטינג | לא רלוונטי.

אתה יכול לעזור עם:
- ניתוח וסיכום לידים
- זיהוי לידים חמים או בעדיפות גבוהה
- ניסוח מיילים ללקוחות
- המלצות לפעולות מכירה
- סטטיסטיקות ותובנות על הנתונים
- שאלות כלליות על ניהול מכירות

ענה בצורה ממוקדת, ברורה ומועילה.`;

  const leadsSummary = leads.map(l => {
    const tasksOpen = l.tasks.filter(t => !t.completed).length;
    const g3 = l.waitingG3 ? ' | ממתין G3' : '';
    return `- ${l.company} (${l.contactName}) | סטטוס: ${l.status} | בנקים: ${l.banks.join(', ') || 'אין'} | צ'קים: ${l.checkCount} | מקור: ${l.source} | משויך: ${l.assignedTo} | ציון: ${l.aiScore}% | משימות פתוחות: ${tasksOpen}${g3}`;
  }).join('\n');

  const dynamicPart = `\nנתוני לידים עדכניים (${leads.length} לידים):\n${leadsSummary}`;

  return [
    {
      type: 'text' as const,
      text: staticPart,
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: dynamicPart,
    },
  ];
}

export default function AiAssistant({ leads }: AiAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!apiKey) {
      setError('מפתח API לא מוגדר. הוסף VITE_ANTHROPIC_API_KEY לקובץ .env');
      return;
    }

    setError(null);
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    setStreamingText('');

    try {
      const client = new Anthropic({
        apiKey,
        dangerouslyAllowBrowser: true,
      });

      let fullText = '';
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: buildSystemBlocks(leads),
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          fullText += event.delta.text;
          setStreamingText(fullText);
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullText }]);
      setStreamingText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בתקשורת עם ה-AI');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = [
    'אילו לידים הם הכי חמים כרגע?',
    'כמה לקוחות בהטמעה?',
    'סכם את הלידים לפי בנק',
    'נסח מייל ללקוח בהטמעה',
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-end gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-indigo-50 to-white">
        <div className="text-right">
          <h2 className="font-bold text-slate-800 text-lg">עוזר AI</h2>
          <p className="text-xs text-slate-500">powered by Claude</p>
        </div>
        <div className="w-10 h-10 rounded-full bg-indigo-900 flex items-center justify-center">
          <Sparkles size={18} className="text-white" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center">
              <Bot size={28} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-slate-700 font-semibold text-lg">שלום! אני עוזר ה-AI שלך</p>
              <p className="text-slate-400 text-sm mt-1">שאל אותי כל שאלה על הלידים שלך</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-md">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-sm text-right bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg px-3 py-2 text-slate-600 hover:text-indigo-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              msg.role === 'user' ? 'bg-indigo-900' : 'bg-slate-100'
            }`}>
              {msg.role === 'user'
                ? <User size={14} className="text-white" />
                : <Bot size={14} className="text-indigo-600" />
              }
            </div>
            <div className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-indigo-900 text-white rounded-tr-sm'
                : 'bg-slate-50 text-slate-800 border border-slate-100 rounded-tl-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {loading && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-indigo-600" />
            </div>
            <div className="max-w-[75%] rounded-xl rounded-tl-sm px-4 py-3 text-sm bg-slate-50 border border-slate-100 text-slate-800 leading-relaxed whitespace-pre-wrap">
              {streamingText || (
                <span className="flex items-center gap-2 text-slate-400">
                  <Loader2 size={14} className="animate-spin" />
                  חושב...
                </span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-4 py-3 bg-slate-50">
        <div className="flex gap-2 items-end">
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-lg bg-indigo-900 hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <Send size={15} className="text-white" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="שאל שאלה על הלידים שלך..."
            rows={1}
            className="flex-1 resize-none border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-white max-h-32"
            style={{ direction: 'rtl' }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1.5 text-right">Enter לשליחה • Shift+Enter לשורה חדשה</p>
      </div>
    </div>
  );
}
