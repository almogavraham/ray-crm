/**
 * mediaEngines.ts — the image and video engines, as the client sees them.
 *
 * The catalogue (what exists, what each is good for, how to get a key) lives
 * here once and feeds two screens: the admin Integrations page, which shows
 * every engine with setup instructions and a test button, and the marketing
 * chat, which shows the engine in use and lets the user switch among the ones
 * the admin has actually connected.
 *
 * No key ever reaches this file. The server (functions/mediaEngines.js) holds
 * them; the client learns only which engines are configured, as booleans, and
 * asks the server to generate by engine name.
 *
 * The user's choice of engine is a preference about their own output, kept
 * per workspace in localStorage — like a default font, not a team setting.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type EngineKind = 'image' | 'video';
export type EngineId = 'pollinations' | 'imagen' | 'dalle' | 'ideogram' | 'veo' | 'kling' | 'runway';
export type MediaAspect = '1:1' | '16:9' | '9:16';

export interface KeyField {
  /** Field name as stored server-side. */
  name: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

export interface EngineDef {
  id: EngineId;
  kind: EngineKind;
  label: string;
  vendor: string;
  /** One line the user reads to decide: what is this engine good for. */
  bestFor: string;
  /** Honest cost note — free tier, per-image price, billing gotchas. */
  cost: string;
  /** Where the key is minted. */
  keyUrl?: string;
  keyFields: KeyField[];
  /** Numbered, concrete steps. Written for someone who has never opened the console. */
  steps: string[];
  /** Things that bite after the key is pasted. */
  caveats?: string[];
  color: string;
}

