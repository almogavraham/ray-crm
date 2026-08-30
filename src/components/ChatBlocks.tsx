/**
 * ChatBlocks.tsx — the visual vocabulary shared by both copilots.
 *
 * A chat that can only emit paragraphs forces the model to describe numbers in
 * prose. Giving it a small set of *typed* visual blocks instead lets it answer
 * the way a real analyst would — with a bar chart, a watchlist, a funnel —
 * while keeping the payload as plain JSON that we validate before rendering.
 *
 * Both SalesCopilot and MarketingCopilot render the same block types, so a
 * capability added here shows up in both chats at once.
 *
 * Safety: every block is defensively normalised (asArr, clamped widths,
 * http(s)-only image URLs). A malformed block degrades to nothing rather than
 * breaking the chat.
 */

import { useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Clock, AlertTriangle,
  CheckCircle2, Circle, ArrowLeft, Copy, Check, Image as ImageIcon,
} from 'lucide-react';

/* ── Block vocabulary (mirrored in both system prompts) ───────────────────── */
export type ChatBlock =
  | { type: 'bars';      title?: string; unit?: string; items: BarItem[] }
  | { type: 'metrics';   title?: string; items: MetricItem[] }
  | { type: 'watchlist'; title?: string; items: WatchItem[] }
  | { type: 'funnel';    title?: string; steps: FunnelStep[] }
  | { type: 'checklist'; title?: string; items: CheckItem[] }
  | { type: 'compare';   title?: string; a: ComparePane; b: ComparePane }
  | { type: 'timeline';  title?: string; items: TimelineItem[] }
  | { type: 'post';      platform?: string; caption: string; hashtags?: string[]; cta?: string; imageUrl?: string; imagePrompt?: string }
  | { type: 'image';     url: string; caption?: string }
  | { type: 'quote';     text: string; label?: string };

export interface BarItem      { label: string; value: number; hint?: string; color?: string }
export interface MetricItem   { label: string; value: string; delta?: string; tone?: 'good' | 'bad' | 'warn' | 'flat' }
export interface WatchItem    { leadId?: string; name: string; why: string; urgency?: 'high' | 'medium' | 'low'; meta?: string }
export interface FunnelStep   { label: string; count: number }
export interface CheckItem    { text: string; done?: boolean }
export interface ComparePane  { label: string; points: string[] }
export interface TimelineItem { when: string; what: string }

/* ── Normalisation — never trust model output ─────────────────────────────── */
const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num   = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str   = (v: unknown) => (typeof v === 'string' ? v : '');
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

/** Keep only blocks that will actually render something. */
export function sanitiseBlocks(raw: unknown): ChatBlock[] {
  return asArr<Record<string, unknown>>(raw)
    .map(b => {
      switch (b?.type) {
        case 'bars':      return asArr(b.items).length ? (b as unknown as ChatBlock) : null;
        case 'metrics':   return asArr(b.items).length ? (b as unknown as ChatBlock) : null;
        case 'watchlist': return asArr(b.items).length ? (b as unknown as ChatBlock) : null;
        case 'funnel':    return asArr(b.steps).length ? (b as unknown as ChatBlock) : null;
        case 'checklist': return asArr(b.items).length ? (b as unknown as ChatBlock) : null;
        case 'timeline':  return asArr(b.items).length ? (b as unknown as ChatBlock) : null;
        case 'compare':   return b.a && b.b            ? (b as unknown as ChatBlock) : null;
        case 'post':      return str(b.caption)        ? (b as unknown as ChatBlock) : null;
        case 'image':     return safeUrl(b.url)        ? (b as unknown as ChatBlock) : null;
        case 'quote':     return str(b.text)           ? (b as unknown as ChatBlock) : null;
        default:          return null;
      }
    })
    .filter(Boolean)
    .slice(0, 6) as ChatBlock[];
}

const PALETTE = ['#6366f1', '#0891b2', '#f97316', '#10b981', '#ec4899', '#eab308', '#8b5cf6', '#ef4444'];

const URGENCY = {
  high:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  bd: 'rgba(239,68,68,0.25)',  label: 'דחוף' },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', bd: 'rgba(245,158,11,0.25)', label: 'השבוע' },
  low:    { color: '#10b981', bg: 'rgba(16,185,129,0.08)', bd: 'rgba(16,185,129,0.22)', label: 'רגיל' },
} as const;

