/**
 * AiInsightCard.tsx
 * Per-page inline insight card shown at the top of each page.
 * Shows the highest-priority insight for the current page (or global).
 * Dismiss saves to sessionStorage — won't reappear until next session.
 */
import { useState, useMemo } from 'react';
import { Bot, X, ChevronRight, Sparkles } from 'lucide-react';
import type { Insight } from '../lib/insightEngine';

interface AiInsightCardProps {
  insights: Insight[];
  currentPage: string;
  onOpenAi: (query: string) => void;
}

const DISMISS_KEY = 'ray-dismissed-insights';

function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? '[]')); }
  catch { return new Set(); }
}
function dismiss(id: string): void {
  const s = getDismissed();
  s.add(id);
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
}

export default function AiInsightCard({ insights, currentPage, onOpenAi }: AiInsightCardProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);

  // Pick the highest-priority insight for this page (or any page if none match)
  const insight = useMemo(() => {
    const active = insights.filter(i => !dismissed.has(i.id));
    return (
      active.find(i => i.page === currentPage) ??
      active.find(i => !i.page) ??
      active[0] ??
      null
    );
  }, [insights, currentPage, dismissed]);

  if (!insight) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss(insight.id);
    setDismissed(new Set(getDismissed()));
  };

  const typeStyles: Record<Insight['type'], { bg: string; border: string; accent: string; pill: string }> = {
    warning:     { bg: 'rgba(251,146,60,0.06)',  border: 'rgba(251,146,60,0.25)',  accent: '#fb923c', pill: 'rgba(251,146,60,0.15)' },
    opportunity: { bg: 'rgba(52,211,153,0.06)',  border: 'rgba(52,211,153,0.25)',  accent: '#34d399', pill: 'rgba(52,211,153,0.15)' },
    setup:       { bg: 'rgba(99,102,241,0.06)',  border: 'rgba(99,102,241,0.25)',  accent: '#a5b4fc', pill: 'rgba(99,102,241,0.15)' },
    tip:         { bg: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.25)',  accent: '#60a5fa', pill: 'rgba(96,165,250,0.15)' },
    milestone:   { bg: 'rgba(167,139,250,0.06)', border: 'rgba(167,139,250,0.25)', accent: '#a78bfa', pill: 'rgba(167,139,250,0.15)' },
  };

  const s = typeStyles[insight.type];

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-3 cursor-pointer group transition-all duration-200 hover:scale-[1.005]"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
      onClick={() => onOpenAi(insight.query)}
      dir="rtl"
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base"
        style={{ background: s.pill }}>
        {insight.icon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Bot size={10} style={{ color: s.accent }} />
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: s.accent }}>RAY מציע</span>
        </div>
        <p className="text-xs font-semibold truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {insight.title}
        </p>
        <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {insight.body}
        </p>
      </div>

      {/* CTA */}
      <button
        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all group-hover:scale-105"
        style={{ background: s.pill, color: s.accent, border: `1px solid ${s.border}` }}
        onClick={(e) => { e.stopPropagation(); onOpenAi(insight.query); }}
      >
        <Sparkles size={10} />
        <span>{insight.action ?? 'שאל RAY'}</span>
        <ChevronRight size={10} style={{ transform: 'rotate(180deg)' }} />
      </button>

      {/* Dismiss */}
      <button
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
        style={{ color: 'rgba(255,255,255,0.6)' }}
        onClick={handleDismiss}
        title="סגור"
      >
        <X size={11} />
      </button>
    </div>
  );
}
