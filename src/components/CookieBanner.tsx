/**
 * CookieBanner — the cookie choice, offered honestly.
 *
 * "Reject" is a real button with the same visual weight as "Accept", not a
 * buried text link. A banner where refusing is harder than agreeing does not
 * collect valid consent, whatever it says in the text.
 *
 * There is no close X either: dismissing without choosing would leave the site
 * in an undecided state that most implementations then treat as acceptance.
 */

import { useEffect, useState } from 'react';
import { Cookie, SlidersHorizontal } from 'lucide-react';
import { readConsent, saveConsent } from '../lib/consent';

export default function CookieBanner() {
  const [show, setShow] = useState(false);
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Only ask when there is no decision on record for the current version.
    if (!readConsent()) setShow(true);
  }, []);

  if (!show) return null;

  const decide = (a: boolean, m: boolean) => { saveConsent({ analytics: a, marketing: m }); setShow(false); };

  const Row = ({ label, desc, checked, onChange, locked }: {
    label: string; desc: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean;
  }) => (
    <label className={`flex items-start gap-3 p-3 rounded-xl border ${locked ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200 cursor-pointer'}`}>
      <input
        type="checkbox" checked={checked} disabled={locked}
        onChange={e => onChange?.(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-indigo-600 flex-shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-slate-900">
          {label}{locked && <span className="text-slate-400 font-semibold"> — תמיד פעיל</span>}
        </span>
        <span className="block text-[12px] leading-relaxed text-slate-600 mt-0.5">{desc}</span>
      </span>
    </label>
  );

  return (
    <div
      role="dialog"
      aria-label="הגדרות עוגיות"
      dir="rtl"
      className="fixed z-[70] inset-x-0 bottom-0 p-3 sm:p-5"
    >
      <div className="max-w-3xl mx-auto rounded-2xl bg-white shadow-2xl border border-slate-200 p-5">
        <div className="flex items-start gap-3 mb-3">
          <span className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Cookie size={17} className="text-indigo-600" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-black text-slate-900 mb-1">האתר משתמש בעוגיות</h2>
            <p className="text-[13px] leading-relaxed text-slate-600">
              אנחנו משתמשים בעוגיות הכרחיות כדי שהאתר יעבוד. כלי מדידה ופרסום לא ייטענו
              אלא אם תאשר. אפשר לשנות את הבחירה בכל עת דרך{' '}
              <a href="/privacy" className="text-indigo-600 underline">מדיניות הפרטיות</a>.
            </p>
          </div>
        </div>

        {details && (
          <div className="space-y-2 mb-4 mt-4">
            <Row locked checked
              label="עוגיות הכרחיות"
              desc="התחברות, אבטחה, שמירת שפה והעדפות נגישות. בלעדיהן האתר לא יעבוד." />
            <Row
              label="עוגיות מדידה" checked={analytics} onChange={setAnalytics}
              desc="עוזרות לנו להבין איך משתמשים באתר כדי לשפר אותו. כרגע לא פעילות באתר." />
            <Row
              label="עוגיות שיווק" checked={marketing} onChange={setMarketing}
              desc="מאפשרות התאמת פרסום ומדידת קמפיינים. כרגע לא פעילות באתר." />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => decide(true, true)}
            className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            אישור הכל
          </button>
          <button
            onClick={() => decide(false, false)}
            className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            רק ההכרחיות
          </button>
          {details ? (
            <button
              onClick={() => decide(analytics, marketing)}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              שמירת הבחירה שלי
            </button>
          ) : (
            <button
              onClick={() => setDetails(true)}
              className="sm:w-auto px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-600 hover:text-slate-900
                         hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5"
            >
              <SlidersHorizontal size={14} /> התאמה אישית
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
