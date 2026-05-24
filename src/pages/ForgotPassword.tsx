import { useState } from 'react';
import { Zap, Mail, AlertCircle, CheckCircle2, ArrowRight, ExternalLink } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useLang } from '../contexts/LangContext';

interface ForgotPasswordProps {
  onBack: () => void;
}

export default function ForgotPassword({ onBack }: ForgotPasswordProps) {
  const { t, dir } = useLang();
  const [email,       setEmail]       = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sent,        setSent]        = useState(false);
  const [configError, setConfigError] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // No actionCodeSettings — avoids "unauthorized-continue-uri" errors.
      // Firebase sends the reset link to its own hosted action page.
      await sendPasswordResetEmail(auth, email);
      setSent(true);
    } catch (err: unknown) {
      console.error('Password reset error:', err);
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/user-not-found') {
        setError(t('forgotPassword.errorNotFound'));
      } else if (code === 'auth/invalid-email') {
        setError(t('forgotPassword.errorInvalidEmail'));
      } else if (code === 'auth/too-many-requests') {
        setError(t('forgotPassword.errorTooManyRequests'));
      } else if (code === 'auth/configuration-not-found') {
        setConfigError(true);
      } else {
        setError(t('forgotPassword.errorGeneral'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir={dir}>
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
          {sent ? (
            /* ── Success state ── */
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={36} className="text-emerald-400" />
              </div>
              <h2 className="text-white font-bold text-xl mb-2">{t('forgotPassword.sentTitle')}</h2>
              <p className="text-slate-400 text-sm mb-2">
                {t('forgotPassword.sentDesc')}
              </p>
              <p className="text-indigo-400 font-semibold text-sm mb-5">{email}</p>
              <div className="bg-slate-800 rounded-xl p-4 text-right mb-6 space-y-2">
                <p className="text-white text-xs font-bold">📧 {t('forgotPassword.sentInstructions')}</p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  1. {t('forgotPassword.sentStep1')}
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  2. {t('forgotPassword.sentStep2')} <span className="text-indigo-400 font-mono">noreply@chex-crm.firebaseapp.com</span>
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  3. {t('forgotPassword.sentStep3')}
                </p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  4. {t('forgotPassword.sentStep4')}
                </p>
                <p className="text-amber-400 text-xs leading-relaxed mt-2">
                  ⚠️ {t('forgotPassword.sentSpamHint')}
                </p>
              </div>
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors mx-auto"
              >
                <ArrowRight size={14} />
                {t('forgotPassword.backToLogin')}
              </button>
            </div>
          ) : (
            /* ── Form state ── */
            <>
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm transition-colors mb-6"
              >
                <ArrowRight size={14} />
                {t('forgotPassword.back')}
              </button>

              <h1 className="text-white font-bold text-xl mb-1">{t('forgotPassword.title')}</h1>
              <p className="text-slate-400 text-sm mb-8">
                {t('forgotPassword.desc')}
              </p>

              <form onSubmit={handle} className="space-y-5">
                <div>
                  <label className="block text-slate-400 text-sm font-medium mb-2">{t('forgotPassword.email')}</label>
                  <div className="relative">
                    <Mail size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="your@email.com"
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-600 rounded-xl pr-10 pl-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                      dir="ltr"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                {configError && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-right space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-300 font-bold text-sm mb-1">{t('forgotPassword.configTitle')}</p>
                        <p className="text-amber-200/70 text-xs leading-relaxed">
                          {t('forgotPassword.configDesc')}
                        </p>
                      </div>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-3 text-xs text-slate-300 space-y-1.5">
                      <p className="font-bold text-white">{t('forgotPassword.configFixTitle')}</p>
                      <p>1. {t('forgotPassword.configStep1')}</p>
                      <p>2. {t('forgotPassword.configStep2')}</p>
                      <p>3. {t('forgotPassword.configStep3')}</p>
                    </div>
                    <a
                      href="https://console.firebase.google.com/project/chex-crm/authentication/emails"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 justify-center bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2.5 rounded-xl transition-colors"
                    >
                      <ExternalLink size={13} />
                      {t('forgotPassword.configOpenConsole')}
                    </a>
                    <button
                      type="button"
                      onClick={() => setConfigError(false)}
                      className="w-full text-slate-400 hover:text-white text-xs py-1 transition-colors"
                    >
                      {t('forgotPassword.tryAgain')}
                    </button>
                  </div>
                )}

                {!configError && (
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-500/25"
                  >
                    {loading ? t('forgotPassword.sending') : t('forgotPassword.sendLink')}
                  </button>
                )}
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
