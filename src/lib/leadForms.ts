/**
 * leadForms.ts — embeddable lead-capture forms.
 *
 * Closes the biggest adoption gap against Zoho: today connecting a website
 * means "wire up a webhook", which needs a developer. This turns it into
 * "copy this snippet", which the customer's web person can paste in a minute.
 *
 * The generated snippet is deliberately dependency-free vanilla JS in one
 * <script> tag. Anything that needs npm, a build step, or a framework is
 * unusable on the WordPress and Wix sites these customers actually run.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const REGION_URL = 'https://us-central1-chex-crm.cloudfunctions.net/formSubmit';

export interface LeadForm {
  id: string;
  name: string;
  enabled: boolean;
  defaultStatus: string;
  defaultSource: string;
  assignTo?: string;
  redirectUrl?: string;
  successMessage: string;
  /** Which optional fields to render. Name + phone are always present. */
  fields: { email: boolean; company: boolean; message: boolean };
  createdAt: number;
}

export const DEFAULT_FORM = (): Omit<LeadForm, 'id' | 'createdAt'> => ({
  name: 'טופס יצירת קשר',
  enabled: true,
  defaultStatus: 'חדש',
  defaultSource: 'טופס אתר',
  successMessage: 'תודה! נחזור אליך בהקדם.',
  fields: { email: true, company: true, message: true },
});

const formsDoc = (wid: string) => doc(db, 'workspaces', wid, 'config', 'leadForms');

export async function loadForms(wid: string): Promise<LeadForm[]> {
  try {
    const snap = await getDoc(formsDoc(wid));
    return snap.exists() ? ((snap.data().forms ?? []) as LeadForm[]) : [];
  } catch { return []; }
}

export async function saveForms(wid: string, forms: LeadForm[]): Promise<void> {
  await setDoc(formsDoc(wid), { forms }, { merge: true });
}

/** Unguessable — this id is the form's only credential on a public page. */
export function newFormId(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  return 'f_' + Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The embed snippet.
 *
 * Reads UTM parameters off the HOST page, not the form — by the time someone
 * types their name the campaign that brought them exists only in that URL.
 * Also carries the referrer and landing page, which together answer "where did
 * this lead actually come from" without any tag manager.
 */
export function embedSnippet(wid: string, form: LeadForm): string {
  const f = form.fields;
  return `<!-- RAY — ${form.name} -->
<div id="ray-form-${form.id}"></div>
<script>
(function () {
  var WS = ${JSON.stringify(wid)}, FORM = ${JSON.stringify(form.id)};
  var root = document.getElementById('ray-form-' + FORM);
  var q = new URLSearchParams(location.search);
  var S = 'width:100%;padding:10px 12px;margin:0 0 10px;border:1px solid #d5d8e0;' +
          'border-radius:10px;font:inherit;box-sizing:border-box';

  root.setAttribute('dir', 'rtl');
  root.innerHTML =
    '<form style="max-width:420px;font-family:system-ui,sans-serif;text-align:right">' +
      '<input name="name" placeholder="שם מלא *" required style="' + S + '">' +
      '<input name="phone" placeholder="טלפון *" required style="' + S + '">' +
      ${f.email   ? `'<input name="email" type="email" placeholder="אימייל" style="' + S + '">' +` : ''}
      ${f.company ? `'<input name="company" placeholder="שם החברה" style="' + S + '">' +` : ''}
      ${f.message ? `'<textarea name="message" rows="3" placeholder="במה נוכל לעזור?" style="' + S + '"></textarea>' +` : ''}
      // Honeypot: off-screen, no label, never focusable by a human.
      '<input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">' +
      '<button type="submit" style="width:100%;padding:11px;border:0;border-radius:10px;' +
        'background:#6366f1;color:#fff;font:inherit;font-weight:700;cursor:pointer">שליחה</button>' +
      '<p data-msg style="margin:10px 0 0;font-size:14px"></p>' +
    '</form>';

  var form = root.querySelector('form'), msg = root.querySelector('[data-msg]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'שולח…';
    var d = {};
    new FormData(form).forEach(function (v, k) { d[k] = v; });
    d.utm_source = q.get('utm_source') || '';
    d.utm_medium = q.get('utm_medium') || '';
    d.utm_campaign = q.get('utm_campaign') || '';
    d.utm_term = q.get('utm_term') || '';
    d.utm_content = q.get('utm_content') || '';
    d.page_url = location.href;
    d.referrer = document.referrer || '';

    fetch(${JSON.stringify(REGION_URL)} + '?ws=' + encodeURIComponent(WS) + '&form=' + encodeURIComponent(FORM), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d)
    })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (r && r.ok) {
        if (r.redirect) { location.href = r.redirect; return; }
        form.innerHTML = '<p style="font-size:15px;font-weight:600;color:#059669">' +
          ${JSON.stringify(form.successMessage)} + '</p>';
      } else { throw new Error(); }
    })
    .catch(function () {
      msg.textContent = 'השליחה נכשלה. נסו שוב או התקשרו אלינו.';
      msg.style.color = '#dc2626';
      btn.disabled = false; btn.textContent = 'שליחה';
    });
  });
})();
</script>`;
}
