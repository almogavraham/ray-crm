import { useState } from 'react';
import { X, Mail, Loader2, Copy, Check, ExternalLink, Sparkles } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, LeadStatus } from '../types';

interface EmailOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
}

const EMAIL_OPTIONS_BY_STATUS: Record<LeadStatus | 'default', EmailOption[]> = {
  'חדש': [
    { id: 'intro', label: 'מייל היכרות', description: 'הצגת cheX ופתיחת שיח', emoji: '👋' },
    { id: 'product', label: 'הצגת המוצר', description: 'הסבר על יתרונות cheX', emoji: '📦' },
    { id: 'meeting', label: 'תיאום פגישה', description: 'הזמנה לשיחת היכרות', emoji: '📅' },
  ],
  'הקמת כספת בבנק': [
    { id: 'vault_followup', label: 'מעקב הקמת כספת', description: 'בדיקת התקדמות עם הבנק', emoji: '🏦' },
    { id: 'vault_help', label: 'עזרה בתהליך', description: 'הצעת סיוע מול הבנק', emoji: '🤝' },
    { id: 'meeting', label: 'תיאום פגישה', description: 'פגישה לקדם את התהליך', emoji: '📅' },
  ],
  'הטמעה': [
    { id: 'training', label: 'תיאום הדרכה', description: 'קביעת מועד להדרכת המערכת', emoji: '🎓' },
    { id: 'installation', label: 'מעקב התקנה', description: 'בדיקת סטטוס ההתקנה', emoji: '⚙️' },
    { id: 'satisfaction', label: 'בדיקת שביעות רצון', description: 'וידוא שהכל עובד חלק', emoji: '✅' },
  ],
  'לקוח פעיל': [
    { id: 'upsell', label: 'הצעת שדרוג', description: 'הצגת מוצרים נוספים (ci3 / סורקים)', emoji: '⬆️' },
    { id: 'satisfaction', label: 'שביעות רצון', description: 'בדיקת חוויית הלקוח', emoji: '😊' },
    { id: 'renewal', label: 'חידוש חוזה', description: 'תזכורת לחידוש הרישיון', emoji: '🔄' },
  ],
  'רימרקטינג': [
    { id: 'winback', label: 'מייל חזרה אלינו', description: 'הצעה לחזור להשתמש בשירות', emoji: '💫' },
    { id: 'special_offer', label: 'הצעה מיוחדת', description: 'הנחה או תנאים מיוחדים', emoji: '🎁' },
    { id: 'case_study', label: 'סיפור הצלחה', description: 'שיתוף דוגמה מלקוח דומה', emoji: '🏆' },
  ],
  'לא רלוונטי': [
    { id: 'last_chance', label: 'ניסיון אחרון', description: 'הצעה של הזדמנות אחרונה', emoji: '🔔' },
    { id: 'future', label: 'מייל עתידי', description: 'השארת דלת פתוחה לעתיד', emoji: '🌱' },
  ],
  'default': [
    { id: 'intro', label: 'מייל היכרות', description: 'הצגת cheX', emoji: '👋' },
    { id: 'followup', label: 'מעקב', description: 'מייל מעקב כללי', emoji: '📨' },
    { id: 'meeting', label: 'תיאום פגישה', description: 'הזמנה לשיחה', emoji: '📅' },
  ],
};

const CHEX_CONTEXT = `
cheX היא מערכת להפקדת צ'קים דיגיטלית של חברת G&S Banking Automation.
במקום לחכות לצ'ק בדואר, הלקוח מצלם את הצ'ק דרך SMS/מייל/QR ומפקיד אותו ישירות לבנק.
4 שלבים: שליחת בקשת תשלום → צילום הצ'ק → קליטה אוטומטית → הפקדה דיגיטלית לחשבון.
יתרונות: חיסכון בזמן ובכסף, אין נסיעות לבנק, הפקדה אוטומטית, שליטה מלאה, 100% שקיפות.
מוצרים: cheX (הפקדה דיגיטלית), ci3 (אינטגרציה לתוכנת הנה"ח), סורקי צ'קים (Vision X, Vision X AGP, Ever-Next).
מחירים: בסיסי 1.5 ₪/קרדיט, פרו 2 ₪/קרדיט, פרימיום 4 ₪/קרדיט. 10 צ'קים ראשונים חינם.
`;

function getEmailPrompt(option: EmailOption, lead: Lead): string {
  const leadInfo = `
שם חברה: ${lead.company}
איש קשר: ${lead.contactName}
מייל: ${lead.email}
סטטוס: ${lead.status}
בנקים: ${lead.banks.join(', ') || 'לא ידוע'}
מקור: ${lead.source}
כמות צ'קים: ${lead.checkCount}
מוצרים: ${lead.solutions.map(s => s.name).join(', ') || 'אין'}
`;

  return `כתוב מייל מקצועי בעברית בנושא "${option.label}" עבור הליד הבא:
${leadInfo}

מידע על cheX:${CHEX_CONTEXT}

הנחיות:
- כתוב בעברית בשפה מקצועית ואדיבה
- התאם את הטון לסטטוס של הליד (${lead.status})
- המייל צריך להיות ממוקד, ממשי ולא ארוך מדי (עד 10 שורות)
- כלול שורת נושא בתחילת המייל בפורמט: "נושא: [כותרת]"
- חתום בשם "צוות cheX | G&S Banking Automation"
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
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;

  const generateEmail = async (option: EmailOption) => {
    setSelectedOption(option);
    setGeneratedEmail('');
    if (!apiKey) {
      setGeneratedEmail('שגיאה: מפתח API לא מוגדר. הוסף VITE_ANTHROPIC_API_KEY לקובץ .env');
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
            text: `אתה כותב מיילים מקצועיים בעברית עבור חברת cheX — מערכת הפקדת צ'קים דיגיטלית.
${CHEX_CONTEXT}
כתוב מיילים ממוקדים, קצרים (עד 10 שורות), מקצועיים ואדיבים. כלול שורת נושא בפורמט "נושא: [כותרת]". חתום: "צוות cheX | G&S Banking Automation".`,
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
    return match ? match[1].trim() : `מייל מ-cheX ל-${lead.company}`;
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-indigo-50 to-white">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-bold text-slate-800">שלח מייל ל-{lead.company}</div>
              <div className="text-xs text-slate-500">{lead.email}</div>
            </div>
            <div className="w-10 h-10 rounded-full bg-indigo-900 flex items-center justify-center">
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
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
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
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-900 hover:bg-indigo-800 text-white text-sm rounded-lg transition-colors"
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