const URGENCY_ICON = {
  high:   <AlertTriangle size={11} />,
  medium: <Clock size={11} />,
  low:    <Circle size={11} />,
} as const;

interface Props {
  block: ChatBlock;
  /** Accent colour of the hosting chat (teal for sales, fuchsia for marketing). */
  accent: string;
  onLeadClick?: (leadId: string) => void;
  onCopy?: (text: string) => void;
}

export default function ChatBlockView({ block, accent, onLeadClick, onCopy }: Props) {
  switch (block.type) {
    case 'bars':      return <Bars      b={block} accent={accent} />;
    case 'metrics':   return <Metrics   b={block} />;
    case 'watchlist': return <Watchlist b={block} accent={accent} onLeadClick={onLeadClick} />;
    case 'funnel':    return <Funnel    b={block} accent={accent} />;
    case 'checklist': return <Checklist b={block} accent={accent} />;
    case 'compare':   return <Compare   b={block} accent={accent} />;
    case 'timeline':  return <Timeline  b={block} accent={accent} />;
    case 'post':      return <PostCard  b={block} accent={accent} onCopy={onCopy} />;
    case 'image':     return <ImageCard b={block} />;
    case 'quote':     return <QuoteCard b={block} accent={accent} />;
    default:          return null;
  }
}

/* ── Shell ────────────────────────────────────────────────────────────────── */
function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white/70 p-2.5">
      {title && <div className="text-[11px] font-black text-slate-500 mb-2 text-right">{title}</div>}
      {children}
    </div>
  );
}

