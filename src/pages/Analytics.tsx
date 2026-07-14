import { useState, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, DollarSign, Target, Award,
  Activity, ArrowDown, AlertTriangle, CheckCircle, Clock,
  ChevronUp, ChevronDown, Zap, Star, BarChart2, Download,
  FileText, Brain, Sparkles, Loader2, Copy, PieChart as PieChartIcon,
  Table, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { getAnthropicProxy } from '../lib/anthropicClient';
import type { Lead, LeadStatus, TeamMember, StandaloneTask } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AnalyticsProps {
  leads: Lead[];
  team: TeamMember[];
  standaloneTask: StandaloneTask[];
  currentUser: string;
  onLeadClick?: (lead: Lead) => void;
  workspaceId?: string;
}

type Period = '7' | '30' | '90' | 'all';
type Tab    = 'overview' | 'funnel' | 'leads' | 'revenue' | 'team' | 'sources' | 'objections' | 'media' | 'crm';

// ─── Constants ────────────────────────────────────────────────────────────────
const NEON: Record<string, string> = {
  'חדש':         '#6366f1',
  'בתהליך':     '#f97316',
  'לקוח פעיל':  '#10b981',
  'רימרקטינג':  '#8b5cf6',
  'לא רלוונטי': '#64748b',
};
const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש':         '#6366f1',
  'בתהליך':     '#f97316',
  'לקוח פעיל':  '#22c55e',
  'רימרקטינג':  '#8b5cf6',
  'לא רלוונטי': '#94a3b8',
};
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
const ALL_SOURCES = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];
const HEB_MONTHS_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDateStr(s: string | number | undefined): Date {
  if (!s) return new Date(0);
  if (typeof s === 'number') return new Date(s);
  const p = s.split('/');
  if (p.length === 3) return new Date(`${p[2]}-${p[1]}-${p[0]}T00:00:00`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0) : d;
}
function daysSince(s: string | number | undefined): number {
  return Math.max(0, Math.floor((Date.now() - parseDateStr(s).getTime()) / 86_400_000));
}
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `₪${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `₪${(n / 1_000).toFixed(0)}K`;
  return `₪${n.toLocaleString()}`;
}
function fmtPct(n: number): string { return `${Math.round(n)}%`; }
function getSrcColor(src: string) { return SOURCE_COLORS[src] ?? '#94a3b8'; }
function getSrcEmoji(src: string) { return SOURCE_EMOJI[src] ?? '📊'; }

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const BOM   = '﻿';
  const lines = [headers, ...rows].map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}
function exportLeads(leads: Lead[]) {
  exportCSV('leads_report.csv', leads.map(l => [
    l.company, l.contactName, l.email, l.phone, l.status, l.source,
    String(l.budget ?? 0), String(l.aiScore),
    String(l.solutions.length), String(l.tasks.filter(t => !t.completed).length),
    l.assignedTo, l.lastUpdate, l.waitingContent ? 'כן' : 'לא',
  ]), ['חברה','איש קשר','אימייל','טלפון','סטטוס','מקור','תקציב','ציון AI','שירותים','משימות פתוחות','אחראי','עדכון אחרון','ממתין לתוכן']);
}
function exportRevenue(leads: Lead[]) {
  const byStatus = Object.entries(STATUS_COLORS).map(([s]) => {
    const g = leads.filter(l => l.status === s);
    return [s, String(g.length), fmtMoney(g.reduce((a, l) => a + (l.budget ?? 0), 0))];
  });
  exportCSV('revenue_report.csv', byStatus, ['סטטוס','מספר לידים','סה"כ תקציב']);
}
function exportTeam(leads: Lead[]) {
  const map = new Map<string, { total: number; active: number; rev: number }>();
  leads.forEach(l => {
    if (!l.assignedTo) return;
    const e = map.get(l.assignedTo) ?? { total: 0, active: 0, rev: 0 };
    e.total++;
    if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
    map.set(l.assignedTo, e);
  });
  exportCSV('team_report.csv',
    [...map.entries()].map(([n, d]) => [
      n, String(d.total), String(d.active),
      d.total > 0 ? `${Math.round((d.active / d.total) * 100)}%` : '0%',
      fmtMoney(d.rev),
    ]),
    ['שם','סה"כ לידים','לקוחות פעילים','המרה','הכנסה חודשית']);
}
function exportOverviewData(leads: Lead[]) {
  exportCSV('overview_report.csv',
    leads.map(l => [l.company, l.contactName, l.status, fmtMoney(l.budget ?? 0), `${l.aiScore ?? 0}%`, l.source ?? '', l.lastUpdate ?? '']),
    ['חברה', 'איש קשר', 'סטטוס', 'תקציב', 'ציון AI', 'מקור', 'עדכון אחרון']
  );
}
function exportFunnelData(leads: Lead[]) {
  const statuses: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
  exportCSV('funnel_report.csv',
    statuses.map(s => {
      const g = leads.filter(l => l.status === s);
      return [s, String(g.length), fmtMoney(g.reduce((a, l) => a + (l.budget ?? 0), 0))];
    }),
    ['שלב', 'מספר לידים', 'סה"כ תקציב']
  );
}
function exportSourcesData(leads: Lead[]) {
  const map = new Map<string, { total: number; active: number; rev: number; scores: number[] }>();
  leads.forEach(l => {
    if (!l.source) return;
    const e = map.get(l.source) ?? { total: 0, active: 0, rev: 0, scores: [] };
    e.total++; e.scores.push(l.aiScore ?? 0);
    if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
    map.set(l.source, e);
  });
  exportCSV('sources_roi.csv',
    [...map.entries()].map(([src, d]) => [
      src, String(d.total), String(d.active),
      `${d.total > 0 ? Math.round((d.active / d.total) * 100) : 0}%`,
      fmtMoney(d.rev),
      `${d.scores.length > 0 ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0}%`,
    ]),
    ['מקור', 'לידים', 'לקוחות פעילים', 'המרה', 'הכנסה חודשית', 'ציון AI ממוצע']
  );
}
function exportObjectionsData(leads: Lead[]) {
  exportCSV('objections_report.csv',
    leads.filter(l => l.status === 'לא רלוונטי').map(l => [
      l.company, l.contactName, (l as Record<string,unknown>).objection as string ?? 'לא סווג',
      fmtMoney(l.budget ?? 0), l.lastUpdate ?? '',
    ]),
    ['חברה', 'איש קשר', 'סיבת התנגדות', 'תקציב', 'עדכון אחרון']
  );
}
function exportMediaData(leads: Lead[]) {
  exportCSV('media_report.csv',
    ALL_SOURCES.map(src => {
      const g = leads.filter(l => l.source === src);
      const active = g.filter(l => l.status === 'לקוח פעיל');
      const rev = active.reduce((s, l) => s + (l.budget ?? 0), 0);
      const avg = active.length > 0 ? Math.round(rev / active.length) : 0;
      return [src, String(g.length), String(active.length), `${g.length > 0 ? Math.round((active.length / g.length) * 100) : 0}%`, fmtMoney(rev), fmtMoney(avg)];
    }),
    ['מקור', 'לידים', 'לקוחות פעילים', '% המרה', 'הכנסה', 'ממוצע לליד']
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportCRMData(data: any[]) {
  exportCSV('crm_report.csv',
    data.map(r => [
      r.lead?.company ?? '', r.lead?.contactName ?? '', r.lead?.status ?? '',
      String(r.totalTouches ?? 0), String(r.calls ?? 0), String(r.emails ?? 0),
      String(r.waMsgs ?? 0), String(r.mtgDone ?? 0),
      r.daysSinceLast !== null && r.daysSinceLast !== undefined ? String(r.daysSinceLast) : '—',
    ]),
    ['חברה', 'איש קשר', 'סטטוס', 'סה"כ פניות', 'שיחות', 'מיילים', 'WhatsApp', 'פגישות', 'ימים מאז קשר']
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const glass: React.CSSProperties = {
  background:    'rgba(255,255,255,0.03)',
  border:        '1px solid rgba(255,255,255,0.07)',
  backdropFilter:'blur(8px)',
  borderRadius:  '16px',
};
const tooltipStyle = {
  contentStyle: { background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'white', fontSize:12 },
  labelStyle:   { color:'rgba(255,255,255,0.6)' },
  cursor:       { fill:'rgba(99,102,241,0.06)' },
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent, icon: Icon, trend }: {
  label: string; value: string | number; sub?: string;
  accent: string; icon: React.ElementType; trend?: number;
}) {
  const { c } = useTheme();
  return (
    <div style={{
      background: `linear-gradient(135deg,${accent}12,${accent}06)`,
      border: `1px solid ${accent}28`,
      borderRadius: 16, padding: 20,
      position: 'relative', overflow: 'hidden',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position:'absolute', top:0, right:0, left:0, height:2,
        background:`linear-gradient(90deg,transparent,${accent}70,transparent)` }}/>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${accent}20`,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon size={20} color={accent}/>
        </div>
        {trend !== undefined && (
          <span style={{
            fontSize:11, fontWeight:600,
            color: trend >= 0 ? '#10b981' : '#ef4444',
            background: trend >= 0 ? '#10b98115' : '#ef444415',
            border: `1px solid ${trend >= 0 ? '#10b98130' : '#ef444430'}`,
            borderRadius:6, padding:'2px 8px',
            display:'flex', alignItems:'center', gap:2,
          }}>
            {trend >= 0 ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p style={{ fontSize:26, fontWeight:800, color: c.textPrimary, margin:0 }}>{value}</p>
      <p style={{ fontSize:13, color: c.textMuted, margin:'2px 0 0' }}>{label}</p>
      {sub && <p style={{ fontSize:11, color:`${accent}AA`, margin:'4px 0 0' }}>{sub}</p>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, sub, icon: Icon, color = '#6366f1' }: {
  title: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  const { c } = useTheme();
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
      <div style={{ width:36, height:36, borderRadius:10, background:`${color}20`,
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <Icon size={18} color={color}/>
      </div>
      <div>
        <h2 style={{ margin:0, fontSize:16, fontWeight:700, color: c.textPrimary }}>{title}</h2>
        {sub && <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Insight Row ──────────────────────────────────────────────────────────────
function InsightRow({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string; color: string;
}) {
  const { c } = useTheme();
  return (
    <div style={{
      display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'10px 14px', background: c.subtleBg,
      border: `1px solid ${c.cardBorder}`, borderRadius:10, gap:12,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 }}>
        {icon}
        <span style={{ fontSize:12, color: c.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize:13, fontWeight:600, color, flexShrink:0 }}>{value}</span>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  const { c } = useTheme();
  return (
    <div style={{ textAlign:'center', padding:'48px 20px', color:'#475569' }}>
      <BarChart2 size={40} color="#334155" style={{ margin:'0 auto 12px' }}/>
      <p style={{ margin:0, fontSize:14 }}>{message}</p>
    </div>
  );
}

// ─── Sources Analysis Component ───────────────────────────────────────────────
function SourcesAnalysis({ leads }: { leads: Lead[]; workspaceId?: string }) {
  const { c } = useTheme();

  const stats = useMemo(() => {
    const map = new Map<string, { total:number; active:number; rev:number; scores:number[] }>();
    leads.forEach(l => {
      if (!l.source) return;
      const e = map.get(l.source) ?? { total:0, active:0, rev:0, scores:[] };
      e.total++; e.scores.push(l.aiScore);
      if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
      map.set(l.source, e);
    });
    return [...map.entries()].map(([src, d]) => ({
      src, total:d.total, active:d.active, rev:d.rev,
      conv:     d.total > 0 ? Math.round((d.active / d.total) * 100) : 0,
      avgScore: d.scores.length > 0 ? Math.round(d.scores.reduce((a,b) => a+b, 0) / d.scores.length) : 0,
    })).sort((a, b) => b.rev - a.rev);
  }, [leads]);

  const best   = stats[0];
  const maxRev = Math.max(...stats.map(d => d.rev), 1);
  const avgConv = stats.length
    ? Math.round(stats.reduce((s, d) => s + d.conv, 0) / stats.length)
    : 0;

  if (stats.length === 0) return (
    <div style={{ ...glass, padding:'64px 20px', textAlign:'center' }}>
      <BarChart2 size={44} color="rgba(255,255,255,0.15)" style={{ margin:'0 auto 12px' }}/>
      <p style={{ color: c.textMuted, margin:0 }}>אין נתוני מקורות — הוסף מקור ללידים</p>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* KPI summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
        <KpiCard icon={BarChart2}  label="מקורות פעילים"  value={stats.length}            accent="#6366f1"/>
        <KpiCard icon={Target}     label="מקור מוביל"      value={best?.src ?? '—'}        accent="#22c55e" sub={`${best?.conv ?? 0}% המרה`}/>
        <KpiCard icon={DollarSign} label="הכנסה מובילה"   value={fmtMoney(best?.rev ?? 0)} accent="#10b981" sub={best?.src}/>
        <KpiCard icon={Activity}   label="ממוצע המרה"      value={`${avgConv}%`}            accent="#8b5cf6"/>
      </div>

      {/* Best source banner */}
      {best && (
        <div style={{ ...glass, padding:20, display:'flex', alignItems:'center', gap:16,
          background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.2)' }}>
          <div style={{ width:56, height:56, borderRadius:16, display:'flex', alignItems:'center',
            justifyContent:'center', fontSize:24, flexShrink:0, background:getSrcColor(best.src)+'20' }}>
            {getSrcEmoji(best.src)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:10, fontWeight:700, color:'#4ade80', textTransform:'uppercase',
              letterSpacing:'0.1em', margin:'0 0 2px' }}>🏆 המקור הטוב ביותר</p>
            <p style={{ fontSize:18, fontWeight:900, color: c.textPrimary, margin:0 }}>{best.src}</p>
            <p style={{ fontSize:12, color: c.textMuted, margin:'2px 0 0' }}>
              {best.total} לידים · {best.active} לקוחות פעילים · {fmtMoney(best.rev)}/חודש
            </p>
          </div>
          <div style={{ textAlign:'center', flexShrink:0 }}>
            <p style={{ fontSize:32, fontWeight:900, color:getSrcColor(best.src), margin:0 }}>{best.conv}%</p>
            <p style={{ fontSize:11, color: c.textMuted, margin:0 }}>המרה</p>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:16 }}>
        {/* Revenue bars */}
        <div style={{ ...glass, padding:20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <button
              onClick={() => exportCSV('sources_report.csv',
                stats.map(s => [s.src, String(s.total), String(s.active), `${s.conv}%`, `₪${s.rev.toLocaleString()}`, `${s.avgScore}%`]),
                ['מקור','לידים','לקוחות פעילים','המרה','הכנסה/חודש','ציון AI ממוצע'])}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
                borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer',
                background: c.subtleBg, border: `1px solid ${c.cardBorder}`,
                color: c.textMuted }}>
              <Download size={11}/> CSV
            </button>
            <h3 style={{ margin:0, fontWeight:700, color: c.textPrimary, fontSize:14 }}>הכנסה לפי מקור</h3>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {stats.map(s => (
              <div key={s.src}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
                  <span style={{ fontWeight:700, color: c.textSecondary }}>{fmtMoney(s.rev)}/חודש</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ color: c.textSecondary }}>{s.src}</span>
                    <span style={{ fontSize:16 }}>{getSrcEmoji(s.src)}</span>
                  </div>
                </div>
                <div style={{ height:10, borderRadius:5, overflow:'hidden', background: c.subtleBg }}>
                  <div style={{ height:'100%', borderRadius:5, transition:'width 0.7s',
                    width:`${Math.max(4, (s.rev / maxRev) * 100)}%`,
                    background:getSrcColor(s.src) }}/>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10,
                  color: c.textMuted, marginTop:3 }}>
                  <span>{s.active} לקוחות · {s.conv}% המרה</span>
                  <span>{s.total} לידים</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Volume chart */}
        <div style={{ ...glass, padding:20 }}>
          <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
            נפח לידים vs לקוחות
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats} margin={{ top:4, right:4, left:-20, bottom:20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
              <XAxis dataKey="src" tick={{ fontSize:9, fill:'rgba(255,255,255,0.4)' }}
                axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0}/>
              <YAxis tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={24}/>
              <Tooltip {...tooltipStyle}/>
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ color: c.textSecondary, fontSize:11 }}/>
              <Bar dataKey="total"  name="לידים"          radius={[4,4,0,0]} maxBarSize={28} fill="#6366f1" opacity={0.4}/>
              <Bar dataKey="active" name="לקוחות פעילים" radius={[4,4,0,0]} maxBarSize={28}>
                {stats.map((s, i) => <Cell key={i} fill={getSrcColor(s.src)}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed table */}
      <div style={{ ...glass, overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom: `1px solid ${c.divider}`,
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:12, color: c.textMuted }}>{stats.length} מקורות</span>
          <h3 style={{ margin:0, fontWeight:700, color: c.textPrimary, fontSize:14 }}>ביצועים מפורטים לפי מקור</h3>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${c.divider}` }}>
                {['מקור','לידים','לקוחות','המרה','ציון AI','הכנסה/חודש'].map(h => (
                  <th key={h} style={{ padding:'12px 16px', textAlign:'right', fontSize:11, fontWeight:700,
                    color: c.textMuted, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.src} style={{
                  borderBottom: `1px solid ${c.divider}`,
                  background: i === 0 ? 'rgba(34,197,94,0.05)' : i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}>
                  <td style={{ padding:'12px 16px', textAlign:'right' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end' }}>
                      {i === 0 && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:20,
                          background:'rgba(34,197,94,0.15)', color:'#4ade80' }}>🏆</span>
                      )}
                      <span style={{ fontWeight:600, color: c.textPrimary }}>{s.src}</span>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:getSrcColor(s.src), flexShrink:0 }}/>
                    </div>
                  </td>
                  <td style={{ padding:'12px 16px', textAlign:'center', color: c.textSecondary, fontWeight:600 }}>{s.total}</td>
                  <td style={{ padding:'12px 16px', textAlign:'center', color:'#4ade80', fontWeight:700 }}>{s.active}</td>
                  <td style={{ padding:'12px 16px', textAlign:'center' }}>
                    <span style={{ fontSize:12, fontWeight:700, padding:'2px 10px', borderRadius:20,
                      ...(s.conv >= 30
                        ? { background:'rgba(34,197,94,0.15)', color:'#4ade80' }
                        : s.conv >= 15
                          ? { background:'rgba(245,158,11,0.15)', color:'#fbbf24' }
                          : { background: c.subtleBg, color: c.textMuted }) }}>
                      {s.conv}%
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px', textAlign:'center', fontSize:12, fontWeight:600,
                    color: s.avgScore >= 70 ? '#4ade80' : s.avgScore >= 50 ? '#fbbf24' : 'rgba(255,255,255,0.38)' }}>
                    {s.avgScore}%
                  </td>
                  <td style={{ padding:'12px 16px', textAlign:'left', fontWeight:900, color: c.textPrimary }}>
                    ₪{s.rev.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...glass, padding:16, background:'rgba(99,102,241,0.04)', border:'1px solid rgba(99,102,241,0.12)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end' }}>
          <p style={{ margin:0, fontSize:13, color:'rgba(255,255,255,0.45)', textAlign:'right' }}>
            💡 המלצות תקציב שיווק הועברו ללשונית <strong style={{ color:'#818cf8' }}>הגדרות תקציב שיווק</strong> בהגדרות
          </p>
          <Brain size={14} color="#818cf8"/>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Analytics Component
// ═══════════════════════════════════════════════════════════════════════════════
export default function Analytics({ leads, team, onLeadClick, workspaceId }: AnalyticsProps) {
  const { isDark, c } = useTheme();
  const [period,       setPeriod]       = useState<Period>('30');
  const [tab,          setTab]          = useState<Tab>('overview');
  const [sortCol,      setSortCol]      = useState<'company'|'budget'|'aiScore'|'status'|'lastUpdate'>('aiScore');
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<string>('הכל');

  // ── Filter by period ────────────────────────────────────────────────────────
  const filteredLeads = useMemo(() => {
    if (period === 'all') return leads;
    const cutoff = Date.now() - parseInt(period) * 86_400_000;
    return leads.filter(l => {
      const d = l.createdAt ? parseDateStr(l.createdAt) : parseDateStr(l.lastUpdate);
      return d.getTime() >= cutoff;
    });
  }, [leads, period]);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active    = filteredLeads.filter(l => l.status === 'לקוח פעיל');
    const pipeline  = filteredLeads.filter(l => ['חדש','בתהליך','רימרקטינג'].includes(l.status));
    const revenue   = active.reduce((s, l) => s + (l.budget ?? 0), 0);
    const pipeVal   = pipeline.reduce((s, l) => s + (l.budget ?? 0), 0);
    const eligible  = filteredLeads.filter(l => l.status !== 'לא רלוונטי').length;
    const closeRate = eligible > 0 ? Math.round((active.length / eligible) * 100) : 0;
    const avgScore  = filteredLeads.length
      ? Math.round(filteredLeads.reduce((s, l) => s + l.aiScore, 0) / filteredLeads.length) : 0;
    const avgDeal   = active.length ? Math.round(revenue / active.length) : 0;
    const stale     = filteredLeads.filter(l =>
      ['חדש','בתהליך'].includes(l.status) && daysSince(l.lastUpdate) >= 14).length;
    return { total:filteredLeads.length, active, pipeline, revenue, pipeVal, closeRate, avgScore, avgDeal, stale };
  }, [filteredLeads]);

  // ── Monthly trend ────────────────────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const m   = d.getMonth(), y = d.getFullYear();
      const inM = leads.filter(l => {
        const ld = l.createdAt ? parseDateStr(l.createdAt) : parseDateStr(l.lastUpdate);
        return ld.getMonth() === m && ld.getFullYear() === y;
      });
      return {
        name:     HEB_MONTHS_SHORT[m],
        'לידים':  inM.length,
        'לקוחות': inM.filter(l => l.status === 'לקוח פעיל').length,
        'הכנסות': Math.round(inM.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + (l.budget ?? 0), 0) / 1000),
        actual:   inM.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + (l.budget ?? 0), 0),
        potential:inM.filter(l => l.status === 'בתהליך').reduce((s, l) => s + (l.budget ?? 0), 0),
      };
    });
  }, [leads]);

  // ── Source stats ──────────────────────────────────────────────────────────────
  const sourceStats = useMemo(() =>
    ALL_SOURCES.map(src => {
      const g      = filteredLeads.filter(l => l.source === src);
      const active = g.filter(l => l.status === 'לקוח פעיל');
      const rev    = active.reduce((s, l) => s + (l.budget ?? 0), 0);
      const conv   = g.length ? Math.round((active.length / g.length) * 100) : 0;
      return { src, total:g.length, active:active.length, rev, conv };
    }).filter(d => d.total > 0).sort((a, b) => b.total - a.total),
  [filteredLeads]);

  // ── Source ROI ────────────────────────────────────────────────────────────────
  const sourceROI = useMemo(() => {
    return ALL_SOURCES.map(src => {
      const srcLeads  = filteredLeads.filter(l => l.source === src);
      const srcActive = srcLeads.filter(l => l.status === 'לקוח פעיל');
      const count     = srcLeads.length;
      const active    = srcActive.length;
      const eligible  = srcLeads.filter(l => l.status !== 'לא רלוונטי').length;
      const conv      = eligible > 0 ? (active / eligible) * 100 : 0;
      const revenue   = srcActive.reduce((s, l) => s + (l.budget ?? 0), 0);
      return { src, count, active, conv, revenue };
    }).filter(r => r.count > 0).sort((a, b) => b.conv - a.conv);
  }, [filteredLeads]);

  // ── Status data ───────────────────────────────────────────────────────────────
  const statusData = useMemo(() =>
    (Object.keys(STATUS_COLORS) as LeadStatus[]).map(s => ({
      name: s, value: filteredLeads.filter(l => l.status === s).length, color: STATUS_COLORS[s],
    })).filter(d => d.value > 0),
  [filteredLeads]);

  // ── Funnel ────────────────────────────────────────────────────────────────────
  const funnel = useMemo(() => {
    const order = [
      { status:'חדש',        label:'לידים חדשים'   },
      { status:'בתהליך',    label:'בתהליך'        },
      { status:'לקוח פעיל', label:'לקוחות פעילים' },
    ];
    return order.map(({ status, label }) => ({
      status, label,
      count:   filteredLeads.filter(l => l.status === status).length,
      revenue: filteredLeads.filter(l => l.status === status).reduce((s, l) => s + (l.budget ?? 0), 0),
      color:   NEON[status],
    }));
  }, [filteredLeads]);

  // ── Win/Loss ──────────────────────────────────────────────────────────────────
  const winLoss = useMemo(() => {
    const stale = filteredLeads.filter(l =>
      daysSince(l.lastUpdate) > 14 && l.status !== 'לקוח פעיל' && l.status !== 'לא רלוונטי');
    const staleRevenue  = stale.reduce((s, l) => s + (l.budget ?? 0), 0);
    const bestSrc       = sourceROI[0];
    const worstSrc      = [...sourceROI].sort((a, b) => a.conv - b.conv)[0];
    const nonConv       = filteredLeads.filter(l => l.status !== 'לקוח פעיל' && l.status !== 'לא רלוונטי');
    const avgAiScore    = nonConv.length
      ? Math.round(nonConv.reduce((s, l) => s + (l.aiScore ?? 0), 0) / nonConv.length) : 0;
    const activeLeads   = filteredLeads.filter(l => l.status === 'לקוח פעיל');
    const avgDaysToClose= activeLeads.length
      ? Math.round(activeLeads.reduce((s, l) => s + daysSince(l.createdAt ?? l.lastUpdate), 0) / activeLeads.length) : 0;
    const byRevenue     = Object.entries(NEON).map(([status]) => ({
      status, revenue: filteredLeads.filter(l => l.status === status).reduce((s, l) => s + (l.budget ?? 0), 0),
    })).filter(x => x.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    return { stale, staleRevenue, bestSrc, worstSrc, avgAiScore, avgDaysToClose, byRevenue };
  }, [filteredLeads, sourceROI]);

  // ── Time by status ────────────────────────────────────────────────────────────
  const timeByStatus = useMemo(() => {
    return ['חדש','בתהליך','לקוח פעיל','רימרקטינג'].map(status => {
      const group = filteredLeads.filter(l => l.status === status);
      const avg   = group.length
        ? Math.round(group.reduce((s, l) => s + daysSince(l.lastUpdate), 0) / group.length) : 0;
      return { status, avg, count: group.length, color: NEON[status] };
    }).filter(x => x.count > 0);
  }, [filteredLeads]);

  // ── Team stats ────────────────────────────────────────────────────────────────
  const teamStats = useMemo(() => {
    const map = new Map<string, { total:number; active:number; rev:number; scores:number[] }>();
    filteredLeads.forEach(l => {
      if (!l.assignedTo) return;
      const e = map.get(l.assignedTo) ?? { total:0, active:0, rev:0, scores:[] };
      e.total++; e.scores.push(l.aiScore);
      if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
      map.set(l.assignedTo, e);
    });
    return [...map.entries()].map(([name, d]) => ({
      name, total:d.total, active:d.active, rev:d.rev,
      conv:     d.total ? Math.round((d.active / d.total) * 100) : 0,
      avgScore: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
    })).sort((a, b) => b.rev - a.rev);
  }, [filteredLeads]);

  // ── Smart insights ────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const list: { icon:string; text:string; color:string }[] = [];
    const bestSrc = sourceStats[0];
    if (bestSrc)
      list.push({ icon:'🏆', color:'#fbbf24', text:`המקור הטוב ביותר הוא "${bestSrc.src}" עם ${bestSrc.total} לידים ו-${bestSrc.conv}% המרה` });
    if (kpis.stale > 0)
      list.push({ icon:'⚠️', color:'#f87171', text:`${kpis.stale} לידים לא עודכנו ב-14+ ימים — זקוקים לטיפול` });
    const hot = filteredLeads.filter(l => l.aiScore >= 80 && l.status === 'חדש');
    if (hot.length > 0)
      list.push({ icon:'🔥', color:'#fb923c', text:`${hot.length} לידים חמים (ציון 80+) ממתינים לטיפול ראשוני` });
    if (kpis.closeRate >= 30)
      list.push({ icon:'✅', color:'#4ade80', text:`יחס המרה של ${kpis.closeRate}% — מעל הממוצע בתעשייה (20%)` });
    else if (kpis.closeRate > 0)
      list.push({ icon:'📈', color:'#60a5fa', text:`יחס המרה ${kpis.closeRate}% — יש פוטנציאל לשיפור, הממוצע בתעשייה 20%` });
    const waiting = filteredLeads.filter(l => l.waitingContent);
    if (waiting.length > 0)
      list.push({ icon:'⏳', color: c.textSecondary, text:`${waiting.length} לידים ממתינים לתוכן מהלקוח` });
    if (kpis.avgDeal > 0)
      list.push({ icon:'💰', color:'#c084fc', text:`ערך לקוח פעיל ממוצע: ${fmtMoney(kpis.avgDeal)}/חודש` });
    return list;
  }, [filteredLeads, sourceStats, kpis]);

  // ── Sorted leads ──────────────────────────────────────────────────────────────
  const sortedLeads = useMemo(() => {
    let arr = statusFilter === 'הכל' ? filteredLeads : filteredLeads.filter(l => l.status === statusFilter);
    return [...arr].sort((a, b) => {
      const d = sortDir === 'asc' ? 1 : -1;
      if (sortCol === 'budget')     return d * ((a.budget ?? 0) - (b.budget ?? 0));
      if (sortCol === 'aiScore')    return d * (a.aiScore - b.aiScore);
      if (sortCol === 'lastUpdate') return d * (parseDateStr(a.lastUpdate).getTime() - parseDateStr(b.lastUpdate).getTime());
      return d * a[sortCol].localeCompare(b[sortCol]);
    });
  }, [filteredLeads, sortCol, sortDir, statusFilter]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key:'overview',    label:'סקירה כללית',   icon: PieChartIcon },
    { key:'funnel',      label:'משפך המרה',     icon: Activity },
    { key:'leads',       label:'טבלת לידים',    icon: Table },
    { key:'revenue',     label:'הכנסות',        icon: TrendingUp },
    { key:'team',        label:'ביצועי צוות',   icon: Users },
    { key:'sources',     label:'מקורות ROI',    icon: BarChart2 },
    { key:'objections',  label:'התנגדויות',     icon: AlertTriangle },
    { key:'media',       label:'דוח מדיה',      icon: BarChart2 },
    { key:'crm',         label:'קשרי לקוחות',  icon: Users },
  ];

  // ── CRM Relations data ───────────────────────────────────────────────────────
  const crmData = useMemo(() => {
    return filteredLeads.map(l => {
      const log = l.activityLog ?? [];
      const meetings = l.meetings ?? [];
      const calls   = log.filter(a => a.type === 'call').length;
      const emails  = log.filter(a => a.type === 'email').length;
      const waMsgs  = log.filter(a => a.type === 'whatsapp').length;
      const mtgDone = log.filter(a => a.type === 'meeting').length;
      const totalTouches = calls + emails + waMsgs + mtgDone;
      const lastContact = l.lastContactDate
        ? new Date(l.lastContactDate)
        : null;
      const daysSinceLast = lastContact
        ? Math.floor((Date.now() - lastContact.getTime()) / 86400000)
        : null;
      const nextMeeting = meetings
        .filter(m => new Date(`${m.date}T${m.time}`) >= new Date())
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      return {
        lead: l, calls, emails, waMsgs, mtgDone,
        totalTouches, daysSinceLast, nextMeeting,
        isOverdue: l.nextFollowUpDate ? new Date(l.nextFollowUpDate) < new Date() : false,
      };
    }).sort((a, b) => (b.totalTouches - a.totalTouches));
  }, [filteredLeads]);

  // ── Objections data ──────────────────────────────────────────────────────────
  const objectionData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.filter(l => l.objection).forEach(l => {
      const key = l.objection!;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLeads]);

  const objectionLeads = useMemo(() =>
    filteredLeads.filter(l => l.status === 'לא רלוונטי'),
  [filteredLeads]);

  const periodLabels: { key: Period; label: string }[] = [
    { key:'7',   label:'7 ימים'  },
    { key:'30',  label:'30 ימים' },
    { key:'90',  label:'90 ימים' },
    { key:'all', label:'הכל'     },
  ];

  return (
    <div dir="rtl" className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6"
      style={{ minHeight:'100vh', background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize, direction:'rtl' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ ...glass, padding:'20px 24px', marginBottom:20,
        background:'rgba(10,15,30,0.88)', border:'1px solid rgba(99,102,241,0.2)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <h1 style={{ margin:0, fontSize:'clamp(22px,3vw,32px)', fontWeight:800, letterSpacing:'-0.5px',
              background:'linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              אנליטיקס
            </h1>
            <p style={{ margin:'2px 0 0', color: c.textMuted, fontSize:13 }}>
              {filteredLeads.length} לידים בתקופה שנבחרה
            </p>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            {/* Export buttons */}
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={() => exportLeads(filteredLeads)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:10,
                  fontSize:12, fontWeight:600, cursor:'pointer',
                  background: c.subtleBg, border: `1px solid ${c.cardBorder}`,
                  color: c.textMuted }}>
                <Download size={12}/> לידים CSV
              </button>
              <button onClick={() => exportRevenue(filteredLeads)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:10,
                  fontSize:12, fontWeight:600, cursor:'pointer',
                  background: c.subtleBg, border: `1px solid ${c.cardBorder}`,
                  color: c.textMuted }}>
                <FileText size={12}/> הכנסות CSV
              </button>
              <button onClick={() => exportTeam(filteredLeads)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:10,
                  fontSize:12, fontWeight:700, cursor:'pointer',
                  background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color: c.textPrimary, border:'none' }}>
                <Download size={12}/> צוות CSV
              </button>
            </div>

            {/* Period selector */}
            <div style={{ display:'flex', gap:3, background: c.subtleBg,
              border: `1px solid ${c.cardBorder}`, borderRadius:10, padding:3 }}>
              {periodLabels.map(({ key, label }) => (
                <button key={key} onClick={() => setPeriod(key)} style={{
                  padding:'5px 12px', borderRadius:8, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:500, transition:'all 0.15s',
                  background: period === key ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                  color: period === key ? '#fff' : '#64748b',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14, marginBottom:20 }}>
        <KpiCard label="סה״כ לידים"      value={kpis.total}                accent="#6366f1" icon={Users}
          sub={`בתקופה: ${periodLabels.find(p => p.key === period)?.label}`}/>
        <KpiCard label="לקוחות פעילים"   value={kpis.active.length}        accent="#10b981" icon={CheckCircle}
          sub={`מתוך ${kpis.total} לידים`}/>
        <KpiCard label="הכנסה חודשית"    value={fmtMoney(kpis.revenue)}    accent="#f97316" icon={DollarSign}
          sub={`פייפליין: ${fmtMoney(kpis.pipeVal)}`}/>
        <KpiCard label="שיעור המרה"       value={fmtPct(kpis.closeRate)}    accent="#8b5cf6" icon={Target}
          sub="מלידים רלוונטיים"/>
        <KpiCard label="ציון AI ממוצע"   value={`${kpis.avgScore}%`}       accent="#06b6d4" icon={Brain}
          sub={`${filteredLeads.filter(l => l.aiScore >= 75).length} לידים חמים`}/>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
        <div style={{ overflowX:'auto', paddingBottom:4 }} dir="rtl">
          <div style={{ display:'flex', gap:4, background: c.subtleBg,
            border: `1px solid ${c.cardBorder}`, borderRadius:14, padding:4, width:'fit-content' }}>
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'8px 16px', borderRadius:10, border:'none', cursor:'pointer',
                fontSize:13, fontWeight:600, transition:'all 0.15s', whiteSpace:'nowrap',
                background: tab === key ? 'rgba(99,102,241,0.22)' : 'transparent',
                color:      tab === key ? '#818cf8' : 'rgba(255,255,255,0.4)',
                boxShadow:  tab === key ? '0 0 0 1px rgba(99,102,241,0.4)' : 'none',
              }}>
                <Icon size={14}/>{label}
              </button>
            ))}
          </div>
        </div>
        {/* Per-tab Excel export */}
        <div style={{ display:'flex', justifyContent:'flex-start' }}>
          <button
            onClick={() => {
              if      (tab === 'overview')    exportOverviewData(filteredLeads);
              else if (tab === 'funnel')      exportFunnelData(filteredLeads);
              else if (tab === 'leads')       exportLeads(filteredLeads);
              else if (tab === 'revenue')     exportRevenue(filteredLeads);
              else if (tab === 'team')        exportTeam(filteredLeads);
              else if (tab === 'sources')     exportSourcesData(filteredLeads);
              else if (tab === 'objections')  exportObjectionsData(filteredLeads);
              else if (tab === 'media')       exportMediaData(filteredLeads);
              else if (tab === 'crm')         exportCRMData(crmData);
            }}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:10,
              fontSize:12, fontWeight:700, cursor:'pointer', transition:'all 0.15s',
              background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.25)',
              color:'#6ee7b7' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.22)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,185,129,0.12)'; }}>
            <Download size={13}/> הורד Excel
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

          {/* Monthly trend */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <div style={{ display:'flex', gap:16, fontSize:11, color: c.textMuted }}>
                {[
                  { label:'לידים',      color:'#6366f1' },
                  { label:'לקוחות',     color:'#22c55e' },
                  { label:'הכנסות K₪', color:'#8b5cf6' },
                ].map(({ label, color }) => (
                  <span key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:color, display:'inline-block' }}/>
                    {label}
                  </span>
                ))}
              </div>
              <SectionHeader title="מגמה חודשית" sub="6 חודשים אחרונים" icon={TrendingUp} color="#6366f1"/>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyTrend} margin={{ top:4, right:4, left:-20, bottom:0 }}>
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
                <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={24}/>
                <Tooltip {...tooltipStyle}/>
                <Area type="monotone" dataKey="לידים"   stroke="#6366f1" fill="url(#gLead)" strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="לקוחות"  stroke="#22c55e" fill="url(#gAct)"  strokeWidth={2} dot={false}/>
                <Area type="monotone" dataKey="הכנסות" stroke="#8b5cf6" fill="none" strokeWidth={2}
                  strokeDasharray="5 3" dot={{ fill:'#8b5cf6', r:3 }}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Status + Funnel + Source */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap:16 }}>
            {/* Status donut */}
            <div style={{ ...glass, padding:20 }}>
              <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
                חלוקת סטטוסים
              </h3>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
                  {statusData.map(d => (
                    <div key={d.name}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                        <span style={{ fontWeight:700, color:d.color }}>{d.value}</span>
                        <span style={{ color: c.textSecondary }}>{d.name}</span>
                      </div>
                      <div style={{ height:6, borderRadius:3, overflow:'hidden', background: c.subtleBg }}>
                        <div style={{ height:'100%', borderRadius:3, transition:'width 0.7s',
                          width:`${filteredLeads.length ? (d.value / filteredLeads.length) * 100 : 0}%`,
                          background:d.color }}/>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ width:90, height:90, flexShrink:0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" cx="50%" cy="50%"
                        outerRadius={42} innerRadius={24} paddingAngle={2}>
                        {statusData.map((d, i) => <Cell key={i} fill={d.color} stroke="none"/>)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Funnel bars */}
            <div style={{ ...glass, padding:20 }}>
              <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
                משפך מכירות
              </h3>
              <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:120 }}>
                {funnel.map((s, i) => {
                  const max  = Math.max(...funnel.map(f => f.count), 1);
                  const pct  = (s.count / max) * 100;
                  const conv = i > 0 && funnel[i-1].count > 0
                    ? Math.round((s.count / funnel[i-1].count) * 100) : null;
                  return (
                    <div key={s.status} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      {conv !== null && (
                        <span style={{ fontSize:10, color: c.textMuted }}>↓{conv}%</span>
                      )}
                      <div style={{ width:'100%', display:'flex', alignItems:'flex-end', height:80 }}>
                        <div style={{ width:'100%', borderRadius:'6px 6px 0 0', transition:'height 0.5s',
                          height:`${Math.max(pct, 8)}%`, background:s.color, opacity:0.85 }}/>
                      </div>
                      <span style={{ fontSize:16, fontWeight:900, color: c.textPrimary }}>{s.count}</span>
                      <span style={{ fontSize:10, textAlign:'center', color: c.textMuted }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Source bar */}
            <div style={{ ...glass, padding:20 }}>
              <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
                לידים לפי מקור
              </h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={sourceStats.slice(0, 5)} layout="vertical" margin={{ right:0, left:0 }}>
                  <XAxis type="number" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="src" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }}
                    width={65} axisLine={false} tickLine={false}/>
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [v, 'לידים']}/>
                  <Bar dataKey="total" fill="#6366f1" radius={[0, 6, 6, 0]} maxBarSize={14}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Smart insights */}
          <div style={{ ...glass, padding:20, background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.18)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, justifyContent:'flex-end' }}>
              <h3 style={{ margin:0, fontWeight:700, color: c.textPrimary, fontSize:15 }}>תובנות חכמות</h3>
              <Sparkles size={15} color="#818cf8"/>
            </div>
            {insights.length === 0 ? (
              <p style={{ textAlign:'right', color: c.textMuted, fontSize:13, margin:0 }}>
                אין מספיק נתונים לתובנות
              </p>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:10 }}>
                {insights.map((ins, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'12px 16px',
                    textAlign:'right', background: c.subtleBg, border: `1px solid ${c.cardBorder}`,
                    borderRadius:12 }}>
                    <span style={{ fontSize:18, flexShrink:0 }}>{ins.icon}</span>
                    <p style={{ fontSize:13, fontWeight:500, color:ins.color, margin:0 }}>{ins.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: FUNNEL                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'funnel' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

          {/* Detailed funnel */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="משפך המרה מפורט" sub="מעקב אחר ירידת לידים לאורך תהליך המכירה"
              icon={Activity} color="#6366f1"/>
            {filteredLeads.length === 0 ? <EmptyState message="אין לידים בתקופה שנבחרה"/> : (
              <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                {funnel.map((stage, idx) => {
                  const maxCount = Math.max(...funnel.map(f => f.count), 1);
                  const widthPct = Math.max(30, (stage.count / maxCount) * 100);
                  const dropPct  = idx > 0 && funnel[idx-1].count > 0
                    ? Math.round((1 - stage.count / funnel[idx-1].count) * 100) : null;
                  return (
                    <div key={stage.status}>
                      {dropPct !== null && (
                        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0 6px 24px' }}>
                          <ArrowDown size={14} color="#ef4444"/>
                          <span style={{ fontSize:12, color:'#ef4444', fontWeight:600 }}>נשירה: {dropPct}%</span>
                          <span style={{ fontSize:11, color:'#475569' }}>
                            ({funnel[idx-1].count - stage.count} לידים לא המשיכו)
                          </span>
                        </div>
                      )}
                      <div style={{ width:`${widthPct}%`, minWidth:180,
                        background:`linear-gradient(135deg,${stage.color}30,${stage.color}15)`,
                        border:`1px solid ${stage.color}40`, borderRadius:12, padding:'14px 20px',
                        display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:10, height:10, borderRadius:'50%', background:stage.color,
                            boxShadow:`0 0 8px ${stage.color}` }}/>
                          <span style={{ color: c.textPrimary, fontWeight:600, fontSize:14 }}>{stage.label}</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:20 }}>
                          <span style={{ color:stage.color, fontWeight:700, fontSize:20 }}>{stage.count}</span>
                          {stage.revenue > 0 && (
                            <span style={{ fontSize:12, color: c.textMuted, background: c.subtleBg,
                              padding:'2px 8px', borderRadius:6 }}>{fmtMoney(stage.revenue)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop:20, padding:'14px 20px', background:'rgba(99,102,241,0.08)',
                  border:'1px solid rgba(99,102,241,0.2)', borderRadius:12,
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color: c.textMuted, fontSize:13 }}>סה״כ שווי פייפליין</span>
                  <span style={{ color:'#6366f1', fontWeight:700, fontSize:18 }}>
                    {fmtMoney(filteredLeads.reduce((s, l) => s + (l.budget ?? 0), 0))}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Win/Loss */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:20 }}>
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="מה עובד" sub="הצלחות ונקודות חוזק" icon={CheckCircle} color="#10b981"/>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {winLoss.byRevenue.slice(0, 2).map(({ status, revenue }) => (
                  <InsightRow key={status} icon={<Star size={14} color={NEON[status]}/>}
                    label={`סטטוס ${status}`} value={fmtMoney(revenue)} color="#10b981"/>
                ))}
                {winLoss.bestSrc && (
                  <InsightRow icon={<Zap size={14} color="#10b981"/>}
                    label="מקור הלידים הטוב ביותר"
                    value={`${winLoss.bestSrc.src} (${fmtPct(winLoss.bestSrc.conv)})`} color="#10b981"/>
                )}
                <InsightRow icon={<Clock size={14} color="#10b981"/>}
                  label="ממוצע ימים לסגירה"
                  value={`${winLoss.avgDaysToClose} ימים`} color="#10b981"/>
              </div>
            </div>
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="מה לשפר" sub="הזדמנויות לשיפור" icon={AlertTriangle} color="#f97316"/>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <InsightRow icon={<Clock size={14} color="#ef4444"/>}
                  label={`לידים ״תקועים״ (מעל 14 יום)`}
                  value={`${winLoss.stale.length} לידים • ${fmtMoney(winLoss.staleRevenue)} בסיכון`}
                  color="#ef4444"/>
                {winLoss.worstSrc && winLoss.worstSrc.conv < 15 && (
                  <InsightRow icon={<TrendingDown size={14} color="#f97316"/>}
                    label="מקור עם המרה נמוכה"
                    value={`${winLoss.worstSrc.src} (${fmtPct(winLoss.worstSrc.conv)})`} color="#f97316"/>
                )}
                <InsightRow icon={<Activity size={14} color="#f97316"/>}
                  label="ציון AI ממוצע לא-ממירים"
                  value={`${winLoss.avgAiScore} / 100`} color="#f97316"/>
              </div>
            </div>
          </div>

          {/* Time by status */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="זמן מאז עדכון אחרון לפי סטטוס" sub="ממוצע ימים"
              icon={Clock} color="#8b5cf6"/>
            {timeByStatus.length === 0 ? <EmptyState message="אין נתונים"/> : (
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {timeByStatus.map(({ status, avg, count, color }) => {
                  const pct     = Math.min(100, (avg / 30) * 100);
                  const urgency = avg > 20 ? '#ef4444' : avg > 10 ? '#f59e0b' : color;
                  return (
                    <div key={status}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:8, height:8, borderRadius:'50%', background:color }}/>
                          <span style={{ fontSize:13, color: c.textPrimary }}>{status}</span>
                          <span style={{ fontSize:11, color:'#475569' }}>({count} לידים)</span>
                        </div>
                        <span style={{ fontSize:13, fontWeight:600, color:urgency }}>{avg} ימים</span>
                      </div>
                      <div style={{ height:6, borderRadius:3, background: c.subtleBg, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${pct}%`, borderRadius:3,
                          background:`linear-gradient(90deg,${urgency}80,${urgency})`, transition:'width 0.6s' }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Revenue by status bar */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="הכנסה לפי סטטוס" sub="פירוט תקציב לפי שלב בצינור"
              icon={DollarSign} color="#f97316"/>
            {filteredLeads.length === 0 ? <EmptyState message="אין נתונים"/> : (() => {
              const barData = Object.entries(NEON).map(([status, color]) => ({
                status, color,
                revenue: filteredLeads.filter(l => l.status === status).reduce((s, l) => s + (l.budget ?? 0), 0),
              })).filter(d => d.revenue > 0);
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} barSize={36}>
                    <XAxis dataKey="status" tick={{ fill:'#64748b', fontSize:12 }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fill:'#64748b', fontSize:11 }} axisLine={false} tickLine={false}
                      tickFormatter={v => v >= 1000 ? `${v/1000}K` : String(v)} width={48}/>
                    <Tooltip {...tooltipStyle}/>
                    <Bar dataKey="revenue" name="הכנסה" radius={[6,6,0,0]}>
                      {barData.map((entry, idx) => <Cell key={idx} fill={entry.color} fillOpacity={0.85}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: LEADS TABLE                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'leads' && (
        <div style={{ ...glass, overflow:'hidden' }}>
          {/* Toolbar */}
          <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between',
            gap:12, padding:'16px 20px', borderBottom: `1px solid ${c.divider}`,
            background:'rgba(10,15,30,0.88)', backdropFilter:'blur(16px)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button onClick={() => exportLeads(sortedLeads)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:10,
                  fontSize:12, fontWeight:700, cursor:'pointer', border:'none',
                  background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color: c.textPrimary }}>
                <Download size={12}/> ייצוא CSV ({sortedLeads.length})
              </button>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
              <span style={{ fontSize:12, color: c.textMuted }}>{sortedLeads.length} לידים</span>
              {(['הכל', ...Object.keys(STATUS_COLORS)] as string[]).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  fontSize:11, padding:'4px 10px', borderRadius:8, cursor:'pointer',
                  fontWeight:600, transition:'all 0.15s',
                  background: statusFilter === s ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.05)',
                  border:     statusFilter === s ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  color:      statusFilter === s ? '#818cf8' : 'rgba(255,255,255,0.4)',
                }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.divider}` }}>
                  {([
                    { col:'company',    label:'חברה'      },
                    { col:'status',     label:'סטטוס'     },
                    { col:'budget',     label:'תקציב'     },
                    { col:'aiScore',    label:'ציון AI'   },
                    { col:'lastUpdate', label:'עדכון אחרון'},
                  ] as { col: typeof sortCol; label: string }[]).map(h => (
                    <th key={h.col} onClick={() => toggleSort(h.col)}
                      style={{ padding:'12px 16px', textAlign:'right', fontSize:11, fontWeight:700, cursor:'pointer',
                        color: c.textMuted, textTransform:'uppercase', letterSpacing:'0.05em',
                        userSelect:'none', whiteSpace:'nowrap' }}>
                      {h.label}
                      {sortCol === h.col && (
                        <ChevronDown size={11} style={{ marginRight:4, display:'inline',
                          transform: sortDir === 'asc' ? 'rotate(180deg)' : undefined }}/>
                      )}
                    </th>
                  ))}
                  {['מקור','אחראי','ימים מאז'].map(h => (
                    <th key={h} style={{ padding:'12px 16px', textAlign:'right', fontSize:11, fontWeight:700,
                      color: c.textMuted, textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((lead, i) => {
                  const stale = daysSince(lead.lastUpdate);
                  const scoreColor = lead.aiScore >= 75
                    ? { background:'rgba(34,197,94,0.15)', color:'#4ade80' }
                    : lead.aiScore >= 50
                      ? { background:'rgba(245,158,11,0.15)', color:'#fbbf24' }
                      : { background: c.subtleBg, color: c.textMuted };
                  return (
                    <tr key={lead.id}
                      onClick={() => onLeadClick?.(lead)}
                      style={{ borderBottom: `1px solid ${c.divider}`,
                        background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        cursor: onLeadClick ? 'pointer' : 'default', transition:'background 0.1s' }}
                      onMouseEnter={e => { if (onLeadClick) e.currentTarget.style.background = 'rgba(99,102,241,0.07)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)'; }}>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ fontWeight:600, color: c.textPrimary }}>{lead.company}</div>
                        <div style={{ fontSize:11, color: c.textMuted }}>{lead.contactName}</div>
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20,
                          color: STATUS_COLORS[lead.status as LeadStatus],
                          background: STATUS_COLORS[lead.status as LeadStatus] + '18' }}>
                          {lead.status}
                        </span>
                      </td>
                      <td style={{ padding:'12px 16px', fontWeight:700, color: c.textPrimary }}>
                        {fmtMoney(lead.budget ?? 0)}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, ...scoreColor }}>
                          {lead.aiScore}%
                        </span>
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color: c.textMuted }}>
                        {lead.lastUpdate}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color: c.textMuted }}>
                        {lead.source}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:12, color: c.textMuted }}>
                        {lead.assignedTo || '—'}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:12, fontWeight:700,
                          color: stale >= 14 ? '#f87171' : stale >= 7 ? '#fbbf24' : '#4ade80' }}>
                          {stale} ימים
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {sortedLeads.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign:'center', padding:'48px 0', fontSize:14,
                      color: c.textMuted }}>
                      אין לידים תואמים לסינון שנבחר
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: REVENUE                                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'revenue' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14 }}>
            <KpiCard label="הכנסה חודשית"      value={fmtMoney(kpis.revenue)}  accent="#22c55e" icon={DollarSign}
              sub={`${kpis.active.length} לקוחות פעילים`}/>
            <KpiCard label="פוטנציאל פייפליין" value={fmtMoney(kpis.pipeVal)}  accent="#6366f1" icon={TrendingUp}
              sub={`${kpis.pipeline.length} לידים בתהליך`}/>
            <KpiCard label="ערך לקוח ממוצע"   value={fmtMoney(kpis.avgDeal)}  accent="#f59e0b" icon={Star}
              sub="ממוצע חודשי"/>
            <KpiCard label="שיעור המרה"         value={fmtPct(kpis.closeRate)}  accent="#8b5cf6" icon={Zap}
              sub="לידים → לקוחות"/>
          </div>

          {/* Revenue trend area */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
              <button onClick={() => exportRevenue(filteredLeads)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:10,
                  fontSize:12, fontWeight:600, cursor:'pointer',
                  background: c.subtleBg, border: `1px solid ${c.cardBorder}`,
                  color: c.textMuted }}>
                <Download size={11}/> CSV
              </button>
              <SectionHeader title="מגמת הכנסות" sub="6 חודשים אחרונים — הכנסה קיימת vs פוטנציאל"
                icon={TrendingUp} color="#10b981"/>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradPotential" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                <XAxis dataKey="name" tick={{ fill:'#64748b', fontSize:12 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:'#64748b', fontSize:11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${v/1000}K` : String(v)} width={45}/>
                <Tooltip {...tooltipStyle}/>
                <Area type="monotone" dataKey="actual"    name="הכנסה קיימת" stroke="#10b981" strokeWidth={2} fill="url(#gradActual)"/>
                <Area type="monotone" dataKey="potential" name="פוטנציאל"    stroke="#6366f1" strokeWidth={2} fill="url(#gradPotential)"/>
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display:'flex', gap:20, marginTop:8, justifyContent:'center' }}>
              {[{ label:'הכנסה קיימת', color:'#10b981' }, { label:'פוטנציאל', color:'#6366f1' }].map(({ label, color }) => (
                <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:color }}/>
                  <span style={{ fontSize:12, color:'#64748b' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue by source + monthly bar */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:20 }}>
            {/* Source revenue bars */}
            <div style={{ ...glass, padding:20 }}>
              <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
                מכירות לפי מקור
              </h3>
              {sourceStats.length === 0 ? <EmptyState message="אין נתונים"/> : (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {sourceStats.map(s => {
                    const maxRev = Math.max(...sourceStats.map(x => x.rev), 1);
                    return (
                      <div key={s.src} style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <div style={{ width:36, textAlign:'left' }}>
                          <span style={{ fontSize:12, fontWeight:700, color: c.accentText }}>{s.conv}%</span>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:5 }}>
                            <span style={{ color: c.textMuted }}>
                              {s.total} לידים · {s.active} פעילים · {fmtMoney(s.rev)}/חודש
                            </span>
                            <span style={{ fontWeight:600, color: c.textSecondary }}>{s.src}</span>
                          </div>
                          <div style={{ height:8, borderRadius:4, overflow:'hidden', background: c.subtleBg }}>
                            <div style={{ height:'100%', borderRadius:4, transition:'width 0.7s',
                              width:`${(s.rev/maxRev)*100}%`,
                              background:'linear-gradient(90deg,#6366f1,#8b5cf6)' }}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Monthly bar chart */}
            <div style={{ ...glass, padding:20 }}>
              <h3 style={{ margin:'0 0 16px', fontWeight:700, color: c.textPrimary, fontSize:14, textAlign:'right' }}>
                הכנסות חודשיות (K₪)
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyTrend} margin={{ top:4, right:4, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                  <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={30}/>
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`₪${v}K`, 'הכנסות']}/>
                  <Bar dataKey="הכנסות" radius={[6,6,0,0]} maxBarSize={40}>
                    {monthlyTrend.map((_, i) => (
                      <Cell key={i} fill={i === monthlyTrend.length - 1 ? '#6366f1' : 'rgba(99,102,241,0.3)'}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Source ROI table */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="ROI לפי מקור" sub="השוואת מקורות לידים לפי יעילות"
              icon={Award} color="#f97316"/>
            {sourceROI.length === 0 ? <EmptyState message="אין נתונים"/> : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr>
                      {['מקור','לידים','לקוחות','המרה %','הכנסה'].map(h => (
                        <th key={h} style={{ padding:'8px 12px', textAlign:'right', color:'#64748b',
                          fontWeight:600, borderBottom: `1px solid ${c.divider}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sourceROI.map((row, idx) => {
                      const convColor = row.conv >= 30 ? '#10b981' : row.conv >= 15 ? '#f59e0b' : '#ef4444';
                      return (
                        <tr key={row.src} style={{ borderBottom: `1px solid ${c.divider}`,
                          background: idx === 0 ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                          <td style={{ padding:'12px 12px', color: c.textPrimary, fontWeight: idx===0 ? 700 : 400 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              {row.src}
                              {idx === 0 && (
                                <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:20,
                                  background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }}>
                                  מוביל
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding:'12px 12px', color: c.textMuted, textAlign:'center' }}>{row.count}</td>
                          <td style={{ padding:'12px 12px', color:'#10b981', textAlign:'center', fontWeight:600 }}>{row.active}</td>
                          <td style={{ padding:'12px 12px', textAlign:'center' }}>
                            <span style={{ color:convColor, background:`${convColor}18`,
                              border:`1px solid ${convColor}30`, padding:'2px 10px', borderRadius:20,
                              fontWeight:600, fontSize:12 }}>
                              {fmtPct(row.conv)}
                            </span>
                          </td>
                          <td style={{ padding:'12px 12px', color: c.textPrimary, fontWeight:600, textAlign:'right' }}>
                            {row.revenue > 0 ? fmtMoney(row.revenue) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top active clients */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="לקוחות מובילים" sub="לפי הכנסה חודשית" icon={Star} color="#f59e0b"/>
            {kpis.active.length === 0 ? <EmptyState message="אין לקוחות פעילים בתקופה"/> : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[...kpis.active].sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0)).slice(0, 10).map((lead, i) => {
                  const max = Math.max(...kpis.active.map(l => l.budget ?? 0), 1);
                  return (
                    <div key={lead.id} onClick={() => onLeadClick?.(lead)}
                      style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:12,
                        background: c.subtleBg, cursor: onLeadClick ? 'pointer' : 'default',
                        transition:'background 0.1s' }}
                      onMouseEnter={e => { if (onLeadClick) e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                      <div style={{ width:24, height:24, borderRadius:8, display:'flex', alignItems:'center',
                        justifyContent:'center', fontSize:10, fontWeight:900, flexShrink:0,
                        background: i < 3 ? ['rgba(251,191,36,0.2)','rgba(148,163,184,0.2)','rgba(249,115,22,0.2)'][i] : 'rgba(255,255,255,0.08)',
                        color: i < 3 ? ['#fbbf24','#94a3b8','#f97316'][i] : 'rgba(255,255,255,0.4)' }}>
                        {i+1}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:13 }}>
                          <span style={{ fontWeight:900, color:'#4ade80' }}>{fmtMoney(lead.budget??0)}/חודש</span>
                          <span style={{ fontWeight:600, color: c.textPrimary, overflow:'hidden', textOverflow:'ellipsis',
                            whiteSpace:'nowrap', maxWidth:180, marginRight:8 }}>{lead.company}</span>
                        </div>
                        <div style={{ height:6, borderRadius:3, overflow:'hidden', background: c.subtleBg }}>
                          <div style={{ height:'100%', borderRadius:3,
                            width:`${((lead.budget??0)/max)*100}%`,
                            background:'linear-gradient(90deg,#10b981,#34d399)' }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: TEAM                                                             */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'team' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button onClick={() => exportTeam(filteredLeads)}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10,
                fontSize:13, fontWeight:700, cursor:'pointer', border:'none',
                background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color: c.textPrimary }}>
              <Download size={13}/> ייצוא דוח צוות
            </button>
          </div>

          {teamStats.length === 0 ? (
            <div style={{ ...glass, padding:'48px 20px', textAlign:'center' }}>
              <Users size={40} color="#334155" style={{ margin:'0 auto 12px' }}/>
              <p style={{ color: c.textMuted, margin:0, fontSize:14 }}>אין נתוני צוות בתקופה שנבחרה</p>
            </div>
          ) : (
            <>
              {/* Team KPIs */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:14 }}>
                <KpiCard label="חברי צוות פעילים"  value={teamStats.length}
                  accent="#6366f1" icon={Users}/>
                <KpiCard label="סה״כ לקוחות פעילים" value={teamStats.reduce((s, t) => s + t.active, 0)}
                  accent="#22c55e" icon={Target}/>
                <KpiCard label="ממוצע המרה"
                  value={`${teamStats.length ? Math.round(teamStats.reduce((s, t) => s + t.conv, 0) / teamStats.length) : 0}%`}
                  accent="#f59e0b" icon={Award}/>
                <KpiCard label="סה״כ הכנסה"          value={fmtMoney(teamStats.reduce((s, t) => s + t.rev, 0))}
                  accent="#8b5cf6" icon={DollarSign}/>
              </div>

              {/* Leaderboard */}
              <div style={{ ...glass, padding:'24px 28px' }}>
                <SectionHeader title="לוח מובילים" sub="דירוג לפי הכנסה" icon={Award} color="#f59e0b"/>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {teamStats.map((agent, i) => {
                    const maxRev = teamStats[0]?.rev || 1;
                    const medals = ['🥇','🥈','🥉'];
                    return (
                      <div key={agent.name} style={{ borderRadius:14, padding:16, transition:'all 0.2s',
                        border: i === 0 ? '1px solid rgba(251,191,36,0.25)' : i === 1 ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(255,255,255,0.07)',
                        background: i === 0 ? 'rgba(251,191,36,0.06)' : i === 1 ? 'rgba(148,163,184,0.04)' : 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                          <span style={{ fontSize:22, width:28, textAlign:'center', flexShrink:0 }}>
                            {medals[i] || `#${i+1}`}
                          </span>
                          <div style={{ flex:1 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                              <div style={{ display:'flex', gap:16, fontSize:12 }}>
                                <span style={{ color:'#4ade80', fontWeight:700 }}>{fmtMoney(agent.rev)}/חודש</span>
                                <span style={{ color: c.accentText, fontWeight:700 }}>{agent.conv}% המרה</span>
                                <span style={{ color: c.textMuted }}>ציון AI: {agent.avgScore}%</span>
                              </div>
                              <p style={{ fontWeight:700, color: c.textPrimary, margin:0, fontSize:15 }}>{agent.name}</p>
                            </div>
                          </div>
                        </div>
                        {/* Stats grid */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap:8, marginBottom:12 }}>
                          {[
                            { value: agent.total,           label:'סה״כ לידים',    color: c.textPrimary   },
                            { value: agent.active,          label:'לקוחות פעילים', color:'#4ade80' },
                            { value: `${agent.conv}%`,      label:'שיעור המרה',    color: c.accentText },
                          ].map(({ value, label, color }) => (
                            <div key={label} style={{ borderRadius:10, padding:'10px 8px', textAlign:'center',
                              background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                              <div style={{ fontSize:20, fontWeight:900, color, marginBottom:2 }}>{value}</div>
                              <div style={{ fontSize:11, color: c.textMuted }}>{label}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ height:6, borderRadius:3, background: c.subtleBg, overflow:'hidden' }}>
                          <div style={{ height:'100%', borderRadius:3, transition:'width 0.6s',
                            width:`${(agent.rev / maxRev) * 100}%`,
                            background:'linear-gradient(90deg,#6366f1,#8b5cf6)' }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Team chart */}
              <div style={{ ...glass, padding:'24px 28px' }}>
                <SectionHeader title="השוואת ביצועים" sub="לידים ולקוחות לפי חבר צוות" icon={BarChart2} color="#6366f1"/>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={teamStats} margin={{ top:0, right:0, left:-20, bottom:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                    <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={24}/>
                    <Tooltip {...tooltipStyle}/>
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ color: c.textSecondary, fontSize:11 }}/>
                    <Bar dataKey="total"  name="סה״כ לידים"       fill="#6366f1" opacity={0.4} radius={[4,4,0,0]} maxBarSize={32}/>
                    <Bar dataKey="active" name="לקוחות פעילים"   fill="#22c55e"              radius={[4,4,0,0]} maxBarSize={32}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: SOURCES ROI                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'sources' && (
        <SourcesAnalysis leads={filteredLeads} workspaceId={workspaceId}/>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OBJECTIONS                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'objections' && (
        <div style={{ display:'grid', gap:20 }}>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:14 }}>
            <KpiCard label="לא רלוונטי"        value={objectionLeads.length}  accent="#64748b" icon={AlertTriangle} sub="סה״כ"/>
            <KpiCard label="עם סיבה מוגדרת"    value={objectionData.reduce((s,o)=>s+o.value,0)} accent="#f97316" icon={Activity} sub="תועד ביומן"/>
            <KpiCard label="סוגי התנגדויות"     value={objectionData.length}   accent="#8b5cf6" icon={Star} sub="ייחודיים"/>
            <KpiCard label="ללא תיעוד"          value={objectionLeads.filter(l=>!l.objection).length} accent="#ef4444" icon={AlertTriangle} sub="לא סווגו"/>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:20 }}>
            {/* Pie chart */}
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="חלוקת התנגדויות" sub="לפי סוג" icon={PieChartIcon} color="#ef4444"/>
              {objectionData.length === 0 ? (
                <div style={{ textAlign:'center', color: c.textMuted, padding:'40px 0' }}>
                  <div style={{ fontSize:32 }}>✅</div>
                  <div style={{ marginTop:8 }}>אין לידים עם התנגדות מוגדרת</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={objectionData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85} paddingAngle={3} label={({ name, percent }) => `${name} ${Math.round(percent*100)}%`}
                      labelLine={false}>
                      {objectionData.map((_, i) => (
                        <Cell key={i} fill={['#ef4444','#f97316','#f59e0b','#8b5cf6','#3b82f6'][i % 5]}/>
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'white', fontSize:12 }}/>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Bar chart by objection */}
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="כמות לפי התנגדות" sub="השוואה" icon={BarChart2} color="#f97316"/>
              {objectionData.length === 0 ? (
                <div style={{ textAlign:'center', color: c.textMuted, padding:'40px 0' }}>אין נתונים</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={objectionData} layout="vertical" margin={{ top:0, right:16, left:0, bottom:0 }}>
                    <XAxis type="number" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                    <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.5)' }} axisLine={false} tickLine={false} width={110}/>
                    <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'white', fontSize:12 }}/>
                    <Bar dataKey="value" name="לידים" radius={[0,6,6,0]} maxBarSize={24}
                      fill="url(#objGrad)"/>
                    <defs>
                      <linearGradient id="objGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6}/>
                        <stop offset="100%" stopColor="#f97316"/>
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Table of objection leads */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="לידים לא רלוונטיים" sub="רשימה מלאה עם סיבת התנגדות" icon={Table} color="#64748b"/>
            <div style={{ overflowX:'auto', marginTop:16 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${c.divider}` }}>
                    {['חברה','איש קשר','מקור','התנגדות','תאריך'].map(h => (
                      <th key={h} style={{ padding:'8px 12px', textAlign:'right', color: c.textMuted, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {objectionLeads.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign:'center', padding:'32px', color: c.textMuted }}>אין לידים לא רלוונטיים</td></tr>
                  ) : objectionLeads.map(l => (
                    <tr key={l.id} style={{ borderBottom:`1px solid ${c.divider}` }}
                      onClick={() => onLeadClick?.(l)}
                      onMouseEnter={e => (e.currentTarget.style.background='rgba(255,255,255,0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background='transparent')}
                      className="cursor-pointer transition-colors">
                      <td style={{ padding:'10px 12px', color: c.textPrimary, fontWeight:600 }}>{l.company}</td>
                      <td style={{ padding:'10px 12px', color: c.textSecondary }}>{l.contactName}</td>
                      <td style={{ padding:'10px 12px', color: c.textMuted }}>{l.source}</td>
                      <td style={{ padding:'10px 12px' }}>
                        {l.objection ? (
                          <span style={{ background:'rgba(239,68,68,0.15)', color:'#f87171', border:'1px solid rgba(239,68,68,0.25)',
                            padding:'2px 10px', borderRadius:99, fontSize:11, fontWeight:600 }}>
                            {l.objection}
                          </span>
                        ) : (
                          <span style={{ color: c.textMuted, fontSize:11 }}>לא צוין</span>
                        )}
                      </td>
                      <td style={{ padding:'10px 12px', color: c.textMuted, fontSize:11 }}>{l.lastUpdate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: MEDIA REPORT                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'media' && (
        <div style={{ display:'grid', gap:20 }}>
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="דוח מדיה" sub="ביצועי ערוצי שיווק לפי מקור הגעה" icon={BarChart2} color="#6366f1"/>

            {/* KPI by source */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12, marginTop:20 }}>
              {ALL_SOURCES.map(src => {
                const srcLeads = filteredLeads.filter(l => l.source === src);
                const active = srcLeads.filter(l => l.status === 'לקוח פעיל');
                const revenue = active.reduce((s,l) => s+(l.budget||0), 0);
                const conv = srcLeads.length > 0 ? Math.round((active.length/srcLeads.length)*100) : 0;
                const color = SOURCE_COLORS[src] || '#6366f1';
                return (
                  <div key={src} style={{ background:`${color}10`, border:`1px solid ${color}25`,
                    borderRadius:12, padding:'14px 16px' }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{SOURCE_EMOJI[src]}</div>
                    <div style={{ fontSize:11, color: c.textMuted, marginBottom:2 }}>{src}</div>
                    <div style={{ fontSize:22, fontWeight:800, color }}>
                      {srcLeads.length}
                    </div>
                    <div style={{ fontSize:10, color: c.textMuted }}>לידים</div>
                    <div style={{ marginTop:8, fontSize:11 }}>
                      <span style={{ color:'#22c55e', fontWeight:600 }}>{conv}%</span>
                      <span style={{ color: c.textMuted }}> המרה</span>
                    </div>
                    {revenue > 0 && (
                      <div style={{ fontSize:11, color: c.textMuted, marginTop:2 }}>
                        ₪{(revenue/1000).toFixed(0)}K הכנסה
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leads by source over time */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:20 }}>
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="לידים לפי מקור" sub="השוואה" icon={PieChartIcon} color="#6366f1"/>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={ALL_SOURCES.map(src => ({
                    name: src,
                    value: filteredLeads.filter(l=>l.source===src).length,
                  })).filter(d=>d.value>0)}
                    dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={60} outerRadius={90} paddingAngle={2}>
                    {ALL_SOURCES.map((src, i) => (
                      <Cell key={src} fill={SOURCE_COLORS[src] || ['#6366f1','#8b5cf6','#10b981','#f59e0b','#ef4444','#3b82f6'][i % 6]}/>
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'white', fontSize:12 }}/>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: c.textSecondary, fontSize:11 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="שיעור המרה לפי מקור" sub="% לקוחות פעילים" icon={Target} color="#10b981"/>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={ALL_SOURCES.map(src => {
                  const srcLeads = filteredLeads.filter(l=>l.source===src);
                  const active = srcLeads.filter(l=>l.status==='לקוח פעיל').length;
                  return {
                    name: src.length > 6 ? src.slice(0,6)+'…' : src,
                    המרה: srcLeads.length>0 ? Math.round((active/srcLeads.length)*100) : 0,
                    לידים: srcLeads.length,
                  };
                })} margin={{ top:0, right:0, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                  <XAxis dataKey="name" tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={28}/>
                  <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'white', fontSize:12 }}/>
                  <Bar dataKey="המרה" name="% המרה" fill="#10b981" opacity={0.85} radius={[4,4,0,0]} maxBarSize={32}/>
                  <Bar dataKey="לידים" name="לידים" fill="#6366f1" opacity={0.5} radius={[4,4,0,0]} maxBarSize={32}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed table */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="טבלת מדיה מפורטת" sub="כל המקורות עם מדדי ביצוע" icon={Table} color="#8b5cf6"/>
            <div style={{ overflowX:'auto', marginTop:16 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${c.divider}` }}>
                    {['מקור','לידים','לקוחות פעילים','% המרה','הכנסה','ממוצע לליד'].map(h => (
                      <th key={h} style={{ padding:'8px 12px', textAlign:'right', color: c.textMuted, fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_SOURCES.map(src => {
                    const srcLeads = filteredLeads.filter(l=>l.source===src);
                    const active = srcLeads.filter(l=>l.status==='לקוח פעיל');
                    const revenue = active.reduce((s,l)=>s+(l.budget||0),0);
                    const conv = srcLeads.length>0 ? Math.round((active.length/srcLeads.length)*100) : 0;
                    const avg = active.length>0 ? Math.round(revenue/active.length) : 0;
                    const color = SOURCE_COLORS[src] || '#6366f1';
                    return (
                      <tr key={src} style={{ borderBottom:`1px solid ${c.divider}` }}>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ background:`${color}20`, color, border:`1px solid ${color}30`,
                              padding:'2px 8px', borderRadius:99, fontSize:11, fontWeight:700 }}>
                              {SOURCE_EMOJI[src]} {src}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding:'10px 12px', color: c.textPrimary, fontWeight:700 }}>{srcLeads.length}</td>
                        <td style={{ padding:'10px 12px', color:'#22c55e', fontWeight:600 }}>{active.length}</td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ color: conv>30 ? '#22c55e' : conv>15 ? '#f59e0b' : '#f87171', fontWeight:700 }}>
                            {conv}%
                          </span>
                        </td>
                        <td style={{ padding:'10px 12px', color: c.textPrimary, fontWeight:600 }}>
                          {revenue>0 ? `₪${(revenue/1000).toFixed(1)}K` : '—'}
                        </td>
                        <td style={{ padding:'10px 12px', color: c.textMuted }}>
                          {avg>0 ? `₪${avg.toLocaleString()}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CRM RELATIONS                                                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'crm' && (
        <div style={{ display:'grid', gap:20 }}>
          {/* Summary KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:14 }}>
            <KpiCard label="סה״כ פניות"        value={crmData.reduce((s,r)=>s+r.totalTouches,0)} accent="#6366f1" icon={Activity} sub="שיחות, מיילים, פגישות"/>
            <KpiCard label="לידים פעילים"       value={crmData.filter(r=>r.totalTouches>0).length} accent="#10b981" icon={Users} sub="עם לפחות פנייה אחת"/>
            <KpiCard label="פגישות קרובות"      value={crmData.filter(r=>r.nextMeeting).length}   accent="#8b5cf6" icon={Clock} sub="מתוכננות"/>
            <KpiCard label="דורשים מעקב"        value={crmData.filter(r=>r.isOverdue).length}      accent="#ef4444" icon={AlertTriangle} sub="עבר תאריך פנייה"/>
          </div>

          {/* Engagement distribution chart */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap:20 }}>
            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="סוגי אינטראקציות" sub="חלוקת ערוצי תקשורת" icon={PieChartIcon} color="#6366f1"/>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[
                    { name:'📞 שיחות',     value: crmData.reduce((s,r)=>s+r.calls,0) },
                    { name:'✉️ מיילים',    value: crmData.reduce((s,r)=>s+r.emails,0) },
                    { name:'💬 וואטסאפ',  value: crmData.reduce((s,r)=>s+r.waMsgs,0) },
                    { name:'📅 פגישות',   value: crmData.reduce((s,r)=>s+r.mtgDone,0) },
                  ].filter(d=>d.value>0)}
                    dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {['#6366f1','#10b981','#22c55e','#8b5cf6'].map((color, i) => (
                      <Cell key={i} fill={color}/>
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'white', fontSize:12 }}/>
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: c.textSecondary, fontSize:11 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...glass, padding:'24px 28px' }}>
              <SectionHeader title="לידים ללא פנייה" sub="לפי ימים ללא קשר" icon={AlertTriangle} color="#f97316"/>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={[
                  { range:'0-3 ימים',  count: crmData.filter(r=>r.daysSinceLast!==null && r.daysSinceLast!<=3).length },
                  { range:'4-7 ימים',  count: crmData.filter(r=>r.daysSinceLast!==null && r.daysSinceLast!>3 && r.daysSinceLast!<=7).length },
                  { range:'8-14 ימים', count: crmData.filter(r=>r.daysSinceLast!==null && r.daysSinceLast!>7 && r.daysSinceLast!<=14).length },
                  { range:'+14 ימים',  count: crmData.filter(r=>r.daysSinceLast!==null && r.daysSinceLast!>14).length },
                  { range:'אין קשר',   count: crmData.filter(r=>r.daysSinceLast===null).length },
                ]} margin={{ top:0, right:0, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false}/>
                  <XAxis dataKey="range" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:11, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={24}/>
                  <Tooltip contentStyle={{ background:'rgba(10,15,30,0.95)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'white', fontSize:12 }}/>
                  <Bar dataKey="count" name="לידים" radius={[4,4,0,0]} maxBarSize={36}>
                    {[0,1,2,3,4].map(i => (
                      <Cell key={i} fill={['#22c55e','#10b981','#f59e0b','#f97316','#64748b'][i]}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Full CRM table */}
          <div style={{ ...glass, padding:'24px 28px' }}>
            <SectionHeader title="דוח קשרי לקוחות" sub="פירוט אינטראקציות לכל ליד" icon={Table} color="#6366f1"/>
            <div style={{ overflowX:'auto', marginTop:16 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${c.divider}` }}>
                    {['חברה','סטטוס','📞','✉️','💬','📅','סה״כ','קשר אחרון','הבא','מעקב'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'right', color: c.textMuted, fontWeight:600, fontSize:11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crmData.map(({ lead: l, calls, emails, waMsgs, mtgDone, totalTouches, daysSinceLast, nextMeeting, isOverdue }) => (
                    <tr key={l.id}
                      onClick={() => onLeadClick?.(l)}
                      onMouseEnter={e => (e.currentTarget.style.background='rgba(255,255,255,0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background='transparent')}
                      style={{ borderBottom:`1px solid ${c.divider}`, cursor:'pointer', transition:'background 0.15s' }}>
                      <td style={{ padding:'10px 10px', color: c.textPrimary, fontWeight:600 }}>{l.company}</td>
                      <td style={{ padding:'10px 10px' }}>
                        <span style={{ background: `${NEON[l.status] ?? '#64748b'}20`, color: NEON[l.status] ?? '#94a3b8',
                          border:`1px solid ${NEON[l.status] ?? '#64748b'}30`,
                          padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>
                          {l.status}
                        </span>
                      </td>
                      <td style={{ padding:'10px 10px', textAlign:'center', color: calls>0 ? '#6366f1' : c.textMuted, fontWeight:calls>0?700:400 }}>{calls||'—'}</td>
                      <td style={{ padding:'10px 10px', textAlign:'center', color: emails>0 ? '#8b5cf6' : c.textMuted, fontWeight:emails>0?700:400 }}>{emails||'—'}</td>
                      <td style={{ padding:'10px 10px', textAlign:'center', color: waMsgs>0 ? '#22c55e' : c.textMuted, fontWeight:waMsgs>0?700:400 }}>{waMsgs||'—'}</td>
                      <td style={{ padding:'10px 10px', textAlign:'center', color: mtgDone>0 ? '#f59e0b' : c.textMuted, fontWeight:mtgDone>0?700:400 }}>{mtgDone||'—'}</td>
                      <td style={{ padding:'10px 10px', textAlign:'center', color: totalTouches>3 ? '#22c55e' : totalTouches>0 ? '#f59e0b' : '#ef4444', fontWeight:700 }}>{totalTouches||'—'}</td>
                      <td style={{ padding:'10px 10px', color: c.textMuted, fontSize:11 }}>
                        {daysSinceLast !== null ? `לפני ${daysSinceLast}י` : 'אין'}
                      </td>
                      <td style={{ padding:'10px 10px', fontSize:11 }}>
                        {nextMeeting ? (
                          <span style={{ color:'#8b5cf6' }}>{nextMeeting.date} {nextMeeting.time}</span>
                        ) : (
                          <span style={{ color: c.textMuted }}>—</span>
                        )}
                      </td>
                      <td style={{ padding:'10px 10px' }}>
                        {isOverdue ? (
                          <span style={{ background:'rgba(239,68,68,0.15)', color:'#f87171', border:'1px solid rgba(239,68,68,0.25)',
                            padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>⚠️ באיחור</span>
                        ) : l.nextFollowUpDate ? (
                          <span style={{ background:'rgba(16,185,129,0.12)', color:'#34d399', border:'1px solid rgba(16,185,129,0.25)',
                            padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700 }}>✓ מתוזמן</span>
                        ) : (
                          <span style={{ color: c.textMuted, fontSize:11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div style={{ height:32 }}/>
    </div>
  );
}
