import { useState, useCallback, useRef, useMemo } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import {
  Sparkles, Copy, Check, Loader2, Layers,
  FileText, Image, CalendarDays, Target, RefreshCw, Download,
} from 'lucide-react';
import { getApiKey, getOpenAiKey, API_KEY_ERROR } from '../lib/apiKey';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ClientBrief {
  company: string;
  niche: string;
  targetAudience: string;
  demographics: string;
  painPoints: string;
  usp: string;
  brandVoice: 'professional' | 'fun' | 'bold' | 'warm';
  goals: string[];
  language: 'he' | 'en';
}

type TabId = 'posts' | 'visuals' | 'calendar' | 'ads';

interface SectionState {
  content: string;
  loading: boolean;
  done: boolean;
}

const EMPTY: SectionState = { content: '', loading: false, done: false };
const EMPTY_SECTIONS: Record<TabId, SectionState> = {
  posts: { ...EMPTY }, visuals: { ...EMPTY }, calendar: { ...EMPTY }, ads: { ...EMPTY },
};

// ─── Constants ────────────────────────────────────────────────────────────────
const VOICE_OPTIONS = [
  { id: 'professional' as const, label: 'מקצועי', emoji: '💼' },
  { id: 'fun'          as const, label: 'כיפי',   emoji: '🎉' },
  { id: 'bold'         as const, label: 'נועז',   emoji: '🔥' },
  { id: 'warm'         as const, label: 'חמים',   emoji: '🤝' },
];

const GOAL_OPTIONS = [
  { id: 'awareness', label: 'מודעות' },
  { id: 'leads',     label: 'לידים'  },
  { id: 'sales',     label: 'מכירות' },
];

const TABS = [
  { id: 'posts'    as TabId, label: 'פוסטים',   icon: FileText },
  { id: 'visuals'  as TabId, label: 'ויזואל',   icon: Image },
  { id: 'calendar' as TabId, label: 'לוח תוכן', icon: CalendarDays },
  { id: 'ads'      as TabId, label: 'פרסומות',  icon: Target },
];

// ─── Prompt builders ──────────────────────────────────────────────────────────
function ctx(b: ClientBrief) {
  return `Company: ${b.company} | Niche: ${b.niche} | Audience: ${b.targetAudience || 'general'} | Demographics: ${b.demographics || 'all ages'} | Pain points: ${b.painPoints || 'not specified'} | USP: ${b.usp || 'quality service'} | Voice: ${b.brandVoice} | Goals: ${b.goals.join(', ') || 'awareness'} | Language: ${b.language === 'he' ? 'Hebrew' : 'English'}`;
}

function postsPrompt(b: ClientBrief) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create 3 Facebook posts for: ${ctx(b)}

Format exactly:
═══ POST 1 — SHORT & PUNCHY ═══
[1-3 bold lines, strong hook]
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5
📍 Best time: [day + time]

═══ POST 2 — STORYTELLING ═══
[Problem → journey → solution → CTA, 6-8 lines]
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5
📍 Best time: [day + time]

═══ POST 3 — PAS FORMAT ═══
[Problem → Agitate → Solution → CTA, 6-8 lines]
#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5
📍 Best time: [day + time]`;
}

function visualsPrompt(b: ClientBrief) {
  const lang = b.language === 'he' ? 'Descriptions in Hebrew, DALL-E prompts in English.' : 'Write entirely in English.';
  return `${lang} Create visual content brief for: ${ctx(b)}

Format exactly:
═══ IMAGE 1 — HERO SHOT ═══
Concept: [scene description]
DALL-E prompt: "[detailed English prompt, style, lighting, mood]"
Format: Square 1:1

═══ IMAGE 2 — SOCIAL PROOF ═══
Concept: [scene description]
DALL-E prompt: "[detailed English prompt]"
Format: Portrait 4:5

═══ IMAGE 3 — PROBLEM/SOLUTION ═══
Concept: [scene description]
DALL-E prompt: "[detailed English prompt]"
Format: Square 1:1

