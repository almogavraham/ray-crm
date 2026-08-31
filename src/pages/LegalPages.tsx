/**
 * LegalPages.tsx — privacy policy, terms of use, accessibility statement.
 *
 * Written to describe what this system actually does, not from a template.
 * Where a fact is not yet true — a registered company, an appointed
 * accessibility officer — the line is omitted rather than filled with a
 * plausible-looking placeholder, because a legal page is exactly the document
 * where an invented detail does real damage.
 */

import { useEffect } from 'react';
import { ArrowRight, Mail, Shield, FileText, Accessibility } from 'lucide-react';
import { SITE_LEGAL, hasLegalEntity, telHref } from '../lib/siteLegal';
import { withdrawConsent } from '../lib/consent';

export type LegalDoc = 'privacy' | 'terms' | 'accessibility';

const TITLES: Record<LegalDoc, { title: string; icon: typeof Shield }> = {
  privacy:       { title: 'מדיניות פרטיות',   icon: Shield },
  terms:         { title: 'תנאי שימוש',        icon: FileText },
  accessibility: { title: 'הצהרת נגישות',      icon: Accessibility },
};

/* ── Small typographic helpers, so every document reads the same ───────────── */
const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-black text-slate-900 mt-9 mb-3">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[15px] leading-[1.85] text-slate-700 mb-4">{children}</p>
);
const UL = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="mb-4 space-y-2">
    {items.map((it, i) => (
      <li key={i} className="text-[15px] leading-[1.85] text-slate-700 flex gap-2.5">
        <span className="text-indigo-500 mt-[9px] w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

function Operator() {
  if (!hasLegalEntity()) {
    return (
      <P>
        האתר והשירות מופעלים תחת השם המסחרי <strong>{SITE_LEGAL.brand}</strong> (
        {SITE_LEGAL.site}). לכל פנייה בנושא מסמך זה:{' '}
        <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.privacyEmail}`}>
          {SITE_LEGAL.privacyEmail}
        </a>.
      </P>
    );
  }
  return (
    <P>
      האתר והשירות מופעלים על ידי <strong>{SITE_LEGAL.legalName}</strong>, ח.פ/ע.מ {SITE_LEGAL.companyId}
      {SITE_LEGAL.address ? `, ${SITE_LEGAL.address}` : ''}. לכל פנייה בנושא מסמך זה:{' '}
      <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.privacyEmail}`}>
        {SITE_LEGAL.privacyEmail}
      </a>.
    </P>
  );
}

/* ── Privacy ───────────────────────────────────────────────────────────────── */
function Privacy() {
  return (
    <>
      <Operator />

      <H>מה אנחנו אוספים</H>
      <P>
        אנחנו אוספים רק מידע שנמסר לנו ביוזמתך או שנדרש כדי שהשירות יעבוד. איננו קונים
        מאגרי מידע ואיננו אוספים מידע על גולשים ממקורות חיצוניים.
      </P>
      <UL items={[
        <><strong>טופס יצירת קשר:</strong> שם, טלפון, ואופציונלית אימייל, שם עסק ותוכן ההודעה.</>,
        <><strong>נתוני הפנייה:</strong> כתובת ה-IP שממנה נשלחה הפנייה, סוג הדפדפן, הדף שממנו הגעת
          ופרמטרי קמפיין (UTM) אם היו בכתובת. אלה משמשים למניעת שליחות אוטומטיות ולהבנה אילו
          ערוצי שיווק עובדים.</>,
        <><strong>תיעוד ההסכמה:</strong> נוסח ההסכמה שאישרת והמועד המדויק — כדי שנוכל להוכיח
          שההסכמה ניתנה, כנדרש בחוק.</>,
        <><strong>משתמשים רשומים:</strong> כתובת אימייל, שם, והנתונים שאתה עצמך מזין למערכת
          (לידים, משימות, הערות). המידע הזה שייך לך.</>,
      ]} />

      <H>למה אנחנו משתמשים בו</H>
      <UL items={[
        'כדי לחזור אליך בנוגע לפנייה שלך.',
        'כדי לספק את השירות, לתחזק אותו ולתמוך בך.',
        'כדי להגן על המערכת מפני שימוש לרעה וניסיונות חדירה.',
        'לדיוור שיווקי — רק אם סימנת במפורש שאתה מאשר זאת, ובכל הודעה תהיה אפשרות הסרה.',
      ]} />

      <H>עוגיות</H>
      <P>
        האתר משתמש בעוגיות הכרחיות בלבד — כאלה שמאפשרות התחברות, שמירת העדפות נגישות
        ושפה, ואבטחת הגלישה. בלעדיהן השירות לא יעבוד, ולכן לא ניתן לבטל אותן.
      </P>
      <P>
        כלי מדידה ופרסום (כגון Google Analytics) אינם פועלים באתר כרגע. אם וכאשר יופעלו,
        הם ייטענו <strong>רק</strong> לאחר שתאשר זאת בבאנר העוגיות. אפשר לשנות או לבטל את
        ההסכמה בכל רגע:{' '}
        <button onClick={withdrawConsent} className="text-indigo-600 underline font-semibold">
          ביטול הסכמת העוגיות
        </button>.
      </P>

      <H>עם מי המידע נשמר</H>
      <P>
        המידע מאוחסן בשרתי <strong>Google Firebase</strong> (Google Cloud). שליחת מיילים
        מתבצעת דרך <strong>Resend</strong>, ויכולות ה-AI במערכת פועלות מול <strong>Anthropic</strong>.
        חלק מהספקים הללו מאחסנים או מעבדים מידע מחוץ לישראל, לרבות בארצות הברית ובאיחוד
        האירופי. איננו מוכרים מידע אישי ואיננו מעבירים אותו לצדדים שלישיים לצרכיהם.
      </P>

      <H>כמה זמן המידע נשמר</H>
      <P>
        פניות מטופס יצירת קשר נשמרות כל עוד הן רלוונטיות לקשר העסקי. נתוני חשבון נשמרים
        כל עוד החשבון פעיל. בסגירת חשבון המידע נמחק או מועבר לארכיון מאובטח, למעט מידע
        שאנו חייבים לשמור על פי דין.
      </P>

      <H>הזכויות שלך</H>
      <P>
        על פי חוק הגנת הפרטיות, התשמ״א-1981, אתה רשאי לעיין במידע שנשמר עליך, לבקש את
        תיקונו אם אינו נכון, ולבקש את מחיקתו. בקשה לכל אחת מאלה תישלח אל{' '}
        <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.privacyEmail}`}>
          {SITE_LEGAL.privacyEmail}
        </a>{' '}ותטופל תוך זמן סביר.
      </P>
      <P>
        אם ביקשת להסיר את עצמך מדיוור שיווקי — הבקשה תכובד מיידית, ואין צורך לנמק אותה.
      </P>

      <H>אבטחת מידע</H>
      <P>
        התעבורה לאתר מוצפנת ב-HTTPS. הגישה לנתונים מוגבלת באמצעות כללי הרשאה ברמת
        המשתמש והסביבה, כך שמשתמש יכול לגשת רק לנתוני סביבת העבודה שלו. שום מערכת אינה
        חסינה לחלוטין, ואיננו מתחייבים לאבטחה מוחלטת — אך אנו נוקטים באמצעים המקובלים
        בתעשייה כדי להגן על המידע.
      </P>

      <H>שינויים</H>
      <P>
        מדיניות זו עשויה להתעדכן. תאריך העדכון האחרון מופיע בראש העמוד, ושינוי מהותי
        יוצג באתר.
      </P>
    </>
  );
}

/* ── Terms ─────────────────────────────────────────────────────────────────── */
function Terms() {
  return (
    <>
      <Operator />

      <H>השירות</H>
      <P>
        {SITE_LEGAL.brand} היא מערכת CRM מבוססת ענן לניהול לידים, משימות, אוטומציות
        ותקשורת עם לקוחות. השימוש בשירות כפוף לתנאים אלה. אם אינך מסכים להם — אינך רשאי
        להשתמש בשירות.
      </P>

      <H>החשבון שלך</H>
      <UL items={[
        'אתה אחראי לשמירת סודיות פרטי ההתחברות שלך ולכל פעולה שתתבצע בחשבונך.',
        'אין להשתמש בשירות למטרה בלתי חוקית, לשליחת דואר זבל, או לניסיון לחדור למערכת או לנתוני משתמשים אחרים.',
        'אין להעלות למערכת מידע שאין לך זכות להחזיק בו או להשתמש בו.',
      ]} />

      <H>הנתונים שלך</H>
      <P>
        הנתונים שאתה מזין למערכת נשארים בבעלותך. אנו מעבדים אותם רק כדי לספק לך את
        השירות. אתה אחראי לוודא שיש לך בסיס חוקי להחזיק במידע על הלידים והלקוחות שלך
        ולפנות אליהם — במיוחד לעניין דיוור שיווקי, הכפוף לסעיף 30א לחוק התקשורת
        (בזק ושידורים), התשמ״ב-1982.
      </P>

      <H>שליחת הודעות דרך המערכת</H>
      <P>
        המערכת מאפשרת שליחת מיילים והודעות ללקוחותיך, לרבות באופן אוטומטי. האחריות
        לתוכן ההודעות, ולכך שקיימת הסכמה חוקית לקבלתן, היא שלך בלבד.
      </P>

      <H>זמינות ואחריות</H>
      <P>
        אנו שואפים לזמינות גבוהה אך איננו מתחייבים לשירות רציף וללא תקלות. השירות ניתן
        כמות שהוא (AS IS). איננו אחראים לנזק עקיף, תוצאתי או אובדן רווחים. בכל מקרה,
        גבול האחריות הכולל לא יעלה על הסכום ששילמת עבור השירות בשלושת החודשים שקדמו
        לאירוע.
      </P>
      <P>
        המערכת כוללת יכולות בינה מלאכותית. תוצריהן הם המלצה בלבד, עשויים להיות שגויים,
        וההחלטה העסקית נותרת שלך. אין לראות בהן ייעוץ מקצועי.
      </P>

      <H>תשלומים</H>
      <P>
        המסלולים והמחירים מוצגים בעמוד התמחור. המחירים אינם כוללים מע״מ, והמע״מ יתווסף
        להם בשיעורו על פי דין במועד החיוב. המנוי מתחדש אוטומטית בתום כל תקופת חיוב עד
        לביטולו. חשבונית מס תישלח לכתובת הדוא״ל שנמסרה בעת הרכישה.
      </P>

      <H>תקנון ביטולים</H>
      <P>
        <strong>ביטול מנוי מתמשך.</strong> ניתן לבטל את המנוי בכל עת ובלא דמי ביטול.
        הביטול ייכנס לתוקף בתום תקופת החיוב ששולמה, ולא יבוצע חיוב נוסף לאחריה. הגישה
        לחשבון תישמר עד תום אותה תקופה.
      </P>
      <P>
        <strong>זכות ביטול על פי חוק.</strong> העסקה היא עסקת מכר מרחוק כמשמעה בחוק
        הגנת הצרכן, התשמ״א-1981. ניתן לבטל אותה בתוך 14 ימים ממועד ביצוע העסקה או ממועד
        קבלת מסמך פרטי העסקה, לפי המאוחר. עבור אדם עם מוגבלות, אזרח ותיק או עולה חדש —
        בתוך ארבעה חודשים ממועדים אלה, ובלבד שההתקשרות כללה שיחה בין הצדדים.
      </P>
      <P>
        <strong>איך מבטלים.</strong> בהודעה לכתובת{' '}
        <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.contactEmail}`}>
          {SITE_LEGAL.contactEmail}
        </a>{' '}
        או בטלפון{' '}
        <a className="text-indigo-600 underline" href={telHref()} dir="ltr">{SITE_LEGAL.phone}</a>.
        יש לציין שם ופרטי התקשרות המאפשרים לזהות את החשבון. אישור על קבלת הודעת הביטול
        יישלח בדוא״ל.
      </P>
      <P>
        <strong>החזר כספי.</strong> החזר יבוצע בתוך 14 ימים ממועד קבלת הודעת הביטול,
        באותו אמצעי תשלום שבו בוצעה העסקה. בביטול לפי זכות הביטול שבחוק רשאים אנו לגבות
        דמי ביטול בשיעור של עד 5% ממחיר העסקה או 100 ש״ח, לפי הנמוך מביניהם.
      </P>
      <P>
        <strong>המידע שלך לאחר ביטול.</strong> נתוני החשבון יישמרו 30 ימים לאפשר חידוש,
        ולאחר מכן יימחקו. ניתן לבקש מחיקה מיידית או ייצוא של הנתונים בפנייה ל-
        <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.privacyEmail}`}>
          {SITE_LEGAL.privacyEmail}
        </a>.
      </P>

      <H>דין וסמכות שיפוט</H>
      <P>
        על תנאים אלה יחולו דיני מדינת ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט
        המוסמכים במחוז תל אביב.
      </P>
    </>
  );
}

/* ── Accessibility statement ───────────────────────────────────────────────── */
function AccessibilityStatement() {
  return (
    <>
      <P>
        אנו רואים בנגישות האתר חלק מהותי מהשירות, ופועלים כדי שכל אדם יוכל לגלוש בו
        בעצמאות ובנוחות, לרבות אנשים עם מוגבלות.
      </P>

      <H>רמת הנגישות</H>
      <P>
        האתר הונגש בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
        התשע״ג-2013, ולתקן הישראלי ת״י 5568 המבוסס על הנחיות <strong>WCAG 2.0 ברמה AA</strong>.
      </P>

      <H>מה הונגש בפועל</H>
      <UL items={[
        'ניווט מלא במקלדת, עם סימון ברור של הפריט שבפוקוס.',
        'קישור "דלג לתוכן הראשי" בתחילת הדף.',
        'מבנה כותרות היררכי ותיאורי ARIA לרכיבים אינטראקטיביים.',
        'תמיכה בקוראי מסך, כולל הודעות שגיאה בטופס שמוקראות בעת הופעתן.',
        'תפריט נגישות קבוע: הגדלת טקסט, ניגודיות גבוהה, גוון שחור-לבן, הדגשת קישורים, גופן קריא, וביטול אנימציות.',
        'כיבוד העדפת מערכת ההפעלה לצמצום תנועה (prefers-reduced-motion).',
        'ניגודיות צבעים העומדת בדרישות התקן בטקסט ובכפתורים.',
      ]} />

      <H>מגבלות ידועות</H>
      <P>
        ייתכנו דפים או רכיבים שטרם הונגשו במלואם, וכן תכנים של צד שלישי שאינם בשליטתנו.
        אנו ממשיכים לתקן ולשפר. אם נתקלת בקושי — נשמח שתדווח, וזה יטופל.
      </P>

      <H>פניות בנושא נגישות</H>
      <P>
        {SITE_LEGAL.accessibilityOfficer
          ? <>רכז/ת הנגישות: <strong>{SITE_LEGAL.accessibilityOfficer}</strong>. </>
          : null}
        ניתן לפנות בכל נושא הקשור לנגישות האתר בכתובת{' '}
        <a className="text-indigo-600 underline" href={`mailto:${SITE_LEGAL.accessibilityEmail}`}>
          {SITE_LEGAL.accessibilityEmail}
        </a>. נשתדל להשיב ולטפל בהקדם.
      </P>
    </>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────────── */
export default function LegalPages({ doc }: { doc: LegalDoc }) {
  const { title, icon: Icon } = TITLES[doc];

  useEffect(() => { document.title = `${title} · ${SITE_LEGAL.brand}`; }, [title]);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <a href="#legal-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50
                   focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
        דלג לתוכן הראשי
      </a>

      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            חזרה לאתר <ArrowRight size={15} />
          </a>
          <span className="font-black text-slate-900">{SITE_LEGAL.brand}</span>
        </div>
      </header>

      <main id="legal-content" className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Icon size={18} className="text-indigo-600" />
          </span>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
        </div>
        <p className="text-sm text-slate-500 mb-8">עודכן לאחרונה: {SITE_LEGAL.updated}</p>

        {doc === 'privacy' && <Privacy />}
        {doc === 'terms' && <Terms />}
        {doc === 'accessibility' && <AccessibilityStatement />}

        <div className="mt-12 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-4 text-sm">
          <a href="/privacy" className="text-indigo-600 hover:underline">מדיניות פרטיות</a>
          <a href="/terms" className="text-indigo-600 hover:underline">תנאי שימוש</a>
          <a href="/accessibility" className="text-indigo-600 hover:underline">הצהרת נגישות</a>
          <a href={`mailto:${SITE_LEGAL.contactEmail}`}
            className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5">
            <Mail size={13} /> {SITE_LEGAL.contactEmail}
          </a>
        </div>
      </main>
    </div>
  );
}
