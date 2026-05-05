import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Flame, CheckCircle2, Rocket, Users, TrendingUp, DollarSign,
  Calendar, Brain, Activity, Award,
} from 'lucide-react';
import type { Lead, LeadStatus } from '../types';

const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש': '#3b82f6',
  'בתהליך': '#f97316',
  'לקוח פעיל': '#22c55e',
  'רימרקטינג': '#f59e0b',
  'לא רלוונטי': '#94a3b8',
};

const PIPELINE_ORDER: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל'];

const ALL_SOURCES = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

type TimeRange = '7' | '30' | '90' | 'all';

function parseDDMMYYYY(s: string): Date {
  const p = (s || '').split('/');
  if (p.length === 3) return new Date(`${p[2]}-${p[1]}-${p[0]}T00:00:00`);
  return new Date(0);
}

interface OverviewProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
}

export default function Overview({ leads, onLeadClick }: OverviewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  const filteredLeads = useMemo(() => {
    if (timeRange === 'all') return leads;
    const days = parseInt(timeRange, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return leads.filter(l => parseDDMMYYYY(l.lastUpdate) >= cutoff);
  }, [leads, timeRange]);

  const hotLeads = filteredLeads.filter(l => (l.budget ?? 0) >= 15000);
  const activeClients = filteredLeads.filter(l => l.status === 'לקוח פעיל');
  const onboarding = filteredLeads.filter(l => l.status === 'בתהליך');
  const totalBudget = filteredLeads.reduce((sum, l) => sum + (l.budget ?? 0), 0);

  const statusData = (Object.keys(STATUS_COLORS) as LeadStatus[])
    .map(s => ({
      name: s,
      value: filteredLeads.filter(l => l.status === s).length,
      color: STATUS_COLORS[s],
    }))
    .filter(d => d.value > 0);

  const sourceData = ALL_SOURCES.map(source => ({
    name: source,
    count: filteredLeads.filter(l => l.source === source).length,
  }))
    .filter(d => d.count > 0)
    .sort((a, b) => b.count - a.count);

  const funnelData = PIPELINE_ORDER.map(s => ({
    name: s,
    value: filteredLeads.filter(l => l.status === s).length,
    fill: STATUS_COLORS[s],
  }));

  const conversionRate =
    filteredLeads.length > 0
      ? Math.round((activeClients.length / filteredLeads.length) * 100)
      : 0;

  const avgScore =
    filteredLeads.length > 0
      ? Math.round(filteredLeads.reduce((s, l) => s + l.aiScore, 0) / filteredLeads.length)
      : 0;

  // Top 5 leads by AI score
  const top5Leads = useMemo(
    () => [...leads].sort((a, b) => b.aiScore - a.aiScore).slice(0, 5),
    [leads],
  );

  // Recent activity: last 8 notes across all leads
  const recentNotes = useMemo(() => {
    const allNotes: { note: { id: string; text: string; author: string; timestamp: string }; company: string; leadObj: Lead }[] = [];
    for (const lead of leads) {
      for (const note of lead.notes) {
        allNotes.push({ note, company: lead.company, leadObj: lead });
      }
    }
    allNotes.sort((a, b) => b.note.timestamp.localeCompare(a.note.timestamp));
    return allNotes.slice(0, 8);
  }, [leads]);

  // Agent leaderboard
  const agentLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; total: number; active: number }>();
    for (const lead of leads) {
      if (!lead.assignedTo) continue;
      const existing = map.get(lead.assignedTo) ?? { name: lead.assignedTo, total: 0, active: 0 };
      existing.total++;
      if (lead.status === 'לקוח פעיל') existing.active++;
      map.set(lead.assignedTo, existing);
    }
    return [...map.values()].sort((a, b) => b.active - a.active).slice(0, 5);
  }, [leads]);

  const timeRangeLabels: { key: TimeRange; label: string }[] = [
    { key: '7', label: 'שבוע' },
    { key: '30', label: 'חודש' },
    { key: '90', label: 'רבעון' },
    { key: 'all', label: 'הכל' },
  ];

  return (
    <div className="space-y-5">
      {/* Time range filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
          {timeRangeLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeRange(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === key
                  ? 'bg-black text-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-slate-400" />
          <span className="text-slate-500 text-sm">
            {timeRange === 'all' ? 'כל הזמנים' : `${timeRange} ימים אחרונים`} — {filteredLeads.length} לידים
          </span>
        </div>
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          {
            label: 'לידים VIP',
            value: hotLeads.length,
            sub: 'תקציב ₪15K+',
            icon: <Flame className="text-red-500" size={20} />,
            color: 'text-red-600',
            bar: 'bg-red-400',
            pct: Math.round((hotLeads.length / Math.max(filteredLeads.length, 1)) * 100),
          },
          {
            label: 'בתהליך',
            value: onboarding.length,
            sub: 'פרויקטים פעילים',
            icon: <Rocket className="text-orange-500" size={20} />,
            color: 'text-orange-600',
            bar: 'bg-orange-400',
            pct: Math.round((onboarding.length / Math.max(filteredLeads.length, 1)) * 100),
          },
          {
            label: 'לקוחות פעילים',
            value: activeClients.length,
            sub: `${conversionRate}% המרה`,
            icon: <CheckCircle2 className="text-green-500" size={20} />,
            color: 'text-green-600',
            bar: 'bg-green-400',
            pct: conversionRate,
          },
          {
            label: 'סה"כ לידים',
            value: filteredLeads.length,
            sub: `ציון AI ממוצע ${avgScore}%`,
            icon: <Users className="text-slate-500" size={20} />,
            color: 'text-slate-700',
            bar: 'bg-slate-500',
            pct: 100,
          },
        ].map(s => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="p-2 bg-slate-50 rounded-lg">{s.icon}</div>
            </div>
            <div className="text-sm font-medium text-slate-700 text-right">{s.label}</div>
            <div className="text-xs text-slate-400 text-right mt-0.5">{s.sub}</div>
            <div className="mt-3 h-1 bg-slate-100 rounded-full">
              <div
                className={`h-1 rounded-full ${s.bar}`}
                style={{ width: `${Math.min(s.pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Revenue + Funnel row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {/* Total Budget */}
        <div className="bg-black rounded-xl p-5 shadow-sm text-white">
          <div className="flex items-center justify-between mb-4">
            <DollarSign size={20} className="text-neutral-400" />
            <span className="text-neutral-300 text-sm font-medium">תקציב שיווק כולל</span>
          </div>
          <div className="text-4xl font-bold mb-1">₪{totalBudget.toLocaleString()}</div>
          <div className="text-neutral-400 text-sm">סה"כ תקציב חודשי מהלידים</div>
          <div className="mt-4 pt-4 border-t border-neutral-700 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xl font-bold">{hotLeads.length}</div>
              <div className="text-neutral-400 text-xs">לידי VIP (₪15K+)</div>
            </div>
            <div>
              <div className="text-xl font-bold">{avgScore}%</div>
              <div className="text-neutral-400 text-xs">ציון AI ממוצע</div>
            </div>
          </div>
        </div>

        {/* Pipeline Funnel */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <TrendingUp size={16} className="text-slate-500" />
            <h3 className="font-semibold text-slate-700">פאנל מכירות — קונברזן</h3>
          </div>
          <div className="flex items-end gap-3 h-32">
            {funnelData.map((stage, i) => {
              const maxVal = Math.max(...funnelData.map(d => d.value), 1);
              const pct = (stage.value / maxVal) * 100;
              const conv =
                i > 0 && funnelData[i - 1].value > 0
                  ? Math.round((stage.value / funnelData[i - 1].value) * 100)
                  : null;
              return (
                <div key={stage.name} className="flex-1 flex flex-col items-center gap-1">
                  {conv !== null && (
                    <div className="text-xs text-slate-400 mb-1">↓ {conv}%</div>
                  )}
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div
                      className="w-full rounded-t-lg transition-all duration-500"
                      style={{
                        height: `${Math.max(pct, 8)}%`,
                        backgroundColor: stage.fill,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <div className="text-lg font-bold text-slate-800">{stage.value}</div>
                  <div className="text-xs text-slate-500 text-center leading-tight">{stage.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {/* Leads by Source */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-4 text-right">לידים לפי מקור</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11 }}
                width={80}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                }}
              />
              <Bar dataKey="count" fill="#171717" radius={[0, 6, 6, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-4 text-right">התפלגות לפי סטטוס</h3>
          <div className="flex items-center gap-4">
            <div className="space-y-2.5 flex-1">
              {statusData.map(d => (
                <div key={d.name} className="space-y-0.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold" style={{ color: d.color }}>
                      {d.value}
                    </span>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <span className="text-xs">{d.name}</span>
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: d.color }}
                      />
                    </div>
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full">
                    <div
                      className="h-1 rounded-full"
                      style={{
                        backgroundColor: d.color,
                        width: `${filteredLeads.length > 0 ? (d.value / filteredLeads.length) * 100 : 0}%`,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="w-28 h-28 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    outerRadius={52}
                    innerRadius={28}
                    paddingAngle={2}
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 AI Score + Recent Activity + Agent Leaderboard row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {/* Top 5 by AI Score */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-end gap-2 mb-4">
            <h3 className="font-semibold text-slate-700">טופ 5 לפי ציון AI</h3>
            <Brain size={16} className="text-slate-500" />
          </div>
          <div className="space-y-2">
            {top5Leads.map((lead, i) => {
              const scoreColor =
                lead.aiScore >= 75
                  ? 'bg-green-500'
                  : lead.aiScore >= 50
                  ? 'bg-orange-400'
                  : 'bg-slate-300';
              return (
                <div
                  key={lead.id}
                  onClick={() => onLeadClick(lead)}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-slate-800 text-sm">{lead.aiScore}%</span>
                      <span className="font-medium text-slate-700 text-sm truncate mr-2">
                        {lead.company}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div
                        className={`h-1.5 rounded-full ${scoreColor}`}
                        style={{ width: `${lead.aiScore}%` }}
                      />
                    </div>
                  </div>
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#f97316' : '#e2e8f0',
                      color: i < 3 ? 'white' : '#64748b',
                    }}
                  >
                    {i + 1}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity Feed */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-end gap-2 mb-4">
            <h3 className="font-semibold text-slate-700">פעילות אחרונה</h3>
            <Activity size={16} className="text-slate-500" />
          </div>
          {recentNotes.length === 0 ? (
            <div className="text-center text-slate-300 text-sm py-8">אין פעילות אחרונה</div>
          ) : (
            <div className="space-y-3">
              {recentNotes.map(({ note, company, leadObj }) => (
                <div
                  key={note.id}
                  onClick={() => onLeadClick(leadObj)}
                  className="flex gap-2 cursor-pointer hover:bg-slate-50 rounded-lg p-1.5 -mx-1.5 transition-colors"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-xs text-slate-700 leading-snug truncate">
                      {note.text.length > 60 ? note.text.slice(0, 60) + '...' : note.text}
                    </div>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-xs text-slate-300">
                        {note.timestamp.slice(0, 10)}
                      </span>
                      <span className="text-xs text-slate-400">{note.author}</span>
                      <span className="text-xs font-medium text-slate-700">{company}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agent Leaderboard */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-end gap-2 mb-4">
            <h3 className="font-semibold text-slate-700">לידרבורד סוכנים</h3>
            <Award size={16} className="text-slate-500" />
          </div>
          {agentLeaderboard.length === 0 ? (
            <div className="text-center text-slate-300 text-sm py-8">אין נתונים</div>
          ) : (
            <div className="space-y-3">
              {agentLeaderboard.map((agent, i) => {
                const maxActive = agentLeaderboard[0]?.active || 1;
                const rankColors = ['text-yellow-500', 'text-slate-400', 'text-orange-500'];
                return (
                  <div key={agent.name} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">{agent.total} לידים</span>
                          <span className="text-xs font-bold text-green-600">{agent.active} פעילים</span>
                        </div>
                        <span className="font-medium text-slate-800 text-sm truncate mr-1">
                          {agent.name}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div
                          className="h-1.5 bg-slate-500 rounded-full"
                          style={{ width: `${maxActive > 0 ? (agent.active / maxActive) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                    <div
                      className={`w-6 h-6 flex-shrink-0 flex items-center justify-center font-bold text-sm ${
                        i < 3 ? rankColors[i] : 'text-slate-300'
                      }`}
                    >
                      {i + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* In-Progress Clients */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="bg-orange-100 text-orange-700 text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <TrendingUp size={14} />
            {onboarding.length}
          </span>
          <h3 className="font-semibold text-slate-700">לקוחות בתהליך</h3>
        </div>
        {onboarding.length === 0 ? (
          <div className="text-center text-slate-300 text-sm py-6">אין לקוחות בתהליך בטווח זמן זה</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {onboarding.map(lead => {
              const completedSols = lead.solutions.filter(s => s.delivered).length;
              const totalSols = lead.solutions.length;
              const progress = totalSols > 0 ? Math.round((completedSols / totalSols) * 100) : 0;
              return (
                <div
                  key={lead.id}
                  onClick={() => onLeadClick(lead)}
                  className="border border-orange-100 bg-orange-50 rounded-xl p-3 cursor-pointer hover:bg-orange-100 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
                    <span className="font-semibold text-slate-800 text-xs truncate">{lead.company}</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{lead.contactName}</p>
                  <div className="h-1 bg-orange-100 rounded-full mb-1">
                    <div
                      className="h-1 bg-orange-500 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-orange-600 font-medium">{progress}% הושלם</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hot Leads */}
      {hotLeads.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="bg-red-100 text-red-700 text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Flame size={14} />
              {hotLeads.length}
            </span>
            <h3 className="font-semibold text-slate-700">לידים VIP (תקציב ₪15K+)</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {hotLeads.map(lead => (
              <div
                key={lead.id}
                onClick={() => onLeadClick(lead)}
                className="border border-red-100 bg-gradient-to-b from-red-50 to-white rounded-xl p-3 cursor-pointer hover:shadow-md transition-all"
              >
                <div className="font-semibold text-slate-800 text-sm truncate text-right mb-1">
                  {lead.company}
                </div>
                <div className="text-xs text-slate-500 text-right mb-2">{lead.contactName}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{lead.source}</span>
                  <span className="text-sm font-bold text-emerald-600">₪{(lead.budget ?? 0).toLocaleString()} 🌟</span>
                </div>
                {lead.aiScore > 0 && (
                  <div className="mt-2 h-1 bg-slate-100 rounded-full">
                    <div
                      className="h-1 bg-gradient-to-r from-slate-500 to-orange-400 rounded-full"
                      style={{ width: `${lead.aiScore}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
