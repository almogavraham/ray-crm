import { useState, useRef } from 'react';
import {
  Zap, Upload, Sparkles, CheckCircle2, ArrowLeft, ArrowRight,
  Building2, Users, Lightbulb, X, Plus, Package, Brain, Briefcase,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile } from '../types';
import { useLang } from '../contexts/LangContext';

interface Props {
  workspace: WorkspaceProfile;
  onComplete: () => void;
}

type Step = 'team' | 'prompt' | 'ai' | 'logo';

const STEPS: { key: Step; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'team',     labelKey: 'onboarding.step.team',     icon: <Users     size={13} /> },
  { key: 'prompt',   labelKey: 'onboarding.step.about',    icon: <Lightbulb size={13} /> },
  { key: 'ai',       labelKey: 'onboarding.step.ai',       icon: <Brain     size={13} /> },
  { key: 'logo',     labelKey: 'onboarding.step.logo',     icon: <Package   size={13} /> },
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
  { label: '1', subKey: 'onboarding.soloTeam' },
  { label: '2–5', subKey: 'onboarding.smallTeam' },
  { label: '6–10', subKey: 'onboarding.mediumTeam' },
  { label: '11–25', subKey: 'onboarding.growingOrg' },
  { label: '25+', subKey: 'onboarding.largeOrg' },
];