═══ 30-SECOND REEL STORYBOARD ═══
Hook 0-3s: [visual + text overlay]
Scene 1 (3-10s): [action + narration]
Scene 2 (10-20s): [action + narration]
CTA 20-30s: [closing frame + CTA text]
Music: [mood/genre]`;
}

function calendarPrompt(b: ClientBrief) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create a 30-day social media calendar for: ${ctx(b)}
Mix: 40% educational, 30% promotional, 20% engagement, 10% video.

Format exactly:
═══ WEEK 1 — [Theme] ═══
Mon: 📚 [Educational topic]
Wed: 🎯 [Promo angle]
Fri: 💬 [Engagement question/poll]
Sun: 🎬 [Reel idea]

═══ WEEK 2 — [Theme] ═══
Mon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]

═══ WEEK 3 — [Theme] ═══
Mon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]

═══ WEEK 4 — [Theme] ═══
Mon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]

═══ ALGORITHM TIPS ═══
• [tip 1]
• [tip 2]
• [tip 3]`;
}

function adsPrompt(b: ClientBrief) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create Facebook ad strategy for: ${ctx(b)}

Format exactly:
═══ TOF — AWARENESS ═══
Objective: [campaign objective]
Daily budget: [ILS amount]
Audiences: [3 specific interests/behaviors]
Ad format: [format]
Copy sample: [25-word hook]
KPIs: [metrics]

═══ MOF — CONSIDERATION ═══
Objective: [objective]
Daily budget: [ILS amount]
Audiences: [retargeting + lookalike]
Ad format: [format]
Copy sample: [25-word value-focused copy]
KPIs: [metrics]

═══ BOF — CONVERSION ═══
Objective: [objective]
Daily budget: [ILS amount]
Audiences: [hot retarget]
Ad format: [format]
Copy sample: [25-word urgency copy]
KPIs: [metrics]

═══ BUDGET SPLIT ═══
TOF [%] | MOF [%] | BOF [%]
Monthly total: [ILS] | Expected CPL: [range]`;
}

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
        copied
          ? 'border-green-400 bg-green-50 text-green-600'
          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'
      }`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'הועתק!' : 'העתק'}
    </button>
  );
}

// ─── Section renderer ─────────────────────────────────────────────────────────
function SectionOutput({ content, loading }: { content: string; loading: boolean }) {
  if (!content && loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 size={28} className="animate-spin text-black" />
        <span className="text-sm font-medium">מייצר תוכן...</span>
      </div>
    );
  }
  if (!content) return null;

  // Split by ═══ dividers
  const blocks = content.split(/═{3,}[^═\n]*═{3,}/g);
  const titles = [...content.matchAll(/═{3,}([^═\n]+)═{3,}/g)].map(m => m[1].trim());

  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const title = titles[i - 1];
        return (
          <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {title && (
              <div className="px-4 py-2.5 bg-neutral-900">
                <span className="text-white text-sm font-bold">{title}</span>
              </div>
            )}
            <div className="px-4 py-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans text-right" dir="rtl">
                {trimmed}
              </pre>
              <div className="mt-3 flex justify-start">
                <CopyBtn text={trimmed} />
              </div>
            </div>
          </div>
        );
      }).filter(Boolean)}
      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs pb-2">
          <Loader2 size={12} className="animate-spin" />
          <span>ממשיך לייצר...</span>
        </div>
      )}
    </div>
  );
}

// ─── Visuals renderer with DALL-E integration ─────────────────────────────────
interface ImgState { url?: string; loading: boolean; error?: string }

