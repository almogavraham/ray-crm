import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles, Copy, Check, Loader2, Layers,
  FileText, Image, CalendarDays, Target, RefreshCw, Download,
  Plus, Trash2, ChevronDown, Upload, X, Eye, FolderOpen,
  Building2, Folder, Search, Bot, AlertCircle, Pencil,
  Rocket, Globe, Lock, CreditCard, Star, Crown,
  MousePointer, ChevronRight, ChevronLeft,
  Users, DollarSign, Pause, Play, Info,
} from 'lucide-react';
import type { WorkspaceProfile } from '../types';
import { getOpenAiKey } from '../lib/apiKey';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';

/* ─── Types ──────────────────────────────────────────────────────────────── */
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

interface ProjectFile {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  analysis?: string;
  uploadedAt: string;
}

interface ContentProject {
  id: string;
  clientId: string;
  name: string;
  description: string;
  customPrompt: string;   // ← NEW: user prompt / focus for this project
  files: ProjectFile[];
  createdAt: string;
}

interface ContentClient {
  id: string;
  brief: ClientBrief;
  projects: string[];
  createdAt: string;
}

type TabId = 'posts' | 'visuals' | 'calendar' | 'ads';
interface SectionState { content: string; loading: boolean; done: boolean }
const EMPTY: SectionState = { content: '', loading: false, done: false };
const EMPTY_SECTIONS: Record<TabId, SectionState> = {
  posts: { ...EMPTY }, visuals: { ...EMPTY }, calendar: { ...EMPTY }, ads: { ...EMPTY },
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
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
const EMPTY_BRIEF: ClientBrief = {
  company: '', niche: '', targetAudience: '', demographics: '',
  painPoints: '', usp: '', brandVoice: 'professional', goals: ['leads'], language: 'he',
};
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf';
const MAX_FILE_MB = 8;

/* ─── Campaign Types & Constants ────────────────────────────────────────── */
type CPlatform = 'meta' | 'google';
type CObjective = 'leads' | 'awareness' | 'sales' | 'traffic';
type CStatus = 'draft' | 'pending_payment' | 'active' | 'paused' | 'ended' | 'failed';

interface PlatformCampaign {
  id: string;
  name: string;
  platform: CPlatform;
  objective: CObjective;
  location: string;
  ageMin: number;
  ageMax: number;
  gender: 'all' | 'male' | 'female';
  interests: string[];
  headline: string;
  primaryText: string;
  description?: string;
  ctaButton: string;
  imageUrl?: string;
  dailyBudget: number;
  duration: number;
  agencyFeePercent: number;
  status: CStatus;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  metaCampaignId?: string;
  createdAt: string;
  paidAt?: string;
}

const CAMPAIGN_OBJECTIVES: { id: CObjective; label: string; desc: string; icon: string }[] = [
  { id: 'leads',     label: 'לידים',      desc: 'הגדל פניות ולקוחות פוטנציאליים', icon: '🎯' },
  { id: 'awareness', label: 'מודעות',     desc: 'הגדל חשיפה למותג שלך',           icon: '📢' },
  { id: 'sales',     label: 'מכירות',     desc: 'הגדל מכירות ישירות',              icon: '💰' },
  { id: 'traffic',   label: 'תנועה',      desc: 'הגדל ביקורים באתר',              icon: '🌐' },
];
const CTA_OPTIONS = ['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US', 'BOOK_NOW', 'CALL_NOW', 'GET_OFFER'];
const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: 'למד עוד', SIGN_UP: 'הרשמה', SHOP_NOW: 'קנה עכשיו',
  CONTACT_US: 'צור קשר', BOOK_NOW: 'הזמן עכשיו', CALL_NOW: 'התקשר עכשיו', GET_OFFER: 'קבל הצעה',
};
const DURATIONS = [
  { days: 7, label: 'שבוע' }, { days: 14, label: 'שבועיים' },
  { days: 30, label: 'חודש' }, { days: 60, label: 'חודשיים' }, { days: 90, label: '3 חודשים' },
];
const STATUS_INFO: Record<CStatus, { label: string; color: string; bg: string }> = {
  draft:           { label: 'טיוטה',           color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  pending_payment: { label: 'ממתין לתשלום',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  active:          { label: 'פעיל',            color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  paused:          { label: 'מושהה',           color: '#6366f1', bg: 'rgba(99,102,241,0.1)'  },
  ended:           { label: 'הסתיים',          color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
  failed:          { label: 'נכשל',            color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
};

/* ─── Prompt builders ────────────────────────────────────────────────────── */
function ctx(b: ClientBrief, filesContext: string, customPrompt?: string) {
  const base = `Company: ${b.company} | Niche: ${b.niche} | Audience: ${b.targetAudience || 'general'} | Demographics: ${b.demographics || 'all ages'} | Pain points: ${b.painPoints || 'not specified'} | USP: ${b.usp || 'quality service'} | Voice: ${b.brandVoice} | Goals: ${b.goals.join(', ') || 'awareness'} | Language: ${b.language === 'he' ? 'Hebrew' : 'English'}`;
  const filesSection = filesContext ? `\n\nBrand Assets Analysis:\n${filesContext}` : '';
  const focusSection = customPrompt?.trim() ? `\n\n⭐ SPECIAL INSTRUCTIONS / PROJECT FOCUS:\n${customPrompt.trim()}` : '';
  return base + filesSection + focusSection;
}
function postsPrompt(b: ClientBrief, fc: string, cp?: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create 3 Facebook posts for: ${ctx(b, fc, cp)}\n\nFormat exactly:\n═══ POST 1 — SHORT & PUNCHY ═══\n[1-3 bold lines, strong hook]\n#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5\n📍 Best time: [day + time]\n\n═══ POST 2 — STORYTELLING ═══\n[Problem → journey → solution → CTA, 6-8 lines]\n#hashtag1 #hashtag2 #hashtag3\n📍 Best time: [day + time]\n\n═══ POST 3 — PAS FORMAT ═══\n[Problem → Agitate → Solution → CTA, 6-8 lines]\n#hashtag1 #hashtag2 #hashtag3\n📍 Best time: [day + time]`;
}
function visualsPrompt(b: ClientBrief, fc: string, cp?: string) {
  const lang = b.language === 'he' ? 'Descriptions in Hebrew, DALL-E prompts in English.' : 'Write entirely in English.';
  return `${lang} Create visual content brief for: ${ctx(b, fc, cp)}\n\nFormat exactly:\n═══ IMAGE 1 — HERO SHOT ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt, style, lighting, mood]"\nFormat: Square 1:1\n\n═══ IMAGE 2 — SOCIAL PROOF ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt]"\nFormat: Portrait 4:5\n\n═══ IMAGE 3 — PROBLEM/SOLUTION ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt]"\nFormat: Square 1:1\n\n═══ 30-SECOND REEL STORYBOARD ═══\nHook 0-3s: [visual + text overlay]\nScene 1 (3-10s): [action + narration]\nScene 2 (10-20s): [action + narration]\nCTA 20-30s: [closing frame + CTA text]\nMusic: [mood/genre]`;
}
function calendarPrompt(b: ClientBrief, fc: string, cp?: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create a 30-day social media calendar for: ${ctx(b, fc, cp)}\nMix: 40% educational, 30% promotional, 20% engagement, 10% video.\n\nFormat exactly:\n═══ WEEK 1 — [Theme] ═══\nMon: 📚 [Educational topic]\nWed: 🎯 [Promo angle]\nFri: 💬 [Engagement question/poll]\nSun: 🎬 [Reel idea]\n\n═══ WEEK 2 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ WEEK 3 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ WEEK 4 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ ALGORITHM TIPS ═══\n• [tip 1]\n• [tip 2]\n• [tip 3]`;
}
function adsPrompt(b: ClientBrief, fc: string, cp?: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create Facebook ad strategy for: ${ctx(b, fc, cp)}\n\nFormat exactly:\n═══ TOF — AWARENESS ═══\nObjective: [campaign objective]\nDaily budget: [ILS amount]\nAudiences: [3 specific interests/behaviors]\nAd format: [format]\nCopy sample: [25-word hook]\nKPIs: [metrics]\n\n═══ MOF — CONSIDERATION ═══\nObjective: [objective]\nDaily budget: [ILS amount]\nAudiences: [retargeting + lookalike]\nAd format: [format]\nCopy sample: [25-word value-focused copy]\nKPIs: [metrics]\n\n═══ BOF — CONVERSION ═══\nObjective: [objective]\nDaily budget: [ILS amount]\nAudiences: [hot retarget]\nAd format: [format]\nCopy sample: [25-word urgency copy]\nKPIs: [metrics]\n\n═══ BUDGET SPLIT ═══\nTOF [%] | MOF [%] | BOF [%]\nMonthly total: [ILS] | Expected CPL: [range]`;
}

/* ─── Utility ─────────────────────────────────────────────────────────────── */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function isImage(mime: string): boolean { return mime.startsWith('image/'); }

/* ─── CopyBtn ────────────────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const { c } = useTheme();
  const [copied, setCopied] = useState(false);
  const { t } = useLang();
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={copied
        ? { border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.1)', color: '#34d399' }
        : { border: `1px solid ${c.cardBorder}`, background: c.subtleBg, color: c.textSecondary }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? t('content.copied') : t('content.copy')}
    </button>
  );
}

/* ─── SectionOutput ──────────────────────────────────────────────────────── */
function SectionOutput({ content, loading }: { content: string; loading: boolean }) {
  const { c } = useTheme();
  const { t } = useLang();
  if (!content && loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: c.textMuted }}>
      <Loader2 size={28} className="animate-spin" style={{ color: c.accentText }} />
      <span className="text-sm font-medium">{t('content.creatingContent')}</span>
    </div>
  );
  if (!content) return null;
  const blocks = content.split(/═{3,}[^═\n]*═{3,}/g);
  const titles = [...content.matchAll(/═{3,}([^═\n]+)═{3,}/g)].map(m => m[1].trim());
  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        return (
          <div key={i} className="rounded-xl overflow-hidden"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            {titles[i - 1] && <div className="px-4 py-2.5" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}><span className="text-white text-sm font-bold">{titles[i - 1]}</span></div>}
            <div className="px-4 py-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-right" dir="rtl" style={{ color: c.textSecondary }}>{trimmed}</pre>
              <div className="mt-3 flex justify-start"><CopyBtn text={trimmed} /></div>
            </div>
          </div>
        );
      }).filter(Boolean)}
      {loading && <div className="flex items-center gap-2 text-xs pb-2" style={{ color: c.textMuted }}><Loader2 size={12} className="animate-spin" /><span>{t('content.stillGenerating')}</span></div>}
    </div>
  );
}

