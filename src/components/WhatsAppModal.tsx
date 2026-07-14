import { useState } from 'react';
import { X, Loader2, Copy, Check, ExternalLink, Sparkles, MessageCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Lead, LeadStatus, WorkspaceProfile } from '../types';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { useLang } from '../contexts/LangContext';

interface WAOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  auto?: boolean;
}

const AUTO_OPTION: WAOption = {
  id: 'auto',
  label: 'הודעה אוטומטית',
  description: 'ניתוח חכם של הסטטוס וההיסטוריה',
  emoji: '⚡',
  auto: true,
};

const WA_OPTIONS_BY_STATUS: Record<LeadStatus | 'default', WAOption[]> = {
  'חדש': [
    { id: 'intro',   label: 'היכרות',       description: 'הצגה ראשונה ויצירת קשר', emoji: '👋' },
    { id: 'product', label: 'הצגת שירות',   description: 'מה אנחנו מציעים לו',     emoji: '📦' },
    { id: 'meeting', label: 'תיאום פגישה',  description: 'הצעה לשיחה או פגישה',   emoji: '📅' },
  ],
  'בתהליך': [
    { id: 'followup',     label: 'מעקב',         description: 'המשך השיחה והתהליך',   emoji: '🔔' },
    { id: 'content',      label: 'תוכן/חומרים', description: 'שליחת מידע נוסף',      emoji: '📋' },
    { id: 'satisfaction', label: 'בדיקת שביעות', description: 'איך התהליך מרגיש',    emoji: '✅' },
  ],
  'לקוח פעיל': [
    { id: 'upsell',       label: 'שירות נוסף',   description: 'הצעה להרחבה',          emoji: '⬆️' },
    { id: 'checkin',      label: 'צ\'ק-אין',      description: 'בדיקת שביעות רצון',   emoji: '😊' },
    { id: 'renewal',      label: 'חידוש',         description: 'חידוש ותמשכות שירות', emoji: '🔄' },
  ],
  'רימרקטינג': [
    { id: 'winback',       label: 'החזרה',       description: 'יצירת קשר מחדש',       emoji: '💫' },
    { id: 'special_offer', label: 'מבצע מיוחד', description: 'הצעה שקשה לסרב לה',    emoji: '🎁' },
    { id: 'case_study',    label: 'הצלחה',       description: 'שיתוף תוצאות ולקוחות', emoji: '🏆' },
  ],
  'לא רלוונטי': [
    { id: 'last_chance', label: 'עוד סיבוב',    description: 'ניסיון אחרון ליצור קשר', emoji: '🔔' },
    { id: 'future',      label: 'עתיד',          description: 'שמירת קשר לעתיד',        emoji: '🌱' },
  ],
  'default': [
    { id: 'intro',    label: 'היכרות',      description: 'הצגה ראשונה', emoji: '👋' },
    { id: 'followup', label: 'מעקב',         description: 'המשך שיחה',   emoji: '🔔' },
    { id: 'meeting',  label: 'פגישה',        description: 'הצעה לשיחה',  emoji: '📅' },
  ],
};

function buildBusinessContext(workspace?: WorkspaceProfile): string {
  if (!workspace) return '';
  const lines: string[] = [];
  lines.push(`שם העסק: ${workspace.name}`);
  if (workspace.industry)           lines.push(`תחום: ${workspace.industry}`);
  if (workspace.businessSolutions?.length)
    lines.push(`שירותים/מוצרים: ${workspace.businessSolutions.join(', ')}`);
  if (workspace.prompt)             lines.push(`תיאור העסק: ${workspace.prompt}`);
  const ai = workspace.aiProfile ?? {};
  if (ai.idealClient)      lines.push(`לקוח אידיאלי: ${ai.idealClient}`);
  if (ai.uniqueValue)      lines.push(`מה מייחד אותנו: ${ai.uniqueValue}`);
  if (ai.tone)             lines.push(`טון תקשורת: ${ai.tone}`);
  return lines.join('\n');
}

