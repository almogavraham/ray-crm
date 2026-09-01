/**
 * CheckoutPage.tsx — the page a customer fills in before paying.
 *
 * Required by the payment provider's site review, which rejected the site for
 * having no checkout step of its own: the customer went straight from a price
 * to the processor's hosted form, so nothing on our side collected their
 * details or recorded that they accepted the terms. The review names the
 * fields — first name, last name, phone without a country prefix, country,
 * email — and requires a terms checkbox carrying a link to the terms.
 *
 * The consent is not decoration. It is stored with the order alongside the
 * exact wording shown and its version, so a later dispute is settled by what
 * the customer actually saw rather than by whatever the page says by then —
 * the same reasoning as the contact form.
 *
 * Buying a subscription needs an account for it to attach to, so a visitor who
 * is not signed in is told that up front rather than after filling the form,
 * and their entries survive the round trip through sign-in.
 */

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions, auth } from '../lib/firebase';
import { SITE_LEGAL } from '../lib/siteLegal';
import { VAT_PERCENT, vatOn, withVat } from '../lib/vat';

/** Kept in step with PLAN_PRICE_ILS in functions/morningPayments.js, which is
 *  authoritative: the server recomputes the price and refuses a mismatch. */
const PLANS = {
  basic:      { name: 'Basic',      price: 89 },
  pro:        { name: 'Pro',        price: 179 },
  enterprise: { name: 'Enterprise', price: 329 },
} as const;

type PlanKey = keyof typeof PLANS;

/** The exact wording accepted, stored with the order. Bump when it changes. */
const CHECKOUT_CONSENT_VERSION = '1.0';
const CHECKOUT_CONSENT_TEXT =
  'קראתי ואני מאשר/ת את תנאי השימוש ותקנון הביטולים, ואת מדיניות הפרטיות.';

/** Survives the trip through sign-in, so nothing typed here is lost. */
const DRAFT_KEY = 'ray_checkout_draft';

const COUNTRIES = ['ישראל', 'ארצות הברית', 'בריטניה', 'קנדה', 'אוסטרליה', 'צרפת', 'גרמניה', 'אחר'];

