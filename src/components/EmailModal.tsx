import { useState } from 'react';
import { X, Mail, Loader2, Copy, Check, ExternalLink, Sparkles, Send, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, LeadStatus, WorkspaceProfile } from '../types';
import { getApiKey } from '../lib/apiKey';
import { sendLeadEmail, isEmailJSConfigured } from '../lib/emailjs';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { useLang } from '../contexts/LangContext';

interface EmailOption {
  id: string;
  label: string;
  description: string;
  emoji: string;
  auto?: boolean;
}

function getAutoOption(t: (k: string) => string): EmailOption {
  return {
    id: 'auto',
    label: t('emailModal.autoEmail'),
    description: t('emailModal.autoDesc'),
    emoji: t('emailModal.autoEmoji'),
    auto: true,
  };
}

function getEmailOptionsByStatus(t: (k: string) => string): Record<LeadStatus | 'default', EmailOption[]> {
  return {
    'חדש': [
      { id: 'intro',   label: t('emailModal.opt.intro.label'),   description: t('emailModal.opt.intro.desc'),   emoji: '👋' },
      { id: 'product', label: t('emailModal.opt.product.label'), description: t('emailModal.opt.product.desc'), emoji: '📦' },
      { id: 'meeting', label: t('emailModal.opt.meeting.label'), description: t('emailModal.opt.meeting.desc'), emoji: '📅' },
    ],
    'בתהליך': [
      { id: 'progress',     label: t('emailModal.opt.progress.label'),     description: t('emailModal.opt.progress.desc'),     emoji: '🚀' },
      { id: 'content',      label: t('emailModal.opt.content.label'),      description: t('emailModal.opt.content.desc'),      emoji: '📋' },
      { id: 'satisfaction', label: t('emailModal.opt.satisfaction.label'), description: t('emailModal.opt.satisfaction.desc'), emoji: '✅' },
    ],
    'לקוח פעיל': [
      { id: 'upsell',       label: t('emailModal.opt.upsell.label'),       description: t('emailModal.opt.upsell.desc'),       emoji: '⬆️' },
      { id: 'satisfaction', label: t('emailModal.opt.satisfaction.label'), description: t('emailModal.opt.satisfaction.desc'), emoji: '😊' },
      { id: 'renewal',      label: t('emailModal.opt.renewal.label'),      description: t('emailModal.opt.renewal.desc'),      emoji: '🔄' },
    ],
    'רימרקטינג': [
      { id: 'winback',       label: t('emailModal.opt.winback.label'),      description: t('emailModal.opt.winback.desc'),      emoji: '💫' },
      { id: 'special_offer', label: t('emailModal.opt.specialOffer.label'), description: t('emailModal.opt.specialOffer.desc'), emoji: '🎁' },
      { id: 'case_study',    label: t('emailModal.opt.caseStudy.label'),    description: t('emailModal.opt.caseStudy.desc'),    emoji: '🏆' },
    ],
    'לא רלוונטי': [
      { id: 'last_chance', label: t('emailModal.opt.lastChance.label'), description: t('emailModal.opt.lastChance.desc'), emoji: '🔔' },
      { id: 'future',      label: t('emailModal.opt.future.label'),     description: t('emailModal.opt.future.desc'),     emoji: '🌱' },
    ],
    'default': [
      { id: 'intro',    label: t('emailModal.opt.intro.label'),   description: t('emailModal.opt.intro.desc'),    emoji: '👋' },
      { id: 'followup', label: t('emailModal.opt.followup.label'), description: t('emailModal.opt.followup.desc'), emoji: '📨' },
      { id: 'meeting',  label: t('emailModal.opt.meeting.label'),  description: t('emailModal.opt.meeting.desc'),  emoji: '📅' },
    ],
  };
}

/** Build a rich business context string from the workspace profile */
function buildBusinessContext(workspace?: WorkspaceProfile): string {
  if (!workspace) return '';

  const lines: string[] = [];
  lines.push(`שם העסק: ${workspace.name}`);
  if (workspace.industry)           lines.push(`תחום: ${workspace.industry}`);
  if (workspace.businessSolutions?.length)
    lines.push(`שירותים/מוצרים: ${workspace.businessSolutions.join(', ')}`);
  if (workspace.prompt)             lines.push(`תיאור העסק: ${workspace.prompt}`);

  const ai = workspace.aiProfile ?? {};
  if (ai.idealClient)        lines.push(`לקוח אידיאלי: ${ai.idealClient}`);
  if (ai.uniqueValue)        lines.push(`מה מייחד אותנו: ${ai.uniqueValue}`);
  if (ai.painPoints)         lines.push(`בעיות שאנו פותרים: ${ai.painPoints}`);
  if (ai.salesProcess)       lines.push(`תהליך מכירה: ${ai.salesProcess}`);
  if (ai.avgDealSize)        lines.push(`גודל עסקה ממוצע: ${ai.avgDealSize}`);
  if (ai.commonObjections)   lines.push(`התנגדויות נפוצות: ${ai.commonObjections}`);
  if (ai.tone)               lines.push(`טון תקשורת: ${ai.tone}`);

  return lines.join('\n');
}

