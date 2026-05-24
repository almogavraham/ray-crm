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
  Zap, RefreshCw, User, DollarSign, ArrowLeft, Package,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getApiKey } from '../lib/apiKey';
import type { WorkspaceProfile } from '../types';

/* ── types ───────────────────────────────────────────────────────────────── */
interface CardFieldOption {
  key:          string;   // unique identifier, e.g. "budget", "revenue"
  label:        string;   // Hebrew display label
  description:  string;   // why it fits this business
  prefix:       string;   // "₪" or ""
  quickOptions: number[]; // 3 typical values for quick-select
}

interface AiResult {
  idealClient:      string;
  painPoints:       string;
  salesProcess:     string;
  avgDealSize:      string;
  uniqueValue:      string;
  tone:             string;
  hotLeadSignals:   string;
  prompt:           string;
  leftFieldOptions: CardFieldOption[]; // ≥3 AI-suggested left-panel field choices
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

  // Card config state (Step 5)
  const [selectedLeftKey,  setSelectedLeftKey]  = useState('');
  const [cardSolutions,    setCardSolutions]    = useState<string[]>([]);
  const [newSolutionInput, setNewSolutionInput] = useState('');

  /* ── helpers ───────────────────────────────────────────────────────────── */
  const addSolution = () => {
    const v = solutionInput.trim();
    if (v && !solutions.includes(v)) setSolutions(p => [...p, v]);
    setSolutionInput('');
  };

  const removeSolution = (s: string) => setSolutions(p => p.filter(x => x !== s));

  /* ── Card config helpers ──────────────────────────────────────────────── */
  const addCardSolution = () => {
    const v = newSolutionInput.trim();
    if (v && !cardSolutions.includes(v)) setCardSolutions(p => [...p, v]);
    setNewSolutionInput('');
  };

