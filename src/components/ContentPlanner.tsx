/**
 * ContentPlanner.tsx
 *
 * "תוכנית תוכן" — a sub-tool inside the Marketing Agent → "פרסום ברשתות" hub.
 *
 * The user gives the AI a free-text prompt plus optional images and documents
 * (logos, product photos, brand guidelines, briefs) about the business, picks
 * whether they want a *posts plan* or a full *campaign plan*, and the AI returns
 * a structured plan that is rendered and saved to Firestore.
 *
 * Everything here is self-contained (own AI call + Storage-free base64 pipeline +
 * Firestore persistence) so the 7.6k-line MarketingAgent.tsx doesn't grow.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Calendar, Target, Sparkles, Image as ImageIcon, FileText, X, Loader2,
  Copy, Trash2, Plus, Check, ChevronLeft, Megaphone, Hash, Clock, Users,
  Lightbulb, TrendingUp, Wand2,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../lib/firebase';
import {
  collection, getDocs, query, orderBy, setDoc, doc, deleteDoc,
} from 'firebase/firestore';
import type { WorkspaceProfile } from '../types';
import type { ProductProfile } from '../lib/mediaGeneration';

/* ── Toast type (matches MarketingAgent) ──────────────────────────────────── */
type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

/* ── Plan data model ──────────────────────────────────────────────────────── */
type PlanKind = 'posts' | 'campaign';

interface PlannedPost {
  day:       number;          // 1-based index within the plan
  date?:     string;          // optional human label ("יום ב׳", "15/8")
  platform:  string;          // 'facebook' | 'instagram' | 'tiktok' | 'linkedin'
  format:    string;          // 'תמונה' | 'ריל' | 'סטורי' | 'קרוסלה' | 'סרטון'
  title:     string;          // the hook / theme of the post
  caption:   string;          // full ready-to-publish caption
  hashtags:  string[];
  mediaIdea: string;          // what visual to create
  cta:       string;
  bestTime?: string;
}

interface CampaignAdSet {
  name:          string;
  audience:      string;
  budgetShare:   string;      // "40%" or "₪1,200"
  placements:    string[];
  creativeAngle: string;
}

interface CampaignCreative {
  headline:    string;
  primaryText: string;
  cta:         string;
  mediaIdea:   string;
}

interface CampaignPlan {
  objective:   string;
  strategy:    string;
  totalBudget?: string;
  duration:    string;
  audiences:   string[];
  adSets:      CampaignAdSet[];
  creatives:   CampaignCreative[];
  kpis:        string[];
  timeline:    string[];
}

interface ContentPlan {
  id:        string;
  kind:      PlanKind;
  title:     string;
  prompt:    string;
  platforms: string[];
  createdAt: number;
  posts?:    PlannedPost[];    // when kind === 'posts'
  campaign?: CampaignPlan;     // when kind === 'campaign'
}

/* ── Input assets (in-memory only; used as AI input, not persisted) ───────── */
interface InputImage { id: string; name: string; dataUrl: string; mediaType: string; base64: string; }
interface InputDoc   { id: string; name: string; kind: 'pdf' | 'text'; base64?: string; text?: string; }

/* ── Platform metadata ────────────────────────────────────────────────────── */
const PLATFORM_META: Record<string, { label: string; emoji: string; color: string }> = {
  facebook:  { label: 'פייסבוק',  emoji: '📘', color: '#1877f2' },
  instagram: { label: 'אינסטגרם', emoji: '📸', color: '#e1306c' },
  tiktok:    { label: 'טיקטוק',   emoji: '🎵', color: '#ff0050' },
  linkedin:  { label: 'לינקדאין', emoji: '💼', color: '#0a66c2' },
};
const PLATFORM_OPTIONS = Object.keys(PLATFORM_META);

const platformLabel = (p: string) => PLATFORM_META[p]?.label ?? p;
const platformEmoji = (p: string) => PLATFORM_META[p]?.emoji ?? '📱';

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}
function fileToText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsText(file);
  });
}

