/**
 * marketingMaterials.ts — what the user has shown the marketing agent.
 *
 * "Teach the agent about my business" used to mean typing into a profile form.
 * Businesses do not live in forms; they live in a price list, last year's
 * catalogue, the three ads that worked, a brand guide someone paid for once.
 * This is where those go.
 *
 * Every upload is stored twice: the file itself in Storage, and a short
 * summary in Firestore. The summary is the part the agent actually reads —
 * produced once, at upload, by having the model look at the file — because
 * re-sending a 4 MB PDF on every chat turn would cost real money per message
 * and blow the prompt on the third one. The file stays for the human and for
 * "show me the ad again".
 *
 * Images are also recorded as approved media, so the autopilot's visual
 * learning and the chat's see the same set; a photo shown to one agent should
 * not have to be shown to the other.
 *
 * Kept to 30 materials per workspace. Past that the summaries alone would
 * dominate the prompt, and thirty documents is more than any campaign ever
 * drew on.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import { getAnthropicProxy } from './anthropicClient';
import { recordApprovedMedia } from './mediaGeneration';

export type MaterialKind = 'image' | 'pdf' | 'text' | 'video' | 'other';

export interface MarketingMaterial {
  id: string;
  name: string;
  kind: MaterialKind;
  url: string;
  mime: string;
  size: number;
  /** What the agent learned from it — written by the model at upload. */
  summary: string;
  /** Optional note the user typed alongside the upload ("זה המחירון של 2026"). */
  note?: string;
  addedAt: number;
}

const MAX_MATERIALS = 30;
/** Above this, PDFs are stored but not read — the model call would be too large. */
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;

const materialsRef = (wid: string) => doc(db, 'workspaces', wid, 'marketing', 'materials');

export async function loadMaterials(wid: string): Promise<MarketingMaterial[]> {
  try {
    const snap = await getDoc(materialsRef(wid));
    const items = snap.exists() ? (snap.data().items as MarketingMaterial[] | undefined) : undefined;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function saveMaterials(wid: string, items: MarketingMaterial[]): Promise<void> {
  await setDoc(materialsRef(wid), { items: items.slice(-MAX_MATERIALS), updatedAt: Date.now() }, { merge: true });
}

export async function removeMaterial(wid: string, id: string): Promise<void> {
  const items = await loadMaterials(wid);
  await saveMaterials(wid, items.filter(m => m.id !== id));
}

export function kindOf(file: File): MaterialKind {
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('text/') || /\.(md|txt|csv)$/i.test(file.name)) return 'text';
  return 'other';
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * One model call that turns a file into what the agent should remember.
 *
 * The question is specific on purpose. "Summarise this" yields a paragraph
 * about the document; the agent needs the *marketing* facts — what is sold,
 * for how much, to whom, in what voice, with what visual style — because
 * those are the only parts a future post or campaign will draw on.
 */
async function describeForMarketing(file: File, kind: MaterialKind, note?: string): Promise<string> {
  const ask = `אתה מנהל שיווק. המשתמש העלה חומר כדי שתלמד את העסק שלו${note ? ` והוסיף: "${note}"` : ''}.
כתוב סיכום של עד 120 מילים בעברית עם רק מה שישמש לשיווק: מה נמכר, מחירים אם יש, קהל, מסרים/סלוגנים, טון, וסגנון ויזואלי (צבעים, אווירה) אם זו תמונה. בלי פתיחות ובלי הערכות שאין להן בסיס בחומר.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  if (kind === 'image') {
    content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: await fileToBase64(file) } });
  } else if (kind === 'pdf' && file.size <= MAX_READ_BYTES) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileToBase64(file) } });
  } else if (kind === 'text') {
    const text = (await file.text()).slice(0, MAX_TEXT_CHARS);
    content.push({ type: 'text', text: `תוכן הקובץ "${file.name}":\n\n${text}` });
  } else {
    // Video and unknown types are kept, not read: there is no honest summary
    // to write, and a made-up one would be worse than none.
    return note ? `קובץ ${kind === 'video' ? 'וידאו' : ''} "${file.name}" — ${note}` : `קובץ "${file.name}" (לא נקרא אוטומטית)`;
  }
  content.push({ type: 'text', text: ask });

  const client = getAnthropicProxy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await (client.messages as any).create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = res?.content?.find((b: any) => b.type === 'text')?.text?.trim();
  return text || `קובץ "${file.name}"`;
}

/**
 * Store a file and learn from it. Returns the saved material.
 *
 * Storage first, then the model, then Firestore — so a failed summary still
 * leaves the file where "show me the file" can find it, and a failed Firestore
 * write does not orphan a summary nobody can reach.
 */
export async function addMaterial(
  wid: string,
  file: File,
  note?: string,
  onStage?: (stage: string) => void,
): Promise<MarketingMaterial> {
  if (file.size > 100 * 1024 * 1024) throw new Error('הקובץ גדול מדי (מקסימום 100MB)');
  const kind = kindOf(file);
  const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';

  onStage?.('מעלה…');
  const sRef = storageRef(storage, `workspaces/${wid}/campaign-media/materials/${id}.${ext}`);
  await uploadBytes(sRef, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(sRef);

  onStage?.('לומד את החומר…');
  let summary: string;
  try {
    summary = await describeForMarketing(file, kind, note);
  } catch (e) {
    // The file is saved; say plainly that it was not read rather than pretend.
    summary = `קובץ "${file.name}" נשמר אך לא נקרא (${(e as Error).message})${note ? ` — ${note}` : ''}`;
  }

  const material: MarketingMaterial = {
    id, name: file.name, kind, url, mime: file.type || '', size: file.size,
    summary, ...(note ? { note } : {}), addedAt: Date.now(),
  };

  // Same file name replaces the earlier copy rather than sitting beside it.
  // Re-uploading is how a bad read gets fixed — a summary that says "could
  // not be read" must not stay in the prompt next to the good one.
  const items = (await loadMaterials(wid)).filter(m => m.name !== material.name);
  await saveMaterials(wid, [...items, material]);

  if (kind === 'image') {
    // Same set the autopilot learns style from.
    await recordApprovedMedia(wid, {
      id, type: 'image', url, thumbnailUrl: url,
      prompt: note || summary.slice(0, 200), style: 'image', engine: 'ideogram',
      approvedAt: Date.now(),
    });
  }
  return material;
}

/** The materials, as the line-per-item block that goes into a system prompt. */
export function materialsContext(items: MarketingMaterial[]): string {
  if (!items.length) return '';
  const lines = items.slice(-MAX_MATERIALS).map(m =>
    `• [${m.kind}] ${m.name}${m.note ? ` (${m.note})` : ''}: ${m.summary}`);
  return `## חומרים שהמשתמש העלה כדי ללמד אותך (${items.length})\n${lines.join('\n')}`;
}
