/**
 * LeadsOnboardingWizard
 * Shows once per workspace (when leadsSetupDone is false/missing).
 * Asks 3 quick questions, calls Claude AI, then displays a personalised
 * "lead card" preview and saves the aiProfile to Firestore.
 */
import { useState, useRef } from 'react';
import {
  Sparkles, ChevronRight, ChevronLeft, Plus, X,
  Target, Briefcase, TrendingUp, CheckCircle2,
  Zap, RefreshCw, User, DollarSign, ArrowLeft,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getApiKey } from '../lib/apiKey';
import type { WorkspaceProfile } from '../types';

/* ── types ───────────────────────────────────────────────────────────────── */
interface AiResult {
  idealClient:    string;
  painPoints:     string;
  salesProcess:   string;
  avgDealSize:    string;
  uniqueValue:    string;
  tone:           string;
  hotLeadSignals: string;
  prompt:         string;
}

interface Props {
  workspace:  WorkspaceProfile;
  onComplete: () => void;   // called after save — parent should refreshWorkspace()
  onClose?:   () => void;   // called when user closes without completing
}

/* ── step config ─────────────────────────────────────────────────────────── */
const TOTAL_STEPS = 3;

/* ════════════════════════════════════════════════════════════════════════════
   Component
════════════════════════════════════════════════════════════════════════════ */
export default function LeadsOnboardingWizard({ workspace, onComplete, onClose }: Props) {
  // Start at intro (0) for first-time setup, skip to step 1 for redesign
  const isRedesign = !!workspace.leadsSetupDone;
  const [step,       setStep]       = useState(isRedesign ? 1 : 0); // 0=intro 1-3=questions 4=loading 5=result
  const [solutions,  setSolutions]  = useState<string[]>(workspace.businessSolutions ?? []);
  const [solutionInput, setSolutionInput] = useState('');
  const [idealClient,   setIdealClient]   = useState(workspace.aiProfile?.idealClient ?? '');
  const [painPoints,    setPainPoints]    = useState(workspace.aiProfile?.painPoints  ?? '');
  const [salesProcess,  setSalesProcess]  = useState(workspace.aiProfile?.salesProcess ?? '');
  const [avgDealSize,   setAvgDealSize]   = useState(workspace.aiProfile?.avgDealSize  ?? '');
  const [result,        setResult]        = useState<AiResult | null>(null);
  const [error,         setError]         = useState('');
  const generating = useRef(false);

  /* ── helpers ───────────────────────────────────────────────────────────── */
  const addSolution = () => {
    const v = solutionInput.trim();
    if (v && !solutions.includes(v)) setSolutions(p => [...p, v]);
    setSolutionInput('');
  };

  const removeSolution = (s: string) => setSolutions(p => p.filter(x => x !== s));

  /* ── AI call ────────────────────────────────────────────────────────────── */
  const generateProfile = async () => {
    if (generating.current) return;
    generating.current = true;
    setStep(4);
    setError('');

    const apiKey = getApiKey();
    if (!apiKey) {
      setError('מפתח API חסר — בדוק את קובץ ה-.env');
      setStep(3);
      generating.current = false;
      return;
    }

    // Build full context from ALL workspace data (registration + wizard answers)
    const existingProfile = workspace.aiProfile;
    const registrationInfo = [
      workspace.name           && `שם: ${workspace.name}`,
      workspace.industry       && `תעשייה: ${workspace.industry}`,
      workspace.teamSize       && `גודל צוות: ${workspace.teamSize}`,
      workspace.prompt         && `תיאור עסק: ${workspace.prompt}`,
      existingProfile?.idealClient     && `לקוח אידיאלי (קיים): ${existingProfile.idealClient}`,
      existingProfile?.salesProcess    && `תהליך מכירה (קיים): ${existingProfile.salesProcess}`,
      existingProfile?.uniqueValue     && `ייחוד עסקי (קיים): ${existingProfile.uniqueValue}`,
    ].filter(Boolean).join('\n');

    const systemPrompt = `אתה מומחה CRM ואסטרטגיית מכירות.
קיבלת מידע על עסק ישראלי ממקורות שונים. עליך לנתח הכל ולהחזיר JSON בלבד (ללא markdown, ללא הסברים).
כל השדות בעברית, תוכן ענייני וקצר.`;

    const userPrompt = `--- מידע מהרישום ---
${registrationInfo || 'לא קיים'}

--- מידע מהשאלות ---
פתרונות/שירותים: ${solutions.join(', ') || 'לא צוין'}
לקוח אידיאלי: ${idealClient || 'לא צוין'}
בעיות שנפתרות: ${painPoints || 'לא צוין'}
תהליך מכירה: ${salesProcess || 'לא צוין'}
גודל עסקה ממוצע: ${avgDealSize || 'לא צוין'}

על בסיס כל המידע הנ"ל, החזר JSON עם המפתחות הבאים בדיוק:
{
  "idealClient": "תיאור קצר של הלקוח האידיאלי (1-2 משפטים)",
  "painPoints": "הבעיות העיקריות שהעסק פותר (1-2 משפטים)",
  "salesProcess": "תהליך המכירה בשלבים קצרים",
  "avgDealSize": "גודל עסקה ממוצע מעוצב",
  "uniqueValue": "מה מייחד את העסק (1 משפט)",
  "tone": "סגנון תקשורת מומלץ: פורמלי / ידידותי / מקצועי",
  "hotLeadSignals": "3 סימנים שמגדירים ליד חם לעסק זה (שורה לכל אחד, מתחילה בנקודה •)",
  "prompt": "הנחיית AI קצרה (2-3 משפטים) שתשמש את העוזר לניהול לידים בעסק זה"
}`;

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });

      const raw = (msg.content[0] as { text: string }).text.trim();
      // Strip possible markdown fences
      const json = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
      const parsed: AiResult = JSON.parse(json);

      // Save to Firestore
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        leadsSetupDone:      true,
        businessSolutions:   solutions,
        prompt:              parsed.prompt,
        'aiProfile.idealClient':    parsed.idealClient,
        'aiProfile.painPoints':     parsed.painPoints,
        'aiProfile.salesProcess':   parsed.salesProcess,
        'aiProfile.avgDealSize':    parsed.avgDealSize,
        'aiProfile.uniqueValue':    parsed.uniqueValue,
        'aiProfile.tone':           parsed.tone,
      });

      setResult(parsed);
      setStep(5);
    } catch (err) {
      console.error(err);
      setError('שגיאה ביצירת הפרופיל. נסה שוב.');
      setStep(3);
    } finally {
      generating.current = false;
    }
  };

  /* ── step navigation ─────────────────────────────────────────────────────── */
  const canNext = () => {
    if (step === 1) return solutions.length > 0;
    if (step === 2) return idealClient.trim().length > 0;
    if (step === 3) return salesProcess.trim().length > 0;
    return true;
  };

  const next = () => {
    if (step < TOTAL_STEPS) setStep(s => s + 1);
    else generateProfile();
  };

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg relative">

        {/* Close button — visible on all steps except loading */}
        {step !== 4 && onClose && (
          <button
            onClick={onClose}
            className="absolute -top-3 -left-3 z-10 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all shadow-lg"
          >
            <X size={14} />
          </button>
        )}

        {/* ── Step 0: Intro ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="inline-flex w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 items-center justify-center shadow-2xl shadow-indigo-500/40 mx-auto">
              <Sparkles size={36} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-black text-3xl mb-2">
                {isRedesign ? 'עיצוב מחדש של הכרטיס' : 'בוא נכיר את העסק שלך'}
              </h1>
              <p className="text-slate-400 text-base leading-relaxed">
                {isRedesign
                  ? 'עדכן את פרטי העסק שלך ו-AI יעצב מחדש את כרטיס הלקוח'
                  : <>כמה שאלות קצרות ו-AI יעצב את כרטיס הלידים שלך<br/>בצורה מותאמת לעסק ולתחום שלך</>
                }
              </p>
            </div>
            <div className="flex flex-col gap-2 items-center text-sm text-slate-500">
              {[
                { icon: Briefcase,   text: 'הפתרונות והשירותים שלך' },
                { icon: Target,      text: 'הלקוח האידיאלי שלך' },
                { icon: TrendingUp,  text: 'תהליך המכירה שלך' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={14} className="text-indigo-400" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep(1)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-indigo-500/30 flex items-center gap-2 mx-auto"
            >
              <Sparkles size={16} />
              מתחילים
            </button>
            <p className="text-slate-600 text-xs">לוקח כ-2 דקות</p>
          </div>
        )}

        {/* ── Steps 1-3: Questions ─────────────────────────────────────────── */}
        {step >= 1 && step <= 3 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>שלב {step} מתוך {TOTAL_STEPS}</span>
                <span>{Math.round((step / TOTAL_STEPS) * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                  style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                />
              </div>
            </div>

            {/* ── Step 1: Solutions ──────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 flex items-center justify-center">
                    <Briefcase size={18} className="text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">מהם הפתרונות שלך?</h2>
                    <p className="text-slate-500 text-xs">השירותים או המוצרים שאתה מציע ללקוחות</p>
                  </div>
                </div>

                {/* Tag input */}
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={solutionInput}
                    onChange={e => setSolutionInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSolution(); } }}
                    placeholder="למשל: בניית אתרים, SEO, פרסום בגוגל..."
                    className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                  <button
                    onClick={addSolution}
                    disabled={!solutionInput.trim()}
                    className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
                  >
                    <Plus size={16} className="text-white" />
                  </button>
                </div>

                {/* Tags */}
                {solutions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {solutions.map(s => (
                      <span key={s} className="flex items-center gap-1.5 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-sm px-3 py-1.5 rounded-xl">
                        {s}
                        <button onClick={() => removeSolution(s)} className="hover:text-white transition-colors">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {solutions.length === 0 && (
                  <p className="text-slate-600 text-xs">הוסף לפחות פתרון אחד</p>
                )}
              </div>
            )}

            {/* ── Step 2: Ideal client + pain points ────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-2xl bg-violet-500/15 flex items-center justify-center">
                    <User size={18} className="text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">מי הלקוח שלך?</h2>
                    <p className="text-slate-500 text-xs">תאר את הלקוח האידיאלי שלך</p>
                  </div>
                </div>
                <textarea
                  autoFocus
                  value={idealClient}
                  onChange={e => setIdealClient(e.target.value)}
                  placeholder="למשל: בעלי עסקים קטנים ובינוניים בתחום הקמעונאות, שמחפשים להגדיל נוכחות דיגיטלית..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors resize-none"
                />

                <div className="pt-1">
                  <label className="block text-slate-400 text-xs font-medium mb-2">
                    מה הבעיות שאתה פותר? <span className="text-slate-600">(אופציונלי)</span>
                  </label>
                  <textarea
                    value={painPoints}
                    onChange={e => setPainPoints(e.target.value)}
                    placeholder="למשל: חוסר נוכחות ברשת, תנועה נמוכה לאתר, קושי להמיר גולשים ללקוחות..."
                    rows={2}
                    className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors resize-none"
                  />
                </div>
              </div>
            )}

            {/* ── Step 3: Sales process + deal size ─────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
                    <TrendingUp size={18} className="text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">תהליך המכירה שלך</h2>
                    <p className="text-slate-500 text-xs">איך נראית מכירה טיפוסית אצלך?</p>
                  </div>
                </div>
                <textarea
                  autoFocus
                  value={salesProcess}
                  onChange={e => setSalesProcess(e.target.value)}
                  placeholder="למשל: פנייה ראשונית → שיחת היכרות → הצעת מחיר → מו״מ → חתימה. תהליך ממוצע 2-3 שבועות..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors resize-none"
                />

                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-2 flex items-center gap-1">
                    <DollarSign size={12} />
                    גודל עסקה ממוצע <span className="text-slate-600">(אופציונלי)</span>
                  </label>
                  <input
                    value={avgDealSize}
                    onChange={e => setAvgDealSize(e.target.value)}
                    placeholder="למשל: 3,000 - 15,000 ₪"
                    className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">{error}</p>
            )}

            {/* Navigation */}
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm transition-colors"
              >
                <ChevronRight size={14} />
                הקודם
              </button>
              <button
                onClick={next}
                disabled={!canNext()}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                  canNext()
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                {step === TOTAL_STEPS ? (
                  <><Sparkles size={14} />עצב את הכרטיס</>
                ) : (
                  <>הבא<ChevronLeft size={14} /></>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Loading ────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="text-center space-y-6">
            <div className="inline-flex w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 items-center justify-center shadow-2xl shadow-indigo-500/40 mx-auto">
              <RefreshCw size={32} className="text-white animate-spin" />
            </div>
            <div>
              <h2 className="text-white font-black text-2xl mb-2">ה-AI מעצב את הכרטיס שלך...</h2>
              <p className="text-slate-400 text-sm">מנתח את העסק ומתאים את המערכת לצרכים שלך</p>
            </div>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              {['מנתח את השירותים שלך', 'מגדיר פרופיל לקוח אידיאלי', 'מכווין את עוזר ה-AI', 'מייצר כרטיס מותאם אישית'].map((t, i) => (
                <div key={t} className="flex items-center gap-3 text-slate-500 text-sm" style={{ animationDelay: `${i * 0.3}s` }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                  {t}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 5: Result card ────────────────────────────────────────── */}
        {step === 5 && result && (
          <div className="space-y-4">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-emerald-500/20 items-center justify-center mx-auto">
                <CheckCircle2 size={28} className="text-emerald-400" />
              </div>
              <h2 className="text-white font-black text-2xl">הכרטיס שלך מוכן!</h2>
              <p className="text-slate-400 text-sm">ה-AI הוגדר בהתאם לעסק שלך</p>
            </div>

            {/* Card preview */}
            <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
              {/* Card header */}
              <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Zap size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-base">{workspace.name}</p>
                  <p className="text-white/70 text-xs">{workspace.industry ?? 'עסק'}</p>
                </div>
              </div>

              {/* Services */}
              <div className="px-5 py-3 border-b border-slate-800">
                <p className="text-slate-500 text-xs font-medium mb-2">שירותים</p>
                <div className="flex flex-wrap gap-1.5">
                  {solutions.map(s => (
                    <span key={s} className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs px-2.5 py-1 rounded-lg">{s}</span>
                  ))}
                </div>
              </div>

              {/* Fields */}
              <div className="px-5 py-3 space-y-3">
                <Field icon={Target}      label="לקוח אידיאלי"   value={result.idealClient}    color="text-violet-400" />
                <Field icon={TrendingUp}  label="תהליך מכירה"    value={result.salesProcess}   color="text-emerald-400" />
                {result.avgDealSize && (
                  <Field icon={DollarSign} label="עסקה ממוצעת"    value={result.avgDealSize}    color="text-amber-400" />
                )}
                <Field icon={Sparkles}    label="ליד חם — סימנים" value={result.hotLeadSignals} color="text-indigo-400" />
              </div>

              {/* Tone badge */}
              <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-slate-500 text-xs">סגנון תקשורת</span>
                <span className="bg-slate-800 text-slate-300 text-xs px-3 py-1 rounded-full border border-slate-700">{result.tone}</span>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={onComplete}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} />
              כניסה לדף הלידים
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── small helper ────────────────────────────────────────────────────────── */
function Field({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon size={14} className={`${color} flex-shrink-0 mt-0.5`} />
      <div className="min-w-0">
        <p className="text-slate-500 text-[10px] uppercase tracking-wide font-medium">{label}</p>
        <p className="text-slate-300 text-sm leading-snug whitespace-pre-line">{value}</p>
      </div>
    </div>
  );
}
