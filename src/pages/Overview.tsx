import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { Flame, CheckCircle2, Rocket, Users, TrendingUp, DollarSign } from 'lucide-react';
import type { Lead, LeadStatus } from '../types';
import { BANKS } from '../data/mockData';

const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש': '#3b82f6',
  'הקמת כספת בבנק': '#a855f7',
  'הטמעה': '#f97316',
  'לקוח פעיל': '#22c55e',
  'רימרקטינג': '#f59e0b',
  'לא רלוונטי': '#94a3b8',
};

const PIPELINE_ORDER: LeadStatus[] = ['חדש', 'הקמת כספת בבנק', 'הטמעה', 'לקוח פעיל'];

interface OverviewProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
}

export default function Overview({ leads, onLeadClick }: OverviewProps) {
  const hotLeads = leads.filter(l => l.checkCount >= 100);
  const activeClients = leads.filter(l => l.status === 'לקוח פעיל');
  const onboarding = leads.filter(l => l.status === 'הטמעה');
  const totalChecks = leads.reduce((sum, l) => sum + l.checkCount, 0);
  const estimatedRevenue = Math.round(totalChecks * 1.5);

  const statusData = (Object.keys(STATUS_COLORS) as LeadStatus[]).map(s => ({
    name: s, value: leads.filter(l => l.status === s).length, color: STATUS_COLORS[s],
  })).filter(d => d.value > 0);

  const bankData = BANKS.map(bank => ({
    name: bank, count: leads.filter(l => l.banks.includes(bank)).length,
  })).filter(d => d.count > 0).sort((a, b) => b.count - a.count);

  const funnelData = PIPELINE_ORDER.map(s => ({
    name: s,
    value: leads.filter(l => l.status === s).length,
    fill: STATUS_COLORS[s],
  }));

  const conversionRate = leads.length > 0
    ? Math.round((activeClients.length / leads.length) * 100) : 0;

  const avgScore = leads.length > 0
    ? Math.round(leads.reduce((s, l) => s + l.aiScore, 0) / leads.length) : 0;

  return (
    <div className="space-y-5">
      {/* Top KPI row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'לידים חמים', value: hotLeads.length, sub: '+100 צ\'קים', icon: <Flame className="text-red-500" size={20} />, color: 'text-red-600', bar: 'bg-red-400', pct: Math.round(hotLeads.length / Math.max(leads.length, 1) * 100) },
          { label: 'בהטמעה', value: onboarding.length, sub: 'בתהליך הטמעה', icon: <Rocket className="text-orange-500" size={20} />, color: 'text-orange-600', bar: 'bg-orange-400', pct: Math.round(onboarding.length / Math.max(leads.length, 1) * 100) },
          { label: 'לקוחות פעילים', value: activeClients.length, sub: `${conversionRate}% המרה`, icon: <CheckCircle2 className="text-green-500" size={20} />, color: 'text-green-600', bar: 'bg-green-400', pct: conversionRate },
          { label: 'סה"כ לידים', value: leads.length, sub: `ציון AI ממוצע ${avgScore}%`, icon: <Users className="text-indigo-500" size={20} />, color: 'text-indigo-600', bar: 'bg-indigo-400', pct: 100 },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="p-2 bg-slate-50 rounded-lg">{s.icon}</div>
            </div>
            <div className="text-sm font-medium text-slate-700 text-right">{s.label}</div>
            <div className="text-xs text-slate-400 text-right mt-0.5">{s.sub}</div>
            <div className="mt-3 h-1 bg-slate-100 rounded-full">
              <div className={`h-1 rounded-full ${s.bar}`} style={{ width: `${Math.min(s.pct, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Revenue + Funnel row */}
      <div className="grid grid-cols-3 gap-5">
        {/* Estimated Revenue */}
        <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 rounded-xl p-5 shadow-sm text-white">
          <div className="flex items-center justify-between mb-4">
            <DollarSign size={20} className="text-indigo-300" />
            <span className="text-indigo-200 text-sm font-medium">הכנסה חודשית משוערת</span>
          </div>
          <div className="text-4xl font-bold mb-1">₪{estimatedRevenue.toLocaleString()}</div>
          <div className="text-indigo-300 text-sm">על בסיס {totalChecks.toLocaleString()} צ'קים × ₪1.5</div>
          <div className="mt-4 pt-4 border-t border-indigo-600 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xl font-bold">{totalChecks.toLocaleString()}</div>
              <div className="text-indigo-300 text-xs">צ'קים בחודש</div>
            </div>
            <div>
              <div className="text-xl font-bold">{avgScore}%</div>
              <div className="text-indigo-300 text-xs">ציון AI ממוצע</div>
            </div>
          </div>
        </div>

        {/* Pipeline Funnel */}
        <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <TrendingUp size={16} className="text-indigo-500" />
            <h3 className="font-semibold text-slate-700">פאנל מכירות — קונברזן</h3>
          </div>
          <div className="flex items-end gap-3 h-32">
            {funnelData.map((stage, i) => {
              const maxVal = Math.max(...funnelData.map(d => d.value), 1);
              const pct = (stage.value / maxVal) * 100;
              const conv = i > 0 && funnelData[i - 1].value > 0
                ? Math.round((stage.value / funnelData[i - 1].value) * 100) : null;
              return (
                <div key={stage.name} className="flex-1 flex flex-col items-center gap-1">
                  {conv !== null && (
                    <div className="text-xs text-slate-400 mb-1">↓ {conv}%</div>
                  )}
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div
                      className="w-full rounded-t-lg transition-all duration-500"
                      style={{ height: `${Math.max(pct, 8)}%`, backgroundColor: stage.fill, opacity: 0.85 }}
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
      <div className="grid grid-cols-2 gap-5">
        {/* Leads by Bank */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-4 text-right">לידים לפי בנק</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bankData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={60} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} maxBarSize={20} />
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
                    <span className="font-bold" style={{ color: d.color }}>{d.value}</span>
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <span className="text-xs">{d.name}</span>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                    </div>
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full">
                    <div className="h-1 rounded-full" style={{ backgroundColor: d.color, width: `${(d.value / leads.length) * 100}%`, opacity: 0.7 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="w-28 h-28 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" cx="50%" cy="50%" outerRadius={52} innerRadius={28} paddingAngle={2}>
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Clients */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="bg-orange-100 text-orange-700 text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <TrendingUp size={14} />{onboarding.length}
          </span>
          <h3 className="font-semibold text-slate-700">לקוחות בהטמעה</h3>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {onboarding.map(lead => {
            const completedSols = lead.solutions.filter(s => s.hasInstallation && s.hasTraining).length;
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
                  <div className="h-1 bg-orange-500 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-orange-600 font-medium">{progress}% הושלם</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hot Leads */}
      {hotLeads.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="bg-red-100 text-red-700 text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
              <Flame size={14} />{hotLeads.length}
            </span>
            <h3 className="font-semibold text-slate-700">לידים חמים (+100 צ'קים)</h3>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {hotLeads.map(lead => (
              <div
                key={lead.id}
                onClick={() => onLeadClick(lead)}
                className="border border-red-100 bg-gradient-to-b from-red-50 to-white rounded-xl p-3 cursor-pointer hover:shadow-md transition-all"
              >
                <div className="font-semibold text-slate-800 text-sm truncate text-right mb-1">{lead.company}</div>
                <div className="text-xs text-slate-500 text-right mb-2">{lead.contactName}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{lead.source}</span>
                  <span className="text-sm font-bold text-red-600">{lead.checkCount} 🔥</span>
                </div>
                {lead.aiScore > 0 && (
                  <div className="mt-2 h-1 bg-slate-100 rounded-full">
                    <div className="h-1 bg-gradient-to-r from-indigo-400 to-orange-400 rounded-full" style={{ width: `${lead.aiScore}%` }} />
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
