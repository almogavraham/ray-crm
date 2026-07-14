import { useState, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  Search, Phone, Mail, Star, AlertCircle, CheckSquare,
  Calendar, Zap, Share2, Megaphone, Globe, Users,
  Sparkles, TrendingUp, ArrowUpRight,
  MessageCircle, ChevronDown, X, Filter,
  Flame, Snowflake, ChevronLeft, ChevronRight,
  BarChart2, Eye, EyeOff,
} from 'lucide-react';
import type { Lead, LeadStatus, LeadSource, WorkspaceProfile } from '../types';
import { DEFAULT_CARD_LAYOUT } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import { STATUS_CONFIG as _STATUS_CONFIG } from '../data/mockData'; // kept for future use

/* ─── fallback constants (used when no statusConfigs prop provided) ───────────*/
const DEFAULT_COLUMNS: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];

const DEFAULT_NEON: Record<string, string> = {
  'חדש':         '#6366f1',
  'בתהליך':      '#f97316',
  'לקוח פעיל':   '#10b981',
  'רימרקטינג':   '#8b5cf6',
  'לא רלוונטי':  '#64748b',
};

/* For SOURCE_ICON — tiny icon per source */
const SOURCE_ICON: Record<LeadSource, ReactNode> = {
  'אורגני':      <Globe size={9} />,
  'פרסום ממומן': <Megaphone size={9} />,
  'הפניה':       <Users size={9} />,
  'אינסטגרם':    <Share2 size={9} />,
  'פייסבוק':     <Share2 size={9} />,
  'גוגל':        <Zap size={9} />,
};

type SortKey = 'aiScore' | 'budget' | 'company' | 'lastUpdate';
type FilterMode = null | 'risk' | 'stale' | 'overdue';

/* ─── helpers ────────────────────────────────────────────────────────────────*/
function formatPhone(p: string) {
  const d = p.replace(/\D/g, '');
  return d.startsWith('0') ? '+972' + d.slice(1) : '+' + d;
}

