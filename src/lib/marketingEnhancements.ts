/**
 * marketingEnhancements.ts
 * Extra AI-powered features for the Marketing Agent
 */
import { getAnthropicProxy } from './anthropicClient';
import { db } from './firebase';
import {
  collection, addDoc, getDocs, query, orderBy,
  doc, updateDoc, deleteDoc,
} from 'firebase/firestore';

/* ── Types ──────────────────────────────────────────────────────────────── */
export interface CopyItem {
  id: string;
  platform: string;
  type: 'headline' | 'body' | 'cta' | 'caption' | 'hook';
  text: string;
  tags: string[];
  performance?: 'great' | 'good' | 'average' | 'poor';
  usageCount: number;
  createdAt: number;
}

export interface AudienceProfile {
  id: string;
  name: string;
  description: string;
  ageRange: string;
  gender: string;
  interests: string[];
  behaviors: string[];
  locations: string[];
  estimatedSize: string;
  platform: string;
  type: 'custom' | 'lookalike' | 'interest' | 'retargeting';
  createdAt: number;
}

export interface CompetitorAd {
  id: string;
  competitorName: string;
  pageName: string;
  adText: string;
  imageUrl?: string;
  startDate: string;
  platforms: string[];
  cta?: string;
  analysis?: string;
  savedAt: number;
}

export interface UnifiedPerformance {
  platform: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number;  // cost per lead
  ctr: number;  // click through rate %
  period: string;
}

export interface CampaignBrief {
  id: string;
  name: string;
  goal: string;
  targetAudience: string;
  keyMessage: string;
  platforms: string[];
  budget: number;
  startDate: string;
  endDate: string;
  kpis: string[];
  adCopy: string;
  visualConcept: string;
  createdAt: number;
}

/* ── Copy Library ─────────────────────────────────────────────────────── */
const copyCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'marketing', 'copy', 'items');
const copyDoc = (wid: string, id: string) =>
  doc(db, 'workspaces', wid, 'marketing', 'copy', 'items', id);

export async function loadCopyLibrary(wid: string): Promise<CopyItem[]> {
  try {
    const snap = await getDocs(query(copyCol(wid), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CopyItem));
  } catch { return []; }
}

function stripUndef<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

export async function saveCopyItem(wid: string, item: Omit<CopyItem, 'id'>): Promise<string> {
  const ref = await addDoc(copyCol(wid), stripUndef(item));
  return ref.id;
}

export async function updateCopyItem(wid: string, id: string, updates: Partial<CopyItem>) {
  await updateDoc(copyDoc(wid, id), updates);
}

export async function deleteCopyItem(wid: string, id: string) {
  await deleteDoc(copyDoc(wid, id));
}

/* ── AI: Generate ad copy variations ─────────────────────────────────── */
export async function generateAdCopyVariations(
  product: string,
  audience: string,
  platform: string,
  goal: string,
  type: CopyItem['type'],
  count = 5,
): Promise<string[]> {
  const anthropic = getAnthropicProxy();
  const platformGuide: Record<string, string> = {
    facebook: 'פייסבוק: מקסימום 125 תווים לכותרת, שפה ישירה וחברותית',
    instagram: 'אינסטגרם: קצר, ויזואלי, עם אמוג׳י, וhook חזק בשורה הראשונה',
    google: 'גוגל: מקסימום 30 תווים לכותרת, מילות מפתח, ערך ברור',
    whatsapp: 'וואטסאפ: אישי, קצר, CTA ברור',
  };
  const typeGuide: Record<string, string> = {
    headline: 'כותרת ראשית — מושכת תשומת לב',
    body: 'גוף טקסט — מסביר את הערך',
    cta: 'קריאה לפעולה — כפתור או הנחיה ספציפית',
    caption: 'כיתוב לתמונה — קצר ומשלים',
    hook: 'hook פותח — שורה ראשונה שמונעת גלילה',
  };

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `צור ${count} וריאציות של ${typeGuide[type]} לפרסומת.

מוצר/שירות: ${product}
קהל יעד: ${audience}
פלטפורמה: ${platformGuide[platform] || platform}
מטרה: ${goal}

החזר JSON בלבד — מערך של strings:
["וריאציה 1", "וריאציה 2", ...]

כל וריאציה צריכה להיות שונה בגישה ובסגנון.`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]';
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch { return []; }
}

