import { useState, useMemo } from 'react';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import {
  Download, FileText, TrendingUp, TrendingDown, Users, DollarSign,
  Target, Award, Activity, Brain, Flame, Calendar,
  ChevronDown, ArrowUpRight, ArrowDownRight, Star, Zap,
  BarChart2, PieChartIcon, TableIcon, Sparkles, Loader2, Copy,
} from 'lucide-react';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { getAnthropicProxy } from '../lib/anthropicClient';
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
type ReportTab = 'overview'|'leads'|'revenue'|'team'|'sources';

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
  const { c } = useTheme();
  const up = (trend?.value ?? 0) >= 0;
  return (
    <div
      className="rounded-2xl p-5 transition-all"
      style={{
        background: `linear-gradient(135deg,${color}10,${color}06)`,
        border: `1px solid ${color}28`,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: color+'15' }}>
          <Icon size={18} style={{ color }} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
            up
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {up ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-black mb-0.5" style={{ color: c.textPrimary }}>{value}</p>
      <p className="text-sm font-medium" style={{ color: c.textSecondary }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>{sub}</p>}
      {trend && <p className="text-xs mt-1" style={{ color: c.textMuted }}>{trend.label}</p>}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'white', fontSize:12 },
  labelStyle: { color:'rgba(255,255,255,0.6)' },
  cursor: { fill: 'rgba(99,102,241,0.06)' },
};

/* ─── SOURCE COLORS ────────────────────────────────────────────────────────── */
const SOURCE_COLORS: Record<string, string> = {
  'אורגני':      '#22c55e',
  'פרסום ממומן': '#6366f1',
  'הפניה':       '#8b5cf6',
  'אינסטגרם':   '#ec4899',
  'פייסבוק':    '#3b82f6',
  'גוגל':        '#f59e0b',
};
const SOURCE_EMOJI: Record<string, string> = {
  'אורגני':'🌱','פרסום ממומן':'💰','הפניה':'🤝','אינסטגרם':'📸','פייסבוק':'👤','גוגל':'🔍',
};
function getSrcColor(src: string) { return SOURCE_COLORS[src] ?? '#94a3b8'; }
function getSrcEmoji(src: string) { return SOURCE_EMOJI[src]  ?? '📊'; }

