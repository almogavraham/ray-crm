/**
 * marketingAutopilot.ts
 *
 * The autonomous Marketing Agent engine (client-side orchestration).
 *
 * Pipeline:
 *   business info → strategic plan (Claude) → posts + media → approval → queue.
 *
 * A scheduled Cloud Function (functions/autopilot.js) later drains the
 * `scheduledPosts` queue and publishes at each post's time — even when the app
 * is closed. This module produces & approves plans; it does not itself publish
 * on a schedule.
 *
 * Reuses: getAnthropicProxy (planning), the Pollinations image path, the
 * scheduledPosts queue + ScheduledPost type, ProductProfile learning store,
 * email + notifications for approval alerts.
 */

import { db, storage } from './firebase';
import {
  collection, getDocs, query, orderBy, setDoc, doc, deleteDoc, updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { WorkspaceProfile } from '../types';
import type { MarketingAgentConfig } from './facebookMarketing';
import { getPageToken, saveScheduledPost } from './facebookMarketing';
import { loadProductProfile } from './mediaGeneration';
import type { ProductProfile } from './mediaGeneration';
import { sendLeadEmail, isEmailConfigured } from './email';
import { createNotification } from './notifications';

/* ── Types ────────────────────────────────────────────────────────────────── */
export type AutopilotCadence = 'daily' | '3x-week' | 'weekly';

export type AutopilotPostStatus =
  | 'pending_approval' | 'approved' | 'scheduled' | 'posted' | 'failed' | 'rejected';

export interface AutopilotPost {
  id:          string;
  day:         number;                    // 1-based order in the plan
  scheduledTime: number;                  // Unix ms (computed from cadence + times)
  platform:    'facebook' | 'instagram';
  format:      string;                    // 'תמונה' | 'ריל' | 'קרוסלה' | 'סטורי'
  title:       string;                    // hook / theme
  caption:     string;                    // full Hebrew caption, ready to publish
  hashtags:    string[];
  cta:         string;
  mediaPrompt: string;                    // English prompt for image generation
  mediaType:   'image' | 'video' | 'none';
  mediaUrl?:   string;
  mediaThumbnailUrl?: string;
  mediaStatus: 'pending' | 'ready' | 'failed';
  status:      AutopilotPostStatus;
  postId?:     string;
  postUrl?:    string;
}

export interface AutopilotStrategy {
  summary:   string;
  audiences: string[];
  pillars:   string[];
  cadence:   string;
  platforms: string[];
}

export type AutopilotPlanStatus =
  | 'generating' | 'pending_approval' | 'approved' | 'publishing' | 'done' | 'rejected';

export interface AutopilotPlan {
  id:        string;
  status:    AutopilotPlanStatus;
  title:     string;
  createdAt: number;
  approvedAt?: number;
  strategy:  AutopilotStrategy;
  posts:     AutopilotPost[];
}

/* ── Firestore paths ──────────────────────────────────────────────────────── */
function plansCol(wid: string) {
  return collection(db, 'workspaces', wid, 'marketingAgent', 'autopilotPlans', 'items');
}
function planDoc(wid: string, id: string) {
  return doc(db, 'workspaces', wid, 'marketingAgent', 'autopilotPlans', 'items', id);
}

/* ── Business context ─────────────────────────────────────────────────────── */
/** Consolidate everything the system knows about the business into one prompt. */
export async function gatherBusinessContext(
  wid: string,
  workspace?: WorkspaceProfile | null,
): Promise<{ text: string; profile: ProductProfile | null }> {
  let profile: ProductProfile | null = null;
  try { profile = await loadProductProfile(wid); } catch { /* ignore */ }

  const p: string[] = [];
  const name = profile?.productName || workspace?.name;
  if (name) p.push(`שם העסק/המוצר: ${name}`);
  if (profile?.productDescription) p.push(`תיאור: ${profile.productDescription}`);
  else if (workspace?.prompt) p.push(`תיאור העסק: ${workspace.prompt}`);
  if (workspace?.industry) p.push(`ענף: ${workspace.industry}`);
  if (workspace?.businessSolutions?.length) p.push(`שירותים/מוצרים: ${workspace.businessSolutions.join(', ')}`);

  const ai = workspace?.aiProfile;
  if (profile?.targetAudience) p.push(`קהל יעד: ${profile.targetAudience}`);
  else if (ai?.idealClient) p.push(`לקוח אידיאלי: ${ai.idealClient}`);
  if (ai?.painPoints) p.push(`כאבים של הלקוח: ${ai.painPoints}`);
  if (ai?.uniqueValue) p.push(`ערך ייחודי: ${ai.uniqueValue}`);
  if (ai?.tone) p.push(`טון מותג: ${ai.tone}`);
  if (profile?.styleKeywords?.length) p.push(`סגנון ויזואלי: ${profile.styleKeywords.join(', ')}`);
  if (profile?.brandColors?.length) p.push(`צבעי מותג: ${profile.brandColors.join(', ')}`);
  if (profile?.avoidKeywords?.length) p.push(`להימנע מ: ${profile.avoidKeywords.join(', ')}`);
  if (workspace?.aiInstructions) p.push(`הנחיות מותג: ${workspace.aiInstructions}`);

  // A little learning signal: what worked before
  if (profile?.publishedPosts?.length) {
    const recent = profile.publishedPosts.slice(-3).map(x => x.topic).filter(Boolean);
    if (recent.length) p.push(`פוסטים אחרונים שפורסמו (להימנע מחזרתיות): ${recent.join(' · ')}`);
  }

  return { text: p.join('\n'), profile };
}

/** How complete is the business profile? Drives the guided-setup gate. */
export function contextCompleteness(
  workspace?: WorkspaceProfile | null,
  profile?: ProductProfile | null,
): { score: number; missing: string[] } {
  const missing: string[] = [];
  if (!(profile?.productName || workspace?.name)) missing.push('שם העסק');
  if (!(profile?.productDescription || workspace?.prompt)) missing.push('תיאור העסק');
  if (!(profile?.targetAudience || workspace?.aiProfile?.idealClient)) missing.push('קהל יעד');
  const total = 3;
  return { score: Math.round(((total - missing.length) / total) * 100), missing };
}

/* ── Schedule computation ─────────────────────────────────────────────────── */
const CADENCE_INTERVAL_DAYS: Record<AutopilotCadence, number> = {
  daily: 1, '3x-week': 2, weekly: 7,
};

/** Compute a publish timestamp for each post, starting tomorrow. */
export function computeSchedule(
  count: number,
  cadence: AutopilotCadence,
  times: string[],
  startFrom: number = Date.now(),
): number[] {
  const slots = (times.length ? times : ['09:00', '13:00', '19:00'])
    .map(t => {
      const [h, m] = t.split(':').map(Number);
      return { h: h || 0, m: m || 0 };
    });
  const interval = CADENCE_INTERVAL_DAYS[cadence] ?? 1;
  const start = new Date(startFrom);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1); // begin tomorrow

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const slot = slots[i % slots.length];
    const dayOffset = Math.floor(i / slots.length) * interval + (i % slots.length === 0 ? 0 : 0);
    // Spread: one slot per post, moving to the next day-block after all slots used
    const d = new Date(start);
    d.setDate(start.getDate() + Math.floor(i / slots.length) * interval);
    d.setHours(slot.h, slot.m, 0, 0);
    out.push(d.getTime() + dayOffset * 0);
  }
  return out;
}

