/**
 * voiceCompose.ts — speak an email, get a professional one; and learn the
 * emails this user actually writes.
 *
 * Two capabilities, one hard rule between them: **the model may rewrite what
 * was said, never add to it.** Dictation is used when someone is in a hurry,
 * which is exactly when they will skim the draft and press send. A model that
 * helpfully fills in a price, a delivery date or a meeting time that was never
 * spoken produces an email that reads perfectly and commits the business to
 * something it never agreed to. Every prompt here is built around forbidding
 * that, and the UI shows the draft before anything is sent.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { getAnthropicProxy } from './anthropicClient';
import { searchEmails } from './gmailAgent';
import type { EmailAgentConfig } from '../types';

export interface ComposedEmail { subject: string; body: string }

/** One email the user is seen to send regularly, offered back as a starting point. */
export interface SuggestedEmail {
  id: string;
  /** What this email is, in the user's own terms. */
  title: string;
  /** The situation that triggers it — shown so a suggestion is never a mystery. */
  whenToUse: string;
  subject: string;
  body: string;
  /** Roughly how many of the sampled emails looked like this one. */
  seenTimes: number;
}

export interface StyleLearning {
  /** Prose description of how this person writes, fed back into composition. */
  styleProfile: string;
  suggestions: SuggestedEmail[];
  learnedAt: number;
  /** How many sent emails the description is based on — the honest sample size. */
  sampleCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (resp: any): string =>
  (resp?.content?.find((b: any) => b.type === 'text') as any)?.text?.trim() ?? '';

/**
 * Field-delimited parsing instead of JSON.
 *
 * An email body is multi-paragraph by nature, and asking a model to place one
 * inside a JSON string reliably produces raw newlines inside that string —
 * which is invalid JSON, so the whole response is lost even though the content
 * was perfect. Delimiters have no escaping rules to get wrong.
 */
function field(raw: string, name: string): string {
  const m = raw.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'mi'));
  return m ? m[1].trim() : '';
}

/** Everything after a `NAME:` line, up to the next delimiter line or the end. */
function block(raw: string, name: string, stopAt: RegExp): string {
  const start = raw.match(new RegExp(`^${name}:[ \\t]*$`, 'mi'));
  if (!start || start.index === undefined) return '';
  const rest = raw.slice(start.index + start[0].length).replace(/^\r?\n/, '');
  const stop = rest.search(stopAt);
  return (stop < 0 ? rest : rest.slice(0, stop)).trim();
}

const FIDELITY_RULE = `
כלל ברזל — נאמנות לתוכן:
• אתה מנסח מחדש רק את מה שנאמר. אסור לך להוסיף שום עובדה שלא נאמרה במפורש:
  לא מחירים, לא תאריכים, לא שעות, לא כמויות, לא שמות, ולא התחייבויות.
• אם משהו חסר כדי שהמייל יהיה שלם — פשוט אל תכתוב אותו. עדיף מייל קצר
  מאשר מייל שמבטיח דבר שלא נאמר.
• אל תמציא נימוסים שמשנים משמעות ("אשמח לעדכן עד יום חמישי") אם לא נאמרו.
• מותר ורצוי: לתקן שגיאות זיהוי דיבור, לפסק, לארגן לפסקאות, לשפר ניסוח
  ולהתאים לטון עסקי.`.trim();

/**
 * Turn a spoken transcript into a finished email.
 * The caller must show the result for review before sending it anywhere.
 */
export async function composeFromSpeech(params: {
  transcript: string;
  config?: EmailAgentConfig | null;
  recipientName?: string;
  recipientCompany?: string;
  /** Anything known about the recipient — status, past notes, solutions. */
  context?: string;
  /** The learned voice of this user, when available. */
  styleProfile?: string;
  /** Rewrite an existing draft instead of starting fresh. */
  previous?: ComposedEmail;
  /** Free-text change request, e.g. "קצר יותר", "פחות רשמי". */
  instruction?: string;
}): Promise<ComposedEmail> {
  const { transcript, config, recipientName, recipientCompany, context,
          styleProfile, previous, instruction } = params;

  const said = transcript.trim();
  if (!said && !instruction) throw new Error('אין תוכן — הקלט או כתוב מה לשלוח');

  const system = [
    `אתה כותב מיילים עסקיים בעברית עבור ${config?.agentName || 'נציג מכירות'}`
      + (config?.agentRole ? ` (${config.agentRole})` : '') + '.',
    config?.businessDescription ? `רקע על העסק: ${config.businessDescription}` : '',
    config?.agentInstructions ? `הנחיות: ${config.agentInstructions}` : '',
    styleProfile
      ? `כתוב בסגנון האישי של המשתמש, כפי שנלמד מהמיילים שהוא שולח בפועל:\n${styleProfile}`
      : 'כתוב בטון עסקי, חם ותכליתי. משפטים קצרים, בלי מליצות.',
    FIDELITY_RULE,
    'החזר בדיוק בפורמט הזה, בלי שום טקסט לפני או אחרי:',
    'SUBJECT: <שורת הנושא>',
    'BODY:',
    '<גוף המייל, כמה פסקאות שצריך>',
    'גוף המייל בטקסט רגיל. בלי HTML, בלי Markdown, ובלי JSON.',
    config?.signature ? `סיים בחתימה:\n${config.signature}` : '',
  ].filter(Boolean).join('\n\n');

  const parts: string[] = [];
  if (recipientName || recipientCompany) {
    parts.push(`הנמען: ${[recipientName, recipientCompany].filter(Boolean).join(' — ')}`);
  }
  if (context) parts.push(`מה שידוע על הנמען (רקע בלבד, לא להעתיק למייל):\n${context}`);
  if (previous) {
    parts.push(`הטיוטה הנוכחית:\nנושא: ${previous.subject}\n\n${previous.body}`);
    parts.push(`בקשת השינוי: ${instruction || said}`);
  } else {
    parts.push(`מה שהמשתמש הכתיב:\n"""\n${said}\n"""`);
    if (instruction) parts.push(`הנחיה נוספת: ${instruction}`);
  }

  const anthropic = getAnthropicProxy();
  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  const raw = textOf(resp);
  const subject = field(raw, 'SUBJECT');
  const body = block(raw, 'BODY', /^SUBJECT:/m);
  if (!body) {
    // Log what came back. The previous version failed opaquely, which left
    // neither the user nor us anything to act on.
    console.error('[voiceCompose] unparsable compose response:', raw.slice(0, 400));
    throw new Error('לא הצלחתי לנסח את המייל — נסה שוב או נסח מחדש בקול');
  }
  return { subject: subject.trim(), body: body.trim() };
}

