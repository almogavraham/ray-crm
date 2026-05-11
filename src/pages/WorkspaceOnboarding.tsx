import { useState, useRef } from 'react';
import {
  Zap, Upload, Sparkles, CheckCircle2, ArrowLeft, ArrowRight,
  Building2, Users, Lightbulb, X,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile } from '../types';

interface Props {
  workspace: WorkspaceProfile;
  onComplete: () => void;
}

type Step = 'logo' | 'prompt' | 'team' | 'done';

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'logo',   label: 'לוגו',       icon: <Building2 size={14} /> },
  { key: 'prompt', label: 'על העסק',    icon: <Lightbulb size={14} /> },
  { key: 'team',   label: 'הצוות',      icon: <Users size={14} /> },
];

const INDUSTRIES = [
  'סוכנות שיווק דיגיטלי', 'נדל"ן', 'טכנולוגיה / תוכנה', 'פיננסים וביטוח',
  'שירותים עסקיים', 'קמעונאות / אי-קומרס', 'בריאות', 'חינוך', 'בניה ונדל"ן', 'אחר',
];
const TEAM_SIZES = ['1 (סולו)', '2-5', '6-10', '11-25', '25+'];

export default function WorkspaceOnboarding({ workspace, onComplete }: Props) {
  const [step,     setStep]     = useState<Step>('logo');
  const [logoUrl,  setLogoUrl]  = useState(workspace.logoUrl ?? '');
  const [prompt,   setPrompt]   = useState(workspace.prompt  ?? '');
  const [industry, setIndustry] = useState(workspace.industry ?? '');
  const [teamSize, setTeamSize] = useState(workspace.teamSize ?? '');
  const [saving,   setSaving]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stepIndex = STEPS.findIndex(s => s.key === step);

  /* ── Logo upload (base64) ───────────────────────────────────────────────── */
  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { alert('גודל הקובץ חייב להיות עד 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  /* ── Save all & complete ─────────────────────────────────────────────────── */
  const finish = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        logoUrl:            logoUrl  || null,
        prompt:             prompt   || null,
        industry:           industry || null,
        teamSize:           teamSize || null,
        onboardingComplete: true,
      });
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const next = () => {
    if (step === 'logo')   setStep('prompt');
    if (step === 'prompt') setStep('team');
    if (step === 'team')   void finish();
  };
  const back = () => {
    if (step === 'prompt') setStep('logo');
    if (step === 'team')   setStep('prompt');
  };

  if (step === 'done') return (
    <FullScreen>
      <div className="text-center py-10">
        <CheckCircle2 size={64} className="text-emerald-400 mx-auto mb-5" />
        <h2 className="text-white font-black text-2xl mb-2">הכל מוכן! 🚀</h2>
        <p className="text-slate-400 text-sm">המערכת מותאמת לעסק שלך</p>
      </div>
    </FullScreen>
  );

  return (
    <FullScreen>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
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

      {/* Step progress */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
            <div className={`w-full h-1.5 rounded-full transition-all ${i <= stepIndex ? 'bg-indigo-500' : 'bg-slate-800'}`} />
            <span className={`text-[10px] font-medium transition-colors flex items-center gap-1 ${i <= stepIndex ? 'text-indigo-400' : 'text-slate-600'}`}>
              {s.icon}{s.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── STEP: Logo ─────────────────────────────────────────────────────── */}
      {step === 'logo' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">הלוגו של העסק</h2>
            <p className="text-slate-400 text-sm mt-1">הלוגו יופיע בממשק ובהצעות המחיר שלך</p>
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

          {logoUrl ? (
            <div className="relative w-40 h-40 mx-auto">
              <img src={logoUrl} alt="logo" className="w-full h-full object-contain rounded-2xl bg-slate-800 border-2 border-indigo-500/40 p-3" />
              <button onClick={() => setLogoUrl('')}
                className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-400 transition-colors">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-2xl py-10 flex flex-col items-center gap-3 transition-colors group">
              <div className="w-14 h-14 bg-slate-800 group-hover:bg-indigo-900/30 rounded-2xl flex items-center justify-center transition-colors">
                <Upload size={22} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
              </div>
              <div className="text-center">
                <p className="text-slate-300 font-semibold text-sm">לחץ להעלאת לוגו</p>
                <p className="text-slate-600 text-xs mt-0.5">PNG, JPG עד 2MB</p>
              </div>
            </button>
          )}

          <div className="text-center">
            <p className="text-slate-600 text-xs">ניתן לדלג ולהוסיף מאוחר יותר מהגדרות</p>
          </div>
        </div>
      )}

      {/* ── STEP: Prompt ───────────────────────────────────────────────────── */}
      {step === 'prompt' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">ספר לנו על העסק</h2>
            <p className="text-slate-400 text-sm mt-1">ה-AI ישתמש במידע הזה כדי להתאים את עצמו לעסק שלך</p>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">תחום עיסוק</label>
            <select value={industry} onChange={e => setIndustry(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500">
              <option value="">בחר תחום...</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5 flex items-center gap-1.5">
              <Sparkles size={11} className="text-indigo-400" />
              תיאור העסק לסוכן ה-AI
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={5}
              className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="למשל: אנחנו סוכנות שיווק דיגיטלי המתמחה בניהול קמפיינים בפייסבוק ואינסטגרם לעסקים קטנים ובינוניים בישראל. הלקוחות שלנו הם בעיקר בתחום הנדל&#34;ן, קוסמטיקה ואוכל. אנחנו עובדים עם תקציבים של 2,000-20,000 ₪ בחודש."
            />
            <p className="text-slate-600 text-xs mt-1.5">
              ככל שתפרט יותר — כך ה-AI יתאים טוב יותר את ההמלצות, הודעות הפולואפ ותוכן השיווק
            </p>
          </div>
        </div>
      )}

      {/* ── STEP: Team ─────────────────────────────────────────────────────── */}
      {step === 'team' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-white font-black text-xl">גודל הצוות</h2>
            <p className="text-slate-400 text-sm mt-1">נתאים את המערכת לגודל הצוות שלך</p>
          </div>

          <div className="space-y-2.5">
            {TEAM_SIZES.map(size => (
              <button key={size} type="button"
                onClick={() => setTeamSize(size)}
                className={`w-full text-right px-5 py-3.5 rounded-xl border-2 font-semibold text-sm transition-all ${
                  teamSize === size
                    ? 'border-indigo-500 bg-indigo-900/30 text-white'
                    : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                }`}>
                {size} אנשים
              </button>
            ))}
          </div>

          {/* Summary */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 space-y-2">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">סיכום סביבת העבודה</p>
            {logoUrl && <div className="flex items-center gap-2 text-sm text-slate-300"><CheckCircle2 size={13} className="text-emerald-400" /> לוגו הועלה</div>}
            {industry && <div className="flex items-center gap-2 text-sm text-slate-300"><CheckCircle2 size={13} className="text-emerald-400" /> תחום: {industry}</div>}
            {prompt && <div className="flex items-center gap-2 text-sm text-slate-300"><CheckCircle2 size={13} className="text-emerald-400" /> תיאור עסק הוגדר ({prompt.length} תווים)</div>}
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex gap-3 mt-8">
        {step !== 'logo' && (
          <button type="button" onClick={back}
            className="flex items-center gap-1.5 px-4 py-3 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-xl text-sm transition-all">
            <ArrowLeft size={14} /> חזרה
          </button>
        )}
        <button type="button" onClick={next} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20">
          {saving ? 'שומר...' : step === 'team' ? 'סיים והתחל →' : (<>המשך <ArrowRight size={14} /></>)}
        </button>
      </div>
    </FullScreen>
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