export default function WorkspaceOnboarding({ workspace, onComplete }: Props) {
  const { t, dir } = useLang();
  const [step,               setStep]               = useState<Step>('team');
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
    if (file.size > 2_000_000) { alert(t('onboarding.logoSizeError')); return; }
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
      console.error('onboarding save error:', err);
      alert(t('onboarding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 'team')   setStep('prompt');
    if (step === 'prompt') setStep('ai');
    if (step === 'ai')     setStep('logo');
    if (step === 'logo')   void finish();
  };
  const back = () => {
    if (step === 'prompt') setStep('team');
    if (step === 'ai')     setStep('prompt');
    if (step === 'logo')   setStep('ai');
  };

  return (
    <FullScreen dir={dir}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
          <Zap size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-black text-lg leading-tight" style={{ color: 'white' }}>{workspace.name}</p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('onboarding.title')}</p>
        </div>
        <button onClick={finish} className="text-xs transition-colors" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {t('onboarding.skip')}
        </button>
      </div>

      {/* ── Step progress ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full h-1.5 rounded-full transition-all duration-300" style={{ background: i <= stepIndex ? 'linear-gradient(90deg,#8b5cf6,#6366f1)' : 'rgba(255,255,255,0.1)', boxShadow: i <= stepIndex ? '0 0 8px rgba(139,92,246,0.5)' : 'none' }} />
            <span className="text-[10px] font-medium transition-colors flex items-center gap-1" style={{ color: i <= stepIndex ? '#a78bfa' : 'rgba(255,255,255,0.35)' }}>
              {s.icon}{t(s.labelKey)}
            </span>
          </div>
        ))}
      </div>



      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 2 — גודל הצוות */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {step === 'team' && (
        <div className="space-y-5">
          <div>
            <h2 className="font-black text-xl" style={{ color: 'white' }}>{t('onboarding.teamTitle')}</h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('onboarding.teamDesc')}</p>
          </div>

          <div className="space-y-2.5">
            {TEAM_SIZES.map(({ label, subKey }) => (
              <button key={label} type="button"
                onClick={() => setTeamSize(label)}
                className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl transition-all"
                style={teamSize === label
                  ? { background: 'rgba(99,102,241,0.22)', border: '2px solid rgba(99,102,241,0.5)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '2px solid rgba(255,255,255,0.1)' }}>
                <span className="font-black text-lg" style={{ color: teamSize === label ? '#a78bfa' : 'white' }}>
                  {label}
                </span>
                <span className="text-sm" style={{ color: teamSize === label ? '#818cf8' : 'rgba(255,255,255,0.55)' }}>
                  {t(subKey)}
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
            <h2 className="font-black text-xl" style={{ color: 'white' }}>{t('onboarding.aboutTitle')}</h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('onboarding.aboutDesc')}</p>
          </div>

          <div className="relative">
            <Sparkles size={14} className="absolute top-3.5 right-3.5 text-indigo-400 pointer-events-none" />
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={8}
              className="w-full rounded-xl pr-9 pl-4 py-3 text-sm focus:outline-none resize-none transition-colors leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
              placeholder={t('onboarding.promptPlaceholder')}
            />
          </div>

          <div className="rounded-xl p-3.5" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <p className="text-xs font-semibold mb-1 flex items-center gap-1.5" style={{ color: '#a78bfa' }}>
              <Sparkles size={11} /> {t('onboarding.tipTitle')}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {t('onboarding.tipDesc')}
            </p>
          </div>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            {industry && (
              <span className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
                <Building2 size={10} className="text-indigo-400" /> {industry}
              </span>
            )}
            {teamSize && (
              <span className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
                <Users size={10} className="text-indigo-400" /> {teamSize} {t('onboarding.step.team')}
              </span>
            )}
            {isBusiness && solutions.length > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
                <Package size={10} className="text-indigo-400" /> {solutions.length} {t('onboarding.solutions')}
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
              <h2 className="font-black text-xl" style={{ color: 'white' }}>{t('onboarding.aiTitle')}</h2>
            </div>
            <p className="text-sm mt-1 mr-9" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('onboarding.aiDesc')}</p>
          </div>

          <div className="space-y-4">
            {/* Ideal client — only question */}
            <AiField
              label={t('onboarding.idealClient')}
              placeholder={t('onboarding.idealClientPlaceholder')}
              value={idealClient}
              onChange={setIdealClient}
            />
          </div>

          <div className="rounded-xl p-3.5" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <p className="text-xs font-semibold mb-1 flex items-center gap-1.5" style={{ color: '#a78bfa' }}>
              <Brain size={11} /> {t('onboarding.howItWorksTitle')}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {t('onboarding.howItWorksDesc')}
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
            <h2 className="font-black text-xl" style={{ color: 'white' }}>{t('onboarding.logoTitle')}</h2>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('onboarding.logoDesc')}</p>
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />

          {logoUrl ? (
            <div className="relative w-36 h-36 mx-auto">
              <img src={logoUrl} alt="logo"
                className="w-full h-full object-contain rounded-2xl p-3"
                style={{ background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(99,102,241,0.3)' }} />
              <button onClick={() => setLogoUrl('')}
                className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white transition-colors shadow-lg">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()}
              className="w-full rounded-2xl py-10 flex flex-col items-center gap-3 transition-all group"
              style={{ border: '2px dashed rgba(255,255,255,0.15)' }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-colors" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Upload size={22} style={{ color: 'rgba(255,255,255,0.4)' }} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>{t('onboarding.uploadLogo')}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('onboarding.logoSizeHint')}</p>
              </div>
            </button>
          )}

          {/* Final summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">{t('onboarding.title')}</p>
            {industry && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                {t('settings.industry')}: {industry}
              </div>
            )}
            {teamSize && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                {teamSize} {t('onboarding.step.team')}
              </div>
            )}
            {isBusiness && solutions.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                <span>{t('onboarding.solutions')}: {solutions.join(', ')}</span>
              </div>
            )}
            {prompt && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                {t('settings.businessDesc')} ({prompt.length})
              </div>
            )}
            {logoUrl && (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                {t('onboarding.uploadLogo')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Nav buttons ────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mt-8">
        {step !== 'industry' && (
          <button type="button" onClick={back}
            className="flex items-center gap-1.5 px-4 py-3 text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl text-sm transition-all">
            <ArrowLeft size={14} /> {t('onboarding.back')}
          </button>
        )}
        <button type="button" onClick={next} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-sm" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
          {saving
            ? t('onboarding.saving')
            : step === 'logo'
              ? `🚀 ${t('onboarding.finish')}`
              : (<>{t('onboarding.next')} <ArrowRight size={14} /></>)
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
      <label className="block text-slate-600 text-xs font-semibold mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 resize-none transition-colors leading-relaxed"
      />
    </div>
  );
}

function FullScreen({ children, dir: dirProp }: { children: React.ReactNode; dir?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" dir={dirProp ?? 'rtl'}
      style={{
        background: 'linear-gradient(135deg,#0a0f1e 0%,#0d1333 50%,#0a1628 100%)',
        backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px), linear-gradient(135deg,#0a0f1e 0%,#0d1333 50%,#0a1628 100%)',
        backgroundSize: '24px 24px, 100% 100%',
      }}>
      <div className="w-full max-w-lg rounded-2xl p-8"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}>
        {children}
      </div>
    </div>
  );
}
