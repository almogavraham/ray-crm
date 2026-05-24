import { useState } from 'react';
import {
  Zap, User, Lock, Eye, EyeOff, AlertCircle, CheckCircle2,
  Building2, Phone, Mail, Hash, ArrowLeft,
} from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile, WorkspaceProfile } from '../types';
import { useLang } from '../contexts/LangContext';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const ALL_PAGES = ['home','dashboard','overview','team','ai','kanban','tasks','settings','content','deals','agents'] as const;

interface Props { onSuccess: (slug: string) => void; onBack: () => void; onSignIn?: () => void; }

type Step = 'details' | 'creds' | 'done';

export default function PublicRegister({ onSuccess, onBack, onSignIn }: Props) {
  const { t, dir } = useLang();
  const [step, setStep]         = useState<Step>('details');
  /* step 1 */
  const [company,   setCompany]   = useState('');
  const [bizId,     setBizId]     = useState('');
  const [phone,     setPhone]     = useState('');
  const [industry,  setIndustry]  = useState('');
  /* step 2 */
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);

  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  /* ── Step 1: business details ─────────────────────────────────────────── */
  const goToCreds = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!company.trim()) { setError(t('register.errorBusinessName')); return; }
    setStep('creds');
  };

  /* ── Step 2: account creation ─────────────────────────────────────────── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError(t('register.errorPasswordMatch')); return; }
    if (password.length < 6)  { setError(t('register.errorPasswordLength')); return; }
    setLoading(true);
    try {
      /* 1. Create Firebase Auth user */
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid  = cred.user.uid;

      /* 2. Create workspace document */
      const wid   = `ws_${uid}`;
      // Unique 7-char slug for clean URL: ray-crm-app.web.app/{slug}
      const slug  = Math.random().toString(36).slice(2, 9);
      const trial = new Date();
      trial.setDate(trial.getDate() + 14);

      // Firestore rejects undefined values — build object cleanly
      const workspace: Record<string, unknown> = {
        id:                 wid,
        slug,
        name:               company.trim(),
        businessId:         bizId.trim(),
        phone:              phone.trim(),
        email:              email.trim(),
        ownerId:            uid,
        status:             'trial',
        plan:               'trial',
        trialEndsAt:        trial.toISOString(),
        createdAt:          new Date().toISOString(),
        onboardingComplete: false,
      };
      if (industry) workspace.industry = industry;

      await setDoc(doc(db, 'workspaces', wid), workspace);

      /* 3. Create user profile */
      const profile: UserProfile = {
        uid,
        email:        email.trim(),
        firstName:    firstName.trim(),
        lastName:     lastName.trim(),
        role:         'admin',
        allowedPages: [...ALL_PAGES],
        createdAt:    new Date().toISOString(),
        workspaceId:  wid,
      };
      await setDoc(doc(db, 'users', uid), profile);

      localStorage.setItem('ray-login-at', Date.now().toString());
      setStep('done');
      // Pass the clean slug (not wid) so App can redirect to /{slug}
      setTimeout(() => onSuccess(slug), 600);
    } catch (err: unknown) {
      console.error('Registration error:', err);
      const code    = (err as { code?: string }).code ?? '';
      const message = (err as { message?: string }).message ?? '';
      if (code === 'auth/email-already-in-use')  setError(t('register.errorEmailInUse'));
      else if (code === 'auth/invalid-email')    setError(t('register.errorInvalidEmail'));
      else if (code === 'auth/weak-password')    setError(t('register.errorWeakPassword'));
      else if (code === 'permission-denied')     setError(t('register.errorPermissions'));
      else if (message)                          setError(message);
      else setError(t('register.errorGeneral'));
    } finally {
      setLoading(false);
    }
  };

  const INDUSTRIES = [
    'סוכנות שיווק', 'נדל"ן', 'טכנולוגיה', 'פיננסים',
    'שירותים עסקיים', 'קמעונאות', 'בריאות', 'חינוך', 'אחר',
  ];

  /* ── Done ─────────────────────────────────────────────────────────────── */
  if (step === 'done') return (
    <Screen onSignIn={onSignIn} dir={dir}>
      <div className="text-center py-8">
        <CheckCircle2 size={56} className="text-emerald-400 mx-auto mb-5" />
        <h2 className="text-white font-black text-2xl mb-2">{t('register.success')}</h2>
        <p className="text-slate-400 text-sm">{t('register.successDesc')}</p>
      </div>
    </Screen>
  );

  return (
    <Screen onSignIn={onSignIn} dir={dir}>
      {/* Progress bar */}
      <div className="flex gap-2 mb-8">
        {(['details','creds'] as const).map((s, i) => (
          <div key={s} className={`flex-1 h-1.5 rounded-full transition-all ${step === 'done' || (step === 'creds' && i === 0) || (step === s) ? 'bg-indigo-500' : 'bg-slate-800'}`} />
        ))}
      </div>

      {/* Step 1 — Business info */}
      {step === 'details' && (
        <form onSubmit={goToCreds} className="space-y-4">
          <div className="text-center mb-6">
            <h1 className="text-white font-black text-2xl">{t('register.title')}</h1>
            <p className="text-slate-400 text-sm mt-1">{t('landing.pricing.trial.period')} {t('billing.trial')}</p>
          </div>

          <Field label={t('register.businessName')} icon={<Building2 size={14} />}>
            <input
              type="text" value={company} onChange={e => setCompany(e.target.value)} required
              className={INPUT} placeholder={t('register.companyPlaceholder')} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('register.businessId')} icon={<Hash size={14} />}>
              <input
                type="text" value={bizId} onChange={e => setBizId(e.target.value)}
                className={INPUT} placeholder="515123456" />
            </Field>
            <Field label={t('register.phone')} icon={<Phone size={14} />}>
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                className={INPUT} placeholder="050-0000000" />
            </Field>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">{t('register.industry')}</label>
            <select
              value={industry} onChange={e => setIndustry(e.target.value)}
              className={INPUT + ' appearance-none'}>
              <option value="">{t('register.industryPlaceholder')}</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          {error && <ErrorBox msg={error} />}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onBack}
              className="flex-shrink-0 px-4 py-3 text-slate-500 hover:text-slate-300 flex items-center gap-1.5 text-sm transition-colors">
              <ArrowLeft size={14} /> {t('register.back')}
            </button>
            <button type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25">
              {t('register.continue')}
            </button>
          </div>
        </form>
      )}

      {/* Step 2 — Account credentials */}
      {step === 'creds' && (
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="mb-6">
            <button type="button" onClick={() => setStep('details')}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs mb-4 transition-colors">
              <ArrowLeft size={12} /> {t('register.back')}
            </button>
            <h1 className="text-white font-black text-2xl">{t('register.accountDetails')}</h1>
            <p className="text-slate-400 text-sm mt-1">
              <span className="text-indigo-400 font-medium">{company}</span> — {t('register.personalDetails')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('register.firstName')} icon={<User size={14} />}>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required
                className={INPUT} placeholder={t('register.firstNamePlaceholder')} />
            </Field>
            <Field label={t('register.lastName')} icon={<User size={14} />}>
              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required
                className={INPUT} placeholder={t('register.lastNamePlaceholder')} />
            </Field>
          </div>

          <Field label={t('register.email')} icon={<Mail size={14} />}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className={INPUT} placeholder="you@company.com" dir="ltr" />
          </Field>

          <Field label={t('register.password')} icon={<Lock size={14} />}>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                className={INPUT + ' pl-10'} placeholder={t('register.passwordPlaceholder')} dir="ltr" />
              <button type="button" onClick={() => setShowPw(p => !p)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <Field label={t('register.confirmPassword')} icon={<Lock size={14} />}>
            <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required
              className={INPUT} placeholder={t('register.confirmPasswordPlaceholder')} dir="ltr" />
          </Field>

          {error && <ErrorBox msg={error} />}

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25 mt-2">
            {loading ? t('common.loading') : `${t('register.createAccount')} ←`}
          </button>

          <p className="text-center text-slate-600 text-xs">
            {t('register.termsAgreement')}{' '}
            <span className="text-indigo-400 cursor-pointer">{t('register.termsLink')}</span>
          </p>
        </form>
      )}
    </Screen>
  );
}

/* ─── small shared components ─────────────────────────────────────────────── */
const INPUT = 'w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

function Screen({ children, onSignIn, dir: dirProp }: { children: React.ReactNode; onSignIn?: () => void; dir?: string }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir={dirProp ?? 'rtl'}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/40">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black text-3xl">RAY</p>
            <p className="text-slate-500 text-xs -mt-1">Lead Manager</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {children}
        </div>
        {/* Sign-in link */}
        <p className="text-center text-slate-500 text-sm mt-5">
          {t('register.haveAccount')}{' '}
          <button
            onClick={onSignIn ?? (() => window.location.replace('/'))}
            className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
          >
            {t('register.signIn')} ←
          </button>
        </p>
      </div>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-slate-400 text-xs font-medium mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>
        {children}
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
      <AlertCircle size={14} className="flex-shrink-0" />{msg}
    </div>
  );
}