/* ─── Build rich lead context for Claude ─── */
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
מייל: ${lead.email}
סטטוס: ${lead.status}
מקור ליד: ${lead.source}
תקציב שיווק: ${lead.budget > 0 ? `₪${lead.budget.toLocaleString()}/חודש` : 'לא ידוע'}
שירותים: ${solutions || 'לא צוינו'}
ציון AI (עניין): ${lead.aiScore}/100
עדכון אחרון: ${daysSinceUpdate !== null ? `לפני ${daysSinceUpdate} ימים` : lead.lastUpdate || 'לא ידוע'}`;

  if (lead.waitingContent) ctx += '\nסטטוס: ממתין לתוכן מהלקוח';
  if (recentNotes)   ctx += `\n\n=== היסטוריית הערות (אחרונות) ===\n${recentNotes}`;
  if (openTasks)     ctx += `\n\n=== משימות פתוחות ===\n${openTasks}`;
  if (futureNotes)   ctx += `\n\n=== תכניות עתידיות ===\n${futureNotes}`;

  return ctx;
}

function getEmailPrompt(option: EmailOption, lead: Lead, workspace?: WorkspaceProfile): string {
  const leadCtx     = buildLeadContext(lead, workspace);
  const bizCtx      = buildBusinessContext(workspace);
  const bizName     = workspace?.name ?? 'העסק שלנו';
  const tone        = workspace?.aiProfile?.tone ?? 'מקצועי ואדיב';
  const signOff     = `צוות ${bizName}`;

  if (option.auto) {
    return `${leadCtx}

=== פרטי העסק שכותב את המייל ===
${bizCtx || 'לא צוין מידע על העסק'}

המשימה שלך: קרא את כל המידע בעיון. בהתאם לסטטוס, ההיסטוריה, ההערות והמשימות של הליד — כתוב את המייל הכי מתאים, מדויק ואפקטיבי שאפשר לשלוח עכשיו ל${lead.contactName} מ-${lead.company}.

הנחיות:
- החלט בעצמך מה המסר הנכון עכשיו
- שקול: האם ממתינים לפעולה? עבר הרבה זמן? יש הזדמנות לאפסל? עדיין מתלבטים?
- כתוב בעברית, טון ${tone} — אישי ומדויק לאדם הזה
- קצר ועניני — עד 10 שורות
- שורת נושא בפורמט: "נושא: [כותרת]"
- חתום: "${signOff}"
- אל תכתב שום דבר מחוץ למייל עצמו`;
  }

  return `${leadCtx}

=== פרטי העסק שכותב את המייל ===
${bizCtx || 'לא צוין מידע על העסק'}

כתוב מייל בנושא "${option.label}" — ${option.description}.
השתמש בכל המידע כדי להתאים את המייל בדיוק לאדם הזה ולמה שרלוונטי אליו.

הנחיות:
- כתוב בעברית, טון ${tone}
- התאם לסטטוס ולהיסטוריה הספציפית
- קצר ועניני — עד 10 שורות
- שורת נושא בפורמט: "נושא: [כותרת]"
- חתום: "${signOff}"
- אל תכתב שום דבר מחוץ למייל עצמו`;
}

/* ─── Context preview chip ─── */
function ContextBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full text-xs text-slate-600">
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium truncate max-w-[100px]">{value}</span>
    </div>
  );
}

interface EmailModalProps {
  lead: Lead;
  onClose: () => void;
  workspace?: WorkspaceProfile;
}

export default function EmailModal({ lead, onClose, workspace }: EmailModalProps) {
  const { t } = useLang();
  const AUTO_OPTION = getAutoOption(t);
  const EMAIL_OPTIONS_BY_STATUS = getEmailOptionsByStatus(t);
  const [selectedOption, setSelectedOption]  = useState<EmailOption | null>(null);
  const [generatedEmail, setGeneratedEmail]  = useState('');
  const [loading, setLoading]                = useState(false);
  const [copied, setCopied]                  = useState(false);
  const [sendStatus, setSendStatus]          = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [showContext, setShowContext]        = useState(false);
  const emailJSReady = isEmailJSConfigured();

  const options = EMAIL_OPTIONS_BY_STATUS[lead.status] || EMAIL_OPTIONS_BY_STATUS['default'];

  const recentNotes  = (lead.notes ?? []).slice(-3);
  const openTasks    = (lead.tasks ?? []).filter(t => !t.completed);
  const daysSince    = lead.lastUpdate
    ? Math.floor((Date.now() - new Date(lead.lastUpdate).getTime()) / 86_400_000)
    : null;

  const bizName  = workspace?.name ?? 'העסק';
  const tone     = workspace?.aiProfile?.tone ?? 'מקצועי ואדיב';
  const signOff  = `צוות ${bizName}`;

  const generateEmail = async (option: EmailOption) => {
    setSelectedOption(option);
    setGeneratedEmail('');
    const apiKey = getApiKey();
    if (!apiKey) {
      setGeneratedEmail('⚠️ מפתח API חסר. הגדר VITE_ANTHROPIC_API_KEY ב-.env');
      return;
    }
    // Check token balance before making the API call
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) {
        setGeneratedEmail('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.');
        return;
      }
    }
    setLoading(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      let text = '';
      const bizCtx = buildBusinessContext(workspace);
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 700,
        system: [
          {
            type: 'text',
            text: `אתה כותב מיילים מקצועיים ומותאמים אישית בעברית עבור "${bizName}".