function VisualsOutput({ content, sectionLoading }: { content: string; sectionLoading: boolean }) {
  const [images, setImages] = useState<Record<number, ImgState>>({});
  const openaiKey = getOpenAiKey();

  const blocks = useMemo(() => {
    if (!content) return [];
    const parts = content.split(/═{3,}[^═\n]*═{3,}/g);
    const titles = [...content.matchAll(/═{3,}([^═\n]+)═{3,}/g)].map(m => m[1].trim());
    let pi = 0;
    return parts.map((block, i) => {
      const trimmed = block.trim();
      if (!trimmed) return null;
      const title = titles[i - 1] ?? '';
      const isImageBlock = /DALL-E prompt:/i.test(trimmed);
      const promptMatch = trimmed.match(/DALL-E prompt:\s*"([^"]+)"/i);
      const promptText = promptMatch?.[1] ?? '';
      const idx = isImageBlock ? pi++ : -1;
      return { trimmed, title, isImageBlock, promptText, idx };
    }).filter(Boolean) as { trimmed: string; title: string; isImageBlock: boolean; promptText: string; idx: number }[];
  }, [content]);

  const generate = async (idx: number, prompt: string) => {
    if (!openaiKey) return;
    setImages(prev => ({ ...prev, [idx]: { loading: true } }));
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `שגיאה ${res.status}`);
      setImages(prev => ({ ...prev, [idx]: { url: data.data[0].url, loading: false } }));
    } catch (err) {
      setImages(prev => ({ ...prev, [idx]: { loading: false, error: err instanceof Error ? err.message : String(err) } }));
    }
  };

  if (!content && sectionLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 size={28} className="animate-spin text-black" />
        <span className="text-sm font-medium">מייצר תוכן...</span>
      </div>
    );
  }
  if (!content) return null;

  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map(({ trimmed, title, isImageBlock, promptText, idx }) => (
        <div key={idx >= 0 ? `img-${idx}` : trimmed.slice(0, 20)} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {title && (
            <div className="px-4 py-2.5 bg-neutral-900">
              <span className="text-white text-sm font-bold">{title}</span>
            </div>
          )}
          <div className="px-4 py-4 space-y-4">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans text-right" dir="rtl">
              {trimmed}
            </pre>

            {/* DALL-E generate button */}
            {isImageBlock && !sectionLoading && (
              <div className="border-t border-slate-100 pt-4">
                {!openaiKey ? (
                  <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-right leading-relaxed">
                    💡 כדי לייצר תמונות הוסף <strong>VITE_OPENAI_API_KEY</strong> לקובץ .env והפעל מחדש את השרת
                  </div>
                ) : images[idx]?.url ? (
                  <div className="space-y-3">
                    <img
                      src={images[idx].url}
                      alt="Generated by DALL-E 3"
                      className="w-full rounded-xl border border-slate-200 shadow-sm"
                    />
                    <div className="flex items-center gap-2">
                      <a
                        href={images[idx].url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs font-semibold rounded-lg hover:bg-neutral-800 transition-all"
                      >
                        <Download size={12} /> הורד תמונה
                      </a>
                      <button
                        onClick={() => generate(idx, promptText)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-slate-50 transition-all"
                      >
                        <RefreshCw size={12} /> צור מחדש
                      </button>
                    </div>
                  </div>
                ) : images[idx]?.error ? (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-right space-y-2">
                    <div>⚠️ {images[idx].error}</div>
                    <button onClick={() => generate(idx, promptText)} className="underline font-medium">
                      נסה שוב
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => generate(idx, promptText)}
                    disabled={images[idx]?.loading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-black hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all"
                  >
                    {images[idx]?.loading
                      ? <><Loader2 size={13} className="animate-spin" /> מייצר תמונה...</>
                      : <><Image size={13} /> צור תמונה עם DALL-E 3</>}
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-start">
              <CopyBtn text={trimmed} />
            </div>
          </div>
        </div>
      ))}
      {sectionLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs pb-2">
          <Loader2 size={12} className="animate-spin" />
          <span>ממשיך לייצר...</span>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ContentHub() {
  const [brief, setBrief] = useState<ClientBrief>({
    company: '', niche: '', targetAudience: '', demographics: '',
    painPoints: '', usp: '', brandVoice: 'professional', goals: ['leads'], language: 'he',
  });
  const [sections, setSections] = useState<Record<TabId, SectionState>>(EMPTY_SECTIONS);
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef(false);

  // stable updater — avoids stale-closure issues in async streaming loops
  const updateSection = useCallback((tab: TabId, patch: Partial<SectionState>) => {
    setSections(prev => ({ ...prev, [tab]: { ...prev[tab], ...patch } }));
  }, []);

  const runStream = useCallback(async (
    client: Anthropic,
    tab: TabId,
    prompt: string,
  ) => {
    updateSection(tab, { content: '', loading: true, done: false });
    try {
      let text = '';
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 1500,
        system: [{
          type: 'text' as const,
          text: 'You are a world-class digital marketing strategist and Facebook ads expert. Output structured, immediately usable content. Follow the format instructions exactly.',
          cache_control: { type: 'ephemeral' as const },
        }],
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (abortRef.current) { stream.abort(); break; }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          updateSection(tab, { content: text });
        }
      }
      updateSection(tab, { loading: false, done: true });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const hint = raw.includes('401') || raw.includes('auth') || raw.includes('API key')
        ? '⚠️ מפתח API לא תקין. פתח את קובץ .env והחלף את הערך של VITE_ANTHROPIC_API_KEY במפתח האמיתי שלך (sk-ant-...).'
        : `⚠️ שגיאה: ${raw}`;
      updateSection(tab, { content: hint, loading: false, done: true });
    }
  }, [updateSection]);

  const handleGenerate = useCallback(async () => {
    if (!brief.company.trim() || !brief.niche.trim()) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setSections({ ...EMPTY_SECTIONS, posts: { content: API_KEY_ERROR, loading: false, done: true } });
      return;
    }

    abortRef.current = false;
    setGenerating(true);
    setSections(EMPTY_SECTIONS);

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const plan: [TabId, string][] = [
      ['posts',    postsPrompt(brief)],
      ['visuals',  visualsPrompt(brief)],
      ['calendar', calendarPrompt(brief)],
      ['ads',      adsPrompt(brief)],
    ];

    for (const [tab, prompt] of plan) {
      if (abortRef.current) break;
      setActiveTab(tab);
      await runStream(client, tab, prompt);
    }
    setGenerating(false);
  }, [brief, runStream]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setGenerating(false);
  }, []);

  const handleReset = useCallback(() => {
    abortRef.current = true;
    setGenerating(false);
    setSections(EMPTY_SECTIONS);
  }, []);

  const toggleGoal = (id: string) =>
    setBrief(b => ({
      ...b,
      goals: b.goals.includes(id) ? b.goals.filter(g => g !== id) : [...b.goals, id],
    }));

  const hasContent = Object.values(sections).some(s => s.content || s.loading);
  const cur = sections[activeTab];

  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right bg-white placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:border-neutral-400 transition-all';
  const lbl = 'block text-[11px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest text-right';

  return (
    <div className="flex gap-5" dir="rtl">

      {/* ── Sidebar ─────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm sticky top-20 flex flex-col" style={{ maxHeight: 'calc(100vh - 88px)' }}>

          {/* Header */}
          <div className="bg-neutral-900 px-4 py-4 rounded-t-2xl flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-sm">Creative Hub</div>
              <div className="text-white/40 text-xs">מנוע קריאייטיב AI</div>
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            <div className="space-y-3">
              <div>
                <label className={lbl}>שם החברה *</label>
                <input type="text" value={brief.company}
                  onChange={e => setBrief(b => ({ ...b, company: e.target.value }))}
                  className={inp} placeholder={'לדוגמה: מגדלי הים, נדל"ן פרמיום...'} />
              </div>
              <div>
                <label className={lbl}>תחום / ניצ'</label>
                <input type="text" value={brief.niche}
                  onChange={e => setBrief(b => ({ ...b, niche: e.target.value }))}
                  className={inp} placeholder="פינטק, נדל&quot;ן, אופנה..." />
              </div>
            </div>

            <hr className="border-slate-100" />

            <div className="space-y-3">
              <div>
                <label className={lbl}>קהל יעד</label>
                <input type="text" value={brief.targetAudience}
                  onChange={e => setBrief(b => ({ ...b, targetAudience: e.target.value }))}
                  className={inp} placeholder="עסקים קטנים, גיל 30-50..." />
              </div>
              <div>
                <label className={lbl}>דמוגרפיה</label>
                <input type="text" value={brief.demographics}
                  onChange={e => setBrief(b => ({ ...b, demographics: e.target.value }))}
                  className={inp} placeholder="גיל, מין, אזור..." />
              </div>
            </div>

            <hr className="border-slate-100" />

            <div className="space-y-3">
              <div>
                <label className={lbl}>נקודות כאב</label>
                <textarea value={brief.painPoints}
                  onChange={e => setBrief(b => ({ ...b, painPoints: e.target.value }))}
                  className={`${inp} resize-none`} rows={2}
                  placeholder="מה מציק ללקוח שלך?" />
              </div>
              <div>
                <label className={lbl}>יתרון ייחודי (USP)</label>
                <input type="text" value={brief.usp}
                  onChange={e => setBrief(b => ({ ...b, usp: e.target.value }))}
                  className={inp} placeholder="מה מייחד אותך?" />
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Brand voice */}
            <div>
              <label className={lbl}>טון תקשורת</label>
              <div className="grid grid-cols-2 gap-1.5">
                {VOICE_OPTIONS.map(v => (
                  <button key={v.id} onClick={() => setBrief(b => ({ ...b, brandVoice: v.id }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      brief.brandVoice === v.id ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-600 hover:border-neutral-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>{v.emoji}</span><span>{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Goals */}
            <div>
              <label className={lbl}>מטרות קמפיין</label>
              <div className="flex gap-2">
                {GOAL_OPTIONS.map(g => (
                  <button key={g.id} onClick={() => toggleGoal(g.id)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      brief.goals.includes(g.id) ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-500 hover:border-neutral-300'
                    }`}
                  >{g.label}</button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div>
              <label className={lbl}>שפה</label>
              <div className="flex gap-2">
                {[{ id: 'he' as const, label: '🇮🇱 עברית' }, { id: 'en' as const, label: '🇺🇸 English' }].map(l => (
                  <button key={l.id} onClick={() => setBrief(b => ({ ...b, language: l.id }))}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      brief.language === l.id ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-500 hover:border-neutral-300'
                    }`}
                  >{l.label}</button>
                ))}
              </div>
            </div>

          </div>

          {/* Actions */}
          <div className="p-4 border-t border-slate-100 flex-shrink-0 space-y-2">
            {generating ? (
              <div className="flex gap-2">
                <div className="flex-1 bg-black text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                  <Loader2 size={15} className="animate-spin" /> מייצר...
                </div>
                <button onClick={handleStop}
                  className="px-4 py-3 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium transition-all">
                  עצור
                </button>
              </div>
            ) : hasContent ? (
              <div className="flex gap-2">
                <button onClick={handleGenerate}
                  disabled={!brief.company.trim() || !brief.niche.trim()}
                  className="flex-1 bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all">
                  <RefreshCw size={14} /> צור מחדש
                </button>
                <button onClick={handleReset}
                  className="px-4 py-3 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm font-medium transition-all">
                  נקה
                </button>
              </div>
            ) : (
              <button onClick={handleGenerate}
                disabled={!brief.company.trim() || !brief.niche.trim()}
                className="w-full bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all">
                <Sparkles size={15} /> צור תוכן קריאייטיב
              </button>
            )}
            {(!brief.company.trim() || !brief.niche.trim()) && !generating && (
              <p className="text-center text-[11px] text-slate-400">מלא שם חברה ותחום כדי להתחיל</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Output ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0">

        {/* Empty state */}
        {!hasContent && (
          <div className="flex flex-col items-center justify-center min-h-[500px] gap-6 text-center">
            <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center shadow-lg">
              <Layers size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Content & Creative Hub</h2>
              <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
                מלא את הפרטים ולחץ "צור תוכן קריאייטיב" — AI יבנה עבורך פוסטים, ויזואלים, לוח תוכן ואסטרטגיית פרסום.
              </p>
            </div>
            <div className="flex items-center gap-6 text-xs text-slate-400">
              {TABS.map(t => (
                <div key={t.id} className="flex items-center gap-1.5">
                  <t.icon size={13} /><span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs + content */}
        {hasContent && (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 mb-5 bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm">
              {TABS.map(tab => {
                const s = sections[tab.id];
                const active = activeTab === tab.id;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      active ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <tab.icon size={14} />
                    <span className="hidden sm:inline">{tab.label}</span>
                    {s.loading && <Loader2 size={11} className={`animate-spin ${active ? 'text-white/60' : 'text-slate-400'}`} />}
                    {s.done && !s.loading && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-green-400'}`} />}
                  </button>
                );
              })}
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {cur.done && cur.content && !cur.content.startsWith('⚠️') && (
                  <CopyBtn text={cur.content} />
                )}
              </div>
              <div className="text-right">
                <h3 className="font-bold text-slate-800">{TABS.find(t => t.id === activeTab)?.label}</h3>
                {brief.company && <p className="text-xs text-slate-400">{brief.company} · {brief.niche}</p>}
              </div>
            </div>

            {/* Content */}
            {activeTab === 'visuals'
              ? <VisualsOutput content={cur.content} sectionLoading={cur.loading} />
              : <SectionOutput content={cur.content} loading={cur.loading} />
            }
          </>
        )}
      </div>
    </div>
  );
}
