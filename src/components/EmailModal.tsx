import { useState } from 'react';
import { X, Mail, Loader2, Copy, Check, ExternalLink, Sparkles } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, LeadStatus } from '../types';
import { getApiKey } from '../lib/apiKey';

interface EmailOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
}

const EMAIL_OPTIONS_BY_STATUS: Record<LeadStatus | 'default', EmailOption[]> = {
  'חדש': [
    { id: 'intro', label: 'מייל היכרות', description: 'הצגת RAY Digital ופתיחת שיח', emoji: '👋' },
    { id: 'product', label: 'הצגת השירותים', description: 'הסבר על שירותי השיווק שלנו', emoji: '📦' },
    { id: 'meeting', label: 'תיאום פגישה', description: 'הזמנה לשיחת היכרות', emoji: '📅' },
  ],
  'בתהליך': [
    { id: 'progress', label: 'עדכון התקדמות', description: 'עדכון על סטטוס הפרויקט', emoji: '🚀' },
    { id: 'content', label: 'בקשת תוכן', description: 'בקשת חומרים מהלקוח', emoji: '📋' },
    { id: 'satisfaction', label: 'בדיקת שביעות רצון', description: 'וידוא שהכל עובד חלק', emoji: '✅' },
  ],
  'לקוח פעיל': [
    { id: 'upsell', label: 'הצעת שדרוג', description: 'הצגת שירותים נוספים של RAY', emoji: '⬆️' },
    { id: 'satisfaction', label: 'שביעות רצון', description: 'בדיקת חוויית הלקוח', emoji: '😊' },
    { id: 'renewal', label: 'חידוש הסכם', description: 'תזכורת לחידוש שיתוף הפעולה', emoji: '🔄' },
  ],
  'רימרקטינג': [
    { id: 'winback', label: 'מייל חזרה אלינו', description: 'הצעה לחזור לעבוד יחד', emoji: '💫' },
    { id: 'special_offer', label: 'הצעה מיוחדת', description: 'הנחה או חבילה מיוחדת', emoji: '🎁' },
    { id: 'case_study', label: 'סיפור הצלחה', description: 'שיתוף תוצאות מלקוח נדל"ן דומה', emoji: '🏆' },
  ],
  'לא רלוונטי': [
    { id: 'last_chance', label: 'ניסיון אחרון', description: 'הצעה של הזדמנות אחרונה', emoji: '🔔' },
    { id: 'future', label: 'מייל עתידי', description: 'השארת דלת פתוחה לעתיד', emoji: '🌱' },
  ],
  'default': [
    { id: 'intro', label: 'מייל היכרות', description: 'הצגת RAY Digital', emoji: '👋' },
    { id: 'followup', label: 'מעקב', description: 'מייל מעקב כללי', emoji: '📨' },
    { id: 'meeting', label: 'תיאום פגישה', description: 'הזמנה לשיחה', emoji: '📅' },
  ],
};

const RAY_CONTEXT = `
RAY Digital היא סוכנות שיווק דיגיטלית AI-First המתמחה בנדל"ן ובתחום הנכסים.
אנחנו יוצרים תוכן שיווקי מרהיב שמניע מכירות: דמיות ויזואליות, אתרי נדל"ן פרימיום, קמפיינים ממומנים ממוקדים.
שירותים: דמיות ויזואליות (Renders), אתר פרימיום, קמפיין פרסום ממומן, ניהול מדיה חברתית, קריאייטיב (UGC/ריל/פוסטים), SEO.
יתרונות: AI-powered, תוצאות מהירות, ניסיון נרחב בנדל"ן ישראלי, צוות יצירתי מקצועי.
לקוחות: קבלנים, יזמי נדל"ן, סוכני נדל"ן, חברות בנייה, פרויקטים למגורים ומסחר.
`;