export const ENGINES: EngineDef[] = [
  {
    id: 'pollinations', kind: 'image', label: 'Pollinations', vendor: 'Pollinations.ai',
    bestFor: 'תמונות מהירות לפוסטים יומיומיים. עובד מיד, בלי חשבון.',
    cost: 'חינם. בלי מפתח, בלי חיוב. לעיתים השרת עמוס והמערכת מנסה שוב לבד.',
    keyFields: [],
    steps: ['אין מה להגדיר — המנוע פעיל תמיד ומשמש כברירת מחדל כשאין מנוע אחר.'],
    caveats: ['איכות טובה אך לא מושלמת בטקסט בתוך תמונה ובפנים אנושיות.', 'אין SLA — כלי חינמי, לא לקמפיין ששעת הפרסום שלו קריטית.'],
    color: '#f59e0b',
  },
  {
    id: 'imagen', kind: 'image', label: 'Google Imagen 4', vendor: 'Google AI Studio',
    bestFor: 'תמונות ריאליסטיות באיכות גבוהה, מוצרים, אנשים, סצנות. הבחירה לפרסום ממומן.',
    cost: 'תשלום לפי תמונה (סנטים בודדים). דורש חיוב פעיל בפרויקט Google Cloud — בלי כרטיס המפתח יחזיר "credits depleted".',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyFields: [{ name: 'google', label: 'Google AI Studio API Key', placeholder: 'AIza…', secret: true }],
    steps: [
      'היכנס ל-aistudio.google.com עם חשבון Google.',
      'בתפריט השמאלי לחץ "Get API key" ← "Create API key".',
      'בחר "Create API key in new project" (או פרויקט קיים אם יש לך). המפתח מתחיל ב-AIza.',
      'הפעל חיוב: console.cloud.google.com ← Billing ← קשר כרטיס לפרויקט שבו נוצר המפתח. Imagen ו-Veo לא עובדים על השכבה החינמית.',
      'הדבק את המפתח כאן, שמור, ולחץ "בדוק חיבור".',
    ],
    caveats: ['אותו מפתח משמש גם את Veo (וידאו) — אין צורך במפתח נפרד.', 'אם הבדיקה עוברת אבל היצירה נכשלת ב-"not found" — Imagen עדיין לא מופעל בפרויקט; נסה שוב אחרי כמה דקות או פתח את הדף Imagen ב-AI Studio פעם אחת.'],
    color: '#4285f4',
  },
  {
    id: 'dalle', kind: 'image', label: 'DALL·E 3', vendor: 'OpenAI',
    bestFor: 'אילוסטרציות, סגנון גרפי, קונספטים מופשטים. מבין פרומפטים מורכבים היטב.',
    cost: 'כ-$0.04 לתמונה סטנדרטית 1024×1024, כ-$0.08 ל-HD. נדרש קרדיט מראש בחשבון OpenAI (נפרד ממנוי ChatGPT).',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyFields: [{ name: 'openai', label: 'OpenAI API Key', placeholder: 'sk-…', secret: true }],
    steps: [
      'היכנס ל-platform.openai.com (זה לא ChatGPT — זו פלטפורמת ה-API).',
      'Settings ← Billing ← "Add payment details" וטען קרדיט התחלתי ($5–$10 מספיק לעשרות תמונות).',
      'API keys ← "Create new secret key" ← תן שם (למשל RAY CRM) ← Create.',
      'העתק את המפתח מיד — הוא מוצג פעם אחת בלבד. מתחיל ב-sk-.',
      'הדבק כאן, שמור, ולחץ "בדוק חיבור".',
    ],
    caveats: ['מנוי ChatGPT Plus לא מכסה את זה — צריך קרדיט בפלטפורמת ה-API.', 'DALL·E מסנן פרומפטים עם שמות מותגים ואנשים אמיתיים.'],
    color: '#10b981',
  },
  {
    id: 'ideogram', kind: 'image', label: 'Ideogram 2', vendor: 'Ideogram',
    bestFor: 'תמונות עם טקסט קריא בתוכן — כותרות, לוגו, באנרים. המנוע היחיד שמאיית נכון.',
    cost: 'תשלום לפי שימוש דרך API (כ-$0.08 לתמונה). נדרש חשבון עם קרדיט API — נפרד מהמנוי לאתר.',
    keyUrl: 'https://ideogram.ai/manage-api',
    keyFields: [{ name: 'ideogram', label: 'Ideogram API Key', placeholder: 'ideogram_…', secret: true }],
    steps: [
      'היכנס ל-ideogram.ai והירשם.',
      'פתח ideogram.ai/manage-api ← "Add credits" וטען קרדיט API.',
      '"Generate API key" ← העתק.',
      'הדבק כאן, שמור, ולחץ "בדוק חיבור".',
    ],
    caveats: ['הטקסט צריך להיכתב בפרומפט באנגלית ובמירכאות: a poster with the text "SALE 50%".', 'עברית בתוך תמונה עדיין לא אמינה באף מנוע — כולל זה.'],
    color: '#8b5cf6',
  },
  {
    id: 'veo', kind: 'video', label: 'Google Veo 3', vendor: 'Google AI Studio',
    bestFor: 'סרטוני 8 שניות ריאליסטיים עם תנועה טבעית, כולל סאונד. לסטורי, רילס ומודעות.',
    cost: 'יקר יחסית — כ-$0.35–0.75 לשנייה לפי מודל. דורש חיוב פעיל בפרויקט. סרטון אחד יכול לעלות $3–6.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyFields: [{ name: 'google', label: 'Google AI Studio API Key', placeholder: 'AIza…', secret: true }],
    steps: [
      'אותו מפתח של Imagen — אם הגדרת אותו, Veo כבר מחובר.',
      'ודא שהחיוב פעיל בפרויקט (console.cloud.google.com ← Billing).',
      'לחץ "בדוק חיבור" כאן. יצירה ראשונה יכולה להיכשל ב-"not found" עד שהמודל מופעל בפרויקט — נסה שוב אחרי דקה.',
    ],
    caveats: ['היצירה לוקחת 1–3 דקות. הצ\'אט ממתין ומדווח.', 'מסנן הבטיחות של Google חוסם אנשים אמיתיים, אלימות ומותגים. אם נחסם — שנה את הפרומפט.'],
    color: '#0ea5e9',
  },
  {
    id: 'kling', kind: 'video', label: 'Kling 1.x', vendor: 'Kuaishou (klingai.com)',
    bestFor: 'סרטוני 5–10 שניות במחיר סביר, טוב לתנועת מוצר ולסצנות. נפוץ בשיווק ברשתות.',
    cost: 'תשלום בקרדיטים (כ-$0.1–0.3 לסרטון 5 שניות במצב std). קונים חבילות מראש.',
    keyUrl: 'https://klingai.com/global/dev',
    keyFields: [
      { name: 'klingAccessKey', label: 'Access Key (AK)', placeholder: 'AK…', secret: true },
      { name: 'klingSecretKey', label: 'Secret Key (SK)', placeholder: 'SK…', secret: true },
    ],
    steps: [
      'היכנס ל-klingai.com ← פינה ימנית עליונה ← "API" (או klingai.com/global/dev).',
      'הירשם למפתחים (חשבון עסקי) ורכוש חבילת קרדיטים ל-API — היא נפרדת מקרדיטים של האתר.',
      '"API Keys" ← "Create" ← תקבל שני ערכים: Access Key ו-Secret Key. העתק את שניהם.',
      'הדבק את שניהם כאן, שמור, ולחץ "בדוק חיבור".',
    ],
    caveats: ['שני המפתחות חובה — עם אחד בלבד המנוע לא יופיע כמחובר.', 'סרטון לוקח 2–5 דקות. הצ\'אט סוקר את המצב ומודיע כשמוכן.'],
    color: '#ec4899',
  },
  {
    id: 'runway', kind: 'video', label: 'Runway Gen-3', vendor: 'Runway',
    bestFor: 'הנפשת תמונה קיימת לסרטון (image-to-video) — לוקח תמונת מוצר ומזיז אותה. גם טקסט-לוידאו.',
    cost: 'קרדיטים מראש (כ-$0.05 לשנייה ב-Gen-3 Turbo; סרטון 5 שניות ≈ $0.25). חשבון API נפרד מהאפליקציה.',
    keyUrl: 'https://dev.runwayml.com/',
    keyFields: [{ name: 'runway', label: 'Runway API Key', placeholder: 'key_…', secret: true }],
    steps: [
      'היכנס ל-dev.runwayml.com (פורטל המפתחים — נפרד מ-app.runwayml.com).',
      'צור ארגון (Organization) וטען קרדיטים ב-Billing.',
      'API Keys ← "New API key" ← העתק. מתחיל ב-key_.',
      'הדבק כאן, שמור, ולחץ "בדוק חיבור" — הבדיקה גם מציגה כמה קרדיטים נשארו.',
    ],
    caveats: ['הכי טוב כשנותנים לו תמונה: "הנפש את התמונה הזו" מהצ\'אט אחרי שיצרת או העלית תמונה.'],
    color: '#14b8a6',
  },
];

