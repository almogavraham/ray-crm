import { useState, useRef } from 'react';
import {
  Zap, Upload, Sparkles, CheckCircle2, ArrowLeft, ArrowRight,
  Building2, Users, Lightbulb, X, Plus, Package, Brain, Briefcase,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile } from '../types';

interface Props {
  workspace: WorkspaceProfile;
  onComplete: () => void;
}

type Step = 'industry' | 'team' | 'prompt' | 'ai' | 'logo';

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'industry', label: 'תחום',    icon: <Building2 size={13} /> },
  { key: 'team',     label: 'צוות',    icon: <Users     size={13} /> },
  { key: 'prompt',   label: 'על העסק', icon: <Lightbulb size={13} /> },
  { key: 'ai',       label: 'עוזר AI', icon: <Brain     size={13} /> },
  { key: 'logo',     label: 'לוגו',     icon: <Package    size={13} /> },
];

const INDUSTRIES = [
  'סוכנות שיווק דיגיטלי',
  'נדל"ן',
  'טכנולוגיה / תוכנה',
  'פיננסים וביטוח',
  'שירותים עסקיים',
  'קמעונאות / אי-קומרס',
  'בריאות ורפואה',
  'חינוך והדרכה',
  'בנייה ותשתיות',
  'ייעוץ וניהול',
  'משפטים וחשבונאות',
  'תיירות ואירוח',
  'אחר',
];

const TEAM_SIZES = [
  { label: '1', sub: 'סולו — רק אני' },
  { label: '2–5', sub: 'צוות קטן' },
  { label: '6–10', sub: 'צוות בינוני' },
  { label: '11–25', sub: 'ארגון גדל' },
  { label: '25+', sub: 'ארגון גדול' },
];