function getEmailPrompt(option: EmailOption, lead: Lead): string {
  const leadInfo = `
שם חברה: ${lead.company}
איש קשר: ${lead.contactName}
מייל: ${lead.email}
סטטוס: ${lead.status}
מקור: ${lead.source}
תקציב שיווק: ${lead.budget > 0 ? `₪${lead.budget.toLocaleString()}/חודש` : 'לא ידוע'}
שירותים: ${lead.solutions.map(s => s.name).join(', ') || 'אין'}
`;

  return `כתוב מייל מקצועי בעברית בנושא "${option.label}" עבור הליד הבא:
${leadInfo}

מידע על RAY Digital:${RAY_CONTEXT}

הנחיות:
- כתוב בעברית בשפה מקצועית ואדיבה
- התאם את הטון לסטטוס של הליד (${lead.status})
- המייל צריך להיות ממוקד, ממשי ולא ארוך מדי (עד 10 שורות)
- כלול שורת נושא בתחילת המייל בפורמט: "נושא: [כותרת]"
- חתום בשם "צוות RAY Digital Agency"
- אל תכלול כל הסבר נוסף - רק את המייל עצמו`;
}

interface EmailModalProps {
  lead: Lead;
  onClose: () => void;
}

export default function EmailModal({ lead, onClose }: EmailModalProps) {
  const [selectedOption, setSelectedOption] = useState<EmailOption | null>(null);
  const [generatedEmail, setGeneratedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const options = EMAIL_OPTIONS_BY_STATUS[lead.status] || EMAIL_OPTIONS_BY_STATUS['default'];

  const generateEmail = async (option: EmailOption) => {
    setSelectedOption(option);
    setGeneratedEmail('');
    const apiKey = getApiKey();
    if (!apiKey) {
      setGeneratedEmail('⚠️ מפתח API חסר.\nפתח את קובץ .env והחלף את הערך של VITE_ANTHROPIC_API_KEY במפתח האמיתי שלך (sk-ant-...).\nלאחר מכן הפעל מחדש: npm run dev');
      return;
    }
    setLoading(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      let text = '';
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 600,
        system: [
          {
            type: 'text',
            text: `אתה כותב מיילים מקצועיים בעברית עבור סוכנות RAY Digital — שיווק דיגיטלי AI לנדל"ן.
${RAY_CONTEXT}
כתוב מיילים ממוקדים, קצרים (עד 10 שורות), מקצועיים ואדיבים. כלול שורת נושא בפורמט "נושא: [כותרת]". חתום: "צוות RAY Digital Agency".`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: getEmailPrompt(option, lead) }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          setGeneratedEmail(text);
        }
      }
    } catch (err) {
      setGeneratedEmail('שגיאה ביצירת המייל. אנא נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getSubject = () => {
    const match = generatedEmail.match(/נושא:\s*(.+)/);
    return match ? match[1].trim() : `מייל מ-RAY Digital ל-${lead.company}`;
  };

  const getBody = () => {
    return generatedEmail.replace(/^נושא:.+\n?/m, '').trim();
  };

  const mailtoLink = () => {
    const subject = encodeURIComponent(getSubject());
    const body = encodeURIComponent(getBody());
    return `mailto:${lead.email}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-neutral-50 to-white">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-bold text-slate-800">שלח מייל ל-{lead.company}</div>
              <div className="text-xs text-slate-500">{lead.email}</div>
            </div>
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
              <Mail size={18} className="text-white" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Email type options */}
          <div>
            <div className="flex items-center gap-2 mb-3 justify-end">
              <span className="text-sm font-semibold text-slate-700">בחר סוג מייל</span>
              <Sparkles size={15} className="text-indigo-500" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => generateEmail(opt)}
                  disabled={loading}
                  className={`text-right p-3 rounded-xl border-2 transition-all ${
                    selectedOption?.id === opt.id
                      ? 'border-black bg-neutral-50'
                      : 'border-slate-200 hover:border-neutral-400 hover:bg-slate-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="text-xl mb-1">{opt.emoji}</div>
                  <div className="font-semibold text-slate-800 text-sm">{opt.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Generated email */}
          {(generatedEmail || loading) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm font-semibold text-slate-700">טיוטת המייל</span>
                {loading && <Loader2 size={14} className="animate-spin text-indigo-500" />}
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed min-h-[120px] text-right">
                {generatedEmail || <span className="text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />יוצר מייל...</span>}
              </div>
              {generatedEmail && !loading && (
                <div className="flex items-center gap-2 justify-start">
                  <a
                    href={mailtoLink()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-black hover:bg-neutral-800 text-white text-sm rounded-lg transition-colors"
                  >
                    <ExternalLink size={14} />
                    פתח בתוכנת מייל
                  </a>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-sm rounded-lg transition-colors text-slate-600"
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                    {copied ? 'הועתק!' : 'העתק'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