export default function CheckoutPage() {
  const params = new URLSearchParams(window.location.search);
  const planKey = (params.get('plan') ?? 'pro') as PlanKey;
  const plan = PLANS[planKey] ?? PLANS.pro;

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [country,   setCountry]   = useState('ישראל');
  const [email,     setEmail]     = useState('');
  const [agreed,    setAgreed]    = useState(false);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const vat   = vatOn(plan.price);
  const total = withVat(plan.price);

  useEffect(() => {
    const off = auth.onAuthStateChanged(u => {
      setSignedIn(Boolean(u));
      if (u?.email) setEmail(prev => prev || u.email!);
    });
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
      if (draft) {
        setFirstName(draft.firstName ?? ''); setLastName(draft.lastName ?? '');
        setPhone(draft.phone ?? ''); setCountry(draft.country ?? 'ישראל');
        setEmail(draft.email ?? '');
      }
    } catch { /* a corrupt draft is not worth failing the page over */ }
    return off;
  }, []);

  useEffect(() => { document.title = `תשלום · ${SITE_LEGAL.brand}`; }, []);

  const saveDraft = () => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ firstName, lastName, phone, country, email }));
    } catch { /* private mode — the form still works, it just will not be restored */ }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('יש למלא שם פרטי, שם משפחה וכתובת דוא״ל.'); return;
    }
    // Deliberately lenient: the review requires the number without a country
    // prefix, and a stricter pattern would reject valid numbers typed with a
    // dash or a leading zero.
    if (phone.replace(/\D/g, '').length < 9) {
      setError('יש למלא מספר טלפון תקין (ללא קידומת מדינה).'); return;
    }
    if (!agreed) { setError('יש לאשר את תנאי השימוש והתקנון כדי להמשיך.'); return; }

    saveDraft();

    if (!signedIn) {
      // A subscription has to attach to an account. Said here rather than
      // failing silently at the payment step. The destination is left in
      // session storage rather than passed as a query parameter, because
      // nothing in the sign-up flow reads one — AuthContext picks this up the
      // moment the account exists and brings them back to finish paying.
      try { sessionStorage.setItem('ray_checkout_return', window.location.pathname + window.location.search); }
      catch { /* private mode — they can navigate back themselves */ }
      window.location.href = '/signup';
      return;
    }

    setBusy(true);
    try {
      const fn = httpsCallable<unknown, { url: string }>(functions, 'createMorningPayment');
      const { data } = await fn({
        type: 'plan',
        planKey,
        // Sent as the price this page displayed. The server holds the real one
        // and aborts on a mismatch rather than charging either number.
        amount: total,
        label: `RAY CRM — ${plan.name} (מנוי חודשי)`,
        customer: {
          firstName: firstName.trim(), lastName: lastName.trim(),
          phone: phone.trim(), country, email: email.trim(),
        },
        consent: {
          text: CHECKOUT_CONSENT_TEXT,
          version: CHECKOUT_CONSENT_VERSION,
          acceptedAt: new Date().toISOString(),
        },
        successUrl: `${window.location.origin}/?paid=1`,
        failureUrl: `${window.location.origin}/checkout?plan=${planKey}&failed=1`,
      });
      if (!data?.url) throw new Error('לא התקבלה כתובת תשלום.');
      sessionStorage.removeItem(DRAFT_KEY);
      window.location.href = data.url;
    } catch (err) {
      setError((err as Error).message || 'לא הצלחנו להתחיל את התשלום. נסה שוב או צור קשר.');
      setBusy(false);
    }
  }

  const field = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 ' +
    'placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-shadow';
  const label = 'block text-[13px] font-bold text-slate-700 mb-1.5';

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <span className="font-black text-slate-900">{SITE_LEGAL.brand}</span>
          <a href="/" className="text-[14px] text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
            חזרה לאתר <ArrowRight size={15} />
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">
        <h1 className="text-3xl font-black text-slate-900 mb-2">השלמת הזמנה</h1>
        <p className="text-[15px] text-slate-600 mb-8">
          מלא את הפרטים כדי להמשיך לתשלום מאובטח. החשבונית תישלח לדוא״ל שתזין.
        </p>

        {/* Order summary — the price the customer is agreeing to, in full. */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <span className="font-bold text-slate-900">RAY CRM — {plan.name}</span>
            <span className="text-slate-700">₪{plan.price.toFixed(2)}</span>
          </div>
          <div className="flex items-baseline justify-between text-[14px] text-slate-500 mb-3">
            <span>מע״מ ({VAT_PERCENT}%)</span>
            <span>₪{vat.toFixed(2)}</span>
          </div>
          <div className="flex items-baseline justify-between pt-3 border-t border-slate-200">
            <span className="font-black text-slate-900">סה״כ לתשלום חודשי</span>
            <span className="font-black text-slate-900 text-lg">₪{total.toFixed(2)}</span>
          </div>
        </div>

        {signedIn === false && (
          <div className="flex gap-2.5 rounded-xl bg-amber-50 border border-amber-200 p-4 mb-6 text-[14px] text-amber-900">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
            <span>
              מנוי משויך לחשבון. מלא את הפרטים ונעביר אותך להרשמה מהירה — מה שתמלא כאן יישמר.
            </span>
          </div>
        )}

        <form onSubmit={submit} noValidate className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className={label} htmlFor="co-first">שם פרטי *</label>
              <input id="co-first" className={field} value={firstName} autoComplete="given-name"
                onChange={e => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="co-last">שם משפחה *</label>
              <input id="co-last" className={field} value={lastName} autoComplete="family-name"
                onChange={e => setLastName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="co-phone">טלפון (ללא קידומת מדינה) *</label>
              <input id="co-phone" className={field} value={phone} dir="ltr" inputMode="tel"
                placeholder="0501234567" autoComplete="tel-national"
                onChange={e => setPhone(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="co-country">מדינה *</label>
              <select id="co-country" className={field} value={country} autoComplete="country-name"
                onChange={e => setCountry(e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="co-email">כתובת דוא״ל *</label>
              <input id="co-email" className={field} value={email} type="email" dir="ltr"
                autoComplete="email" onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          {/* The terms consent.
           *
           * This was a bare native checkbox at the end of a long sentence. The
           * payment provider's review passed the terms LINK inside that same
           * sentence and still recorded the confirmation itself as missing —
           * they read the line and did not register the box, because a 20px
           * grey square at the end of running text does not read as a control.
           *
           * So it is now a titled block of its own, with a heading naming what
           * it is, an oversized box, and a border that turns green once ticked.
           * accent-color is set explicitly: Tailwind's forms plugin is not
           * installed here, so `text-indigo-600` never coloured the control. */}
          <div className={`mt-6 rounded-xl border-2 p-4 transition-colors ${
            agreed ? 'border-emerald-400 bg-emerald-50' : 'border-indigo-300 bg-indigo-50/50'
          }`}>
            <p className="text-[12px] font-black tracking-wide text-slate-500 mb-2">
              אישור תקנון — חובה
            </p>
            <label htmlFor="terms-consent" className="flex items-start gap-3 cursor-pointer">
              <input
                id="terms-consent"
                name="terms-consent"
                type="checkbox"
                required
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                style={{ accentColor: '#4f46e5', width: 24, height: 24 }}
                className="mt-0.5 flex-shrink-0 cursor-pointer"
              />
              <span className="text-[14px] leading-relaxed text-slate-800 font-medium">
                קראתי ואני מאשר/ת את{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer"
                  className="text-indigo-700 underline font-bold">תנאי השימוש ותקנון הביטולים</a>
                {' '}ואת{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer"
                  className="text-indigo-700 underline font-bold">מדיניות הפרטיות</a>.
              </span>
            </label>
          </div>

          {error && (
            <p className="mt-5 flex items-start gap-2 text-[14px] text-rose-700">
              <AlertCircle size={17} className="flex-shrink-0 mt-0.5" />{error}
            </p>
          )}

          {/* Disabled until the box is ticked. The consent is a precondition of
              the purchase, so the button should not look available before it is
              given — and a visibly blocked button is itself a signal that the
              control above it matters. */}
          <button type="submit" disabled={busy || !agreed}
            className="mt-6 w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300
                       disabled:cursor-not-allowed text-white font-bold py-3.5 flex items-center
                       justify-center gap-2 transition-colors">
            {busy ? <><Loader2 size={18} className="animate-spin" /> מעביר לתשלום…</>
                  : <><ShieldCheck size={18} /> המשך לתשלום מאובטח</>}
          </button>
          {!agreed && (
            <p className="mt-2 text-center text-[13px] font-semibold text-indigo-700">
              ↑ יש לאשר את התקנון כדי להמשיך
            </p>
          )}

          <p className="mt-4 text-center text-[12px] leading-relaxed text-slate-500">
            התשלום מתבצע בעמוד מאובטח. פרטי האשראי אינם נשמרים אצלנו.
            <br />
            המנוי מתחדש חודשית וניתן לביטול בכל עת לפי{' '}
            <a href="/terms" className="text-indigo-600 underline">תקנון הביטולים</a>.
          </p>
        </form>

        <address className="mt-8 not-italic text-center text-[13px] leading-relaxed text-slate-500">
          <span className="font-bold text-slate-700">{SITE_LEGAL.legalName}</span>
          {' · '}עוסק מורשה {SITE_LEGAL.companyId}
          <br />
          {SITE_LEGAL.address} · {SITE_LEGAL.phone} · {SITE_LEGAL.contactEmail}
        </address>
      </main>
    </div>
  );
}
