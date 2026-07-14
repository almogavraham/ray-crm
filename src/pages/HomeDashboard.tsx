import { useMemo, useState } from 'react';
import {
  Users, TrendingUp, CheckSquare, Wallet,
  Clock, Star,
  Activity, Target, Zap, AlertTriangle,
  Pencil, Trophy, Calendar as CalendarIcon,
} from 'lucide-react';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import { SmartAlerts } from './Agents';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { Lead, LeadMeeting, StandaloneTask } from '../types';

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

/* ── Neon KPI Card — matches Dashboard.tsx exactly ─────────────────────── */
function NeonKpiCard({ label, value, sub, icon: Icon, neon, percent }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  neon: string;  // hex color
  percent: number;
}) {
  const { c } = useTheme();
  return (
    <div
      className="rounded-xl p-4 transition-all duration-200 cursor-default"
      style={{
        background: `linear-gradient(135deg,${neon}10,${neon}06)`,
        border: `1px solid ${neon}28`,
        backdropFilter: 'blur(8px)',
        boxShadow: `0 2px 16px ${neon}12`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `0 4px 32px ${neon}28, 0 0 0 1px ${neon}48`;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = `0 2px 16px ${neon}12`;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-3xl font-black" style={{ color: c.textPrimary }}>{value}</div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `${neon}18`, border: `1px solid ${neon}28` }}>
          <Icon size={16} style={{ color: neon }} />
        </div>
      </div>
      <div className="text-sm font-bold text-right" style={{ color: c.textSecondary }}>{label}</div>
      {sub && <div className="text-xs text-right mt-0.5" style={{ color: c.textMuted }}>{sub}</div>}
      <div className="mt-3 h-1 rounded-full" style={{ background: c.subtleBg }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(percent, 100)}%`,
            background: `linear-gradient(90deg,${neon}55,${neon})`,
            boxShadow: `0 0 6px ${neon}55`,
          }}
        />
      </div>
    </div>
  );
}

/* ── Main ───────────────────────────────────────────────────────────────── */
export default function HomeDashboard({ leads, standaloneTask, currentUser, onLeadClick, onPageChange }: HomeDashboardProps) {
  const { t, dir } = useLang();
  const { isDark, c } = useTheme();
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
    const nowISO = new Date().toISOString();
    const overdueFollowUps = leads.filter(l =>
      (l as any).nextFollowUpDate && (l as any).nextFollowUpDate < nowISO &&
      !['לקוח פעיל','לא רלוונטי'].includes(l.status)
    ).length;
    return { activeClients, newLeads, openTasks, overdueTasks, pipelineValue, revenue, conversionRate, overdueFollowUps };
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

  const [monthlyGoal, setMonthlyGoal] = useState(50000);
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalInput, setGoalInput] = useState(50000);

  const fmt = (n: number) => n>=1000 ? `₪${(n/1000).toFixed(0)}K` : `₪${n}`;

  // Goals & Quotas calculations
  const currentRevenue = useMemo(() =>
    leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + (l.budget || 0), 0),
  [leads]);

  const pipelineRevenue = useMemo(() =>
    leads
      .filter(l => ['חדש', 'בתהליך'].includes(l.status))
      .reduce((s, l) => {
        const prob = l.status === 'בתהליך' ? 0.4 : 0.1;
        return s + (l.budget || 0) * prob;
      }, 0),
  [leads]);

  const goalPct = Math.min(100, Math.round((currentRevenue / monthlyGoal) * 100));
  const forecastPct = Math.min(100, Math.round(((currentRevenue + pipelineRevenue) / monthlyGoal) * 100));

  const avgDeal = stats.activeClients > 0 ? Math.round(currentRevenue / stats.activeClients) : 0;

  // Today's Agenda calculations
  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);

  const todayTasks = useMemo(() =>
    standaloneTask.filter(t => !t.completed && t.date === todayISO),
  [standaloneTask, todayISO]);

  const overdueTasks2 = useMemo(() =>
    standaloneTask.filter(t => !t.completed && t.date < todayISO),
  [standaloneTask, todayISO]);

  const urgentLeads = useMemo(() => {
    const parseDate = (dmy: string) => {
      const [d, m, y] = dmy.split('/');
      return new Date(`${y}-${m}-${d}T00:00:00`);
    };
    return leads.filter(l => {
      if (!['חדש', 'בתהליך'].includes(l.status)) return false;
      if (!l.lastUpdate) return false;
      try {
        const last = parseDate(l.lastUpdate);
        const diffMs = Date.now() - last.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return days >= 14;
      } catch { return false; }
    });
  }, [leads]);

  const hotLeads = useMemo(() =>
    leads.filter(l => (l.budget || 0) >= 15000 && l.status !== 'לקוח פעיל'),
  [leads]);

  const untreatedLeads = useMemo(() => {
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    return leads.filter(l => {
      if (l.status !== 'חדש') return false;
      const hasActivity = (l.activityLog?.length ?? 0) > 0 || l.lastContactDate;
      if (hasActivity) return false;
      // check if older than 2 days
      const created = l.createdAt ? l.createdAt : (l.lastUpdate ? new Date(l.lastUpdate.split('/').reverse().join('-')).getTime() : 0);
      return (now - created) > twoDaysMs;
    });
  }, [leads]);

  const upcomingMeetings = useMemo(() => {
    const now = new Date();
    const meetings: Array<{ meeting: LeadMeeting; lead: Lead }> = [];
    leads.forEach(l => {
      (l.meetings || []).forEach(m => {
        const mDate = new Date(`${m.date}T${m.time}:00`);
        if (mDate >= now) meetings.push({ meeting: m, lead: l });
      });
    });
    return meetings
      .sort((a, b) => new Date(`${a.meeting.date}T${a.meeting.time}`).getTime() - new Date(`${b.meeting.date}T${b.meeting.time}`).getTime())
      .slice(0, 5);
  }, [leads]);

  // Activity feed — leads sorted by lastUpdate
  const activityItems = useMemo(() => {
    const parseDate = (dmy: string) => {
      if (!dmy) return new Date(0);
      const [d, m, y] = dmy.split('/');
      return new Date(`${y}-${m}-${d}T00:00:00`);
    };
    return [...leads]
      .filter(l => l.lastUpdate)
      .sort((a, b) => parseDate(b.lastUpdate).getTime() - parseDate(a.lastUpdate).getTime())
      .slice(0, 6);
  }, [leads]);

  const tooltipStyle = {
    contentStyle: {
      background: 'rgba(10,15,30,0.95)',
      border: '1px solid rgba(99,102,241,0.3)',
      borderRadius: 8,
      color: c.textPrimary,
      fontSize: 12,
    },
    labelStyle: { color: c.textSecondary },
    cursor: { fill: 'rgba(99,102,241,0.06)' },
  };

  /* glass card style helper — matches Dashboard.tsx */
  const card = {
    background: c.subtleBg,
    border: `1px solid ${c.cardBorder}`,
    backdropFilter: 'blur(8px)',
    borderRadius: 12,
    padding: 18,
  };

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-4"
      dir={dir}
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
      }}
    >

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
              <Zap size={13} className="text-white fill-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight" style={{ color: c.textPrimary }}>
              {greeting},{' '}
              <span style={{ color: c.accentText }}>{firstName}</span>
            </h1>
          </div>
          <p className="text-[12px] font-medium mr-9" style={{ color: c.textMuted }}>
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
            {stats.overdueTasks} {t('home.overdueTasksBtn')}
          </button>
        )}
      </div>

      {/* ── KPI Cards — Row 1 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-tour="home-kpi-cards">
        <NeonKpiCard
          icon={Users}
          label={t('home.statTotalLeads')}
          value={String(leads.length)}
          sub={`${stats.newLeads} ${t('home.statNewLeads')}`}
          neon="#6366f1"
          percent={leads.length > 0 ? Math.min(100, (leads.length / 100) * 100) : 0}
        />
        <NeonKpiCard
          icon={Star}
          label={t('home.statActiveClients')}
          value={String(stats.activeClients)}
          sub={`${stats.conversionRate}% ${t('home.statConversion')}`}
          neon="#10b981"
          percent={stats.conversionRate}
        />
        <NeonKpiCard
          icon={CheckSquare}
          label={t('home.statOpenTasks')}
          value={String(stats.openTasks)}
          sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} ${t('home.statOverdue')}` : t('home.statAllOnTime')}
          neon="#f59e0b"
          percent={stats.openTasks > 0 ? Math.max(5, 100 - Math.round((stats.overdueTasks / stats.openTasks) * 100)) : 100}
        />
        <NeonKpiCard
          icon={Wallet}
          label={t('home.statPipelineValue')}
          value={fmt(stats.pipelineValue)}
          sub={`${t('home.statRevenue')}: ${fmt(stats.revenue)}`}
          neon="#8b5cf6"
          percent={monthlyGoal > 0 ? Math.min(100, Math.round((stats.revenue / monthlyGoal) * 100)) : 0}
        />
      </div>

      {/* ── KPI Cards — Row 2 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NeonKpiCard
          icon={AlertTriangle}
          label="דורשים מעקב"
          value={String(stats.overdueFollowUps)}
          sub="עבר תאריך פנייה"
          neon="#ef4444"
          percent={leads.length > 0 ? Math.min(100, Math.round((stats.overdueFollowUps / Math.max(leads.length, 1)) * 100)) : 0}
        />
        <NeonKpiCard
          icon={Clock}
          label="פגישות קרובות"
          value={String(upcomingMeetings.length)}
          sub="מתוכננות"
          neon="#8b5cf6"
          percent={Math.min(100, upcomingMeetings.length * 10)}
        />
        <NeonKpiCard
          icon={TrendingUp}
          label="שיעור המרה"
          value={`${stats.conversionRate}%`}
          sub="לידים → לקוחות"
          neon="#6366f1"
          percent={stats.conversionRate}
        />
      </div>

      {/* ── Untreated Leads + Upcoming Meetings ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* Untreated Leads — styled like NeonKpiCard */}
        <div
          className="rounded-xl p-4 transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg,#ef444410,#ef444406)',
            border: '1px solid #ef444428',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 16px #ef444412',
          }}
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#ef444418', border: '1px solid #ef444428' }}>
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
            </div>
            <div className="text-right">
              <div className="text-3xl font-black" style={{ color: c.textPrimary }}>{untreatedLeads.length}</div>
            </div>
          </div>
          <div className="text-sm font-bold text-right mb-0.5" style={{ color: c.textSecondary }}>לידים שלא טופלו</div>
          <div className="text-xs text-right mb-3" style={{ color: '#ef4444bb' }}>חדשים ללא פעילות</div>

          {/* Progress bar */}
          <div className="h-1 rounded-full mb-3" style={{ background: c.subtleBg }}>
            <div
              className="h-full rounded-full"
              style={{
                width: leads.length > 0 ? `${Math.min(100, Math.round((untreatedLeads.length / leads.length) * 100))}%` : '0%',
                background: 'linear-gradient(90deg,#ef444455,#ef4444)',
                boxShadow: '0 0 6px #ef444455',
              }}
            />
          </div>

          {/* List */}
          {untreatedLeads.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-[12px] font-semibold" style={{ color: '#10b981' }}>✓ הכל מטופל!</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {untreatedLeads.slice(0, 4).map(lead => {
                const created = lead.createdAt
                  ? lead.createdAt
                  : (lead.lastUpdate ? new Date(lead.lastUpdate.split('/').reverse().join('-')).getTime() : 0);
                const daysOld = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
                const neon = STATUS_COLORS[lead.status] ?? '#6366f1';
                return (
                  <button
                    key={lead.id}
                    onClick={() => onLeadClick(lead)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-right"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.14)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.13)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
                  >
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ backgroundColor: `${neon}18`, border: `1px solid ${neon}30`, color: neon }}>
                      {lead.company.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-[11px] font-semibold truncate" style={{ color: c.textPrimary }}>{lead.company}</p>
                      <p className="text-[9px]" style={{ color: '#ef4444bb' }}>לפני {daysOld} ימים</p>
                    </div>
                  </button>
                );
              })}
              {untreatedLeads.length > 4 && (
                <p className="text-[10px] text-center pt-1" style={{ color: 'rgba(239,68,68,0.6)' }}>
                  +{untreatedLeads.length - 4} נוספים
                </p>
              )}
            </div>
          )}
        </div>

        {/* Objections — styled like NeonKpiCard */}
        {(() => {
          const objectionLeads = leads.filter(l => (l as any).objection);
          const objectionCounts: Record<string, number> = {};
          objectionLeads.forEach(l => {
            const o = (l as any).objection as string;
            objectionCounts[o] = (objectionCounts[o] ?? 0) + 1;
          });
          const topObjections = Object.entries(objectionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);

          return (
            <div
              className="rounded-xl p-4 transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg,#f59e0b10,#f59e0b06)',
                border: '1px solid #f59e0b28',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 16px #f59e0b12',
              }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#f59e0b18', border: '1px solid #f59e0b28' }}>
                  <Target size={16} style={{ color: '#f59e0b' }} />
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black" style={{ color: c.textPrimary }}>{objectionLeads.length}</div>
                </div>
              </div>
              <div className="text-sm font-bold text-right mb-0.5" style={{ color: c.textSecondary }}>התנגדויות</div>
              <div className="text-xs text-right mb-3" style={{ color: '#f59e0bbb' }}>לידים לא רלוונטיים עם סיבה</div>

              {/* Progress bar */}
              <div className="h-1 rounded-full mb-3" style={{ background: c.subtleBg }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: leads.length > 0 ? `${Math.min(100, Math.round((objectionLeads.length / leads.length) * 100))}%` : '0%',
                    background: 'linear-gradient(90deg,#f59e0b55,#f59e0b)',
                    boxShadow: '0 0 6px #f59e0b55',
                  }}
                />
              </div>

              {/* List */}
              {objectionLeads.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-[12px]" style={{ color: c.textMuted }}>אין התנגדויות רשומות</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {topObjections.map(([objection, count]) => (
                    <div
                      key={objection}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)' }}
                    >
                      <div className="flex-1 min-w-0 text-right">
                        <p className="text-[11px] font-semibold truncate" style={{ color: c.textPrimary }}>{objection}</p>
                      </div>
                      <span
                        className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}
                      >
                        {count}
                      </span>
                    </div>
                  ))}
                  {objectionLeads.length > 4 && (
                    <p className="text-[10px] text-center pt-1" style={{ color: 'rgba(245,158,11,0.6)' }}>
                      +{objectionLeads.length - 4} נוספים
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Goals & Quotas ─────────────────────────────────────────────── */}
      <div style={card}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              if (goalEditing) {
                setMonthlyGoal(goalInput);
                setGoalEditing(false);
              } else {
                setGoalInput(monthlyGoal);
                setGoalEditing(true);
              }
            }}
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all"
            style={{ color: goalEditing ? '#10b981' : '#818cf8', border: `1px solid ${goalEditing ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.25)'}`, backgroundColor: goalEditing ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.07)' }}
          >
            {goalEditing ? 'שמור' : <><Pencil size={10} /> עריכה</>}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#f59e0b,#f59e0b80)' }} />
            <Trophy size={14} style={{ color: '#f59e0b' }} />
            <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>יעד חודשי</h3>
          </div>
        </div>

        {/* Edit input */}
        {goalEditing && (
          <div className="flex items-center gap-2 mb-4 justify-end">
            <span className="text-[12px]" style={{ color: c.textSecondary }}>יעד חדש:</span>
            <input
              type="number"
              value={goalInput}
              onChange={e => setGoalInput(Number(e.target.value))}
              className="text-[13px] font-bold text-right px-3 py-1.5 rounded-lg w-36"
              style={{
                background: c.subtleBg,
                border: '1px solid rgba(99,102,241,0.4)',
                color: c.textPrimary,
                outline: 'none',
              }}
            />
            <span className="text-[12px]" style={{ color: c.textMuted }}>₪</span>
          </div>
        )}

        {/* Progress bars */}
        <div className="space-y-3 mb-4">
          {/* Goal bar */}
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span style={{ color: '#10b981' }}>{goalPct}%</span>
              <span style={{ color: c.textMuted }}>הושג</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${goalPct}%`, background: 'linear-gradient(90deg, #059669, #10b981)' }}
              />
            </div>
          </div>
          {/* Forecast bar */}
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span style={{ color: '#6366f1' }}>{forecastPct}%</span>
              <span style={{ color: c.textMuted }}>תחזית (כולל פייפליין)</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${forecastPct}%`, background: 'linear-gradient(90deg, #4338ca, #6366f1)' }}
              />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'הושג', value: `₪${currentRevenue.toLocaleString('he-IL')}`, color: '#10b981' },
            { label: 'יעד', value: `₪${monthlyGoal.toLocaleString('he-IL')}`, color: c.textSecondary },
            { label: 'תחזית', value: `₪${Math.round(currentRevenue + pipelineRevenue).toLocaleString('he-IL')}`, color: '#6366f1' },
            { label: 'נשאר', value: `₪${Math.max(0, monthlyGoal - currentRevenue).toLocaleString('he-IL')}`, color: '#f59e0b' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center px-2 py-2 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
              <p className="text-[13px] font-bold" style={{ color }}>{value}</p>
              <p className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Badge + mini KPIs */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'סגירות החודש', value: String(stats.activeClients), color: '#10b981' },
              { label: 'שיעור המרה', value: `${stats.conversionRate}%`, color: '#6366f1' },
              { label: 'ממוצע עסקה', value: avgDeal >= 1000 ? `₪${(avgDeal/1000).toFixed(0)}K` : `₪${avgDeal}`, color: '#f59e0b' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center px-3 py-2 rounded-lg" style={{ background: `${color}0d`, border: `1px solid ${color}20` }}>
                <p className="text-[14px] font-black" style={{ color }}>{value}</p>
                <p className="text-[9px] mt-0.5 leading-tight" style={{ color: c.textMuted }}>{label}</p>
              </div>
            ))}
          </div>
          <div
            className="text-[12px] font-bold px-4 py-2 rounded-xl"
            style={goalPct >= 100
              ? { backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }
              : { backgroundColor: 'rgba(99,102,241,0.10)', color: c.accentText, border: '1px solid rgba(99,102,241,0.25)' }
            }
          >
            {goalPct >= 100 ? '🎉 היעד הושג!' : `${goalPct}% מהיעד`}
          </div>
        </div>
      </div>

      {/* ── היום שלי — Today's Agenda ──────────────────────────────────── */}
      <div style={card}>
        <div className="flex items-center justify-between mb-4">
          <CalendarIcon size={13} style={{ color: c.textMuted }} />
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#6366f180)' }} />
            <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>היום שלי</h3>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Left — Today's Tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {overdueTasks2.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                    +{overdueTasks2.length} ואיחורים
                  </span>
                )}
              </div>
              <p className="text-[12px] font-semibold" style={{ color: c.textSecondary }}>📋 משימות להיום</p>
            </div>
            {todayTasks.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[12px]" style={{ color: c.textMuted }}>אין משימות להיום ✓</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayTasks.slice(0, 4).map(task => {
                  const dot = task.priority === 'high' ? '#ef4444' : task.priority === 'medium' ? '#f59e0b' : 'rgba(255,255,255,0.2)';
                  return (
                    <div key={task.id} className="flex items-start gap-2.5 p-2 rounded-lg" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: dot }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate" style={{ color: c.textSecondary }}>{task.description}</p>
                        {task.time && <p className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{task.time}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — Urgent Leads */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {hotLeads.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' }}>
                    🔥 {hotLeads.length} לידים VIP
                  </span>
                )}
              </div>
              <p className="text-[12px] font-semibold" style={{ color: c.textSecondary }}>⚡ לידים דחופים</p>
            </div>
            {urgentLeads.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[12px]" style={{ color: c.textMuted }}>הכל מעודכן ✓</p>
              </div>
            ) : (
              <div className="space-y-2">
                {urgentLeads.slice(0, 4).map(lead => {
                  const parseDate = (dmy: string) => {
                    const [d, m, y] = dmy.split('/');
                    return new Date(`${y}-${m}-${d}T00:00:00`);
                  };
                  const days = Math.floor((Date.now() - parseDate(lead.lastUpdate).getTime()) / (1000 * 60 * 60 * 24));
                  const urgNeon = days >= 30 ? '#ef4444' : days >= 21 ? '#f97316' : '#f59e0b';
                  return (
                    <button
                      key={lead.id}
                      onClick={() => onLeadClick(lead)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 transition-all text-right"
                      style={{
                        borderRadius: 8,
                        borderRight: `3px solid ${urgNeon}`,
                        background: c.subtleBg,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.backgroundColor = `${urgNeon}0d`;
                        e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${urgNeon}20`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold truncate" style={{ color: c.textPrimary }}>{lead.company}</p>
                        {lead.budget ? <p className="text-[10px]" style={{ color: c.textMuted }}>{fmt(lead.budget)}</p> : null}
                      </div>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: `${urgNeon}14`, color: urgNeon, border: `1px solid ${urgNeon}30` }}>
                        {days}י׳
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Bar chart */}
        <div className="lg:col-span-2" style={card}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#6366f180)' }} />
                <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>{t('home.chartLeadsByMonth')}</h3>
              </div>
              <p className="text-[11px] mr-3" style={{ color: c.textMuted }}>{t('home.chartLast6Months')}</p>
            </div>
            <div className="flex items-center gap-3 text-[10px]" style={{ color: c.textMuted }}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />{t('home.chartLeads')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{t('home.chartClients')}
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthlyData} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} width={22} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="לידים"  fill="#6366f1" radius={[4,4,0,0]} opacity={0.9} />
              <Bar dataKey="לקוחות" fill="#10b981" radius={[4,4,0,0]} opacity={0.9} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div style={card}>
          <div className="flex items-center justify-between mb-5">
            <Target size={13} style={{ color: c.textMuted }} />
            <div>
              <div className="flex items-center gap-2 mb-0.5 justify-end">
                <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>{t('home.chartLeadSources')}</h3>
                <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#8b5cf6,#8b5cf680)' }} />
              </div>
              <p className="text-[11px] text-right" style={{ color: c.textMuted }}>{t('home.chartDistribution')}</p>
            </div>
          </div>
          {sourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={62} innerRadius={32}>
                  {sourceData.map((_,i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} cursor={false} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ color: c.textSecondary, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-44 flex items-center justify-center text-[12px]" style={{ color: c.textMuted }}>{t('home.chartNoData')}</div>
          )}
        </div>
      </div>

      {/* ── Pipeline + Recent + Tasks ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Pipeline stages */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <TrendingUp size={13} style={{ color: c.textMuted }} />
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>{t('home.pipelineByStage')}</h3>
              <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#10b981,#10b98180)' }} />
            </div>
          </div>
          <div className="space-y-3">
            {stageData.map(({ name, count, color }) => {
              const pct = leads.length > 0 ? (count/leads.length)*100 : 0;
              return (
                <div key={name}>
                  <div className="flex justify-between text-[11px] mb-1.5">
                    <span className="font-semibold" style={{ color: c.textSecondary }}>{count}</span>
                    <span style={{ color: c.textMuted }}>{name}</span>
                  </div>
                  <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
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
            style={{ color: c.accentText, border: '1px solid rgba(99,102,241,0.2)' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)';
              e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.08)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {t('home.openPipeline')}
          </button>
        </div>

        {/* Recent leads */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => onPageChange('dashboard')}
              className="text-[11px] font-semibold transition-colors px-2 py-1 rounded-lg"
              style={{ color: c.accentText, border: '1px solid rgba(99,102,241,0.2)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {t('home.seeAll')}
            </button>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>{t('home.recentLeads')}</h3>
              <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#6366f180)' }} />
            </div>
          </div>
          <div className="space-y-1">
            {recentLeads.length === 0 && (
              <p className="text-[11px] text-center py-6" style={{ color: c.textMuted }}>{t('home.recentLeadsEmpty')}</p>
            )}
            {recentLeads.map(l => {
              const neon = STATUS_COLORS[l.status] ?? '#6366f1';
              return (
                <button key={l.id} onClick={() => onLeadClick(l)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-right transition-all"
                  style={{
                    borderRadius: 8,
                    borderRight: `3px solid ${neon}`,
                    background: c.subtleBg,
                    marginBottom: 4,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = `${neon}0d`;
                    e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${neon}20`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{ backgroundColor: `${neon}18`, border: `1px solid ${neon}30`, color: neon }}>
                    {l.company.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate" style={{ color: c.textPrimary }}>{l.company}</p>
                    <p className="text-[10px] truncate" style={{ color: c.textMuted }}>{l.contactName}</p>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
                    style={{
                      backgroundColor: `${neon}12`,
                      color: neon,
                      border: `1px solid ${neon}25`,
                    }}>
                    {l.status}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upcoming tasks */}
        <div style={card}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => onPageChange('tasks')}
              className="text-[11px] font-semibold transition-colors px-2 py-1 rounded-lg"
              style={{ color: c.accentText, border: '1px solid rgba(99,102,241,0.2)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {t('home.seeAll')}
            </button>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>{t('home.upcomingTasks')}</h3>
              <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#f59e0b,#f59e0b80)' }} />
            </div>
          </div>
          <div className="space-y-1">
            {upcomingTasks.length === 0 && (
              <div className="text-center py-6">
                <CheckSquare size={20} className="mx-auto mb-2" style={{ color: c.textMuted }} />
                <p className="text-[11px]" style={{ color: c.textMuted }}>{t('home.noUpcomingTasks')}</p>
              </div>
            )}
            {upcomingTasks.map(task => {
              const d = new Date(task.date+'T00:00:00');
              const isToday = d.toDateString() === new Date().toDateString();
              const priorityDot = task.priority==='high' ? '#ef4444' : task.priority==='medium' ? '#f59e0b' : 'rgba(255,255,255,0.2)';
              return (
                <div key={task.id} className="flex items-start gap-2.5 p-2 rounded-lg transition-all"
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  style={{ borderRadius: 8 }}
                >
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: priorityDot }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: c.textSecondary }}>{task.description}</p>
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: isToday ? '#818cf8' : 'rgba(255,255,255,0.38)' }}>
                      {isToday ? t('home.today') : d.toLocaleDateString('he-IL', { day:'numeric', month:'short' })} · {task.time}
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
              style={{ color: c.accentText, border: '1px solid rgba(99,102,241,0.2)' }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)';
                e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.08)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Clock size={11} />
              {t('home.seeAllTasks')}
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
            style={{ color: c.accentText }}
          >
            {t('home.allAgents')}
          </button>
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={13} style={{ color: c.textMuted }} />
            <h3 className="font-semibold text-[13px]" style={{ color: c.textPrimary }}>{t('home.smartAlerts')}</h3>
          </div>
        </div>
        <SmartAlerts leads={leads} standaloneTask={standaloneTask} />
      </div>

      {/* ── Activity Feed ────────────────────────────────────────────── */}
      <div style={card}>
        <div className="flex items-center justify-between mb-4">
          <Activity size={13} style={{ color: c.textMuted }} />
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>פעילות אחרונה</h3>
            <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#6366f180)' }} />
          </div>
        </div>
        {activityItems.length === 0 ? (
          <p className="text-center text-[12px] py-4" style={{ color: c.textMuted }}>אין פעילות להציג</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
            {activityItems.map(lead => {
              const color = STATUS_COLORS[lead.status] ?? '#6366f1';
              return (
                <button
                  key={lead.id}
                  onClick={() => onLeadClick(lead)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 transition-all text-right"
                  style={{
                    borderRadius: 8,
                    borderRight: `3px solid ${color}`,
                    background: c.subtleBg,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = `${color}0d`;
                    e.currentTarget.style.boxShadow = `inset 0 0 0 1px ${color}20`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <span className="text-[10px] font-medium flex-shrink-0" style={{ color: c.textMuted, minWidth: 68, textAlign: 'left' }}>
                    {lead.lastUpdate}
                  </span>
                  <span
                    className="text-[9px] font-bold px-2 py-0.5 rounded-md flex-shrink-0"
                    style={{ backgroundColor: `${color}12`, color, border: `1px solid ${color}25` }}
                  >
                    {lead.status}
                  </span>
                  <p className="flex-1 text-[12px] font-medium truncate" style={{ color: c.textSecondary }}>
                    {lead.company} — עודכן ל&quot;{lead.status}&quot;
                  </p>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Activity row ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 rounded-xl"
        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px]" style={{ color: c.textMuted }}>{t('home.dataSynced')}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px]" style={{ color: c.textMuted }}>
          <span className="flex items-center gap-1.5">
            <Activity size={10} />
            {leads.length} {t('home.activeLeads')}
          </span>
          <span className="hidden sm:flex items-center gap-1.5">
            <Users size={10} />
            {stats.activeClients} {t('home.statActiveClients')}
          </span>
        </div>
      </div>
    </div>
  );
}
