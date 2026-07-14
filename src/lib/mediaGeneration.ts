/**
 * mediaGeneration.ts
 *
 * AI media generation helpers for the Marketing Agent.
 *
 * Supported engines:
 *  - Images  : Ideogram v2 (direct browser call with API key)
 *  - Video 1 : Kling  — realistic / cinematic (via Cloud Function)
 *  - Video 2 : Nano Banana (Runway-compatible) — animated / creative (via Cloud Function)
 *
 * Product profile learning:
 *  Firestore: workspaces/{wid}/marketingProfile  (singleton doc)
 *  Approved media is stored and used as context for future generations.
 */

import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAnthropicProxy } from './anthropicClient';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type VideoEngine  = 'kling' | 'nano-banana';
export type MediaType    = 'image' | 'video-kling' | 'video-nano';
export type VideoStyle   =
  | 'realistic'          // Kling
  | 'cinematic'          // Kling
  | 'product-showcase'   // Kling
  | 'animated'           // Nano Banana
  | 'social-ad'          // Nano Banana
  | 'creative';          // Nano Banana

export interface MediaKeys {
  ideogramKey?:      string;   // Ideogram image generation
  klingAccessKey?:   string;   // Kling AK
  klingSecretKey?:   string;   // Kling SK
  nanoBananaKey?:    string;   // Nano Banana / Runway key
  nanoBananaEndpoint?: string; // custom endpoint (optional)
}

export interface ApprovedMedia {
  id:               string;
  type:             MediaType;
  url:              string;
  thumbnailUrl?:    string;
  prompt:           string;
  style:            VideoStyle | 'image';
  engine:           'ideogram' | 'kling' | 'nano-banana';
  approvedAt:       number;
  campaignId?:      string;
}

export interface PostLearning {
  text:        string;   // published post text
  tone:        string;   // 'friendly' | 'professional' | 'formal'
  topic:       string;   // what the post was about
  platforms:   string[]; // where it was published
  mediaType?:  string;   // 'image' | 'video-kling' | 'video-nano'
  mediaUrl?:   string;
  publishedAt: number;
}

export interface ProductProfile {
  productName:          string;
  productDescription:   string;
  targetAudience:       string;
  brandColors:          string[];           // hex or description
  styleKeywords:        string[];           // 'minimalist', 'luxury', 'vibrant', …
  avoidKeywords:        string[];           // things NOT to show
  approvedMedia:        ApprovedMedia[];    // up to last 20 approved items
  rejectedPrompts:      string[];           // last 10 prompts user rejected
  publishedPosts:       PostLearning[];     // last 30 published posts (for learning)
  lastUpdated:          number;
}

export interface GeneratedMedia {
  type:         MediaType;
  url:          string;
  thumbnailUrl?: string;
  prompt:       string;
  engine:       'ideogram' | 'kling' | 'nano-banana';
  taskId?:      string;    // for polling
  generatedAt:  number;
}

export type GenerationStatus =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'polling'; taskId: string; progress: string }
  | { phase: 'done'; media: GeneratedMedia }
  | { phase: 'error'; message: string };

/* ── Engine routing ─────────────────────────────────────────────────────────── */

/** Decide which video engine to use based on desired style. */
export function selectVideoEngine(style: VideoStyle): VideoEngine {
  const klingStyles: VideoStyle[] = ['realistic', 'cinematic', 'product-showcase'];
  return klingStyles.includes(style) ? 'kling' : 'nano-banana';
}

/** Label for display */
export function engineLabel(engine: 'ideogram' | 'kling' | 'nano-banana'): string {
  return engine === 'ideogram'    ? 'Ideogram'
    : engine === 'kling'          ? 'Kling AI'
    : 'Nano Banana';
}

/* ── Image generation — Ideogram v2 ─────────────────────────────────────────── */

/**
 * Generate an image via the Ideogram v2 API (direct browser call).
 * Returns the first image URL.
 */
