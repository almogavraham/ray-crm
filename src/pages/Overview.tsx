import { useState, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import {
  Download, FileText, TrendingUp, TrendingDown, Users, DollarSign,
  Target, Award, Activity, Brain, Flame, Calendar,
  ChevronDown, ArrowUpRight, ArrowDownRight, Star, Zap,
  BarChart2, PieChartIcon, TableIcon, Sparkles,
} from 'lucide-react';
import type { Lead, LeadStatus } from '../types';

/* ─── constants ───────────────────────────────────────────────────────────── */
const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש':         '#6366f1',
  'בתהליך':     '#f97316',
  'לקוח פעיל':  '#22c55e',
  'רימרקטינג':  '#f59e0b',
  'לא רלוונטי': '#94a3b8',
};
const ALL_SOURCES = ['אורגני','פרסום ממומן','הפניה','אינסטגרם','פייסבוק','גוגל'];
const HEB_MONTHS  = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];

type TimeRange = '7'|'30'|'90'|'all';
type ReportTab = 'overview'|'leads'|'revenue'|'team';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
function parseDateStr(s: string): Date {
  if (!s) return new Date(0);
  const p = s.split('/');
  if (p.length === 3) return new Date(`${p[2]}-${p[1]}-${p[0]}T00:00:00`);
  const d = new Date(s); return isNaN(d.getTime()) ? new Date(0) : d;
}

function daysSince(s: string): number {
  const diff = Date.now() - parseDateStr(s).getTime();
  return Math.floor(diff / 86400000);
}

function fmtMoney(n: number): string {
  if (n >= 1000000) return `₪${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `₪${(n/1000).toFixed(0)}K`;
  return `₪${n}`;
}

/* ─── CSV export ──────────────────────────────────────────────────────────── */
function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const BOM   = '﻿';
  const lines = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','));
  const blob  = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url   = URL.createObjectURL(blob);
  const a     = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}

function exportLeads(leads: Lead[]) {
  exportCSV('leads_report.csv', leads.map(l => [
    l.company, l.contactName, l.email, l.phone, l.status, l.source,
    String(l.budget ?? 0), String(l.aiScore), String(l.solutions.length),
    String(l.tasks.filter(t=>!t.completed).length), l.assignedTo, l.lastUpdate,
    l.waitingContent ? 'כן' : 'לא',
  ]), ['חברה','איש קשר','אימייל','טלפון','סטטוס','מקור','תקציב','ציון AI','שירותים','משימות פתוחות','אחראי','עדכון אחרון','ממתין לתוכן']);
}

function exportRevenue(leads: Lead[]) {
  const byStatus = Object.entries(STATUS_COLORS).map(([s]) => {
    const g = leads.filter(l=>l.status===s);
    return [s, String(g.length), fmtMoney(g.reduce((a,l)=>a+(l.budget??0),0))];
  });
  exportCSV('revenue_report.csv', byStatus, ['סטטוס','מספר לידים','סה"כ תקציב']);
}

function exportTeam(leads: Lead[]) {
  const map = new Map<string,{total:number;active:number;rev:number}>();
  leads.forEach(l=>{
    if(!l.assignedTo) return;
    const e = map.get(l.assignedTo)??{total:0,active:0,rev:0};
    e.total++; if(l.status==='לקוח פעיל'){e.active++;e.rev+=(l.budget??0);}
    map.set(l.assignedTo,e);
  });
  exportCSV('team_report.csv',
    [...map.entries()].map(([n,d])=>[n,String(d.total),String(d.active),
      d.total>0?`${Math.round((d.active/d.total)*100)}%`:'0%', fmtMoney(d.rev)]),
    ['שם','סה"כ לידים','לקוחות פעילים','המרה','הכנסה חודשית']);
}

/* ─── sub-components ──────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, trend, color, icon: Icon }: {
  label: string; value: string|number; sub?: string;
  trend?: { value: number; label: string }; color: string; icon: React.ElementType;
}) {
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: color+'15' }}>
          <Icon size={18} style={{ color }} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
            up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
          }`}>
            {up ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-black text-slate-900 mb-0.5">{value}</p>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      {trend && <p className="text-xs text-slate-400 mt-1">{trend.label}</p>}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, fontSize:12, boxShadow:'0 8px 24px rgba(0,0,0,0.08)' },
  cursor: { fill: 'rgba(99,102,241,0.04)' },
};