function daysSince(s: string) {
  try {
    const p = s.split('/');
    const d = p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`) : new Date(s);
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch { return 0; }
}

function isTaskOverdue(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
  } catch { return false; }
}

function isTaskDueSoon(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date(new Date().toDateString());
    const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
    return diff >= 0 && diff <= 1;
  } catch { return false; }
}

function calcConversion(lead: Lead): number {
  let score = lead.aiScore;
  if ((lead.budget ?? 0) > 15000) score += 10;
  if (lead.phone) score += 5;
  if (daysSince(lead.lastUpdate) > 14) score -= 15;
  const overdue = lead.tasks.filter(t => !t.completed && isTaskOverdue(t.date));
  if (overdue.length > 0) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

type TempType = 'hot' | 'cold' | 'active' | 'normal';

function getTemperature(lead: Lead): TempType {
  const stale = daysSince(lead.lastUpdate);
  const hasSoonTask = lead.tasks.some(t => !t.completed && isTaskDueSoon(t.date));
  if (hasSoonTask) return 'active';
  if (lead.aiScore >= 75 && stale < 7) return 'hot';
  if (stale > 21) return 'cold';
  return 'normal';
}

/* ─── interfaces ─────────────────────────────────────────────────────────────*/
interface KanbanProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadSave: (lead: Lead) => void;
  onPageChange?: (page: string) => void;
  statusConfigs?: StatusConfig[];
  workspace?: WorkspaceProfile;
}

/* ─── SVG Score Ring ─────────────────────────────────────────────────────────*/
function ScoreRing({ score }: { score: number }) {
  const { c } = useTheme();
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f97316' : '#ef4444';
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="flex-shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r} fill="none"
        stroke={color} strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ * 0.25}
        style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x="18" y="22" textAnchor="middle" fontSize="8" fontWeight="800" fill={color}>
        {score}
      </text>
    </svg>
  );
}

/* ─── Column Intelligence Stats ──────────────────────────────────────────────*/
function ColStats({ leads, neon }: { leads: Lead[]; neon: string }) {
  const { c } = useTheme();
  const avg = leads.length ? Math.round(leads.reduce((s, l) => s + l.aiScore, 0) / leads.length) : 0;
  const val = leads.reduce((s, l) => s + (l.budget ?? 0), 0);
  const overdue = leads.filter(l => l.tasks.some(t => !t.completed && isTaskOverdue(t.date))).length;

  /* mini heatmap — 5 buckets */
  const buckets = [0, 0, 0, 0, 0];
  leads.forEach(l => { buckets[Math.min(4, Math.floor(l.aiScore / 20))]++; });
  const maxB = Math.max(1, ...buckets);

  return (
    <div className="px-3 pb-2 pt-1 border-b border-white/5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[10px]">
          {avg > 0 && (
            <span className="font-bold" style={{ color: neon }}>AI {avg}%</span>
          )}
          {val > 0 && (
            <span className="text-white/40 font-medium">₪{(val / 1000).toFixed(0)}K</span>
          )}
          {overdue > 0 && (
            <span className="text-red-400 font-bold flex items-center gap-0.5">
              <AlertCircle size={8} />{overdue}
            </span>
          )}
        </div>
      </div>
      {/* Score heatmap */}
      {leads.length > 0 && (
        <div className="flex gap-0.5 items-end h-3">
          {buckets.map((b, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-500"
              style={{
                height: `${(b / maxB) * 100}%`,
                minHeight: b > 0 ? 3 : 0,
                backgroundColor: b > 0 ? neon + (i < 2 ? '40' : i < 4 ? '80' : 'cc') : 'rgba(255,255,255,0.05)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   KANBAN CARD
════════════════════════════════════════════════════════════════════════════ */
function KanbanCard({ lead, neon, onClick, onDragStart, kanbanFields }: {
  lead: Lead;
  neon: string;
  onClick: () => void;
  onDragStart: () => void;
  kanbanFields?: string[];
}) {
  const showField = (field: string) => !kanbanFields || kanbanFields.includes(field);
  const { c } = useTheme();
  const isVIP = (lead.budget ?? 0) >= 15000;
  const openTasks = lead.tasks.filter(t => !t.completed);
  const overdue = openTasks.filter(t => isTaskOverdue(t.date));
  const nextTask = [...openTasks].sort((a, b) => a.date.localeCompare(b.date))[0];
  const stale = daysSince(lead.lastUpdate);
  const initials = (lead.assignedTo ?? '').split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
  const temp = getTemperature(lead);
  const conversion = calcConversion(lead);

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onClick={onClick}
      className="relative rounded-xl cursor-grab active:cursor-grabbing group select-none overflow-hidden transition-all duration-200"
      style={{
        background: c.subtleBg,
        backdropFilter: 'blur(8px)',
        border: `1px solid rgba(255,255,255,0.08)`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.3)`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.01) translateY(-1px)';
        (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 24px ${neon}30, 0 2px 8px rgba(0,0,0,0.4)`;
        (e.currentTarget as HTMLElement).style.borderColor = neon + '50';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = '';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)';
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute top-0 right-0 w-0.5 h-full"
        style={{ background: `linear-gradient(to bottom, ${neon}, ${neon}40)` }}
      />

      {/* Temperature glow top strip */}
      {temp === 'hot' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 via-red-500 to-orange-500"
          style={{ boxShadow: '0 0 8px #f97316' }} />
      )}
      {temp === 'cold' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 via-blue-400 to-cyan-500"
          style={{ boxShadow: '0 0 8px #06b6d4' }} />
      )}
      {temp === 'active' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-400"
          style={{ boxShadow: '0 0 8px #fbbf24' }} />
      )}

      {/* VIP ribbon */}
      {isVIP && (
        <div
          className="absolute top-2 left-0 text-[8px] font-black text-amber-900 px-1.5 py-0.5 rounded-r"
          style={{ background: 'linear-gradient(90deg, #fbbf24, #f59e0b)', boxShadow: '0 0 8px #f59e0b60' }}
        >
          VIP
        </div>
      )}

      <div className="p-3">
        {/* Row 1: company + score ring */}
        <div className="flex items-start justify-between gap-2 mb-2">
          {showField('aiScore') && <ScoreRing score={lead.aiScore} />}
          <div className="flex-1 min-w-0 text-right">
            <p className="font-bold text-white text-xs leading-snug truncate">{lead.company}</p>
            <p className="text-[11px] text-white/50 truncate mt-0.5">{lead.contactName}</p>
          </div>
        </div>

        {/* Temperature + Conversion row */}
        {(showField('conversion') || showField('temperature')) && (
        <div className="flex items-center justify-between mb-2.5">
          {showField('conversion') && <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{
              background: `${neon}20`,
              color: neon,
              border: `1px solid ${neon}40`,
              textShadow: `0 0 8px ${neon}`,
            }}
          >
            פוטנציאל: {conversion}%
          </span>}

          {showField('temperature') && <div className="flex items-center gap-1">
            {temp === 'hot' && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-orange-400" title="לידה חם">
                <Flame size={9} />חם
              </span>
            )}
            {temp === 'cold' && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-cyan-400" title="לא פעיל">
                <Snowflake size={9} />קר
              </span>
            )}
            {temp === 'active' && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-yellow-400" title="משימה קרובה">
                <Zap size={9} />פעיל
              </span>
            )}
          </div>}
        </div>
        )}

        {/* Budget + Source */}
        {(showField('source') || showField('budget')) && (
        <div className="flex items-center justify-between mb-2">
          {showField('source') && lead.source && (
            <span className="flex items-center gap-0.5 text-[10px] text-white/30 font-medium">
              {SOURCE_ICON[lead.source as LeadSource]}
              <span>{lead.source}</span>
            </span>
          )}
          {showField('budget') && (lead.budget ?? 0) > 0 && (
            <span className="text-xs font-black" style={{ color: neon }}>
              ₪{((lead.budget ?? 0) / 1000).toFixed(0)}K
            </span>
          )}
        </div>
        )}

        {/* Solutions chips */}
        {showField('solutions') && lead.solutions.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {lead.solutions.slice(0, 2).map(s => (
              <span
                key={s.name}
                className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${
                  s.delivered
                    ? 'line-through'
                    : s.inProgress
                    ? ''
                    : ''
                }`}
                style={{
                  background: s.delivered
                    ? 'rgba(16,185,129,0.12)'
                    : s.inProgress
                    ? `${neon}18`
                    : 'rgba(255,255,255,0.06)',
                  color: s.delivered
                    ? '#10b981'
                    : s.inProgress
                    ? neon
                    : 'rgba(255,255,255,0.4)',
                }}
              >
                {s.name}
              </span>
            ))}
            {lead.solutions.length > 2 && (
              <span className="text-[9px] text-white/30 font-medium">+{lead.solutions.length - 2}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between pt-2"
          style={{ borderTop: `1px solid ${c.divider}` }}
        >
          {/* Quick actions — desktop hover */}
          <div className="flex items-center gap-1">
            {lead.phone && (
              <a
                href={`https://wa.me/${formatPhone(lead.phone)}`}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-150"
                style={{
                  background: 'rgba(22,163,74,0.15)',
                  border: '1px solid rgba(22,163,74,0.3)',
                  color: '#22c55e',
                  boxShadow: '0 0 8px rgba(22,163,74,0.3)',
                }}
                title="WhatsApp"
              >
                <MessageCircle size={10} />
              </a>
            )}
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-150"
                style={{
                  background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  color: c.accentText,
                  boxShadow: '0 0 8px rgba(99,102,241,0.3)',
                }}
                title="שיחה"
              >
                <Phone size={10} />
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-150"
                style={{
                  background: c.subtleBg,
                  border: `1px solid ${c.cardBorder}`,
                  color: c.textSecondary,
                }}
                title="מייל"
              >
                <Mail size={10} />
              </a>
            )}
          </div>

          {/* Right side badges */}
          <div className="flex items-center gap-1">
            {stale >= 14 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-amber-400"
                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
                {stale}י
              </span>
            )}
            {overdue.length > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-red-400 flex items-center gap-0.5"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertCircle size={8} />{overdue.length}
              </span>
            )}
            {showField('tasks') && openTasks.length > 0 && overdue.length === 0 && (
              <span className="text-[9px] text-white/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                <CheckSquare size={8} />{openTasks.length}
              </span>
            )}
            {lead.waitingContent && (
              <span className="text-[9px] text-amber-400 px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(245,158,11,0.12)' }}>⏳</span>
            )}
            {showField('assignedTo') && initials && (
              <div
                className="w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center"
                style={{ background: neon + '25', color: neon, border: `1px solid ${neon}40` }}
              >
                {initials}
              </div>
            )}
          </div>
        </div>

        {/* Next task */}
        {showField('nextTask') && nextTask && (
          <div
            className="flex items-center gap-1 mt-1.5 text-[10px] text-white/30 pt-1.5"
            style={{ borderTop: `1px solid ${c.divider}` }}
          >
            <Calendar size={9} className="flex-shrink-0 text-white/20" />
            <span className="truncate">{nextTask.date} — {nextTask.description}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════════ */
export default function Kanban({ leads, onLeadClick, onLeadSave, onPageChange, statusConfigs, workspace }: KanbanProps) {
  const { t, dir } = useLang();
  const { isDark, c } = useTheme();

  // ── Derive columns + neon map from statusConfigs ─────────────────────────
  const columns: LeadStatus[] = statusConfigs && statusConfigs.length > 0
    ? [...statusConfigs].sort((a, b) => a.order - b.order).map(s => s.label as LeadStatus)
    : DEFAULT_COLUMNS;

  const neonMap: Record<string, string> = statusConfigs && statusConfigs.length > 0
    ? Object.fromEntries(statusConfigs.map(s => [s.label, s.color]))
    : DEFAULT_NEON;

  const getNeon = (status: string) => neonMap[status] ?? '#6366f1';

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('aiScore');
  const [filterSrc, setFilterSrc] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showInsights, setShowInsights] = useState(true);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);
  const [mobileCol, setMobileCol] = useState<LeadStatus>(() => columns[0] ?? 'חדש');
  const [filterMode, setFilterMode] = useState<FilterMode>(null);
  const dragLeadId = useRef<string | null>(null);
  const touchStartX = useRef<number>(0);

  /* ── computed insights ───────────────────────────────────────────────── */
  const insights = useMemo(() => {
    const risk = leads.filter(l => l.aiScore < 40 && (l.budget ?? 0) > 10000);
    const stale = leads.filter(l => daysSince(l.lastUpdate) > 21);
    const overdueCount = leads.reduce((sum, l) =>
      sum + l.tasks.filter(t => !t.completed && isTaskOverdue(t.date)).length, 0
    );
    return { risk, stale, overdueCount };
  }, [leads]);

  /* ── filter + sort leads per column ─────────────────────────────────── */
  const getCol = useCallback((status: LeadStatus) => {
    let arr = leads.filter(l => l.status === status);

    /* smart filter mode */
    if (filterMode === 'risk') arr = arr.filter(l => l.aiScore < 40 && (l.budget ?? 0) > 10000);
    if (filterMode === 'stale') arr = arr.filter(l => daysSince(l.lastUpdate) > 21);
    if (filterMode === 'overdue') arr = arr.filter(l => l.tasks.some(t => !t.completed && isTaskOverdue(t.date)));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter(l =>
        l.company.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
      );
    }
    if (filterSrc) arr = arr.filter(l => l.source === filterSrc);

    return arr.sort((a, b) => {
      if (sortKey === 'aiScore')    return b.aiScore - a.aiScore;
      if (sortKey === 'budget')     return (b.budget ?? 0) - (a.budget ?? 0);
      if (sortKey === 'company')    return a.company.localeCompare(b.company);
      if (sortKey === 'lastUpdate') return b.lastUpdate.localeCompare(a.lastUpdate);
      return 0;
    });
  }, [leads, search, filterSrc, sortKey, filterMode]);

  /* ── drag handlers ───────────────────────────────────────────────────── */
  const onDragStart = (leadId: string) => { dragLeadId.current = leadId; };
  const onDragOver = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault(); setDragOverCol(status);
  };
  const onDragLeave = () => setDragOverCol(null);
  const onDrop = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault(); setDragOverCol(null);
    const id = dragLeadId.current; dragLeadId.current = null;
    if (!id) return;
    const lead = leads.find(l => l.id === id);
    if (lead && lead.status !== status) {
      onLeadSave({ ...lead, status, lastUpdate: new Date().toLocaleDateString('he-IL') });
    }
  };

  /* ── mobile swipe ────────────────────────────────────────────────────── */
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 50) return;
    const idx = columns.indexOf(mobileCol);
    if (dx < 0 && idx < columns.length - 1) setMobileCol(columns[idx + 1]);
    if (dx > 0 && idx > 0) setMobileCol(columns[idx - 1]);
  };

  /* ── totals ──────────────────────────────────────────────────────────── */
  const pipelineLabels = statusConfigs
    ? new Set(statusConfigs.filter(s => s.pipeline).map(s => s.label))
    : new Set(['חדש', 'בתהליך', 'רימרקטינג']);
  const activeLabels = statusConfigs
    ? new Set(statusConfigs.filter(s => !s.pipeline).map(s => s.label))
    : new Set(['לקוח פעיל']);

  const totalPipeline = leads
    .filter(l => pipelineLabels.has(l.status))
    .reduce((s, l) => s + (l.budget ?? 0), 0);
  const totalRevenue = leads
    .filter(l => activeLabels.has(l.status))
    .reduce((s, l) => s + (l.budget ?? 0), 0);
  const allSources = [...new Set(leads.map(l => l.source).filter(Boolean))];
  const hasFilter = !!search || !!filterSrc || !!filterMode;

  /* dot-grid background pattern via inline style */
  const dotGrid: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.15) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
  };

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div
      className="flex flex-col h-[calc(100vh-112px)] md:h-[calc(100vh-56px)] -mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 overflow-hidden"
      style={{ background: c.pageBg, backgroundImage: c.pageBgImage, backgroundSize: c.pageBgSize }}
      dir={dir}
    >
      {/* ═══ TOOLBAR ═══════════════════════════════════════════════════════ */}
      <div
        className="flex items-center gap-2 px-3 sm:px-5 py-3 flex-wrap flex-shrink-0"
        style={{
          background: 'rgba(10,15,30,0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(99,102,241,0.2)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" style={{ boxShadow: '0 0 8px #6366f1' }} />
            <h1 className="text-sm font-black text-white tracking-wide">{t('kanban.salesPipeline')}</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: c.accentText }}
            >
              {leads.length} לידים
            </span>
            {totalRevenue > 0 && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
              >
                ₪{(totalRevenue / 1000).toFixed(0)}K/חודש
              </span>
            )}
            {totalPipeline > 0 && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}
              >
                ₪{(totalPipeline / 1000).toFixed(0)}K פייפליין
              </span>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('kanban.searchLeads')}
            className="rounded-xl pr-8 pl-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none w-32 sm:w-44 transition-all"
            style={{
              background: c.subtleBg,
              border: `1px solid ${c.cardBorder}`,
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; e.target.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = ''; }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="relative hidden sm:block">
          <ChevronDown size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="rounded-xl pr-3 pl-7 py-1.5 text-[11px] font-semibold text-white/60 focus:outline-none appearance-none cursor-pointer"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}
          >
            <option value="aiScore">{t('kanban.sortAiScore')}</option>
            <option value="budget">{t('kanban.sortBudget')}</option>
            <option value="company">{t('kanban.sortName')}</option>
            <option value="lastUpdate">{t('kanban.sortUpdate')}</option>
          </select>
        </div>

        {/* Filter */}
        <button
          onClick={() => setShowFilter(f => !f)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all"
          style={
            hasFilter || showFilter
              ? { background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.5)', color: c.accentText, boxShadow: '0 0 12px rgba(99,102,241,0.3)' }
              : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
          }
        >
          <Filter size={11} />
          {t('kanban.filter')}
          {hasFilter && <span className="text-[9px] bg-indigo-500 text-white rounded-full px-1">!</span>}
        </button>

        {/* Insights toggle */}
        <button
          onClick={() => setShowInsights(s => !s)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all"
          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}
          title="תובנות AI"
        >
          {showInsights ? <EyeOff size={11} /> : <Eye size={11} />}
          <span className="hidden sm:inline">תובנות</span>
        </button>

      </div>

      {/* ═══ FILTER PANEL ══════════════════════════════════════════════════ */}
      {showFilter && (
        <div
          className="px-4 py-2.5 flex items-center gap-2 flex-wrap flex-shrink-0"
          style={{
            background: 'rgba(99,102,241,0.06)',
            borderBottom: '1px solid rgba(99,102,241,0.15)',
          }}
        >
          <span className="text-[10px] font-bold text-white/30">{t('kanban.filterSource')}</span>
          <button
            onClick={() => setFilterSrc('')}
            className="text-[11px] px-2 py-0.5 rounded-lg font-semibold transition-all"
            style={!filterSrc
              ? { background: 'rgba(99,102,241,0.3)', color: c.accentText, border: '1px solid rgba(99,102,241,0.4)' }
              : { background: c.subtleBg, color: c.textMuted, border: `1px solid ${c.cardBorder}` }
            }
          >
            {t('common.all')}
          </button>
          {allSources.map(s => (
            <button
              key={s}
              onClick={() => setFilterSrc(filterSrc === s ? '' : s)}
              className="text-[11px] px-2 py-0.5 rounded-lg font-semibold transition-all"
              style={filterSrc === s
                ? { background: 'rgba(99,102,241,0.3)', color: c.accentText, border: '1px solid rgba(99,102,241,0.4)' }
                : { background: c.subtleBg, color: c.textMuted, border: `1px solid ${c.cardBorder}` }
              }
            >
              {s}
            </button>
          ))}
          {hasFilter && (
            <button
              onClick={() => { setSearch(''); setFilterSrc(''); setFilterMode(null); }}
              className="mr-auto text-[11px] text-red-400 hover:text-red-300 font-semibold flex items-center gap-1"
            >
              <X size={10} /> {t('kanban.clearFilter')}
            </button>
          )}
        </div>
      )}

      {/* ═══ SMART INSIGHTS BAR ════════════════════════════════════════════ */}
      {showInsights && (
        <div
          className="flex items-center gap-2 px-4 py-2 flex-shrink-0 overflow-x-auto"
          style={{
            background: c.subtleBg,
            borderBottom: `1px solid ${c.divider}`,
          }}
        >
          <BarChart2 size={12} className="text-indigo-400 flex-shrink-0" />
          <span className="text-[10px] text-white/30 font-bold flex-shrink-0">תובנות AI:</span>

          {/* Risk leads */}
          <button
            onClick={() => setFilterMode(filterMode === 'risk' ? null : 'risk')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold flex-shrink-0 transition-all"
            style={filterMode === 'risk'
              ? { background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', boxShadow: '0 0 10px rgba(239,68,68,0.2)' }
              : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', color: '#fca5a5' }
            }
          >
            <AlertCircle size={9} />
            {insights.risk.length} לידים בסיכון
          </button>

          {/* Stale leads */}
          <button
            onClick={() => setFilterMode(filterMode === 'stale' ? null : 'stale')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold flex-shrink-0 transition-all"
            style={filterMode === 'stale'
              ? { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', boxShadow: '0 0 10px rgba(245,158,11,0.2)' }
              : { background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.12)', color: '#fcd34d' }
            }
          >
            <Snowflake size={9} />
            {insights.stale.length} לא פעילים 21+ ימים
          </button>

          {/* Overdue tasks */}
          <button
            onClick={() => setFilterMode(filterMode === 'overdue' ? null : 'overdue')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold flex-shrink-0 transition-all"
            style={filterMode === 'overdue'
              ? { background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', boxShadow: '0 0 10px rgba(239,68,68,0.2)' }
              : { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)', color: '#fca5a5' }
            }
          >
            <Calendar size={9} />
            {insights.overdueCount} משימות באיחור
          </button>

          {filterMode && (
            <button
              onClick={() => setFilterMode(null)}
              className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 transition-all flex-shrink-0 mr-auto"
            >
              <X size={9} /> נקה פילטר
            </button>
          )}
        </div>
      )}

      {/* ═══ MOBILE COLUMN TABS ════════════════════════════════════════════ */}
      <div
        className="md:hidden flex gap-1.5 px-3 py-2 overflow-x-auto flex-shrink-0" dir="ltr"
        style={{ borderBottom: `1px solid ${c.divider}`, background: 'rgba(0,0,0,0.2)' }}
      >
        {columns.map(status => {
          const col = getCol(status);
          const neon = getNeon(status);
          const active = mobileCol === status;
          return (
            <button
              key={status}
              onClick={() => setMobileCol(status)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition-all"
              style={active
                ? { background: `${neon}25`, border: `1px solid ${neon}60`, color: neon, boxShadow: `0 0 12px ${neon}30` }
                : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
              }
            >
              {status}
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                style={active
                  ? { background: neon + '30', color: neon }
                  : { background: c.subtleBg, color: c.textMuted }
                }
              >
                {col.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* ═══ MOBILE BOARD ══════════════════════════════════════════════════ */}
      <div
        className="md:hidden flex-1 overflow-y-auto p-3"
        style={{ scrollbarWidth: 'thin', scrollbarColor: `${getNeon(mobileCol)}40 transparent` }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Swipe hint */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => {
              const idx = columns.indexOf(mobileCol);
              if (idx > 0) setMobileCol(columns[idx - 1]);
            }}
            disabled={columns.indexOf(mobileCol) === 0}
            className="p-1 rounded-lg disabled:opacity-20 transition-opacity"
            style={{ color: getNeon(mobileCol) }}
          >
            <ChevronRight size={16} />
          </button>
          <span className="text-[10px] text-white/20">החלק לעמודה הבאה</span>
          <button
            onClick={() => {
              const idx = columns.indexOf(mobileCol);
              if (idx < columns.length - 1) setMobileCol(columns[idx + 1]);
            }}
            disabled={columns.indexOf(mobileCol) === columns.length - 1}
            className="p-1 rounded-lg disabled:opacity-20 transition-opacity"
            style={{ color: getNeon(mobileCol) }}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="space-y-2">
          {getCol(mobileCol).length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 text-center rounded-2xl"
              style={{ border: `2px dashed ${getNeon(mobileCol)}30` }}
            >
              <ArrowUpRight size={24} style={{ color: getNeon(mobileCol) + '50' }} />
              <p className="text-xs text-white/20 mt-2">{t('kanban.noLeadsStage')}</p>
            </div>
          ) : (
            getCol(mobileCol).map(lead => (
              <KanbanCard
                key={lead.id}
                lead={lead}
                neon={getNeon(mobileCol)}
                onClick={() => onLeadClick(lead)}
                onDragStart={() => {}}
                kanbanFields={workspace?.cardLayout?.kanbanFields ?? DEFAULT_CARD_LAYOUT.kanbanFields}
              />
            ))
          )}
        </div>
      </div>

      {/* ═══ DESKTOP BOARD ═════════════════════════════════════════════════ */}
      <div className="hidden md:flex flex-1 overflow-x-auto overflow-y-hidden" data-tour="kanban-board-columns">
        <div className="flex h-full w-full">
          {columns.map(status => {
            const col = getCol(status);
            const neon = getNeon(status);
            const isDrop = dragOverCol === status;

            return (
              <div
                key={status}
                className="flex flex-col transition-all duration-150"
                style={{
                  flex: 1,
                  minWidth: 200,
                  borderLeft: '1px solid rgba(255,255,255,0.04)',
                  background: isDrop ? `${neon}08` : 'transparent',
                }}
                onDragOver={e => onDragOver(e, status)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, status)}
              >
                {/* Column header */}
                <div
                  className="px-3 py-3 flex items-center justify-between select-none flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${neon}18, ${neon}08)`,
                    borderBottom: `1px solid ${neon}30`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: neon, boxShadow: `0 0 8px ${neon}` }}
                    />
                    {statusConfigs?.find(s => s.label === status)?.emoji && (
                      <span className="text-xs">{statusConfigs.find(s => s.label === status)!.emoji}</span>
                    )}
                    <span
                      className="font-black text-xs"
                      style={{ color: neon, textShadow: `0 0 12px ${neon}60` }}
                    >
                      {status}
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-black w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: `${neon}25`, color: neon, border: `1px solid ${neon}40` }}
                  >
                    {col.length}
                  </span>
                </div>

                {/* Column intelligence stats */}
                <ColStats leads={leads.filter(l => l.status === status)} neon={neon} />

                {/* Drop zone indicator */}
                {isDrop && (
                  <div
                    className="mx-3 mt-2 h-0.5 rounded-full animate-pulse flex-shrink-0"
                    style={{ background: neon, boxShadow: `0 0 8px ${neon}` }}
                  />
                )}

                {/* Cards */}
                <div
                  className="flex-1 overflow-y-auto p-2 space-y-2"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: `${neon}30 transparent`,
                  }}
                >
                  {col.length === 0 ? (
                    <div
                      className="flex flex-col items-center justify-center py-10 text-center rounded-2xl transition-all duration-200"
                      style={{
                        border: `2px dashed ${isDrop ? neon : 'rgba(255,255,255,0.08)'}`,
                        background: isDrop ? `${neon}08` : 'transparent',
                      }}
                    >
                      <ArrowUpRight size={20} style={{ color: isDrop ? neon : 'rgba(255,255,255,0.15)' }} />
                      <p className="text-xs text-white/20 mt-2">
                        {isDrop ? t('kanban.dropHere') : t('kanban.noLeads')}
                      </p>
                    </div>
                  ) : (
                    col.map(lead => (
                      <KanbanCard
                        key={lead.id}
                        lead={lead}
                        neon={neon}
                        onClick={() => onLeadClick(lead)}
                        onDragStart={() => onDragStart(lead.id)}
                        kanbanFields={workspace?.cardLayout?.kanbanFields ?? DEFAULT_CARD_LAYOUT.kanbanFields}
                      />
                    ))
                  )}
                  {/* Bottom drop target */}
                  {isDrop && col.length > 0 && (
                    <div
                      className="h-14 rounded-xl flex items-center justify-center"
                      style={{
                        border: `2px dashed ${neon}`,
                        background: `${neon}08`,
                        boxShadow: `inset 0 0 16px ${neon}15`,
                      }}
                    >
                      <p className="text-xs font-semibold" style={{ color: neon }}>{t('kanban.dropHere')}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ BOTTOM PIPELINE BAR ═══════════════════════════════════════════ */}
      <div
        className="px-3 sm:px-5 py-3 flex items-stretch gap-0 overflow-x-auto flex-shrink-0"
        style={{
          background: 'rgba(10,15,30,0.9)',
          backdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(99,102,241,0.15)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {columns.map((status, i) => {
          const col = leads.filter(l => l.status === status);
          const pct = leads.length ? Math.round((col.length / leads.length) * 100) : 0;
          const neon = getNeon(status);
          const rev = col.reduce((s, l) => s + (l.budget ?? 0), 0);

          return (
            <div key={status} className="flex-1 min-w-[72px] flex flex-col items-center gap-1 px-1.5 relative">
              {/* Funnel connector */}
              {i < columns.length - 1 && (
                <div
                  className="absolute top-0 right-0 h-full w-px opacity-20"
                  style={{ background: `linear-gradient(to bottom, transparent, ${neon}, transparent)` }}
                />
              )}

              <div className="flex items-baseline gap-1">
                <span className="text-sm font-black text-white">{col.length}</span>
                <span className="text-[10px] text-white/25">{pct}%</span>
              </div>

              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: c.subtleBg }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${neon}80, ${neon})`,
                    boxShadow: `0 0 6px ${neon}60`,
                  }}
                />
              </div>

              <span
                className="text-[9px] font-bold text-center truncate w-full text-center leading-tight"
                style={{ color: neon }}
              >
                {status}
              </span>

              {rev > 0 && (
                <span className="text-[9px] font-bold text-white/40">
                  ₪{(rev / 1000).toFixed(0)}K
                </span>
              )}

              {i < columns.length - 1 && (
                <TrendingUp size={8} className="hidden sm:block absolute left-0 top-2 opacity-20" style={{ color: neon }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