/* ─── SOURCES ANALYSIS COMPONENT ───────────────────────────────────────────── */
function SourcesAnalysis({ leads, workspaceId }: { leads: Lead[]; workspaceId?: string }) {
  const { c } = useTheme();
  const [loading,  setLoading]  = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [budget,   setBudget]   = useState('10000');
  const [copied,   setCopied]   = useState(false);

  /* dynamic stats — all sources found in leads, not a hardcoded list */
  const stats = useMemo(() => {
    const map = new Map<string, { total: number; active: number; rev: number; scores: number[] }>();
    leads.forEach(l => {
      if (!l.source) return;
      const e = map.get(l.source) ?? { total: 0, active: 0, rev: 0, scores: [] };
      e.total++; e.scores.push(l.aiScore);
      if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
      map.set(l.source, e);
    });
    return [...map.entries()].map(([src, d]) => ({
      src,
      total:    d.total,
      active:   d.active,
      rev:      d.rev,
      conv:     d.total > 0 ? Math.round((d.active / d.total) * 100) : 0,
      avgScore: d.scores.length > 0 ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
    })).sort((a, b) => b.rev - a.rev);
  }, [leads]);

  const best    = stats[0];
  const maxRev  = Math.max(...stats.map(d => d.rev),   1);

  const exportSources = () => exportCSV('sources_report.csv',
    stats.map(s => [s.src, String(s.total), String(s.active), `${s.conv}%`, `₪${s.rev.toLocaleString()}`, `${s.avgScore}%`]),
    ['מקור','לידים','לקוחות פעילים','המרה','הכנסה/חודש','ציון AI ממוצע'],
  );

  const analyze = async () => {
    if (workspaceId) {
      const ok = await hasBalance(workspaceId);
      if (!ok) return;
    }
    setLoading(true); setAnalysis('');
    try {
      const client = getAnthropicProxy();
      const statsText = stats.map(s =>
        `${s.src}: ${s.total} לידים → ${s.active} לקוחות (${s.conv}% המרה) → ₪${s.rev.toLocaleString()}/חודש, ציון AI ממוצע ${s.avgScore}%`
      ).join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 1200,
        messages: [{ role: 'user', content:
`אתה יועץ מרקטינג ישראלי בכיר. נתח את ביצועי המקורות ותן המלצות מבוססות נתונים.

**נתוני מקורות לידים:**
${statsText}

**תקציב חודשי זמין:** ₪${Number(budget).toLocaleString()}

ספק ניתוח מקצועי:

## 🏆 המקור המנצח
[מה הכי משתלם ולמה — בנתונים]

## 💰 הקצאת תקציב מומלצת
[פירוט מדויק לכל ערוץ + אחוז מהתקציב]

## 🚀 3 פעולות מיידיות
1.
2.
3.

## ⚠️ מה להפסיק
[ערוץ עם ביצועים נמוכים]

## 📈 תחזית לחודש הבא
[לידים, לקוחות והכנסה צפויים]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setAnalysis(text);
      const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
      if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Source ROI analysis');
    } catch { /* silent */ } finally { setLoading(false); }
  };

  if (stats.length === 0) return (
    <div className="rounded-2xl p-16 text-center" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
      <BarChart2 size={44} className="mx-auto mb-3" style={{ color: c.textMuted }}/>
      <p style={{ color: c.textMuted }} className="font-medium">אין נתוני מקורות — הוסף מקור ללידים</p>
    </div>
  );

  const avgConv = Math.round(stats.reduce((s, d) => s + d.conv, 0) / stats.length);

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <button onClick={exportSources}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
          <Download size={12}/> ייצוא CSV
        </button>
        <h2 className="font-black flex items-center gap-2" style={{ color: c.textPrimary }}>
          <BarChart2 size={18} style={{ color: c.accentText }}/> ניתוח מקורות לידים
        </h2>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={BarChart2}   label="מקורות פעילים"  value={stats.length}            color="#6366f1"/>
        <KpiCard icon={Target}      label="מקור מוביל"      value={best?.src ?? '—'}        color="#22c55e" sub={`${best?.conv ?? 0}% המרה`}/>
        <KpiCard icon={DollarSign}  label="הכנסה מובילה"   value={fmtMoney(best?.rev ?? 0)} color="#10b981" sub={best?.src}/>
        <KpiCard icon={Activity}    label="ממוצע המרה"      value={`${avgConv}%`}            color="#8b5cf6"/>
      </div>

      {/* Best source banner */}
      {best && (
        <div className="rounded-2xl p-4 flex items-center gap-4" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', backdropFilter: 'blur(8px)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ backgroundColor: getSrcColor(best.src) + '20' }}>
            {getSrcEmoji(best.src)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#4ade80' }}>🏆 המקור הטוב ביותר</p>
            <p className="text-lg font-black" style={{ color: c.textPrimary }}>{best.src}</p>
            <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>
              {best.total} לידים · {best.active} לקוחות פעילים · {fmtMoney(best.rev)}/חודש
            </p>
          </div>
          <div className="text-center flex-shrink-0">
            <p className="text-3xl font-black" style={{ color: getSrcColor(best.src) }}>{best.conv}%</p>
            <p className="text-xs" style={{ color: c.textMuted }}>המרה</p>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue bars */}
        <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
          <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>הכנסה לפי מקור</h3>
          <div className="space-y-3">
            {stats.map(s => (
              <div key={s.src}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-bold" style={{ color: c.textSecondary }}>{fmtMoney(s.rev)}/חודש</span>
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: c.textSecondary }}>{s.src}</span>
                    <span className="text-lg leading-none">{getSrcEmoji(s.src)}</span>
                  </div>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.max(4, (s.rev / maxRev) * 100)}%`, backgroundColor: getSrcColor(s.src) }}/>
                </div>
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: c.textMuted }}>
                  <span>{s.active} לקוחות · {s.conv}% המרה</span>
                  <span>{s.total} לידים</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Volume Recharts bar */}
        <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
          <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>נפח לידים vs לקוחות</h3>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={stats} margin={{ top: 4, right: 4, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
              <XAxis dataKey="src" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} angle={-30} textAnchor="end" interval={0}/>
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} width={24}/>
              <Tooltip {...tooltipStyle}/>
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ color: c.textSecondary, fontSize: 11 }}/>
              <Bar dataKey="total"  name="לידים"        radius={[4,4,0,0]} maxBarSize={30} fill="#6366f1" opacity={0.4}/>
              <Bar dataKey="active" name="לקוחות פעילים" radius={[4,4,0,0]} maxBarSize={30}>
                {stats.map((s, i) => <Cell key={i} fill={getSrcColor(s.src)}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${c.divider}` }}>
          <span className="text-xs" style={{ color: c.textMuted }}>{stats.length} מקורות</span>
          <h3 className="font-bold" style={{ color: c.textPrimary }}>ביצועים מפורטים לפי מקור</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right" style={{ borderBottom: `1px solid ${c.divider}` }}>
                <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: c.textMuted }}>מקור</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-center" style={{ color: c.textMuted }}>לידים</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-center" style={{ color: c.textMuted }}>לקוחות</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-center" style={{ color: c.textMuted }}>המרה</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-center" style={{ color: c.textMuted }}>ציון AI</th>
                <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-left" style={{ color: c.textMuted }}>הכנסה/חודש</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.src} style={{
                  borderBottom: `1px solid ${c.divider}`,
                  background: i === 0 ? 'rgba(34,197,94,0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {i === 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>🏆</span>}
                      <span className="font-semibold" style={{ color: c.textPrimary }}>{s.src}</span>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getSrcColor(s.src) }}/>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold" style={{ color: c.textSecondary }}>{s.total}</td>
                  <td className="px-4 py-3 text-center font-bold" style={{ color: '#4ade80' }}>{s.active}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={
                      s.conv >= 30
                        ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                        : s.conv >= 15
                          ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                          : { background: c.subtleBg, color: c.textMuted }
                    }>{s.conv}%</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-semibold" style={{
                      color: s.avgScore >= 70 ? '#4ade80' : s.avgScore >= 50 ? '#fbbf24' : 'rgba(255,255,255,0.38)',
                    }}>{s.avgScore}%</span>
                  </td>
                  <td className="px-5 py-3 text-left font-black" style={{ color: c.textPrimary }}>₪{s.rev.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Analysis panel */}
      <div className="rounded-2xl p-5" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2 mb-4 justify-end">
          <h3 className="font-bold" style={{ color: c.textPrimary }}>ניתוח AI + המלצות תקציב</h3>
          <Brain size={16} style={{ color: c.accentText }}/>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>תקציב שיווק חודשי (₪)</label>
              <input type="number" value={budget} onChange={e => setBudget(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
            </div>
            <button onClick={analyze} disabled={loading}
              className="w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }}>
              {loading
                ? <><Loader2 size={14} className="animate-spin"/> מנתח...</>
                : <><Brain size={14}/> נתח ויעץ</>}
            </button>
            <p className="text-[10px] text-center" style={{ color: c.textMuted }}>מנתח את כל מקורות הלידים של סביבת העבודה</p>
          </div>
          <div className="md:col-span-2 rounded-2xl p-4 min-h-[160px]" style={{ background: c.subtleBg, border: '1px solid rgba(99,102,241,0.15)' }}>
            {analysis ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => { navigator.clipboard.writeText(analysis).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}>
                    <Copy size={10}/> {copied ? '✓ הועתק' : 'העתק'}
                  </button>
                  <span className="text-xs flex items-center gap-1" style={{ color: c.accentText }}><Sparkles size={9}/> ניתוח AI</span>
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[400px]" style={{ color: c.textSecondary }}>
                  {analysis}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                <Brain size={36} className="mb-2" style={{ color: 'rgba(99,102,241,0.3)' }}/>
                <p className="text-sm font-medium" style={{ color: c.textMuted }}>הכנס תקציב ולחץ "נתח"</p>
                <p className="text-xs mt-1" style={{ color: c.textMuted }}>AI ימליץ על חלוקת תקציב אופטימלית לכל מקור</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
interface OverviewProps { leads: Lead[]; onLeadClick: (lead: Lead) => void; workspaceId?: string; }

export default function Overview({ leads, onLeadClick, workspaceId }: OverviewProps) {
  const { t, dir } = useLang();
  const { isDark, c } = useTheme();
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
    if (bestSrc) list.push({ icon:'🏆', color:'#fbbf24', text:`המקור הטוב ביותר הוא "${bestSrc.src}" עם ${bestSrc.total} לידים ו-${bestSrc.conv}% המרה` });
    if (kpi.stale>0) list.push({ icon:'⚠️', color:'#f87171', text:`${kpi.stale} לידים לא עודכנו ב-14+ ימים — זקוקים לטיפול` });
    const hot = filtered.filter(l=>l.aiScore>=80 && l.status==='חדש');
    if (hot.length>0) list.push({ icon:'🔥', color:'#fb923c', text:`${hot.length} לידים חמים (ציון 80+) ממתינים לטיפול ראשוני` });
    if (kpi.conv>=30) list.push({ icon:'✅', color:'#4ade80', text:`יחס המרה של ${kpi.conv}% — מעל הממוצע בתעשייה (20%)` });
    else if (kpi.conv>0) list.push({ icon:'📈', color:'#60a5fa', text:`יחס המרה ${kpi.conv}% — יש פוטנציאל לשיפור, הממוצע בתעשייה 20%` });
    const waiting = filtered.filter(l=>l.waitingContent);
    if (waiting.length>0) list.push({ icon:'⏳', color: c.textSecondary, text:`${waiting.length} לידים ממתינים לתוכן מהלקוח` });
    if (kpi.avgDeal>0) list.push({ icon:'💰', color:'#c084fc', text:`ערך לקוח פעיל ממוצע: ${fmtMoney(kpi.avgDeal)}/חודש` });
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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}
      >
        <div>
          <h1 className="text-lg md:text-xl font-black flex items-center gap-2" style={{ color: c.textPrimary }}>
            <BarChart2 size={20} style={{ color: c.accentText }} /> {t('overview.reportTitle')}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: c.textMuted }}>{filtered.length} {t('overview.leadsInRange')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time range */}
          <div className="flex rounded-xl overflow-hidden" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            {(['7','30','90','all'] as TimeRange[]).map(k => (
              <button key={k} onClick={()=>setTimeRange(k)}
                className="px-3 py-1.5 text-xs font-semibold transition-colors"
                style={timeRange===k
                  ? { background: 'rgba(99,102,241,0.22)', color: c.accentText }
                  : { color: c.textMuted }}>
                {k==='7'?t('overview.week'):k==='30'?t('overview.month'):k==='90'?t('overview.quarter'):t('overview.all')}
              </button>
            ))}
          </div>

          {/* Export buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={()=>exportLeads(filtered)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
              <Download size={12}/> {t('overview.exportLeadsCSV')}
            </button>
            <button onClick={()=>exportRevenue(filtered)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
              <FileText size={12}/> {t('overview.exportRevenueCSV')}
            </button>
            <button onClick={()=>exportTeam(filtered)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }}>
              <Download size={12}/> {t('overview.exportTeamCSV')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto pb-1" dir="ltr">
        <div className="flex gap-1 rounded-2xl p-1 w-fit" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
          {([
            { key:'overview', label:t('overview.tabOverview'),  icon: PieChartIcon },
            { key:'leads',    label:t('overview.tabLeads'),     icon: TableIcon },
            { key:'revenue',  label:t('overview.tabRevenue'),   icon: TrendingUp },
            { key:'team',     label:t('overview.tabTeam'),      icon: Users },
            { key:'sources',  label:'מקורות ROI',               icon: BarChart2 },
          ] as {key:ReportTab;label:string;icon:React.ElementType}[]).map(t => (
            <button key={t.key} onClick={()=>setTab(t.key)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={tab===t.key
                ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                : { background: 'transparent', border: '1px solid transparent', color: c.textMuted }}>
              <t.icon size={13}/>{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ TAB: OVERVIEW ══════════════════════════════════════════════════════ */}
      {tab==='overview' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon={Users}     label={t('overview.totalLeads')}       value={filtered.length}              color="#6366f1" sub={`${kpi.conv}% ${t('overview.conversionRate')}`}/>
            <KpiCard icon={Target}    label={t('overview.activeClients')}    value={kpi.active.length}             color="#22c55e" sub={`${fmtMoney(kpi.avgDeal)}/חודש`}/>
            <KpiCard icon={DollarSign} label={t('overview.monthlyRevenue')}   value={fmtMoney(kpi.revenue)}         color="#10b981" sub={`${fmtMoney(kpi.pipeVal)}`}/>
            <KpiCard icon={Brain}     label={t('overview.avgAiScore')}    value={`${kpi.avgScore}%`}            color="#8b5cf6" sub={`${filtered.filter(l=>l.aiScore>=75).length} ${t('overview.hotLeads')}`}/>
          </div>

          {/* Monthly trend */}
          <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-4 text-[11px]" style={{ color: c.textMuted }}>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"/>לידים</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"/>לקוחות</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: '#a78bfa' }}/>הכנסות (K₪)</span>
              </div>
              <h3 className="font-bold" style={{ color: c.textPrimary }}>{t('overview.monthlyTrend')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyTrend} margin={{top:4,right:4,left:-20,bottom:0}}>
                <defs>
                  <linearGradient id="gLead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false}/>
                <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false} width={24}/>
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
            <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>{t('overview.statusDistribution')}</h3>
              <div className="flex items-center gap-3">
                <div className="space-y-2 flex-1">
                  {statusData.map(d=>(
                    <div key={d.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-bold" style={{color:d.color}}>{d.value}</span>
                        <span style={{ color: c.textSecondary }}>{d.name}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
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
                      <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color: c.textPrimary, fontSize:11 }} cursor={false}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Funnel */}
            <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>{t('overview.salesFunnel')}</h3>
              <div className="flex items-end gap-2 h-28">
                {funnel.map((s,i)=>{
                  const max = Math.max(...funnel.map(f=>f.value),1);
                  const pct = (s.value/max)*100;
                  const conv = i>0 && funnel[i-1].value>0 ? Math.round((s.value/funnel[i-1].value)*100) : null;
                  return (
                    <div key={s.name} className="flex-1 flex flex-col items-center gap-1">
                      {conv!==null && <span className="text-[10px] mb-1" style={{ color: c.textMuted }}>↓{conv}%</span>}
                      <div className="w-full flex items-end" style={{height:80}}>
                        <div className="w-full rounded-t-xl transition-all duration-500"
                          style={{height:`${Math.max(pct,8)}%`,backgroundColor:s.color,opacity:0.85}}/>
                      </div>
                      <span className="text-base font-black" style={{ color: c.textPrimary }}>{s.value}</span>
                      <span className="text-[10px] text-center" style={{ color: c.textMuted }}>{s.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Source bar */}
            <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
              <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>{t('overview.leadsBySource')}</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={sourceStats.slice(0,5)} layout="vertical" margin={{right:0,left:0}}>
                  <XAxis type="number" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false}/>
                  <YAxis type="category" dataKey="src" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} width={70} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false}/>
                  <Tooltip {...tooltipStyle} formatter={(v:number)=>[v,'לידים']}/>
                  <Bar dataKey="total" fill="#6366f1" radius={[0,6,6,0]} maxBarSize={16}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Smart Insights */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center gap-2 mb-4 justify-end">
              <h3 className="font-bold" style={{ color: c.textPrimary }}>{t('overview.smartInsights')}</h3>
              <Sparkles size={15} style={{ color: c.accentText }}/>
            </div>
            {insights.length===0 ? (
              <p className="text-sm text-right" style={{ color: c.textMuted }}>{t('overview.noInsights')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.map((ins,i)=>(
                  <div key={i} className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-right" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <span className="text-lg flex-shrink-0">{ins.icon}</span>
                    <p className="text-sm font-medium" style={{ color: ins.color }}>{ins.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ TAB: LEADS TABLE ═══════════════════════════════════════════════════ */}
      {tab==='leads' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
          {/* Table toolbar */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            style={{ borderBottom: `1px solid ${c.divider}`, background: 'rgba(10,15,30,0.88)', backdropFilter: 'blur(16px)' }}
          >
            <div className="flex items-center gap-2">
              <button onClick={()=>exportLeads(sortedLeads)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }}>
                <Download size={12}/> {t('overview.exportCSV')} ({sortedLeads.length})
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-xs" style={{ color: c.textMuted }}>{sortedLeads.length} לידים</span>
              {(['הכל',...Object.keys(STATUS_COLORS)] as string[]).map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)}
                  className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors"
                  style={statusFilter===s
                    ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                    : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
                  }>{s}</button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right" style={{ borderBottom: `1px solid ${c.divider}` }}>
                  {([
                    {col:'company',   label:t('overview.company')},
                    {col:'status',    label:t('common.status')},
                    {col:'budget',    label:t('dashboard.budget')},
                    {col:'aiScore',   label:t('dashboard.score')},
                    {col:'lastUpdate',label:t('dashboard.lastUpdate')},
                  ] as {col:typeof sortCol;label:string}[]).map(h=>(
                    <th key={h.col}
                      onClick={()=>toggleSort(h.col)}
                      className="px-4 py-3 text-xs font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors"
                      style={{ color: c.textMuted }}>
                      {h.label}<SortIcon col={h.col}/>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: c.textMuted }}>{t('overview.source')}</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: c.textMuted }}>{t('overview.responsible')}</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: c.textMuted }}>{t('overview.daysSinceContact')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead,i)=>{
                  const stale = daysSince(lead.lastUpdate);
                  const scoreColor = lead.aiScore>=75
                    ? { background:'rgba(34,197,94,0.15)', color:'#4ade80' }
                    : lead.aiScore>=50
                      ? { background:'rgba(245,158,11,0.15)', color:'#fbbf24' }
                      : { background: c.subtleBg, color: c.textMuted };
                  return (
                    <tr key={lead.id}
                      onClick={()=>onLeadClick(lead)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderBottom: `1px solid ${c.divider}`,
                        background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.07)')}
                      onMouseLeave={e => (e.currentTarget.style.background = i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)')}>
                      <td className="px-4 py-3">
                        <div className="font-semibold" style={{ color: c.textPrimary }}>{lead.company}</div>
                        <div className="text-xs" style={{ color: c.textMuted }}>{lead.contactName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{color:STATUS_COLORS[lead.status as LeadStatus],backgroundColor:STATUS_COLORS[lead.status as LeadStatus]+'18'}}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold" style={{ color: c.textPrimary }}>{fmtMoney(lead.budget??0)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={scoreColor}>{lead.aiScore}%</span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: c.textMuted }}>{lead.lastUpdate}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: c.textMuted }}>{lead.source}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: c.textMuted }}>{lead.assignedTo||'—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold" style={{ color: stale>=14?'#f87171':stale>=7?'#fbbf24':'#4ade80' }}>
                          {stale} {t('overview.days')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sortedLeads.length===0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-sm" style={{ color: c.textMuted }}>{t('overview.noLeadsFilter')}</td></tr>
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
            <KpiCard icon={DollarSign} label={t('overview.monthlyRevenue')}    value={fmtMoney(kpi.revenue)}     color="#22c55e" sub={`${kpi.active.length} ${t('overview.activeClients')}`}/>
            <KpiCard icon={TrendingUp} label={t('overview.pipelinePotential')} value={fmtMoney(kpi.pipeVal)} color="#6366f1" sub={`${kpi.pipeline.length} ${t('overview.totalLeads')}`}/>
            <KpiCard icon={Star}       label={t('overview.avgClientValue')}  value={fmtMoney(kpi.avgDeal)}     color="#f59e0b" sub={t('overview.avgMonthly')}/>
            <KpiCard icon={Zap}        label={t('overview.conversionRate')}       value={`${kpi.conv}%`}            color="#8b5cf6" sub={t('overview.leadsToClient')}/>
          </div>

          {/* Revenue by source */}
          <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center justify-between mb-5">
              <button onClick={()=>exportRevenue(filtered)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                <Download size={11}/> CSV
              </button>
              <h3 className="font-bold" style={{ color: c.textPrimary }}>{t('overview.salesBySource')}</h3>
            </div>
            <div className="space-y-3">
              {sourceStats.map(s=>{
                const maxRev = Math.max(...sourceStats.map(x=>x.rev),1);
                return (
                  <div key={s.src} className="flex items-center gap-4">
                    <div className="text-left w-12">
                      <span className="text-xs font-bold" style={{ color: c.accentText }}>{s.conv}%</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span style={{ color: c.textMuted }}>{s.total} לידים · {s.active} פעילים · {fmtMoney(s.rev)}/חודש</span>
                        <span className="font-semibold" style={{ color: c.textSecondary }}>{s.src}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width:`${(s.rev/maxRev)*100}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Monthly revenue chart */}
          <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
            <h3 className="font-bold mb-5 text-right" style={{ color: c.textPrimary }}>{t('overview.monthlyRevenueChart')}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyTrend} margin={{top:4,right:4,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false}/>
                <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false} width={30}/>
                <Tooltip {...tooltipStyle} formatter={(v:number)=>[`₪${v}K`,'הכנסות']}/>
                <Bar dataKey="הכנסות" radius={[6,6,0,0]} maxBarSize={40}>
                  {monthlyTrend.map((_,i)=>(
                    <Cell key={i} fill={i===monthlyTrend.length-1?'#6366f1':'rgba(99,102,241,0.3)'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top revenue leads */}
          <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
            <h3 className="font-bold mb-4 text-right" style={{ color: c.textPrimary }}>{t('overview.topClients')}</h3>
            <div className="space-y-2">
              {[...kpi.active].sort((a,b)=>(b.budget??0)-(a.budget??0)).slice(0,10).map((lead,i)=>{
                const max = kpi.active[0]?.budget ?? 1;
                return (
                  <div key={lead.id} onClick={()=>onLeadClick(lead)}
                    className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors"
                    style={{ background: c.subtleBg }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0"
                      style={{background:i<3?['#fbbf24','#94a3b8','#f97316'][i]:'rgba(255,255,255,0.08)',color:i<3?'white':'rgba(255,255,255,0.4)'}}>
                      {i+1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-black" style={{ color: '#4ade80' }}>{fmtMoney(lead.budget??0)}/חודש</span>
                        <span className="font-semibold truncate mr-2" style={{ color: c.textPrimary }}>{lead.company}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
                        <div className="h-full rounded-full"
                          style={{ width:`${((lead.budget??0)/max)*100}%`, background: 'linear-gradient(90deg,#10b981,#34d399)' }}/>
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }}>
              <Download size={12}/> {t('overview.exportTeamReport')}
            </button>
          </div>

          {teamStats.length===0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
              <Users size={32} className="mx-auto mb-3" style={{ color: c.textMuted }}/>
              <p style={{ color: c.textMuted }}>{t('overview.noTeamData')}</p>
            </div>
          ) : (
            <>
              {/* Team KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard icon={Users}   label={t('overview.teamActiveMembers')} value={teamStats.length}                                    color="#6366f1"/>
                <KpiCard icon={Target}  label={t('overview.teamTotalClients')}       value={teamStats.reduce((s,t)=>s+t.active,0)}              color="#22c55e"/>
                <KpiCard icon={Award}   label={t('overview.teamAvgConversion')}        value={`${teamStats.length?Math.round(teamStats.reduce((s,t)=>s+t.conv,0)/teamStats.length):0}%`} color="#f59e0b"/>
                <KpiCard icon={DollarSign} label={t('overview.teamTotalRevenue')}    value={fmtMoney(teamStats.reduce((s,t)=>s+t.rev,0))}       color="#8b5cf6"/>
              </div>

              {/* Leaderboard */}
              <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
                <h3 className="font-bold mb-5 text-right flex items-center gap-2 justify-end" style={{ color: c.textPrimary }}>
                  <Award size={16} style={{ color: '#fbbf24' }}/>{t('overview.leaderboard')}
                </h3>
                <div className="space-y-3">
                  {teamStats.map((agent,i)=>{
                    const maxRev = teamStats[0]?.rev||1;
                    const medals = ['🥇','🥈','🥉'];
                    return (
                      <div key={agent.name} className="rounded-xl p-4 transition-all" style={{
                        border: i===0 ? '1px solid rgba(251,191,36,0.25)' : i===1 ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(255,255,255,0.07)',
                        background: i===0 ? 'rgba(251,191,36,0.06)' : i===1 ? 'rgba(148,163,184,0.04)' : 'rgba(255,255,255,0.02)',
                      }}>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xl">{medals[i]||`#${i+1}`}</span>
                          <div className="flex-1">
                            <div className="flex justify-between items-center">
                              <div className="flex gap-4 text-xs">
                                <span style={{ color: '#4ade80' }} className="font-bold">{fmtMoney(agent.rev)}/חודש</span>
                                <span style={{ color: c.accentText }} className="font-bold">{agent.conv}% המרה</span>
                                <span style={{ color: c.textMuted }}>ציון AI: {agent.avgScore}%</span>
                              </div>
                              <p className="font-bold" style={{ color: c.textPrimary }}>{agent.name}</p>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                          <div className="rounded-lg p-2" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                            <div className="font-black text-lg" style={{ color: c.textPrimary }}>{agent.total}</div>
                            <div style={{ color: c.textMuted }}>{t('overview.totalLeadsLabel')}</div>
                          </div>
                          <div className="rounded-lg p-2" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                            <div className="font-black text-lg" style={{ color: '#4ade80' }}>{agent.active}</div>
                            <div style={{ color: c.textMuted }}>{t('overview.activeClientsLabel')}</div>
                          </div>
                          <div className="rounded-lg p-2" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                            <div className="font-black text-lg" style={{ color: c.accentText }}>{agent.conv}%</div>
                            <div style={{ color: c.textMuted }}>{t('overview.conversionRateLabel')}</div>
                          </div>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: c.subtleBg }}>
                          <div className="h-full rounded-full"
                            style={{ width:`${(agent.rev/maxRev)*100}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Team performance chart */}
              <div className="rounded-2xl p-5" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}>
                <h3 className="font-bold mb-5 text-right" style={{ color: c.textPrimary }}>{t('overview.teamByMember')}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={teamStats} margin={{top:0,right:0,left:-20,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={{ stroke:'rgba(255,255,255,0.1)' }} tickLine={false} width={24}/>
                    <Tooltip {...tooltipStyle}/>
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ color: c.textSecondary, fontSize: 11 }}/>
                    <Bar dataKey="total"  name={t('overview.totalLeadsLabel')}    fill="#6366f1" opacity={0.4} radius={[4,4,0,0]} maxBarSize={32}/>
                    <Bar dataKey="active" name={t('overview.activeClientsLabel')} fill="#6366f1" radius={[4,4,0,0]} maxBarSize={32}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}

      {/* ══ TAB: SOURCES ROI ═══════════════════════════════════════════════════ */}
      {tab==='sources' && (
        <SourcesAnalysis leads={filtered} workspaceId={workspaceId}/>
      )}

    </div>
  );
}
