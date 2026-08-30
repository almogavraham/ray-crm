/**
 * messageTemplates.ts — reusable email and WhatsApp bodies that automations send.
 *
 * Until now an automation could only send AI-written messages. That is right
 * when every lead needs a different message, and wrong for the majority of
 * automated sends, which are the same message every time — a follow-up, a
 * quote reminder, a welcome. Those should be written once, reviewed once, and
 * reused, so the customer knows exactly what leaves their system.
 *
 * Variables use {{double_braces}} and resolve against the lead. Unknown
 * variables render as an empty string rather than leaking `{{whatever}}` into a
 * message a customer receives — a visible template tag in a real email is worse
 * than a missing word.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Lead } from '../types';

export type TemplateChannel = 'email' | 'whatsapp';

export interface MessageTemplate {
  id: string;
  channel: TemplateChannel;
  name: string;
  /** Email only. */
  subject?: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
}

/** Every variable offered in the editor, with a sample used for live preview. */
export const VARIABLES: { key: string; label: string; sample: string }[] = [
  { key: 'company',     label: 'שם החברה',        sample: 'ויסוצקי נכסים' },
  { key: 'contact',     label: 'איש הקשר',        sample: 'בנימין' },
  { key: 'first_name',  label: 'שם פרטי',         sample: 'בנימין' },
  { key: 'status',      label: 'סטטוס',           sample: 'בתהליך' },
  { key: 'source',      label: 'מקור הגעה',       sample: 'פייסבוק' },
  { key: 'owner',       label: 'האחראי על הליד',  sample: 'אלמוג' },
  { key: 'budget',      label: 'תקציב',           sample: '9,500' },
  { key: 'solutions',   label: 'פתרונות',         sample: 'ניהול קמפיינים, בניית אתר' },
  { key: 'phone',       label: 'טלפון',           sample: '050-1234567' },
  { key: 'email',       label: 'אימייל',          sample: 'contact@example.co.il' },
];

/** Resolve {{vars}} against a real lead. Unknown keys collapse to ''. */
export function renderTemplate(text: string, lead: Partial<Lead>, extra: Record<string, string> = {}): string {
  const first = String(lead.contactName ?? '').trim().split(/\s+/)[0] ?? '';
  const map: Record<string, string> = {
    company:    String(lead.company ?? ''),
    contact:    String(lead.contactName ?? ''),
    first_name: first,
    status:     String(lead.status ?? ''),
    source:     String(lead.source ?? ''),
    owner:      String(lead.assignedTo ?? ''),
    budget:     lead.budget ? Number(lead.budget).toLocaleString('he-IL') : '',
    solutions:  (lead.solutions ?? []).map(s => s.name).join(', '),
    phone:      String(lead.phone ?? ''),
    email:      String(lead.email ?? ''),
    ...extra,
  };
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => map[String(k).toLowerCase()] ?? '');
}

/** Preview with sample values, for the editor. */
export function previewTemplate(text: string): string {
  const map = Object.fromEntries(VARIABLES.map(v => [v.key, v.sample]));
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => map[String(k).toLowerCase()] ?? '');
}

/** Variables used in the text that we don't know how to fill. */
export function unknownVariables(text: string): string[] {
  const known = new Set(VARIABLES.map(v => v.key));
  const found = [...String(text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase());
  return [...new Set(found.filter(v => !known.has(v)))];
}

const tplDoc = (wid: string) => doc(db, 'workspaces', wid, 'config', 'messageTemplates');

export async function loadTemplates(wid: string): Promise<MessageTemplate[]> {
  try {
    const snap = await getDoc(tplDoc(wid));
    return snap.exists() ? ((snap.data().templates ?? []) as MessageTemplate[]) : [];
  } catch { return []; }
}

export async function saveTemplates(wid: string, templates: MessageTemplate[]): Promise<void> {
  await setDoc(tplDoc(wid), { templates }, { merge: true });
}

export const STARTER_TEMPLATES: Omit<MessageTemplate, 'id' | 'createdAt'>[] = [
  {
    channel: 'email', name: 'פולואפ אחרי שיחה',
    subject: 'סיכום השיחה שלנו — {{company}}',
    body: 'היי {{first_name}},\n\nתודה על השיחה. ריכזתי את מה שדיברנו עליו:\n\n• \n• \n\nאשמח להתקדם — מתי נוח לך לדבר שוב?\n\n{{owner}}',
  },
  {
    channel: 'whatsapp', name: 'תזכורת עדינה',
    body: 'היי {{first_name}}, מה שלומך? רציתי לוודא שקיבלת את מה ששלחתי בנוגע ל{{company}}. אשמח לשמוע מה דעתך 🙂',
  },
  {
    channel: 'whatsapp', name: 'ניסיון יצירת קשר',
    body: 'היי {{first_name}}, ניסיתי להשיג אותך טלפונית. מתי יהיה לך נוח שנדבר?',
  },
];