/* ─── VisualsOutput ──────────────────────────────────────────────────────── */
interface ImgState { url?: string; loading: boolean; error?: string }
function VisualsOutput({ content, sectionLoading }: { content: string; sectionLoading: boolean }) {
  const { c } = useTheme();
  const [images, setImages] = useState<Record<number, ImgState>>({});
  const { t } = useLang();
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
  if (!content && sectionLoading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: c.textMuted }}>
      <Loader2 size={28} className="animate-spin" style={{ color: c.accentText }} />
      <span className="text-sm font-medium">{t('content.creatingContent')}</span>
    </div>
  );
  if (!content) return null;
  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map(({ trimmed, title, isImageBlock, promptText, idx }) => (
        <div key={idx >= 0 ? `img-${idx}` : trimmed.slice(0, 20)} className="rounded-xl overflow-hidden"
          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
          {title && <div className="px-4 py-2.5" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}><span className="text-white text-sm font-bold">{title}</span></div>}
          <div className="px-4 py-4 space-y-4">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-right" dir="rtl" style={{ color: c.textSecondary }}>{trimmed}</pre>
            {isImageBlock && !sectionLoading && (
              <div className="pt-4" style={{ borderTop: `1px solid ${c.divider}` }}>
                {!openaiKey ? (
                  <div className="text-xs rounded-xl px-4 py-3 text-right"
                    style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                    💡 {t('content.addOpenAIKey')}
                  </div>
                ) : images[idx]?.url ? (
                  <div className="space-y-3">
                    <img src={images[idx].url} alt="DALL-E" className="w-full rounded-xl shadow-sm"
                      style={{ border: `1px solid ${c.cardBorder}` }} />
                    <div className="flex gap-2">
                      <a href={images[idx].url} target="_blank" rel="noreferrer" download className="flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-semibold rounded-lg" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}><Download size={12} /> {t('content.download')}</a>
                      <button onClick={() => generate(idx, promptText)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
                        style={{ border: `1px solid ${c.cardBorder}`, color: c.textSecondary, background: c.subtleBg }}>
                        <RefreshCw size={12} /> {t('content.regenerate')}
                      </button>
                    </div>
                  </div>
                ) : images[idx]?.error ? (
                  <div className="text-xs rounded-xl px-4 py-3 text-right"
                    style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    ⚠️ {images[idx].error} <button onClick={() => generate(idx, promptText)} className="underline ml-2">{t('common.retry')}</button>
                  </div>
                ) : (
                  <button onClick={() => generate(idx, promptText)} disabled={images[idx]?.loading} className="flex items-center gap-2 px-4 py-2.5 disabled:opacity-50 text-white text-xs font-bold rounded-xl" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                    {images[idx]?.loading ? <><Loader2 size={13} className="animate-spin" /> {t('content.generating')}</> : <><Image size={13} /> {t('content.generateCreative')}</>}
                  </button>
                )}
              </div>
            )}
            <div className="flex justify-start"><CopyBtn text={trimmed} /></div>
          </div>
        </div>
      ))}
      {sectionLoading && <div className="flex items-center gap-2 text-xs pb-2" style={{ color: c.textMuted }}><Loader2 size={12} className="animate-spin" /><span>{t('content.stillGenerating')}</span></div>}
    </div>
  );
}