/* ── AI: Generate campaign brief ─────────────────────────────────────── */
export async function generateCampaignBrief(
  product: string,
  goal: string,
  audience: string,
  budget: number,
  businessDescription: string,
): Promise<Omit<CampaignBrief, 'id' | 'createdAt'>> {
  const anthropic = getAnthropicProxy();
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `צור בריף קמפיין שיווקי מקצועי.

מוצר: ${product}
מטרה: ${goal}
קהל יעד: ${audience}
תקציב כולל: ${budget}₪
תיאור עסק: ${businessDescription}

החזר JSON בלבד:
{
  "name": "שם הקמפיין",
  "goal": "${goal}",
  "targetAudience": "תיאור מפורט של קהל היעד",
  "keyMessage": "המסר המרכזי שהקמפיין יעביר",
  "platforms": ["facebook", "instagram"],
  "budget": ${budget},
  "startDate": "2024-01-15",
  "endDate": "2024-02-15",
  "kpis": ["עלות ליד מתחת ל-X", "X לידים", "X% CTR"],
  "adCopy": "טקסט פרסומת מלא",
  "visualConcept": "רעיון ויזואלי לתמונה/וידאו"
}`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch { return { name: '', goal, targetAudience: audience, keyMessage: '', platforms: [], budget, startDate: '', endDate: '', kpis: [], adCopy: '', visualConcept: '' }; }
}

/* ── AI: Budget optimization recommendation ───────────────────────────── */
export async function getBudgetRecommendation(
  campaigns: { name: string; platform: string; spend: number; leads: number; cpl: number }[],
  totalBudget: number,
): Promise<{ recommendations: { platform: string; currentSpend: number; recommendedSpend: number; reason: string }[]; summary: string }> {
  const anthropic = getAnthropicProxy();
  const campSummary = campaigns.map(c =>
    `${c.name} (${c.platform}): הוצאה ${c.spend}₪, ${c.leads} לידים, עלות ליד ${c.cpl}₪`
  ).join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `נתח את ביצועי הקמפיינים וספק המלצות תקציב.

קמפיינים:
${campSummary}

תקציב כולל: ${totalBudget}₪

החזר JSON:
{
  "recommendations": [
    {"platform": "...", "currentSpend": 0, "recommendedSpend": 0, "reason": "..."}
  ],
  "summary": "סיכום ההמלצות בשניים-שלושה משפטים"
}`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { recommendations: [], summary: '' };
  } catch { return { recommendations: [], summary: '' }; }
}

/* ── AI: Analyze campaign performance & insights ───────────────────────── */
export async function getAIInsights(
  campaigns: { name: string; platform: string; impressions: number; clicks: number; leads: number; spend: number }[],
  businessDescription: string,
): Promise<string[]> {
  if (!campaigns.length) return [];
  const anthropic = getAnthropicProxy();
  const summary = campaigns.map(c =>
    `${c.name}: ${c.impressions} חשיפות, ${c.clicks} קליקים, ${c.leads} לידים, ${c.spend}₪`
  ).join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `נתח את ביצועי הקמפיינים ותן 4-5 תובנות ספציפיות.
עסק: ${businessDescription}
נתונים:
${summary}
החזר JSON: {"insights": ["תובנה 1", "תובנה 2", ...]}`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    return parsed.insights ?? [];
  } catch { return []; }
}

/* ── AI: Build audience profile ───────────────────────────────────────── */
export async function buildAudienceWithAI(
  product: string,
  goal: string,
  existingCustomers: string,
): Promise<Omit<AudienceProfile, 'id' | 'createdAt'>> {
  const anthropic = getAnthropicProxy();
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `בנה פרופיל קהל יעד אידיאלי לפרסומות.
מוצר: ${product}
מטרה: ${goal}
לקוחות קיימים: ${existingCustomers}

החזר JSON:
{
  "name": "שם הקהל",
  "description": "תיאור",
  "ageRange": "25-45",
  "gender": "כל המינים / נשים / גברים",
  "interests": ["עניין 1", "עניין 2"],
  "behaviors": ["התנהגות 1"],
  "locations": ["ישראל"],
  "estimatedSize": "100K-500K",
  "platform": "facebook",
  "type": "interest"
}`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { name: '', description: '', ageRange: '', gender: '', interests: [], behaviors: [], locations: [], estimatedSize: '', platform: 'facebook', type: 'interest' };
  } catch { return { name: '', description: '', ageRange: '', gender: '', interests: [], behaviors: [], locations: [], estimatedSize: '', platform: 'facebook', type: 'interest' }; }
}

