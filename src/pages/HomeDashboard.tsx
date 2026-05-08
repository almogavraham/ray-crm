import { useMemo } from 'react';
import {
  Users, TrendingUp, CheckSquare, Wallet,
  ArrowUpRight, ArrowDownRight, Clock, Star,
  Activity, Target,
} from 'lucide-react';
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

const COLORS = ['#6366F1', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6'];

const SOURCE_LABELS: Record<string, string> = {
  'פרסום ממומן': 'פרסום ממומן',
  'הפניה': 'הפניה',
  'אורגני': 'אורגני',
  'אינסטגרם': 'אינסטגרם',
  'פייסבוק': 'פייסבוק',
  'גוגל': 'גוגל',
};

const STATUS_COLORS: Record<string, string> = {
  'חדש':          '#6366F1',
  'בתהליך':       '#F59E0B',
  'לקוח פעיל':   '#10B981',
  'רימרקטינג':    '#8B5CF6',
  'לא רלוונטי':  '#94A3B8',
};

function StatCard({ label, value, sub, trend, color, icon: Icon }: {
  label: string; value: string; sub?: string;
  trend?: { value: number; label: string };
  color: string; icon: React.ElementType;
}) {
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
            {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-black text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 font-medium mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
      {trend && <p className="text-[11px] text-slate-400">{trend.label}</p>}
    </div>
  );
}

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

  // Stats
  const stats = useMemo(() => {
    const activeClients  = leads.filter(l => l.status === 'לקוח פעיל').length;
    const newLeads       = leads.filter(l => l.status === 'חדש').length;
    const allTasks       = [...leads.flatMap(l => l.tasks), ...standaloneTask];
    const openTasks      = allTasks.filter(t => !t.completed).length;
    const overdueTasks   = allTasks.filter(t => {
      if (t.completed) return false;
      try { return new Date((t as any).date + 'T00:00:00') < today; } catch { return false; }
    }).length;
    const pipelineValue  = leads
      .filter(l => ['חדש', 'בתהליך'].includes(l.status))
      .reduce((s, l) => s + (l.budget || 0), 0);
    const revenue        = leads
      .filter(l => l.status === 'לקוח פעיל')
      .reduce((s, l) => s + (l.budget || 0), 0);
    const conversionRate = leads.length > 0 ? Math.round((activeClients / leads.length) * 100) : 0;

    return { activeClients, newLeads, openTasks, overdueTasks, pipelineValue, revenue, conversionRate };
  }, [leads, standaloneTask, today]);

  // Monthly leads data (last 6 months)
  const monthlyData = useMemo(() => {
    const months: { name: string; לידים: number; לקוחות: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const name = d.toLocaleDateString('he-IL', { month: 'short' });
      // Use lead createdAt or lastUpdate to approximate
      const leadsInMonth = leads.filter(l => {
        const ts = (l as any).createdAt;
        if (!ts) return false;
        const d2 = new Date(typeof ts === 'number' ? ts : ts);
        return `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}` === key;
      });
      months.push({
        name,
        'לידים': leadsInMonth.length,
        'לקוחות': leadsInMonth.filter(l => l.status === 'לקוח פעיל').length,
      });
    }
    return months;
  }, [leads]);

  // Source distribution
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach(l => {
      counts[l.source] = (counts[l.source] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name: SOURCE_LABELS[name] ?? name, value }))
      .sort((a, b) => b.value - a.value);
  }, [leads]);

  // Pipeline stages
  const stageData = useMemo(() => {
    const stages = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'] as const;
    return stages.map(s => ({
      name: s,
      count: leads.filter(l => l.status === s).length,
      color: STATUS_COLORS[s],
    }));
  }, [leads]);

  // Recent leads
  const recentLeads = useMemo(() =>
    [...leads]
      .sort((a, b) => ((b as any).createdAt ?? 0) - ((a as any).createdAt ?? 0))
      .slice(0, 5),
    [leads]
  );

  // Upcoming tasks (next 7 days)
  const upcomingTasks = useMemo(() => {
    const in7 = new Date(); in7.setDate(in7.getDate() + 7);
    return standaloneTask
      .filter(t => {
        if (t.completed) return false;
        try {
          const d = new Date(t.date + 'T00:00:00');
          return d >= today && d <= in7;
        } catch { return false; }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [standaloneTask, today]);

  const fmt = (n: number) => n >= 1000 ? `₪${(n / 1000).toFixed(0)}K` : `₪${n}`;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800">
            {greeting}, {firstName}! 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {today.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        {stats.overdueTasks > 0 && (
          <button
            onClick={() => onPageChange('tasks')}
            className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
          >
            <Clock size={14} />
            {stats.overdueTasks} משימות באיחור
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users}     label="סה״כ לידים"      value={String(leads.length)}           color="bg-indigo-500" trend={{ value: stats.newLeads, label: `${stats.newLeads} חדשים` }} />
        <StatCard icon={Star}      label="לקוחות פעילים"   value={String(stats.activeClients)}     color="bg-emerald-500" trend={{ value: stats.conversionRate, label: `${stats.conversionRate}% המרה` }} />
        <StatCard icon={CheckSquare} label="משימות פתוחות" value={String(stats.openTasks)}         color="bg-amber-500" sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} באיחור` : 'הכל בזמן ✓'} />
        <StatCard icon={Wallet}    label="ערך פייפליין"     value={fmt(stats.pipelineValue)}        color="bg-violet-500" sub={`הכנסות: ${fmt(stats.revenue)}/חודש`} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Leads by month */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">לידים לפי חודש</h3>
              <p className="text-xs text-slate-400">6 חודשים אחרונים</p>
            </div>
            <Activity size={16} className="text-slate-400" />
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={25} />
              <Tooltip
                contentStyle={{ background: '#1E293B', border: 'none', borderRadius: 12, color: '#F1F5F9', fontSize: 12 }}
                cursor={{ fill: '#F1F5F9' }}
              />
              <Bar dataKey="לידים"   fill="#6366F1" radius={[6, 6, 0, 0]} />
              <Bar dataKey="לקוחות" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Source pie */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">מקורות לידים</h3>
              <p className="text-xs text-slate-400">התפלגות</p>
            </div>
            <Target size={16} className="text-slate-400" />
          </div>
          {sourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={65} innerRadius={35}>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#1E293B', border: 'none', borderRadius: 12, color: '#F1F5F9', fontSize: 11 }} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 10, color: '#64748B' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-400 text-sm">אין נתונים</div>
          )}
        </div>
      </div>

      {/* Pipeline + Recent + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline stages */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-bold text-slate-800 text-sm mb-4">פייפליין לפי שלב</h3>
          <div className="space-y-3">
            {stageData.map(({ name, count, color }) => {
              const pct = leads.length > 0 ? (count / leads.length) * 100 : 0;
              return (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600 font-medium">{name}</span>
                    <span className="font-bold text-slate-800">{count}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => onPageChange('kanban')} className="mt-4 w-full text-center text-xs text-indigo-600 font-semibold hover:text-indigo-700">
            פתח פייפליין ←
          </button>
        </div>

        {/* Recent leads */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 text-sm">לידים אחרונים</h3>
            <button onClick={() => onPageChange('dashboard')} className="text-xs text-indigo-600 font-semibold hover:text-indigo-700">הכל</button>
          </div>
          <div className="space-y-2.5">
            {recentLeads.length === 0 && <p className="text-slate-400 text-xs text-center py-4">אין לידים עדיין</p>}
            {recentLeads.map(l => (
              <button key={l.id} onClick={() => onLeadClick(l)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors text-right">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs flex-shrink-0">
                  {l.company.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{l.company}</p>
                  <p className="text-[10px] text-slate-400 truncate">{l.contactName}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: STATUS_COLORS[l.status] + '20', color: STATUS_COLORS[l.status] }}>
                  {l.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Upcoming tasks */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 text-sm">משימות קרובות</h3>
            <button onClick={() => onPageChange('tasks')} className="text-xs text-indigo-600 font-semibold hover:text-indigo-700">הכל</button>
          </div>
          <div className="space-y-2.5">
            {upcomingTasks.length === 0 && (
              <div className="text-center py-4">
                <CheckSquare size={24} className="text-slate-300 mx-auto mb-2" />
                <p className="text-slate-400 text-xs">אין משימות ל-7 ימים הקרובים</p>
              </div>
            )}
            {upcomingTasks.map(t => {
              const d = new Date(t.date + 'T00:00:00');
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <div key={t.id} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{t.description}</p>
                    <p className={`text-[10px] font-semibold mt-0.5 ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {isToday ? 'היום' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} · {t.time}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
