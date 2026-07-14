/**
 * VerifyEmail.tsx
 *
 * Handles the Firebase email-verification action link
 * (?mode=verifyEmail&oobCode=...). Applies the action code, marks the account
 * verified, and forwards the user into the app / their workspace — the way
 * mature SaaS products handle it (verify → land inside the product).
 *
 * For this to run, the Firebase Auth "action URL" must point to this app's
 * domain (Firebase Console → Authentication → Templates → Email verification →
 * Customize action URL → https://ray-crm-app.web.app).
 */
import { useEffect, useState } from 'react';
import { applyActionCode } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';

export default function VerifyEmail({ oobCode }: { oobCode: string }) {
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    applyActionCode(auth, oobCode)
      .then(async () => {
        if (cancelled) return;
        // Refresh the signed-in user (if any) so emailVerified is up to date.
        try { await auth.currentUser?.reload(); } catch { /* ignore */ }
        setStatus('success');
        // Forward into the app: /signin routes a logged-in workspace user
        // straight to their workspace, otherwise shows the login screen.
        setTimeout(() => { window.location.replace('/signin?verified=1'); }, 1800);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = (e as { code?: string })?.code ?? '';
        setErrMsg(
          code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'
            ? 'הקישור פג תוקף או שכבר נוצל. היכנס למערכת ובקש מייל אימות חדש.'
            : 'אירעה שגיאה באימות המייל. נסה שוב או בקש קישור חדש.'
        );
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [oobCode]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center"
      style={{ background: '#0f172a' }} dir="rtl">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
        style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
        <Zap size={26} className="text-white" />
      </div>

      {status === 'working' && (
        <div className="space-y-3">
          <div className="w-8 h-8 mx-auto border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-300 text-sm font-semibold">מאמת את המייל שלך...</p>
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-2 max-w-xs">
          <CheckCircle2 size={44} className="mx-auto text-emerald-400" />
          <h2 className="text-white font-black text-2xl">המייל אומת! ✓</h2>
          <p className="text-slate-400 text-sm">מעבירים אותך לסביבת העבודה שלך...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3 max-w-xs">
          <XCircle size={44} className="mx-auto text-red-400" />
          <h2 className="text-white font-black text-xl">האימות נכשל</h2>
          <p className="text-slate-400 text-sm leading-relaxed">{errMsg}</p>
          <button onClick={() => window.location.replace('/signin')}
            className="mt-2 py-2.5 px-6 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
            כניסה למערכת
          </button>
        </div>
      )}
    </div>
  );
}
