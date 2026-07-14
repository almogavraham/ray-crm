import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Pencil, Trash2, TrendingUp, Users, Wallet,
  BadgeDollarSign, BarChart3, Play, Pause, Search,
  X, ChevronDown, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import type { Campaign, CampaignPlatform, CampaignStatus, CampaignObjective } from '../types';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const PLATFORM_META: Record<CampaignPlatform, { labelKey: string; emoji: string; ring: string; badge: string; dot: string }> = {
  meta:     { labelKey: 'Meta',                      emoji: '📘', ring: 'border-blue-400',    badge: 'bg-blue-100 text-blue-700',      dot: 'bg-blue-500' },
  google:   { labelKey: 'Google',                    emoji: '🔍', ring: 'border-red-400',     badge: 'bg-red-100 text-red-700',        dot: 'bg-red-500' },
  tiktok:   { labelKey: 'TikTok',                    emoji: '🎵', ring: 'border-slate-700',   badge: 'bg-slate-800 text-white',        dot: 'bg-slate-800' },
  linkedin: { labelKey: 'LinkedIn',                  emoji: '💼', ring: 'border-sky-500',     badge: 'bg-sky-100 text-sky-700',        dot: 'bg-sky-600' },
  other:    { labelKey: 'campaigns.platformOther',   emoji: '🌐', ring: 'border-slate-300',   badge: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400' },
};

const STATUS_META: Record<CampaignStatus, { labelKey: string; badge: string; icon: React.ElementType }> = {
  active: { labelKey: 'campaigns.statusActive', badge: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  paused: { labelKey: 'campaigns.statusPaused', badge: 'bg-amber-100 text-amber-700',     icon: Pause },
  ended:  { labelKey: 'campaigns.statusEnded',  badge: 'bg-slate-100 text-slate-500',     icon: AlertCircle },
  draft:  { labelKey: 'campaigns.statusDraft',  badge: 'bg-indigo-100 text-indigo-700',   icon: Pencil },
};

const OBJECTIVE_KEYS: Record<CampaignObjective, string> = {
  awareness:  'campaigns.objAwareness',
  leads:      'campaigns.objLeads',
  sales:      'campaigns.objSales',
  engagement: 'campaigns.objEngagement',
};

const PLATFORM_TAB_VALUES: { value: CampaignPlatform | 'all'; labelKey: string }[] = [
  { value: 'all',      labelKey: 'campaigns.all' },
  { value: 'meta',     labelKey: 'Meta' },
  { value: 'google',   labelKey: 'Google' },
  { value: 'tiktok',   labelKey: 'TikTok' },
  { value: 'linkedin', labelKey: 'LinkedIn' },
  { value: 'other',    labelKey: 'campaigns.platformOther' },
];

/* ─── helpers ────────────────────────────────────────────────────────────── */
const fmt  = (n: number) => n.toLocaleString('he-IL');
const cpl  = (c: Campaign) => c.leads > 0 ? c.spent / c.leads : 0;
const roas = (c: Campaign) => c.spent > 0 ? c.revenue / c.spent : 0;
const cr   = (c: Campaign) => c.leads > 0 ? (c.conversions / c.leads) * 100 : 0;
const util = (c: Campaign) => c.budget > 0 ? Math.min((c.spent / c.budget) * 100, 100) : 0;

function emptyForm(): Omit<Campaign, 'id' | 'createdAt'> {
  return {
    name: '', platform: 'meta', status: 'active', objective: 'leads',
    budget: 0, spent: 0, leads: 0, conversions: 0, revenue: 0,
    startDate: new Date().toISOString().split('T')[0],
    endDate: '', notes: '',
  };
}

/* ─── platform badge styles ─────────────────────────────────────────────── */
function getPlatformBadgeStyle(platform: CampaignPlatform): React.CSSProperties {
  switch (platform) {
    case 'meta':     return { background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.28)' };
    case 'google':   return { background: 'rgba(239,68,68,0.15)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.28)' };
    case 'tiktok':   return { background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.09)' };
    case 'linkedin': return { background: 'rgba(14,165,233,0.15)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.28)' };
    default:         return { background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.09)' };
  }
}

function getStatusBadgeStyle(status: CampaignStatus): React.CSSProperties {
  switch (status) {
    case 'active': return { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.28)' };
    case 'paused': return { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.28)' };
    case 'ended':  return { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.09)' };
    case 'draft':  return { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.28)' };
  }
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, neonColor }: {
  icon: React.ElementType; label: string; value: string; sub?: string; neonColor: string;
}) {
  const { c } = useTheme();
  return (
    <div
      className="rounded-2xl p-5 flex items-center gap-4"
      style={{
        background: 'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(99,102,241,0.06))',
        border: '1px solid rgba(99,102,241,0.25)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: neonColor, boxShadow: `0 0 16px ${neonColor}66` }}
      >
        <Icon size={22} color="white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium mb-0.5" style={{ color: c.textSecondary }}>{label}</p>
        <p className="text-xl font-black leading-tight" style={{ color: c.textPrimary }}>{value}</p>
        {sub && <p className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Campaign Card ──────────────────────────────────────────────────────── */
function CampaignCard({ campaign, onEdit, onDelete, onTogglePause }: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDelete: (id: string) => void;
  onTogglePause: (c: Campaign) => void;
}) {
  const { c } = useTheme();
  const { t } = useLang();
  const plat   = PLATFORM_META[campaign.platform];
  const stat   = STATUS_META[campaign.status];
  const utilPct = util(campaign);
  const cplVal  = cpl(campaign);
  const roasVal = roas(campaign);
  const crVal   = cr(campaign);
  const StatIcon = stat.icon;
  const platLabel = plat.labelKey.startsWith('campaigns.') ? t(plat.labelKey) : plat.labelKey;
  const platBadgeStyle = getPlatformBadgeStyle(campaign.platform);
  const statusBadgeStyle = getStatusBadgeStyle(campaign.status);

  return (
    <div
      className="rounded-2xl flex flex-col"
      style={{
        background: c.subtleBg,
        border: `1px solid ${c.cardBorder}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        className="p-4 pb-3"
        style={{ borderBottom: `1px solid ${c.divider}` }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl leading-none">{plat.emoji}</span>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate" style={{ color: c.textPrimary }}>{campaign.name}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={platBadgeStyle}
                >
                  {platLabel}
                </span>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={statusBadgeStyle}
                >
                  <StatIcon size={9} />
                  {t(stat.labelKey)}
                </span>
                <span className="text-[10px] font-medium" style={{ color: c.textMuted }}>
                  {t(OBJECTIVE_KEYS[campaign.objective])}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => onTogglePause(campaign)}
              title={campaign.status === 'active' ? t('campaigns.pause') : t('campaigns.resume')}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}
            >
              {campaign.status === 'active'
                ? <Pause size={12} color="rgba(255,255,255,0.6)" />
                : <Play  size={12} color="rgba(255,255,255,0.6)" />
              }
            </button>
            <button
              onClick={() => onEdit(campaign)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}
            >
              <Pencil size={12} color="#818cf8" />
            </button>
            <button
              onClick={() => onDelete(campaign.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <Trash2 size={12} color="#f87171" />
            </button>
          </div>
        </div>

        {/* Budget bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[11px] mb-1" style={{ color: c.textMuted }}>
            <span>{t('campaigns.expense')}: <span className="font-semibold" style={{ color: c.textSecondary }}>₪{fmt(campaign.spent)}</span></span>
            <span>{t('campaigns.budget')}: <span className="font-semibold" style={{ color: c.textSecondary }}>₪{fmt(campaign.budget)}</span></span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: c.subtleBg }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${utilPct}%`,
                background: utilPct > 90 ? '#ef4444' : utilPct > 70 ? '#f59e0b' : '#10b981',
              }}
            />
          </div>
          <p className="text-[10px] mt-0.5 text-left" style={{ color: c.textMuted }}>{utilPct.toFixed(0)}% {t('campaigns.ofBudget')}</p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-px flex-1" style={{ background: c.subtleBg }}>
        {[
          { label: t('campaigns.objLeads'), value: fmt(campaign.leads),                                   icon: Users,            color: c.accentText },
          { label: 'CPL',   value: cplVal > 0 ? `₪${fmt(Math.round(cplVal))}` : '—',                    icon: BadgeDollarSign,  color: '#fbbf24' },
          { label: 'ROAS',  value: roasVal > 0 ? `×${roasVal.toFixed(1)}` : '—',                         icon: TrendingUp,       color: '#34d399' },
          { label: t('campaigns.conversion'), value: crVal > 0 ? `${crVal.toFixed(0)}%` : '—',           icon: BarChart3,        color: '#60a5fa' },
        ].map(({ label, value, icon: MIcon, color }) => (
          <div
            key={label}
            className="p-3 flex flex-col items-center gap-1"
            style={{ background: 'rgba(10,15,30,0.6)' }}
          >
            <MIcon size={14} color={color} />
            <p className="text-xs font-black" style={{ color: c.textPrimary }}>{value}</p>
            <p className="text-[10px]" style={{ color: c.textMuted }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Footer date */}
      {(campaign.startDate || campaign.notes) && (
        <div className="px-4 py-2" style={{ borderTop: `1px solid ${c.divider}` }}>
          {campaign.startDate && (
            <p className="text-[10px]" style={{ color: c.textMuted }}>
              📅 {campaign.startDate}{campaign.endDate ? ` — ${campaign.endDate}` : ''}
            </p>
          )}
          {campaign.notes && (
            <p className="text-[10px] mt-0.5 truncate" style={{ color: c.textMuted }}>💬 {campaign.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Campaign Modal ─────────────────────────────────────────────────────── */
function CampaignModal({ initial, onSave, onClose, saving, saveError }: {
  initial?: Campaign;
  onSave: (c: Omit<Campaign, 'id' | 'createdAt'>) => void;
  onClose: () => void;
  saving?: boolean;
  saveError?: string | null;
}) {
  const { c } = useTheme();
  const { t } = useLang();
  const [form, setForm] = useState<Omit<Campaign, 'id' | 'createdAt'>>(
    initial ? {
      name: initial.name, platform: initial.platform, status: initial.status,
      objective: initial.objective, budget: initial.budget, spent: initial.spent,
      leads: initial.leads, conversions: initial.conversions, revenue: initial.revenue,
      startDate: initial.startDate, endDate: initial.endDate ?? '',
      notes: initial.notes ?? '',
    } : emptyForm()
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const darkInpStyle: React.CSSProperties = {
    background: c.subtleBg,
    border: `1px solid ${c.cardBorder}`,
    color: c.textPrimary,
    borderRadius: '0.75rem',
    padding: '0.625rem 0.75rem',
    fontSize: '0.875rem',
    width: '100%',
    outline: 'none',
  };

  const lbl = 'block text-xs font-semibold mb-1';

  const numInp = (k: keyof typeof form) => (
    <input
      type="number" min={0} value={(form[k] as number) || ''}
      onChange={e => set(k, Number(e.target.value) as (typeof form)[typeof k])}
      style={darkInpStyle}
      placeholder="0"
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] flex flex-col"
        style={{ background: '#0d1526', border: '1px solid rgba(99,102,241,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${c.divider}` }}
        >
          <h2 className="font-black text-lg" style={{ color: c.textPrimary }}>{initial ? t('campaigns.editTitle') : t('campaigns.newTitle')}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}
          >
            <X size={14} color="rgba(255,255,255,0.6)" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Name */}
          <div>
            <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.campaignName')}</label>
            <input
              style={darkInpStyle}
              placeholder="למשל: Real Estate Leads - Q2"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          {/* Platform + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.platform')}</label>
              <div className="relative">
                <select
                  value={form.platform}
                  onChange={e => set('platform', e.target.value as CampaignPlatform)}
                  style={{ ...darkInpStyle, appearance: 'none', paddingRight: '0.75rem' }}
                >
                  {Object.entries(PLATFORM_META).map(([k, v]) => (
                    <option key={k} value={k} style={{ background: '#0d1526' }}>
                      {v.emoji} {v.labelKey.startsWith('campaigns.') ? t(v.labelKey) : v.labelKey}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" color="rgba(255,255,255,0.4)" />
              </div>
            </div>
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.status')}</label>
              <div className="relative">
                <select
                  value={form.status}
                  onChange={e => set('status', e.target.value as CampaignStatus)}
                  style={{ ...darkInpStyle, appearance: 'none', paddingRight: '0.75rem' }}
                >
                  {Object.entries(STATUS_META).map(([k, v]) => (
                    <option key={k} value={k} style={{ background: '#0d1526' }}>{t(v.labelKey)}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" color="rgba(255,255,255,0.4)" />
              </div>
            </div>
          </div>

          {/* Objective */}
          <div>
            <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.objective')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(OBJECTIVE_KEYS) as CampaignObjective[]).map(obj => (
                <button
                  key={obj}
                  onClick={() => set('objective', obj)}
                  className="py-2 rounded-xl text-xs font-semibold transition-all"
                  style={
                    form.objective === obj
                      ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                      : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
                  }
                >
                  {t(OBJECTIVE_KEYS[obj])}
                </button>
              ))}
            </div>
          </div>

          {/* Budget + Spent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.monthlyBudget')}</label>
              {numInp('budget')}
            </div>
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.actualExpense')}</label>
              {numInp('spent')}
            </div>
          </div>

          {/* Leads + Conversions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.leadsGenerated')}</label>
              {numInp('leads')}
            </div>
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.clientsClosed')}</label>
              {numInp('conversions')}
            </div>
          </div>

          {/* Revenue */}
          <div>
            <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.revenueGenerated')}</label>
            {numInp('revenue')}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.startDate')}</label>
              <input
                type="date" value={form.startDate}
                onChange={e => set('startDate', e.target.value)}
                style={darkInpStyle}
              />
            </div>
            <div>
              <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.endDate')}</label>
              <input
                type="date" value={form.endDate ?? ''}
                onChange={e => set('endDate', e.target.value)}
                style={darkInpStyle}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={lbl} style={{ color: c.textSecondary }}>{t('campaigns.notes')}</label>
            <textarea
              style={{ ...darkInpStyle, resize: 'none' }}
              rows={2}
              placeholder={t('campaigns.notesPlaceholder')}
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        {saveError && (
          <div
            className="mx-5 mb-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          >
            ⚠️ {saveError}
          </div>
        )}
        <div
          className="px-5 py-4 flex gap-3"
          style={{ borderTop: `1px solid ${c.divider}` }}
        >
          <button
            onClick={() => { if (form.name.trim() && !saving) onSave(form); }}
            disabled={!form.name.trim() || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? t('campaigns.saving') : initial ? t('campaigns.saveChanges') : t('campaigns.createCampaign')}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-40"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function Campaigns() {
  const { t, dir } = useLang();
  const { isDark, c } = useTheme();
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState<Campaign | undefined>();
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [platFilter, setPlatFilter]   = useState<CampaignPlatform | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');

  /* ── Firestore real-time sync ─────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'campaigns'), snap => {
      const data = snap.docs.map(d => d.data() as Campaign);
      data.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setCampaigns(data);
    });
    return () => unsub();
  }, []);

  /* ── CRUD ─────────────────────────────────────────────────────────────── */
  const saveCampaign = async (form: Omit<Campaign, 'id' | 'createdAt'>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const id = editing?.id ?? Date.now().toString();
      const campaign: Campaign = {
        ...form,
        id,
        createdAt: editing?.createdAt ?? new Date().toISOString(),
        ...(form.endDate && form.endDate !== '' ? { endDate: form.endDate } : {}),
        ...(form.notes   && form.notes   !== '' ? { notes:   form.notes   } : {}),
      };
      // strip undefined/empty optional fields — Firestore rejects undefined
      const clean = Object.fromEntries(
        Object.entries(campaign).filter(([, v]) => v !== undefined && v !== '')
      ) as Campaign;
      await setDoc(doc(db, 'campaigns', id), clean);
      setShowModal(false);
      setEditing(undefined);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('campaigns.savingError'));
    } finally {
      setSaving(false);
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm(t('campaigns.confirmDelete'))) return;
    await deleteDoc(doc(db, 'campaigns', id)).catch(console.error);
  };

  const togglePause = async (c: Campaign) => {
    const newStatus: CampaignStatus = c.status === 'active' ? 'paused' : 'active';
    const updated = { ...c, status: newStatus };
    await setDoc(doc(db, 'campaigns', c.id), updated).catch(console.error);
  };

  const openEdit = (c: Campaign) => { setEditing(c); setShowModal(true); };
  const openNew  = () => { setEditing(undefined); setShowModal(true); };

  /* ── Filtered campaigns ───────────────────────────────────────────────── */
  const filtered = useMemo(() => campaigns.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
    const matchPlat   = platFilter === 'all' || c.platform === platFilter;
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchPlat && matchStatus;
  }), [campaigns, search, platFilter, statusFilter]);

  /* ── Aggregate KPIs ───────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const active = campaigns.filter(c => c.status !== 'draft');
    const totalSpent   = active.reduce((s, c) => s + c.spent, 0);
    const totalLeads   = active.reduce((s, c) => s + c.leads, 0);
    const totalRevenue = active.reduce((s, c) => s + c.revenue, 0);
    const avgCPL       = totalLeads > 0 ? totalSpent / totalLeads : 0;
    const totalROAS    = totalSpent > 0 ? totalRevenue / totalSpent : 0;
    return { totalSpent, totalLeads, totalRevenue, avgCPL, totalROAS };
  }, [campaigns]);

  /* ── Status filter pills ─────────────────────────────────────────────── */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: campaigns.length };
    campaigns.forEach(c => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
    return counts;
  }, [campaigns]);

  const isEmpty = campaigns.length === 0;

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-5"
      dir={dir}
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
      }}
    >
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-black" style={{ color: c.textPrimary }}>{t('campaigns.title')}</h1>
          <p className="text-sm mt-0.5" style={{ color: c.textSecondary }}>{t('campaigns.subtitle')}</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
        >
          <Plus size={16} /> {t('campaigns.new')}
        </button>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Wallet}          label={t('campaigns.totalExpenses')} value={`₪${fmt(Math.round(kpis.totalSpent))}`}                                       neonColor="#6366f1" />
        <KpiCard icon={Users}           label={t('campaigns.totalLeads')}    value={fmt(kpis.totalLeads)}                                                           neonColor="#3b82f6" sub={`${campaigns.filter(c=>c.status==='active').length} ${t('campaigns.activeCount')}`} />
        <KpiCard icon={BadgeDollarSign} label={t('campaigns.avgCpl')}        value={kpis.avgCPL > 0 ? `₪${fmt(Math.round(kpis.avgCPL))}` : '—'}                   neonColor="#f59e0b" />
        <KpiCard icon={TrendingUp}      label={t('campaigns.totalRevenue')}  value={`₪${fmt(Math.round(kpis.totalRevenue))}`}                                      neonColor="#10b981" sub={kpis.totalROAS > 0 ? `ROAS ×${kpis.totalROAS.toFixed(1)}` : undefined} />
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-3 flex flex-col md:flex-row gap-3"
        style={{
          background: 'rgba(10,15,30,0.88)',
          border: '1px solid rgba(99,102,241,0.2)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2" color="rgba(255,255,255,0.35)" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('campaigns.search')}
            className="w-full pr-9 pl-3 py-2 text-sm rounded-xl transition-colors focus:outline-none"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2">
              <X size={12} color="rgba(255,255,255,0.4)" />
            </button>
          )}
        </div>

        {/* Platform tabs */}
        <div className="flex gap-1 overflow-x-auto" dir="ltr">
          {PLATFORM_TAB_VALUES.map(({ value, labelKey }) => (
            <button
              key={value}
              onClick={() => setPlatFilter(value)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
              style={
                platFilter === value
                  ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                  : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
              }
            >
              {labelKey.startsWith('campaigns.') ? t(labelKey) : labelKey}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 overflow-x-auto" dir="ltr">
          {(['all', 'active', 'paused', 'ended', 'draft'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
              style={
                statusFilter === s
                  ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                  : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
              }
            >
              {s === 'all' ? t('campaigns.allStatuses') : t(STATUS_META[s].labelKey)}
              <span className="mr-1 opacity-60">({statusCounts[s] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 0 24px rgba(99,102,241,0.2)' }}
          >
            <BarChart3 size={36} color="#818cf8" />
          </div>
          <div>
            <h2 className="text-2xl font-black mb-2" style={{ color: c.textPrimary }}>{t('campaigns.noCampaigns')}</h2>
            <p className="text-sm max-w-sm" style={{ color: c.textMuted }}>
              {t('campaigns.noCampaignsDesc')}
            </p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-colors"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
          >
            <Plus size={18} /> {t('campaigns.createFirst')}
          </button>
        </div>
      )}

      {/* ── No results ──────────────────────────────────────────────────── */}
      {!isEmpty && filtered.length === 0 && (
        <div className="text-center py-16">
          <p className="text-lg font-semibold" style={{ color: c.textSecondary }}>{t('campaigns.noResults')}</p>
          <p className="text-sm mt-1" style={{ color: c.textMuted }}>{t('campaigns.changeFilters')}</p>
        </div>
      )}

      {/* ── Campaign grid ───────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onEdit={openEdit}
              onDelete={deleteCampaign}
              onTogglePause={togglePause}
            />
          ))}
        </div>
      )}

      {/* ── Modal ───────────────────────────────────────────────────────── */}
      {showModal && (
        <CampaignModal
          initial={editing}
          onSave={saveCampaign}
          onClose={() => { if (!saving) { setShowModal(false); setEditing(undefined); setSaveError(null); } }}
          saving={saving}
          saveError={saveError}
        />
      )}
    </div>
  );
}
