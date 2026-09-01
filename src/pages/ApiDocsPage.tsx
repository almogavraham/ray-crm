/**
 * ApiDocsPage.tsx — public reference for the RAY CRM API, at /api.
 *
 * Written for someone who has to make an integration work today, so it leads
 * with a request they can paste and run, and states the things that are only
 * discovered painfully otherwise: that a key is shown once, that writes take a
 * whitelist so unknown fields are ignored rather than stored, that list order
 * is stable and cursor-based, and what each error code actually means.
 *
 * Deliberately not generated from a schema. A generated page documents the
 * shape of the endpoints; the parts that cost integrators time are the rules
 * around them, and those have to be written down by someone who knows them.
 */

import { useEffect, useState } from 'react';
import { ArrowRight, Copy, Check, Terminal, KeyRound, ShieldAlert, Zap } from 'lucide-react';
import { SITE_LEGAL } from '../lib/siteLegal';

const BASE = 'https://us-central1-chex-crm.cloudfunctions.net/api/v1';

/* ── Small presentational pieces ─────────────────────────────────────────── */

function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the text is still selectable */ }
  };
  return (
    <div className="relative group my-4">
      {label && (
        <div className="px-4 py-1.5 text-[11px] font-mono tracking-wide text-slate-400 bg-slate-800 rounded-t-xl border-b border-slate-700">
          {label}
        </div>
      )}
      <pre dir="ltr" className={`overflow-x-auto bg-slate-900 text-slate-100 p-4 text-[13px] leading-relaxed font-mono ${label ? 'rounded-b-xl' : 'rounded-xl'}`}>
        <code>{children}</code>
      </pre>
      <button onClick={copy} aria-label="העתק"
        className="absolute top-2 left-2 p-1.5 rounded-lg bg-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-white transition-opacity">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Endpoint({ method, path, children }: { method: string; path: string; children: React.ReactNode }) {
  const tone: Record<string, string> = {
    GET:   'bg-sky-100 text-sky-800',
    POST:  'bg-emerald-100 text-emerald-800',
    PATCH: 'bg-amber-100 text-amber-800',
  };
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden mb-4 bg-white">
      <div dir="ltr" className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <span className={`px-2 py-0.5 rounded-md text-[11px] font-black tracking-wide ${tone[method] ?? 'bg-slate-200 text-slate-700'}`}>
          {method}
        </span>
        <code className="text-[13px] font-mono text-slate-800">{path}</code>
      </div>
      <div className="px-4 py-3 text-[14px] leading-relaxed text-slate-600">{children}</div>
    </div>
  );
}

function Row({ name, type, children }: { name: string; type: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2.5 pl-4 align-top"><code dir="ltr" className="text-[13px] font-mono text-indigo-700">{name}</code></td>
      <td className="py-2.5 pl-4 align-top text-[12px] text-slate-400 font-mono" dir="ltr">{type}</td>
      <td className="py-2.5 text-[13px] leading-relaxed text-slate-600">{children}</td>
    </tr>
  );
}

const H = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="text-2xl font-black text-slate-900 mt-14 mb-4 scroll-mt-24">{children}</h2>
);

