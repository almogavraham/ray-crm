import { useMemo } from 'react';
import {
  Users, TrendingUp, CheckSquare, Wallet,
  ArrowUpRight, ArrowDownRight, Clock, Star,
  Activity, Target, Zap, AlertTriangle,
} from 'lucide-react';
import { SmartAlerts } from './Agents';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { Lead, StandaloneTask } from '../types';

interface HomeDashboardProps {
  leads: Lead[];
  standaloneTask: StandaloneTask[];
  currentUser: string;
  onLeadClick: (lead: Lead) => void;
  onPageChange: (page: string) => void;
}

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6'];

const SOURCE_LABELS: Record<string, string> = {
  'פרסום ממומן': 'פרסום ממומן', 'הפניה': 'הפניה', 'אורגני': 'אורגני',
  'אינסטגרם': 'אינסטגרם', 'פייסבוק': 'פייסבוק', 'גוגל': 'גוגל',
};

const STATUS_COLORS: Record<string, string> = {
  'חדש': '#6366f1', 'בתהליך': '#f59e0b', 'לקוח פעיל': '#10b981',
  'רימרקטינג': '#8b5cf6', 'לא רלוונטי': '#334155',
};

/* ── Stat Card (Cloudflare style) ──────────────────────────────────────── */
function StatCard({ label, value, sub, trend, accent, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  trend?: { value: number; label: string };
  accent: string;  // hex color
  icon: React.ElementType;
}) {
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div
      className="relative rounded-2xl p-5 transition-all duration-200 overflow-hidden group cursor-default"
      style={{ backgroundColor: '#ffffff', border: '1px solid #e5e9f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#c7d2fe')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#e5e9f0')}
    >
      {/* Accent top line */}
      <div className="absolute top-0 right-0 left-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />

      <div className="flex items-start justify-between mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${accent}12`, border: `1px solid ${accent}25` }}>
          <Icon size={16} style={{ color: accent }} />
        </div>
        {trend && (
          <div className="flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-lg"
            style={up
              ? { backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
              : { backgroundColor: '#fff5f5', color: '#dc2626', border: '1px solid #fecaca' }
            }>
            {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>

      <p className="text-[22px] font-black mb-0.5 tracking-tight" style={{ color: '#0f172a' }}>{value}</p>
      <p className="text-[12px] font-medium" style={{ color: '#64748b' }}>{label}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>{sub}</p>}
      {trend && <p className="text-[11px]" style={{ color: '#94a3b8' }}>{trend.label}</p>}
    </div>
  );
}

/* ── Main ───────────────────────────────────────────────────────────────── */
export default function HomeDashboard({ leads, standaloneTask, currentUser, onLeadClick, onPageChange }: HomeDashboardProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'בוקר טוב';
    if (h < 17) return 'צהריים טובים';
    return 'ערב טוב';
  }, []);

  const firstName = currentUser.split(' ')[0];

  const stats = useMemo(() => {
    const activeClients  = leads.filter(l => l.status === 'לקוח פעיל').length;
    const newLeads       = leads.filter(l => l.status === 'חדש').length;
    const allTasks       = [...leads.flatMap(l => l.tasks), ...standaloneTask];
    const openTasks      = allTasks.filter(t => !t.completed).length;
    const overdueTasks   = allTasks.filter(t => {
      if (t.completed) return false;
      try { return new Date((t as { date?: string }).date + 'T00:00:00') < today; } catch { return false; }
    }).length;
    const pipelineValue  = leads.filter(l => ['חדש','בתהליך'].includes(l.status)).reduce((s,l) => s+(l.budget||0),0);
    const revenue        = leads.filter(l => l.status==='לקוח פעיל').reduce((s,l) => s+(l.budget||0),0);
    const conversionRate = leads.length > 0 ? Math.round((activeClients/leads.length)*100) : 0;
    return { activeClients, newLeads, openTasks, overdueTasks, pipelineValue, revenue, conversionRate };
  }, [leads, standaloneTask]); // eslint-disable-line

  const monthlyData = useMemo(() => {
    const months: { name: string; לידים: number; לקוחות: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const name = d.toLocaleDateString('he-IL', { month: 'short' });
      const leadsInMonth = leads.filter(l => {
        const ts = (l as Record<string, unknown>).createdAt;
        if (!ts) return false;
        const d2 = new Date(typeof ts === 'number' ? ts : String(ts));
        return `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}` === key;
      });
      months.push({ name, 'לידים': leadsInMonth.length, 'לקוחות': leadsInMonth.filter(l=>l.status==='לקוח פעיל').length });
    }
    return months;
  }, [leads]);

  const sourceData = useMemo(() => {
    const counts: Record<string,number> = {};
    leads.forEach(l => { counts[l.source] = (counts[l.source]??0)+1; });
    return Object.entries(counts).map(([name,value]) => ({ name: SOURCE_LABELS[name]??name, value })).sort((a,b)=>b.value-a.value);
  }, [leads]);

  const stageData = useMemo(() =>
    (['חדש','בתהליך','לקוח פעיל','רימרקטינג','לא רלוונטי'] as const).map(s => ({
      name: s, count: leads.filter(l=>l.status===s).length, color: STATUS_COLORS[s],
    })), [leads]);

  const recentLeads = useMemo(() =>
    [...leads].sort((a,b)=>((b as Record<string,unknown>).createdAt as number??0)-((a as Record<string,unknown>).createdAt as number??0)).slice(0,5),
    [leads]);

  const upcomingTasks = useMemo(() => {
    const in7 = new Date(); in7.setDate(in7.getDate()+7);
    return standaloneTask.filter(t => {
      if (t.completed) return false;
      try { const d=new Date(t.date+'T00:00:00'); return d>=today && d<=in7; } catch { return false; }
    }).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  }, [standaloneTask]); // eslint-disable-line

  const fmt = (n: number) => n>=1000 ? `₪${(n/1000).toFixed(0)}K` : `₪${n}`;

  const tooltipStyle = {
    contentStyle: {
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      color: '#1e293b',
      fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
    },
    cursor: { fill: 'rgba(99,102,241,0.04)' },
  };

  /* card style helper */
  const card = {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e9f0',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  };

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
              <Zap size={13} className="text-white fill-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight" style={{ color: '#0f172a' }}>
              {greeting},{' '}
              <span style={{ color: '#4f46e5' }}>{firstName}</span>
            </h1>
          </div>
          <p className="text-[12px] font-medium mr-9" style={{ color: '#94a3b8' }}>
            {today.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        {stats.overdueTasks > 0 && (
          <button
            onClick={() => onPageChange('tasks')}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            style={{ backgroundColor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
          >
            <AlertTriangle size={13} />
            {stats.overdueTasks} משימות באיחור
          </button>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users}       label="סה״כ לידים"     value={String(leads.length)}        accent="#6366f1" trend={{ value: stats.newLeads, label: `${stats.newLeads} חדשים` }} />
        <StatCard icon={Star}        label="לקוחות פעילים"  value={String(stats.activeClients)}  accent="#10b981" trend={{ value: stats.conversionRate, label: `${stats.conversionRate}% המרה` }} />
        <StatCard icon={CheckSquare} label="משימות פתוחות"  value={String(stats.openTasks)}      accent="#f59e0b" sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} באיחור` : 'הכל בזמן ✓'} />
        <StatCard icon={Wallet}      label="ערך פייפליין"    value={fmt(stats.pipelineValue)}     accent="#8b5cf6" sub={`הכנסות: ${fmt(stats.revenue)}/חודש`} />
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Bar chart */}
        <div className="lg:col-span-2" style={card}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>לידים לפי חודש</h3>
              <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>6 חודשים אחרונים</p>
            </div>
            <div className="flex items-center gap-3 text-[10px]" style={{ color: '#94a3b8' }}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />לידים
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />לקוחות
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthlyData} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#3d5080' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#3d5080' }} axisLine={false} tickLine={false} width={22} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="לידים"  fill="#6366f1" radius={[4,4,0,0]} opacity={0.9} />
              <Bar dataKey="לקוחות" fill="#10b981" radius={[4,4,0,0]} opacity={0.9} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div style={card}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>מקורות לידים</h3>
              <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>התפלגות</p>
            </div>
            <Target size={13} style={{ color: '#cbd5e1' }} />
          </div>
          {sourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={62} innerRadius={32}>
                  {sourceData.map((_,i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} cursor={false} />
                <Legend iconType="circle" iconSize={7}
                  formatter={v => <span style={{ fontSize: 10, color: '#64748b' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-[12px]" style={{ color: '#cbd5e1' }}>אין נתונים</div>
          )}
        </div>
      </div>

      {/* ── Pipeline + Recent + Tasks ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Pipeline stages */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>פייפליין לפי שלב</h3>
            <TrendingUp size={13} style={{ color: '#cbd5e1' }} />
          </div>
          <div className="space-y-3">
            {stageData.map(({ name, count, color }) => {
              const pct = leads.length > 0 ? (count/leads.length)*100 : 0;
              return (
                <div key={name}>
                  <div className="flex justify-between text-[11px] mb-1.5">
                    <span className="font-semibold text-white">{count}</span>
                    <span style={{ color: '#4d6080' }}>{name}</span>
                  </div>
                  <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: '#f1f5f9' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => onPageChange('kanban')}
            className="mt-4 w-full text-center text-[11px] font-semibold py-2 rounded-xl transition-all"
            style={{ color: '#6366f1', border: '1px solid #1a2540' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
              e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.04)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#1a2540';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            פתח פייפליין ←
          </button>
        </div>

        {/* Recent leads */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>לידים אחרונים</h3>
            <button
              onClick={() => onPageChange('dashboard')}
              className="text-[11px] font-semibold transition-colors"
              style={{ color: '#4f46e5' }}
            >
              הכל →
            </button>
          </div>
          <div className="space-y-1">
            {recentLeads.length === 0 && (
              <p className="text-[11px] text-center py-6" style={{ color: '#cbd5e1' }}>אין לידים עדיין</p>
            )}
            {recentLeads.map(l => (
              <button key={l.id} onClick={() => onLeadClick(l)}
                className="w-full flex items-center gap-3 p-2 rounded-xl text-right transition-all group"
                style={{ borderRadius: 10 }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
                  {l.company.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate" style={{ color: '#1e293b' }}>{l.company}</p>
                  <p className="text-[10px] truncate" style={{ color: '#94a3b8' }}>{l.contactName}</p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
                  style={{
                    backgroundColor: `${STATUS_COLORS[l.status]}12`,
                    color: STATUS_COLORS[l.status],
                    border: `1px solid ${STATUS_COLORS[l.status]}25`,
                  }}>
                  {l.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Upcoming tasks */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>משימות קרובות</h3>
            <button
              onClick={() => onPageChange('tasks')}
              className="text-[11px] font-semibold transition-colors"
              style={{ color: '#4f46e5' }}
            >
              הכל →
            </button>
          </div>
          <div className="space-y-1">
            {upcomingTasks.length === 0 && (
              <div className="text-center py-6">
                <CheckSquare size={20} className="mx-auto mb-2" style={{ color: '#e2e8f0' }} />
                <p className="text-[11px]" style={{ color: '#cbd5e1' }}>אין משימות ל-7 ימים הקרובים</p>
              </div>
            )}
            {upcomingTasks.map(t => {
              const d = new Date(t.date+'T00:00:00');
              const isToday = d.toDateString() === new Date().toDateString();
              const priorityDot = t.priority==='high' ? '#ef4444' : t.priority==='medium' ? '#f59e0b' : '#cbd5e1';
              return (
                <div key={t.id} className="flex items-start gap-2.5 p-2 rounded-lg transition-all"
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  style={{ borderRadius: 8 }}
                >
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: priorityDot }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: '#334155' }}>{t.description}</p>
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: isToday ? '#4f46e5' : '#94a3b8' }}>
                      {isToday ? 'היום' : d.toLocaleDateString('he-IL', { day:'numeric', month:'short' })} · {t.time}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {upcomingTasks.length > 0 && (
            <button
              onClick={() => onPageChange('tasks')}
              className="mt-3 w-full text-center text-[11px] font-semibold py-2 rounded-xl transition-all flex items-center justify-center gap-1.5"
              style={{ color: '#6366f1', border: '1px solid #1a2540' }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.04)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#1a2540';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Clock size={11} />
              ראה את כל המשימות
            </button>
          )}
        </div>
      </div>

      {/* ── Smart Alerts widget ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => onPageChange('agents')}
            className="text-[11px] font-semibold transition-colors"
            style={{ color: '#4f46e5' }}
          >
            כל הסוכנים →
          </button>
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} style={{ color: '#94a3b8' }} />
            <h3 className="font-semibold text-[13px]" style={{ color: '#1e293b' }}>התראות חכמות</h3>
          </div>
        </div>
        <SmartAlerts leads={leads} standaloneTask={standaloneTask} />
      </div>

      {/* ── Activity row ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 rounded-xl"
        style={{ backgroundColor: '#ffffff', border: '1px solid #e5e9f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px]" style={{ color: '#64748b' }}>כל הנתונים מסונכרנים</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px]" style={{ color: '#94a3b8' }}>
          <span className="flex items-center gap-1.5">
            <Activity size={10} />
            {leads.length} לידים פעילים
          </span>
          <span className="hidden sm:flex items-center gap-1.5">
            <Users size={10} />
            {stats.activeClients} לקוחות
          </span>
        </div>
      </div>
    </div>
  );
}