/* ── Plan generation (Claude) ─────────────────────────────────────────────── */
export async function generateAutopilotPlan(opts: {
  wid: string;
  workspace?: WorkspaceProfile | null;
  config: MarketingAgentConfig;
  postsCount: number;
  platforms: Array<'facebook' | 'instagram'>;
  cadence: AutopilotCadence;
}): Promise<AutopilotPlan> {
  const { wid, workspace, config, postsCount, platforms, cadence } = opts;
  const { text: ctx } = await gatherBusinessContext(wid, workspace);

  const { getAnthropicProxy } = await import('./anthropicClient');
  const anthropic = getAnthropicProxy();

  const tone = config.emojiUsage === 'frequent' ? 'נועז וקליט' : 'מקצועי וחם';
  const pillars = config.contentPillars?.length ? `פילרי תוכן מועדפים: ${config.contentPillars.join(', ')}.` : '';
  const platformList = platforms.join(' | ');

  const schema = `{
  "title": "כותרת קצרה לתוכנית",
  "strategy": {
    "summary": "פסקה קצרה על האסטרטגיה",
    "audiences": ["קהל 1", "קהל 2"],
    "pillars": ["פילר 1", "פילר 2", "פילר 3"],
    "cadence": "תיאור קצב הפרסום",
    "platforms": ["${platforms.join('","')}"]
  },
  "posts": [
    {
      "day": 1,
      "platform": "${platforms.join(' | ')}",
      "format": "תמונה | קרוסלה | ריל | סטורי",
      "title": "הוק/רעיון מרכזי",
      "caption": "טקסט פוסט מלא ומוכן לפרסום בעברית, כולל אמוג'י",
      "hashtags": ["#תג1", "#תג2"],
      "cta": "קריאה לפעולה",
      "mediaType": "image | video | none",
      "mediaPrompt": "A detailed ENGLISH prompt for generating the post image/video visual"
    }
  ]
}`;

  const system = `אתה אסטרטג שיווק דיגיטלי בכיר. אתה מקבל מידע על עסק ומייצר תוכנית שיווק אוטונומית, מלאה ומוכנה לביצוע: אסטרטגיה (קהלים, פילרי תוכן, קצב) ותוכנית פוסטים. הטון: ${tone}. ${pillars}

חשוב:
- כל שדות הטקסט המיועדים לפרסום — בעברית.
- שדה "mediaPrompt" — באנגלית בלבד, תיאור ויזואלי מפורט ליצירת תמונה (בלי טקסט בתמונה).
- הפק בדיוק ${postsCount} פוסטים, מחולקים חכם בין הפלטפורמות: ${platformList}.
- החזר אך ורק JSON תקין התואם למבנה הבא, בלי טקסט לפני/אחרי:
${schema}`;

  const userText = [
    ctx ? `מידע על העסק:\n${ctx}` : 'אין מידע מפורט — הנח עסק ישראלי כללי.',
    `בנה תוכנית שיווק אוטונומית של ${postsCount} פוסטים. החזר JSON בלבד.`,
  ].join('\n\n');

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userText }],
  });

  const raw = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text ?? '';
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: { title?: string; strategy?: Partial<AutopilotStrategy>; posts?: Array<Partial<AutopilotPost>> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const a = jsonStr.indexOf('{'), b = jsonStr.lastIndexOf('}');
    if (a === -1 || b === -1) throw new Error('ה-AI לא החזיר JSON תקין');
    parsed = JSON.parse(jsonStr.slice(a, b + 1));
  }

  const rawPosts = (parsed.posts ?? []).slice(0, postsCount);
  if (!rawPosts.length) throw new Error('התוכנית חזרה ריקה');

  const times = computeSchedule(rawPosts.length, cadence, config.bestPostingTimes ?? []);
  const id = `plan-${Date.now()}`;

  const posts: AutopilotPost[] = rawPosts.map((p, i) => {
    const platform = (p.platform === 'instagram' || p.platform === 'facebook')
      ? p.platform
      : platforms[i % platforms.length];
    return {
      id:          `${id}-p${i + 1}`,
      day:         p.day ?? i + 1,
      scheduledTime: times[i],
      platform,
      format:      p.format ?? 'תמונה',
      title:       p.title ?? '',
      caption:     p.caption ?? '',
      hashtags:    Array.isArray(p.hashtags) ? p.hashtags : [],
      cta:         p.cta ?? '',
      mediaPrompt: p.mediaPrompt ?? p.title ?? '',
      mediaType:   (p.mediaType === 'video' || p.mediaType === 'none') ? p.mediaType : 'image',
      mediaStatus: 'pending',
      status:      'pending_approval',
    };
  });

  const strategy: AutopilotStrategy = {
    summary:   parsed.strategy?.summary ?? '',
    audiences: parsed.strategy?.audiences ?? [],
    pillars:   parsed.strategy?.pillars ?? config.contentPillars ?? [],
    cadence:   parsed.strategy?.cadence ?? cadence,
    platforms: parsed.strategy?.platforms ?? platforms,
  };

  return { id, status: 'pending_approval', title: parsed.title?.trim() || 'תוכנית שיווק אוטונומית', createdAt: Date.now(), strategy, posts };
}

