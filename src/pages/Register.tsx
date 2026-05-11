import { useState, useEffect } from 'react';
import { Zap, User, Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { Invite, UserProfile } from '../types';

interface RegisterProps {
  token: string;
  onSuccess: () => void;
}

export default function Register({ token, onSuccess }: RegisterProps) {
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
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
    if (password.length < 6)  { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
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
      localStorage.setItem('ray-login-at', Date.now().toString());
      setDone(true);
      setTimeout(onSuccess, 1500);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') setError('אימייל זה כבר רשום במערכת');
      else setError('שגיאה ביצירת החשבון. נסה שוב');
    } finally {
      setLoading(false);
    }
  };

  if (notFound) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="text-center">
        <div className="text-5xl mb-4">🔗</div>
        <h2 className="text-white text-xl font-bold mb-2">קישור ההזמנה לא תקף</h2>
        <p className="text-slate-400 text-sm">ייתכן שהקישור פג תוקפו או כבר שומש</p>
      </div>
    </div>
  );

  if (!invite) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center" dir="rtl">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
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
          {done ? (
            <div className="text-center py-6">
              <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-4" />
              <h2 className="text-white font-bold text-xl mb-1">ברוך הבא!</h2>
              <p className="text-slate-400 text-sm">החשבון נוצר בהצלחה. מעביר אותך...</p>
            </div>
          ) : (
            <>
              <h1 className="text-white font-bold text-xl mb-1">יצירת חשבון</h1>
              <p className="text-slate-400 text-sm mb-1">הוזמנת להצטרף ל-RAY CRM</p>
              <p className="text-indigo-400 text-xs font-medium mb-8">{invite.email}</p>

              <form onSubmit={handle} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">שם פרטי</label>
                    <div className="relative">
                      <User size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required
                        className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        placeholder="ישראל" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">שם משפחה</label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      placeholder="ישראלי" />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">סיסמה</label>
                  <div className="relative">
                    <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-10 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      placeholder="לפחות 6 תווים" dir="ltr" />
                    <button type="button" onClick={() => setShowPw(p => !p)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">אימות סיסמה</label>
                  <div className="relative">
                    <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type={showPw ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      placeholder="הכנס שוב את הסיסמה" dir="ltr" />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="flex-shrink-0" />{error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25 mt-2">
                  {loading ? 'יוצר חשבון...' : 'יצירת חשבון'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
