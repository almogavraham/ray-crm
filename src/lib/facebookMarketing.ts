/**
 * facebookMarketing.ts
 *
 * Meta Graph API integration for the Marketing Agent.
 * Handles: Facebook page posts, comments, AI replies, insights.
 *
 * Page access tokens are read from the existing MetaIntegration stored
 * in the workspace Firestore doc — no additional OAuth needed.
 *
 * Write operations (create post, reply) are proxied through Cloud Functions
 * to avoid exposing page tokens in the browser.
 */

import { getAnthropicProxy } from './anthropicClient';
import { db } from './firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc, collection, addDoc, getDocs,
  updateDoc, query, orderBy, limit, deleteDoc,
} from 'firebase/firestore';
import type { WorkspaceProfile } from '../types';

/* ── Types ─────────────────────────────────────────────────────────────────── */
export interface FacebookPost {
  id: string;
  message: string;
  createdTime: string;
  picture?: string;
  fullPicture?: string;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  clicks: number;
  permalink?: string;
}

export interface FacebookComment {
  id: string;
  postId: string;
  fromName: string;
  fromId: string;
  message: string;
  createdTime: string;
  likeCount: number;
  canReply: boolean;
}

export interface CommentDraft {
  id: string;
  commentId: string;
  postId: string;
  fromName: string;
  commentText: string;
  aiDraft: string;
  confidence: number;
  uncertainties: string[];
  status: 'pending' | 'approved' | 'sent' | 'ignored';
  createdAt: number;
}

export interface MarketingAgentConfig {
  // ── Basic ──────────────────────────────────────────────────────────────────
  enabled:              boolean;
  agentName:            string;
  signature:            string;
  language:             'he' | 'en' | 'auto';

  // ── Business context ───────────────────────────────────────────────────────
  businessDescription:  string;   // synced from / overrides workspace.prompt
  agentInstructions:    string;   // personal system-prompt for the agent
  contentPillars:       string[]; // main topics: ['מוצרים','טיפים','מבצעים',…]

  // ── Comment reply ──────────────────────────────────────────────────────────
  autoReplyComments:    boolean;
  replyTone:            'professional' | 'friendly' | 'formal';
  targetResponseTime:   number;   // minutes (0 = no limit)
  blacklistedWords:     string;   // comma-separated words to never use

  // ── Post creation ──────────────────────────────────────────────────────────
  postingGuidelines:    string;   // free-text guidelines (legacy)
  emojiUsage:           'none' | 'minimal' | 'frequent';
  ctaStyle:             'soft' | 'direct' | 'question';
  hashtagStrategy:      'none' | 'auto' | 'fixed';
  fixedHashtags:        string;   // comma-separated hashtags
  maxPostLength:        number;   // chars (0 = no limit)

  // ── Publishing schedule ────────────────────────────────────────────────────
  autoSchedule:         boolean;
  postFrequency:        'daily' | '3x-week' | 'weekly' | 'manual';
  bestPostingTimes:     string[]; // ['09:00','13:00','19:00']
  maxDailyPosts:        number;

  // ── Brand safety ──────────────────────────────────────────────────────────
  requireApproval:      boolean;  // always require human approval before posting
  sensitiveTopics:      string;   // topics the agent must NOT touch

  // ── Autopilot (autonomous agent) ───────────────────────────────────────────
  autopilotEnabled?:     boolean;                          // master switch
  autopilotPlatforms?:   Array<'facebook' | 'instagram'>;  // where autopilot posts
  autopilotPostsPerRun?: number;                           // posts per generated plan
  autopilotCadence?:     'daily' | '3x-week' | 'weekly';   // publishing cadence
  autopilotAutoGenerate?: boolean;                         // server generates new plans on its own
}

export interface PageInsights {
  fans: number;
  fansGrowth: number;       // delta last 30d
  reach: number;            // last 30d
  impressions: number;      // last 30d
  engagement: number;       // last 30d
  posts: number;            // last 30d
}

export interface ScheduledPost {
  id: string;
  message: string;
  imageUrl?: string;
  scheduledTime: number;    // Unix ms
  status: 'pending' | 'posted' | 'failed';
  fbPostId?: string;
  createdAt: number;
  // ── Autopilot extensions (used by the scheduled Cloud Function drain) ──────
  platform?: 'facebook' | 'instagram';
  pageId?: string;          // FB page id
  igUserId?: string;        // IG business account id
  videoUrl?: string;        // when the post carries a video instead of image
  planId?: string;          // parent AutopilotPlan id
  postUrl?: string;         // filled after publish
  error?: string;           // filled on failure
}

