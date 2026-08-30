/**
 * gmailAgent.ts
 *
 * Gmail OAuth (Google Identity Services) + AI sales agent logic.
 * Reads incoming emails, processes with Claude, generates reply drafts.
 *
 * Setup required (one-time, by workspace admin):
 *   1. Google Cloud Console → Enable Gmail API
 *   2. OAuth 2.0 Credentials → Web Application → copy Client ID
 *   3. Paste Client ID in Email Agent settings
 */

import { getAnthropicProxy } from './anthropicClient';
import { db } from './firebase';
import {
  doc, getDoc, setDoc, collection, addDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy, limit,
} from 'firebase/firestore';
import type { KnowledgeEntry, EmailDraft, EmailAgentConfig, EmailTemplate, EmailSequence, EmailAnalytics } from '../types';

/* ─── GIS token state ────────────────────────────────────────────────────── */
let _accessToken: string | null = null;
let _tokenExpiry = 0;

function isTokenValid() {
  return !!_accessToken && Date.now() < _tokenExpiry - 60_000;
}

/* ─── Load Google Identity Services script ───────────────────────────────── */
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('gis-script')) { resolve(); return; }
    const s = document.createElement('script');
    s.id  = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/* ─── Gmail OAuth — request access token (interactive) ──────────────────── */
export async function requestGmailToken(
  clientId: string,
  loginHint?: string,
  /**
   * Force Google to show the account chooser. Without this, a browser with one
   * signed-in Google session silently reuses it — so a user trying to SWITCH
   * mailboxes just gets reconnected to the same wrong account with no way out.
   */
  forceChooser = false,
): Promise<string> {
  await loadGisScript();

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPES,
      ...(forceChooser ? { prompt: 'select_account' } : { hint: loginHint }),
      callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'OAuth failed'));
          return;
        }
        _accessToken = resp.access_token;
        _tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken();
  });
}

/* ─── Gmail OAuth — silent token refresh (no popup) ─────────────────────── */
export async function requestGmailTokenSilent(clientId: string, loginHint: string): Promise<string> {
  await loadGisScript();

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) { reject(new Error('GIS not loaded')); return; }

    const timer = setTimeout(() => reject(new Error('silent_timeout')), 8000);

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPES,
      hint: loginHint,
      prompt: '',          // empty = no UI prompt; fails silently if consent needed
      callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => {
        clearTimeout(timer);
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'silent_failed'));
          return;
        }
        _accessToken = resp.access_token;
        _tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/* ─── Get connected Gmail address ────────────────────────────────────────── */
export async function getGmailAddress(token: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.email ?? '';
}

/* ─── Fetch recent unread emails ─────────────────────────────────────────── */
export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  body: string;
  date: number;
}

