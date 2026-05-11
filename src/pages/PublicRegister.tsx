import { useState } from 'react';
import {
  Zap, User, Lock, Eye, EyeOff, AlertCircle, CheckCircle2,
  Building2, Phone, Mail, Hash, ArrowLeft,
} from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile, WorkspaceProfile } from '../types';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const ALL_PAGES = ['home','dashboard','overview','team','ai','kanban','tasks','settings','content','deals','agents'] as const;

interface Props { onSuccess: () => void; onBack: () => void; }

type Step = 'details' | 'creds' | 'done';

export default function PublicRegister({ onSuccess, onBack }: Props) {
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
    if (!company.trim()) { setError('נא להזין שם עסק'); return; }
    setStep('creds');
  };

  /* ── Step 2: account creation ─────────────────────────────────────────── */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
    if (password.length < 6)  { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    setLoading(true);
    try {
      /* 1. Create Firebase Auth user */
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid  = cred.user.uid;

      /* 2. Create workspace document */
      const wid   = `ws_${uid}`;
      const trial = new Date();
      trial.setDate(trial.getDate() + 14);

      // Firestore rejects undefined values — build object cleanly
      const workspace: Record<string, unknown> = {
        id:                 wid,
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
      setTimeout(onSuccess, 1800);
    } catch (err: unknown) {
      console.error('Registration error:', err);
      const code    = (err as { code?: string }).code ?? '';
      const message = (err as { message?: string }).message ?? '';
      if (code === 'auth/email-already-in-use')  setError('אימייל זה כבר רשום במערכת');
      else if (code === 'auth/invalid-email')    setError('כתובת אימייל לא תקינה');
      else if (code === 'auth/weak-password')    setError('הסיסמה חלשה מדי — לפחות 6 תווים');
      else if (code === 'permission-denied')     setError('שגיאת הרשאות Firestore — בדוק כללי אבטחה');
      else if (message)                          setError(`שגיאה: ${message}`);
      else setError('שגיאה ביצירת החשבון. נסה שוב.');
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
    <Screen>
      <div className="text-center py-8">
        <CheckCircle2 size={56} className="text-emerald-400 mx-auto mb-5" />
        <h2 className="text-white font-black text-2xl mb-2">סביבת העבודה נוצרה! 🎉</h2>
        <p className="text-slate-400 text-sm">מעביר אותך להגדרת המערכת...</p>
      </div>
    </Screen>
  );

  return (
    <Screen>
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
            <h1 className="text-white font-black text-2xl">פתיחת חשבון עסקי</h1>
            <p className="text-slate-400 text-sm mt-1">14 יום ניסיון חינם · ללא כרטיס אשראי</p>
          </div>

          <Field label="שם העסק *" icon={<Building2 size={14} />}>
            <input
              type="text" value={company} onChange={e => setCompany(e.target.value)} required
              className={INPUT} placeholder="למשל: סוכנות שיווק חכמה" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label='ח.פ / ע.מ' icon={<Hash size={14} />}>
              <input
                type="text" value={bizId} onChange={e => setBizId(e.target.value)}
                className={INPUT} placeholder="515123456" />
            </Field>
            <Field label="טלפון" icon={<Phone size={14} />}>
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                className={INPUT} placeholder="050-0000000" />
            </Field>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">תחום עיסוק</label>
            <select
              value={industry} onChange={e => setIndustry(e.target.value)}
              className={INPUT + ' appearance-none'}>
              <option value="">בחר תחום...</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          {error && <ErrorBox msg={error} />}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onBack}
              className="flex-shrink-0 px-4 py-3 text-slate-500 hover:text-slate-300 flex items-center gap-1.5 text-sm transition-colors">
              <ArrowLeft size={14} /> חזרה
            </button>
            <button type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25">
              המשך
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
              <ArrowLeft size={12} /> חזרה
            </button>
            <h1 className="text-white font-black text-2xl">פרטי משתמש מנהל</h1>
            <p className="text-slate-400 text-sm mt-1">
              <span className="text-indigo-400 font-medium">{company}</span> — הזן פרטים אישיים
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="שם פרטי *" icon={<User size={14} />}>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required
                className={INPUT} placeholder="ישראל" />
            </Field>
            <Field label="שם משפחה *" icon={<User size={14} />}>
              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required
                className={INPUT} placeholder="ישראלי" />
            </Field>
          </div>

          <Field label="אימייל *" icon={<Mail size={14} />}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className={INPUT} placeholder="you@company.com" dir="ltr" />
          </Field>

          <Field label="סיסמה *" icon={<Lock size={14} />}>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                className={INPUT + ' pl-10'} placeholder="לפחות 6 תווים" dir="ltr" />
              <button type="button" onClick={() => setShowPw(p => !p)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <Field label="אימות סיסמה *" icon={<Lock size={14} />}>
            <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required
              className={INPUT} placeholder="חזור על הסיסמה" dir="ltr" />
          </Field>

          {error && <ErrorBox msg={error} />}

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25 mt-2">
            {loading ? 'יוצר חשבון...' : 'צור חשבון ←'}
          </button>

          <p className="text-center text-slate-600 text-xs">
            בלחיצה על יצירת חשבון אתה מסכים ל
            <span className="text-indigo-400 cursor-pointer"> תנאי השימוש</span>
          </p>
        </form>
      )}
    </Screen>
  );
}

/* ─── small shared components ─────────────────────────────────────────────── */
const INPUT = 'w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/40">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black text-3xl">RAY</p>
            <p className="text-slate-500 text-xs -mt-1">Lead Manager · מיתוג לבן</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          {children}
        </div>
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