export async function generateImage(
  prompt:    string,
  apiKey:    string,
  aspect:    '1:1' | '16:9' | '9:16' = '1:1',
): Promise<string> {
  const ASPECT_MAP: Record<string, string> = {
    '1:1':  'ASPECT_1_1',
    '16:9': 'ASPECT_16_9',
    '9:16': 'ASPECT_9_16',
  };

  const res = await fetch('https://api.ideogram.ai/generate', {
    method:  'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_request: {
        prompt,
        aspect_ratio:     ASPECT_MAP[aspect],
        model:            'V_2',
        magic_prompt_option: 'AUTO',
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ideogram error: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const url  = data.data?.[0]?.url;
  if (!url) throw new Error('Ideogram returned no image URL');
  return url;
}

/* ── Kling video (via Cloud Function) ──────────────────────────────────────── */

const fns = () => getFunctions(undefined, 'us-central1');

export async function startKlingVideo(
  prompt:      string,
  duration:    5 | 10,
  aspectRatio: '16:9' | '9:16' | '1:1',
  mode:        'std' | 'pro',
  keys:        MediaKeys,
): Promise<string> {
  const fn = httpsCallable<object, { taskId: string }>(fns(), 'createKlingVideo');
  const { data } = await fn({
    prompt,
    duration,
    aspectRatio,
    mode,
    accessKey:  keys.klingAccessKey,
    secretKey:  keys.klingSecretKey,
  });
  return data.taskId;
}

export async function pollKlingVideo(
  taskId: string,
  keys:   MediaKeys,
): Promise<{ status: string; videoUrl: string | null; thumbnailUrl: string | null; progress: string }> {
  const fn = httpsCallable<object, {
    status: string; videoUrl: string | null; thumbnailUrl: string | null; progress: string
  }>(fns(), 'getKlingVideoStatus');
  const { data } = await fn({ taskId, accessKey: keys.klingAccessKey, secretKey: keys.klingSecretKey });
  return data;
}

/* ── Nano Banana video (via Cloud Function) ──────────────────────────────────── */

export async function startNanoBananaVideo(
  prompt:   string,
  keys:     MediaKeys,
  imageUrl?: string,
): Promise<string> {
  const fn = httpsCallable<object, { taskId: string }>(fns(), 'generateNanoBananaVideo');
  const { data } = await fn({
    prompt,
    imageUrl,
    duration: 4,
    apiKey:   keys.nanoBananaKey,
    endpoint: keys.nanoBananaEndpoint,
  });
  return data.taskId;
}

export async function pollNanoBananaVideo(
  taskId: string,
  keys:   MediaKeys,
): Promise<{ status: string; videoUrl: string | null; progress: number }> {
  const fn = httpsCallable<object, {
    status: string; videoUrl: string | null; progress: number
  }>(fns(), 'getNanoBananaStatus');
  const { data } = await fn({ taskId, apiKey: keys.nanoBananaKey, endpoint: keys.nanoBananaEndpoint });
  return data;
}

/* ── AI Prompt builder ──────────────────────────────────────────────────────── */

/**
 * Uses Claude to build an optimised prompt for media generation,
 * using the product profile and campaign goal as context.
 */
export async function buildMediaPrompt(
  campaignGoal: string,
  mediaType:    MediaType,
  style:        VideoStyle | 'image',
  profile:      ProductProfile | null,
): Promise<string> {
  const isFirstTime = !profile?.productName;

  const productCtx = profile?.productName
    ? [
        `Product: ${profile.productName}.`,
        profile.productDescription ? `Description: ${profile.productDescription}.` : '',
        profile.targetAudience ? `Target audience: ${profile.targetAudience}.` : '',
        profile.styleKeywords.length  ? `Brand style: ${profile.styleKeywords.join(', ')}.`  : '',
        profile.brandColors.length    ? `Brand colors: ${profile.brandColors.join(', ')}.`    : '',
        profile.avoidKeywords.length  ? `Avoid: ${profile.avoidKeywords.join(', ')}.`         : '',
        // Most recently approved media prompts — for style continuity
        profile.approvedMedia.length
          ? `Previously approved visuals (match this aesthetic):\n${
              profile.approvedMedia.slice(-5).map(m => `- "${m.prompt}"`).join('\n')}`
          : '',
        // Post history — infer tone/content preferences
        (profile.publishedPosts?.length ?? 0) > 0
          ? `Recent post topics (for context):\n${
              (profile.publishedPosts ?? []).slice(-5).map(p => `- "${p.topic}" (${p.tone})`).join('\n')}`
          : '',
      ].filter(Boolean).join(' ')
    : 'No product profile set. Create a visually appealing, professional marketing visual that would work for a generic business.';

  const mediaTypeLabel = mediaType === 'image'
    ? 'a marketing image'
    : mediaType === 'video-kling'
    ? 'a realistic/cinematic video (Kling)'
    : 'an animated/creative video (Nano Banana)';

  const styleHint = style === 'animated'         ? 'smooth animation, vibrant colors, motion graphics'
    : style === 'cinematic'        ? 'cinematic quality, dramatic lighting, film-like'
    : style === 'realistic'        ? 'photorealistic, high detail, natural lighting'
    : style === 'social-ad'        ? 'eye-catching, bold text-overlay friendly, social media optimised'
    : style === 'product-showcase' ? 'clean product shot, luxury feel, isolated subject'
    : 'creative, visually interesting, vibrant';

  const firstTimeHint = isFirstTime
    ? 'Since no brand profile exists yet, create something professional and versatile that would appeal broadly.'
    : '';

  const anthropic = getAnthropicProxy();
  const msg = await anthropic.messages.create({
    model:      'claude-3-haiku-20240307',
    max_tokens: 350,
    messages: [{
      role: 'user',
      content: `Write a concise, highly effective AI image/video generation prompt (max 250 chars) for ${mediaTypeLabel}.

Campaign goal: "${campaignGoal}"
Visual style: ${styleHint}
${productCtx}
${firstTimeHint}

Rules:
- Output ONLY the English prompt text
- No Hebrew, no quotes, no explanation
- Include visual details: lighting, composition, color palette, mood
- Optimise for the specific engine (${mediaType === 'image' ? 'Ideogram' : mediaType === 'video-kling' ? 'Kling' : 'Nano Banana'})`,
    }],
  });
  return (msg.content[0] as { text: string }).text.trim().slice(0, 450);
}

/* ── Record a published post (learning) ──────────────────────────────────────── */

export async function recordPublishedPost(wid: string, post: PostLearning): Promise<void> {
  try {
    const profile = await loadProductProfile(wid);
    const posts = [...(profile.publishedPosts ?? []), post].slice(-30);
    await setDoc(profileRef(wid), {
      publishedPosts: posts,
      lastUpdated: Date.now(),
    }, { merge: true });
  } catch (e) {
    console.warn('recordPublishedPost failed:', e);
  }
}

/* ── Product profile (Firestore) ─────────────────────────────────────────────── */

const profileRef = (wid: string) => doc(db, 'workspaces', wid, 'marketing', 'productProfile');

const DEFAULT_PROFILE: ProductProfile = {
  productName:        '',
  productDescription: '',
  targetAudience:     '',
  brandColors:        [],
  styleKeywords:      [],
  avoidKeywords:      [],
  approvedMedia:      [],
  rejectedPrompts:    [],
  publishedPosts:     [],
  lastUpdated:        0,
};

export async function loadProductProfile(wid: string): Promise<ProductProfile> {
  try {
    const snap = await getDoc(profileRef(wid));
    return snap.exists() ? { ...DEFAULT_PROFILE, ...snap.data() } as ProductProfile : { ...DEFAULT_PROFILE };
  } catch { return { ...DEFAULT_PROFILE }; }
}

export async function saveProductProfile(wid: string, profile: ProductProfile): Promise<void> {
  await setDoc(profileRef(wid), { ...profile, lastUpdated: Date.now() }, { merge: true });
}

/**
 * Record an approved media item into the product profile.
 * Keeps only the last 20 approved items.
 */
export async function recordApprovedMedia(wid: string, media: ApprovedMedia): Promise<void> {
  try {
    const profile = await loadProductProfile(wid);
    const updated = [...profile.approvedMedia, media].slice(-20);
    await setDoc(profileRef(wid), {
      approvedMedia: updated,
      lastUpdated:   Date.now(),
    }, { merge: true });
  } catch (e) {
    console.warn('recordApprovedMedia failed:', e);
  }
}

/**
 * Record a rejected prompt so the AI knows to avoid similar styles.
 */
export async function recordRejectedPrompt(wid: string, prompt: string): Promise<void> {
  try {
    await updateDoc(profileRef(wid), {
      rejectedPrompts: arrayUnion(prompt),
      lastUpdated:     Date.now(),
    });
  } catch { /* ignore */ }
}
