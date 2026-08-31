/**
 * ContactSection — the enquiry form on ray-crm.com.
 *
 * The lead goes straight into the RAY Staging workspace through the
 * `siteContact` function, which resolves that workspace itself so no id is
 * shipped in this bundle.
 *
 * Three things are deliberate:
 *  • Consent is two separate checkboxes. Bundling "contact me about this" with
 *    "send me marketing" into one tick is not consent to the second, and under
 *    the Israeli spam provisions the marketing one has to be its own opt-in,
 *    unticked by default.
 *  • Errors say what went wrong and are announced to screen readers, rather
 *    than a field silently turning red.
 *  • A failed submission is reported as failed. The one thing a contact form
 *    must never do is show a thank-you for a message that was never received.
 */

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle, Phone, Mail, Building2, User, MessageSquare } from 'lucide-react';
import {
  SITE_LEGAL, CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION, MARKETING_CONSENT_TEXT, telHref,
} from '../lib/siteLegal';

const ENDPOINT = 'https://us-central1-chex-crm.cloudfunctions.net/siteContact';

type Status = { kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string };

export default function ContactSection() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [hp, setHp] = useState('');            // honeypot
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const openedAt = useRef(Date.now());
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the error so a screen-reader user is told immediately, rather
  // than being left at the button wondering whether anything happened.
  useEffect(() => {
    if (status.kind === 'error') errorRef.current?.focus();
  }, [status]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;

    if (!name.trim())                       { setStatus({ kind: 'error', message: 'נא למלא שם' }); return; }
    if (phone.replace(/\D/g, '').length < 9) { setStatus({ kind: 'error', message: 'נא למלא מספר טלפון תקין' }); return; }
    if (!consent)                            { setStatus({ kind: 'error', message: 'יש לאשר את מדיניות הפרטיות ותנאי השימוש' }); return; }

    setStatus({ kind: 'sending' });
    const q = new URLSearchParams(window.location.search);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(), email: email.trim(),
          company: company.trim(), message: message.trim(),
          consent: true,
          marketingOptIn: marketing,
          consentText: CONTACT_CONSENT_TEXT,
          consentVersion: CONTACT_CONSENT_VERSION,
          _hp: hp,
          elapsedMs: Date.now() - openedAt.current,
          utm_source: q.get('utm_source') ?? '', utm_medium: q.get('utm_medium') ?? '',
          utm_campaign: q.get('utm_campaign') ?? '', utm_term: q.get('utm_term') ?? '',
          utm_content: q.get('utm_content') ?? '',
          page_url: window.location.href, referrer: document.referrer,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: 'error', message: data.error || 'לא הצלחנו לשלוח את הפנייה. נסה שוב.' });
        return;
      }
      setStatus({ kind: 'sent' });
    } catch {
      setStatus({
        kind: 'error',
        message: `לא הצלחנו לשלוח את הפנייה — בדוק את החיבור לאינטרנט, או כתוב לנו ל-${SITE_LEGAL.contactEmail}`,
      });
    }
  };

  const field =
    'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 ' +
    'placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-shadow';
  const label = 'block text-[13px] font-bold text-slate-700 mb-1.5';

  if (status.kind === 'sent') {
    return (
      <section id="contact" dir="rtl" className="relative py-28 bg-slate-50">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 text-center">
          <span className="inline-flex w-16 h-16 rounded-2xl bg-emerald-50 items-center justify-center mb-5">
            <CheckCircle2 size={30} className="text-emerald-600" />
          </span>
          <h2 className="text-3xl font-black text-slate-900 mb-3">הפנייה התקבלה</h2>
          <p className="text-[16px] leading-relaxed text-slate-600">
            תודה{name ? `, ${name.split(' ')[0]}` : ''} — קיבלנו את הפרטים ונחזור אליך בהקדם.
            אם זה דחוף, אפשר גם לכתוב לנו ישירות ל-
            <a href={`mailto:${SITE_LEGAL.contactEmail}`} className="text-indigo-600 underline">
              {SITE_LEGAL.contactEmail}
            </a>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="contact" dir="rtl" className="relative py-28 bg-slate-50 border-t border-slate-200">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mb-3">
            דברו איתנו
          </h2>
          <p className="text-[16px] leading-relaxed text-slate-600 max-w-xl mx-auto">
            השאירו פרטים ונחזור אליכם עם הדגמה קצרה של המערכת, מותאמת לעסק שלכם.
            בלי התחייבות ובלי כרטיס אשראי.
          </p>
        </div>

        <form onSubmit={submit} noValidate
          className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-9">

          {/* Honeypot: hidden from humans, irresistible to naive bots. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0 }}>
            <label htmlFor="company-website">אל תמלא שדה זה</label>
            <input id="company-website" name="company-website" tabIndex={-1} autoComplete="off"
              value={hp} onChange={e => setHp(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className={label} htmlFor="cf-name">
                <span className="inline-flex items-center gap-1.5"><User size={13} /> שם מלא *</span>
              </label>
              <input id="cf-name" className={field} value={name} required autoComplete="name"
                onChange={e => setName(e.target.value)} placeholder="ישראל ישראלי" />
            </div>

            <div>
              <label className={label} htmlFor="cf-phone">
                <span className="inline-flex items-center gap-1.5"><Phone size={13} /> טלפון *</span>
              </label>
              <input id="cf-phone" className={field} value={phone} required type="tel" autoComplete="tel"
                onChange={e => setPhone(e.target.value)} placeholder="050-0000000" dir="ltr" />
            </div>

            <div>
              <label className={label} htmlFor="cf-email">
                <span className="inline-flex items-center gap-1.5"><Mail size={13} /> אימייל</span>
              </label>
              <input id="cf-email" className={field} value={email} type="email" autoComplete="email"
                onChange={e => setEmail(e.target.value)} placeholder="you@company.co.il" dir="ltr" />
            </div>

            <div>
              <label className={label} htmlFor="cf-company">
                <span className="inline-flex items-center gap-1.5"><Building2 size={13} /> שם העסק</span>
              </label>
              <input id="cf-company" className={field} value={company} autoComplete="organization"
                onChange={e => setCompany(e.target.value)} placeholder="שם החברה" />
            </div>

            <div className="sm:col-span-2">
              <label className={label} htmlFor="cf-message">
                <span className="inline-flex items-center gap-1.5"><MessageSquare size={13} /> במה נוכל לעזור?</span>
              </label>
              <textarea id="cf-message" className={field} rows={4} value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="ספרו לנו קצת על העסק ועל מה שאתם מחפשים…" />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={consent} required
                onChange={e => setConsent(e.target.checked)}
                className="mt-1 w-4 h-4 accent-indigo-600 flex-shrink-0" />
              <span className="text-[13px] leading-relaxed text-slate-700">
                קראתי ואני מסכים/ה ל
                <a href="/privacy" className="text-indigo-600 underline">מדיניות הפרטיות</a> ול
                <a href="/terms" className="text-indigo-600 underline">תנאי השימוש</a>,
                ומאשר/ת שתיצרו איתי קשר בנוגע לפנייה זו. *
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={marketing}
                onChange={e => setMarketing(e.target.checked)}
                className="mt-1 w-4 h-4 accent-indigo-600 flex-shrink-0" />
              <span className="text-[13px] leading-relaxed text-slate-700">{MARKETING_CONSENT_TEXT}</span>
            </label>
          </div>

          <div aria-live="polite" className="min-h-[1.5rem] mt-4">
            {status.kind === 'error' && (
              <p ref={errorRef} tabIndex={-1} role="alert"
                className="flex items-start gap-2 text-[13px] font-semibold text-red-700">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                {status.message}
              </p>
            )}
          </div>

          <button type="submit" disabled={status.kind === 'sending'}
            className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5
                       rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                       text-white text-[15px] font-bold transition-colors">
            {status.kind === 'sending'
              ? <><Loader2 size={16} className="animate-spin" /> שולח…</>
              : <><Send size={16} /> שליחה</>}
          </button>

          {/* The disclaimer. Placed where it is read before sending, not buried
              in a footer nobody scrolls to. */}
          <p className="mt-6 pt-5 border-t border-slate-200 text-[12px] leading-relaxed text-slate-500">
            <strong className="text-slate-600">גילוי נאות:</strong>{' '}
            הפרטים שתמסרו ישמשו ליצירת קשר בנוגע לפנייה בלבד, וכן לדיוור שיווקי אם אישרתם
            זאת במפורש. אין חובה חוקית למסור את הפרטים, ומסירתם נעשית מרצונכם החופשי. המידע
            יישמר במאגר הלקוחות שלנו בהתאם ל
            <a href="/privacy" className="text-indigo-600 underline">מדיניות הפרטיות</a>,
            ותוכלו לבקש בכל עת לעיין בו, לתקנו או למחוק אותו בפנייה ל-
            <a href={`mailto:${SITE_LEGAL.privacyEmail}`} className="text-indigo-600 underline">
              {SITE_LEGAL.privacyEmail}
            </a>. שליחת הטופס אינה מהווה התחייבות של אף צד להתקשרות, והתכנים באתר אינם
            מהווים ייעוץ מקצועי.
          </p>
        </form>

        {/* Business identity, published rather than tucked into a legal page.
            A card processor will not approve a site for payment without the
            operator's name, business number, physical address and phone
            visible on it, next to a cancellation policy — so this block is a
            prerequisite for taking payment at all, not a footer nicety. */}
        <address className="mt-8 not-italic text-center text-[13px] leading-relaxed text-slate-500">
          <span className="font-bold text-slate-700">{SITE_LEGAL.legalName}</span>
          {' · '}עוסק מורשה {SITE_LEGAL.companyId}
          <br />
          {SITE_LEGAL.address}
          {' · '}
          <a href={telHref()} dir="ltr" className="text-indigo-600 underline">
            {SITE_LEGAL.phone}
          </a>
          {' · '}
          <a href={`mailto:${SITE_LEGAL.contactEmail}`} className="text-indigo-600 underline">
            {SITE_LEGAL.contactEmail}
          </a>
          <br />
          <a href="/terms" className="text-indigo-600 underline">תנאי שימוש ותקנון ביטולים</a>
          {' · '}
          <a href="/privacy" className="text-indigo-600 underline">מדיניות פרטיות</a>
          {' · '}
          <a href="/accessibility" className="text-indigo-600 underline">הצהרת נגישות</a>
        </address>
      </div>
    </section>
  );
}
