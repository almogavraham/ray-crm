import { useState } from 'react';
import { Zap, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ForgotPassword from './ForgotPassword';

export default function Login() {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  if (showForgot) {
    return <ForgotPassword onBack={() => setShowForgot(false)} />;
  }

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        setError('אימייל או סיסמה שגויים');
      } else if (code === 'auth/too-many-requests') {
        setError('יותר מדי ניסיונות. נסה שוב מאוחר יותר');
      } else {
        setError('שגיאה בהתחברות. נסה שוב');
      }
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

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-white font-bold text-xl mb-1">ברוך הבא</h1>
          <p className="text-slate-400 text-sm mb-8">התחבר כדי להמשיך</p>

          <form onSubmit={handle} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-slate-400 text-sm font-medium mb-2">אימייל</label>
              <div className="relative">
                <Mail size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                  className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-10 pl-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-slate-400 text-sm font-medium mb-2">סיסמה</label>
              <div className="relative">
                <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
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

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25"
            >
              {loading ? 'מתחבר...' : 'התחברות'}
            </button>

            {/* Forgot password */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-slate-500 hover:text-indigo-400 text-sm transition-colors"
              >
                שכחתי סיסמה
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          RAY CRM &bull; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
