import { useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { CheckCircle2, Loader2, X, UserPlus } from 'lucide-react';

interface InviteAcceptanceProps {
  inviteEmail: string;
  onSuccess: (displayName: string, email: string) => void;
  onDismiss: () => void;
}

export default function InviteAcceptance({ inviteEmail, onSuccess, onDismiss }: InviteAcceptanceProps) {
  const [step, setStep] = useState<'form' | 'loading' | 'success'>('form');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const handleJoin = async () => {
    if (!displayName.trim()) { setError('יש להכניס שם מלא'); return; }
    setStep('loading');
    setError('');
    try {
      const memberId = Date.now().toString();
      await setDoc(doc(db, 'team', memberId), {
        id:    memberId,
        name:  displayName.trim(),
        email: inviteEmail,
        role:  'סוכן',
      });
      // Mark invite as accepted
      await deleteDoc(doc(db, 'invites', inviteEmail.replace('@', '_at_')));
      // Clear URL param
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, document.title, url.toString());

      setStep('success');
      setTimeout(() => onSuccess(displayName.trim(), inviteEmail), 1500);
    } catch (err: unknown) {
      setError('שגיאה בהצטרפות: ' + (err instanceof Error ? err.message : 'נסה שוב'));
      setStep('form');
    }
  };

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
          <div className="p-6 text-right space-y-5" dir="rtl">
            <div className="flex items-center gap-3 justify-end">
              <div>
                <h2 className="font-bold text-slate-800 text-lg">הוזמנת להצטרף ל-RAY</h2>
                <p className="text-slate-400 text-sm mt-0.5">השלם את הפרטים כדי להתחיל</p>
              </div>
              <div className="w-11 h-11 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <UserPlus size={20} className="text-indigo-600" />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">כתובת מייל</label>
                <div
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 text-slate-500"
                  dir="ltr"
                >
                  {inviteEmail}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">שם מלא</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => { setDisplayName(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  placeholder="הכנס את שמך המלא"
                  autoFocus
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
                <X size={14} className="flex-shrink-0" />
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
                  <span>מצטרף...</span>
                </>
              ) : (
                'כניסה למערכת ✓'
              )}
            </button>

            <button
              onClick={onDismiss}
              className="w-full text-slate-400 text-xs hover:text-slate-600 transition-colors py-1"
            >
              ביטול
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