/** Downscale an image data-URL to keep the AI payload small. */
function shrinkImage(dataUrl: string, maxSide = 1024): Promise<{ dataUrl: string; base64: string; mediaType: string }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve({ dataUrl, base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' }); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl: out, base64: out.split(',')[1] ?? '', mediaType: 'image/jpeg' });
    };
    img.onerror = () => resolve({ dataUrl, base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' });
    img.src = dataUrl;
  });
}

/* ── Props ────────────────────────────────────────────────────────────────── */
interface Props {
  wid?:            string;
  workspace?:      WorkspaceProfile;
  productProfile?: ProductProfile | null;
  onToast?:        ToastFn;
  language?:       'he' | 'en';
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function ContentPlanner({ wid, workspace, productProfile, onToast }: Props) {
  const { c: tc, isDark } = useTheme();

  /* ── Inputs ─────────────────────────────────────────────────────────────── */
  const [kind,      setKind]      = useState<PlanKind>('posts');
  const [prompt,    setPrompt]    = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'instagram']);
  const [postCount, setPostCount] = useState(8);
  const [tone,      setTone]      = useState<'friendly' | 'professional' | 'formal' | 'bold'>('friendly');
  const [budget,    setBudget]    = useState('5000');
  const [duration,  setDuration]  = useState('30');
  const [images,    setImages]    = useState<InputImage[]>([]);
  const [docs,      setDocs]      = useState<InputDoc[]>([]);

  /* ── Generation & data ──────────────────────────────────────────────────── */
  const [generating, setGenerating] = useState(false);
  const [progress,   setProgress]   = useState('');
  const [plans,      setPlans]      = useState<ContentPlan[]>([]);
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [loaded,     setLoaded]     = useState(false);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const activePlan = plans.find(p => p.id === activeId) ?? null;

  /* ── Load saved plans ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!wid || loaded) return;
    getDocs(query(collection(db, 'workspaces', wid, 'contentPlans'), orderBy('createdAt', 'desc')))
      .then(snap => setPlans(snap.docs.map(d => d.data() as ContentPlan)))
      .catch(err => console.error('[contentPlans load]', err))
      .finally(() => setLoaded(true));
  }, [wid, loaded]);

  /* ── Platform toggle ────────────────────────────────────────────────────── */
  const togglePlatform = (p: string) =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  /* ── Image upload ───────────────────────────────────────────────────────── */
  const handleImages = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 4 - images.length;
    if (room <= 0) { onToast?.('אפשר עד 4 תמונות', 'error'); return; }
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      if (!file.type.startsWith('image/')) { onToast?.(`${file.name} אינו תמונה`, 'error'); continue; }
      try {
        const raw = await fileToDataUrl(file);
        const { dataUrl, base64, mediaType } = await shrinkImage(raw);
        setImages(prev => [...prev, { id: `${Date.now()}-${file.name}`, name: file.name, dataUrl, base64, mediaType }]);
      } catch { onToast?.(`שגיאה בטעינת ${file.name}`, 'error'); }
    }
    if (imgInputRef.current) imgInputRef.current.value = '';
  }, [images.length, onToast]);

  /* ── Document upload ────────────────────────────────────────────────────── */
  const handleDocs = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const room = 3 - docs.length;
    if (room <= 0) { onToast?.('אפשר עד 3 מסמכים', 'error'); return; }
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      try {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          if (file.size > 10 * 1024 * 1024) { onToast?.(`${file.name}: PDF גדול מדי (מקס' 10MB)`, 'error'); continue; }
          const dataUrl = await fileToDataUrl(file);
          setDocs(prev => [...prev, { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'pdf', base64: dataUrl.split(',')[1] ?? '' }]);
        } else if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)) {
          const text = await fileToText(file);
          setDocs(prev => [...prev, { id: `${Date.now()}-${file.name}`, name: file.name, kind: 'text', text: text.slice(0, 12000) }]);
        } else {
          onToast?.(`${file.name}: נתמכים PDF / TXT בלבד (מסמכי Word — יש לייצא ל-PDF)`, 'error');
        }
      } catch { onToast?.(`שגיאה בטעינת ${file.name}`, 'error'); }
    }
    if (docInputRef.current) docInputRef.current.value = '';
  }, [docs.length, onToast]);

  /* ── Build business context from profile / workspace ────────────────────── */
  const businessContext = () => {
    const parts: string[] = [];
    if (productProfile?.productName)        parts.push(`שם העסק/המוצר: ${productProfile.productName}`);
    if (productProfile?.productDescription) parts.push(`תיאור: ${productProfile.productDescription}`);
    if (productProfile?.targetAudience)     parts.push(`קהל יעד: ${productProfile.targetAudience}`);
    if (productProfile?.styleKeywords?.length) parts.push(`סגנון מותג: ${productProfile.styleKeywords.join(', ')}`);
    if (productProfile?.avoidKeywords?.length) parts.push(`להימנע מ: ${productProfile.avoidKeywords.join(', ')}`);
    if (!parts.length && workspace?.prompt) parts.push(`תיאור העסק: ${workspace.prompt}`);
    if (workspace?.name && !productProfile?.productName) parts.push(`שם: ${workspace.name}`);
    if (workspace?.aiInstructions) parts.push(`הנחיות מותג: ${workspace.aiInstructions}`);
    return parts.join('\n');
  };

  /* ── Generate plan ──────────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (!prompt.trim()) { onToast?.('כתוב פרומפט שמתאר מה תרצה לקדם', 'error'); return; }
    if (platforms.length === 0) { onToast?.('בחר לפחות פלטפורמה אחת', 'error'); return; }
    setGenerating(true);
    setProgress('בונה את התוכנית...');
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();

      const toneLabel = tone === 'friendly' ? 'ידידותי וחם'
        : tone === 'professional' ? 'מקצועי'
        : tone === 'formal' ? 'רשמי' : 'נועז וקליט';
      const platLabels = platforms.map(platformLabel).join(', ');
      const ctx = businessContext();

      /* Schema differs by plan kind */
      const postsSchema = `{
  "title": "כותרת קצרה לתוכנית",
  "kind": "posts",
  "posts": [
    {
      "day": 1,
      "date": "תווית יום קצרה (למשל 'יום 1' או 'ב׳ 15/8')",
      "platform": "אחת מ: ${platforms.join(' | ')}",
      "format": "תמונה | קרוסלה | ריל | סטורי | סרטון",
      "title": "הוק/רעיון מרכזי של הפוסט",
      "caption": "טקסט פוסט מלא ומוכן לפרסום בעברית, כולל אמוג'י מתאימים",
      "hashtags": ["#תג1", "#תג2"],
      "mediaIdea": "תיאור ויזואלי מדויק ליצירת התמונה/וידאו",
      "cta": "קריאה לפעולה",
      "bestTime": "שעת פרסום מומלצת"
    }
  ]
}`;
      const campaignSchema = `{
  "title": "כותרת קצרה לקמפיין",
  "kind": "campaign",
  "campaign": {
    "objective": "מטרת הקמפיין (מודעות | לידים | מכירות | טראפיק ...)",
    "strategy": "פסקת אסטרטגיה קצרה",
    "totalBudget": "תקציב כולל בש\\"ח",
    "duration": "משך הקמפיין",
    "audiences": ["תיאור קהל 1", "תיאור קהל 2"],
    "adSets": [
      { "name": "שם קבוצת מודעות", "audience": "הקהל", "budgetShare": "אחוז/סכום מהתקציב", "placements": ["Feed","Stories","Reels"], "creativeAngle": "זווית קריאייטיב" }
    ],
    "creatives": [
      { "headline": "כותרת מודעה", "primaryText": "טקסט ראשי מלא בעברית", "cta": "כפתור פעולה", "mediaIdea": "תיאור ויזואל" }
    ],
    "kpis": ["מדד 1", "מדד 2"],
    "timeline": ["שלב 1 — ...", "שלב 2 — ..."]
  }
}`;

      const instruction = kind === 'posts'
        ? `בנה תוכנית פוסטים לרשתות חברתיות של בדיוק ${postCount} פוסטים לפלטפורמות: ${platLabels}. חלק את הפוסטים בין הפלטפורמות בצורה חכמה.`
        : `בנה תוכנית קמפיין ממומן מלאה לפלטפורמות: ${platLabels}, עם תקציב כולל של ${budget} ש"ח למשך ${duration} ימים.`;

      const schema = kind === 'posts' ? postsSchema : campaignSchema;

      const systemPrompt = `אתה אסטרטג שיווק דיגיטלי ומומחה לרשתות חברתיות ולפרסום ממומן (Meta/TikTok/LinkedIn). אתה כותב בעברית שיווקית, ממירה ומדויקת. אתה מקבל מידע על העסק (טקסט, תמונות, מסמכים) ומייצר תוכנית מעשית ומוכנה לביצוע. הטון הרצוי: ${toneLabel}.

עליך להחזיר אך ורק JSON תקין (ללא טקסט לפני או אחרי, ללא הסברים) התואם למבנה הבא בדיוק:
${schema}

חשוב: כל שדות הטקסט בעברית. אל תוסיף שדות שלא במבנה. החזר JSON בלבד.`;

      /* Build the user content: images → docs → text */
      const content: Array<Record<string, unknown>> = [];
      images.forEach(img =>
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } }));
      docs.forEach(d => {
        if (d.kind === 'pdf' && d.base64) {
          content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 } });
        } else if (d.kind === 'text' && d.text) {
          content.push({ type: 'text', text: `תוכן המסמך "${d.name}":\n${d.text}` });
        }
      });
      const userText = [
        ctx ? `מידע על העסק:\n${ctx}` : '',
        `בקשת המשתמש:\n${prompt.trim()}`,
        instruction,
        images.length ? `צורפו ${images.length} תמונות של המותג/המוצר — התייחס אליהן בתיאורי הויזואל.` : '',
        'החזר JSON בלבד לפי הסכימה.',
      ].filter(Boolean).join('\n\n');
      content.push({ type: 'text', text: userText });

      setProgress('ה-AI מנתח את החומרים ובונה תוכנית...');
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });

      const raw = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text ?? '';
      const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed: { title?: string; kind?: string; posts?: PlannedPost[]; campaign?: CampaignPlan };
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Attempt to salvage the JSON object substring
        const first = jsonStr.indexOf('{');
        const last  = jsonStr.lastIndexOf('}');
        if (first === -1 || last === -1) throw new Error('לא התקבל JSON תקין מה-AI');
        parsed = JSON.parse(jsonStr.slice(first, last + 1));
      }

      const id = `plan-${Date.now()}`;
      const record: ContentPlan = {
        id,
        kind,
        title: parsed.title?.trim() || (kind === 'posts' ? 'תוכנית פוסטים' : 'תוכנית קמפיין'),
        prompt: prompt.trim(),
        platforms: [...platforms],
        createdAt: Date.now(),
        ...(kind === 'posts'    && parsed.posts    ? { posts: parsed.posts }       : {}),
        ...(kind === 'campaign' && parsed.campaign ? { campaign: parsed.campaign } : {}),
      };

      if (kind === 'posts' && (!record.posts || record.posts.length === 0)) throw new Error('התוכנית חזרה ריקה');
      if (kind === 'campaign' && !record.campaign) throw new Error('התוכנית חזרה ריקה');

      setPlans(prev => [record, ...prev]);
      setActiveId(id);
      if (wid) {
        setDoc(doc(db, 'workspaces', wid, 'contentPlans', id), record)
          .catch(err => console.error('[contentPlans save]', err));
      }
      onToast?.(kind === 'posts' ? '📅 תוכנית הפוסטים מוכנה!' : '🎯 תוכנית הקמפיין מוכנה!', 'success');
    } catch (err) {
      console.error('[content plan]', err);
      onToast?.(`שגיאה ביצירת התוכנית: ${(err as Error).message}`, 'error');
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  /* ── Delete plan ────────────────────────────────────────────────────────── */
  const handleDelete = (id: string) => {
    setPlans(prev => prev.filter(p => p.id !== id));
    if (activeId === id) setActiveId(null);
    if (wid) deleteDoc(doc(db, 'workspaces', wid, 'contentPlans', id)).catch(console.error);
  };

  /* ── Copy helper ────────────────────────────────────────────────────────── */
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => onToast?.('הועתק ללוח 📋', 'success'),
      () => onToast?.('לא ניתן להעתיק', 'error'),
    );
  };

  /* ── Styling shortcuts ──────────────────────────────────────────────────── */
  const card = {
    background: isDark ? 'rgba(255,255,255,0.03)' : '#fff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
  };

  /* ══════════════════════════════════════════════════════════════════════ */
  /* Active plan detail view                                                   */
  /* ══════════════════════════════════════════════════════════════════════ */
  if (activePlan) {
    return (
      <div className="space-y-4" dir="rtl">
        <button
          onClick={() => setActiveId(null)}
          className="flex items-center gap-1.5 text-sm font-medium hover:underline"
          style={{ color: tc.textMuted }}
        >
          <ChevronLeft size={16} /> חזרה לכל התוכניות
        </button>

        <div className="rounded-2xl p-5" style={card}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: activePlan.kind === 'posts' ? 'linear-gradient(135deg,#7c3aed,#6366f1)' : 'linear-gradient(135deg,#f59e0b,#ef4444)' }}>
                {activePlan.kind === 'posts' ? <Calendar size={20} className="text-white" /> : <Target size={20} className="text-white" />}
              </div>
              <div>
                <h3 className="font-black text-lg" style={{ color: tc.textPrimary }}>{activePlan.title}</h3>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {activePlan.platforms.map(p => (
                    <span key={p} className="text-[11px]">{platformEmoji(p)} {platformLabel(p)}</span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => handleDelete(activePlan.id)}
              className="p-2 rounded-xl hover:bg-red-500/10 text-red-500 transition-colors flex-shrink-0">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* ── Posts plan ─────────────────────────────────────────────────── */}
        {activePlan.kind === 'posts' && activePlan.posts && (
          <div className="space-y-3">
            {activePlan.posts.map((post, i) => (
              <div key={i} className="rounded-2xl p-4" style={card}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg"
                      style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
                      {post.date || `יום ${post.day}`}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg"
                      style={{ background: `${PLATFORM_META[post.platform]?.color ?? '#64748b'}1f`, color: PLATFORM_META[post.platform]?.color ?? '#64748b' }}>
                      {platformEmoji(post.platform)} {platformLabel(post.platform)}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-lg"
                      style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: tc.textMuted }}>
                      {post.format}
                    </span>
                    {post.bestTime && (
                      <span className="text-[11px] flex items-center gap-1" style={{ color: tc.textMuted }}>
                        <Clock size={11} /> {post.bestTime}
                      </span>
                    )}
                  </div>
                  <button onClick={() => copy(`${post.caption}\n\n${(post.hashtags || []).join(' ')}`)}
                    className="p-1.5 rounded-lg hover:bg-indigo-500/10 text-indigo-500 transition-colors flex-shrink-0"
                    title="העתק פוסט">
                    <Copy size={14} />
                  </button>
                </div>

                {post.title && <p className="font-bold text-sm mb-1" style={{ color: tc.textPrimary }}>{post.title}</p>}
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: tc.textPrimary }}>{post.caption}</p>

                {post.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {post.hashtags.map((h, j) => (
                      <span key={j} className="text-[11px]" style={{ color: '#6366f1' }}>{h.startsWith('#') ? h : `#${h}`}</span>
                    ))}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-2 mt-3">
                  {post.mediaIdea && (
                    <div className="rounded-xl p-2.5 flex items-start gap-2"
                      style={{ background: isDark ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.05)' }}>
                      <ImageIcon size={13} className="text-violet-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-violet-500">רעיון ויזואלי</p>
                        <p className="text-[11px]" style={{ color: tc.textMuted }}>{post.mediaIdea}</p>
                      </div>
                    </div>
                  )}
                  {post.cta && (
                    <div className="rounded-xl p-2.5 flex items-start gap-2"
                      style={{ background: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)' }}>
                      <TrendingUp size={13} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-emerald-500">קריאה לפעולה</p>
                        <p className="text-[11px]" style={{ color: tc.textMuted }}>{post.cta}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Campaign plan ──────────────────────────────────────────────── */}
        {activePlan.kind === 'campaign' && activePlan.campaign && (
          <CampaignPlanView plan={activePlan.campaign} tc={tc} isDark={isDark} card={card} copy={copy} />
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* Builder + saved plans                                                     */
  /* ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-4" dir="rtl">
      {/* Intro */}
      <div className="text-center py-1">
        <p className="font-black text-xl flex items-center justify-center gap-2" style={{ color: tc.textPrimary }}>
          <Wand2 size={20} className="text-violet-500" /> מתכנן התוכן החכם
        </p>
        <p className="text-sm mt-1" style={{ color: tc.textMuted }}>
          תן ל-AI פרומפט, תמונות ומסמכים על העסק — והוא יבנה לך תוכנית פוסטים או תוכנית קמפיין מלאה
        </p>
      </div>

      {/* Builder card */}
      <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={card}>
        {/* Kind toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setKind('posts')}
            className="p-3 rounded-2xl border-2 text-right transition-all"
            style={kind === 'posts'
              ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.08)' }
              : { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', background: 'transparent' }}
          >
            <Calendar size={18} className="text-indigo-500 mb-1" />
            <div className="font-black text-sm" style={{ color: tc.textPrimary }}>תוכנית פוסטים</div>
            <div className="text-[11px]" style={{ color: tc.textMuted }}>לוח תוכן אורגני לרשתות</div>
          </button>
          <button
            onClick={() => setKind('campaign')}
            className="p-3 rounded-2xl border-2 text-right transition-all"
            style={kind === 'campaign'
              ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.08)' }
              : { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', background: 'transparent' }}
          >
            <Target size={18} className="text-amber-500 mb-1" />
            <div className="font-black text-sm" style={{ color: tc.textPrimary }}>תוכנית קמפיין</div>
            <div className="text-[11px]" style={{ color: tc.textMuted }}>אסטרטגיית פרסום ממומן</div>
          </button>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>
            ספר ל-AI על העסק ומה תרצה לקדם *
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            placeholder="לדוגמה: אנחנו מותג קפה בוטיק בתל אביב. אנחנו משיקים סדרת קפה חדשה ורוצים להגדיל מודעות ומכירות בקרב צעירים 25-40..."
            className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none"
            style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }}
          />
        </div>

        {/* Platforms */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: tc.textMuted }}>פלטפורמות</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map(p => {
              const active = platforms.includes(p);
              return (
                <button key={p} onClick={() => togglePlatform(p)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border"
                  style={active
                    ? { background: `${PLATFORM_META[p].color}1f`, color: PLATFORM_META[p].color, borderColor: PLATFORM_META[p].color }
                    : { background: 'transparent', color: tc.textMuted, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  {active && <Check size={12} />} {platformEmoji(p)} {platformLabel(p)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Kind-specific options */}
        {kind === 'posts' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>מספר פוסטים</label>
              <input type="number" min={1} max={16} value={postCount}
                onChange={e => setPostCount(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>טון</label>
              <select value={tone} onChange={e => setTone(e.target.value as typeof tone)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }}>
                <option value="friendly">ידידותי וחם</option>
                <option value="professional">מקצועי</option>
                <option value="formal">רשמי</option>
                <option value="bold">נועז וקליט</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>תקציב כולל (₪)</label>
              <input type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>משך (ימים)</label>
              <input type="number" min={1} value={duration} onChange={e => setDuration(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }} />
            </div>
          </div>
        )}

        {/* Attachments */}
        <div className="grid sm:grid-cols-2 gap-3">
          {/* Images */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: tc.textMuted }}>תמונות מותג/מוצר (עד 4)</label>
            <input ref={imgInputRef} type="file" accept="image/*" multiple hidden onChange={e => handleImages(e.target.files)} />
            <div className="flex flex-wrap gap-2">
              {images.map(img => (
                <div key={img.id} className="relative w-16 h-16 rounded-xl overflow-hidden border" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                  <button onClick={() => setImages(prev => prev.filter(x => x.id !== img.id))}
                    className="absolute top-0.5 left-0.5 bg-black/60 rounded-full p-0.5">
                    <X size={11} className="text-white" />
                  </button>
                </div>
              ))}
              {images.length < 4 && (
                <button onClick={() => imgInputRef.current?.click()}
                  className="w-16 h-16 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors hover:border-indigo-400"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', color: tc.textMuted }}>
                  <Plus size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Documents */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: tc.textMuted }}>מסמכים — PDF / TXT (עד 3)</label>
            <input ref={docInputRef} type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain" multiple hidden onChange={e => handleDocs(e.target.files)} />
            <div className="space-y-1.5">
              {docs.map(d => (
                <div key={d.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs"
                  style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color: tc.textPrimary }}>
                  <FileText size={13} className="text-indigo-500 flex-shrink-0" />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className="text-[9px] uppercase" style={{ color: tc.textMuted }}>{d.kind}</span>
                  <button onClick={() => setDocs(prev => prev.filter(x => x.id !== d.id))}><X size={12} className="text-slate-400" /></button>
                </div>
              ))}
              {docs.length < 3 && (
                <button onClick={() => docInputRef.current?.click()}
                  className="w-full py-2 rounded-xl border-2 border-dashed text-xs flex items-center justify-center gap-1.5 transition-colors hover:border-indigo-400"
                  style={{ borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', color: tc.textMuted }}>
                  <Plus size={14} /> הוסף מסמך
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Business context hint */}
        {productProfile?.productName && (
          <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-xl"
            style={{ background: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)', color: '#10b981' }}>
            <Lightbulb size={13} /> ה-AI כבר מכיר את "{productProfile.productName}" וישתמש במידע הזה אוטומטית
          </div>
        )}

        {/* Generate */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full py-3 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
          style={{ background: kind === 'posts' ? 'linear-gradient(135deg,#7c3aed,#6366f1)' : 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
        >
          {generating ? <><Loader2 size={16} className="animate-spin" /> {progress || 'מייצר...'}</>
            : <><Sparkles size={16} /> {kind === 'posts' ? 'צור תוכנית פוסטים' : 'צור תוכנית קמפיין'}</>}
        </button>
      </div>

      {/* Saved plans */}
      {plans.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold px-1" style={{ color: tc.textMuted }}>התוכניות שלי ({plans.length})</p>
          {plans.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)}
              className="w-full rounded-2xl p-3 flex items-center gap-3 text-right transition-all hover:scale-[1.01]" style={card}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: p.kind === 'posts' ? 'linear-gradient(135deg,#7c3aed,#6366f1)' : 'linear-gradient(135deg,#f59e0b,#ef4444)' }}>
                {p.kind === 'posts' ? <Calendar size={16} className="text-white" /> : <Megaphone size={16} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color: tc.textPrimary }}>{p.title}</p>
                <p className="text-[11px]" style={{ color: tc.textMuted }}>
                  {p.kind === 'posts' ? `${p.posts?.length ?? 0} פוסטים` : 'קמפיין ממומן'} · {p.platforms.map(platformEmoji).join(' ')} · {new Date(p.createdAt).toLocaleDateString('he-IL')}
                </p>
              </div>
              <ChevronLeft size={16} style={{ color: tc.textMuted }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Campaign plan renderer ───────────────────────────────────────────────── */
function CampaignPlanView({
  plan, tc, isDark, card, copy,
}: {
  plan: CampaignPlan;
  tc: { textPrimary: string; textMuted: string };
  isDark: boolean;
  card: React.CSSProperties;
  copy: (t: string) => void;
}) {
  const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
    <div className="rounded-2xl p-4" style={card}>
      <div className="flex items-center gap-2 mb-2.5">
        {icon}
        <h4 className="font-black text-sm" style={{ color: tc.textPrimary }}>{title}</h4>
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      <Section icon={<Target size={16} className="text-amber-500" />} title="מטרה ואסטרטגיה">
        <p className="text-sm font-semibold mb-1" style={{ color: tc.textPrimary }}>{plan.objective}</p>
        <p className="text-sm leading-relaxed" style={{ color: tc.textMuted }}>{plan.strategy}</p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {plan.totalBudget && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              💰 {plan.totalBudget}
            </span>
          )}
          {plan.duration && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>
              ⏱ {plan.duration}
            </span>
          )}
        </div>
      </Section>

      {plan.audiences?.length > 0 && (
        <Section icon={<Users size={16} className="text-indigo-500" />} title="קהלי יעד">
          <div className="space-y-1.5">
            {plan.audiences.map((a, i) => (
              <div key={i} className="text-sm flex items-start gap-2" style={{ color: tc.textPrimary }}>
                <span className="text-indigo-500 mt-0.5">•</span> {a}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.adSets?.length > 0 && (
        <Section icon={<Hash size={16} className="text-violet-500" />} title={`קבוצות מודעות (${plan.adSets.length})`}>
          <div className="space-y-2.5">
            {plan.adSets.map((s, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: isDark ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.04)' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-bold text-sm" style={{ color: tc.textPrimary }}>{s.name}</p>
                  {s.budgetShare && <span className="text-xs font-bold text-violet-500">{s.budgetShare}</span>}
                </div>
                <p className="text-xs mb-1" style={{ color: tc.textMuted }}>🎯 {s.audience}</p>
                {s.creativeAngle && <p className="text-xs mb-1" style={{ color: tc.textMuted }}>💡 {s.creativeAngle}</p>}
                {s.placements?.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    {s.placements.map((p, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: tc.textMuted }}>{p}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.creatives?.length > 0 && (
        <Section icon={<ImageIcon size={16} className="text-emerald-500" />} title={`קריאייטיבים (${plan.creatives.length})`}>
          <div className="space-y-2.5">
            {plan.creatives.map((cr, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)' }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-sm" style={{ color: tc.textPrimary }}>{cr.headline}</p>
                  <button onClick={() => copy(`${cr.headline}\n\n${cr.primaryText}`)}
                    className="p-1 rounded-lg hover:bg-emerald-500/10 text-emerald-500 flex-shrink-0"><Copy size={13} /></button>
                </div>
                <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: tc.textPrimary }}>{cr.primaryText}</p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {cr.cta && <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>{cr.cta}</span>}
                  {cr.mediaIdea && <span className="text-[11px]" style={{ color: tc.textMuted }}>🎨 {cr.mediaIdea}</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.timeline?.length > 0 && (
        <Section icon={<Clock size={16} className="text-blue-500" />} title="ציר זמן">
          <div className="space-y-1.5">
            {plan.timeline.map((t, i) => (
              <div key={i} className="text-sm flex items-start gap-2" style={{ color: tc.textPrimary }}>
                <span className="text-blue-500 font-bold">{i + 1}.</span> {t}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.kpis?.length > 0 && (
        <Section icon={<TrendingUp size={16} className="text-rose-500" />} title="מדדי הצלחה (KPIs)">
          <div className="flex flex-wrap gap-2">
            {plan.kpis.map((k, i) => (
              <span key={i} className="text-xs px-2.5 py-1 rounded-lg" style={{ background: isDark ? 'rgba(244,63,94,0.1)' : 'rgba(244,63,94,0.06)', color: '#f43f5e' }}>{k}</span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
