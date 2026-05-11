import { useState, useEffect } from 'react';
import { Zap, Lock, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '../lib/firebase';

interface ResetPasswordProps {
  oobCode: string;
  onDone: () => void;
}

export default function ResetPassword({ oobCode, onDone }: ResetPasswordProps) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [invalid,  setInvalid]  = useState(false);
  const [done,     setDone]     = useState(false);

  // Verify the reset code is valid on mount
  useEffect(() => {
    verifyPasswordResetCode(auth, oobCode)
      .then(e => { setEmail(e); setVerifying(false); })
      .catch(() => { setInvalid(true); setVerifying(false); });
  }, [oobCode]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
    if (password.length < 6)  { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setDone(true);
      // Redirect to login after 2s
      setTimeout(onDone, 2000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/expired-action-code') setError('הקישור פג תוקפו. בקש קישור חדש');
      else if (code === 'auth/invalid-action-code') setError('הקישור אינו תקף. ייתכן שכבר שומש');
      else setError('שגיאה בעדכון הסיסמה. נסה שוב');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/40">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black text-3xl leading-tight">RAY</p>
            <p className="text-slate-500 text-xs font-medium -mt-1">Lead Manager</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">

          {/* Loading state */}
          {verifying && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-slate-400 text-sm">מאמת קישור...</p>
            </div>
          )}

          {/* Invalid code */}
          {!verifying && invalid && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">🔗</div>
              <h2 className="text-white font-bold text-xl mb-2">הקישור אינו תקף</h2>
              <p className="text-slate-400 text-sm mb-6">
                ייתכן שהקישור פג תוקפו או כבר שומש.
                <br />
                בקש קישור חדש מדף הכניסה.
              </p>
              <button
                onClick={onDone}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl transition-colors"
              >
                חזרה לדף הכניסה
              </button>
            </div>
          )}

          {/* Success state */}
          {!verifying && !invalid && done && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={36} className="text-emerald-400" />
              </div>
              <h2 className="text-white font-bold text-xl mb-2">הסיסמה עודכנה!</h2>
              <p className="text-slate-400 text-sm">מעביר אותך לדף הכניסה...</p>
            </div>
          )}

          {/* Reset form */}
          {!verifying && !invalid && !done && (
            <>
              <h1 className="text-white font-bold text-xl mb-1">קביעת סיסמה חדשה</h1>
              {email && (
                <p className="text-indigo-400 text-xs font-medium mb-6">{email}</p>
              )}

              <form onSubmit={handle} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">סיסמה חדשה</label>
                  <div className="relative">
                    <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoFocus
                      placeholder="לפחות 6 תווים"
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-10 pl-10 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">אימות סיסמה</label>
                  <div className="relative">
                    <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                      placeholder="הכנס שוב את הסיסמה"
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-10 pl-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Password strength hint */}
                {password.length > 0 && (
                  <div className="flex items-center gap-2">
                    {[1,2,3,4].map(i => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          password.length >= i * 3
                            ? password.length >= 10 ? 'bg-emerald-400' : password.length >= 6 ? 'bg-amber-400' : 'bg-red-400'
                            : 'bg-slate-700'
                        }`}
                      />
                    ))}
                    <span className="text-xs text-slate-500 w-12 text-left">
                      {password.length < 6 ? 'חלשה' : password.length < 10 ? 'בינונית' : 'חזקה'}
                    </span>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25 mt-2"
                >
                  {loading ? 'מעדכן סיסמה...' : 'עדכן סיסמה'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          RAY CRM &bull; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