export default function WorkspaceOnboarding({ workspace, onComplete }: Props) {
  const [step,               setStep]               = useState<Step>('industry');
  const [industry,           setIndustry]           = useState(workspace.industry ?? '');
  const [isBusiness,         setIsBusiness]         = useState(workspace.isBusiness ?? false);
  const [solutions,          setSolutions]          = useState<string[]>(workspace.businessSolutions ?? []);
  const [solutionInput,      setSolutionInput]      = useState('');
  const [teamSize,           setTeamSize]           = useState(workspace.teamSize ?? '');
  const [prompt,             setPrompt]             = useState(workspace.prompt ?? '');
  const [logoUrl,            setLogoUrl]            = useState(workspace.logoUrl ?? '');
  const [saving,             setSaving]             = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI Profile state
  const existing = workspace.aiProfile ?? {};
  const [idealClient,       setIdealClient]       = useState(existing.idealClient       ?? '');
  const [painPoints,        setPainPoints]        = useState(existing.painPoints        ?? '');
  const [salesProcess,      setSalesProcess]      = useState(existing.salesProcess      ?? '');
  const [avgDealSize,       setAvgDealSize]       = useState(existing.avgDealSize       ?? '');
  const [commonObjections,  setCommonObjections]  = useState(existing.commonObjections  ?? '');
  const [uniqueValue,       setUniqueValue]       = useState(existing.uniqueValue       ?? '');
  const [tone,              setTone]              = useState(existing.tone              ?? 'מקצועי וידידותי');

  const stepIndex = STEPS.findIndex(s => s.key === step);

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  const addSolution = () => {
    const val = solutionInput.trim();
    if (!val || solutions.includes(val)) return;
    setSolutions(prev => [...prev, val]);
    setSolutionInput('');
  };
  const removeSolution = (name: string) =>
    setSolutions(prev => prev.filter(s => s !== name));

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { alert('גודל הקובץ חייב להיות עד 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  /* ── Save & complete ─────────────────────────────────────────────────────── */
  const finish = async () => {
    setSaving(true);
    try {
      const update: Record<string, unknown> = {
        onboardingComplete: true,
        industry:           industry || null,
        teamSize:           teamSize || null,
        prompt:             prompt   || null,
        logoUrl:            logoUrl  || null,
        isBusiness,
        businessSolutions:  isBusiness && solutions.length > 0 ? solutions : [],
        aiProfile: {
          idealClient:      idealClient      || null,
          painPoints:       painPoints       || null,
          salesProcess:     salesProcess     || null,
          avgDealSize:      avgDealSize      || null,
          commonObjections: commonObjections || null,
          uniqueValue:      uniqueValue      || null,
          tone:             tone             || 'מקצועי וידידותי',
        },
      };
      await updateDoc(doc(db, 'workspaces', workspace.id), update);
      onComplete();
    } catch (err) {
      console.error('שגיאה בשמירת ה-onboarding:', err);
      alert('שגיאה בשמירת הנתונים. נסה שנית.');
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 'industry') setStep('team');
    if (step === 'team')     setStep('prompt');
    if (step === 'prompt')   setStep('ai');
    if (step === 'ai')       setStep('logo');
    if (step === 'logo')     void finish();
  };
  const back = () => {
    if (step === 'team')   setStep('industry');
    if (step === 'prompt') setStep('team');
    if (step === 'ai')     setStep('prompt');
    if (step === 'logo')   setStep('ai');
  };

  return (
    <FullScreen>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/30">
          <Zap size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-white font-black text-lg leading-tight">{workspace.name}</p>
          <p className="text-slate-500 text-xs">הגדרת סביבת העבודה</p>
        </div>
        <button onClick={finish} className="text-slate-600 hover:text-slate-400 text-xs transition-colors">
          דלג
        </button>
      </div>

      {/* ── Step progress ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
            <div className={`w-full h-1.5 rounded-full transition-all duration-300 ${i <= stepIndex ? 'bg-indigo-500' : 'bg-slate-800'}`} />
            <span className={`text-[10px] font-medium transition-colors flex items-center gap-1 ${i <= stepIndex ? 'text-indigo-400' : 'text-slate-600'}`}>
              {s.icon}{s.label}
            </span>
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 1 — תחום ענף + האם עסק */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'industry' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-white font-black text-xl">באיזה תחום העסק שלך?</h2>
            <p className="text-slate-400 text-sm mt-1">נשתמש במידע כדי לאפיין את המערכת לתחום שלך</p>
          </div>

          {/* Industry grid */}
          <div className="grid grid-cols-2 gap-2">
            {INDUSTRIES.map(ind => (
              <button key={ind} type="button"
                onClick={() => setIndustry(ind)}
                className={`text-right px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  industry === ind
                    ? 'border-indigo-500 bg-indigo-900/40 text-white shadow-lg shadow-indigo-500/10'
                    : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600 hover:text-white'
                }`}>
                {ind}
              </button>
            ))}
          </div>

          {/* Is business? */}
          <div className="border border-slate-700 rounded-2xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-white font-semibold text-sm flex items-center gap-1.5">
                  <Briefcase size={14} className="text-indigo-400" />
                  האם אתה עסק עם מוצרים / שירותים?
                </p>
                <p className="text-slate-500 text-xs mt-0.5">אם כן, הפתרונות שלך יוצגו בכל ליד</p>
              </div>
              {/* Toggle */}
              <button type="button" onClick={() => setIsBusiness(p => !p)}
                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 ${
                  isBusiness ? 'bg-indigo-600' : 'bg-slate-700'
                }`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                  isBusiness ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            {/* Solutions input — shown only if isBusiness */}
            {isBusiness && (
              <div className="space-y-3 pt-1 border-t border-slate-700/60">
                <p className="text-slate-400 text-xs font-medium">מה הפתרונות / שירותים שאתה מציע?</p>

                {/* Existing solutions */}
                {solutions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {solutions.map(s => (
                      <span key={s}
                        className="flex items-center gap-1.5 bg-indigo-900/40 border border-indigo-500/30 text-indigo-200 text-xs font-medium px-2.5 py-1 rounded-lg">
                        {s}
                        <button type="button" onClick={() => removeSolution(s)}
                          className="text-indigo-400 hover:text-red-400 transition-colors">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add solution input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={solutionInput}
                    onChange={e => setSolutionInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSolution())}
                    placeholder='למשל: "ניהול קמפיינים", "אתר אינטרנט"...'
                    className="flex-1 bg-slate-800 border border-slate-600 text-white placeholder-slate-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button type="button" onClick={addSolution}
                    disabled={!solutionInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors">
                    <Plus size={14} />
                    הוסף
                  </button>
                </div>
                <p className="text-slate-600 text-xs">לחץ Enter או "הוסף" אחרי כל פתרון</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 2 — גודל הצוות */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'team' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">כמה משתמשים יעבדו במערכת?</h2>
            <p className="text-slate-400 text-sm mt-1">נתאים את חבילת הצוות ואת ממשק הניהול</p>
          </div>

          <div className="space-y-2.5">
            {TEAM_SIZES.map(({ label, sub }) => (
              <button key={label} type="button"
                onClick={() => setTeamSize(label)}
                className={`w-full flex items-center justify-between px-5 py-3.5 rounded-xl border-2 transition-all ${
                  teamSize === label
                    ? 'border-indigo-500 bg-indigo-900/30 shadow-lg shadow-indigo-500/10'
                    : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                }`}>
                <span className={`font-black text-lg ${teamSize === label ? 'text-indigo-300' : 'text-white'}`}>
                  {label}
                </span>
                <span className={`text-sm ${teamSize === label ? 'text-indigo-400' : 'text-slate-500'}`}>
                  {sub}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 3 — תיאור לסוכן ה-AI */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'prompt' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">ספר לנו על העסק שלך</h2>
            <p className="text-slate-400 text-sm mt-1">
              ה-AI ישתמש במידע הזה כדי להתאים לך המלצות, הודעות פולואפ ותוכן שיווקי
            </p>
          </div>

          <div className="relative">
            <Sparkles size={14} className="absolute top-3.5 right-3.5 text-indigo-400 pointer-events-none" />
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={8}
              className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-4 py-3 text-sm focus:outline-none focus:border-indigo-500 resize-none transition-colors leading-relaxed"
              placeholder={`למשל:\nאנחנו סוכנות שיווק דיגיטלי המתמחה בניהול קמפיינים בפייסבוק ואינסטגרם לעסקים קטנים ובינוניים בישראל.\n\nהלקוחות שלנו הם בעיקר בתחום הנדל"ן, קוסמטיקה ואוכל.\n\nאנחנו עובדים עם תקציבים של 2,000–20,000 ₪ בחודש.\n\nהצוות שלנו: 3 אנשים.`}
            />
          </div>

          <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3.5">
            <p className="text-indigo-300 text-xs font-semibold mb-1 flex items-center gap-1.5">
              <Sparkles size={11} /> טיפ לתוצאות טובות יותר
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              כלול: מה העסק עושה, מי הלקוחות האידיאליים, מה גודל העסקאות הטיפוסיות, ומה הערך המרכזי שאתה מציע.
            </p>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            {industry && (
              <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                <Building2 size={10} className="text-indigo-400" /> {industry}
              </span>
            )}
            {teamSize && (
              <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                <Users size={10} className="text-indigo-400" /> {teamSize} משתמשים
              </span>
            )}
            {isBusiness && solutions.length > 0 && (
              <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                <Package size={10} className="text-indigo-400" /> {solutions.length} פתרונות
              </span>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 4 — כיוון עוזר ה-AI                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'ai' && (
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Brain size={14} className="text-white" />
              </div>
              <h2 className="text-white font-black text-xl">אפיון עוזר ה-AI</h2>
            </div>
            <p className="text-slate-400 text-sm mt-1 mr-9">
              ענה על השאלות הבאות — העוזר ישתמש במידע כדי להיות מומחה בתחום שלך
            </p>
          </div>

          <div className="space-y-4">
            {/* Ideal client */}
            <AiField
              label="מי הלקוח האידיאלי שלך?"
              placeholder="למשל: בעלי עסקים קטנים בתחום הנדל&quot;ן עם תקציב 5,000–20,000 ₪ לחודש"
              value={idealClient}
              onChange={setIdealClient}
            />

            {/* Pain points */}
            <AiField
              label="איזו בעיה אתה פותר ללקוח?"
              placeholder="למשל: הלקוחות שלנו מתקשים להביא לידים איכותיים ולהמיר אותם לעסקאות"
              value={painPoints}
              onChange={setPainPoints}
            />

            {/* Unique value */}
            <AiField
              label="מה מייחד אותך מהמתחרים?"
              placeholder="למשל: אנחנו מתמחים ב-AI Marketing ומציעים תוצאות תוך 30 יום עם ערבות"
              value={uniqueValue}
              onChange={setUniqueValue}
            />

            {/* Sales process */}
            <AiField
              label="איך נראה תהליך המכירה שלך?"
              placeholder="למשל: שיחת היכרות 30 דק' → הצעת מחיר → פגישת המשך → חתימה → קיקאוף"
              value={salesProcess}
              onChange={setSalesProcess}
            />

            {/* Avg deal */}
            <AiField
              label="מה גודל העסקה הממוצעת?"
              placeholder='למשל: 3,000–15,000 ₪ לחודש, לרוב חוזה שנתי'
              value={avgDealSize}
              onChange={setAvgDealSize}
            />

            {/* Common objections */}
            <AiField
              label="מה ההתנגדויות הנפוצות מלידים?"
              placeholder='למשל: "יקר מדי", "ניסינו כבר ולא עבד", "אני צריך לחשוב על זה"'
              value={commonObjections}
              onChange={setCommonObjections}
            />

            {/* Tone */}
            <div>
              <label className="block text-slate-400 text-xs font-semibold mb-2">טון תקשורת של העוזר</label>
              <div className="grid grid-cols-3 gap-2">
                {['מקצועי ורשמי', 'מקצועי וידידותי', 'קליל ונינוח'].map(t => (
                  <button key={t} type="button" onClick={() => setTone(t)}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                      tone === t
                        ? 'border-indigo-500 bg-indigo-900/40 text-white'
                        : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-white'
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-violet-950/40 border border-violet-500/20 rounded-xl p-3.5">
            <p className="text-violet-300 text-xs font-semibold mb-1 flex items-center gap-1.5">
              <Brain size={11} /> איך זה עובד?
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              העוזר AI שלך ילמד את המידע הזה ויהפוך למומחה בתחום שלך — יתן המלצות מדויקות לכל ליד, יעזור בכתיבת הודעות פולואפ, ויציע אסטרטגיות מכירה מותאמות.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 5 — לוגו (אופציונלי) */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'logo' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">לוגו העסק</h2>
            <p className="text-slate-400 text-sm mt-1">יופיע בממשק ובהצעות המחיר — אפשר לדלג ולהוסיף מאוחר</p>
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

          {logoUrl ? (
            <div className="relative w-36 h-36 mx-auto">
              <img src={logoUrl} alt="logo"
                className="w-full h-full object-contain rounded-2xl bg-slate-800 border-2 border-indigo-500/40 p-3 shadow-xl" />
              <button onClick={() => setLogoUrl('')}
                className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white transition-colors shadow-lg">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-2xl py-10 flex flex-col items-center gap-3 transition-all group">
              <div className="w-14 h-14 bg-slate-800 group-hover:bg-indigo-900/30 rounded-2xl flex items-center justify-center transition-colors">
                <Upload size={22} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
              </div>
              <div className="text-center">
                <p className="text-slate-300 font-semibold text-sm">לחץ להעלאת לוגו</p>
                <p className="text-slate-600 text-xs mt-0.5">PNG, JPG עד 2MB</p>
              </div>
            </button>
          )}

          {/* Final summary */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 space-y-2">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">סיכום סביבת העבודה</p>
            {industry && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                תחום: {industry}
              </div>
            )}
            {teamSize && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                {teamSize} משתמשים
              </div>
            )}
            {isBusiness && solutions.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>פתרונות: {solutions.join(', ')}</span>
              </div>
            )}
            {prompt && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                תיאור עסק ({prompt.length} תווים)
              </div>
            )}
            {logoUrl && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                לוגו הועלה
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Nav buttons ────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mt-8">
        {step !== 'industry' && (
          <button type="button" onClick={back}
            className="flex items-center gap-1.5 px-4 py-3 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-xl text-sm transition-all">
            <ArrowLeft size={14} /> חזרה
          </button>
        )}
        <button type="button" onClick={next} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20">
          {saving
            ? 'שומר...'
            : step === 'logo'
              ? '🚀 סיים והתחל'
              : (<>המשך <ArrowRight size={14} /></>)
          }
        </button>
      </div>
    </FullScreen>
  );
}

function AiField({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-slate-300 text-xs font-semibold mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-colors leading-relaxed"
      />
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        {children}
      </div>
    </div>
  );
}