/* ── Read page token from workspace Meta integration ───────────────────────── */
export function getPageToken(workspace: WorkspaceProfile): { pageId: string; token: string } | null {
  const meta  = workspace.metaIntegration;
  const pages = meta?.pages ?? [];

  // Prefer subscribed page, fall back to first page
  const connected = pages.find(p => p.subscribed) ?? pages[0];

  // Best case: page has its own access token
  if (connected?.accessToken) {
    return { pageId: connected.id, token: connected.accessToken };
  }

  // Fallback: use the user-level long-lived token if a page id is known
  // (works for most Graph API calls that accept user tokens)
  if (connected?.id && meta?.userAccessToken) {
    return { pageId: connected.id, token: meta.userAccessToken };
  }

  return null;
}

/* ── Meta Graph API helper ──────────────────────────────────────────────────── */
async function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ access_token: token, ...params }).toString();
  const res = await fetch(`https://graph.facebook.com/v19.0${path}?${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `Graph API ${res.status}`);
  }
  return res.json();
}

/* ── Fetch recent posts with engagement data ───────────────────────────────── */
export async function fetchPagePosts(pageId: string, token: string, maxPosts = 20): Promise<FacebookPost[]> {
  const data = await graphGet(`/${pageId}/posts`, token, {
    fields: 'id,message,created_time,full_picture,permalink_url,likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_clicks_unique)',
    limit: String(maxPosts),
  });

  return (data.data ?? []).map((p: Record<string, unknown>) => {
    const ins = (p.insights as { data?: Array<{ name: string; values: Array<{ value: number }> }> })?.data ?? [];
    const insVal = (name: string) => ins.find(i => i.name === name)?.values?.[0]?.value ?? 0;
    return {
      id:          p.id as string,
      message:     (p.message as string) ?? '',
      createdTime: p.created_time as string,
      fullPicture: p.full_picture as string | undefined,
      permalink:   p.permalink_url as string | undefined,
      likes:       ((p.likes as { summary?: { total_count?: number } })?.summary?.total_count ?? 0),
      comments:    ((p.comments as { summary?: { total_count?: number } })?.summary?.total_count ?? 0),
      shares:      ((p.shares as { count?: number })?.count ?? 0),
      reach:       insVal('post_impressions'),
      clicks:      insVal('post_clicks_unique'),
    } as FacebookPost;
  });
}

/* ── Fetch comments on a post ───────────────────────────────────────────────── */
export async function fetchPostComments(postId: string, token: string): Promise<FacebookComment[]> {
  const data = await graphGet(`/${postId}/comments`, token, {
    fields: 'id,from,message,created_time,like_count,can_reply_privately',
    limit: '50',
    filter: 'stream',
  });

  return (data.data ?? []).map((c: Record<string, unknown>) => ({
    id:          c.id as string,
    postId,
    fromName:    ((c.from as { name?: string })?.name ?? 'Unknown'),
    fromId:      ((c.from as { id?: string })?.id ?? ''),
    message:     (c.message as string) ?? '',
    createdTime: c.created_time as string,
    likeCount:   (c.like_count as number) ?? 0,
    canReply:    true,
  } as FacebookComment));
}

/* ── Create Facebook post (via Cloud Function) ─────────────────────────────── */
export async function createFacebookPost(
  pageId: string,
  message: string,
  pageToken: string,
  imageUrl?: string,
): Promise<string> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<
    { pageId: string; message: string; pageToken: string; imageUrl?: string },
    { postId: string }
  >(fns, 'createFacebookPost');
  const res = await fn({ pageId, message, pageToken, imageUrl });
  return res.data.postId;
}

/* ── Types for Paid Ads Campaign ─────────────────────────────────────────── */
export interface FBAdsCampaignParams {
  adAccountId: string;
  pageId:      string;
  pageToken:   string;
  campaignName: string;
  objective:   string;
  budgetType:  'daily' | 'lifetime';
  budgetAmount: number;
  startTime?:  string;
  endTime?:    string;
  targeting: {
    countries:  string[];
    cities?:    { key: string; name: string }[];
    ageMin:     number;
    ageMax:     number;
    genders:    number[];
    interests:  { id: string; name: string }[];
  };
  adCreative: {
    headline:     string;
    primaryText:  string;
    imageUrl?:    string;
    callToAction: string;
    websiteUrl:   string;
  };
}

export interface FBAdsCampaignResult {
  campaignId:    string;
  adSetId:       string;
  creativeId:    string;
  adId:          string;
  adsManagerUrl: string;
}

/* ── Create paid Facebook Ads campaign ───────────────────────────────────── */
export async function createFacebookAdsCampaign(
  params: FBAdsCampaignParams,
): Promise<FBAdsCampaignResult> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<FBAdsCampaignParams, FBAdsCampaignResult>(fns, 'createFacebookAdsCampaign');
  const result = await fn(params);
  return result.data;
}

/* ── Create Instagram post via Meta Graph API ───────────────────────────── */
export async function createInstagramPost(
  igUserId:   string,
  caption:    string,
  pageToken:  string,
  imageUrl?:  string,
): Promise<string> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<Record<string, unknown>, { postId: string }>(fns, 'createInstagramPost');
  const result = await fn({ igUserId, caption, pageToken, ...(imageUrl && { imageUrl }) });
  return result.data.postId;
}

/* ── Reply to a comment (via Cloud Function) ───────────────────────────────── */
export async function replyToFacebookComment(
  commentId: string,
  message: string,
  pageToken: string,
): Promise<void> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<
    { commentId: string; message: string; pageToken: string },
    { success: boolean }
  >(fns, 'replyFacebookComment');
  await fn({ commentId, message, pageToken });
}

/* ── Get page insights ──────────────────────────────────────────────────────── */
export async function fetchPageInsights(pageId: string, token: string): Promise<PageInsights> {
  try {
    const [fansData, reachData] = await Promise.all([
      graphGet(`/${pageId}`, token, { fields: 'fan_count,followers_count' }),
      graphGet(`/${pageId}/insights`, token, {
        metric: 'page_impressions,page_engaged_users,page_views_total',
        period: 'month',
        limit: '1',
      }),
    ]);

    const insMap: Record<string, number> = {};
    for (const ins of (reachData.data ?? [])) {
      insMap[ins.name] = ins.values?.[1]?.value ?? ins.values?.[0]?.value ?? 0;
    }

    return {
      fans:        fansData.fan_count ?? 0,
      fansGrowth:  0,
      reach:       insMap['page_impressions']     ?? 0,
      impressions: insMap['page_impressions']     ?? 0,
      engagement:  insMap['page_engaged_users']   ?? 0,
      posts:       0,
    };
  } catch {
    return { fans: 0, fansGrowth: 0, reach: 0, impressions: 0, engagement: 0, posts: 0 };
  }
}

/* ── Fetch per-post metrics ─────────────────────────────────────────────────── */
export async function fetchPostMetrics(
  postId: string,
  token: string,
): Promise<{ likes: number; comments: number; shares: number; reach: number; updatedAt: number }> {
  try {
    const data = await graphGet(`/${postId}`, token, {
      fields: 'likes.summary(true),comments.summary(true),shares',
    });
    return {
      likes:    data.likes?.summary?.total_count    ?? 0,
      comments: data.comments?.summary?.total_count ?? 0,
      shares:   data.shares?.count                  ?? 0,
      reach:    0, // page-level reach needs insights.metric which requires additional permissions
      updatedAt: Date.now(),
    };
  } catch {
    return { likes: 0, comments: 0, shares: 0, reach: 0, updatedAt: Date.now() };
  }
}

/* ── AI: Generate post content ──────────────────────────────────────────────── */
export async function generatePostWithAI(
  topic: string,
  tone: string,
  businessContext: string,
  language: 'he' | 'en' = 'he',
): Promise<string> {
  const client = getAnthropicProxy();
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `אתה מומחה שיווק דיגיטלי. כתוב פוסט לפייסבוק.

עסק: ${businessContext || 'עסק מקצועי'}
נושא: ${topic}
טון: ${tone}
שפה: ${language === 'he' ? 'עברית' : 'אנגלית'}

הנחיות:
- פוסט קצר ומשפיע (3-5 שורות)
- שלב אימוג'י רלוונטיים
- סיים עם קריאה לפעולה ברורה
- אל תוסיף הסברים — רק את טקסט הפוסט עצמו`,
    }],
  });
  return resp?.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';
}

/* ── AI: Generate reply to comment ─────────────────────────────────────────── */
export async function generateCommentReplyWithAI(
  comment: FacebookComment,
  config: MarketingAgentConfig,
  businessContext: string,
): Promise<{ reply: string; confidence: number; uncertainties: string[] }> {
  const client = getAnthropicProxy();
  const toneMap = { professional: 'מקצועי', friendly: 'ידידותי', formal: 'פורמלי' };

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `אתה ${config.agentName || 'מנהל הדף'} של ${businessContext || 'עסק מקצועי'}.
ענה על תגובה בפייסבוק בטון ${toneMap[config.replyTone] || 'ידידותי'}.

תגובה מ-${comment.fromName}: "${comment.message}"

הנחיות:
- תשובה קצרה (1-2 משפטים)
- אישי ומתאים לפייסבוק
- אם שאלה — ענה מידע עסקי כללי
- אם תלונה — אמפתיה + פתרון
- חתימה: ${config.signature || config.agentName || 'הצוות שלנו'}

החזר JSON:
{"reply":"...", "confidence":85, "uncertainties":[]}`,
    }],
  });

  const text = resp?.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m?.[0] ?? '{}');
    return {
      reply:         p.reply ?? text,
      confidence:    Math.min(100, Math.max(0, p.confidence ?? 70)),
      uncertainties: p.uncertainties ?? [],
    };
  } catch {
    return { reply: text, confidence: 60, uncertainties: [] };
  }
}

/* ── Firestore: Marketing config ────────────────────────────────────────────── */
export async function loadMarketingConfig(wid: string): Promise<MarketingAgentConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'workspaces', wid, 'marketingAgent', 'config'));
    return snap.exists() ? (snap.data() as MarketingAgentConfig) : null;
  } catch { return null; }
}

export async function saveMarketingConfig(wid: string, cfg: MarketingAgentConfig): Promise<void> {
  await setDoc(doc(db, 'workspaces', wid, 'marketingAgent', 'config'), cfg);
}

/* ── Firestore: Comment drafts ──────────────────────────────────────────────── */
export async function loadCommentDrafts(wid: string): Promise<CommentDraft[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'workspaces', wid, 'marketingAgent', 'commentDrafts', 'items'),
        orderBy('createdAt', 'desc'),
        limit(100),
      )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CommentDraft));
  } catch { return []; }
}

export async function saveCommentDraft(wid: string, draft: Omit<CommentDraft, 'id'>): Promise<string> {
  const ref = await addDoc(
    collection(db, 'workspaces', wid, 'marketingAgent', 'commentDrafts', 'items'),
    draft,
  );
  return ref.id;
}

export async function updateCommentDraft(
  wid: string,
  draftId: string,
  updates: Partial<CommentDraft>,
): Promise<void> {
  await updateDoc(
    doc(db, 'workspaces', wid, 'marketingAgent', 'commentDrafts', 'items', draftId),
    updates,
  );
}

export async function deleteCommentDraft(wid: string, draftId: string): Promise<void> {
  await deleteDoc(
    doc(db, 'workspaces', wid, 'marketingAgent', 'commentDrafts', 'items', draftId),
  );
}

/* ── Firestore: Scheduled posts ─────────────────────────────────────────────── */
export async function loadScheduledPosts(wid: string): Promise<ScheduledPost[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'workspaces', wid, 'marketingAgent', 'scheduledPosts', 'items'),
        orderBy('scheduledTime', 'asc'),
      )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledPost));
  } catch { return []; }
}

export async function saveScheduledPost(wid: string, post: Omit<ScheduledPost, 'id'>): Promise<string> {
  const ref = await addDoc(
    collection(db, 'workspaces', wid, 'marketingAgent', 'scheduledPosts', 'items'),
    post,
  );
  return ref.id;
}

export async function updateScheduledPost(wid: string, id: string, updates: Partial<ScheduledPost>): Promise<void> {
  await updateDoc(
    doc(db, 'workspaces', wid, 'marketingAgent', 'scheduledPosts', 'items', id),
    updates,
  );
}

/* ── Process new comments with AI ───────────────────────────────────────────── */
export async function processCommentsWithAI(
  wid: string,
  comments: FacebookComment[],
  config: MarketingAgentConfig,
  businessContext: string,
  existingDraftIds: Set<string>,
): Promise<number> {
  let processed = 0;
  for (const comment of comments) {
    if (existingDraftIds.has(comment.id)) continue;
    try {
      const { reply, confidence, uncertainties } = await generateCommentReplyWithAI(
        comment, config, businessContext,
      );
      await saveCommentDraft(wid, {
        commentId:    comment.id,
        postId:       comment.postId,
        fromName:     comment.fromName,
        commentText:  comment.message,
        aiDraft:      reply,
        confidence,
        uncertainties,
        status:       'pending',
        createdAt:    Date.now(),
      });
      processed++;
    } catch (e) {
      console.error('Error processing comment:', e);
    }
  }
  return processed;
}