export const ENGINE_BY_ID: Record<string, EngineDef> = Object.fromEntries(ENGINES.map(e => [e.id, e]));

/* ── Status ───────────────────────────────────────────────────────────────── */

export type EngineStatus = Record<EngineId, boolean>;

export async function fetchEngineStatus(): Promise<EngineStatus> {
  const fn = httpsCallable<object, { engines: EngineStatus }>(functions, 'mediaEngineStatus');
  return (await fn({})).data.engines;
}

/** Engines of a kind the admin has connected, Pollinations always included for images. */
export function connectedEngines(status: EngineStatus | null, kind: EngineKind): EngineDef[] {
  return ENGINES.filter(e => e.kind === kind && (status?.[e.id] ?? e.id === 'pollinations'));
}

/* ── Preference (per workspace, this browser) ─────────────────────────────── */

const prefKey = (wid: string, kind: EngineKind) => `ray:media-engine:${wid || 'default'}:${kind}`;

export function getPreferredEngine(wid: string, kind: EngineKind, status: EngineStatus | null): EngineId | null {
  const available = connectedEngines(status, kind);
  if (!available.length) return null;
  try {
    const saved = localStorage.getItem(prefKey(wid, kind)) as EngineId | null;
    if (saved && available.some(e => e.id === saved)) return saved;
  } catch { /* private mode */ }
  // Prefer a paid, higher-quality engine when one is connected; otherwise the free one.
  return (available.find(e => e.id !== 'pollinations') ?? available[0]).id;
}