${bizCtx ? `\nפרטי העסק:\n${bizCtx}` : ''}
חוקים: כתוב רק את המייל עצמו. קצר (עד 10 שורות). טון ${tone}. שורת נושא בפורמט "נושא: [כותרת]". חתום "${signOff}". השתמש בשם האיש ספציפית.`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: getEmailPrompt(option, lead, workspace) }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          setGeneratedEmail(text);
        }
      }
      // Deduct tokens after stream completes
      try {
        const finalMsg = await stream.finalMessage();
        const cost = calculateCost('claude-opus-4-6', finalMsg.usage.input_tokens, finalMsg.usage.output_tokens);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-6', 'Email generation');
      } catch (trackErr) {
        console.error('Token tracking failed:', trackErr);
      }
    } catch {
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

  const getBody = () => generatedEmail.replace(/^נושא:.+\n?/m, '').trim();

  const mailtoLink = () => {
    const subject = encodeURIComponent(getSubject());
    const body    = encodeURIComponent(getBody());
    return `mailto:${lead.email}?subject=${subject}&body=${body}`;
  };

  const handleSend = async () => {
    if (!generatedEmail || sendStatus === 'sending') return;
    setSendStatus('sending');
    try {
      await sendLeadEmail({ toEmail: lead.email, toName: lead.contactName, subject: getSubject(), message: getBody(), fromName: 'RAY Digital Agency' });
      setSendStatus('sent');
      setTimeout(() => setSendStatus('idle'), 4000);
    } catch {
      setSendStatus('error');
      setTimeout(() => setSendStatus('idle'), 4000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()} dir="rtl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-neutral-50 to-white">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-bold text-slate-800">{t('emailModal.title')}{lead.company}</div>
              <div className="text-xs text-slate-500">{lead.email} · {t('emailModal.score')} {lead.aiScore}/100 · {t('emailModal.sentFrom')}{bizName}</div>
            </div>
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
              <Mail size={18} className="text-white" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Context summary strip */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <button
              onClick={() => setShowContext(v => !v)}
              className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span className="flex items-center gap-1">{showContext ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {t('emailModal.showContext')}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ContextBadge label={t('emailModal.status')} value={lead.status} />
                {daysSince !== null && <ContextBadge label={t('emailModal.daysSinceUpdate')} value={String(daysSince)} />}
                {recentNotes.length > 0 && <ContextBadge label={t('emailModal.notes')} value={String(recentNotes.length)} />}
                {openTasks.length > 0  && <ContextBadge label={t('emailModal.tasks')} value={String(openTasks.length)} />}
                {lead.waitingContent   && <ContextBadge label={t('emailModal.waitingContent')} value="כן" />}
              </div>
            </button>

            {showContext && (
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-right">
                {recentNotes.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">📝 {t('emailModal.recentNotes')}</p>
                    {recentNotes.map(n => (
                      <p key={n.id} className="text-xs text-slate-500 leading-relaxed">• {n.text}</p>
                    ))}
                  </div>
                )}
                {openTasks.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">✅ {t('emailModal.openTasks')}</p>
                    {openTasks.map(t => (
                      <p key={t.id} className="text-xs text-slate-500">• {t.description}</p>
                    ))}
                  </div>
                )}
                {lead.solutions.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">📦 {t('emailModal.services')}</p>
                    <p className="text-xs text-slate-500">{lead.solutions.map(s => s.name).join(', ')}</p>
                  </div>
                )}
                {(lead.futureNotes ?? []).filter(Boolean).length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-slate-600 mb-1">🔮 {t('emailModal.futurePlans')}</p>
                    <p className="text-xs text-slate-500">{lead.futureNotes.filter(Boolean).join(', ')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AUTO button — featured */}
          <div>
            <div className="flex items-center gap-2 mb-2 justify-end">
              <span className="text-sm font-semibold text-slate-700">{t('emailModal.selectEmailType')}</span>
              <Sparkles size={15} className="text-indigo-500" />
            </div>
            <button
              onClick={() => generateEmail(AUTO_OPTION)}
              disabled={loading}
              className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all mb-3 ${
                selectedOption?.id === 'auto'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-indigo-200 bg-gradient-to-l from-indigo-50 to-violet-50 hover:border-indigo-400'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2">
                {loading && selectedOption?.id === 'auto'
                  ? <Loader2 size={15} className="animate-spin text-indigo-500" />
                  : <span className="text-lg">⚡</span>
                }
                <span className="text-sm text-indigo-600 font-semibold">{t('emailModal.autoEmail')}</span>
              </div>
              <div className="text-right">
                <p className="text-xs font-black text-indigo-700">{t('emailModal.recommended')}</p>
                <p className="text-xs text-indigo-400">{t('emailModal.analysesAll')}</p>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-xs text-slate-400">{t('emailModal.orChooseManual')}</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            {/* Manual options */}
            <div className="grid grid-cols-3 gap-2">
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => generateEmail(opt)}
                  disabled={loading}
                  className={`text-right p-3 rounded-xl border-2 transition-all ${
                    selectedOption?.id === opt.id && selectedOption?.id !== 'auto'
                      ? 'border-black bg-neutral-50'
                      : 'border-slate-200 hover:border-neutral-400 hover:bg-slate-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="text-lg mb-1">{opt.emoji}</div>
                  <div className="font-semibold text-slate-800 text-xs">{opt.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-tight">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Generated email */}
          {(generatedEmail || loading) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm font-semibold text-slate-700">{t('emailModal.draft')}</span>
                {loading && <Loader2 size={14} className="animate-spin text-indigo-500" />}
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed min-h-[120px] text-right">
                {generatedEmail || <span className="text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{t('emailModal.generating')}</span>}
              </div>

              {generatedEmail && !loading && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 justify-start flex-wrap">
                    {emailJSReady ? (
                      <button
                        onClick={handleSend}
                        disabled={sendStatus === 'sending' || sendStatus === 'sent'}
                        className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors font-medium ${
                          sendStatus === 'sent'    ? 'bg-green-500 text-white'
                          : sendStatus === 'error' ? 'bg-red-500 text-white'
                          : sendStatus === 'sending' ? 'bg-neutral-400 text-white cursor-not-allowed'
                          : 'bg-black hover:bg-neutral-800 text-white'
                        }`}
                      >
                        {sendStatus === 'sending' && <Loader2 size={14} className="animate-spin" />}
                        {sendStatus === 'sent'    && <CheckCircle2 size={14} />}
                        {sendStatus === 'error'   && <AlertCircle size={14} />}
                        {sendStatus === 'idle'    && <Send size={14} />}
                        {sendStatus === 'sending' ? t('emailModal.sending') : sendStatus === 'sent' ? t('emailModal.sent') : sendStatus === 'error' ? t('emailModal.sendError') : t('emailModal.sendFromEmail')}
                      </button>
                    ) : (
                      <a href={mailtoLink()} className="flex items-center gap-1.5 px-4 py-2 bg-black hover:bg-neutral-800 text-white text-sm rounded-lg transition-colors">
                        <ExternalLink size={14} />{t('emailModal.openInClient')}
                      </a>
                    )}
                    <button onClick={handleCopy} className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-sm rounded-lg transition-colors text-slate-600">
                      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      {copied ? t('emailModal.copied') : t('emailModal.copy')}
                    </button>
                    {emailJSReady && (
                      <a href={mailtoLink()} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-sm rounded-lg transition-colors text-slate-400" title={t('emailModal.openInClient')}>
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {/* Regenerate */}
                    {selectedOption && (
                      <button onClick={() => generateEmail(selectedOption)} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-xs rounded-lg transition-colors text-slate-400">
                        <Sparkles size={12} /> {t('emailModal.regenerate')}
                      </button>
                    )}
                  </div>

                  {sendStatus === 'sent' && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                      <CheckCircle2 size={13} />{t('emailModal.successSent')}{lead.email}
                    </div>
                  )}
                  {!emailJSReady && (
                    <div className="text-xs text-slate-400 text-right">
                      💡 {t('emailModal.gmailHint')}
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