function buildLeadContext(lead: Lead, workspace?: WorkspaceProfile): string {
  const daysSinceUpdate = lead.lastUpdate
    ? Math.floor((Date.now() - new Date(lead.lastUpdate).getTime()) / 86_400_000)
    : null;

  const recentNotes = (lead.notes ?? [])
    .slice(-5)
    .map(n => {
      const d = n.timestamp ? new Date(n.timestamp).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
      return `  • [${d}] ${n.text}`;
    })
    .join('\n');

  const openTasks = (lead.tasks ?? [])
    .filter(t => !t.completed)
    .map(t => `  • ${t.description}${t.date ? ` (עד ${t.date})` : ''}`)
    .join('\n');

  const solutions = lead.solutions
    .map(s => {
      const flags = [s.inProgress && 'בביצוע', s.delivered && 'הועבר'].filter(Boolean).join('/');
      return `${s.name}${flags ? ` (${flags})` : ''}`;
    })
    .join(', ');

  const futureNotes = (lead.futureNotes ?? []).filter(Boolean).join(', ');

  let ctx = `=== פרטי הליד ===
שם חברה: ${lead.company}
איש קשר: ${lead.contactName}
טלפון: ${lead.phone}
סטטוס: ${lead.status}
מקור ליד: ${lead.source}
שירותים: ${solutions || 'לא צוינו'}
ציון AI (עניין): ${lead.aiScore}/100
עדכון אחרון: ${daysSinceUpdate !== null ? `לפני ${daysSinceUpdate} ימים` : lead.lastUpdate || 'לא ידוע'}`;

  if (lead.waitingContent) ctx += '\nסטטוס: ממתין לתוכן מהלקוח';
  if (recentNotes)   ctx += `\n\n=== היסטוריית הערות (אחרונות) ===\n${recentNotes}`;
  if (openTasks)     ctx += `\n\n=== משימות פתוחות ===\n${openTasks}`;
  if (futureNotes)   ctx += `\n\n=== תכניות עתידיות ===\n${futureNotes}`;

  // unused param guard
  void workspace;

  return ctx;
}

function getWAPrompt(option: WAOption, lead: Lead, workspace?: WorkspaceProfile): string {
  const leadCtx = buildLeadContext(lead, workspace);
  const bizCtx  = buildBusinessContext(workspace);
  const bizName = workspace?.name ?? 'העסק שלנו';
  const tone    = workspace?.aiProfile?.tone ?? 'חברותי ואישי';

  if (option.auto) {
    return `${leadCtx}

=== פרטי העסק ===
${bizCtx || 'לא צוין מידע על העסק'}

המשימה שלך: קרא את כל המידע. כתוב הודעת וואטסאפ אחת קצרה ואפקטיבית ל${lead.contactName} מ-${lead.company}.

הנחיות:
- החלט בעצמך מה המסר הנכון עכשיו בהתאם לסטטוס ולהיסטוריה
- כתוב בעברית, טון ${tone} — כמו הודעה אמיתית בין אנשים
- 2-3 משפטים בלבד — קצר, ישיר, אנושי
- פתח בשמו הפרטי של איש הקשר
- אל תכתב שום דבר מחוץ להודעה עצמה`;
  }

  return `${leadCtx}

=== פרטי העסק ===
${bizCtx || 'לא צוין מידע על העסק'}

כתוב הודעת וואטסאפ בנושא "${option.label}" — ${option.description}.

הנחיות:
- כתוב בעברית, טון ${tone} — כמו הודעה אמיתית בין אנשים
- 2-3 משפטים בלבד — קצר, ישיר, אנושי
- פתח בשמו הפרטי: ${lead.contactName.split(' ')[0]}
- התאם לסטטוס ולהיסטוריה הספציפית
- אל תכתב שום דבר מחוץ להודעה עצמה`;
}