/* ── Audiences CRUD ───────────────────────────────────────────────────── */
const audiencesCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'marketing', 'audiences', 'items');
const audienceDoc = (wid: string, id: string) =>
  doc(db, 'workspaces', wid, 'marketing', 'audiences', 'items', id);

export async function loadAudiences(wid: string): Promise<AudienceProfile[]> {
  try {
    const snap = await getDocs(query(audiencesCol(wid), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AudienceProfile));
  } catch { return []; }
}
export async function saveAudience(wid: string, a: Omit<AudienceProfile, 'id'>): Promise<string> {
  const ref = await addDoc(audiencesCol(wid), a);
  return ref.id;
}
export async function deleteAudience(wid: string, id: string) {
  await deleteDoc(audienceDoc(wid, id));
}

/* ── Competitor Ads ───────────────────────────────────────────────────── */
const competitorCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'marketing', 'competitors', 'items');
const competitorDoc = (wid: string, id: string) =>
  doc(db, 'workspaces', wid, 'marketing', 'competitors', 'items', id);

export async function loadCompetitorAds(wid: string): Promise<CompetitorAd[]> {
  try {
    const snap = await getDocs(query(competitorCol(wid), orderBy('savedAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CompetitorAd));
  } catch { return []; }
}
export async function saveCompetitorAd(wid: string, ad: Omit<CompetitorAd, 'id'>): Promise<string> {
  const ref = await addDoc(competitorCol(wid), ad);
  return ref.id;
}
export async function deleteCompetitorAd(wid: string, id: string) {
  await deleteDoc(competitorDoc(wid, id));
}

/* ── AI: Analyze competitor ad ───────────────────────────────────────── */
export async function analyzeCompetitorAd(adText: string, yourProduct: string): Promise<string> {
  const anthropic = getAnthropicProxy();
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `נתח את פרסומת המתחרה ותן תובנות.
פרסומת: "${adText}"
המוצר שלי: ${yourProduct}

ספק:
1. מה חזק בפרסומת
2. מה חלש / חסר
3. איך אני יכול לעשות טוב יותר
4. מה אני יכול ללמוד ממנה`,
    }],
  });
  return msg.content[0].type === 'text' ? msg.content[0].text : '';
}

/* ── AI: Generate retargeting campaign idea ──────────────────────────── */
export async function generateRetargetingIdea(
  product: string,
  audience: string,
  businessDescription: string,
): Promise<{ headline: string; body: string; cta: string; targetSegment: string }> {
  const anthropic = getAnthropicProxy();
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `צור רעיון לקמפיין רטארגטינג.
מוצר: ${product}
קהל: ${audience}
עסק: ${businessDescription}

החזר JSON:
{
  "headline": "כותרת לפרסומת",
  "body": "טקסט הפרסומת",
  "cta": "טקסט הכפתור",
  "targetSegment": "מי בדיוק לטרגט (ביקרו באתר / הוסיפו לסל / )"
}`,
    }],
  });
  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { headline: '', body: '', cta: '', targetSegment: '' };
  } catch { return { headline: '', body: '', cta: '', targetSegment: '' }; }
}

/* ── Campaign Briefs CRUD ─────────────────────────────────────────────── */
const briefsCol = (wid: string) =>
  collection(db, 'workspaces', wid, 'marketing', 'briefs', 'items');

export async function loadBriefs(wid: string): Promise<CampaignBrief[]> {
  try {
    const snap = await getDocs(query(briefsCol(wid), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as CampaignBrief));
  } catch { return []; }
}
export async function saveBrief(wid: string, brief: Omit<CampaignBrief, 'id'>): Promise<string> {
  const ref = await addDoc(briefsCol(wid), brief);
  return ref.id;
}
export async function deleteBrief(wid: string, id: string) {
  await deleteDoc(doc(briefsCol(wid), id));
}