/* ── bars — horizontal comparison (source performance, budget by stage…) ──── */
function Bars({ b, accent }: { b: Extract<ChatBlock, { type: 'bars' }>; accent: string }) {
  const items = asArr<BarItem>(b.items).slice(0, 8).map(i => ({ ...i, value: num(i.value) }));
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <Frame title={b.title}>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="font-black tabular-nums" style={{ color: it.color || accent }}>
                {it.value.toLocaleString('he-IL')}{b.unit ?? ''}
              </span>
              <span className="font-bold text-slate-600 truncate max-w-[62%]">{str(it.label)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex justify-end">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max(2, Math.min(100, (it.value / max) * 100))}%`,
                  background: it.color || PALETTE[i % PALETTE.length],
                }} />
            </div>
            {it.hint && <div className="text-[9px] text-slate-400 text-right mt-0.5">{str(it.hint)}</div>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ── metrics — KPI tiles ──────────────────────────────────────────────────── */
const TONES = {
  good: { c: '#10b981', icon: <TrendingUp size={9} /> },
  bad:  { c: '#ef4444', icon: <TrendingDown size={9} /> },
  warn: { c: '#f59e0b', icon: <AlertTriangle size={9} /> },
  flat: { c: '#64748b', icon: <Minus size={9} /> },
} as const;

function Metrics({ b }: { b: Extract<ChatBlock, { type: 'metrics' }> }) {
  const items = asArr<MetricItem>(b.items).slice(0, 6);
  return (
    <Frame title={b.title}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {items.map((m, i) => {
          const t = TONES[m.tone ?? 'flat'] ?? TONES.flat;
          return (
            <div key={i} className="rounded-lg px-2 py-1.5 text-right"
              style={{ background: `${t.c}0d`, border: `1px solid ${t.c}26` }}>
              <div className="text-[9px] text-slate-500 font-bold truncate">{str(m.label)}</div>
              <div className="text-sm font-black tabular-nums" style={{ color: t.c }}>{str(m.value)}</div>
              {m.delta && (
                <div className="flex items-center gap-0.5 justify-end text-[9px] font-bold" style={{ color: t.c }}>
                  {t.icon}{str(m.delta)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── watchlist — "who to chase" ───────────────────────────────────────────── */
function Watchlist({ b, accent, onLeadClick }: {
  b: Extract<ChatBlock, { type: 'watchlist' }>; accent: string; onLeadClick?: (id: string) => void;
}) {
  const items = asArr<WatchItem>(b.items).slice(0, 8);
  return (
    <Frame title={b.title ?? '👀 מי דורש מעקב'}>
      <div className="space-y-1.5">
        {items.map((w, i) => {
          const key = w.urgency ?? 'medium';
          const u = URGENCY[key] ?? URGENCY.medium;
          const icon = URGENCY_ICON[key] ?? URGENCY_ICON.medium;
          const clickable = Boolean(w.leadId && onLeadClick);
          return (
            <button key={i} disabled={!clickable}
              onClick={() => w.leadId && onLeadClick?.(w.leadId)}
              className="w-full text-right rounded-lg px-2.5 py-2 transition-all disabled:cursor-default hover:brightness-95"
              style={{ background: u.bg, border: `1px solid ${u.bd}` }}>
              <div className="flex items-center gap-1.5 justify-end">
                {clickable && <ArrowLeft size={10} style={{ color: accent }} />}
                <span className="flex-1 text-[11px] font-black text-slate-700 truncate">{str(w.name)}</span>
                <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded"
                  style={{ color: u.color, background: `${u.color}1a` }}>
                  {icon}{u.label}
                </span>
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5 leading-snug">{str(w.why)}</div>
              {w.meta && <div className="text-[9px] text-slate-400 mt-0.5">{str(w.meta)}</div>}
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── funnel — stage-to-stage drop-off ─────────────────────────────────────── */
function Funnel({ b, accent }: { b: Extract<ChatBlock, { type: 'funnel' }>; accent: string }) {
  const steps = asArr<FunnelStep>(b.steps).slice(0, 7).map(s => ({ label: str(s.label), count: num(s.count) }));
  const top = Math.max(steps[0]?.count ?? 1, 1);
  return (
    <Frame title={b.title ?? 'משפך'}>
      <div className="space-y-1">
        {steps.map((s, i) => {
          const pct = Math.max(3, Math.min(100, (s.count / top) * 100));
          const prev = steps[i - 1]?.count;
          const drop = prev && prev > 0 ? Math.round((1 - s.count / prev) * 100) : null;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[9px] text-red-400 font-bold w-9 tabular-nums">
                {drop !== null && drop > 0 ? `-${drop}%` : ''}
              </span>
              <div className="flex-1 flex justify-end">
                <div className="h-6 rounded-md flex items-center justify-end px-2 transition-all"
                  style={{ width: `${pct}%`, background: `${accent}${i === 0 ? '33' : '1f'}`, border: `1px solid ${accent}33` }}>
                  <span className="text-[10px] font-black" style={{ color: accent }}>{s.count}</span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-600 w-20 text-right truncate">{s.label}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── checklist — an action plan the user can tick off ─────────────────────── */
function Checklist({ b, accent }: { b: Extract<ChatBlock, { type: 'checklist' }>; accent: string }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const items = asArr<CheckItem>(b.items).slice(0, 8);
  return (
    <Frame title={b.title ?? '✅ תוכנית פעולה'}>
      <div className="space-y-1">
        {items.map((it, i) => {
          const on = ticked.has(i) || it.done;
          return (
            <button key={i}
              onClick={() => setTicked(s => {
                const n = new Set(s);
                if (n.has(i)) n.delete(i); else n.add(i);
                return n;
              })}
              className="w-full flex items-start gap-1.5 justify-end text-right rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <span className={`text-[11px] leading-snug flex-1 ${on ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                {str(it.text)}
              </span>
              {on
                ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: accent }} />
                : <Circle size={13} className="flex-shrink-0 mt-0.5 text-slate-300" />}
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── compare — two options side by side ───────────────────────────────────── */
function Compare({ b, accent }: { b: Extract<ChatBlock, { type: 'compare' }>; accent: string }) {
  const pane = (p: ComparePane, c: string) => (
    <div className="flex-1 rounded-lg p-2" style={{ background: `${c}0d`, border: `1px solid ${c}26` }}>
      <div className="text-[10px] font-black mb-1 text-right" style={{ color: c }}>{str(p?.label)}</div>
      <ul className="space-y-0.5">
        {asArr<string>(p?.points).slice(0, 5).map((pt, i) => (
          <li key={i} className="text-[10px] text-slate-600 text-right leading-snug">• {str(pt)}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <Frame title={b.title}>
      <div className="flex gap-1.5">{pane(b.a, accent)}{pane(b.b, '#64748b')}</div>
    </Frame>
  );
}

/* ── timeline — a sequenced plan ──────────────────────────────────────────── */
function Timeline({ b, accent }: { b: Extract<ChatBlock, { type: 'timeline' }>; accent: string }) {
  const items = asArr<TimelineItem>(b.items).slice(0, 8);
  return (
    <Frame title={b.title}>
      <div className="space-y-0">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 justify-end">
            <div className="flex-1 pb-2.5 text-right">
              <div className="text-[10px] font-black" style={{ color: accent }}>{str(it.when)}</div>
              <div className="text-[10px] text-slate-600 leading-snug">{str(it.what)}</div>
            </div>
            <div className="flex flex-col items-center flex-shrink-0 pt-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
              {i < items.length - 1 && <div className="w-px flex-1" style={{ background: `${accent}33` }} />}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ── post — a ready-to-publish social post preview ────────────────────────── */
function PostCard({ b, accent, onCopy }: {
  b: Extract<ChatBlock, { type: 'post' }>; accent: string; onCopy?: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const tags = asArr<string>(b.hashtags).map(h => (h.startsWith('#') ? h : `#${h}`));
  const full = [str(b.caption), tags.join(' ')].filter(Boolean).join('\n\n');
  const img = safeUrl(b.imageUrl);
  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 bg-white">
      <div className="px-2.5 py-1.5 flex items-center justify-between" style={{ background: `${accent}0f` }}>
        <button
          onClick={() => {
            onCopy?.(full);
            navigator.clipboard?.writeText(full).catch(() => {});
            setCopied(true); setTimeout(() => setCopied(false), 1600);
          }}
          className="text-[9px] font-bold flex items-center gap-1" style={{ color: accent }}>
          {copied ? <Check size={10} /> : <Copy size={10} />}{copied ? 'הועתק' : 'העתק'}
        </button>
        <span className="text-[10px] font-black" style={{ color: accent }}>{str(b.platform) || 'פוסט'}</span>
      </div>
      {img
        ? <img src={img} alt="" className="w-full object-cover" style={{ maxHeight: 240 }} />
        : b.imagePrompt
          ? <div className="px-2.5 py-3 flex items-center gap-1.5 justify-end text-[9px] text-slate-400 bg-slate-50">
              <span className="truncate">{str(b.imagePrompt)}</span><ImageIcon size={11} />
            </div>
          : null}
      <div className="px-2.5 py-2 text-right">
        <p className="text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed">{str(b.caption)}</p>
        {b.cta && <p className="text-[10px] font-black mt-1.5" style={{ color: accent }}>← {str(b.cta)}</p>}
        {tags.length > 0 && (
          <p className="text-[9px] mt-1.5 leading-relaxed" style={{ color: `${accent}cc` }}>{tags.join(' ')}</p>
        )}
      </div>
    </div>
  );
}

/* ── image — a generated visual ───────────────────────────────────────────── */
function ImageCard({ b }: { b: Extract<ChatBlock, { type: 'image' }> }) {
  const url = safeUrl(b.url);
  if (!url) return null;
  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 bg-white">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={str(b.caption)} className="w-full object-cover" style={{ maxHeight: 300 }} />
      </a>
      {b.caption && <div className="px-2.5 py-1.5 text-[10px] text-slate-500 text-right">{str(b.caption)}</div>}
    </div>
  );
}

/* ── quote — a highlighted takeaway ───────────────────────────────────────── */
function QuoteCard({ b, accent }: { b: Extract<ChatBlock, { type: 'quote' }>; accent: string }) {
  return (
    <div className="mt-2 rounded-xl px-3 py-2 text-right"
      style={{ background: `${accent}0d`, borderInlineEnd: `3px solid ${accent}` }}>
      {b.label && <div className="text-[9px] font-black mb-0.5" style={{ color: accent }}>{str(b.label)}</div>}
      <p className="text-[11px] font-bold text-slate-700 leading-snug">{str(b.text)}</p>
    </div>
  );
}