function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0') && digits.length >= 9) return '972' + digits.slice(1);
  return digits;
}

function ContextBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full text-xs text-slate-600">
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium truncate max-w-[100px]">{value}</span>
    </div>
  );
}

interface WhatsAppModalProps {
  lead: Lead;
  onClose: () => void;
  workspace?: WorkspaceProfile;
}

export default function WhatsAppModal({ lead, onClose, workspace }: WhatsAppModalProps) {
  const { t } = useLang();
  const [selectedOption, setSelectedOption] = useState<WAOption | null>(null);
  const [generatedMsg, setGeneratedMsg]     = useState('');
  const [loading, setLoading]               = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [showContext, setShowContext]        = useState(false);

  const options = WA_OPTIONS_BY_STATUS[lead.status] ?? WA_OPTIONS_BY_STATUS['default'];

  const recentNotes = (lead.notes ?? []).slice(-3);
  const openTasks   = (lead.tasks ?? []).filter(tk => !tk.completed);
  const daysSince   = lead.lastUpdate
    ? Math.floor((Date.now() - new Date(lead.lastUpdate).getTime()) / 86_400_000)
    : null;

  const bizName = workspace?.name ?? 'העסק';

  const generateMessage = async (option: WAOption) => {
    setSelectedOption(option);
    setGeneratedMsg('');
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) {
        setGeneratedMsg('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.');
        return;
      }
    }
    setLoading(true);
    try {
      const client = getAnthropicProxy();
      let text = '';
      const bizCtx = buildBusinessContext(workspace);
      const tone   = workspace?.aiProfile?.tone ?? 'חברותי ואישי';
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 300,
        system: [
          {
            type: 'text',
            text: `אתה כותב הודעות וואטסאפ קצרות, אנושיות ואפקטיביות בעברית עבור "${bizName}".
${bizCtx ? `\nפרטי העסק:\n${bizCtx}` : ''}
חוקים: כתוב רק את ההודעה עצמה. 2-3 משפטים בלבד. טון ${tone}. אל תפתח עם "שלום" גנרי — השתמש בשמו הפרטי. אל תוסיף חתימה — רק ההודעה.`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: getWAPrompt(option, lead, workspace) }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          setGeneratedMsg(text);
        }
      }
      try {
        const finalMsg = await stream.finalMessage();
        const cost = calculateCost('claude-opus-4-6', finalMsg.usage.input_tokens, finalMsg.usage.output_tokens);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-6', 'WhatsApp generation');
      } catch (trackErr) {
        console.error('Token tracking failed:', trackErr);
      }
    } catch {
      setGeneratedMsg('שגיאה ביצירת ההודעה. אנא נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWhatsApp = () => {
    const phone   = formatPhoneForWhatsApp(lead.phone);
    const encoded = encodeURIComponent(generatedMsg);
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
  };

  // unused t guard (we inline Hebrew for WhatsApp since there are no translation keys for it yet)
  void t;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-green-50 to-white">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-bold text-slate-800">וואטסאפ ל-{lead.company}</div>
              <div className="text-xs text-slate-500">{lead.phone} · ציון {lead.aiScore}/100 · מ-{bizName}</div>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
              <MessageCircle size={18} className="text-white" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Context strip */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <button
              onClick={() => setShowContext(v => !v)}
              className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span className="flex items-center gap-1">
                {showContext ? <ChevronUp size={12} /> : <ChevronDown size={12} />} הצג קונטקסט
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ContextBadge label="סטטוס" value={lead.status} />
                {daysSince !== null && <ContextBadge label="ימים מעדכון" value={String(daysSince)} />}
                {recentNotes.length > 0 && <ContextBadge label="הערות" value={String(recentNotes.length)} />}
                {openTasks.length > 0   && <ContextBadge label="משימות" value={String(openTasks.length)} />}
                {lead.waitingContent    && <ContextBadge label="ממתין לתוכן" value="כן" />}
              </div>
            </button>

            {showContext && (
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-right">
                {recentNotes.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">📝 הערות אחרונות</p>
                    {recentNotes.map(n => (
                      <p key={n.id} className="text-xs text-slate-500 leading-relaxed">• {n.text}</p>
                    ))}
                  </div>
                )}
                {openTasks.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">✅ משימות פתוחות</p>
                    {openTasks.map(tk => (
                      <p key={tk.id} className="text-xs text-slate-500">• {tk.description}</p>
                    ))}
                  </div>
                )}
                {lead.solutions.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">📦 שירותים</p>
                    <p className="text-xs text-slate-500">{lead.solutions.map(s => s.name).join(', ')}</p>
                  </div>
                )}
                {(lead.futureNotes ?? []).filter(Boolean).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">🔮 תכניות עתידיות</p>
                    <p className="text-xs text-slate-500">{lead.futureNotes.filter(Boolean).join(', ')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AUTO button */}
          <div>
            <div className="flex items-center gap-2 mb-2 justify-end">
              <span className="text-sm font-semibold text-slate-700">בחר סוג הודעה</span>
              <Sparkles size={15} className="text-green-500" />
            </div>
            <button
              onClick={() => generateMessage(AUTO_OPTION)}
              disabled={loading}
              className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all mb-3 ${
                selectedOption?.id === 'auto'
                  ? 'border-green-500 bg-green-50'
                  : 'border-green-200 bg-gradient-to-l from-green-50 to-emerald-50 hover:border-green-400'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2">
                {loading && selectedOption?.id === 'auto'
                  ? <Loader2 size={15} className="animate-spin text-green-500" />
                  : <span className="text-lg">⚡</span>
                }
                <span className="text-sm text-green-700 font-semibold">הודעה אוטומטית חכמה</span>
              </div>
              <div className="text-right">
                <p className="text-xs font-black text-green-700">מומלץ</p>
                <p className="text-xs text-green-400">מנתח את כל הקונטקסט</p>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-xs text-slate-400">או בחר ידנית</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            {/* Manual options */}
            <div className="grid grid-cols-3 gap-2">
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => generateMessage(opt)}
                  disabled={loading}
                  className={`text-right p-3 rounded-xl border-2 transition-all ${
                    selectedOption?.id === opt.id && selectedOption?.id !== 'auto'
                      ? 'border-green-500 bg-green-50'
                      : 'border-slate-200 hover:border-green-300 hover:bg-slate-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="text-lg mb-1">{opt.emoji}</div>
                  <div className="font-semibold text-slate-800 text-xs">{opt.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-tight">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Generated message */}
          {(generatedMsg || loading) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm font-semibold text-slate-700">טיוטת ההודעה</span>
                {loading && <Loader2 size={14} className="animate-spin text-green-500" />}
              </div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed min-h-[80px] text-right">
                {generatedMsg || (
                  <span className="text-slate-400 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> מייצר הודעה...
                  </span>
                )}
              </div>

              {generatedMsg && !loading && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 justify-start flex-wrap">
                    <button
                      onClick={handleOpenWhatsApp}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg transition-colors font-medium"
                    >
                      <ExternalLink size={14} />
                      פתח בוואטסאפ
                    </button>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-sm rounded-lg transition-colors text-slate-600"
                    >
                      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      {copied ? 'הועתק!' : 'העתק'}
                    </button>
                    {selectedOption && (
                      <button
                        onClick={() => generateMessage(selectedOption)}
                        className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-xs rounded-lg transition-colors text-slate-400"
                      >
                        <Sparkles size={12} /> נסח מחדש
                      </button>
                    )}
                  </div>

                  {copied && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                      <CheckCircle2 size={13} /> הטקסט הועתק — עכשיו פתח וואטסאפ והדבק
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