const UL = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="mb-4 space-y-2.5">
    {items.map((it, i) => (
      <li key={i} className="text-[15px] leading-[1.8] text-slate-700 flex gap-2.5">
        <span className="mt-[10px] w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ApiDocsPage() {
  useEffect(() => { document.title = `API · ${SITE_LEGAL.brand}`; }, []);

  const nav = [
    ['getting-started', 'התחלה מהירה'],
    ['auth',            'אימות'],
    ['leads',           'לידים'],
    ['tasks',           'משימות'],
    ['webhooks',        'Webhooks'],
    ['errors',          'שגיאות'],
    ['limits',          'מגבלות'],
  ] as const;

  return (
    <div dir="rtl" className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="/" className="font-black text-slate-900">{SITE_LEGAL.brand}</a>
          <a href="/" className="text-[14px] text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
            חזרה לאתר <ArrowRight size={15} />
          </a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-12 grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-10">
        <main className="min-w-0 order-2 lg:order-1">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-3">RAY CRM API</h1>
          <p className="text-[17px] leading-relaxed text-slate-600 mb-2">
            ממשק REST לחיבור המערכת שלך ל-RAY CRM: קריאה וכתיבה של לידים ומשימות
            מכל שפה, מכל שרת.
          </p>
          <p className="text-[15px] leading-relaxed text-slate-500">
            כל הבקשות ב-HTTPS, כל הגוף ב-JSON, וכל השדות ב-<code dir="ltr" className="text-[13px] font-mono text-slate-700">snake_case</code>.
          </p>

          <H id="getting-started">התחלה מהירה</H>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-2">
            צור מפתח בהגדרות סביבת העבודה, ואז:
          </p>
          <Code label="בדיקת חיבור">{`curl ${BASE}/me \\
  -H "Authorization: Bearer YOUR_API_KEY"`}</Code>
          <Code label="תשובה">{`{
  "data": {
    "workspace_id": "ws_abc123",
    "key_name": "Zapier",
    "scopes": ["read", "write"]
  }
}`}</Code>

          <div className="flex gap-3 rounded-xl bg-indigo-50 border border-indigo-100 p-4 mt-6">
            <Terminal size={18} className="text-indigo-600 flex-shrink-0 mt-0.5" />
            <p className="text-[14px] leading-relaxed text-indigo-900">
              <strong>כתובת הבסיס:</strong>{' '}
              <code dir="ltr" className="font-mono text-[13px] break-all">{BASE}</code>
            </p>
          </div>

          <H id="auth">אימות</H>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-3">
            כל בקשה נושאת מפתח בכותרת <code dir="ltr" className="text-[13px] font-mono">Authorization</code>.
            המפתח משויך לסביבת עבודה אחת ורואה רק את הנתונים שלה.
          </p>
          <Code>{`Authorization: Bearer ray_sk_xxxxxxxxxxxxxxxxxxxxxxxx`}</Code>

          <div className="flex gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4 my-5">
            <KeyRound size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-[14px] leading-relaxed text-amber-900">
              <strong>המפתח מוצג פעם אחת בלבד.</strong> אנחנו שומרים רק את הגיבוב (hash) שלו,
              ולכן גם אנחנו לא יכולים לשחזר אותו עבורך. שמור אותו במקום מאובטח מיד —
              אם אבד, בטל אותו וצור חדש.
            </div>
          </div>

          <div className="flex gap-3 rounded-xl bg-rose-50 border border-rose-200 p-4 my-5">
            <ShieldAlert size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="text-[14px] leading-relaxed text-rose-900">
              <strong>אל תשתמש במפתח בקוד צד-לקוח.</strong> מפתח שמופיע ב-JavaScript של דפדפן
              או באפליקציית מובייל גלוי לכל אחד. קרא ל-API מהשרת שלך בלבד.
            </div>
          </div>

          <H id="leads">לידים</H>

          <Endpoint method="GET" path="/v1/leads">
            רשימת לידים, מהחדש לישן. פרמטרים:{' '}
            <code dir="ltr" className="text-[12px] font-mono">limit</code> (עד 100, ברירת מחדל 25),{' '}
            <code dir="ltr" className="text-[12px] font-mono">cursor</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">status</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">assigned_to</code>.
          </Endpoint>

          <p className="text-[15px] leading-relaxed text-slate-600 mb-1">
            הדפדוף מבוסס סמן ולא מספר עמוד: הסדר יציב, כך שליד חדש שנוצר באמצע
            סנכרון לא יזיז שורות בין עמודים ולא יגרום לדילוג על רשומה.
          </p>
          <Code label="מעבר על כל הלידים">{`let cursor = null;
do {
  const url = new URL("${BASE}/leads");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res  = await fetch(url, { headers: { Authorization: \`Bearer \${KEY}\` } });
  const page = await res.json();

  for (const lead of page.data) handle(lead);
  cursor = page.has_more ? page.next_cursor : null;
} while (cursor);`}</Code>

          <Endpoint method="POST" path="/v1/leads">
            יוצר ליד. חובה: <code dir="ltr" className="text-[12px] font-mono">company</code> או{' '}
            <code dir="ltr" className="text-[12px] font-mono">contact_name</code>, ובנוסף{' '}
            <code dir="ltr" className="text-[12px] font-mono">email</code> או{' '}
            <code dir="ltr" className="text-[12px] font-mono">phone</code> — ליד שאי אפשר ליצור איתו קשר אינו ליד.
          </Endpoint>
          <Code label="יצירת ליד">{`curl -X POST ${BASE}/leads \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "company": "אקמה בעמ",
    "contact_name": "דנה כהן",
    "email": "dana@acme.co.il",
    "phone": "0501234567",
    "budget": 25000,
    "custom_fields": { "מקור מדויק": "כנס 2026" }
  }'`}</Code>

          <Endpoint method="GET" path="/v1/leads/{id}">ליד יחיד.</Endpoint>
          <Endpoint method="PATCH" path="/v1/leads/{id}">
            עדכון חלקי — שלח רק את מה שהשתנה.
          </Endpoint>

          <h3 className="text-lg font-black text-slate-900 mt-8 mb-3">שדות שניתן לכתוב</h3>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-right">
              <tbody>
                <Row name="company" type="string">שם החברה</Row>
                <Row name="contact_name" type="string">שם איש הקשר</Row>
                <Row name="email" type="string">כתובת דוא״ל</Row>
                <Row name="phone" type="string">טלפון</Row>
                <Row name="status" type="string">סטטוס בפייפליין. חייב להתאים לסטטוס קיים בסביבת העבודה.</Row>
                <Row name="source" type="string">מקור הליד</Row>
                <Row name="assigned_to" type="string">שם חבר הצוות המטפל</Row>
                <Row name="budget" type="number">תקציב בשקלים</Row>
                <Row name="is_hot" type="boolean">סימון ליד חם</Row>
                <Row name="next_follow_up" type="string">מועד המעקב הבא, ISO</Row>
                <Row name="custom_fields" type="object">שדות מותאמים אישית של סביבת העבודה</Row>
              </tbody>
            </table>
          </div>
          <p className="text-[14px] leading-relaxed text-slate-500 mt-3">
            <strong className="text-slate-700">שדות שאינם ברשימה מתעלמים מהם בשקט ולא נשמרים.</strong>{' '}
            זה מכוון: <code dir="ltr" className="text-[12px] font-mono">ai_score</code>, יומן הפעילות
            ותאריך היצירה מחושבים על ידי המערכת, ואינטגרציה שיכולה לדרוס אותם יכולה גם
            להשחית אותם. בתשובה תמיד מוחזר הליד כפי שנשמר בפועל — השווה מולה אם משהו לא נראה לך.
          </p>

          <H id="tasks">משימות</H>
          <Endpoint method="GET" path="/v1/tasks">
            פרמטרים: <code dir="ltr" className="text-[12px] font-mono">completed</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">lead_id</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">limit</code>.
          </Endpoint>
          <Endpoint method="POST" path="/v1/tasks">
            חובה: <code dir="ltr" className="text-[12px] font-mono">description</code> ו-
            <code dir="ltr" className="text-[12px] font-mono">date</code> (בפורמט YYYY-MM-DD).
            אופציונלי: <code dir="ltr" className="text-[12px] font-mono">time</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">priority</code> (low/medium/high),{' '}
            <code dir="ltr" className="text-[12px] font-mono">assigned_to</code>,{' '}
            <code dir="ltr" className="text-[12px] font-mono">lead_id</code> לשיוך לליד.
          </Endpoint>
          <Code label="יצירת משימה משויכת לליד">{`curl -X POST ${BASE}/tasks \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "לחזור לדנה עם הצעת מחיר",
    "date": "2026-09-10",
    "time": "10:30",
    "priority": "high",
    "lead_id": "api_1788236007744_7382e897"
  }'`}</Code>

          <H id="webhooks">Webhooks — שנדע לספר לך</H>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-3">
            במקום לשאול את ה-API כל דקה אם נכנס ליד חדש, אנחנו נודיע לך ברגע שזה קורה.
            רשום כתובת HTTPS בהגדרות → מפתחות API, ונשלח אליה POST על כל אירוע שתבחר.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 mb-4">
            <table className="w-full text-right">
              <tbody>
                <Row name="lead.created" type="event">נוצר ליד חדש — מכל מקור: טופס, API, או ידנית.</Row>
                <Row name="lead.updated" type="event">השתנה שדה בליד. לא נשלח על שינוי שאינו נראה לך.</Row>
                <Row name="task.created" type="event">נוצרה משימה חדשה.</Row>
              </tbody>
            </table>
          </div>
          <Code label="מבנה ההודעה">{`POST https://your-server.com/ray-hook
X-Ray-Event: lead.created
X-Ray-Signature: 9f86d081884c7d659a2feaa0c55ad015...

{
  "id": "evt_1788243557499_a3f2b1",
  "event": "lead.created",
  "created_at": "2026-09-01T06:19:23.000Z",
  "workspace_id": "ws_abc123",
  "data": { ...אותו מבנה בדיוק כמו GET /v1/leads/{id} }
}`}</Code>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-3">
            <strong>שדה <code dir="ltr" className="text-[13px] font-mono">data</code> זהה למה
            ש-<code dir="ltr" className="text-[13px] font-mono">GET /v1/leads/{'{id}'}</code> מחזיר</strong>,
            כדי שלא תצטרך לכתוב שני מפענחים לאותו אובייקט.
          </p>

          <div className="flex gap-3 rounded-xl bg-rose-50 border border-rose-200 p-4 my-5">
            <ShieldAlert size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="text-[14px] leading-relaxed text-rose-900">
              <strong>אמת את החתימה — הכתובת שלך ציבורית.</strong> בלי אימות, כל אחד יכול
              לשלוח אליה ליד מומצא. <code dir="ltr" className="text-[12px] font-mono">X-Ray-Signature</code>{' '}
              הוא HMAC-SHA256 של <strong>גוף הבקשה הגולמי</strong>, עם ה-secret שקיבלת ביצירה.
            </div>
          </div>
          <Code label="אימות בצד שלך (Node.js)">{`const crypto = require('crypto');

app.post('/ray-hook', express.raw({ type: 'application/json' }), (req, res) => {
  const expected = crypto.createHmac('sha256', RAY_WEBHOOK_SECRET)
                         .update(req.body)          // הבייטים הגולמיים, לא JSON מסודר מחדש
                         .digest('hex');
  const got = req.get('X-Ray-Signature') || '';
  if (expected.length !== got.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) {
    return res.status(401).send('bad signature');
  }
  const event = JSON.parse(req.body.toString('utf8'));
  // ... טפל באירוע, והחזר 2xx מהר
  res.sendStatus(200);
});`}</Code>
          <p className="text-[14px] leading-relaxed text-slate-500 mb-3">
            חשב את ה-HMAC על <strong>הבייטים כפי שהתקבלו</strong>. אם תיתן ל-JSON parser לסדר
            אותם מחדש, החתימה לא תתאים לעולם.
          </p>
          <UL items={[
            <>ענה <strong>2xx</strong> כדי לאשר קבלה. כל תשובה אחרת נחשבת לכישלון.</>,
            <>אנחנו מוותרים אחרי <strong>10 שניות</strong> ללא תשובה — קבל, אשר, ועבד אחר כך.</>,
            <>אחרי <strong>15 כשלים רצופים</strong> הכתובת מושבתת אוטומטית, כדי לא להמשיך להכות
              בשרת שנפל. תראה את הסיבה בהגדרות ותוכל להפעיל מחדש.</>,
            <>יש כפתור <strong>שלח בדיקה</strong> — תוכל לוודא שהכתובת עובדת לפני שזה משנה.</>,
          ]} />

          <H id="errors">שגיאות</H>
          <p className="text-[15px] leading-relaxed text-slate-600 mb-3">
            לכל שגיאה אותו מבנה, עם קוד HTTP אמיתי:
          </p>
          <Code>{`{
  "error": {
    "code": "invalid_request",
    "message": "Either email or phone is required."
  }
}`}</Code>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 mt-4">
            <table className="w-full text-right">
              <tbody>
                <Row name="400" type="invalid_request">הבקשה שגויה — ההודעה אומרת מה בדיוק.</Row>
                <Row name="401" type="unauthorized">מפתח חסר, שגוי או שבוטל.</Row>
                <Row name="404" type="not_found">המשאב לא קיים בסביבת העבודה הזו.</Row>
                <Row name="405" type="method_not_allowed">הפעולה אינה נתמכת בנתיב הזה.</Row>
                <Row name="429" type="rate_limited">חרגת מהמגבלה. המתן ונסה שוב.</Row>
                <Row name="503" type="index_building">מסנן חדש עדיין נבנה בצד שלנו. זמני — נסה שוב בעוד כמה דקות.</Row>
                <Row name="500" type="internal_error">תקלה אצלנו. הבקשה שלך תקינה — כדאי לנסות שוב.</Row>
              </tbody>
            </table>
          </div>

          <H id="limits">מגבלות</H>
          <div className="flex gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
            <Zap size={18} className="text-slate-500 flex-shrink-0 mt-0.5" />
            <div className="text-[14px] leading-relaxed text-slate-700">
              <strong>120 בקשות לדקה לכל מפתח.</strong> חריגה מחזירה 429.
              אם אתה מסנכרן כמות גדולה, השתמש ב-<code dir="ltr" className="text-[12px] font-mono">limit=100</code>{' '}
              ובדפדוף במקום בבקשות בודדות — זה גם מהיר יותר וגם לא מתקרב למגבלה.
            </div>
          </div>
          <p className="text-[14px] leading-relaxed text-slate-500 mt-4">
            עמוד מקסימלי: 100 רשומות. גודל גוף בקשה: עד 1MB.
          </p>

          <div className="mt-14 pt-8 border-t border-slate-200">
            <p className="text-[14px] leading-relaxed text-slate-500">
              שאלה, בקשה לשדה נוסף, או נתקעת באינטגרציה?{' '}
              <a href={`mailto:${SITE_LEGAL.contactEmail}`} className="text-indigo-600 underline font-semibold">
                {SITE_LEGAL.contactEmail}
              </a>
            </p>
          </div>
        </main>

        <nav className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-24">
            <p className="text-[11px] font-black tracking-widest text-slate-400 uppercase mb-3">בעמוד זה</p>
            <ul className="space-y-1.5">
              {nav.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="block text-[14px] text-slate-500 hover:text-indigo-600 transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </div>
  );
}
