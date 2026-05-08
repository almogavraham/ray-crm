import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Pencil, Trash2, TrendingUp, Users, Wallet,
  BadgeDollarSign, BarChart3, Play, Pause, Search,
  X, ChevronDown, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import type { Campaign, CampaignPlatform, CampaignStatus, CampaignObjective } from '../types';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const PLATFORM_META: Record<CampaignPlatform, { label: string; emoji: string; ring: string; badge: string; dot: string }> = {
  meta:     { label: 'Meta',     emoji: '📘', ring: 'border-blue-400',    badge: 'bg-blue-100 text-blue-700',      dot: 'bg-blue-500' },
  google:   { label: 'Google',   emoji: '🔍', ring: 'border-red-400',     badge: 'bg-red-100 text-red-700',        dot: 'bg-red-500' },
  tiktok:   { label: 'TikTok',   emoji: '🎵', ring: 'border-slate-700',   badge: 'bg-slate-800 text-white',        dot: 'bg-slate-800' },
  linkedin: { label: 'LinkedIn', emoji: '💼', ring: 'border-sky-500',     badge: 'bg-sky-100 text-sky-700',        dot: 'bg-sky-600' },
  other:    { label: 'אחר',      emoji: '🌐', ring: 'border-slate-300',   badge: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400' },
};

const STATUS_META: Record<CampaignStatus, { label: string; badge: string; icon: React.ElementType }> = {
  active: { label: 'פעיל',    badge: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  paused: { label: 'מושהה',  badge: 'bg-amber-100 text-amber-700',     icon: Pause },
  ended:  { label: 'הסתיים', badge: 'bg-slate-100 text-slate-500',     icon: AlertCircle },
  draft:  { label: 'טיוטה',  badge: 'bg-indigo-100 text-indigo-700',   icon: Pencil },
};

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  awareness:  'מודעות',
  leads:      'לידים',
  sales:      'מכירות',
  engagement: 'מעורבות',
};

const PLATFORM_TABS: { value: CampaignPlatform | 'all'; label: string }[] = [
  { value: 'all',      label: 'הכל' },
  { value: 'meta',     label: 'Meta' },
  { value: 'google',   label: 'Google' },
  { value: 'tiktok',   label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'other',    label: 'אחר' },
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

/* ─── KPI Card ───────────────────────────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
        <p className="text-xl font-black text-slate-800 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
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
  const plat   = PLATFORM_META[campaign.platform];
  const stat   = STATUS_META[campaign.status];
  const utilPct = util(campaign);
  const cplVal  = cpl(campaign);
  const roasVal = roas(campaign);
  const crVal   = cr(campaign);
  const StatIcon = stat.icon;

  return (
    <div className={`bg-white rounded-2xl border-2 ${plat.ring} shadow-sm hover:shadow-md transition-all flex flex-col`}>
      {/* Header */}
      <div className="p-4 pb-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl leading-none">{plat.emoji}</span>
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-sm leading-tight truncate">{campaign.name}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${plat.badge}`}>
                  {plat.label}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${stat.badge}`}>
                  <StatIcon size={9} />
                  {stat.label}
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  {OBJECTIVE_LABELS[campaign.objective]}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => onTogglePause(campaign)}
              title={campaign.status === 'active' ? 'השהה' : 'הפעל'}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              {campaign.status === 'active'
                ? <Pause size={12} className="text-slate-600" />
                : <Play size={12} className="text-slate-600" />
              }
            </button>
            <button onClick={() => onEdit(campaign)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors">
              <Pencil size={12} className="text-slate-600" />
            </button>
            <button onClick={() => onDelete(campaign.id)} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
              <Trash2 size={12} className="text-red-500" />
            </button>
          </div>
        </div>

        {/* Budget bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>הוצאה: <span className="font-semibold text-slate-700">₪{fmt(campaign.spent)}</span></span>
            <span>תקציב: <span className="font-semibold text-slate-700">₪{fmt(campaign.budget)}</span></span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                utilPct > 90 ? 'bg-red-500' : utilPct > 70 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${utilPct}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5 text-left">{utilPct.toFixed(0)}% מהתקציב</p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-px bg-slate-100 flex-1">
        {[
          { label: 'לידים', value: fmt(campaign.leads),           icon: Users,            color: 'text-indigo-600' },
          { label: 'CPL',   value: cplVal > 0 ? `₪${fmt(Math.round(cplVal))}` : '—', icon: BadgeDollarSign, color: 'text-amber-600' },
          { label: 'ROAS',  value: roasVal > 0 ? `×${roasVal.toFixed(1)}` : '—',     icon: TrendingUp,      color: 'text-emerald-600' },
          { label: 'המרה',  value: crVal > 0 ? `${crVal.toFixed(0)}%` : '—',          icon: BarChart3,       color: 'text-blue-600' },
        ].map(({ label, value, icon: MIcon, color }) => (
          <div key={label} className="bg-white p-3 flex flex-col items-center gap-1">
            <MIcon size={14} className={color} />
            <p className="text-xs font-black text-slate-800">{value}</p>
            <p className="text-[10px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Footer date */}
      {(campaign.startDate || campaign.notes) && (
        <div className="px-4 py-2 border-t border-slate-100">
          {campaign.startDate && (
            <p className="text-[10px] text-slate-400">
              📅 {campaign.startDate}{campaign.endDate ? ` — ${campaign.endDate}` : ''}
            </p>
          )}
          {campaign.notes && (
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">💬 {campaign.notes}</p>
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

  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';
  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-slate-400 transition-colors';
  const numInp = (k: keyof typeof form) => (
    <input
      type="number" min={0} value={(form[k] as number) || ''}
      onChange={e => set(k, Number(e.target.value) as (typeof form)[typeof k])}
      className={inp}
      placeholder="0"
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-black text-lg text-slate-800">{initial ? 'עריכת קמפיין' : 'קמפיין חדש'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Name */}
          <div>
            <label className={lbl}>שם הקמפיין *</label>
            <input
              className={inp} placeholder="למשל: Real Estate Leads - Q2"
              value={form.name} onChange={e => set('name', e.target.value)}
            />
          </div>

          {/* Platform + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>פלטפורמה</label>
              <div className="relative">
                <select
                  value={form.platform}
                  onChange={e => set('platform', e.target.value as CampaignPlatform)}
                  className={inp + ' appearance-none pr-3'}
                >
                  {Object.entries(PLATFORM_META).map(([k, v]) => (
                    <option key={k} value={k}>{v.emoji} {v.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className={lbl}>סטטוס</label>
              <div className="relative">
                <select
                  value={form.status}
                  onChange={e => set('status', e.target.value as CampaignStatus)}
                  className={inp + ' appearance-none pr-3'}
                >
                  {Object.entries(STATUS_META).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Objective */}
          <div>
            <label className={lbl}>מטרת הקמפיין</label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(OBJECTIVE_LABELS) as CampaignObjective[]).map(obj => (
                <button
                  key={obj}
                  onClick={() => set('objective', obj)}
                  className={`py-2 rounded-xl border text-xs font-semibold transition-all ${
                    form.objective === obj
                      ? 'bg-black text-white border-black'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {OBJECTIVE_LABELS[obj]}
                </button>
              ))}
            </div>
          </div>

          {/* Budget + Spent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>תקציב חודשי (₪)</label>
              {numInp('budget')}
            </div>
            <div>
              <label className={lbl}>הוצאה בפועל (₪)</label>
              {numInp('spent')}
            </div>
          </div>

          {/* Leads + Conversions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>לידים שנוצרו</label>
              {numInp('leads')}
            </div>
            <div>
              <label className={lbl}>לקוחות שנסגרו</label>
              {numInp('conversions')}
            </div>
          </div>

          {/* Revenue */}
          <div>
            <label className={lbl}>הכנסה שנוצרה (₪)</label>
            {numInp('revenue')}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>תאריך התחלה</label>
              <input
                type="date" value={form.startDate}
                onChange={e => set('startDate', e.target.value)}
                className={inp}
              />
            </div>
            <div>
              <label className={lbl}>תאריך סיום (אופציונלי)</label>
              <input
                type="date" value={form.endDate ?? ''}
                onChange={e => set('endDate', e.target.value)}
                className={inp}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={lbl}>הערות</label>
            <textarea
              className={inp + ' resize-none'} rows={2}
              placeholder="פרטים נוספים על הקמפיין..."
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        {saveError && (
          <div className="mx-5 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
            ⚠️ {saveError}
          </div>
        )}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={() => { if (form.name.trim() && !saving) onSave(form); }}
            disabled={!form.name.trim() || saving}
            className="flex-1 bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'שומר...' : initial ? 'שמור שינויים' : 'צור קמפיין'}
          </button>
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors disabled:opacity-40">
            ביטול
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
      setSaveError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm('למחוק את הקמפיין?')) return;
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
    <div className="space-y-5" dir="rtl">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-800">ניהול קמפיינים</h1>
          <p className="text-sm text-slate-500 mt-0.5">מעקב על ביצועי פרסום, תקציב ו-ROI בזמן אמת</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-black hover:bg-neutral-800 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
        >
          <Plus size={16} /> קמפיין חדש
        </button>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Wallet}        label="סה״כ הוצאות"   value={`₪${fmt(Math.round(kpis.totalSpent))}`}   color="bg-indigo-500" />
        <KpiCard icon={Users}         label="סה״כ לידים"    value={fmt(kpis.totalLeads)}                      color="bg-blue-500"   sub={`${campaigns.filter(c=>c.status==='active').length} קמפיינים פעילים`} />
        <KpiCard icon={BadgeDollarSign} label="עלות ממוצעת לליד (CPL)" value={kpis.avgCPL > 0 ? `₪${fmt(Math.round(kpis.avgCPL))}` : '—'} color="bg-amber-500" />
        <KpiCard icon={TrendingUp}    label="סה״כ הכנסות"  value={`₪${fmt(Math.round(kpis.totalRevenue))}`}  color="bg-emerald-500" sub={kpis.totalROAS > 0 ? `ROAS ×${kpis.totalROAS.toFixed(1)}` : undefined} />
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm flex flex-col md:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש קמפיין..."
            className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2">
              <X size={12} className="text-slate-400" />
            </button>
          )}
        </div>

        {/* Platform tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {PLATFORM_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPlatFilter(value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                platFilter === value
                  ? 'bg-black text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1">
          {(['all', 'active', 'paused', 'ended', 'draft'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                statusFilter === s
                  ? 'bg-black text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {s === 'all' ? 'כל הסטטוסים' : STATUS_META[s].label}
              <span className="mr-1 opacity-60">({statusCounts[s] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center shadow-lg">
            <BarChart3 size={36} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">עדיין אין קמפיינים</h2>
            <p className="text-slate-400 text-sm max-w-sm">
              הוסף קמפיין ראשון כדי להתחיל לעקוב אחר ביצועי הפרסום, CPL, ROAS ולידים שנוצרו.
            </p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-neutral-800 transition-colors"
          >
            <Plus size={18} /> צור קמפיין ראשון
          </button>
        </div>
      )}

      {/* ── No results ──────────────────────────────────────────────────── */}
      {!isEmpty && filtered.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg font-semibold">לא נמצאו קמפיינים</p>
          <p className="text-sm mt-1">נסה לשנות את הפילטרים</p>
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