/* ─── FileCard ───────────────────────────────────────────────────────────── */
function FileCard({ file, onDelete, onAnalyze, analyzing }: {
  file: ProjectFile;
  onDelete: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const { c } = useTheme();
  const [preview, setPreview] = useState(false);
  const { t } = useLang();
  return (
    <div className="rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
      <div className="flex items-start gap-2">
        {isImage(file.mimeType) ? (
          <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name}
            className="w-12 h-12 object-cover rounded-lg flex-shrink-0 cursor-pointer"
            style={{ border: `1px solid ${c.cardBorder}` }}
            onClick={() => setPreview(true)} />
        ) : (
          <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: c.subtleBg }}>
            <FileText size={20} style={{ color: c.textMuted }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate text-right" style={{ color: c.textSecondary }}>{file.name}</p>
          <p className="text-[10px] text-right" style={{ color: c.textMuted }}>{formatBytes(file.size)}</p>
          {file.analysis && (
            <p className="text-[10px] mt-0.5 text-right" style={{ color: '#34d399' }}>{t('content.analyzedByAI')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {isImage(file.mimeType) && (
            <button onClick={() => setPreview(true)} className="transition-colors" style={{ color: c.textMuted }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)') }
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)') }>
              <Eye size={13} />
            </button>
          )}
          <button onClick={onDelete} className="transition-colors" style={{ color: c.textMuted }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f87171') }
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)') }>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {!file.analysis ? (
        <button onClick={onAnalyze} disabled={analyzing}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold rounded-lg transition-colors disabled:opacity-50"
          style={{ border: '1px dashed rgba(99,102,241,0.4)', color: c.accentText, background: 'transparent' }}>
          {analyzing ? <><Loader2 size={10} className="animate-spin" /> {t('content.analyzing')}</> : <><Bot size={10} /> {t('content.analyzing')}</>}
        </button>
      ) : (
        <details className="mt-2">
          <summary className="text-[10px] cursor-pointer text-right" style={{ color: c.accentText }}>{t('content.showAnalysis')}</summary>
          <p className="text-[10px] mt-1 leading-relaxed rounded-lg p-2 text-right"
            style={{ color: c.textSecondary, background: c.subtleBg }}>{file.analysis}</p>
        </details>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name}
            className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setPreview(false)} className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/70"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}

/* ─── ProjectCard (grid card in "project" view) ───────────────────────────── */
function ProjectCard({ project, onSelect, onDelete }: {
  project: ContentProject;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { c } = useTheme();
  const analyzedCount = project.files.filter(f => f.analysis).length;
  const { t } = useLang();
  return (
    <div onClick={onSelect}
      className="p-4 rounded-xl cursor-pointer transition-all group relative"
      style={{ border: `1px solid ${c.cardBorder}`, background: c.subtleBg }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.border = '1px solid rgba(99,102,241,0.3)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(99,102,241,0.06)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.border = '1px solid rgba(255,255,255,0.07)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 left-3 transition-colors"
        style={{ color: c.textMuted }}
        onMouseEnter={e => (e.currentTarget.style.color = '#f87171') }
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.15)') }>
        <Trash2 size={13} />
      </button>
      <Folder size={22} className="mb-2 ml-auto" style={{ color: c.accentText }} />
      <p className="text-sm font-bold text-right" style={{ color: c.textSecondary }}>{project.name}</p>
      {project.customPrompt && (
        <p className="text-[11px] text-right mt-1 line-clamp-2 leading-relaxed" style={{ color: c.textMuted }}>{project.customPrompt}</p>
      )}
      <div className="flex items-center justify-end gap-2 mt-2">
        {analyzedCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
            {analyzedCount} AI
          </span>
        )}
        <span className="text-[10px]" style={{ color: c.textMuted }}>{project.files.length} {t('content.filesCount')}</span>
      </div>
    </div>
  );
}

/* ─── ProGateScreen ──────────────────────────────────────────────────────── */
function ProGateScreen({ onUpgrade }: { onUpgrade?: () => void }) {
  const { c } = useTheme();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 text-center" dir="rtl">
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 40px rgba(139,92,246,0.3)' }}>
        <Crown size={36} className="text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-black mb-2" style={{ color: c.textPrimary }}>מנהל הקמפיינים זמין ב-Pro</h2>
        <p className="text-sm max-w-xs mx-auto" style={{ color: c.textSecondary }}>
          הקם קמפיינים בפייסבוק וגוגל, עקוב אחרי תוצאות בזמן אמת ושלם ישירות מהמערכת
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg text-sm">
        {[
          { icon: '🚀', label: 'השקת קמפיינים', desc: 'פייסבוק וגוגל ישירות' },
          { icon: '📊', label: 'מעקב תוצאות', desc: 'לידים, קליקים, חשיפות' },
          { icon: '💳', label: 'תשלום מובנה', desc: 'כרטיס אשראי בקליק' },
        ].map(f => (
          <div key={f.label} className="rounded-xl p-3"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <div className="text-xl mb-1">{f.icon}</div>
            <div className="font-bold text-xs" style={{ color: c.textPrimary }}>{f.label}</div>
            <div className="text-[11px]" style={{ color: c.textMuted }}>{f.desc}</div>
          </div>
        ))}
      </div>
      {onUpgrade && (
        <button onClick={onUpgrade}
          className="px-8 py-3 rounded-xl text-white font-bold text-sm transition-all hover:scale-105"
          style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 20px rgba(139,92,246,0.4)' }}>
          <span className="flex items-center gap-2"><Star size={16} /> שדרג ל-Pro עכשיו</span>
        </button>
      )}
    </div>
  );
}

/* ─── CampaignCard ───────────────────────────────────────────────────────── */
function CampaignCard({ campaign, onDelete, onUpdate }: {
  campaign: PlatformCampaign;
  onDelete: () => void;
  onUpdate: (updates: Partial<PlatformCampaign>) => void;
}) {
  const { c } = useTheme();
  const si = STATUS_INFO[campaign.status];
  const obj = CAMPAIGN_OBJECTIVES.find(o => o.id === campaign.objective);
  const ctr  = campaign.impressions > 0 ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2) : '0.00';
  const cpl  = campaign.leads > 0 ? (campaign.spend / campaign.leads).toFixed(0) : '—';

  return (
    <div className="rounded-2xl p-4 transition-all" dir="rtl"
      style={{ background: c.card, border: `1px solid ${c.cardBorder}` }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: campaign.platform === 'meta' ? 'rgba(59,130,246,0.15)' : 'rgba(234,67,53,0.12)' }}>
            {campaign.platform === 'meta'
              ? <span className="text-lg">📘</span>
              : <Globe size={18} style={{ color: '#ea4335' }} />}
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color: c.textPrimary }}>{campaign.name}</p>
            <p className="text-xs" style={{ color: c.textMuted }}>{obj?.icon} {obj?.label}</p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0"
          style={{ color: si.color, background: si.bg, border: `1px solid ${si.color}30` }}>
          {si.label}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'חשיפות', value: campaign.impressions > 999 ? `${(campaign.impressions/1000).toFixed(1)}K` : String(campaign.impressions), icon: Eye },
          { label: 'קליקים', value: String(campaign.clicks),    icon: MousePointer },
          { label: 'לידים',  value: String(campaign.leads),     icon: Users },
          { label: 'הוצאה',  value: `₪${campaign.spend.toLocaleString()}`, icon: DollarSign },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl p-2 text-center"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <Icon size={11} className="mx-auto mb-0.5" style={{ color: c.textMuted }} />
            <div className="text-xs font-bold" style={{ color: c.textPrimary }}>{value}</div>
            <div className="text-[9px]" style={{ color: c.textMuted }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Budget info */}
      <div className="flex items-center justify-between text-xs mb-3"
        style={{ borderTop: `1px solid ${c.divider}`, paddingTop: 8 }}>
        <span style={{ color: c.textMuted }}>תקציב יומי: <strong style={{ color: c.textPrimary }}>₪{campaign.dailyBudget}</strong></span>
        <span style={{ color: c.textMuted }}>{campaign.duration} ימים · CTR {ctr}% · CPL ₪{cpl}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {campaign.status === 'pending_payment' && (
          <div className="flex-1 text-[10px] font-medium text-center py-1.5 rounded-lg"
            style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            ⏳ ממתין לאישור תשלום
          </div>
        )}
        {campaign.status === 'active' && (
          <button onClick={() => onUpdate({ status: 'paused' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <Pause size={11} /> השהה
          </button>
        )}
        {campaign.status === 'paused' && (
          <button onClick={() => onUpdate({ status: 'active' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <Play size={11} /> הפעל
          </button>
        )}
        <button onClick={onDelete}
          className="mr-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
          style={{ color: '#ef4444', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

/* ─── CampaignWizard ─────────────────────────────────────────────────────── */
function CampaignWizard({ workspace, onClose, onSave }: {
  workspace?: WorkspaceProfile;
  onClose: () => void;
  onSave: (campaign: PlatformCampaign) => Promise<void>;
}) {
  const { c, isDark } = useTheme();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [interestInput, setInterestInput] = useState('');
  const [draft, setDraft] = useState<Partial<PlatformCampaign>>({
    platform: 'meta',
    objective: 'leads',
    location: 'ישראל',
    ageMin: 25,
    ageMax: 55,
    gender: 'all',
    interests: [],
    ctaButton: 'LEARN_MORE',
    dailyBudget: 50,
    duration: 30,
    agencyFeePercent: workspace?.campaignAgencyFeePercent ?? 20,
    status: 'draft',
    impressions: 0, clicks: 0, leads: 0, spend: 0,
  });

  const up = (partial: Partial<PlatformCampaign>) => setDraft(d => ({ ...d, ...partial }));
  const totalAd = (draft.dailyBudget ?? 0) * (draft.duration ?? 30);
  const agencyFee = totalAd * ((draft.agencyFeePercent ?? 20) / 100);
  const grandTotal = totalAd + agencyFee;

  const canNext = () => {
    if (step === 1) return !!(draft.platform && draft.objective && draft.name?.trim());
    if (step === 2) return !!(draft.location?.trim() && draft.interests && draft.interests.length > 0);
    if (step === 3) return !!(draft.headline?.trim() && draft.primaryText?.trim());
    return true;
  };

  const handlePay = async () => {
    setSaving(true);
    try {
      const campaign: PlatformCampaign = {
        id: Date.now().toString(),
        name: draft.name ?? 'קמפיין חדש',
        platform: draft.platform ?? 'meta',
        objective: draft.objective ?? 'leads',
        location: draft.location ?? 'ישראל',
        ageMin: draft.ageMin ?? 25,
        ageMax: draft.ageMax ?? 55,
        gender: draft.gender ?? 'all',
        interests: draft.interests ?? [],
        headline: draft.headline ?? '',
        primaryText: draft.primaryText ?? '',
        description: draft.description,
        ctaButton: draft.ctaButton ?? 'LEARN_MORE',
        imageUrl: draft.imageUrl,
        dailyBudget: draft.dailyBudget ?? 50,
        duration: draft.duration ?? 30,
        agencyFeePercent: draft.agencyFeePercent ?? 20,
        status: 'pending_payment',
        impressions: 0, clicks: 0, leads: 0, spend: 0,
        createdAt: new Date().toISOString(),
      };
      await onSave(campaign);
      const stripeUrl = workspace?.stripePaymentLink;
      if (stripeUrl) {
        window.open(stripeUrl, '_blank', 'noopener');
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const addInterest = () => {
    const v = interestInput.trim();
    if (!v) return;
    const current = draft.interests ?? [];
    if (!current.includes(v)) up({ interests: [...current, v] });
    setInterestInput('');
  };

  const STEPS = ['פלטפורמה', 'קהל יעד', 'קריאייטיב', 'תקציב ותשלום'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: isDark ? '#0f172a' : '#fff', border: `1px solid ${c.cardBorder}` }}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: c.divider }}>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors" style={{ color: c.textMuted }}>
            <X size={18} />
          </button>
          <div className="flex items-center gap-2" dir="rtl">
            <Rocket size={18} style={{ color: '#6366f1' }} />
            <span className="font-bold" style={{ color: c.textPrimary }}>צור קמפיין חדש</span>
          </div>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-1" dir="rtl">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                    style={i + 1 <= step
                      ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
                      : { background: c.subtleBg, color: c.textMuted, border: `1px solid ${c.cardBorder}` }}>
                    {i + 1 < step ? <Check size={11} /> : i + 1}
                  </div>
                  <span className="text-[9px] mt-0.5 font-medium text-center" style={{ color: i + 1 <= step ? '#6366f1' : c.textMuted }}>{s}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="h-px w-4 flex-shrink-0 mb-3" style={{ background: i + 1 < step ? '#6366f1' : c.divider }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-5" dir="rtl">

          {/* Step 1: Platform & Objective */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: c.textSecondary }}>בחר פלטפורמה</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'meta' as CPlatform, label: 'Meta (Facebook + Instagram)', emoji: '📘', color: '#1877f2', desc: 'המומלץ ביותר לעסקים ישראלים' },
                    { id: 'google' as CPlatform, label: 'Google Ads', emoji: '🔍', color: '#ea4335', desc: 'מתאים לחיפוש ו-YouTube' },
                  ]).map(p => (
                    <button key={p.id} onClick={() => up({ platform: p.id })}
                      className="p-4 rounded-xl text-right transition-all border-2"
                      style={draft.platform === p.id
                        ? { borderColor: p.color, background: `${p.color}10` }
                        : { borderColor: c.cardBorder, background: c.subtleBg }}>
                      <div className="text-2xl mb-1">{p.emoji}</div>
                      <div className="font-bold text-xs" style={{ color: c.textPrimary }}>{p.label}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>שם הקמפיין</label>
                <input type="text" value={draft.name ?? ''} onChange={e => up({ name: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="לדוגמה: קמפיין לידים - קיץ 2025" />
              </div>

              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: c.textSecondary }}>מטרת הקמפיין</p>
                <div className="grid grid-cols-2 gap-2">
                  {CAMPAIGN_OBJECTIVES.map(o => (
                    <button key={o.id} onClick={() => up({ objective: o.id })}
                      className="p-3 rounded-xl text-right transition-all border"
                      style={draft.objective === o.id
                        ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.1)', color: '#818cf8' }
                        : { borderColor: c.cardBorder, background: c.subtleBg, color: c.textSecondary }}>
                      <span className="text-lg">{o.icon}</span>
                      <div className="font-semibold text-xs mt-1">{o.label}</div>
                      <div className="text-[10px]" style={{ color: c.textMuted }}>{o.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Audience */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>מיקום גיאוגרפי</label>
                <input type="text" value={draft.location ?? ''} onChange={e => up({ location: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="לדוגמה: ישראל, תל אביב, ירושלים" />
              </div>

              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: c.textSecondary }}>
                  טווח גילאים: {draft.ageMin}–{draft.ageMax}
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <span className="text-[10px]" style={{ color: c.textMuted }}>מינימום</span>
                    <input type="number" min={18} max={64} value={draft.ageMin ?? 25}
                      onChange={e => up({ ageMin: Number(e.target.value) })}
                      className="w-full rounded-xl px-3 py-2 text-sm text-right focus:outline-none mt-0.5"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px]" style={{ color: c.textMuted }}>מקסימום</span>
                    <input type="number" min={19} max={65} value={draft.ageMax ?? 55}
                      onChange={e => up({ ageMax: Number(e.target.value) })}
                      className="w-full rounded-xl px-3 py-2 text-sm text-right focus:outline-none mt-0.5"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: c.textSecondary }}>מגדר</label>
                <div className="flex gap-2">
                  {(['all','male','female'] as const).map(id => (
                    <button key={id} onClick={() => up({ gender: id })}
                      className="flex-1 py-2 rounded-xl text-xs font-medium transition-all border"
                      style={draft.gender === id
                        ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.1)', color: '#818cf8' }
                        : { borderColor: c.cardBorder, background: c.subtleBg, color: c.textSecondary }}>
                      {id === 'all' ? 'הכל' : id === 'male' ? 'גברים' : 'נשים'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>
                  תחומי עניין ({(draft.interests ?? []).length} נבחרו)
                </label>
                <div className="flex gap-2 mb-2">
                  <button onClick={addInterest}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    הוסף
                  </button>
                  <input type="text" value={interestInput}
                    onChange={e => setInterestInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addInterest()}
                    className="flex-1 rounded-xl px-3 py-2 text-sm text-right focus:outline-none"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                    placeholder='לדוגמה: נדל"ן, השקעות, ביזנס...' />
                </div>
                {(draft.interests ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(draft.interests ?? []).map(interest => (
                      <span key={interest} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                        style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}>
                        {interest}
                        <button onClick={() => up({ interests: (draft.interests ?? []).filter(i => i !== interest) })}
                          className="hover:text-red-400 transition-colors"><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Creative */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1 flex items-center justify-between" style={{ color: c.textSecondary }}>
                  <span style={{ color: (draft.headline?.length ?? 0) > 40 ? '#ef4444' : c.textMuted }}>{draft.headline?.length ?? 0}/40</span>
                  <span>כותרת ראשית *</span>
                </label>
                <input type="text" value={draft.headline ?? ''} onChange={e => up({ headline: e.target.value })}
                  maxLength={40}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="הכותרת שתופיע במודעה (עד 40 תווים)" />
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 flex items-center justify-between" style={{ color: c.textSecondary }}>
                  <span style={{ color: (draft.primaryText?.length ?? 0) > 125 ? '#ef4444' : c.textMuted }}>{draft.primaryText?.length ?? 0}/125</span>
                  <span>טקסט ראשי *</span>
                </label>
                <textarea value={draft.primaryText ?? ''} onChange={e => up({ primaryText: e.target.value })}
                  rows={3} maxLength={125}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none resize-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="תיאור קצר של הצעת הערך שלך..." />
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>כפתור CTA</label>
                <select value={draft.ctaButton ?? 'LEARN_MORE'} onChange={e => up({ ctaButton: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary, direction: 'rtl' }}>
                  {CTA_OPTIONS.map(cta => (
                    <option key={cta} value={cta}>{CTA_LABELS[cta]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>קישור לתמונה (אופציונלי)</label>
                <input type="url" value={draft.imageUrl ?? ''} onChange={e => up({ imageUrl: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="https://... (קישור לתמונה או ריבוע)" />
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>תיאור נוסף (אופציונלי)</label>
                <input type="text" value={draft.description ?? ''} onChange={e => up({ description: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  placeholder="שורה נוספת למודעה..." />
              </div>
            </div>
          )}

          {/* Step 4: Budget & Payment */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>תקציב יומי (₪)</label>
                  <div className="flex items-center gap-1 rounded-xl px-3 py-2.5"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <span className="text-xs" style={{ color: c.textMuted }}>₪</span>
                    <input type="number" min={10} value={draft.dailyBudget ?? 50}
                      onChange={e => up({ dailyBudget: Number(e.target.value) })}
                      className="flex-1 bg-transparent text-sm text-right focus:outline-none"
                      style={{ color: c.textPrimary }} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: c.textSecondary }}>משך הקמפיין</label>
                  <select value={draft.duration ?? 30} onChange={e => up({ duration: Number(e.target.value) })}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary, direction: 'rtl' }}>
                    {DURATIONS.map(d => (
                      <option key={d.days} value={d.days}>{d.label} ({d.days} ימים)</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cost breakdown */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                <p className="text-xs font-bold mb-3 text-right" style={{ color: c.textPrimary }}>פירוט עלות</p>
                {[
                  { label: `תקציב מדיה (${draft.duration} ימים × ₪${draft.dailyBudget}/יום)`, value: `₪${totalAd.toLocaleString()}`, highlight: false },
                  { label: `עמלת סוכנות (${draft.agencyFeePercent}%)`, value: `₪${agencyFee.toFixed(0)}`, highlight: false },
                  { label: 'סה"כ לתשלום', value: `₪${grandTotal.toFixed(0)}`, highlight: true },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-center justify-between text-sm"
                    style={highlight ? { borderTop: `1px solid ${c.divider}`, paddingTop: 8, marginTop: 4 } : {}}>
                    <span style={{ color: highlight ? c.textPrimary : c.textSecondary, fontWeight: highlight ? 700 : 400 }}>{value}</span>
                    <span style={{ color: c.textMuted, fontSize: 11 }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* Platform note */}
              <div className="rounded-xl p-3 flex gap-2 items-start"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#818cf8' }} />
                <p className="text-xs text-right" style={{ color: '#a5b4fc' }}>
                  לאחר התשלום הקמפיין יוגדר תוך 24 שעות.
                  {draft.platform === 'meta' && workspace?.metaIntegration?.connected
                    ? ' הקמפיין יועלה אוטומטית לחשבון Meta שלך.'
                    : ' נציג יצור איתך קשר להשלמת ההגדרה.'}
                </p>
              </div>

              {!workspace?.stripePaymentLink && (
                <div className="rounded-xl p-3 flex gap-2 items-start"
                  style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                  <p className="text-xs text-right" style={{ color: '#fbbf24' }}>
                    הגדר לינק תשלום Stripe בהגדרות כדי לאפשר גביה אוטומטית.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="p-4 border-t flex items-center justify-between gap-3" style={{ borderColor: c.divider }}>
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ color: c.textSecondary, background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <ChevronRight size={15} />
            {step > 1 ? 'חזרה' : 'ביטול'}
          </button>

          {step < 4 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
              className="flex items-center gap-1.5 px-6 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              המשך <ChevronLeft size={15} />
            </button>
          ) : (
            <button onClick={handlePay} disabled={saving}
              className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 0 16px rgba(16,185,129,0.35)' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
              שלם ₪{grandTotal.toFixed(0)} וצור קמפיין
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
interface ContentHubProps {
  workspace?: WorkspaceProfile;
  currentUser?: string;
  onNavigateToBilling?: () => void;
  onToast?: (msg: string, type?: string) => void;
  initialTab?: 'campaigns' | 'content';
  hideTabBar?: boolean;
}

export default function ContentHub({ workspace, onNavigateToBilling, onToast, initialTab, hideTabBar }: ContentHubProps = {}) {
  const { isDark, c } = useTheme();

  // ── Main tab ──────────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<'campaigns' | 'content'>(initialTab ?? 'campaigns');
  const isPro = workspace?.plan === 'pro' || workspace?.plan === 'enterprise';

  // ── Campaigns (Firestore) ─────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState<PlatformCampaign[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (!workspace?.id) return;
    return onSnapshot(
      collection(db, 'workspaces', workspace.id, 'platformCampaigns'),
      snap => setCampaigns(snap.docs.map(d => d.data() as PlatformCampaign).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    );
  }, [workspace?.id]);

  const saveCampaign = useCallback(async (campaign: PlatformCampaign) => {
    if (!workspace?.id) return;
    await setDoc(doc(db, 'workspaces', workspace.id, 'platformCampaigns', campaign.id), campaign);
    if (onToast) onToast('הקמפיין נשמר בהצלחה', 'success');
  }, [workspace?.id, onToast]);

  const deleteCampaign = useCallback(async (id: string) => {
    if (!workspace?.id) return;
    await deleteDoc(doc(db, 'workspaces', workspace.id, 'platformCampaigns', id));
  }, [workspace?.id]);

  const updateCampaign = useCallback(async (id: string, updates: Partial<PlatformCampaign>) => {
    if (!workspace?.id) return;
    const cam = campaigns.find(x => x.id === id);
    if (!cam) return;
    await setDoc(doc(db, 'workspaces', workspace.id, 'platformCampaigns', id), { ...cam, ...updates });
  }, [workspace?.id, campaigns]);

  // ── Clients & Projects (Firestore) ─────────────────────────────────────
  const [clients,        setClients]        = useState<ContentClient[]>([]);
  const [projects,       setProjects]       = useState<ContentProject[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedProject,setSelectedProject]= useState<string | null>(null);
  const [showNewClient,  setShowNewClient]  = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newClientName,  setNewClientName]  = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPrompt, setNewProjectPrompt] = useState('');
  const [clientSearch,   setClientSearch]   = useState('');
  const [editingPrompt,  setEditingPrompt]  = useState(false);
  const promptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── File uploads ────────────────────────────────────────────────────────
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Content generation ──────────────────────────────────────────────────
  const [brief,      setBrief]     = useState<ClientBrief>(EMPTY_BRIEF);
  const [sections,   setSections]  = useState<Record<TabId, SectionState>>(EMPTY_SECTIONS);
  const [activeTab,  setActiveTab] = useState<TabId>('posts');
  const [generating, setGenerating]= useState(false);
  const [regenTab,   setRegenTab]  = useState<TabId | null>(null);
  const abortRef = useRef(false);

  // ── Firestore listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'content-clients'), snap =>
      setClients(snap.docs.map(d => d.data() as ContentClient))
    );
    const u2 = onSnapshot(collection(db, 'content-projects'), snap =>
      setProjects(snap.docs.map(d => d.data() as ContentProject))
    );
    return () => { u1(); u2(); };
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const client  = clients.find(c => c.id === selectedClient) ?? null;
  const project = projects.find(p => p.id === selectedProject) ?? null;
  const clientProjects = projects.filter(p => p.clientId === selectedClient);
  const files   = project?.files ?? [];
  const customPrompt = project?.customPrompt ?? '';

  const filesContext = files
    .filter(f => f.analysis)
    .map(f => `[${f.name}]: ${f.analysis}`)
    .join('\n');

  const filteredClients = clients.filter(c =>
    c.brief.company.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // ── Sync brief from selected client ─────────────────────────────────────
  useEffect(() => {
    if (client) setBrief(client.brief);
  }, [selectedClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Client CRUD ─────────────────────────────────────────────────────────
  const createClient = async () => {
    if (!newClientName.trim()) return;
    const id = Date.now().toString();
    const newClient: ContentClient = {
      id,
      brief: { ...EMPTY_BRIEF, company: newClientName.trim() },
      projects: [],
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'content-clients', id), newClient).catch(console.error);
    setSelectedClient(id);
    setSelectedProject(null);
    setNewClientName('');
    setShowNewClient(false);
    setBrief(newClient.brief);
  };

  const deleteClient = async (id: string) => {
    await deleteDoc(doc(db, 'content-clients', id)).catch(console.error);
    projects.filter(p => p.clientId === id).forEach(p =>
      deleteDoc(doc(db, 'content-projects', p.id)).catch(console.error)
    );
    if (selectedClient === id) { setSelectedClient(null); setSelectedProject(null); }
  };

  const saveBrief = useCallback(async (updated: ClientBrief) => {
    if (!client) return;
    await setDoc(doc(db, 'content-clients', client.id), { ...client, brief: updated }).catch(console.error);
  }, [client]);

  const updateBrief = (patch: Partial<ClientBrief>) => {
    const updated = { ...brief, ...patch };
    setBrief(updated);
    saveBrief(updated);
  };

  // ── Project CRUD ─────────────────────────────────────────────────────────
  const createProject = async () => {
    if (!newProjectName.trim() || !selectedClient) return;
    const id = Date.now().toString();
    const newProject: ContentProject = {
      id,
      clientId: selectedClient,
      name: newProjectName.trim(),
      description: '',
      customPrompt: newProjectPrompt.trim(),
      files: [],
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'content-projects', id), newProject).catch(console.error);
    setSelectedProject(id);
    setNewProjectName('');
    setNewProjectPrompt('');
    setShowNewProject(false);
  };

  const deleteProject = async (id: string) => {
    await deleteDoc(doc(db, 'content-projects', id)).catch(console.error);
    if (selectedProject === id) { setSelectedProject(null); setSections(EMPTY_SECTIONS); }
  };

  // ── Save custom prompt (debounced) ────────────────────────────────────────
  const updateCustomPrompt = (value: string) => {
    if (!project) return;
    // Optimistic local update via Firestore snapshot will handle the rest
    if (promptSaveTimer.current) clearTimeout(promptSaveTimer.current);
    promptSaveTimer.current = setTimeout(async () => {
      const updated = { ...project, customPrompt: value };
      await setDoc(doc(db, 'content-projects', project.id), updated).catch(console.error);
    }, 800);
  };

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !project) return;

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) { alert(`${file.name} גדול מ-${MAX_FILE_MB}MB`); continue; }
      try {
        const base64 = await fileToBase64(file);
        const pf: ProjectFile = {
          id:         Date.now().toString() + Math.random(),
          name:       file.name,
          mimeType:   file.type,
          base64,
          size:       file.size,
          uploadedAt: new Date().toISOString(),
        };

        let analysis: string | undefined;
        if (isImage(file.type)) {
          try {
            const c2 = getAnthropicProxy();
            const resp = await c2.messages.create({
              model: 'claude-opus-4-6',
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } },
                  { type: 'text', text: 'תאר תמונה זו בקצרה מנקודת מבט שיווקית: מה היא מציגה, צבעים, סגנון, וכיצד ניתן להשתמש בה בקמפיין דיגיטלי? ענה בעברית, עד 3 משפטים.' },
                ],
              }],
            });
            analysis = resp.content[0].type === 'text' ? resp.content[0].text : undefined;
          } catch { /* analysis optional */ }
        }

        // Re-read project from latest state before updating (avoid stale closure)
        const latestProject = projects.find(p => p.id === project.id) ?? project;
        const updatedProject: ContentProject = { ...latestProject, files: [...latestProject.files, { ...pf, analysis }] };
        await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
      } catch { alert(`שגיאה בהעלאת ${file.name}`); }
    }
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); handleFiles(e.dataTransfer.files); };

  const deleteFile = async (fileId: string) => {
    if (!project) return;
    const updatedProject = { ...project, files: project.files.filter(f => f.id !== fileId) };
    await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
  };

  const analyzeFile = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file || !project) return;
    if (!isImage(file.mimeType)) return;
    setAnalyzingId(fileId);
    try {
      const c2 = getAnthropicProxy();
      const resp = await c2.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: file.base64 } },
            { type: 'text', text: 'תאר תמונה זו בקצרה מנקודת מבט שיווקית: מה היא מציגה, צבעים, סגנון, וכיצד ניתן להשתמש בה בקמפיין דיגיטלי? ענה בעברית, עד 3 משפטים.' },
          ],
        }],
      });
      const analysis = resp.content[0].type === 'text' ? resp.content[0].text : '';
      const updatedProject = { ...project, files: project.files.map(f => f.id === fileId ? { ...f, analysis } : f) };
      await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
    } catch (e) { console.error(e); }
    setAnalyzingId(null);
  };

  // ── Content generation ───────────────────────────────────────────────────
  const updateSection = useCallback((tab: TabId, patch: Partial<SectionState>) => {
    setSections(prev => ({ ...prev, [tab]: { ...prev[tab], ...patch } }));
  }, []);

  const runStream = useCallback(async (c2: ReturnType<typeof getAnthropicProxy>, tab: TabId, prompt: string) => {
    updateSection(tab, { content: '', loading: true, done: false });
    try {
      let text = '';
      const stream = await c2.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 1500,
        system: [{ type: 'text' as const, text: 'You are a world-class digital marketing strategist. Output structured, immediately usable content. Follow format instructions exactly.', cache_control: { type: 'ephemeral' as const } }],
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
      updateSection(tab, { content: `⚠️ שגיאה: ${raw}`, loading: false, done: true });
    }
  }, [updateSection]);

  const handleGenerate = useCallback(async () => {
    if (!brief.company.trim() || !brief.niche.trim()) return;
    abortRef.current = false;
    setGenerating(true);
    setSections(EMPTY_SECTIONS);
    const c2 = getAnthropicProxy();
    const cp = customPrompt;
    const fc = filesContext;
    const plan: [TabId, string][] = [
      ['posts',    postsPrompt(brief, fc, cp)],
      ['visuals',  visualsPrompt(brief, fc, cp)],
      ['calendar', calendarPrompt(brief, fc, cp)],
      ['ads',      adsPrompt(brief, fc, cp)],
    ];
    for (const [tab, prompt] of plan) {
      if (abortRef.current) break;
      setActiveTab(tab);
      await runStream(c2, tab, prompt);
    }
    setGenerating(false);
  }, [brief, runStream, filesContext, customPrompt]);

  // ── Regenerate single tab ─────────────────────────────────────────────────
  const handleRegenerateTab = useCallback(async (tab: TabId) => {
    if (!brief.company.trim() || !brief.niche.trim()) return;
    abortRef.current = false;
    setRegenTab(tab);
    const c2 = getAnthropicProxy();
    const cp = customPrompt;
    const fc = filesContext;
    const promptMap: Record<TabId, string> = {
      posts:    postsPrompt(brief, fc, cp),
      visuals:  visualsPrompt(brief, fc, cp),
      calendar: calendarPrompt(brief, fc, cp),
      ads:      adsPrompt(brief, fc, cp),
    };
    await runStream(c2, tab, promptMap[tab]);
    setRegenTab(null);
  }, [brief, runStream, filesContext, customPrompt]);

  const handleStop  = useCallback(() => { abortRef.current = true; setGenerating(false); setRegenTab(null); }, []);
  const handleReset = useCallback(() => { abortRef.current = true; setGenerating(false); setRegenTab(null); setSections(EMPTY_SECTIONS); }, []);
  const toggleGoal  = (id: string) => updateBrief({ goals: brief.goals.includes(id) ? brief.goals.filter(g => g !== id) : [...brief.goals, id] });

  const hasContent = Object.values(sections).some(s => s.content || s.loading);
  const cur = sections[activeTab];

  // Dark input/label classes — inline styles for dark theme
  const inp = 'w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 transition-all';
  const inpStyle = { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary };
  const lbl = 'block text-[11px] font-bold mb-1.5 uppercase tracking-widest text-right';
  const lblStyle = { color: c.textMuted };

  const { t, dir } = useLang();

  type ViewMode = 'clients' | 'project' | 'generate';
  const viewMode: ViewMode = !selectedClient ? 'clients' : !selectedProject ? 'project' : 'generate';

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col" dir="rtl"
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
        margin: '-1rem -1.5rem',
        padding: '1rem 1.5rem',
      }}>

      {/* ── Main tab switcher ── */}
      {!hideTabBar && (
        <div className="flex-shrink-0 pb-3">
          <div className="flex items-center gap-1 rounded-xl p-1 w-fit"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            {([
              { id: 'campaigns' as const, label: 'קמפיינים', icon: Rocket },
              { id: 'content'   as const, label: 'תוכן AI',  icon: Sparkles },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setMainTab(id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={mainTab === id
                  ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }
                  : { color: c.textSecondary }}>
                <Icon size={14} /> {label}
                {id === 'campaigns' && !isPro && <Lock size={11} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Campaign wizard modal ── */}
      {showWizard && (
        <CampaignWizard
          workspace={workspace}
          onClose={() => setShowWizard(false)}
          onSave={saveCampaign}
        />
      )}

      {mainTab === 'campaigns' ? (
        isPro ? (
          /* ════════════════ CAMPAIGNS TAB ════════════════ */
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setShowWizard(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
                <Plus size={15} /> צור קמפיין חדש
              </button>
              <div className="text-right">
                <h1 className="text-lg font-black" style={{ color: c.textPrimary }}>קמפיינים</h1>
                <p className="text-xs" style={{ color: c.textMuted }}>{campaigns.length} קמפיינים סה&quot;כ</p>
              </div>
            </div>

            {/* Stats bar */}
            {campaigns.length > 0 && (
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'קמפיינים פעילים', value: String(campaigns.filter(x => x.status === 'active').length), icon: Rocket, color: '#10b981' },
                  { label: 'סה"כ חשיפות',     value: campaigns.reduce((s, x) => s + x.impressions, 0).toLocaleString(), icon: Eye, color: '#6366f1' },
                  { label: 'סה"כ לידים',      value: String(campaigns.reduce((s, x) => s + x.leads, 0)),              icon: Users, color: '#8b5cf6' },
                  { label: 'סה"כ הוצאה',      value: `₪${campaigns.reduce((s, x) => s + x.spend, 0).toLocaleString()}`, icon: DollarSign, color: '#f59e0b' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl p-3 text-right"
                    style={{ background: c.card, border: `1px solid ${c.cardBorder}` }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-1.5 mr-auto"
                      style={{ background: `${color}15` }}>
                      <Icon size={14} style={{ color }} />
                    </div>
                    <div className="text-lg font-black" style={{ color: c.textPrimary }}>{value}</div>
                    <div className="text-[10px]" style={{ color: c.textMuted }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Campaign cards */}
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  <Rocket size={28} style={{ color: '#6366f1' }} />
                </div>
                <h3 className="font-bold text-lg mb-2" style={{ color: c.textPrimary }}>אין קמפיינים עדיין</h3>
                <p className="text-sm mb-5" style={{ color: c.textSecondary }}>צור את הקמפיין הראשון שלך בפייסבוק או גוגל</p>
                <button onClick={() => setShowWizard(true)}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                  <Plus size={15} /> צור קמפיין ראשון
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {campaigns.map(campaign => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    onDelete={() => deleteCampaign(campaign.id)}
                    onUpdate={updates => updateCampaign(campaign.id, updates)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <ProGateScreen onUpgrade={onNavigateToBilling} />
        )
      ) : (
      /* ════════════════ CONTENT TAB ════════════════ */
      <div className="flex flex-col md:flex-row gap-4 md:gap-5" dir={dir}>

      {/* ════════════════ LEFT SIDEBAR ════════════════ */}
      <div className="w-full md:w-80 md:flex-shrink-0">
        <div className="rounded-2xl md:sticky md:top-20 flex flex-col"
          style={{
            background: 'rgba(10,15,30,0.88)',
            border: '1px solid rgba(99,102,241,0.2)',
            backdropFilter: 'blur(16px)',
            maxHeight: 'calc(100vh - 88px)',
          }}>

          {/* Header */}
          <div className="px-4 py-4 rounded-t-2xl flex items-center gap-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <Layers size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="text-white font-bold text-sm">Creative Hub</div>
              <div className="text-xs" style={{ color: c.textSecondary }}>{t('content.creativeEngine')}</div>
            </div>
          </div>

          {/* ── Client selector ─── */}
          <div className="flex-shrink-0 p-3 space-y-2" style={{ borderBottom: `1px solid ${c.divider}` }}>
            <div className="flex items-center justify-between">
              <button onClick={() => setShowNewClient(v => !v)}
                className="flex items-center gap-1 text-xs font-semibold transition-colors"
                style={{ color: c.accentText }}>
                <Plus size={12} /> {t('content.newClient')}
              </button>
              <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: c.textMuted }}>{t('content.clientLabel')}</span>
            </div>
            {showNewClient && (
              <div className="flex gap-1.5">
                <button onClick={createClient} className="px-3 py-1.5 text-white text-xs rounded-lg font-semibold" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>{t('common.create')}</button>
                <input autoFocus value={newClientName} onChange={e => setNewClientName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createClient()}
                  placeholder={t('content.clientName')}
                  className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
              </div>
            )}
            {clients.length > 3 && (
              <div className="relative">
                <Search size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: c.textMuted }} />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="חיפוש לקוח..."
                  className="w-full pr-7 pl-2 py-1.5 rounded-lg text-xs text-right focus:outline-none"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
              </div>
            )}
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {filteredClients.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: c.textMuted }}>{t('content.noClientsCreate')}</p>
              )}
              {filteredClients.map(c => (
                <div key={c.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all group"
                  style={selectedClient === c.id
                    ? { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: 'white' }
                    : { color: c.textSecondary }}
                  onClick={() => { setSelectedClient(c.id); setSelectedProject(null); setSections(EMPTY_SECTIONS); }}>
                  <Building2 size={12} style={{ color: selectedClient === c.id ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }} />
                  <span className="flex-1 text-xs font-semibold truncate">{c.brief.company}</span>
                  <button onClick={e => { e.stopPropagation(); deleteClient(c.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: selectedClient === c.id ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)' }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Project selector ─── */}
          {selectedClient && (
            <div className="flex-shrink-0 p-3 space-y-2" style={{ borderBottom: `1px solid ${c.divider}` }}>
              <div className="flex items-center justify-between">
                <button onClick={() => setShowNewProject(v => !v)}
                  className="flex items-center gap-1 text-xs font-semibold"
                  style={{ color: c.accentText }}>
                  <Plus size={12} /> {t('content.newProjectBtn')}
                </button>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: c.textMuted }}>{t('content.projectLabel')}</span>
              </div>

              {/* New project form */}
              {showNewProject && (
                <div className="space-y-2 rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <div className="flex gap-1.5">
                    <button onClick={createProject} className="px-3 py-1.5 text-white text-xs rounded-lg font-semibold flex-shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>{t('common.create')}</button>
                    <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && createProject()}
                      placeholder={t('content.projectName')}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-right focus:outline-none"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
                  </div>
                  <textarea
                    value={newProjectPrompt}
                    onChange={e => setNewProjectPrompt(e.target.value)}
                    placeholder={t('content.projectPromptOptional')}
                    rows={3}
                    className="w-full rounded-lg px-2.5 py-2 text-xs text-right focus:outline-none resize-none"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  />
                  <p className="text-[10px] text-right" style={{ color: c.textMuted }}>{t('content.projectPromptSaved')}</p>
                </div>
              )}

              <div className="space-y-1 max-h-36 overflow-y-auto">
                {clientProjects.length === 0 && <p className="text-xs text-center py-1" style={{ color: c.textMuted }}>{t('content.noProjectsForClient')}</p>}
                {clientProjects.map(p => (
                  <div key={p.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all group"
                    style={selectedProject === p.id
                      ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                      : { color: c.textSecondary, border: '1px solid transparent' }}
                    onClick={() => { setSelectedProject(p.id); setSections(EMPTY_SECTIONS); }}>
                    <Folder size={12} style={{ color: selectedProject === p.id ? '#818cf8' : 'rgba(255,255,255,0.35)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">{p.name}</div>
                      {p.customPrompt && (
                        <div className="text-[9px] truncate" style={{ color: selectedProject === p.id ? 'rgba(129,140,248,0.6)' : 'rgba(255,255,255,0.3)' }}>{p.customPrompt.slice(0, 40)}...</div>
                      )}
                    </div>
                    <span className="text-[10px] flex-shrink-0" style={{ color: selectedProject === p.id ? 'rgba(129,140,248,0.7)' : 'rgba(255,255,255,0.3)' }}>{p.files.length} 📎</span>
                    <button onClick={e => { e.stopPropagation(); deleteProject(p.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      style={{ color: selectedProject === p.id ? 'rgba(129,140,248,0.5)' : 'rgba(255,255,255,0.2)' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Brief form (scrollable) ─── */}
          {selectedClient && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.companyName')}</label>
                  <input type="text" value={brief.company} onChange={e => updateBrief({ company: e.target.value })} className={inp} style={inpStyle} placeholder="..." />
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.nicheField')}</label>
                  <input type="text" value={brief.niche} onChange={e => updateBrief({ niche: e.target.value })} className={inp} style={inpStyle} placeholder='...' />
                </div>
              </div>
              <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />
              <div className="space-y-3">
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.targetAudienceField')}</label>
                  <input type="text" value={brief.targetAudience} onChange={e => updateBrief({ targetAudience: e.target.value })} className={inp} style={inpStyle} placeholder="..." />
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.demographicsField')}</label>
                  <input type="text" value={brief.demographics} onChange={e => updateBrief({ demographics: e.target.value })} className={inp} style={inpStyle} placeholder="..." />
                </div>
              </div>
              <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />
              <div className="space-y-3">
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.painPointsField')}</label>
                  <textarea value={brief.painPoints} onChange={e => updateBrief({ painPoints: e.target.value })} className={`${inp} resize-none`} style={inpStyle} rows={2} placeholder="..." />
                </div>
                <div>
                  <label className={lbl} style={lblStyle}>{t('content.uspField')}</label>
                  <input type="text" value={brief.usp} onChange={e => updateBrief({ usp: e.target.value })} className={inp} style={inpStyle} placeholder="..." />
                </div>
              </div>
              <hr style={{ borderColor: 'rgba(255,255,255,0.07)' }} />
              <div>
                <label className={lbl} style={lblStyle}>{t('content.brandVoiceField')}</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {VOICE_OPTIONS.map(v => (
                    <button key={v.id} onClick={() => updateBrief({ brandVoice: v.id })}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={brief.brandVoice === v.id
                        ? { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', border: '1px solid rgba(99,102,241,0.4)', color: 'white' }
                        : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}>
                      <span>{v.emoji}</span><span>{t(`content.${v.id}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl} style={lblStyle}>{t('content.campaignGoals')}</label>
                <div className="flex gap-2">
                  {GOAL_OPTIONS.map(g => (
                    <button key={g.id} onClick={() => toggleGoal(g.id)}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={brief.goals.includes(g.id)
                        ? { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', border: '1px solid rgba(99,102,241,0.4)', color: c.textPrimary }
                        : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                      {t(`content.${g.id}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl} style={lblStyle}>{t('content.languageField')}</label>
                <div className="flex gap-2">
                  {[{ id: 'he' as const, label: `🇮🇱 ${t('content.hebrewLang')}` }, { id: 'en' as const, label: `🇺🇸 ${t('content.englishLang')}` }].map(l => (
                    <button key={l.id} onClick={() => updateBrief({ language: l.id })}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={brief.language === l.id
                        ? { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', border: '1px solid rgba(99,102,241,0.4)', color: c.textPrimary }
                        : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Actions ─── */}
          <div className="p-4 flex-shrink-0 space-y-2" style={{ borderTop: `1px solid ${c.divider}` }}>
            {!selectedClient ? (
              <p className="text-center text-[11px] py-1" style={{ color: c.textMuted }}>{t('content.selectClientStart')}</p>
            ) : !selectedProject ? (
              <p className="text-center text-[11px] py-1" style={{ color: c.textMuted }}>{t('content.selectProjectContinue')}</p>
            ) : generating ? (
              <div className="flex gap-2">
                <div className="flex-1 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                  <Loader2 size={15} className="animate-spin" /> {t('content.generating')}
                </div>
                <button onClick={handleStop} className="px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{ border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', background: 'rgba(248,113,113,0.08)' }}>
                  {t('content.stop')}
                </button>
              </div>
            ) : hasContent ? (
              <div className="flex gap-2">
                <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                  className="flex-1 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
                  <RefreshCw size={14} /> {t('content.regenerateAll')}
                </button>
                <button onClick={handleReset} className="px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{ border: `1px solid ${c.cardBorder}`, color: c.textSecondary, background: c.subtleBg }}>
                  {t('content.clear')}
                </button>
              </div>
            ) : (
              <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                className="w-full disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
                <Sparkles size={15} /> {t('content.generateCreative')}
                {filesContext && <span className="text-[10px] opacity-60">+ {files.filter(f=>f.analysis).length} {t('content.filesCount')}</span>}
              </button>
            )}
            {selectedClient && selectedProject && !brief.company.trim() && (
              <p className="text-center text-[11px]" style={{ color: c.textMuted }}>{t('content.fillCompanyFirst')}</p>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════ RIGHT MAIN AREA ════════════════ */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* ── No client selected ── */}
        {viewMode === 'clients' && (
          <div className="flex flex-col items-center justify-center min-h-[500px] gap-6 text-center">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 32px rgba(99,102,241,0.3)' }}>
              <Layers size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight mb-2" style={{ color: c.textPrimary }}>{t('content.welcomeTitle')}</h2>
              <p className="text-sm max-w-sm leading-relaxed" style={{ color: c.textSecondary }}>
                {t('content.welcomeDesc')}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs max-w-lg" style={{ color: c.textMuted }}>
              {[
                { icon: <Building2 size={18}/>, label: t('content.savedClients') },
                { icon: <FolderOpen size={18}/>, label: t('content.organizedProjects') },
                { icon: <Pencil size={18}/>, label: t('content.customPrompt') },
                { icon: <Upload size={18}/>, label: t('content.brandFileAnalysis') },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <div style={{ color: 'rgba(129,140,248,0.8)' }}>{item.icon}</div>
                  <span className="font-medium" style={{ color: c.textSecondary }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Client selected, no project ── */}
        {viewMode === 'project' && client && (
          <div className="space-y-4">
            <div className="rounded-2xl p-6"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setShowNewProject(true)}
                  className="flex items-center gap-2 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
                  <Plus size={14} /> {t('content.newProjectBtn')}
                </button>
                <div className="text-right">
                  <h2 className="text-xl font-bold" style={{ color: c.textPrimary }}>{client.brief.company}</h2>
                  <p className="text-sm" style={{ color: c.textMuted }}>{clientProjects.length} {t('content.projectsCount')}</p>
                </div>
              </div>
              {clientProjects.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen size={40} className="mx-auto mb-3" style={{ color: c.textMuted }} />
                  <p className="text-sm" style={{ color: c.textMuted }}>{t('content.noProjectsYet')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {clientProjects.map(p => (
                    <ProjectCard key={p.id} project={p}
                      onSelect={() => { setSelectedProject(p.id); setSections(EMPTY_SECTIONS); }}
                      onDelete={() => deleteProject(p.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Project selected — files + content generation ── */}
        {viewMode === 'generate' && project && (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm" style={{ color: c.textMuted }}>
              <button onClick={() => setSelectedProject(null)} className="transition-colors flex items-center gap-1"
                style={{ color: c.textMuted }}
                onMouseEnter={e => (e.currentTarget.style.color = 'white') }
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)') }>
                <Building2 size={13} /> {client?.brief.company}
              </button>
              <ChevronDown size={13} className="-rotate-90" />
              <span className="font-semibold flex items-center gap-1" style={{ color: c.textPrimary }}>
                <Folder size={13} style={{ color: c.accentText }} /> {project.name}
              </span>
            </div>

            {/* ── Custom Prompt Card ── */}
            <div className="rounded-2xl overflow-hidden"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <div className="px-5 py-3.5 flex items-center justify-between"
                style={{ borderBottom: `1px solid ${c.divider}` }}>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingPrompt(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: c.accentText }}>
                    <Pencil size={12} /> {editingPrompt ? t('content.closeEdit') : t('content.editPrompt')}
                  </button>
                  {customPrompt && !editingPrompt && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: 'rgba(99,102,241,0.15)', color: c.accentText, border: '1px solid rgba(99,102,241,0.3)' }}>
                      {t('content.promptActive')}
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold flex items-center gap-2" style={{ color: c.textSecondary }}>
                  <Sparkles size={14} style={{ color: c.accentText }} /> {t('content.projectPrompt')}
                </span>
              </div>
              <div className="px-5 py-4">
                {editingPrompt ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      defaultValue={customPrompt}
                      onChange={e => updateCustomPrompt(e.target.value)}
                      placeholder="כתוב כאן הנחיות מיוחדות ליצירת התוכן — לדוגמה: 'פרויקט יוקרתי בתל אביב לרוכשים גיל 40+, דגש על איכות חיים ועיצוב מינימליסטי. להשתמש בשפה פורמלית ויוקרתית. לא להזכיר מחיר.'"
                      rows={4}
                      className="w-full rounded-xl px-4 py-3 text-sm text-right focus:outline-none resize-none"
                      style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: c.textPrimary }}
                    />
                    <p className="text-[11px] text-right flex items-center justify-end gap-1" style={{ color: c.textMuted }}>
                      <Check size={10} style={{ color: '#34d399' }} /> {t('content.autoSaved')}
                    </p>
                  </div>
                ) : customPrompt ? (
                  <div className="rounded-xl px-4 py-3 cursor-pointer transition-colors"
                    style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}
                    onClick={() => setEditingPrompt(true)}>
                    <p className="text-sm text-right leading-relaxed" style={{ color: 'rgba(129,140,248,0.9)' }}>{customPrompt}</p>
                  </div>
                ) : (
                  <button onClick={() => setEditingPrompt(true)}
                    className="w-full rounded-xl p-6 text-center transition-all"
                    style={{ border: '2px dashed rgba(99,102,241,0.25)', background: 'transparent' }}>
                    <Pencil size={22} className="mx-auto mb-2" style={{ color: c.textMuted }} />
                    <p className="text-sm font-medium" style={{ color: c.textMuted }}>{t('content.addCustomPrompt')}</p>
                    <p className="text-xs mt-1" style={{ color: c.textMuted }}>{t('content.promptHint')}</p>
                  </button>
                )}
              </div>
            </div>

            {/* ── File upload area ── */}
            <div className="rounded-2xl overflow-hidden"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <div className="px-5 py-3.5 flex items-center justify-between"
                style={{ borderBottom: `1px solid ${c.divider}` }}>
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: c.accentText }}>
                  <Upload size={12} /> {t('content.uploadFiles')}
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: c.textMuted }}>{files.length} {t('content.filesCount')}</span>
                  {files.filter(f => f.analysis).length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }}>
                      {files.filter(f => f.analysis).length} {t('content.analyzedCount')}
                    </span>
                  )}
                  <span className="text-sm font-bold" style={{ color: c.textSecondary }}>{t('content.brandAssets')}</span>
                </div>
              </div>

              <input ref={fileInputRef} type="file" multiple accept={ACCEPTED}
                className="hidden" onChange={e => handleFiles(e.target.files)} />

              {files.length === 0 ? (
                <div
                  onDrop={handleDrop} onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="m-4 rounded-xl p-8 text-center cursor-pointer transition-all"
                  style={{ background: c.subtleBg, border: '2px dashed rgba(99,102,241,0.25)' }}>
                  <Upload size={28} className="mx-auto mb-3" style={{ color: c.textMuted }} />
                  <p className="text-sm font-semibold" style={{ color: c.textSecondary }}>{t('content.dragOrClick')}</p>
                  <p className="text-xs mt-1" style={{ color: c.textMuted }}>{t('content.fileTypes')} {MAX_FILE_MB}MB {t('content.fileTypesEnd')}</p>
                  <p className="text-xs mt-2 font-medium" style={{ color: c.accentText }}>{t('content.filesSavedNote')}</p>
                </div>
              ) : (
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {files.map(f => (
                      <FileCard key={f.id} file={f}
                        onDelete={() => deleteFile(f.id)}
                        onAnalyze={() => analyzeFile(f.id)}
                        analyzing={analyzingId === f.id} />
                    ))}
                  </div>
                  <div
                    onDrop={handleDrop} onDragOver={e => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl p-3 text-center cursor-pointer transition-all"
                    style={{ border: '1px dashed rgba(255,255,255,0.1)' }}>
                    <p className="text-xs flex items-center justify-center gap-1.5" style={{ color: c.textMuted }}>
                      <Upload size={11} /> {t('content.addMoreFiles')}
                    </p>
                  </div>
                  {filesContext && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
                      <Bot size={12} style={{ color: '#34d399' }} />
                      <p className="text-[11px] font-medium" style={{ color: '#34d399' }}>{files.filter(f=>f.analysis).length} {t('content.filesIntegrated')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Content tabs ── */}
            {hasContent && (
              <>
                <div className="flex gap-1 rounded-2xl p-1.5"
                  style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}>
                  {TABS.map(tab => {
                    const s = sections[tab.id];
                    const active = activeTab === tab.id;
                    const isRegen = regenTab === tab.id;
                    return (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                        style={active
                          ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                          : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                        <tab.icon size={14} />
                        <span className="hidden sm:inline">{t(`content.tabs.${tab.id}`)}</span>
                        {(s.loading || isRegen) && <Loader2 size={11} className="animate-spin opacity-60" />}
                        {s.done && !s.loading && !isRegen && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                    );
                  })}
                </div>

                {/* Tab header with per-tab regenerate */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {cur.done && cur.content && !cur.content.startsWith('⚠️') && (
                      <>
                        <CopyBtn text={cur.content} />
                        <button
                          onClick={() => handleRegenerateTab(activeTab)}
                          disabled={!!regenTab || generating}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                          style={{ border: `1px solid ${c.cardBorder}`, background: c.subtleBg, color: c.textSecondary }}>
                          {regenTab === activeTab
                            ? <><Loader2 size={11} className="animate-spin" /> {t('content.generating')}</>
                            : <><RefreshCw size={11} /> {t('content.regenerateTab')}</>}
                        </button>
                      </>
                    )}
                  </div>
                  <div className="text-right">
                    <h3 className="font-bold" style={{ color: c.textPrimary }}>{t(`content.tabs.${activeTab}`)}</h3>
                    {brief.company && <p className="text-xs" style={{ color: c.textMuted }}>{brief.company} · {brief.niche}</p>}
                  </div>
                </div>

                {activeTab === 'visuals'
                  ? <VisualsOutput content={cur.content} sectionLoading={cur.loading} />
                  : <SectionOutput content={cur.content} loading={cur.loading} />}
              </>
            )}

            {/* ── Empty content state ── */}
            {!hasContent && (
              <div className="rounded-2xl p-12 text-center"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
                <Sparkles size={32} className="mx-auto mb-3" style={{ color: c.textMuted }} />
                <p className="font-semibold" style={{ color: c.textSecondary }}>{t('content.readyToGenerate')}</p>
                <div className="text-xs mt-1 space-y-0.5" style={{ color: c.textMuted }}>
                  {customPrompt && <p style={{ color: c.accentText }} className="font-medium">{t('content.customPromptActive')}</p>}
                  {filesContext
                    ? <p>{t('content.brandFilesReady').replace('{n}', String(files.filter(f=>f.analysis).length))}</p>
                    : <p>{t('content.uploadBrandFiles')}</p>}
                </div>
                <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                  className="mt-5 inline-flex items-center gap-2 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
                  <Sparkles size={14} /> {t('content.generateCreative')}
                </button>
                {(!brief.company.trim() || !brief.niche.trim()) && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 text-xs" style={{ color: '#fbbf24' }}>
                    <AlertCircle size={12} /> {t('content.fillCompanyAndNiche')}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

// needed for JSX without explicit React import
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ReactNodeUsed: ReactNode = null;