  const saveCardConfig = async () => {
    const opts = result?.leftFieldOptions ?? [];
    const selectedOpt = opts.find(o => o.key === selectedLeftKey) ?? opts[0];
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        businessSolutions: cardSolutions,
        ...(selectedOpt ? {
          cardLeftField: {
            key:          selectedOpt.key,
            label:        selectedOpt.label,
            prefix:       selectedOpt.prefix ?? '₪',
            quickOptions: selectedOpt.quickOptions ?? [],
          },
        } : {}),
      });
    } catch (e) {
      console.error('saveCardConfig error:', e);
    }
    onComplete();
  };

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

    const systemPrompt = `אתה מומחה CRM ואסטרטגיית מכירות לעסקים ישראליים.
חוק ברזל: החזר JSON תקני בלבד — ללא markdown, ללא \`\`\`, ללא טקסט לפני/אחרי ה-JSON.
כל ערכי המחרוזות בעברית. תוכן קצר וענייני.

לשדה leftFieldOptions: הצע 3 שדות מידע ראשיים שיוצגו בכרטיס הליד, מותאמים לסוג העסק הספציפי.
- סוכנות שיווק → תקציב שיווק / ערך עסקה / מחזור שנתי
- קבלן/נדל"ן → עלות פרויקט / שטח / ערך חוזה
- יועץ/עו"ד → שכר טרחה / ערך התיק / היקף פרויקט
- מסחר/קמעונאות → ערך הזמנה / נפח רכישה / מחזור חודשי
key חייב להיות מזהה ייחודי באנגלית ללא רווחים (לדוגמה: "marketing_budget", "deal_value").`;

    const userPrompt = `--- מידע מהרישום ---
${registrationInfo || 'לא קיים'}

--- מידע מהשאלות ---
פתרונות/שירותים: ${solutions.join(', ') || 'לא צוין'}
לקוח אידיאלי: ${idealClient || 'לא צוין'}
בעיות שנפתרות: ${painPoints || 'לא צוין'}
תהליך מכירה: ${salesProcess || 'לא צוין'}
גודל עסקה ממוצע: ${avgDealSize || 'לא צוין'}

החזר JSON בדיוק בפורמט הזה (ללא שום טקסט נוסף):
{"idealClient":"...","painPoints":"...","salesProcess":"...","avgDealSize":"...","uniqueValue":"...","tone":"פורמלי או ידידותי או מקצועי","hotLeadSignals":"• סימן 1\n• סימן 2\n• סימן 3","prompt":"...","leftFieldOptions":[{"key":"unique_key_1","label":"שם השדה","description":"למה מתאים לעסק זה","prefix":"₪","quickOptions":[1000,5000,15000]},{"key":"unique_key_2","label":"שם השדה","description":"למה מתאים","prefix":"₪","quickOptions":[2000,8000,25000]},{"key":"unique_key_3","label":"שם השדה","description":"למה מתאים","prefix":"₪","quickOptions":[500,2000,10000]}]}`;

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });

      const raw = (msg.content[0] as { text: string }).text.trim();
      // Strip markdown fences if present
      const json = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let parsed: AiResult;
      try {
        parsed = JSON.parse(json);
      } catch (parseErr) {
        console.error('JSON parse error. Raw response:', raw);
        throw new Error(`שגיאת פענוח JSON: ${(parseErr as Error).message}`);
      }

      // Ensure leftFieldOptions exists and has valid structure
      if (!Array.isArray(parsed.leftFieldOptions) || parsed.leftFieldOptions.length === 0) {
        parsed.leftFieldOptions = [
          { key: 'deal_value', label: 'ערך עסקה', description: 'שווי העסקה הצפוי', prefix: '₪', quickOptions: [5000, 15000, 30000] },
          { key: 'budget',     label: 'תקציב',    description: 'תקציב הלקוח',        prefix: '₪', quickOptions: [2000, 8000, 20000]  },
          { key: 'revenue',    label: 'מחזור שנתי', description: 'הכנסות שנתיות',   prefix: '₪', quickOptions: [50000, 200000, 500000] },
        ];
      }

      // Save AI profile to Firestore immediately
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

      // Initialise card config UI state
      setCardSolutions([...solutions]);
      const opts = parsed.leftFieldOptions ?? [];
      if (opts.length) setSelectedLeftKey(opts[0].key);

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

        {/* ── Step 5: Card Config ────────────────────────────────────────── */}
        {step === 5 && result && (() => {
          const opts = result.leftFieldOptions ?? [];
          const selectedOpt = opts.find(o => o.key === selectedLeftKey) ?? opts[0];
          return (
            <div className="space-y-4 max-h-[82vh] overflow-y-auto pr-0.5">

              {/* Header */}
              <div className="text-center space-y-1">
                <div className="inline-flex w-12 h-12 rounded-2xl bg-emerald-500/20 items-center justify-center mx-auto">
                  <CheckCircle2 size={24} className="text-emerald-400" />
                </div>
                <h2 className="text-white font-black text-xl">עצב את כרטיס הליד שלך</h2>
                <p className="text-slate-400 text-xs">בחר מה יוצג בכל צד, הוסף פתרונות ושמור</p>
              </div>

              {/* ── LEAD CARD PREVIEW ── */}
              <div className="bg-white rounded-2xl overflow-hidden shadow-xl border border-slate-200">
                {/* Card top bar */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                      <span className="text-white font-black text-xs">ל</span>
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm leading-none">לקוח לדוגמה בע"מ</p>
                      <p className="text-white/60 text-[10px]">example lead</p>
                    </div>
                  </div>
                  <span className="bg-red-500/90 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">🔥 חם</span>
                </div>
                {/* Two-panel body */}
                <div className="flex divide-x divide-x-reverse divide-slate-100">
                  {/* Left panel */}
                  <div className="flex-1 px-3 py-2.5">
                    <p className="text-slate-400 text-[9px] uppercase tracking-wide font-medium mb-1">
                      {selectedOpt?.label ?? 'שדה שמאלי'}
                    </p>
                    <p className="text-slate-800 font-bold text-lg leading-none">
                      {selectedOpt?.prefix ?? '₪'}{(selectedOpt?.quickOptions?.[1] ?? 15000).toLocaleString()}
                    </p>
                    {selectedOpt?.quickOptions && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {selectedOpt.quickOptions.slice(0, 3).map(opt => (
                          <span key={opt} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            {selectedOpt.prefix}{opt.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Right panel */}
                  <div className="flex-1 px-3 py-2.5">
                    <p className="text-slate-400 text-[9px] uppercase tracking-wide font-medium mb-1">פתרונות</p>
                    <div className="space-y-0.5">
                      {cardSolutions.slice(0, 4).map(s => (
                        <div key={s} className="flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                          <span className="text-slate-700 text-xs truncate">{s}</span>
                        </div>
                      ))}
                      {cardSolutions.length > 4 && (
                        <span className="text-slate-400 text-[10px]">+{cardSolutions.length - 4} עוד</span>
                      )}
                      {cardSolutions.length === 0 && (
                        <span className="text-slate-300 text-xs italic">הוסף פתרונות למטה</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── LEFT FIELD SELECTOR ── */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-amber-400" />
                  <p className="text-white font-semibold text-sm">שדה שמאלי — מה יוצג?</p>
                </div>
                <p className="text-slate-500 text-xs">ה-AI הציע אפשרויות מותאמות לעסק שלך — בחר אחת:</p>
                <div className="space-y-2">
                  {opts.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setSelectedLeftKey(opt.key)}
                      className={`w-full text-right px-3 py-2.5 rounded-xl border transition-all ${
                        selectedLeftKey === opt.key
                          ? 'bg-amber-500/15 border-amber-500/40'
                          : 'bg-slate-800 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`text-sm flex-shrink-0 ${selectedLeftKey === opt.key ? 'text-amber-400' : 'text-slate-600'}`}>
                          {selectedLeftKey === opt.key ? '✓' : '○'}
                        </span>
                        <div className="text-right flex-1">
                          <p className={`font-semibold text-sm ${selectedLeftKey === opt.key ? 'text-amber-300' : 'text-slate-300'}`}>
                            {opt.label}
                          </p>
                          <p className="text-xs text-slate-500">{opt.description}</p>
                          {opt.quickOptions?.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {opt.quickOptions.slice(0, 3).map(v => (
                                <span key={v} className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                                  {opt.prefix}{v.toLocaleString()}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── SOLUTIONS / RIGHT PANEL MANAGER ── */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Package size={14} className="text-indigo-400" />
                  <p className="text-white font-semibold text-sm">פתרונות / מוצרים בכרטיס</p>
                </div>
                {/* Current solutions */}
                {cardSolutions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {cardSolutions.map(s => (
                      <span key={s} className="flex items-center gap-1.5 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs px-2.5 py-1.5 rounded-xl">
                        {s}
                        <button
                          onClick={() => setCardSolutions(p => p.filter(x => x !== s))}
                          className="hover:text-white transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-600 text-xs">טרם נוספו פתרונות</p>
                )}
                {/* Add inline */}
                <div className="flex gap-2">
                  <input
                    value={newSolutionInput}
                    onChange={e => setNewSolutionInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCardSolution(); } }}
                    placeholder="הוסף פתרון / מוצר..."
                    className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                  <button
                    onClick={addCardSolution}
                    disabled={!newSolutionInput.trim()}
                    className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors"
                  >
                    <Plus size={14} className="text-white" />
                  </button>
                </div>
              </div>

              {/* AI profile summary (collapsed details) */}
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-slate-500 hover:text-slate-300 text-xs select-none transition-colors">
                  <Zap size={12} className="text-indigo-400" />
                  פרופיל AI שנוצר
                  <ChevronLeft size={12} className="transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-2 bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
                  <Field icon={Target}     label="לקוח אידיאלי"    value={result.idealClient}    color="text-violet-400" />
                  <Field icon={TrendingUp} label="תהליך מכירה"     value={result.salesProcess}   color="text-emerald-400" />
                  {result.avgDealSize && <Field icon={DollarSign} label="עסקה ממוצעת" value={result.avgDealSize} color="text-amber-400" />}
                  <Field icon={Sparkles}   label="סימני ליד חם"    value={result.hotLeadSignals} color="text-indigo-400" />
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                    <span className="text-slate-500 text-[10px]">טון תקשורת</span>
                    <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded-full border border-slate-700">{result.tone}</span>
                  </div>
                </div>
              </details>

              {/* CTA */}
              <button
                onClick={saveCardConfig}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-2xl transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
              >
                <ArrowLeft size={16} />
                שמור וכנס לדף הלידים
              </button>
            </div>
          );
        })()}
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