/* ── Media generation (Pollinations, free, no key) ────────────────────────── */
/** Generate one image via Pollinations and upload to Storage. Returns URL. */
/**
 * Image URLs that exist only in this browser session because saving them
 * failed. Callers check this before offering to publish or schedule the image.
 */
export const notPersisted = new Set<string>();

export async function pollinationsImage(prompt: string, wid?: string): Promise<string> {
  const encoded = encodeURIComponent(prompt.slice(0, 900));
  const models = ['flux-schnell', 'turbo', 'flux'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const model = models[attempt % models.length];
    const seed = (Date.now() + attempt * 7919) % 99999;
    const url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=1024&height=1024&nologo=true&seed=${seed}`;
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 4000));
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 90000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(to);
      if (res.status === 402 || !res.ok) continue;
      const blob = await res.blob();
      if (!blob || blob.size < 500) continue;
      if (wid) {
        try {
          const sRef = storageRef(storage, `workspaces/${wid}/media/autopilot_${Date.now()}.jpg`);
          await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
          return await getDownloadURL(sRef);
        } catch (uploadErr) {
          // The image generated fine — only saving it failed (most often because
          // Firebase Storage is not set up on the project, so there is no bucket).
          // Returning the local blob shows the user what was made instead of
          // retrying the whole generation and eventually reporting nothing at
          // all. The URL is per-session and cannot be published; the caller is
          // told so rather than left to discover it later.
          console.error('[pollinationsImage] storage upload failed — returning local blob', uploadErr);
          const local = URL.createObjectURL(blob);
          notPersisted.add(local);
          return local;
        }
      }
      return URL.createObjectURL(blob);
    } catch {
      continue;
    }
  }
  throw new Error('יצירת התמונה נכשלה (Pollinations עמוס)');
}

/** Generate media for every image post in the plan (sequential to avoid rate limits). */
export async function generatePlanMedia(
  wid: string,
  plan: AutopilotPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<AutopilotPlan> {
  const imagePosts = plan.posts.filter(p => p.mediaType !== 'none');
  let done = 0;
  for (const post of plan.posts) {
    if (post.mediaType === 'none') continue;
    try {
      // Video engines need API keys + polling; default to a representative still image.
      const url = await pollinationsImage(post.mediaPrompt || post.title, wid);
      post.mediaUrl = url;
      post.mediaThumbnailUrl = url;
      post.mediaStatus = 'ready';
    } catch (err) {
      console.error('[autopilot media]', err);
      post.mediaStatus = 'failed';
    }
    done++;
    onProgress?.(done, imagePosts.length);
  }
  return plan;
}

/** Regenerate media for a single post. */
export async function regeneratePostMedia(wid: string, post: AutopilotPost): Promise<AutopilotPost> {
  post.mediaStatus = 'pending';
  try {
    const url = await pollinationsImage(post.mediaPrompt || post.title, wid);
    post.mediaUrl = url;
    post.mediaThumbnailUrl = url;
    post.mediaStatus = 'ready';
  } catch {
    post.mediaStatus = 'failed';
  }
  return post;
}

/* ── Plan persistence ─────────────────────────────────────────────────────── */
export async function saveAutopilotPlan(wid: string, plan: AutopilotPlan): Promise<void> {
  await setDoc(planDoc(wid, plan.id), plan);
}
export async function loadAutopilotPlans(wid: string): Promise<AutopilotPlan[]> {
  try {
    const snap = await getDocs(query(plansCol(wid), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => d.data() as AutopilotPlan);
  } catch { return []; }
}
export async function updateAutopilotPlan(wid: string, id: string, updates: Partial<AutopilotPlan>): Promise<void> {
  await updateDoc(planDoc(wid, id), updates as Record<string, unknown>).catch(() => {});
}
export async function deleteAutopilotPlan(wid: string, id: string): Promise<void> {
  await deleteDoc(planDoc(wid, id)).catch(() => {});
}

/* ── Workspace autopilot flag (so the scheduler can find this workspace) ───── */
export async function setWorkspaceAutopilotFlag(wid: string, enabled: boolean): Promise<void> {
  await updateDoc(doc(db, 'workspaces', wid), { autopilotEnabled: enabled }).catch(() => {});
}

/* ── Approve & schedule ───────────────────────────────────────────────────── */
/**
 * Push every non-rejected post into the scheduledPosts queue (drained by the
 * scheduled Cloud Function). Returns how many were queued.
 */
export async function approveAndSchedule(
  wid: string,
  workspace: WorkspaceProfile | null | undefined,
  plan: AutopilotPlan,
): Promise<{ scheduled: number }> {
  const pageAuth = workspace ? getPageToken(workspace) : null;
  const pageId = pageAuth?.pageId;
  const connectedPage = workspace?.metaIntegration?.pages?.find(p => p.subscribed)
    ?? workspace?.metaIntegration?.pages?.[0];
  const igUserId = connectedPage?.instagramBusinessAccountId ?? undefined;

  let scheduled = 0;
  for (const post of plan.posts) {
    if (post.status === 'rejected') continue;
    const hashtags = (post.hashtags || []).map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    const message = [post.caption, hashtags].filter(Boolean).join('\n\n');
    await saveScheduledPost(wid, {
      message,
      scheduledTime: post.scheduledTime,
      status: 'pending',
      createdAt: Date.now(),
      platform: post.platform,
      planId: plan.id,
      ...(post.mediaUrl && post.mediaType === 'image' ? { imageUrl: post.mediaUrl } : {}),
      ...(post.mediaUrl && post.mediaType === 'video' ? { videoUrl: post.mediaUrl } : {}),
      ...(post.platform === 'facebook' && pageId ? { pageId } : {}),
      ...(post.platform === 'instagram' && igUserId ? { igUserId } : {}),
    });
    post.status = 'scheduled';
    scheduled++;
  }

  plan.status = 'approved';
  plan.approvedAt = Date.now();
  await saveAutopilotPlan(wid, plan);
  await setWorkspaceAutopilotFlag(wid, true); // ensure the scheduler picks this workspace up
  return { scheduled };
}

/* ── Approval notification ────────────────────────────────────────────────── */
export async function notifyOwnerForApproval(
  wid: string,
  workspace: WorkspaceProfile | null | undefined,
  plan: AutopilotPlan,
): Promise<void> {
  await createNotification(wid, {
    type: 'autopilot_approval',
    title: '🤖 תוכנית שיווק חדשה ממתינה לאישור',
    body: `סוכן השיווק הכין "${plan.title}" עם ${plan.posts.length} פוסטים. פתח לאישור ופרסום.`,
    link: 'marketing-agent',
    planId: plan.id,
  });

  const to = workspace?.email;
  if (to && isEmailConfigured(workspace)) {
    try {
      await sendLeadEmail({
        toEmail: to,
        toName: workspace?.name ?? '',
        subject: `🤖 RAY: תוכנית שיווק חדשה מוכנה לאישור (${plan.posts.length} פוסטים)`,
        message: `סוכן השיווק האוטונומי הכין עבורך תוכנית חדשה: "${plan.title}".\n\n${plan.posts.length} פוסטים מתוזמנים, כולל תוכן ותמונות.\n\nהיכנס למערכת → סוכן שיווק → אוטופיילוט כדי לאשר. ברגע שתאשר, הפוסטים יפורסמו אוטומטית בזמנים שנקבעו.`,
        fromName: 'RAY Marketing Autopilot',
        workspaceId: wid,
        workspace,
      });
    } catch (err) {
      console.error('[autopilot notify email]', err);
    }
  }
}
