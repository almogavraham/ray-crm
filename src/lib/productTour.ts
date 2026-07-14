/**
 * productTour.ts
 *
 * Interactive onboarding tour built on driver.js.
 * Highlights real UI elements — both in the sidebar AND inside individual
 * pages — guiding the user step-by-step in Hebrew. Steps that target in-page
 * elements navigate to that page first (via the `navigate` callback), wait for
 * the element to render, then highlight it.
 *
 * Sidebar anchors live in Layout.tsx; in-page anchors live in the page
 * components (Dashboard, Kanban, HomeDashboard, Settings) as `data-tour="..."`.
 */

import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const TOUR_DONE_KEY = 'ray-product-tour-done';

type NavigateFn = (page: string) => void;

interface TourStep extends DriveStep {
  /** Page to navigate to before this step is shown (for in-page anchors). */
  navTo?: string;
}

interface TourOptions {
  navigate?: NavigateFn;
  /** Page to return to when the tour ends. */
  returnTo?: string;
}

/* ── RTL styling for the driver.js popover (one-time injection) ───────────── */
let stylesInjected = false;
function injectRtlStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .ray-tour-popover { direction: rtl; text-align: right; font-family: inherit; }
    .ray-tour-popover .driver-popover-title { font-size: 16px; font-weight: 800; }
    .ray-tour-popover .driver-popover-description { font-size: 13px; line-height: 1.6; }
    .ray-tour-popover .driver-popover-footer button { font-weight: 600; border-radius: 8px; }
    .ray-tour-popover .driver-popover-next-btn {
      background: linear-gradient(135deg,#8b5cf6,#6366f1) !important;
      color: #fff !important; text-shadow: none !important; border: none !important;
    }
  `;
  document.head.appendChild(style);
}

/* Wait until a selector exists in the DOM (or timeout). */
function waitForSelector(sel: string, timeout = 3500): Promise<Element | null> {
  return new Promise(resolve => {
    const found = document.querySelector(sel);
    if (found) return resolve(found);
    const t0 = Date.now();
    const iv = setInterval(() => {
      const el = document.querySelector(sel);
      if (el || Date.now() - t0 > timeout) { clearInterval(iv); resolve(el); }
    }, 100);
  });
}

/* All possible steps in narrative order. */
function allSteps(): TourStep[] {
  return [
    {
      popover: {
        title: '👋 ברוכים הבאים למערכת!',
        description: 'בוא נעשה סיור קצר ביחד — נעבור בין המסכים החשובים ואסביר לך איך לעבוד עם כל אחד מהם. זה ייקח כדקה.',
        align: 'center',
      },
    },
    {
      element: '[data-tour="nav-home"]',
      popover: { title: '📊 לוח הבקרה', description: 'המסך הראשי שלך. בוא נראה מה יש בו.', side: 'left', align: 'start' },
    },
    {
      navTo: 'home',
      element: '[data-tour="home-kpi-cards"]',
      popover: { title: '📈 המספרים החשובים', description: 'כאן תראה במבט אחד: סך הלידים, לקוחות פעילים, משימות פתוחות ושווי הפייפליין. התמונה המלאה של העסק.', side: 'bottom', align: 'center' },
    },
    {
      element: '[data-tour="nav-dashboard"]',
      popover: { title: '👥 ניהול לידים', description: 'כל הלידים שלך במקום אחד. נכנס לראות.', side: 'left', align: 'start' },
    },
    {
      navTo: 'dashboard',
      element: '[data-tour="dashboard-search-filters"]',
      popover: { title: '🔍 חיפוש וסינון', description: 'מצא כל ליד בשנייה — חפש לפי שם, סנן לפי סטטוס, מקור או תאריך. ככה אתה שולט בכמות גדולה של לידים בקלות.', side: 'bottom', align: 'center' },
    },
    {
      element: '[data-tour="new-lead"]',
      popover: { title: '➕ הוספת ליד חדש', description: 'הכפתור הכי חשוב! לחץ כאן בכל פעם שתרצה להוסיף ליד חדש — ידנית או דרך ייבוא.', side: 'left', align: 'start' },
    },
    {
      element: '[data-tour="nav-kanban"]',
      popover: { title: '🔀 פייפליין מכירות', description: 'לוח ויזואלי לניהול תהליך המכירה. נכנס להציץ.', side: 'left', align: 'start' },
    },
    {
      navTo: 'kanban',
      element: '[data-tour="kanban-board-columns"]',
      popover: { title: '🎯 גרור בין השלבים', description: 'כל עמודה היא שלב במכירה (פנייה ראשונה → פגישה → הצעה → סגירה). פשוט גרור כרטיס ליד מעמודה לעמודה ככל שהעסקה מתקדמת.', side: 'top', align: 'center' },
    },
    {
      element: '[data-tour="nav-marketing-agent"]',
      popover: { title: '📣 סוכן שיווק AI', description: 'צור תוכן שיווקי, תמונות, סרטונים ומצגות בעזרת בינה מלאכותית — הכל מותאם לעסק שלך.', side: 'left', align: 'start' },
    },
    {
      element: '[data-tour="nav-ai"]',
      popover: { title: '✨ עוזר ה-AI', description: 'העוזר החכם שלך. שאל אותו כל שאלה על הלידים, בקש ניתוחים, או קבל המלצות לפעולה הבאה.', side: 'left', align: 'start' },
    },
    {
      element: '[data-tour="nav-email-agent"]',
      popover: { title: '📧 סוכן מכירות AI', description: 'סוכן שמנהל עבורך תכתובות מייל עם לידים — עונה, עוקב ומקדם עסקאות באופן אוטומטי.', side: 'left', align: 'start' },
    },
    {
      element: '[data-tour="nav-settings"]',
      popover: { title: '⚙️ הגדרות', description: 'התאם את המערכת לעסק שלך. נכנס לראות מה אפשר להגדיר.', side: 'left', align: 'start' },
    },
    {
      navTo: 'settings',
      element: '[data-tour="settings-navigation"]',
      popover: { title: '🛠️ מרכז ההגדרות', description: 'כאן מגדירים הכל: פרופיל, מראה, התראות, צוות ואינטגרציות. כדאי להתחיל מכאן ולהתאים את המערכת אליך.', side: 'left', align: 'start' },
    },
    {
      element: '[data-tour="help-button"]',
      popover: { title: '❓ רוצה לחזור על הסיור?', description: 'בכל רגע תוכל ללחוץ כאן כדי להריץ את הסיור הזה שוב. עכשיו אתה מוכן להתחיל — בהצלחה! 🚀', side: 'bottom', align: 'end' },
    },
  ];
}

/* Keep steps we can actually show: in-page (navTo) steps need a navigate fn;
   sidebar/center steps need their element present (or no element). */
function visibleSteps(navigate?: NavigateFn): TourStep[] {
  return allSteps().filter(s => {
    if (s.navTo) return !!navigate;
    if (!s.element) return true;
    return !!document.querySelector(s.element as string);
  });
}

/** Run the tour now. */
export function startProductTour(opts: TourOptions = {}) {
  const { navigate, returnTo } = opts;
  injectRtlStyles();
  const steps = visibleSteps(navigate);
  if (steps.length === 0) return;

  // driver.js can leave a stale `driver-active-element` class on a previously
  // highlighted node when the page re-renders mid-tour (navigation). Strip any
  // stray copies so only the current step's element stays raised above the overlay.
  const stripStaleActive = () =>
    document.querySelectorAll('.driver-active-element')
      .forEach(e => e.classList.remove('driver-active-element'));

  const goToStepTarget = async (index: number) => {
    const step = steps[index];
    if (step?.navTo && navigate) {
      navigate(step.navTo);
      if (step.element) await waitForSelector(step.element as string);
    }
    stripStaleActive();
  };

  // Single idempotent finish handler — runs once no matter how the tour ends
  // (Done button, X, Esc, or overlay click).
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stripStaleActive();
    localStorage.setItem(TOUR_DONE_KEY, '1');
    if (returnTo && navigate) navigate(returnTo);
  };

  const driverObj = driver({
    showProgress: true,
    progressText: 'שלב {{current}} מתוך {{total}}',
    nextBtnText: 'הבא →',
    prevBtnText: '← הקודם',
    doneBtnText: 'סיום ✓',
    popoverClass: 'ray-tour-popover',
    overlayColor: '#0f172a',
    overlayOpacity: 0.75,
    steps,
    onNextClick: async () => {
      const i = driverObj.getActiveIndex() ?? 0;
      if (i >= steps.length - 1) { finish(); driverObj.destroy(); return; } // "Done"
      await goToStepTarget(i + 1);
      driverObj.moveNext();
    },
    onPrevClick: async () => {
      const i = driverObj.getActiveIndex() ?? 0;
      await goToStepTarget(i - 1);
      driverObj.movePrevious();
    },
    onCloseClick: () => { finish(); driverObj.destroy(); }, // X button
    onDestroyed: () => { finish(); },                       // Esc / overlay / any path
  });
  driverObj.drive();
}

/**
 * Run the tour automatically the first time only.
 * Waits a moment so the layout/sidebar is mounted before targeting elements.
 */
export function maybeAutoStartTour(opts: TourOptions = {}) {
  if (localStorage.getItem(TOUR_DONE_KEY) === '1') return;
  localStorage.setItem(TOUR_DONE_KEY, '1'); // mark first so it never double-fires
  setTimeout(() => startProductTour(opts), 800);
}
