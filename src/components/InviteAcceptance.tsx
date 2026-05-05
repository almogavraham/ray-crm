import { useState, useEffect } from 'react';
import { isSignInWithEmailLink, signInWithEmailLink, updateProfile } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { CheckCircle2, Loader2, X } from 'lucide-react';

interface InviteAcceptanceProps {
  onSuccess: (displayName: string, email: string) => void;
  onDismiss: () => void;
}

export default function InviteAcceptance({ onSuccess, onDismiss }: InviteAcceptanceProps) {
  const [step, setStep] = useState<'form' | 'loading' | 'success' | 'error'>('form');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = window.localStorage.getItem('ray-invite-email') || '';
    setEmail(stored);
  }, []);

  const handleJoin = async () => {
    if (!displayName.trim()) { setError('יש להכניס שם מלא'); return; }
    const emailToUse = email || window.localStorage.getItem('ray-invite-email') || '';
    if (!emailToUse) { setError('כתובת המייל לא נמצאה — נסה ללחוץ שוב על הקישור במייל'); return; }

    setStep('loading');
    setError('');
    try {
      const result = await signInWithEmailLink(auth, emailToUse, window.location.href);
      if (result.user) {
        await updateProfile(result.user, { displayName: displayName.trim() });
        window.localStorage.removeItem('ray-invite-email');
        window.history.replaceState({}, document.title, window.location.pathname);
        setStep('success');
        setTimeout(() => onSuccess(displayName.trim(), emailToUse), 1500);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה';
      if (msg.includes('invalid-action-code') || msg.includes('expired')) {
        setError('קישור ההזמנה פג תוקף. בקש מהמנהל לשלוח הזמנה חדשה.');
      } else {
        setError('שגיאה בכניסה: ' + msg);
      }
      setStep('form');
    }
  };

  // Only render if this is actually a sign-in link
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-l from-slate-900 to-black px-6 py-5 text-white text-right">
          <div className="font-black text-2xl mb-1 tracking-tight">RAY</div>
          <div className="text-neutral-400 text-sm">Lead Manager — הצטרפות למערכת</div>
        </div>

        {step === 'success' ? (
          <div className="p-8 text-center">
            <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3" />
            <div className="font-bold text-slate-800 text-lg">ברוך הבא, {displayName}!</div>
            <div className="text-slate-400 text-sm mt-1">מועבר למערכת...</div>
          </div>
        ) : (
          <div className="p-6 text-right space-y-4">
            <div>
              <h2 className="font-bold text-slate-800 text-lg">השלם את ההרשמה שלך</h2>
              <p className="text-slate-400 text-sm mt-1">הוזמנת להצטרף ל-RAY Lead Manager</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">כתובת מייל</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="הכנס את כתובת המייל שקיבלת ההזמנה אליה"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">שם מלא</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  placeholder="הכנס את שמך המלא"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
                <X size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleJoin}
              disabled={step === 'loading' || !displayName.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {step === 'loading' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>מתחבר...</span>
                </>
              ) : (
                'כניסה למערכת ✓'
              )}
            </button>

            <button
              onClick={onDismiss}
              className="w-full text-slate-400 text-xs hover:text-slate-600 transition-colors"
            >
              ביטול
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