/* ═══════════════════════════════════════════════════════════════════════════ */
interface OverviewProps { leads: Lead[]; onLeadClick: (lead: Lead) => void; }

export default function Overview({ leads, onLeadClick }: OverviewProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [tab,       setTab]       = useState<ReportTab>('overview');
  const [sortCol,   setSortCol]   = useState<'company'|'budget'|'aiScore'|'status'|'lastUpdate'>('aiScore');
  const [sortDir,   setSortDir]   = useState<'asc'|'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');

  /* filtered leads */
  const filtered = useMemo(() => {
    let arr = leads;
    if (timeRange !== 'all') {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(timeRange));
      arr = arr.filter(l => parseDateStr(l.lastUpdate) >= cutoff);
    }
    return arr;
  }, [leads, timeRange]);

  /* KPI metrics */
  const kpi = useMemo(() => {
    const active    = filtered.filter(l=>l.status==='לקוח פעיל');
    const pipeline  = filtered.filter(l=>['חדש','בתהליך','רימרקטינג'].includes(l.status));
    const revenue   = active.reduce((s,l)=>s+(l.budget??0),0);
    const pipeVal   = pipeline.reduce((s,l)=>s+(l.budget??0),0);
    const avgScore  = filtered.length ? Math.round(filtered.reduce((s,l)=>s+l.aiScore,0)/filtered.length) : 0;
    const conv      = filtered.length ? Math.round((active.length/filtered.length)*100) : 0;
    const avgDeal   = active.length ? Math.round(revenue/active.length) : 0;
    const stale     = filtered.filter(l=>['חדש','בתהליך'].includes(l.status) && daysSince(l.lastUpdate)>=14).length;
    return { active, pipeline, revenue, pipeVal, avgScore, conv, avgDeal, stale };
  }, [filtered]);

  /* monthly trend (6 months) */
  const monthlyTrend = useMemo(() => {
    return Array.from({length:6},(_,i) => {
      const d = new Date(); d.setMonth(d.getMonth()-5+i);
      const mon = d.getMonth(), yr = d.getFullYear();
      const inMon = leads.filter(l=>{
        const p = parseDateStr(l.lastUpdate);
        return p.getMonth()===mon && p.getFullYear()===yr;
      });
      return {
        name: HEB_MONTHS[mon],
        'לידים':   inMon.length,
        'לקוחות':  inMon.filter(l=>l.status==='לקוח פעיל').length,
        'הכנסות':  Math.round(inMon.filter(l=>l.status==='לקוח פעיל').reduce((s,l)=>s+(l.budget??0),0)/1000),
      };
    });
  }, [leads]);

  /* source stats */
  const sourceStats = useMemo(() =>
    ALL_SOURCES.map(src => {
      const g = filtered.filter(l=>l.source===src);
      const active = g.filter(l=>l.status==='לקוח פעיל');
      const rev = active.reduce((s,l)=>s+(l.budget??0),0);
      const conv = g.length ? Math.round((active.length/g.length)*100) : 0;
      return { src, total:g.length, active:active.length, rev, conv };
    }).filter(d=>d.total>0).sort((a,b)=>b.total-a.total)
  , [filtered]);

  /* status distribution */
  const statusData = useMemo(() =>
    (Object.keys(STATUS_COLORS) as LeadStatus[]).map(s => ({
      name:s, value:filtered.filter(l=>l.status===s).length, color:STATUS_COLORS[s],
    })).filter(d=>d.value>0)
  , [filtered]);

  /* funnel */
  const funnel = useMemo(() => {
    const stages: LeadStatus[] = ['חדש','בתהליך','לקוח פעיל'];
    return stages.map(s => ({ name:s, value:filtered.filter(l=>l.status===s).length, color:STATUS_COLORS[s] }));
  }, [filtered]);

  /* agent leaderboard */
  const teamStats = useMemo(() => {
    const map = new Map<string,{total:number;active:number;rev:number;avgScore:number;scores:number[]}>();
    filtered.forEach(l => {
      if (!l.assignedTo) return;
      const e = map.get(l.assignedTo) ?? {total:0,active:0,rev:0,avgScore:0,scores:[]};
      e.total++; e.scores.push(l.aiScore);
      if (l.status==='לקוח פעיל'){e.active++;e.rev+=(l.budget??0);}
      map.set(l.assignedTo,e);
    });
    return [...map.entries()].map(([name,d])=>({
      name, ...d,
      conv: d.total ? Math.round((d.active/d.total)*100) : 0,
      avgScore: d.scores.length ? Math.round(d.scores.reduce((a,b)=>a+b,0)/d.scores.length) : 0,
    })).sort((a,b)=>b.active-a.active);
  }, [filtered]);

  /* smart insights */
  const insights = useMemo(() => {
    const list: {icon:string; text:string; color:string}[] = [];
    const bestSrc = sourceStats[0];
    if (bestSrc) list.push({ icon:'🏆', color:'text-amber-600', text:`המקור הטוב ביותר הוא "${bestSrc.src}" עם ${bestSrc.total} לידים ו-${bestSrc.conv}% המרה` });
    if (kpi.stale>0) list.push({ icon:'⚠️', color:'text-red-500', text:`${kpi.stale} לידים לא עודכנו ב-14+ ימים — זקוקים לטיפול` });
    const hot = filtered.filter(l=>l.aiScore>=80 && l.status==='חדש');
    if (hot.length>0) list.push({ icon:'🔥', color:'text-orange-500', text:`${hot.length} לידים חמים (ציון 80+) ממתינים לטיפול ראשוני` });
    if (kpi.conv>=30) list.push({ icon:'✅', color:'text-emerald-600', text:`יחס המרה של ${kpi.conv}% — מעל הממוצע בתעשייה (20%)` });
    else if (kpi.conv>0) list.push({ icon:'📈', color:'text-blue-500', text:`יחס המרה ${kpi.conv}% — יש פוטנציאל לשיפור, הממוצע בתעשייה 20%` });
    const waiting = filtered.filter(l=>l.waitingContent);
    if (waiting.length>0) list.push({ icon:'⏳', color:'text-slate-500', text:`${waiting.length} לידים ממתינים לתוכן מהלקוח` });
    if (kpi.avgDeal>0) list.push({ icon:'💰', color:'text-violet-600', text:`ערך לקוח פעיל ממוצע: ${fmtMoney(kpi.avgDeal)}/חודש` });
    return list;
  }, [filtered, sourceStats, kpi]);

  /* sorted leads table */
  const sortedLeads = useMemo(() => {
    let arr = statusFilter==='הכל' ? filtered : filtered.filter(l=>l.status===statusFilter);
    return [...arr].sort((a,b) => {
      const dir = sortDir==='asc' ? 1 : -1;
      if (sortCol==='budget')     return dir*((a.budget??0)-(b.budget??0));
      if (sortCol==='aiScore')    return dir*(a.aiScore-b.aiScore);
      if (sortCol==='lastUpdate') return dir*parseDateStr(a.lastUpdate).getTime()-parseDateStr(b.lastUpdate).getTime()*dir;
      return dir*a[sortCol].localeCompare(b[sortCol]);
    });
  }, [filtered, sortCol, sortDir, statusFilter]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: typeof sortCol }) =>
    sortCol===col ? <ChevronDown size={12} className={`inline ml-1 ${sortDir==='asc'?'rotate-180':''} transition-transform`}/> : null;

  /* ─── render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <BarChart2 size={20} className="text-indigo-500" /> דוחות ואנליטיקה
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{filtered.length} לידים בטווח הנבחר</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time range */}
          <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {(['7','30','90','all'] as TimeRange[]).map(k => (
              <button key={k} onClick={()=>setTimeRange(k)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  timeRange===k ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}>
                {k==='7'?'שבוע':k==='30'?'חודש':k==='90'?'רבעון':'הכל'}
              </button>
            ))}
          </div>

          {/* Export buttons */}
          <div className="flex gap-1.5">
            <button onClick={()=>exportLeads(filtered)}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm">
              <Download size={12}/> לידים CSV
            </button>
            <button onClick={()=>exportRevenue(filtered)}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm">
              <FileText size={12}/> מכירות CSV
            </button>
            <button onClick={()=>exportTeam(filtered)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm">
              <Download size={12}/> צוות CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1 w-fit">
        {([
          { key:'overview', label:'סקירה כללית',  icon: PieChartIcon },
          { key:'leads',    label:'טבלת לידים',   icon: TableIcon },
          { key:'revenue',  label:'מכירות',        icon: TrendingUp },
          { key:'team',     label:'ביצועי צוות',  icon: Users },
        ] as {key:ReportTab;label:string;icon:React.ElementType}[]).map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              tab===t.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB: OVERVIEW ══════════════════════════════════════════════════════ */}
      {tab==='overview' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon={Users}     label="סה״כ לידים"       value={filtered.length}              color="#6366f1" sub={`${kpi.conv}% המרה לפעיל`}/>
            <KpiCard icon={Target}    label="לקוחות פעילים"    value={kpi.active.length}             color="#22c55e" sub={`ממוצע ${fmtMoney(kpi.avgDeal)}/חודש`}/>
            <KpiCard icon={DollarSign} label="הכנסה חודשית"   value={fmtMoney(kpi.revenue)}         color="#10b981" sub={`פייפליין: ${fmtMoney(kpi.pipeVal)}`}/>
            <KpiCard icon={Brain}     label="ציון AI ממוצע"    value={`${kpi.avgScore}%`}            color="#8b5cf6" sub={`${filtered.filter(l=>l.aiScore>=75).length} לידים חמים`}/>
          </div>

          {/* Monthly trend */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"/>לידים</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"/>לקוחות</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-400 inline-block"/>הכנסות (K₪)</span>
              </div>
              <h3 className="font-bold text-slate-800">מגמה חודשית — 6 חודשים</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyTrend} margin={{top:4,right:4,left:-20,bottom:0}}>
                <defs>
                  <linearGradient id="gLead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false} width={24}/>
                <Tooltip {...tooltipStyle}/>
                <Area type="monotone" dataKey="לידים"   stroke="#6366f1" fill="url(#gLead)" strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="לקוחות"  stroke="#22c55e" fill="url(#gAct)"  strokeWidth={2} dot={false}/>
                <Line  type="monotone" dataKey="הכנסות"  stroke="#8b5cf6" strokeWidth={2} dot={{fill:'#8b5cf6',r:3}} strokeDasharray="5 3"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Status dist + Funnel + Source */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Status donut */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 text-right">התפלגות סטטוס</h3>
              <div className="flex items-center gap-3">
                <div className="space-y-2 flex-1">
                  {statusData.map(d=>(
                    <div key={d.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-bold" style={{color:d.color}}>{d.value}</span>
                        <span className="text-slate-500">{d.name}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{width:`${filtered.length?(d.value/filtered.length)*100:0}%`,backgroundColor:d.color}}/>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="w-24 h-24 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" cx="50%" cy="50%" outerRadius={46} innerRadius={26} paddingAngle={2}>
                        {statusData.map((d,i)=><Cell key={i} fill={d.color} stroke="none"/>)}
                      </Pie>
                      <Tooltip contentStyle={{borderRadius:8,border:'none',fontSize:11,boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}} cursor={false}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Funnel */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 text-right">משפך מכירות</h3>
              <div className="flex items-end gap-2 h-28">
                {funnel.map((s,i)=>{
                  const max = Math.max(...funnel.map(f=>f.value),1);
                  const pct = (s.value/max)*100;
                  const conv = i>0 && funnel[i-1].value>0 ? Math.round((s.value/funnel[i-1].value)*100) : null;
                  return (
                    <div key={s.name} className="flex-1 flex flex-col items-center gap-1">
                      {conv!==null && <span className="text-[10px] text-slate-400 mb-1">↓{conv}%</span>}
                      <div className="w-full flex items-end" style={{height:80}}>
                        <div className="w-full rounded-t-xl transition-all duration-500"
                          style={{height:`${Math.max(pct,8)}%`,backgroundColor:s.color,opacity:0.85}}/>
                      </div>
                      <span className="text-base font-black text-slate-800">{s.value}</span>
                      <span className="text-[10px] text-slate-500 text-center">{s.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Source bar */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4 text-right">לידים לפי מקור</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={sourceStats.slice(0,5)} layout="vertical" margin={{right:0,left:0}}>
                  <XAxis type="number" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="src" tick={{fontSize:10,fill:'#64748b'}} width={70} axisLine={false} tickLine={false}/>
                  <Tooltip {...tooltipStyle} formatter={(v:number)=>[v,'לידים']}/>
                  <Bar dataKey="total" fill="#6366f1" radius={[0,6,6,0]} maxBarSize={16}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Smart Insights */}
          <div className="bg-gradient-to-bl from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100 p-5">
            <div className="flex items-center gap-2 mb-4 justify-end">
              <h3 className="font-bold text-slate-800">תובנות חכמות</h3>
              <Sparkles size={15} className="text-indigo-500"/>
            </div>
            {insights.length===0 ? (
              <p className="text-slate-400 text-sm text-right">אין מספיק נתונים לתובנות</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.map((ins,i)=>(
                  <div key={i} className="flex items-start gap-2.5 bg-white/70 rounded-xl px-4 py-3 text-right">
                    <span className="text-lg flex-shrink-0">{ins.icon}</span>
                    <p className={`text-sm font-medium ${ins.color}`}>{ins.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ TAB: LEADS TABLE ═══════════════════════════════════════════════════ */}
      {tab==='leads' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Table toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <button onClick={()=>exportLeads(sortedLeads)}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                <Download size={12}/> ייצא CSV ({sortedLeads.length})
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-xs text-slate-400">{sortedLeads.length} לידים</span>
              {(['הכל',...Object.keys(STATUS_COLORS)] as string[]).map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    statusFilter===s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>{s}</button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-right">
                  {([
                    {col:'company',   label:'חברה'},
                    {col:'status',    label:'סטטוס'},
                    {col:'budget',    label:'תקציב'},
                    {col:'aiScore',   label:'ציון AI'},
                    {col:'lastUpdate',label:'עדכון אחרון'},
                  ] as {col:typeof sortCol;label:string}[]).map(h=>(
                    <th key={h.col}
                      onClick={()=>toggleSort(h.col)}
                      className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none whitespace-nowrap">
                      {h.label}<SortIcon col={h.col}/>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">מקור</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">אחראי</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">ימים ללא מגע</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead,i)=>{
                  const stale = daysSince(lead.lastUpdate);
                  const scoreColor = lead.aiScore>=75?'text-emerald-600 bg-emerald-50':lead.aiScore>=50?'text-amber-600 bg-amber-50':'text-slate-500 bg-slate-100';
                  return (
                    <tr key={lead.id}
                      onClick={()=>onLeadClick(lead)}
                      className={`border-b border-slate-50 hover:bg-indigo-50/40 cursor-pointer transition-colors ${i%2===0?'bg-white':'bg-slate-50/30'}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{lead.company}</div>
                        <div className="text-xs text-slate-400">{lead.contactName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{color:STATUS_COLORS[lead.status as LeadStatus],backgroundColor:STATUS_COLORS[lead.status as LeadStatus]+'18'}}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800">{fmtMoney(lead.budget??0)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreColor}`}>{lead.aiScore}%</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{lead.lastUpdate}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{lead.source}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{lead.assignedTo||'—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold ${stale>=14?'text-red-500':stale>=7?'text-amber-500':'text-emerald-500'}`}>
                          {stale} ימים
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sortedLeads.length===0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">אין לידים בסינון זה</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ TAB: REVENUE ═══════════════════════════════════════════════════════ */}
      {tab==='revenue' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon={DollarSign} label="הכנסה חודשית"    value={fmtMoney(kpi.revenue)}     color="#22c55e" sub={`${kpi.active.length} לקוחות פעילים`}/>
            <KpiCard icon={TrendingUp} label="פייפליין פוטנציאל" value={fmtMoney(kpi.pipeVal)} color="#6366f1" sub={`${kpi.pipeline.length} לידים בפייפליין`}/>
            <KpiCard icon={Star}       label="ערך לקוח ממוצע"  value={fmtMoney(kpi.avgDeal)}     color="#f59e0b" sub="הכנסה חודשית ממוצעת"/>
            <KpiCard icon={Zap}        label="שיעור המרה"       value={`${kpi.conv}%`}            color="#8b5cf6" sub="לידים → לקוח פעיל"/>
          </div>

          {/* Revenue by source */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <button onClick={()=>exportRevenue(filtered)}
                className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold">
                <Download size={11}/> CSV
              </button>
              <h3 className="font-bold text-slate-800">ביצועי מכירות לפי מקור</h3>
            </div>
            <div className="space-y-3">
              {sourceStats.map(s=>{
                const maxRev = Math.max(...sourceStats.map(x=>x.rev),1);
                return (
                  <div key={s.src} className="flex items-center gap-4">
                    <div className="text-left w-12">
                      <span className="text-xs font-bold text-indigo-600">{s.conv}%</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-400">{s.total} לידים · {s.active} פעילים · {fmtMoney(s.rev)}/חודש</span>
                        <span className="font-semibold text-slate-700">{s.src}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-l from-indigo-500 to-violet-500 rounded-full transition-all duration-700"
                          style={{width:`${(s.rev/maxRev)*100}%`}}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Monthly revenue chart */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-5 text-right">מגמת הכנסות חודשית (K₪)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyTrend} margin={{top:4,right:4,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false} width={30}/>
                <Tooltip {...tooltipStyle} formatter={(v:number)=>[`₪${v}K`,'הכנסות']}/>
                <Bar dataKey="הכנסות" radius={[6,6,0,0]} maxBarSize={40}>
                  {monthlyTrend.map((_,i)=>(
                    <Cell key={i} fill={i===monthlyTrend.length-1?'#6366f1':'#e0e7ff'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top revenue leads */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-4 text-right">לקוחות פעילים — לפי ערך</h3>
            <div className="space-y-2">
              {[...kpi.active].sort((a,b)=>(b.budget??0)-(a.budget??0)).slice(0,10).map((lead,i)=>{
                const max = kpi.active[0]?.budget ?? 1;
                return (
                  <div key={lead.id} onClick={()=>onLeadClick(lead)}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0"
                      style={{background:i<3?['#fbbf24','#94a3b8','#f97316'][i]:'#e2e8f0',color:i<3?'white':'#94a3b8'}}>
                      {i+1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-black text-emerald-600">{fmtMoney(lead.budget??0)}/חודש</span>
                        <span className="font-semibold text-slate-800 truncate mr-2">{lead.company}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-l from-emerald-500 to-teal-400 rounded-full"
                          style={{width:`${((lead.budget??0)/max)*100}%`}}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ══ TAB: TEAM ══════════════════════════════════════════════════════════ */}
      {tab==='team' && (
        <>
          <div className="flex justify-end">
            <button onClick={()=>exportTeam(filtered)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm">
              <Download size={12}/> ייצא דוח צוות CSV
            </button>
          </div>

          {teamStats.length===0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400 shadow-sm">
              <Users size={32} className="mx-auto mb-3 opacity-30"/>
              <p>אין נתוני צוות — וודא שלידים משויכים לאחראי</p>
            </div>
          ) : (
            <>
              {/* Team KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard icon={Users}   label="חברי צוות פעילים" value={teamStats.length}                                    color="#6366f1"/>
                <KpiCard icon={Target}  label="סה״כ לקוחות"       value={teamStats.reduce((s,t)=>s+t.active,0)}              color="#22c55e"/>
                <KpiCard icon={Award}   label="המרה ממוצעת"        value={`${teamStats.length?Math.round(teamStats.reduce((s,t)=>s+t.conv,0)/teamStats.length):0}%`} color="#f59e0b"/>
                <KpiCard icon={DollarSign} label="הכנסה כוללת"    value={fmtMoney(teamStats.reduce((s,t)=>s+t.rev,0))}       color="#8b5cf6"/>
              </div>

              {/* Leaderboard */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-5 text-right flex items-center gap-2 justify-end">
                  <Award size={16} className="text-amber-500"/>לידרבורד ביצועים
                </h3>
                <div className="space-y-3">
                  {teamStats.map((agent,i)=>{
                    const maxRev = teamStats[0]?.rev||1;
                    const medals = ['🥇','🥈','🥉'];
                    return (
                      <div key={agent.name} className={`rounded-xl p-4 border transition-all ${
                        i===0?'border-amber-200 bg-amber-50/40':i===1?'border-slate-200 bg-slate-50/40':'border-slate-100 bg-white'
                      }`}>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xl">{medals[i]||`#${i+1}`}</span>
                          <div className="flex-1">
                            <div className="flex justify-between items-center">
                              <div className="flex gap-4 text-xs">
                                <span className="text-emerald-600 font-bold">{fmtMoney(agent.rev)}/חודש</span>
                                <span className="text-indigo-600 font-bold">{agent.conv}% המרה</span>
                                <span className="text-slate-400">ציון AI: {agent.avgScore}%</span>
                              </div>
                              <p className="font-bold text-slate-800">{agent.name}</p>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                          <div className="bg-white rounded-lg p-2 border border-slate-100">
                            <div className="font-black text-slate-800 text-lg">{agent.total}</div>
                            <div className="text-slate-400">סה"כ לידים</div>
                          </div>
                          <div className="bg-white rounded-lg p-2 border border-slate-100">
                            <div className="font-black text-emerald-600 text-lg">{agent.active}</div>
                            <div className="text-slate-400">לקוחות פעילים</div>
                          </div>
                          <div className="bg-white rounded-lg p-2 border border-slate-100">
                            <div className="font-black text-indigo-600 text-lg">{agent.conv}%</div>
                            <div className="text-slate-400">שיעור המרה</div>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-l from-indigo-500 to-violet-500 rounded-full"
                            style={{width:`${(agent.rev/maxRev)*100}%`}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Team performance chart */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-5 text-right">לידים לפי חבר צוות</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={teamStats} margin={{top:0,right:0,left:-20,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                    <XAxis dataKey="name" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} width={24}/>
                    <Tooltip {...tooltipStyle}/>
                    <Legend iconType="circle" iconSize={7}
                      formatter={v=><span style={{fontSize:11,color:'#64748b'}}>{v}</span>}/>
                    <Bar dataKey="total"  name="סה״כ לידים"    fill="#e0e7ff" radius={[4,4,0,0]} maxBarSize={32}/>
                    <Bar dataKey="active" name="לקוחות פעילים" fill="#6366f1" radius={[4,4,0,0]} maxBarSize={32}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