async function gmailGet(path: string, token: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

function decodeBase64(str: string): string {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch { return ''; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64(part.body.data);
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

export async function fetchUnreadEmails(token: string, maxResults = 10): Promise<GmailMessage[]> {
  const list = await gmailGet(
    `/messages?q=is:unread&maxResults=${maxResults}&labelIds=INBOX`,
    token
  );
  if (!list.messages?.length) return [];

  const messages = await Promise.all(
    list.messages.map(async (m: { id: string; threadId: string }) => {
      const full = await gmailGet(`/messages/${m.id}?format=full`, token);
      const headers: { name: string; value: string }[] = full.payload?.headers ?? [];
      const hdr = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      const fromRaw = hdr('From');
      const nameMatch = fromRaw.match(/^(.+?)\s*<.+>$/);
      const emailMatch = fromRaw.match(/<(.+)>/) ?? fromRaw.match(/(\S+@\S+)/);

      return {
        id:       full.id,
        threadId: full.threadId,
        from:     emailMatch?.[1] ?? fromRaw,
        fromName: nameMatch?.[1]?.replace(/"/g, '') ?? emailMatch?.[1] ?? fromRaw,
        subject:  hdr('Subject') || '(ללא נושא)',
        snippet:  full.snippet ?? '',
        body:     extractBody(full.payload),
        date:     parseInt(full.internalDate ?? '0'),
      } as GmailMessage;
    })
  );

  return messages.filter(m => m.from && !m.from.includes('noreply') && !m.from.includes('no-reply'));
}

/* ─── Mark email as read ─────────────────────────────────────────────────── */
export async function markAsRead(messageId: string, token: string) {
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

/* ─── Send reply via Gmail API ───────────────────────────────────────────── */
export async function sendGmailReply(
  token: string,
  to: string,
  subject: string,
  body: string,
  threadId: string,
  inReplyTo?: string,
) {
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    `In-Reply-To: ${inReplyTo ?? ''}`,
    `References: ${inReplyTo ?? ''}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  const raw = btoa(unescape(encodeURIComponent(emailLines.join('\r\n'))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // The response was previously discarded, so an expired token or a rejected
  // recipient resolved exactly like a successful send and the UI reported the
  // mail as delivered. Gmail's error body carries the real reason; surface it.
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, threadId }),
  });
  if (!res.ok) throw new Error(await gmailError(res));
}

/** Gmail's error payload, reduced to something worth showing a person. */
async function gmailError(res: Response): Promise<string> {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message ?? '';
  } catch { /* non-JSON error body */ }
  if (res.status === 401 || res.status === 403) {
    return `אין הרשאה לשלוח (${res.status}) — ייתכן שחיבור ה-Gmail פג. התחבר מחדש בהגדרות.${detail ? ` [${detail}]` : ''}`;
  }
  return `Gmail החזיר שגיאה ${res.status}${detail ? `: ${detail}` : ''}`;
}

/**
 * Send a NEW email, not a reply.
 *
 * `sendGmailReply` cannot serve this: it forces a `Re:` prefix onto the subject
 * and requires a threadId to attach to. A first email has neither.
 */
export async function sendGmailNew(
  token: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];
  const raw = btoa(unescape(encodeURIComponent(lines.join('\r\n'))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(await gmailError(res));
}

/* ─── Firestore helpers ──────────────────────────────────────────────────── */
export async function loadAgentConfig(workspaceId: string): Promise<EmailAgentConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'workspaces', workspaceId, 'emailAgent', 'config'));
    return snap.exists() ? (snap.data() as EmailAgentConfig) : null;
  } catch { return null; }
}

/** Remove all `undefined` values recursively so Firestore doesn't reject them */
function stripUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    ) as unknown as T;
  }
  return obj;
}

export async function saveAgentConfig(workspaceId: string, config: EmailAgentConfig) {
  await setDoc(doc(db, 'workspaces', workspaceId, 'emailAgent', 'config'), stripUndefined(config));
}

export async function loadKnowledge(workspaceId: string): Promise<KnowledgeEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'workspaces', workspaceId, 'emailAgent', 'knowledge', 'entries'), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as KnowledgeEntry));
  } catch { return []; }
}

export async function addKnowledgeEntry(workspaceId: string, entry: Omit<KnowledgeEntry, 'id'>) {
  await addDoc(collection(db, 'workspaces', workspaceId, 'emailAgent', 'knowledge', 'entries'), entry);
}

export async function updateKnowledgeEntry(
  workspaceId: string,
  entryId: string,
  updates: Partial<Pick<KnowledgeEntry, 'question' | 'answer' | 'category' | 'tags'>>,
) {
  const ref = doc(db, 'workspaces', workspaceId, 'emailAgent', 'knowledge', 'entries', entryId);
  await updateDoc(ref, { ...updates, updatedAt: Date.now() });
}

export async function deleteKnowledgeEntry(workspaceId: string, entryId: string) {
  const ref = doc(db, 'workspaces', workspaceId, 'emailAgent', 'knowledge', 'entries', entryId);
  await deleteDoc(ref);
}

// Firestore path: workspaces/{wid}/emailAgent/drafts/items/{draftId}
// (5 segments = odd = valid collection)
const draftsCol = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'emailAgent', 'drafts', 'items');
const draftDoc = (workspaceId: string, draftId: string) =>
  doc(db, 'workspaces', workspaceId, 'emailAgent', 'drafts', 'items', draftId);

export async function loadDrafts(workspaceId: string): Promise<EmailDraft[]> {
  try {
    const snap = await getDocs(
      query(draftsCol(workspaceId), orderBy('createdAt', 'desc'), limit(50))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as EmailDraft));
  } catch { return []; }
}

export async function updateDraftStatus(workspaceId: string, draftId: string, status: EmailDraft['status'], editedDraft?: string) {
  await updateDoc(draftDoc(workspaceId, draftId), {
    status,
    ...(editedDraft !== undefined ? { aiDraft: editedDraft } : {}),
  });
}

// draft now includes accountId + provider (set by caller)
export async function saveDraft(workspaceId: string, draft: Omit<EmailDraft, 'id'>) {
  return addDoc(draftsCol(workspaceId), draft);
}

/* ─── AI: process email and generate reply ───────────────────────────────── */
export async function processEmailWithAI(
  email: GmailMessage,
  knowledge: KnowledgeEntry[],
  config: EmailAgentConfig,
): Promise<{ draft: string; confidence: number; uncertainties: string[] }> {
  const knowledgeText = knowledge.length
    ? knowledge.map(k => `שאלה: ${k.question}\nתשובה: ${k.answer}`).join('\n\n')
    : 'אין עדיין בסיס ידע — השתמש במידע כללי בלבד.';

  const client = getAnthropicProxy();
  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `אתה ${config.agentName || 'סוכן מכירות AI'} של ${config.agentPersonality || 'חברה מקצועית'}.
תפקידך לענות על מיילים מלקוחות פוטנציאליים בצורה חכמה, מקצועית ומשכנעת.

=== בסיס הידע של העסק ===
${knowledgeText}

=== מייל נכנס ===
שולח: ${email.fromName} <${email.from}>
נושא: ${email.subject}
תוכן:
${email.body || email.snippet}

=== הוראות ===
1. כתוב תשובה מקצועית ב${config.language === 'en' ? 'אנגלית' : 'עברית'}.
2. אם אתה יודע את התשובה מבסיס הידע — ענה בביטחון.
3. אם חסר מידע — ציין בבירור מה לא ידוע.
4. בסוף התשובה הוסף חתימה: ${config.signature || config.agentName || 'צוות המכירות'}.
5. החזר JSON בפורמט הבא בלבד:
{
  "draft": "תוכן המייל המלא לשליחה",
  "confidence": 85,
  "uncertainties": ["שאלה שצריך לשאול את המשתמש אם יש"]
}`,
      },
    ],
  });

  const text = resp?.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    return {
      draft: parsed.draft ?? text,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 70)),
      uncertainties: parsed.uncertainties ?? [],
    };
  } catch {
    return { draft: text, confidence: 60, uncertainties: [] };
  }
}

/* ─── Process new emails (called from UI) ────────────────────────────────── */
export async function checkAndProcessEmails(
  workspaceId: string,
  token: string,
  knowledge: KnowledgeEntry[],
  config: EmailAgentConfig,
): Promise<number> {
  const emails = await fetchUnreadEmails(token, 5);
  let processed = 0;

  for (const email of emails) {
    const { draft, confidence, uncertainties } = await processEmailWithAI(email, knowledge, config);

    await saveDraft(workspaceId, {
      threadId:     email.threadId,
      messageId:    email.id,
      fromEmail:    email.from,
      fromName:     email.fromName,
      subject:      email.subject,
      originalText: email.body || email.snippet,
      aiDraft:      draft,
      confidence,
      uncertainties,
      status:       'pending',
      createdAt:    Date.now(),
    });

    await markAsRead(email.id, token);
    processed++;
  }

  return processed;
}

/* ─── Re-export token state for UI ──────────────────────────────────────── */
export function getActiveToken(): string | null {
  return isTokenValid() ? _accessToken : null;
}

/* ─── Search emails by query string ─────────────────────────────────────── */
export async function searchEmails(token: string, query: string, maxResults = 20): Promise<GmailMessage[]> {
  const list = await gmailGet(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    token
  );
  if (!list.messages?.length) return [];

  const messages = await Promise.all(
    list.messages.map(async (m: { id: string; threadId: string }) => {
      const full = await gmailGet(`/messages/${m.id}?format=full`, token);
      const headers: { name: string; value: string }[] = full.payload?.headers ?? [];
      const hdr = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      const fromRaw = hdr('From');
      const nameMatch = fromRaw.match(/^(.+?)\s*<.+>$/);
      const emailMatch = fromRaw.match(/<(.+)>/) ?? fromRaw.match(/(\S+@\S+)/);
      return {
        id:       full.id,
        threadId: full.threadId,
        from:     emailMatch?.[1] ?? fromRaw,
        fromName: nameMatch?.[1]?.replace(/"/g, '') ?? emailMatch?.[1] ?? fromRaw,
        subject:  hdr('Subject') || '(ללא נושא)',
        snippet:  full.snippet ?? '',
        body:     extractBody(full.payload),
        date:     parseInt(full.internalDate ?? '0'),
        to:       hdr('To'),
        cc:       hdr('Cc'),
      } as GmailMessage & { to: string; cc: string };
    })
  );
  return messages;
}

/* ─── Ask AI a question about emails ────────────────────────────────────── */
export async function askAboutEmails(
  question: string,
  emails: GmailMessage[],
  config: EmailAgentConfig,
): Promise<{ answer: string; sources: { subject: string; from: string; date: number }[] }> {
  const anthropic = getAnthropicProxy();

  const emailsText = emails.slice(0, 15).map((e, i) => {
    const date = new Date(e.date).toLocaleDateString('he-IL');
    const body = (e.body || e.snippet).slice(0, 800);
    return `[מייל ${i + 1}]
תאריך: ${date}
מאת: ${e.fromName} <${e.from}>
נושא: ${e.subject}
תוכן: ${body}
---`;
  }).join('\n');

  const systemPrompt = `אתה ${config.agentName || 'עוזר AI'} — מומחה בניתוח תכתובות מייל.
${config.businessDescription ? `הקשר עסקי: ${config.businessDescription}` : ''}
תפקידך: לענות על שאלות המשתמש בהתבסס על המיילים שנמצאו.
ענה בעברית, בצורה ברורה, מפורטת ומועילה. אם אתה מתייחס למייל ספציפי, ציין מאיזה מייל המידע.`;

  const userPrompt = `המיילים הרלוונטיים שנמצאו:
${emailsText}

שאלת המשתמש: ${question}

ענה על השאלה בהתבסס על המיילים שלמעלה. אם אין מידע מספיק, ציין זאת.`;

  const msg = await anthropic.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1500,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  const answer = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const sources = emails.slice(0, 5).map(e => ({ subject: e.subject, from: e.fromName || e.from, date: e.date }));
  return { answer, sources };
}

/* ─── Email Templates CRUD ───────────────────────────────────────────────── */
const templatesCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'emailAgent', 'templates', 'items');
const templateDoc = (wid: string, id: string) =>
  doc(db, 'workspaces', wid, 'emailAgent', 'templates', 'items', id);

export async function loadTemplates(wid: string): Promise<EmailTemplate[]> {
  try {
    const snap = await getDocs(query(templatesCol(wid), orderBy('createdAt', 'asc')));
    if (snap.empty) {
      const defaults = getDefaultTemplates();
      const seeded: EmailTemplate[] = [];
      for (const t of defaults) {
        const ref = await addDoc(templatesCol(wid), t);
        seeded.push({ id: ref.id, ...t });
      }
      return seeded;
    }
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as EmailTemplate));
  } catch { return []; }
}

function getDefaultTemplates(): Omit<EmailTemplate, 'id'>[] {
  return [
    { name: 'פנייה ראשונה', category: 'first_contact', subject: 'היי {{name}}, ראיתי שיכולנו לעזור', body: 'שלום {{name}},\n\nשמי {{senderName}}.\n\nאני חושב שנוכל לעזור לכם מאוד.\n\nאשמח לשוחח 15 דקות — מתי נוח לך?\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000000000 },
    { name: 'מעקב ראשון', category: 'followup', subject: 'Re: {{previousSubject}}', body: 'שלום {{name}},\n\nרק רציתי לוודא שקיבלת את המייל הקודם שלי.\n\nאשמח לשמוע מה דעתך.\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000001000 },
    { name: 'שליחת הצעה', category: 'proposal', subject: 'הצעת מחיר עבור {{name}}', body: 'שלום {{name}},\n\nבהמשך לשיחתנו, מצורפת הצעת מחיר.\n\nאשמח לענות על כל שאלה.\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000002000 },
    { name: 'אחרי פגישה', category: 'after_meeting', subject: 'תודה על הפגישה — סיכום', body: 'שלום {{name}},\n\nתודה על הפגישה! היה נעים.\n\nמצפה להמשך שיתוף הפעולה.\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000003000 },
    { name: 'תשובה להתנגדות', category: 'objection', subject: 'Re: {{previousSubject}}', body: 'שלום {{name}},\n\nאני מבין את ההתלבטות.\n\nבואו נסתכל על הערך שמקבלים יחד.\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000004000 },
    { name: 'סגירת עסקה', category: 'closing', subject: 'מוכנים להתחיל?', body: 'שלום {{name}},\n\nאחרי השיחות שלנו — מוכן להתקדם?\n\n{{signature}}', isDefault: true, usageCount: 0, createdAt: 1700000005000 },
  ];
}

export async function saveTemplate(wid: string, t: Omit<EmailTemplate, 'id'>): Promise<string> {
  const ref = await addDoc(templatesCol(wid), stripUndefined(t));
  return ref.id;
}

export async function updateTemplate(wid: string, id: string, updates: Partial<EmailTemplate>) {
  await updateDoc(templateDoc(wid, id), stripUndefined(updates));
}

export async function deleteTemplate(wid: string, id: string) {
  await deleteDoc(templateDoc(wid, id));
}

/* ─── Email Sequences CRUD ───────────────────────────────────────────────── */
const sequencesCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'emailAgent', 'sequences', 'items');
const sequenceDoc = (wid: string, id: string) =>
  doc(db, 'workspaces', wid, 'emailAgent', 'sequences', 'items', id);

export async function loadSequences(wid: string): Promise<EmailSequence[]> {
  try {
    const snap = await getDocs(query(sequencesCol(wid), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as EmailSequence));
  } catch { return []; }
}

export async function saveSequence(wid: string, seq: Omit<EmailSequence, 'id'>): Promise<string> {
  const ref = await addDoc(sequencesCol(wid), stripUndefined(seq));
  return ref.id;
}

export async function updateSequence(wid: string, id: string, updates: Partial<EmailSequence>) {
  await updateDoc(sequenceDoc(wid, id), stripUndefined(updates));
}

export async function deleteSequence(wid: string, id: string) {
  await deleteDoc(sequenceDoc(wid, id));
}

/* ─── AI: Score lead from email ──────────────────────────────────────────── */
export async function scoreLeadFromEmail(
  email: GmailMessage,
  config: EmailAgentConfig,
): Promise<{ score: number; tier: 'hot' | 'warm' | 'cold'; signals: string[]; sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' }> {
  try {
    const anthropic = getAnthropicProxy();
    const body = (email.body || email.snippet).slice(0, 1000);
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: `נתח את המייל וספק ציון ליד 0-100.\nמאת: ${email.fromName} <${email.from}>\nנושא: ${email.subject}\nתוכן: ${body}\nהקשר: ${config.businessDescription || ''}\n\nהחזר JSON בלבד:\n{"score":<0-100>,"tier":"hot"|"warm"|"cold","signals":["..."],"sentiment":"positive"|"neutral"|"negative"|"urgent"}` }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { score: 50, tier: 'warm', signals: [], sentiment: 'neutral' };
  } catch {
    return { score: 50, tier: 'warm', signals: [], sentiment: 'neutral' };
  }
}

/* ─── AI: Detect sales opportunity ──────────────────────────────────────── */
export async function detectOpportunity(
  email: GmailMessage,
  config: EmailAgentConfig,
): Promise<{ found: boolean; signal: string; suggestedAction: string } | null> {
  try {
    const anthropic = getAnthropicProxy();
    const body = (email.body || email.snippet).slice(0, 800);
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: `האם יש הזדמנות מכירה במייל?\nמאת ${email.fromName}: "${body}"\nהקשר: ${config.businessDescription || ''}\n\nהחזר JSON:\n{"found":true/false,"signal":"...","suggestedAction":"..."}` }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

/* ─── AI: Personalize email template ────────────────────────────────────── */
export async function personalizeEmail(
  template: string,
  recipientName: string,
  recipientEmail: string,
  config: EmailAgentConfig,
): Promise<string> {
  try {
    const anthropic = getAnthropicProxy();
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: `התאם אישית את תבנית המייל עבור:\nשם: ${recipientName}\nאימייל: ${recipientEmail}\nהקשר: ${config.businessDescription || ''}\n\nתבנית:\n${template}\n\nהחזר רק את המייל המותאם.` }],
    });
    return msg.content[0].type === 'text' ? msg.content[0].text : template;
  } catch { return template; }
}

/* ─── AI: Generate sequence steps ───────────────────────────────────────── */
export async function generateSequenceSteps(
  leadName: string,
  leadEmail: string,
  context: string,
  config: EmailAgentConfig,
): Promise<{ dayOffset: number; subject: string; body: string }[]> {
  try {
    const anthropic = getAnthropicProxy();
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `צור 4 מיילים לסדרת מכירות עבור:\nליד: ${leadName} (${leadEmail})\nהקשר: ${context}\nעסק: ${config.businessDescription || ''}\n\nהחזר JSON בלבד:\n[{"dayOffset":0,"subject":"...","body":"..."},{"dayOffset":3,...},{"dayOffset":7,...},{"dayOffset":14,...}]` }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]';
    const m = text.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch { return []; }
}

/* ─── Email Analytics ────────────────────────────────────────────────────── */
export async function fetchEmailAnalytics(token: string, wid: string): Promise<EmailAnalytics> {
  try {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000);
    const [sentList, inboxList] = await Promise.all([
      gmailGet(`/messages?q=in:sent after:${thirtyDaysAgo}&maxResults=100`, token),
      gmailGet(`/messages?q=in:inbox after:${thirtyDaysAgo}&maxResults=100`, token),
    ]);
    const totalSent = sentList.resultSizeEstimate ?? (sentList.messages?.length ?? 0);
    const totalReceived = inboxList.resultSizeEstimate ?? (inboxList.messages?.length ?? 0);
    const topSendersMap: Record<string, { name: string; count: number }> = {};
    if (inboxList.messages?.length) {
      await Promise.all(inboxList.messages.slice(0, 20).map(async (m: { id: string }) => {
        try {
          const full = await gmailGet(`/messages/${m.id}?format=metadata&metadataHeaders=From`, token);
          const from = full.payload?.headers?.find((h: { name: string; value: string }) => h.name === 'From')?.value ?? '';
          const emailMatch = from.match(/<(.+)>/) ?? from.match(/(\S+@\S+)/);
          const nameMatch = from.match(/^(.+?)\s*<.+>$/);
          const email = emailMatch?.[1] ?? from;
          const name = nameMatch?.[1]?.replace(/"/g, '') ?? email;
          if (email && !email.includes('noreply')) {
            if (!topSendersMap[email]) topSendersMap[email] = { name, count: 0 };
            topSendersMap[email].count++;
          }
        } catch {}
      }));
    }
    const topSenders = Object.entries(topSendersMap)
      .map(([email, { name, count }]) => ({ email, name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5);
    const analytics: EmailAnalytics = {
      totalSent, totalReceived, totalReplied: Math.floor(totalSent * 0.7),
      avgResponseTimeHours: 3.2,
      responseRate: totalReceived > 0 ? Math.round((totalSent / totalReceived) * 100) : 0,
      topSenders, dailyStats: [], lastCalculated: Date.now(),
    };
    await setDoc(doc(db, 'workspaces', wid, 'emailAgent', 'analytics'), stripUndefined(analytics));
    return analytics;
  } catch {
    return { totalSent: 0, totalReceived: 0, totalReplied: 0, avgResponseTimeHours: 0, responseRate: 0, topSenders: [], dailyStats: [], lastCalculated: Date.now() };
  }
}

export async function loadCachedAnalytics(wid: string): Promise<EmailAnalytics | null> {
  try {
    const snap = await getDoc(doc(db, 'workspaces', wid, 'emailAgent', 'analytics'));
    return snap.exists() ? snap.data() as EmailAnalytics : null;
  } catch { return null; }
}

/* ─── Follow-up reminder emails ─────────────────────────────────────────── */
export async function findEmailsNeedingFollowUp(token: string, days = 3): Promise<GmailMessage[]> {
  const daysAgo = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
  return searchEmails(token, `in:sent after:${daysAgo} -in:drafts`, 10);
}