/* ── Learning what this user actually sends ──────────────────────────────── */

const HOW_MANY = 60;

/**
 * Read the user's own sent mail and derive both their writing voice and the
 * emails they send over and over.
 *
 * Deliberately explicit rather than a background job: this reads a person's
 * mailbox, and that should happen because they pressed a button that said so.
 */
export async function learnFromSentMail(
  token: string,
  onProgress?: (msg: string) => void,
): Promise<StyleLearning> {
  onProgress?.('קורא את המיילים שנשלחו…');
  const sent = await searchEmails(token, 'in:sent -in:drafts -in:chats', HOW_MANY);
  if (sent.length < 3) {
    throw new Error(`נמצאו רק ${sent.length} מיילים שנשלחו — אין מספיק כדי ללמוד סגנון`);
  }

  // Trim hard: 60 full emails would dominate the context and add nothing —
  // the shape of an email is visible in its first few hundred characters.
  const corpus = sent.map((m, i) => {
    const body = String(m.body ?? m.snippet ?? '')
      .replace(/^>.*$/gm, '')            // drop quoted replies — not this person's writing
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 700);
    return `--- מייל ${i + 1} ---\nנושא: ${m.subject}\n${body}`;
  }).join('\n\n');

  onProgress?.(`מנתח ${sent.length} מיילים…`);

  const anthropic = getAnthropicProxy();
  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4000,
    system: [
      'אתה מנתח את המיילים שאדם שלח כדי ללמוד איך הוא כותב ומה הוא כותב שוב ושוב.',
      '',
      'החזר בדיוק בפורמט הזה, בלי טקסט לפני או אחרי:',
      '',
      'STYLE:',
      '<תיאור בפרוזה של סגנון הכתיבה — אורך, רמת פורמליות, פתיחות וסגירות אופייניות, מבנה טיפוסי>',
      '###',
      'TITLE: <שם קצר לתבנית>',
      'WHEN: <מתי שולחים מייל כזה>',
      'SUBJECT: <שורת נושא>',
      'TIMES: <מספר>',
      'BODY:',
      '<גוף התבנית, כמה שורות שצריך>',
      '###',
      '<תבנית נוספת באותו מבנה…>',
      '',
      'כללים:',
      '• הצע רק תבניות שבאמת חוזרות על עצמן — 3 עד 6 תבניות. אל תמציא תבנית מדוגמה בודדת.',
      '• TIMES = כמה מהמיילים שנותחו נראים כמו התבנית הזו. אל תנפח את המספר.',
      '• בגוף התבנית החלף פרטים אישיים במשתנים: {{first_name}}, {{company}}.',
      '• אל תכלול מידע רגיש — מספרי טלפון, מחירים ספציפיים או שמות לקוחות.',
      '• כתוב באותה שפה שבה המיילים כתובים.',
    ].join('\n'),
    messages: [{ role: 'user', content: corpus }],
  });

  const raw = textOf(resp);
  // '###' separates the style description from each template, so a body with
  // blank lines in it stays intact — the reason this is not JSON.
  const [stylePart, ...templateParts] = raw.split(/^###[ \t]*$/m);
  const styleProfile = block(stylePart, 'STYLE', /^###/m) || stylePart.trim();
  if (!styleProfile) {
    console.error('[voiceCompose] unparsable learning response:', raw.slice(0, 400));
    throw new Error('הניתוח לא החזיר תוצאה — נסה שוב');
  }

  const suggestions = templateParts
    .map((part, i) => ({
      id: `sug_${Date.now()}_${i}`,
      title: field(part, 'TITLE').slice(0, 80),
      whenToUse: field(part, 'WHEN').slice(0, 200),
      subject: field(part, 'SUBJECT').slice(0, 200),
      body: block(part, 'BODY', /^(TITLE|WHEN|SUBJECT|TIMES):/m),
      seenTimes: Math.max(1, parseInt(field(part, 'TIMES'), 10) || 1),
    }))
    .filter(s => s.title && s.body)
    .sort((a, b) => b.seenTimes - a.seenTimes);

  return {
    styleProfile,
    suggestions,
    learnedAt: Date.now(),
    sampleCount: sent.length,
  };
}

const learnDoc = (wid: string) => doc(db, 'workspaces', wid, 'emailAgent', 'styleLearning');

export async function loadStyleLearning(wid: string): Promise<StyleLearning | null> {
  try {
    const snap = await getDoc(learnDoc(wid));
    return snap.exists() ? (snap.data() as StyleLearning) : null;
  } catch { return null; }
}

export async function saveStyleLearning(wid: string, l: StyleLearning): Promise<void> {
  await setDoc(learnDoc(wid), l);
}