export function setPreferredEngine(wid: string, kind: EngineKind, id: EngineId): void {
  try { localStorage.setItem(prefKey(wid, kind), id); } catch { /* private mode */ }
}

/* ── Generation ───────────────────────────────────────────────────────────── */

interface GenResult { url?: string; taskId?: string; engine: EngineId; model?: string; charged?: number; currency?: 'ILS' | 'USD' }

export async function generateImageWith(
  engine: EngineId, prompt: string, aspect: MediaAspect, workspaceId: string,
): Promise<{ url: string; model?: string; charged?: number; currency?: 'ILS' | 'USD' }> {
  const fn = httpsCallable<object, GenResult>(functions, 'generateMedia');
  const r = (await fn({ engine, prompt, aspect, workspaceId })).data;
  if (!r.url) throw new Error('המנוע לא החזיר תמונה');
  return { url: r.url, model: r.model, charged: r.charged, currency: r.currency };
}

/**
 * Start a video and wait for it. Kling and Runway hand back a task that is
 * polled; Veo is waited on server-side (its handle is tied to the key).
 */
export async function generateVideoWith(
  engine: EngineId, prompt: string, aspect: MediaAspect, workspaceId: string,
  opts: { duration?: 5 | 10; imageUrl?: string; onStage?: (s: string) => void } = {},
): Promise<{ url: string; thumbnailUrl?: string; charged?: number; currency?: 'ILS' | 'USD' }> {
  const gen = httpsCallable<object, GenResult>(functions, 'generateMedia');
  opts.onStage?.('שולח למנוע…');
  const r = (await gen({ engine, prompt, aspect, workspaceId, duration: opts.duration ?? 5, imageUrl: opts.imageUrl })).data;
  if (r.url) return { url: r.url, charged: r.charged, currency: r.currency };
  if (!r.taskId) throw new Error('המנוע לא החזיר משימה');

  const poll = httpsCallable<object, { status: string; url?: string; thumbnailUrl?: string; message?: string; progress?: number; charged?: number; currency?: 'ILS' | 'USD' }>(functions, 'mediaTaskStatus');
  const started = Date.now();
  // Up to 6 minutes; video engines routinely take 2–4.
  while (Date.now() - started < 6 * 60_000) {
    await new Promise(res => setTimeout(res, 8000));
    const s = (await poll({ engine, taskId: r.taskId, workspaceId })).data;
    if (s.status === 'done' && s.url) return { url: s.url, thumbnailUrl: s.thumbnailUrl, charged: s.charged, currency: s.currency };
    if (s.status === 'failed') throw new Error(s.message || 'המנוע נכשל');
    const secs = Math.round((Date.now() - started) / 1000);
    opts.onStage?.(`מייצר וידאו… ${secs}s${s.progress ? ` · ${Math.round(Number(s.progress) * 100)}%` : ''}`);
  }
  throw new Error('הסרטון לא הושלם תוך 6 דקות');
}

/* ── Admin ────────────────────────────────────────────────────────────────── */

export async function saveMediaKeys(keys: Record<string, string | null>): Promise<string[]> {
  const fn = httpsCallable<object, { saved: string[] }>(functions, 'saveMediaKeys');
  return (await fn({ keys })).data.saved;
}

export async function testEngine(engine: EngineId): Promise<{ ok: boolean; message: string }> {
  const fn = httpsCallable<object, { ok: boolean; message: string }>(functions, 'testMediaEngine');
  return (await fn({ engine })).data;
}
