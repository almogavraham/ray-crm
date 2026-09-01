/**
 * SecurityPage.tsx — how RAY CRM protects customer data, at /security.
 *
 * Every claim here was checked against the code before it was written. A
 * security page is the one document where an aspirational sentence becomes a
 * misrepresentation the moment a customer relies on it, so this describes only
 * what is actually implemented — and says plainly what is not.
 *
 * The "what we do not have yet" section is deliberate. A page that lists only
 * strengths reads as marketing and tells a security reviewer nothing; naming
 * the gaps is what makes the rest credible, and it is what a buyer doing real
 * diligence is looking for.
 */

import { useEffect } from 'react';
import { ArrowRight, Lock, Server, KeyRound, Database, Eye, AlertTriangle, CreditCard } from 'lucide-react';
import { SITE_LEGAL } from '../lib/siteLegal';

const H = ({ id, icon: Icon, children }: { id: string; icon: typeof Lock; children: React.ReactNode }) => (
  <h2 id={id} className="flex items-center gap-2.5 text-xl font-black text-slate-900 mt-12 mb-4 scroll-mt-24">
    <span className="inline-flex w-8 h-8 rounded-lg bg-indigo-50 items-center justify-center flex-shrink-0">
      <Icon size={16} className="text-indigo-600" />
    </span>
    {children}
  </h2>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[15px] leading-[1.85] text-slate-700 mb-4">{children}</p>
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

export default function SecurityPage() {
  useEffect(() => { document.title = `אבטחת מידע · ${SITE_LEGAL.brand}`; }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <a href="/" className="font-black text-slate-900">{SITE_LEGAL.brand}</a>
          <a href="/" className="text-[14px] text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
            חזרה לאתר <ArrowRight size={15} />
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-3">אבטחת מידע</h1>
        <p className="text-[17px] leading-relaxed text-slate-600">
          המידע שאתם מזינים ל-RAY CRM הוא רשימת הלקוחות שלכם — הנכס הרגיש ביותר בעסק.
          המסמך הזה מתאר בדיוק איך הוא מוגן, ומה עוד לא מיושם.
        </p>
        <p className="text-[13px] text-slate-400 mt-4">עודכן לאחרונה: {SITE_LEGAL.updated}</p>

        <H id="infra" icon={Server}>היכן המידע מאוחסן</H>
        <P>
          המערכת פועלת על <strong>Google Cloud</strong> באמצעות Firebase. אנחנו לא מפעילים
          שרתים משלנו ולא מחזיקים חומרה — התשתית, ההצפנה בשכבת האחסון והגיבוי הפיזי הם
          באחריות Google, שמחזיקה בתקני ISO 27001, SOC 1/2/3 ו-PCI DSS.
        </P>
        <P>
          חלק מהשירותים מאחסנים או מעבדים מידע <strong>מחוץ לישראל</strong>, לרבות בארצות
          הברית ובאיחוד האירופי. זה מצוין גם ב
          <a href="/privacy" className="text-indigo-600 underline">מדיניות הפרטיות</a>.
        </P>

        <H id="transit" icon={Lock}>הצפנה</H>
        <UL items={[
          <><strong>בתעבורה:</strong> כל התקשורת לאתר ולממשקים מוצפנת ב-HTTPS (TLS). אין נתיב לא מוצפן.</>,
          <><strong>באחסון:</strong> Google Cloud מצפינה את הנתונים במנוחה כברירת מחדל, ברמת התשתית.</>,
          <><strong>סיסמאות:</strong> מנוהלות על ידי Firebase Authentication. אנחנו לא רואים אותן, לא שומרים אותן ולא יכולים לשחזר אותן.</>,
        ]} />

        <H id="isolation" icon={Database}>הפרדה בין לקוחות</H>
        <P>
          כל סביבת עבודה מבודדת. ההפרדה אינה מתבצעת בקוד הדפדפן אלא <strong>בשרת</strong>,
          בכללי הרשאה של Firestore שנאכפים על כל קריאה וכתיבה: משתמש יכול לגשת אך ורק
          לנתוני סביבת העבודה שאליה הוא משויך.
        </P>
        <P>
          זו הבחנה מהותית. הגבלה שנאכפת רק בממשק אפשר לעקוף בכלי פיתוח של הדפדפן;
          הגבלה שנאכפת בשרת — לא. אוספים רגישים מסוימים חסומים לחלוטין בפני כל לקוח
          ונגישים רק לקוד השרת, כפי שמפורט להלן.
        </P>

        <H id="credentials" icon={KeyRound}>סודות והרשאות</H>
        <UL items={[
          <><strong>חיבור לגוגל (Gmail):</strong> ה-refresh token נשמר בצד השרת בלבד, באוסף שחסום
            לכל לקוח ללא יוצא מן הכלל. הדפדפן מקבל אך ורק אסימוני גישה קצרי-מועד. ניתוק
            החיבור מבטל את ההרשאה גם מול Google, ולא רק מוחק אותה אצלנו.</>,
          <><strong>מפתחות API:</strong> נשמרים כ-hash בלבד (SHA-256). מפתח מוצג פעם אחת ביצירה
            ולא ניתן לשחזור — גם לא על ידינו. משמעות הדבר שדליפת בסיס הנתונים אינה מקנה
            גישה ל-API.</>,
          <><strong>מפתחות ספקים חיצוניים:</strong> מוחזקים כמשתני סביבה בצד השרת ואינם נכללים
            בקוד שנשלח לדפדפן.</>,
          <><strong>סשן:</strong> פג אוטומטית לאחר 12 שעות ומחייב התחברות מחדש.</>,
        ]} />

        <H id="payments" icon={CreditCard}>תשלומים</H>
        <P>
          <strong>פרטי כרטיס אשראי לעולם אינם מגיעים לשרתים שלנו.</strong> התשלום מתבצע
          בעמוד מאובטח של ספק הסליקה, שהוא בעל התקנים הנדרשים (PCI DSS). אנחנו מקבלים
          אישור שהתשלום בוצע — ולא את פרטי הכרטיס.
        </P>
        <P>
          הודעה על תשלום מוצלח אינה נלקחת כעובדה: כל הודעה נבדקת מול ה-API של ספק
          הסליקה לפני שהיא משנה משהו בחשבון, וכל מסמך תשלום ניתן לניצול פעם אחת בלבד.
          בלי זה, הודעה מזויפת הייתה יכולה לשדרג חשבון בלי תשלום.
        </P>

        <H id="backups" icon={Database}>גיבויים ושחזור</H>
        <UL items={[
          <><strong>גיבוי יומי אוטומטי</strong> בשעה 03:00 (שעון ישראל), עם שמירה מתגלגלת של 14 יום.</>,
          <><strong>סל מיחזור:</strong> רשומות שנמחקות נשמרות במלואן וניתנות לשחזור.</>,
          <><strong>יומן פעילות:</strong> שינויים ברשומות מתועדים — מי שינה, מה, ומתי.</>,
        ]} />
        <P>
          הגיבוי היומי קיים כי סל מיחזור לבדו אינו מספיק: הוא מכסה מחיקות, אבל לא דריסה
          המונית של רשומות קיימות — מקרה שבו שום דבר לא נמחק ולכן שום דבר לא נכנס לסל.
        </P>

        <H id="access" icon={Eye}>גישה מצידנו</H>
        <P>
          לצוות התמיכה יש גישה טכנית לנתוני סביבות עבודה לצורך תחזוקה ופתרון תקלות.
          איננו קוראים את נתוני הלקוחות שלכם באופן שגרתי, ואיננו משתמשים בהם למטרות
          שיווק, מכירה או אימון מודלים. יכולות ה-AI במערכת שולחות תוכן לספק חיצוני
          (Anthropic) לצורך יצירת התשובה בלבד.
        </P>

        <H id="gaps" icon={AlertTriangle}>מה עדיין לא מיושם</H>
        <P>
          הסעיף הזה קיים מכיוון שמסמך אבטחה שמונה רק יתרונות אינו שימושי למי שבודק
          אותנו ברצינות. נכון להיום:
        </P>
        <UL items={[
          <><strong>אין אימות דו-שלבי (2FA)</strong> לחשבונות המערכת. בתכנון.</>,
          <><strong>אין תעודת SOC 2 או ISO 27001</strong> לחברה עצמה. התשתית שעליה אנחנו רצים
            (Google Cloud) מוסמכת, אך זו הסמכה שלה ולא שלנו.</>,
          <><strong>לא בוצע מבחן חדירה (penetration test)</strong> חיצוני ובלתי תלוי.</>,
          <><strong>אין הסכם רמת שירות (SLA)</strong> מחייב במסלולים הסטנדרטיים.</>,
        ]} />
        <P>
          אם אחד מהסעיפים האלה קריטי עבורכם לפני התקשרות —{' '}
          <a href={`mailto:${SITE_LEGAL.contactEmail}`} className="text-indigo-600 underline">דברו איתנו</a>{' '}
          ונאמר בכנות היכן זה עומד.
        </P>

        <H id="report" icon={AlertTriangle}>דיווח על פרצה</H>
        <P>
          מצאתם חולשת אבטחה? נשמח לשמוע, ולא ננקוט הליכים משפטיים נגד מי שמדווח בתום לב
          ואינו מנצל את החולשה, אינו ניגש למידע של אחרים ואינו משבש את השירות.
        </P>
        <P>
          כתבו ל-
          <a href={`mailto:${SITE_LEGAL.contactEmail}`} className="text-indigo-600 underline font-semibold">
            {SITE_LEGAL.contactEmail}
          </a>{' '}
          עם תיאור ושלבי שחזור. נאשר קבלה תוך 3 ימי עסקים.
        </P>

        <div className="mt-14 pt-8 border-t border-slate-200 text-[13px] leading-relaxed text-slate-500">
          <p>
            <span className="font-bold text-slate-700">{SITE_LEGAL.legalName}</span>
            {' · '}עוסק מורשה {SITE_LEGAL.companyId} · {SITE_LEGAL.address}
          </p>
          <p className="mt-2">
            <a href="/privacy" className="text-indigo-600 underline">מדיניות פרטיות</a>
            {' · '}
            <a href="/terms" className="text-indigo-600 underline">תנאי שימוש ותקנון</a>
            {' · '}
            <a href="/api" className="text-indigo-600 underline">API למפתחים</a>
          </p>
        </div>
      </main>
    </div>
  );
}
