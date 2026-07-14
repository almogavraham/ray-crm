import { useState, useEffect } from 'react';
import { Zap, User, Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { Invite, UserProfile } from '../types';
import { useLang } from '../contexts/LangContext';

interface RegisterProps {
  token: string;
  onSuccess: () => void;
}

export default function Register({ token, onSuccess }: RegisterProps) {
  const { t, dir } = useLang();
  const [invite,    setInvite]    = useState<Invite | null>(null);
  const [notFound,  setNotFound]  = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'invites', token));
      if (!snap.exists() || snap.data().used) { setNotFound(true); return; }
      setInvite(snap.data() as Invite);
    }
    load();
  }, [token]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError(t('register.errorPasswordMatch')); return; }
    if (password.length < 6)  { setError(t('register.errorPasswordLength')); return; }
    if (!invite) return;
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, invite.email, password);
      const profile: UserProfile = {
        uid:          cred.user.uid,
        email:        invite.email,
        firstName,
        lastName,
        role:         invite.role,
        allowedPages: invite.allowedPages,
        createdAt:    new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);
      await updateDoc(doc(db, 'invites', token), { used: true });

      // Send email verification
      try { await sendEmailVerification(cred.user); } catch { /* non-fatal */ }

      localStorage.setItem('ray-login-at', Date.now().toString());
      setDone(true);
      setTimeout(onSuccess, 1500);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') setError(t('register.errorEmailInUse'));
      else setError(t('register.errorGeneral'));
    } finally {
      setLoading(false);
    }
  };

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center p-4" dir={dir} style={{ background: 'linear-gradient(135deg,#f5f3ff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
      <div className="text-center">
        <div className="text-5xl mb-4">🔗</div>
        <h2 className="text-slate-800 text-xl font-bold mb-2">{t('register.title')}</h2>
        <p className="text-slate-500 text-sm">{t('team.status.expired')}</p>
      </div>
    </div>
  );

  if (!invite) return (
    <div className="min-h-screen flex items-center justify-center" dir={dir} style={{ background: 'linear-gradient(135deg,#f5f3ff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4" dir={dir} style={{ background: 'linear-gradient(135deg,#f5f3ff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/40">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <p className="font-black text-3xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>RAY</p>
            <p className="text-slate-500 text-xs -mt-1">Lead Manager</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-2xl">
          {done ? (
            <div className="text-center py-6">
              <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
              <h2 className="text-slate-800 font-bold text-xl mb-1">{t('register.success')}</h2>
              <p className="text-slate-500 text-sm">{t('register.successDesc')}</p>
            </div>
          ) : (
            <>
              <h1 className="text-slate-800 font-bold text-xl mb-1">{t('register.title')}</h1>
              <p className="text-slate-500 text-sm mb-1">{t('register.accountDetails')}</p>
              <p className="text-violet-600 text-xs font-medium mb-8">{invite.email}</p>

              <form onSubmit={handle} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-600 text-xs font-medium mb-1.5">{t('register.firstName')}</label>
                    <div className="relative">
                      <User size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required
                        className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        placeholder={t('register.firstNamePlaceholder')} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-600 text-xs font-medium mb-1.5">{t('register.lastName')}</label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required
                      className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      placeholder={t('register.lastNamePlaceholder')} />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{t('register.password')}</label>
                  <div className="relative">
                    <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                      className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl pr-9 pl-10 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      placeholder={t('register.passwordPlaceholder')} dir="ltr" />
                    <button type="button" onClick={() => setShowPw(p => !p)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-600 text-xs font-medium mb-1.5">{t('register.confirmPassword')}</label>
                  <div className="relative">
                    <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required
                      className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      placeholder={t('register.confirmPasswordPlaceholder')} dir="ltr" />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="flex-shrink-0" />{error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors mt-2"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 4px 16px #8b5cf640' }}>
                  {loading ? t('common.loading') : t('register.createAccount')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
