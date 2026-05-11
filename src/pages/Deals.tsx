import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowRight, CheckCircle2, Clock, DollarSign, Calendar,
  TrendingUp, Users, AlertTriangle, X, Plus, FileText,
  Phone, Mail, MessageCircle, Star, Trash2, Edit2, Check,
  Zap, Activity, CreditCard, Package, StickyNote,
  Link2, ExternalLink, Target, BarChart2, Printer,
  ChevronLeft, ChevronRight, RefreshCw, Brain, Sparkles, Shield,
  Heart, AlertOctagon, Smile, Meh, Frown, ChevronDown,
  Upload, Image as ImageIcon, Film, FileCheck, Folder,
  BookOpen, Send, Eye, Download, Copy, CheckCheck,
  Percent, Receipt, PenLine, GripVertical,
  FolderOpen, Flag, Palette,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../lib/apiKey';
import { storage } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import type {
  Lead, AccountData, ManagedSolution, SolutionStatus,
  PaymentRecord, PaymentType, ActivityEntry, ActivityType,
  MediaRecord, MediaPlatform, ClientGoal, ClientLink,
  ClientFile, FileCategory, FileKind,
  Proposal, ProposalItem,
  Project, ProjectStatus, ProjectPriority, ProjectTask,
} from '../types';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const SOL_STATUS: Record<SolutionStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  not_started: { label: 'טרם החל',  color: 'text-slate-500',   bg: 'bg-slate-100',   icon: Clock },
  in_progress:  { label: 'בביצוע',   color: 'text-blue-600',    bg: 'bg-blue-100',    icon: TrendingUp },
  delivered:    { label: 'הועבר',    color: 'text-amber-600',   bg: 'bg-amber-100',   icon: Package },
  approved:     { label: 'אושר ✓',  color: 'text-emerald-600', bg: 'bg-emerald-100', icon: CheckCircle2 },
};

const PAY_STATUS = {
  paid:      { label: 'שולם',   color: 'text-emerald-700', bg: 'bg-emerald-100' },
  pending:   { label: 'ממתין',  color: 'text-amber-700',   bg: 'bg-amber-100'   },
  overdue:   { label: 'באיחור', color: 'text-red-600',     bg: 'bg-red-100'     },
  cancelled: { label: 'בוטל',   color: 'text-slate-500',   bg: 'bg-slate-100'   },
};

const PAY_TYPE: Record<PaymentType, string> = {
  retainer: 'ריטיינר', one_time: 'חד-פעמי', bonus: 'בונוס',
};

const ACT_TYPE: Record<ActivityType, { label: string; icon: React.ElementType; color: string }> = {
  note:     { label: 'הערה',     icon: StickyNote,    color: 'text-slate-500'  },
  call:     { label: 'שיחה',     icon: Phone,         color: 'text-blue-500'   },
  meeting:  { label: 'פגישה',    icon: Users,         color: 'text-violet-500' },
  email:    { label: 'מייל',     icon: Mail,          color: 'text-indigo-500' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: 'text-emerald-500'},
};

const PLATFORM_CFG: Record<MediaPlatform, { label: string; color: string; bg: string; hex: string }> = {
  meta:     { label: 'Meta',     color: 'text-blue-700',   bg: 'bg-blue-100',   hex: '#1877F2' },
  google:   { label: 'Google',   color: 'text-red-600',    bg: 'bg-red-100',    hex: '#EA4335' },
  tiktok:   { label: 'TikTok',   color: 'text-slate-900',  bg: 'bg-slate-100',  hex: '#000000' },
  linkedin: { label: 'LinkedIn', color: 'text-blue-900',   bg: 'bg-blue-100',   hex: '#0A66C2' },
  email:    { label: 'Email',    color: 'text-violet-700', bg: 'bg-violet-100', hex: '#7C3AED' },
  other:    { label: 'אחר',      color: 'text-slate-500',  bg: 'bg-slate-100',  hex: '#94A3B8' },
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function calcHealth(lead: Lead, proj: Project | undefined, fallbackContractEnd?: string): number {
  let score = 100;
  const now = new Date();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const allTs = [
    ...(proj?.activityLog ?? []).map(a => a.timestamp),
    ...lead.notes.map(n => n.timestamp),
  ].sort((a, b) => b.localeCompare(a));
  if (!allTs.length) { score -= 30; }
  else {
    const days = (now.getTime() - new Date(allTs[0]).getTime()) / 86_400_000;
    if (days > 30) score -= 35; else if (days > 14) score -= 20; else if (days > 7) score -= 10;
  }
  const overdue = lead.tasks.filter(t => { if (t.completed) return false; try { return new Date(t.date + 'T00:00:00') < midnight; } catch { return false; } });
  score -= Math.min(overdue.length * 15, 30);
  const contractEnd = proj?.contractEnd ?? fallbackContractEnd;
  if (contractEnd) {
    const d = Math.ceil((new Date(contractEnd).getTime() - now.getTime()) / 86_400_000);
    if (d < 0) score -= 30; else if (d < 14) score -= 20; else if (d < 30) score -= 10;
  }
  if (proj?.payments?.some(p => p.status === 'overdue')) score -= 20;
  return Math.max(0, Math.min(100, score));
}

function healthMeta(score: number) {
  if (score >= 70) return { label: 'תקין',       bg: 'bg-emerald-500', ring: 'ring-emerald-200', text: 'text-emerald-700', lightBg: 'bg-emerald-50' };
  if (score >= 40) return { label: 'דורש טיפול', bg: 'bg-amber-500',   ring: 'ring-amber-200',   text: 'text-amber-700',   lightBg: 'bg-amber-50'   };
  return               { label: 'קריטי',        bg: 'bg-red-500',     ring: 'ring-red-200',     text: 'text-red-600',     lightBg: 'bg-red-50'     };
}

const fmt    = (n: number) => `₪${n.toLocaleString('he-IL')}`;
const fmtK   = (n: number) => n >= 1000 ? `₪${(n / 1000).toFixed(0)}K` : fmt(n);
const fmtD   = (s: string) => { try { return new Date(s).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
const daysTo = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
const ago    = (ts: string) => { const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000); return d === 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d}י`; };
const todayStr = () => new Date().toISOString().split('T')[0];
const currentMonth = () => new Date().toISOString().slice(0, 7);
const fmtMonth = (m: string) => { try { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }); } catch { return m; } };
const prevMonth = (m: string) => { const [y, mo] = m.split('-'); const d = new Date(Number(y), Number(mo) - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const nextMonth = (m: string) => { const [y, mo] = m.split('-'); const d = new Date(Number(y), Number(mo)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function blankAccount(leadId: string, budget: number): AccountData {
  return { leadId, contractStart: '', contractEnd: '', monthlyRetainer: budget, projects: [], updatedAt: '' };
}

function getLast6Months() {
  const result: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   OVERVIEW TAB
═══════════════════════════════════════════════════════════════════════════ */
/* ── EQ Layer types ── */
interface EqResult { sentiment: 'positive' | 'neutral' | 'negative' | 'at-risk'; emoji: string; summary: string; action: string; }
interface WgInsight { title: string; idea: string; emoji: string; }

function OverviewTab({ lead, project, onSave, currentUser }: {
  lead: Lead; project: Project; onSave: (p: Project) => void; currentUser: string;
}) {
  const [editingContract, setEditingContract] = useState(false);
  const [form, setForm] = useState(project);
  const [newLog, setNewLog] = useState('');
  const [logType, setLogType] = useState<ActivityType>('note');
  const [addingLink, setAddingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ title: '', url: '' });

  // EQ Layer state
  const [eqLoading, setEqLoading] = useState(false);
  const [eqResult,  setEqResult]  = useState<EqResult | null>(null);
  const [eqOpen,    setEqOpen]    = useState(false);

  // White Glove state
  const [wgLoading,  setWgLoading]  = useState(false);
  const [wgInsights, setWgInsights] = useState<WgInsight[] | null>(null);
  const [wgOpen,     setWgOpen]     = useState(false);

  useEffect(() => { setForm(project); }, [project]);

  const score = calcHealth(lead, project);
  const hm    = healthMeta(score);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const overdueT = lead.tasks.filter(t => { if (t.completed) return false; try { return new Date(t.date + 'T00:00:00') < midnight; } catch { return false; } });
  const totalPaid = (project.payments ?? []).filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  // Current month goal vs actuals
  const cm = currentMonth();
  const goal = (project.goals ?? []).find(g => g.month === cm);
  const cmMedia = (project.mediaRecords ?? []).filter(r => r.month === cm);
  const cmLeads = cmMedia.reduce((s, r) => s + r.leads, 0);
  const cmSpend = cmMedia.reduce((s, r) => s + r.spend, 0);

  function saveContract() {
    onSave({ ...project, ...form, updatedAt: new Date().toISOString() });
    setEditingContract(false);
  }
  function addLog() {
    if (!newLog.trim()) return;
    const entry: ActivityEntry = { id: Date.now().toString(), type: logType, text: newLog.trim(), author: currentUser, timestamp: new Date().toISOString() };
    onSave({ ...project, activityLog: [entry, ...(project.activityLog ?? [])], updatedAt: new Date().toISOString() });
    setNewLog('');
  }
  function addLink() {
    if (!linkForm.title.trim() || !linkForm.url.trim()) return;
    const link: ClientLink = { id: Date.now().toString(), title: linkForm.title.trim(), url: linkForm.url.trim() };
    onSave({ ...project, links: [...(project.links ?? []), link], updatedAt: new Date().toISOString() });
    setLinkForm({ title: '', url: '' }); setAddingLink(false);
  }
  function removeLink(id: string) { onSave({ ...project, links: (project.links ?? []).filter(l => l.id !== id), updatedAt: new Date().toISOString() }); }

  // EQ Layer — analyze sentiment of recent activity
  const runEqAnalysis = useCallback(async () => {
    const apiKey = getApiKey();
    if (!apiKey) return;
    const recentTexts = [
      ...(project.activityLog ?? []).slice(0, 10).map(e => `[${e.type}] ${e.text}`),
      ...lead.notes.slice(0, 5).map(n => n.text),
    ].join('\n');
    if (!recentTexts.trim()) return;
    setEqLoading(true); setEqResult(null); setEqOpen(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-6', max_tokens: 512,
        messages: [{ role: 'user', content: `אתה מומחה EQ ומנהל לקוחות. נתח את הפעילות האחרונה עם הלקוח "${lead.company}" (${lead.contactName}):\n\n${recentTexts}\n\nהחזר JSON בלבד:\n{"sentiment":"positive|neutral|negative|at-risk","emoji":"🟢|🟡|🔴|⚠️","summary":"משפט אחד על המצב הרגשי","action":"המלצה ספציפית לפעולה הבאה"}` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      if (jsonMatch) setEqResult(JSON.parse(jsonMatch[0]) as EqResult);
    } catch { setEqResult({ sentiment: 'neutral', emoji: '🟡', summary: 'לא הצלחתי לנתח', action: 'נסה שנית' }); }
    finally { setEqLoading(false); }
  }, [project.activityLog, lead]);

  // White Glove — scan for personal touches
  const runWhiteGlove = useCallback(async () => {
    const apiKey = getApiKey();
    if (!apiKey) return;
    const allText = [...(project.activityLog ?? []).map(e => e.text), ...lead.notes.map(n => n.text), lead.company, lead.contactName].join('\n');
    setWgLoading(true); setWgInsights(null); setWgOpen(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-6', max_tokens: 800,
        messages: [{ role: 'user', content: `אתה מומחה "White Glove" service. בדוק את המידע על הלקוח "${lead.company}" (${lead.contactName}) ומצא הזדמנויות לטיפול אישי:\n\n${allText}\n\nמצא עד 3 הזדמנויות (ימי הולדת, תחביבים, אירועים, עניינים אישיים שצוינו). אם אין מידע, המצא רעיונות גנריים מוצלחים לסוכנות שיווק.\nהחזר JSON בלבד:\n[{"emoji":"🎂","title":"שם ההזדמנות","idea":"מה לעשות בדיוק"}]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const jsonMatch = txt.match(/\[[\s\S]*\]/);
      if (jsonMatch) setWgInsights(JSON.parse(jsonMatch[0]) as WgInsight[]);
    } catch { setWgInsights([{ emoji: '🤝', title: 'שגיאה', idea: 'לא הצלחתי לנתח. נסה שנית.' }]); }
    finally { setWgLoading(false); }
  }, [project.activityLog, lead]);

  function saveGoal(field: keyof ClientGoal, value: number) {
    const existing = (project.goals ?? []).find(g => g.month === cm);
    const goals = existing
      ? (project.goals ?? []).map(g => g.month === cm ? { ...g, [field]: value } : g)
      : [...(project.goals ?? []), { id: Date.now().toString(), month: cm, leadsTarget: 0, revenueTarget: 0, spendBudget: 0, [field]: value }];
    onSave({ ...project, goals, updatedAt: new Date().toISOString() });
  }

  const recentLog = [...(project.activityLog ?? []), ...lead.notes.map(n => ({ id: n.id, type: 'note' as ActivityType, text: n.text, author: n.author, timestamp: n.timestamp }))].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Health card */}
      <div className={`${hm.lightBg} rounded-2xl p-5 ring-1 ${hm.ring}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-2xl font-black ${hm.text}`}>{score}%</span>
          <div className="text-right"><p className="font-bold text-slate-800">ציון בריאות</p><p className={`text-sm font-semibold ${hm.text}`}>{hm.label}</p></div>
        </div>
        <div className="h-2 bg-white/60 rounded-full"><div className={`h-2 rounded-full ${hm.bg} transition-all duration-700`} style={{ width: `${score}%` }} /></div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {overdueT.length > 0 && <span className="bg-red-100 text-red-600 font-semibold px-2 py-1 rounded-lg">⚠ {overdueT.length} משימות באיחור</span>}
          {project.contractEnd && daysTo(project.contractEnd) <= 30 && daysTo(project.contractEnd) >= 0 && <span className="bg-amber-100 text-amber-700 font-semibold px-2 py-1 rounded-lg">📅 חידוש בעוד {daysTo(project.contractEnd)} ימים</span>}
          {(project.payments ?? []).some(p => p.status === 'overdue') && <span className="bg-red-100 text-red-600 font-semibold px-2 py-1 rounded-lg">💳 תשלום באיחור</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'הכנסה כוללת', value: fmtK(totalPaid), icon: <DollarSign size={15} className="text-emerald-600" />, bg: 'bg-emerald-50' },
          { label: 'משימות פתוחות', value: lead.tasks.filter(t => !t.completed).length, icon: <Clock size={15} className="text-blue-600" />, bg: 'bg-blue-50' },
          { label: 'פתרונות', value: `${(project.solutions ?? []).filter(s => s.status === 'approved').length}/${(project.solutions ?? []).length}`, icon: <Package size={15} className="text-violet-600" />, bg: 'bg-violet-50' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
            <div className={`w-8 h-8 ${s.bg} rounded-xl flex items-center justify-center mx-auto mb-1.5`}>{s.icon}</div>
            <div className="text-lg font-black text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Monthly goals */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-4 text-right flex items-center justify-end gap-2"><Target size={15} className="text-indigo-500" /> יעדי {fmtMonth(cm)}</h3>
        <div className="space-y-4">
          {[
            { key: 'leadsTarget' as keyof ClientGoal, label: 'לידים', actual: cmLeads, target: goal?.leadsTarget ?? 0, color: 'bg-indigo-500' },
            { key: 'spendBudget' as keyof ClientGoal, label: 'תקציב מדיה (₪)', actual: cmSpend, target: goal?.spendBudget ?? 0, color: 'bg-amber-500', isCurrency: true },
          ].map(g => {
            const pct = g.target > 0 ? Math.min((g.actual / g.target) * 100, 100) : 0;
            return (
              <div key={g.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} defaultValue={g.target || ''}
                      onBlur={e => saveGoal(g.key, Number(e.target.value))}
                      className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs text-left focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="יעד" />
                    <span className="text-xs text-slate-400">יעד</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-800">{g.isCurrency ? fmtK(g.actual) : g.actual}</span>
                    <span className="text-xs text-slate-400 mr-1">/ {g.isCurrency ? fmtK(g.target) : g.target} {g.label}</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full">
                  <div className={`h-2 rounded-full ${g.color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contract */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => editingContract ? saveContract() : setEditingContract(true)} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${editingContract ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {editingContract ? <><Check size={12} /> שמור</> : <><Edit2 size={12} /> ערוך</>}
          </button>
          <h3 className="font-bold text-slate-800">פרטי חוזה</h3>
        </div>
        {editingContract ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 mb-1 block">תחילת חוזה</label><input type="date" value={form.contractStart || ''} onChange={e => setForm(p => ({ ...p, contractStart: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
              <div><label className="text-xs text-slate-500 mb-1 block">סיום חוזה</label><input type="date" value={form.contractEnd || ''} onChange={e => setForm(p => ({ ...p, contractEnd: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            </div>
            <div><label className="text-xs text-slate-500 mb-1 block">ריטיינר חודשי (₪)</label><input type="number" min={0} value={form.monthlyRetainer || ''} onChange={e => setForm(p => ({ ...p, monthlyRetainer: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">הצעד הבא</label><input type="text" value={form.nextStep || ''} onChange={e => setForm(p => ({ ...p, nextStep: e.target.value }))} placeholder="מה הצעד הבא?" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">הזדמנות אפסל</label><textarea value={form.upsellNote || ''} onChange={e => setForm(p => ({ ...p, upsellNote: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-2 block">שביעות רצון</label>
              <div className="flex gap-1 justify-end">{[1,2,3,4,5].map(n => <button key={n} onClick={() => setForm(p => ({ ...p, satisfactionScore: n }))} className={`text-xl transition-all ${(form.satisfactionScore ?? 0) >= n ? 'text-amber-400' : 'text-slate-200'}`}>★</button>)}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm text-right">
            {[
              { label: 'תחילת חוזה', value: project.contractStart ? fmtD(project.contractStart) : '—' },
              { label: 'סיום חוזה', value: project.contractEnd ? `${fmtD(project.contractEnd)} (${daysTo(project.contractEnd)} ימים)` : '—' },
              { label: 'ריטיינר', value: project.monthlyRetainer ? fmt(project.monthlyRetainer) : '—' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <span className="text-slate-700 font-medium">{r.value}</span>
                <span className="text-slate-400 text-xs">{r.label}</span>
              </div>
            ))}
            {project.nextStep && <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mt-2"><p className="text-xs font-bold text-indigo-600 mb-1">→ הצעד הבא</p><p className="text-sm text-indigo-800">{project.nextStep}</p></div>}
            {project.upsellNote && <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 mt-2"><p className="text-xs font-bold text-violet-600 mb-1">🚀 אפסל</p><p className="text-sm text-violet-800">{project.upsellNote}</p></div>}
            {(project.satisfactionScore ?? 0) > 0 && <div className="flex items-center justify-between pt-1"><div className="flex gap-0.5">{[1,2,3,4,5].map(n => <span key={n} className={`text-lg ${(project.satisfactionScore ?? 0) >= n ? 'text-amber-400' : 'text-slate-200'}`}>★</span>)}</div><span className="text-xs text-slate-400">שביעות רצון</span></div>}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setAddingLink(true)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl transition-colors"><Plus size={12} /> הוסף</button>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Link2 size={14} className="text-slate-400" /> קישורים מהירים</h3>
        </div>
        {addingLink && (
          <div className="bg-slate-50 rounded-xl p-3 mb-3 space-y-2">
            <input value={linkForm.title} onChange={e => setLinkForm(p => ({ ...p, title: e.target.value }))} placeholder="כותרת (Google Drive, Notion...)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right" />
            <input value={linkForm.url} onChange={e => setLinkForm(p => ({ ...p, url: e.target.value }))} placeholder="https://..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-left" dir="ltr" />
            <div className="flex gap-2 justify-end"><button onClick={() => setAddingLink(false)} className="text-xs text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-200">ביטול</button><button onClick={addLink} className="text-xs font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-500">הוסף</button></div>
          </div>
        )}
        {(project.links ?? []).length === 0 && !addingLink && <p className="text-center text-slate-300 text-sm py-4">הוסף קישורים ל-Drive, Notion, Docs...</p>}
        <div className="space-y-2">
          {(project.links ?? []).map(link => (
            <div key={link.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5 group">
              <div className="flex items-center gap-2">
                <button onClick={() => removeLink(link.id)} className="w-5 h-5 rounded-md bg-red-100 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={10} /></button>
                <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 text-sm font-medium"><ExternalLink size={12} />{link.title}</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity log */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={runEqAnalysis}
            disabled={eqLoading}
            className="flex items-center gap-1.5 text-xs font-bold bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {eqLoading ? <span className="animate-spin inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full" /> : <Brain size={12} />}
            ניתוח EQ
          </button>
          <h3 className="font-bold text-slate-800 flex items-center gap-2">לוג פעילות</h3>
        </div>

        {/* EQ Result */}
        {eqOpen && (
          <div className={`mb-4 rounded-xl border p-3.5 ${eqResult?.sentiment === 'positive' ? 'bg-emerald-50 border-emerald-200' : eqResult?.sentiment === 'at-risk' ? 'bg-red-50 border-red-200' : eqResult?.sentiment === 'negative' ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
            {eqLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><span className="animate-spin w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full inline-block" /> מנתח רגשות...</div>
            ) : eqResult ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button onClick={() => setEqOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
                  <div className="flex items-center gap-2 text-right"><span className="text-xl">{eqResult.emoji}</span><span className="font-bold text-slate-800 text-sm">{eqResult.summary}</span></div>
                </div>
                <div className="bg-white/70 rounded-lg p-2.5 text-right">
                  <p className="text-xs font-bold text-violet-700 mb-1">→ המלצה</p>
                  <p className="text-sm text-slate-700">{eqResult.action}</p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <button onClick={addLog} disabled={!newLog.trim()} className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-2 rounded-xl text-xs font-bold">הוסף</button>
          <input value={newLog} onChange={e => setNewLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLog()} placeholder="מה קרה עם הלקוח?" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right" />
          <select value={logType} onChange={e => setLogType(e.target.value as ActivityType)} className="border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-600 bg-white focus:outline-none">
            {(Object.keys(ACT_TYPE) as ActivityType[]).map(t => <option key={t} value={t}>{ACT_TYPE[t].label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          {recentLog.length === 0 && <p className="text-center text-slate-300 py-4 text-sm">אין פעילות עדיין</p>}
          {recentLog.map(e => { const at = ACT_TYPE[e.type]; const Icon = at.icon; return (
            <div key={e.id} className="flex gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="text-right flex-1 min-w-0"><p className="text-sm text-slate-700 leading-snug">{e.text}</p><div className="flex items-center justify-end gap-2 mt-1"><span className="text-xs text-slate-300">{ago(e.timestamp)}</span><span className="text-xs text-slate-400">{e.author}</span></div></div>
              <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100 ${at.color}`}><Icon size={13} /></div>
            </div>
          ); })}
        </div>
      </div>

      {/* White Glove Panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={runWhiteGlove}
            disabled={wgLoading}
            className="flex items-center gap-1.5 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {wgLoading ? <span className="animate-spin inline-block w-3 h-3 border-2 border-rose-400 border-t-transparent rounded-full" /> : <Heart size={12} />}
            White Glove
          </button>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Sparkles size={14} className="text-rose-400" /> מגע אישי</h3>
        </div>
        <p className="text-xs text-slate-400 text-right mb-3">AI מזהה הזדמנויות לחיזוק הקשר האישי עם הלקוח</p>
        {wgOpen && (
          wgLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 justify-end py-3"><span className="animate-spin w-3 h-3 border-2 border-rose-400 border-t-transparent rounded-full inline-block" /> מחפש הזדמנויות...</div>
          ) : wgInsights && wgInsights.length > 0 ? (
            <div className="space-y-2">
              {wgInsights.map((ins, i) => (
                <div key={i} className="bg-rose-50 border border-rose-100 rounded-xl p-3.5 text-right">
                  <div className="flex items-center justify-end gap-2 mb-1.5">
                    <p className="font-bold text-rose-700 text-sm">{ins.title}</p>
                    <span className="text-xl">{ins.emoji}</span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{ins.idea}</p>
                </div>
              ))}
              <button onClick={() => setWgOpen(false)} className="text-xs text-slate-400 hover:text-slate-600 w-full text-center pt-1">סגור</button>
            </div>
          ) : null
        )}
        {!wgOpen && <div className="text-center py-2 text-slate-300 text-xs">לחץ "White Glove" לקבלת רעיונות לחיזוק הקשר</div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOLUTIONS TAB
═══════════════════════════════════════════════════════════════════════════ */
function SolutionsTab({ project, onSave, team }: { project: Project; onSave: (p: Project) => void; team: string[] }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const blank = (): Partial<ManagedSolution> => ({ name: '', description: '', status: 'not_started', dueDate: '', assignedTo: '', notes: '' });
  const [form, setForm] = useState<Partial<ManagedSolution>>(blank());
  const solutions = project.solutions ?? [];
  const approved = solutions.filter(s => s.status === 'approved').length;
  const pct = solutions.length > 0 ? Math.round((approved / solutions.length) * 100) : 0;

  function save() {
    if (!form.name?.trim()) return;
    const now = new Date().toISOString();
    if (editId) {
      onSave({ ...project, solutions: solutions.map(s => s.id === editId ? { ...s, ...form } as ManagedSolution : s), updatedAt: now });
      setEditId(null);
    } else {
      const sol: ManagedSolution = { id: Date.now().toString(), createdAt: now, ...form, name: form.name!, status: form.status ?? 'not_started' };
      onSave({ ...project, solutions: [...solutions, sol], updatedAt: now });
      setAdding(false);
    }
    setForm(blank());
  }

  const SolForm = () => (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-500 mb-1 block">שם הפתרון *</label><input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="ניהול מדיה..." /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">סטטוס</label><select value={form.status || 'not_started'} onChange={e => setForm(p => ({ ...p, status: e.target.value as SolutionStatus }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">{(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => <option key={k} value={k}>{SOL_STATUS[k].label}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-500 mb-1 block">תאריך יעד</label><input type="date" value={form.dueDate || ''} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">אחראי</label><select value={form.assignedTo || ''} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none"><option value="">ללא שיוך</option>{team.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
      </div>
      <div><label className="text-xs text-slate-500 mb-1 block">תיאור</label><textarea value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setAdding(false); setEditId(null); setForm(blank()); }} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl">ביטול</button>
        <button onClick={save} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500">שמור</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {solutions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2 text-sm"><span className="font-black text-slate-900">{pct}%</span><span className="text-slate-500">{approved}/{solutions.length} אושרו</span></div>
          <div className="h-2.5 bg-slate-100 rounded-full"><div className="h-2.5 bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} /></div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500 justify-end">{(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => { const c = solutions.filter(s => s.status === k).length; if (!c) return null; return <span key={k} className={`font-semibold ${SOL_STATUS[k].color}`}>{SOL_STATUS[k].label}: {c}</span>; })}</div>
        </div>
      )}
      {!adding && !editId && <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 py-3 rounded-2xl text-sm font-semibold transition-all"><Plus size={16} /> הוסף פתרון</button>}
      {adding && <SolForm />}
      <div className="space-y-3">
        {solutions.length === 0 && !adding && <div className="text-center py-12 text-slate-300"><Package size={32} className="mx-auto mb-3 opacity-50" /><p className="font-semibold">אין פתרונות עדיין</p></div>}
        {solutions.map(s => {
          const m = SOL_STATUS[s.status]; const Icon = m.icon; const isEditing = editId === s.id;
          if (isEditing) return <SolForm key={s.id} />;
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => onSave({ ...project, solutions: solutions.filter(s2 => s2.id !== s.id), updatedAt: new Date().toISOString() })} className="w-7 h-7 rounded-xl bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400"><Trash2 size={12} /></button>
                  <button onClick={() => { setEditId(s.id); setForm({ ...s }); setAdding(false); }} className="w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"><Edit2 size={12} /></button>
                </div>
                <div className="flex-1 text-right min-w-0">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${m.bg} ${m.color} flex items-center gap-1`}><Icon size={10} />{m.label}</span>
                    <h4 className="font-bold text-slate-800">{s.name}</h4>
                  </div>
                  {s.description && <p className="text-xs text-slate-500 mb-1.5">{s.description}</p>}
                  <div className="flex items-center justify-end gap-3 text-xs text-slate-400">{s.assignedTo && <span>👤 {s.assignedTo}</span>}{s.dueDate && <span>📅 {fmtD(s.dueDate)}</span>}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-1.5 justify-end flex-wrap">
                {(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => (
                  <button key={k} onClick={() => onSave({ ...project, solutions: solutions.map(s2 => s2.id === s.id ? { ...s2, status: k } : s2), updatedAt: new Date().toISOString() })}
                    className={`text-xs px-2.5 py-1 rounded-xl font-semibold transition-all border ${s.status === k ? `${SOL_STATUS[k].bg} ${SOL_STATUS[k].color} border-transparent` : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    {SOL_STATUS[k].label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENTS TAB
═══════════════════════════════════════════════════════════════════════════ */
function PaymentsTab({ project, onSave }: { project: Project; onSave: (p: Project) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<PaymentRecord>>({ date: todayStr(), type: 'retainer', status: 'paid', amount: project.monthlyRetainer });
  const payments = (project.payments ?? []).sort((a, b) => b.date.localeCompare(a.date));
  const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const totalOverdue = payments.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount, 0);

  function addPayment() {
    if (!form.amount || !form.date) return;
    const rec: PaymentRecord = { id: Date.now().toString(), date: form.date!, amount: Number(form.amount), type: form.type ?? 'retainer', status: form.status ?? 'paid', ...(form.invoiceNumber ? { invoiceNumber: form.invoiceNumber } : {}), ...(form.status === 'paid' ? { paidAt: new Date().toISOString() } : {}) };
    onSave({ ...project, payments: [rec, ...payments], updatedAt: new Date().toISOString() });
    setAdding(false); setForm({ date: todayStr(), type: 'retainer', status: 'paid', amount: project.monthlyRetainer });
  }

  function toggleStatus(id: string) {
    const upd = payments.map(p => { if (p.id !== id) return p; const next: PaymentRecord['status'] = p.status === 'paid' ? 'pending' : p.status === 'pending' ? 'overdue' : 'paid'; return { ...p, status: next, ...(next === 'paid' ? { paidAt: new Date().toISOString() } : {}) }; });
    onSave({ ...project, payments: upd, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'שולם', value: totalPaid, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' }, { label: 'ממתין', value: totalPending, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100' }, { label: 'באיחור', value: totalOverdue, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' }].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-3 text-center`}><div className={`text-lg font-black ${s.color}`}>{fmtK(s.value)}</div><div className="text-xs text-slate-500 mt-0.5">{s.label}</div></div>
        ))}
      </div>
      {!adding ? (
        <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 py-3 rounded-2xl text-sm font-semibold transition-all"><Plus size={16} /> הוסף תשלום</button>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">סכום (₪)</label><input type="number" min={0} value={form.amount || ''} onChange={e => setForm(p => ({ ...p, amount: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">תאריך</label><input type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">סוג</label><select value={form.type || 'retainer'} onChange={e => setForm(p => ({ ...p, type: e.target.value as PaymentType }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">{(Object.keys(PAY_TYPE) as PaymentType[]).map(k => <option key={k} value={k}>{PAY_TYPE[k]}</option>)}</select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">סטטוס</label><select value={form.status || 'paid'} onChange={e => setForm(p => ({ ...p, status: e.target.value as PaymentRecord['status'] }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">{(Object.keys(PAY_STATUS) as PaymentRecord['status'][]).map(k => <option key={k} value={k}>{PAY_STATUS[k].label}</option>)}</select></div>
          </div>
          <div><label className="text-xs text-slate-500 mb-1 block">מס׳ חשבונית</label><input value={form.invoiceNumber || ''} onChange={e => setForm(p => ({ ...p, invoiceNumber: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="INV-001" /></div>
          <div className="flex gap-2 justify-end"><button onClick={() => setAdding(false)} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl">ביטול</button><button onClick={addPayment} disabled={!form.amount} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 disabled:opacity-40">הוסף</button></div>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {payments.length === 0 && <div className="text-center py-12 text-slate-300"><CreditCard size={32} className="mx-auto mb-3 opacity-50" /><p className="font-semibold">אין תשלומים עדיין</p></div>}
        {payments.map((p, i) => { const ps = PAY_STATUS[p.status]; return (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < payments.length - 1 ? 'border-b border-slate-100' : ''} hover:bg-slate-50 transition-colors`}>
            <button onClick={() => onSave({ ...project, payments: payments.filter(p2 => p2.id !== p.id), updatedAt: new Date().toISOString() })} className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400"><Trash2 size={11} /></button>
            <div className="flex-1 text-right"><div className="flex items-center justify-end gap-2">{p.invoiceNumber && <span className="text-xs text-slate-400 font-mono">{p.invoiceNumber}</span>}<span className="text-xs text-slate-400">{PAY_TYPE[p.type]}</span><span className="font-bold text-slate-800">{fmt(p.amount)}</span></div><span className="text-xs text-slate-400">{fmtD(p.date)}</span></div>
            <button onClick={() => toggleStatus(p.id)} className={`text-xs font-bold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${ps.bg} ${ps.color}`}>{ps.label}</button>
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MEDIA TAB
═══════════════════════════════════════════════════════════════════════════ */
function MediaTab({ project, onSave }: { project: Project; onSave: (p: Project) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<MediaRecord>>({ month: currentMonth(), platform: 'meta', spend: 0, leads: 0, conversions: 0 });
  const records = project.mediaRecords ?? [];

  function addRecord() {
    if (!form.month || form.spend === undefined) return;
    const rec: MediaRecord = { id: Date.now().toString(), month: form.month!, platform: form.platform ?? 'meta', spend: Number(form.spend), leads: Number(form.leads ?? 0), conversions: Number(form.conversions ?? 0), ...(form.impressions ? { impressions: Number(form.impressions) } : {}), ...(form.clicks ? { clicks: Number(form.clicks) } : {}), ...(form.notes ? { notes: form.notes } : {}) };
    onSave({ ...project, mediaRecords: [...records, rec], updatedAt: new Date().toISOString() });
    setAdding(false); setForm({ month: currentMonth(), platform: 'meta', spend: 0, leads: 0, conversions: 0 });
  }

  const totalSpend = records.reduce((s, r) => s + r.spend, 0);
  const totalLeads = records.reduce((s, r) => s + r.leads, 0);
  const avgCPL = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0;

  // Best platform
  const platformTotals = (Object.keys(PLATFORM_CFG) as MediaPlatform[]).map(p => ({
    p, leads: records.filter(r => r.platform === p).reduce((s, r) => s + r.leads, 0),
    spend: records.filter(r => r.platform === p).reduce((s, r) => s + r.spend, 0),
  })).filter(x => x.leads > 0).sort((a, b) => b.leads - a.leads);
  const bestPlatform = platformTotals[0];

  // Chart data — last 6 months
  const last6 = getLast6Months();
  const chartData = last6.map(m => {
    const monthRecs = records.filter(r => r.month === m);
    return { month: fmtMonth(m).split(' ')[0], הוצאה: monthRecs.reduce((s, r) => s + r.spend, 0), לידים: monthRecs.reduce((s, r) => s + r.leads, 0) };
  });

  // Group by month
  const byMonth = last6.slice().reverse().map(m => ({ month: m, records: records.filter(r => r.month === m) })).filter(x => x.records.length > 0);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'הוצאה כוללת', value: fmtK(totalSpend), color: 'text-slate-900', bg: 'bg-slate-50' },
          { label: 'לידים כולל', value: totalLeads, color: 'text-indigo-700', bg: 'bg-indigo-50' },
          { label: 'CPL ממוצע', value: avgCPL ? fmt(avgCPL) : '—', color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'פלטפורמה מובילה', value: bestPlatform ? PLATFORM_CFG[bestPlatform.p].label : '—', color: 'text-emerald-700', bg: 'bg-emerald-50' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-2xl p-4 text-center`}>
            <div className={`text-xl font-black ${k.color}`}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      {records.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4 text-right">הוצאות ולידים לפי חודש</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="spend" orientation="left" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `₪${v}`} />
              <YAxis yAxisId="leads" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} formatter={(v, n) => [n === 'הוצאה' ? fmt(Number(v)) : v, n]} />
              <Legend />
              <Bar yAxisId="spend" dataKey="הוצאה" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={24} />
              <Bar yAxisId="leads" dataKey="לידים" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Platform breakdown */}
      {platformTotals.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4 text-right">פירוט לפי פלטפורמה</h3>
          <div className="space-y-3">
            {platformTotals.map(({ p, leads, spend }) => {
              const cfg = PLATFORM_CFG[p]; const cpl = leads > 0 ? Math.round(spend / leads) : 0;
              const maxLeads = platformTotals[0].leads;
              return (
                <div key={p} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{leads} לידים</span><span>CPL: {fmt(cpl)}</span><span className="text-slate-400">{fmtK(spend)}</span>
                      </div>
                      <span className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full"><div className="h-2 rounded-full transition-all" style={{ width: `${(leads / maxLeads) * 100}%`, backgroundColor: cfg.hex }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add record */}
      {!adding ? (
        <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 py-3 rounded-2xl text-sm font-semibold transition-all"><Plus size={16} /> הוסף נתוני מדיה</button>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">חודש</label><input type="month" value={form.month || ''} onChange={e => setForm(p => ({ ...p, month: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">פלטפורמה</label><select value={form.platform || 'meta'} onChange={e => setForm(p => ({ ...p, platform: e.target.value as MediaPlatform }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">{(Object.keys(PLATFORM_CFG) as MediaPlatform[]).map(k => <option key={k} value={k}>{PLATFORM_CFG[k].label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">הוצאה (₪)</label><input type="number" min={0} value={form.spend || ''} onChange={e => setForm(p => ({ ...p, spend: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">לידים</label><input type="number" min={0} value={form.leads || ''} onChange={e => setForm(p => ({ ...p, leads: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">המרות</label><input type="number" min={0} value={form.conversions || ''} onChange={e => setForm(p => ({ ...p, conversions: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">חשיפות</label><input type="number" min={0} value={form.impressions || ''} onChange={e => setForm(p => ({ ...p, impressions: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">קליקים</label><input type="number" min={0} value={form.clicks || ''} onChange={e => setForm(p => ({ ...p, clicks: Number(e.target.value) }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
          </div>
          <div className="flex gap-2 justify-end"><button onClick={() => setAdding(false)} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl">ביטול</button><button onClick={addRecord} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500">שמור</button></div>
        </div>
      )}

      {/* Records by month */}
      <div className="space-y-4">
        {byMonth.map(({ month: m, records: recs }) => (
          <div key={m} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm text-slate-500">הוצאה: {fmt(recs.reduce((s,r)=>s+r.spend,0))} · לידים: {recs.reduce((s,r)=>s+r.leads,0)}</span>
              <span className="font-bold text-slate-800 text-sm">{fmtMonth(m)}</span>
            </div>
            {recs.map((r, i) => {
              const cfg = PLATFORM_CFG[r.platform]; const cpl = r.leads > 0 ? Math.round(r.spend / r.leads) : 0;
              return (
                <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${i < recs.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <button onClick={() => onSave({ ...project, mediaRecords: records.filter(rec => rec.id !== r.id), updatedAt: new Date().toISOString() })} className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 flex-shrink-0"><Trash2 size={11} /></button>
                  <div className="flex-1 text-right">
                    <div className="flex items-center justify-end gap-3 text-sm">
                      <span className="text-slate-400 text-xs">CPL: {cpl ? fmt(cpl) : '—'}</span>
                      <span className="text-slate-600">{r.leads} לידים</span>
                      <span className="font-semibold text-slate-800">{fmt(r.spend)}</span>
                      <span className={`font-bold text-sm ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    {r.impressions && <div className="text-xs text-slate-400 mt-0.5">{r.impressions.toLocaleString()} חשיפות · {r.clicks?.toLocaleString() ?? '—'} קליקים</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {records.length === 0 && !adding && <div className="text-center py-12 text-slate-300"><BarChart2 size={32} className="mx-auto mb-3 opacity-50" /><p className="font-semibold">אין נתוני מדיה</p><p className="text-sm mt-1">הכנס נתוני ביצועים חודשיים</p></div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORT TAB
═══════════════════════════════════════════════════════════════════════════ */
function ReportTab({ lead, project }: { lead: Lead; project: Project }) {
  const [month, setMonth] = useState(currentMonth());

  const mediaRecs = (project.mediaRecords ?? []).filter(r => r.month === month);
  const totalSpend = mediaRecs.reduce((s, r) => s + r.spend, 0);
  const totalLeads = mediaRecs.reduce((s, r) => s + r.leads, 0);
  const totalConv  = mediaRecs.reduce((s, r) => s + r.conversions, 0);
  const cpl = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0;
  const totalImpressions = mediaRecs.reduce((s, r) => s + (r.impressions ?? 0), 0);

  const solutions = project.solutions ?? [];
  const approved = solutions.filter(s => s.status === 'approved').length;
  const inProgress = solutions.filter(s => s.status === 'in_progress').length;

  const cmPayment = (project.payments ?? []).filter(p => p.date.startsWith(month));
  const paidThisMonth = cmPayment.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  const goal = (project.goals ?? []).find(g => g.month === month);

  const activityThisMonth = (project.activityLog ?? []).filter(a => a.timestamp.startsWith(month));

  const score = calcHealth(lead, project);
  const hm = healthMeta(score);

  const bestPlatform = mediaRecs.length > 0 ? mediaRecs.sort((a, b) => b.leads - a.leads)[0] : null;

  return (
    <div className="space-y-5">
      {/* Month nav */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(nextMonth(month))} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"><ChevronLeft size={15} /></button>
          <button onClick={() => setMonth(prevMonth(month))} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"><ChevronRight size={15} /></button>
        </div>
        <span className="font-bold text-slate-800">{fmtMonth(month)}</span>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors"><Printer size={13} /> הדפס</button>
      </div>

      {/* Report card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden print:shadow-none">
        {/* Report header */}
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white text-right">
          <p className="text-indigo-200 text-sm mb-1">דוח ביצועים חודשי</p>
          <h2 className="text-2xl font-black mb-0.5">{lead.company}</h2>
          <p className="text-indigo-200">{fmtMonth(month)}</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">{hm.label} {score}%</span>
            <span className="text-indigo-200 text-sm">{lead.contactName}</span>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Media performance */}
          <div>
            <h3 className="font-bold text-slate-700 mb-3 text-right flex items-center justify-end gap-2"><BarChart2 size={14} className="text-indigo-500" /> ביצועי מדיה</h3>
            {mediaRecs.length === 0 ? (
              <p className="text-center text-slate-300 py-4 text-sm">אין נתוני מדיה לחודש זה</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'הוצאה', value: fmt(totalSpend) },
                  { label: 'לידים', value: totalLeads },
                  { label: 'המרות', value: totalConv },
                  { label: 'CPL', value: cpl ? fmt(cpl) : '—' },
                ].map(k => (
                  <div key={k.label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-lg font-black text-slate-900">{k.value}</div>
                    <div className="text-xs text-slate-500">{k.label}</div>
                  </div>
                ))}
              </div>
            )}
            {totalImpressions > 0 && <p className="text-xs text-slate-400 text-right mt-2">{totalImpressions.toLocaleString()} חשיפות כוללות</p>}
            {bestPlatform && <p className="text-xs text-indigo-600 font-semibold text-right mt-1">🏆 פלטפורמה מובילה: {PLATFORM_CFG[bestPlatform.platform].label} ({bestPlatform.leads} לידים)</p>}
          </div>

          {/* Goal vs actual */}
          {goal && (
            <div>
              <h3 className="font-bold text-slate-700 mb-3 text-right flex items-center justify-end gap-2"><Target size={14} className="text-indigo-500" /> יעדים לעומת ביצוע</h3>
              <div className="space-y-2">
                {[
                  { label: 'לידים', actual: totalLeads, target: goal.leadsTarget },
                  { label: 'תקציב מדיה', actual: totalSpend, target: goal.spendBudget, currency: true },
                ].filter(g => g.target > 0).map(g => {
                  const pct = Math.min((g.actual / g.target) * 100, 100);
                  const ok = pct >= 80;
                  return (
                    <div key={g.label}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className={`font-bold ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>{g.currency ? fmt(g.actual) : g.actual} / {g.currency ? fmt(g.target) : g.target}</span>
                        <span className="text-slate-500">{g.label}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full"><div className={`h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Solutions */}
          {solutions.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-700 mb-3 text-right flex items-center justify-end gap-2"><Package size={14} className="text-indigo-500" /> פתרונות</h3>
              <div className="flex gap-4 text-sm justify-end">
                <span className="text-emerald-600 font-bold">✓ אושרו: {approved}</span>
                <span className="text-blue-600 font-bold">↻ בביצוע: {inProgress}</span>
                <span className="text-slate-500">סה״כ: {solutions.length}</span>
              </div>
              <div className="mt-2 h-2 bg-slate-100 rounded-full"><div className="h-2 bg-indigo-500 rounded-full" style={{ width: `${solutions.length > 0 ? (approved / solutions.length) * 100 : 0}%` }} /></div>
            </div>
          )}

          {/* Financials */}
          {paidThisMonth > 0 && (
            <div>
              <h3 className="font-bold text-slate-700 mb-2 text-right flex items-center justify-end gap-2"><CreditCard size={14} className="text-indigo-500" /> תשלומים</h3>
              <p className="text-right text-emerald-600 font-bold">{fmt(paidThisMonth)} שולם החודש</p>
            </div>
          )}

          {/* Activity summary */}
          {activityThisMonth.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-700 mb-2 text-right flex items-center justify-end gap-2"><Activity size={14} className="text-indigo-500" /> פעילות החודש</h3>
              <p className="text-right text-sm text-slate-600">{activityThisMonth.length} אינטראקציות עם הלקוח</p>
            </div>
          )}

          {/* Next step */}
          {project.nextStep && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-right">
              <p className="text-xs font-bold text-indigo-600 mb-1">→ הצעד הבא</p>
              <p className="text-sm text-indigo-800">{project.nextStep}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECTS LIST + PROJECT DETAIL VIEW
═══════════════════════════════════════════════════════════════════════════ */
const PROJ_STATUS: Record<ProjectStatus, { label: string; color: string; bg: string; dot: string }> = {
  planning:  { label: 'תכנון',     color: 'text-slate-600',   bg: 'bg-slate-100',   dot: 'bg-slate-400'   },
  active:    { label: 'פעיל',      color: 'text-blue-700',    bg: 'bg-blue-100',    dot: 'bg-blue-500'    },
  review:    { label: 'סקירה',     color: 'text-amber-700',   bg: 'bg-amber-100',   dot: 'bg-amber-500'   },
  completed: { label: 'הושלם ✓',  color: 'text-emerald-700', bg: 'bg-emerald-100', dot: 'bg-emerald-500' },
  paused:    { label: 'מושהה',     color: 'text-rose-600',    bg: 'bg-rose-100',    dot: 'bg-rose-500'    },
};

const PROJ_PRIORITY: Record<ProjectPriority, { label: string; color: string }> = {
  high:   { label: 'דחוף',  color: 'text-red-600'    },
  medium: { label: 'בינוני', color: 'text-amber-600'  },
  low:    { label: 'נמוך',  color: 'text-slate-400'  },
};

const PROJ_COLORS = ['bg-indigo-500','bg-violet-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-blue-500','bg-teal-500','bg-orange-500'];

const PROJ_STATUS_CFG = {
  planning:  { label: 'תכנון',    color: 'text-slate-600',   bg: 'bg-slate-100'   },
  active:    { label: 'פעיל',     color: 'text-blue-700',    bg: 'bg-blue-100'    },
  review:    { label: 'סקירה',    color: 'text-amber-700',   bg: 'bg-amber-100'   },
  completed: { label: 'הושלם ✓', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  paused:    { label: 'מושהה',    color: 'text-rose-600',    bg: 'bg-rose-100'    },
};

function blankProject(): Project {
  return {
    id: Date.now().toString(),
    name: '',
    description: '',
    status: 'planning',
    priority: 'medium',
    color: PROJ_COLORS[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [],
    solutions: [],
    payments: [],
    activityLog: [],
    mediaRecords: [],
    goals: [],
    links: [],
    files: [],
    proposals: [],
    upsellNote: '',
  };
}

function ProjectsList({ account, team, onSelectProject, onSaveAccount }: {
  account: AccountData;
  team: string[];
  onSelectProject: (p: Project) => void;
  onSaveAccount: (a: AccountData) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; description: string; color: string; status: ProjectStatus; priority: ProjectPriority; monthlyRetainer: string; contractStart: string; contractEnd: string; assignedTo: string }>({
    name: '', description: '', color: PROJ_COLORS[0], status: 'planning', priority: 'medium',
    monthlyRetainer: '', contractStart: '', contractEnd: '', assignedTo: '',
  });

  const projects = account.projects ?? [];

  const createProject = () => {
    if (!form.name.trim()) return;
    const newProj: Project = {
      ...blankProject(),
      name: form.name.trim(),
      description: form.description.trim(),
      color: form.color,
      status: form.status,
      priority: form.priority,
      monthlyRetainer: form.monthlyRetainer ? Number(form.monthlyRetainer) : undefined,
      contractStart: form.contractStart || undefined,
      contractEnd: form.contractEnd || undefined,
      assignedTo: form.assignedTo || undefined,
    };
    onSaveAccount({
      ...account,
      projects: [...projects, newProj],
      updatedAt: new Date().toISOString(),
    });
    setCreating(false);
    setForm({ name: '', description: '', color: PROJ_COLORS[0], status: 'planning', priority: 'medium', monthlyRetainer: '', contractStart: '', contractEnd: '', assignedTo: '' });
  };

  const deleteProject = (id: string) => {
    onSaveAccount({
      ...account,
      projects: projects.filter(p => p.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus size={15} /> פרויקט חדש
        </button>
        <div className="text-right">
          <p className="text-xs text-slate-400">פרויקטים</p>
          <p className="font-black text-slate-800 text-lg">{projects.length}</p>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-white border-2 border-indigo-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setCreating(false)} className="w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400"><X size={14} /></button>
            <h3 className="font-black text-slate-900">פרויקט חדש</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">שם הפרויקט *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="שם הפרויקט..." autoFocus />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">תיאור</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="תיאור קצר..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">ריטיינר חודשי (₪)</label>
                <input type="number" value={form.monthlyRetainer} onChange={e => setForm(f => ({ ...f, monthlyRetainer: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="0" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">אחראי</label>
                <select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="">בחר...</option>
                  {team.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">תחילת חוזה</label>
                <input type="date" value={form.contractStart} onChange={e => setForm(f => ({ ...f, contractStart: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">סיום חוזה</label>
                <input type="date" value={form.contractEnd} onChange={e => setForm(f => ({ ...f, contractEnd: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
            {/* Color picker */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">צבע</label>
              <div className="flex gap-2 flex-wrap">
                {PROJ_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7 rounded-lg ${c} transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'opacity-60 hover:opacity-100'}`} />
                ))}
              </div>
            </div>
          </div>

          <button onClick={createProject}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl transition-colors">
            צור פרויקט
          </button>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && !creating && (
        <div className="text-center py-16 text-slate-300">
          <FolderOpen size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-semibold text-slate-400">אין פרויקטים עדיין</p>
          <p className="text-sm mt-1">לחץ "פרויקט חדש" כדי להתחיל</p>
        </div>
      )}

      {/* Projects grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map(proj => {
          const st = PROJ_STATUS_CFG[proj.status];
          const doneTasks = proj.tasks.filter(t => t.completed).length;
          const totalTasks = proj.tasks.length;
          const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
          return (
            <div key={proj.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden group">
              {/* Color bar */}
              <div className={`h-1.5 ${proj.color ?? 'bg-indigo-500'}`} />
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <button onClick={() => deleteProject(proj.id)}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 transition-all flex-shrink-0">
                    <Trash2 size={11} />
                  </button>
                  <div className="text-right flex-1 min-w-0 mr-2">
                    <div className="flex items-center justify-end gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                      <h3 className="font-black text-slate-900 truncate">{proj.name}</h3>
                    </div>
                    {proj.description && <p className="text-xs text-slate-400 truncate">{proj.description}</p>}
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex gap-2 mb-3 text-xs">
                  {proj.monthlyRetainer && (
                    <div className="bg-slate-50 rounded-lg px-2.5 py-1.5 text-right flex-1">
                      <p className="text-slate-400 text-[10px]">ריטיינר</p>
                      <p className="font-bold text-slate-700">{fmtK(proj.monthlyRetainer)}</p>
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-lg px-2.5 py-1.5 text-right flex-1">
                    <p className="text-slate-400 text-[10px]">הצעות מחיר</p>
                    <p className="font-bold text-indigo-600">{proj.proposals?.length ?? 0}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-2.5 py-1.5 text-right flex-1">
                    <p className="text-slate-400 text-[10px]">תשלומים</p>
                    <p className="font-bold text-emerald-600">{proj.payments?.filter(p => p.status === 'paid').length ?? 0}</p>
                  </div>
                </div>

                {/* Task progress */}
                {totalTasks > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span>{pct}%</span>
                      <span>משימות {doneTasks}/{totalTasks}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className={`h-1.5 rounded-full ${proj.color ?? 'bg-indigo-500'} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {/* Contract dates */}
                {proj.contractEnd && (
                  <p className="text-[10px] text-slate-400 mb-3 text-right">
                    {daysTo(proj.contractEnd) > 0 ? `${daysTo(proj.contractEnd)} ימים לסיום החוזה` : 'החוזה הסתיים'}
                  </p>
                )}

                <button onClick={() => onSelectProject(proj)}
                  className={`w-full py-2 rounded-xl text-white text-xs font-bold transition-colors ${proj.color ?? 'bg-indigo-500'} hover:opacity-90`}>
                  פתח פרויקט
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PROJ_TABS = [
  { key: 'overview'  as const, label: 'סקירה',      icon: Activity   },
  { key: 'solutions' as const, label: 'פתרונות',    icon: Package    },
  { key: 'payments'  as const, label: 'תשלומים',    icon: CreditCard },
  { key: 'media'     as const, label: 'מדיה',       icon: BarChart2  },
  { key: 'materials' as const, label: 'חומרים',     icon: Folder     },
  { key: 'proposals' as const, label: 'הצעות מחיר', icon: Receipt    },
  { key: 'report'    as const, label: 'דוח',         icon: FileText   },
];

function ProjectDetailView({ lead, account, project, onSaveProject, onBack, onLeadClick, currentUser, team }: {
  lead: Lead;
  account: AccountData;
  project: Project;
  onSaveProject: (p: Project) => void;
  onBack: () => void;
  onLeadClick: (l: Lead) => void;
  currentUser: string;
  team: string[];
}) {
  const [tab, setTab] = useState<'overview' | 'solutions' | 'payments' | 'media' | 'materials' | 'proposals' | 'report'>('overview');
  const st = PROJ_STATUS_CFG[project.status];

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <button onClick={() => onLeadClick(lead)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors"><Zap size={12} className="text-indigo-500" /> פתח כרטיס ליד</button>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">{lead.company} <ArrowRight size={16} /></button>
      </div>

      {/* Project header */}
      <div className={`rounded-2xl p-5 text-white shadow-lg ${project.color ?? 'bg-indigo-500'}`}>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 self-start">{st.label}</span>
            {project.contractEnd && (
              <span className="text-xs text-white/70">{daysTo(project.contractEnd) > 0 ? `${daysTo(project.contractEnd)} ימים נותרו` : 'הסתיים'}</span>
            )}
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-black">{project.name}</h2>
            {project.description && <p className="text-white/70 text-sm mt-0.5">{project.description}</p>}
          </div>
        </div>
        {project.monthlyRetainer && (
          <div className="mt-4 flex justify-end">
            <span className="text-white/70 text-xs">ריטיינר חודשי: </span>
            <span className="text-white font-bold text-sm mr-1">{fmtK(project.monthlyRetainer)}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl overflow-x-auto">
        {PROJ_TABS.map(t => { const Icon = t.icon; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 min-w-fit flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
            <Icon size={13} />{t.label}
          </button>
        ); })}
      </div>

      {tab === 'overview'  && <OverviewTab   lead={lead} project={project} onSave={onSaveProject} currentUser={currentUser} />}
      {tab === 'solutions' && <SolutionsTab  project={project} onSave={onSaveProject} team={team} />}
      {tab === 'payments'  && <PaymentsTab   project={project} onSave={onSaveProject} />}
      {tab === 'media'     && <MediaTab      project={project} onSave={onSaveProject} />}
      {tab === 'materials' && <MaterialsTab  project={project} onSave={onSaveProject} currentUser={currentUser} leadId={lead.id} />}
      {tab === 'proposals' && <ProposalsTab  project={project} onSave={onSaveProject} clientName={lead.company} />}
      {tab === 'report'    && <ReportTab     lead={lead} project={project} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MATERIALS TAB
═══════════════════════════════════════════════════════════════════════════ */
const FILE_CATS: Record<FileCategory, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  renders:    { label: 'הדמיות',    icon: ImageIcon,  color: 'text-violet-600', bg: 'bg-violet-50'  },
  documents:  { label: 'מסמכים',   icon: FileText,   color: 'text-blue-600',   bg: 'bg-blue-50'    },
  contracts:  { label: 'חוזים',    icon: FileCheck,  color: 'text-emerald-600',bg: 'bg-emerald-50' },
  creative:   { label: 'קריאייטיב', icon: Film,      color: 'text-amber-600',  bg: 'bg-amber-50'   },
  references: { label: 'רפרנסים',  icon: BookOpen,   color: 'text-rose-600',   bg: 'bg-rose-50'    },
  other:      { label: 'אחר',       icon: Folder,    color: 'text-slate-500',  bg: 'bg-slate-100'  },
};

function kindIcon(kind: FileKind, className = 'w-full h-full object-cover') {
  if (kind === 'image') return null; // shown as thumbnail
  if (kind === 'video') return <Film size={22} className="text-slate-400" />;
  if (kind === 'pdf')   return <FileText size={22} className="text-red-400" />;
  return <FileText size={22} className="text-slate-400" />;
}

function MaterialsTab({ project, onSave, currentUser, leadId }: {
  project: Project; onSave: (p: Project) => void; currentUser: string; leadId: string;
}) {
  const files = project.files ?? [];
  const [catFilter,  setCatFilter]  = useState<FileCategory | 'all'>('all');
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [addingLink, setAddingLink] = useState(false);
  const [editId,     setEditId]     = useState<string | null>(null);
  const [linkForm,   setLinkForm]   = useState<Partial<ClientFile>>({ category: 'documents', kind: 'link', title: '', url: '', aiContext: '', notes: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = catFilter === 'all' ? files : files.filter(f => f.category === catFilter);
  const catCounts: Record<FileCategory, number> = Object.fromEntries(
    (Object.keys(FILE_CATS) as FileCategory[]).map(c => [c, files.filter(f => f.category === c).length])
  ) as Record<FileCategory, number>;

  function detectedKind(file: File): FileKind {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type === 'application/pdf') return 'pdf';
    if (file.type.includes('document') || file.type.includes('word')) return 'doc';
    return 'other';
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true); setProgress(0);
    const path = `accounts/${leadId}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      snap => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => { setUploading(false); },
      async () => {
        const url = await getDownloadURL(storageRef);
        const kind = detectedKind(file);
        const newFile: ClientFile = {
          id: Date.now().toString(), title: file.name, category: 'documents', kind,
          url, storagePath: path, size: file.size, createdAt: new Date().toISOString(), uploadedBy: currentUser,
        };
        onSave({ ...project, files: [...files, newFile], updatedAt: new Date().toISOString() });
        setUploading(false);
      }
    );
  }

  function saveLink() {
    if (!linkForm.title?.trim() || !linkForm.url?.trim()) return;
    const now = new Date().toISOString();
    if (editId) {
      onSave({ ...project, files: files.map(f => f.id === editId ? { ...f, ...linkForm } as ClientFile : f), updatedAt: now });
      setEditId(null);
    } else {
      const f: ClientFile = { id: Date.now().toString(), title: linkForm.title!, category: linkForm.category ?? 'documents', kind: linkForm.kind ?? 'link', url: linkForm.url!, aiContext: linkForm.aiContext, notes: linkForm.notes, createdAt: now, uploadedBy: currentUser };
      onSave({ ...project, files: [...files, f], updatedAt: now });
    }
    setLinkForm({ category: 'documents', kind: 'link', title: '', url: '', aiContext: '', notes: '' });
    setAddingLink(false);
  }

  async function deleteFile(f: ClientFile) {
    if (f.storagePath) {
      try { await deleteObject(ref(storage, f.storagePath)); } catch { /* already deleted */ }
    }
    onSave({ ...project, files: files.filter(x => x.id !== f.id), updatedAt: new Date().toISOString() });
  }

  function startEdit(f: ClientFile) { setLinkForm({ ...f }); setEditId(f.id); setAddingLink(true); }

  const fmtSize = (b: number) => b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)}MB` : b > 1_000 ? `${(b / 1_000).toFixed(0)}KB` : `${b}B`;

  return (
    <div className="space-y-4">
      {/* Filter + Upload bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setCatFilter('all')} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${catFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'}`}>
          הכל ({files.length})
        </button>
        {(Object.keys(FILE_CATS) as FileCategory[]).filter(c => catCounts[c] > 0 || catFilter === c).map(c => {
          const cfg = FILE_CATS[c]; const Icon = cfg.icon;
          return (
            <button key={c} onClick={() => setCatFilter(c)} className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${catFilter === c ? `${cfg.bg} ${cfg.color} border border-current/20` : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              <Icon size={11} />{cfg.label} {catCounts[c] > 0 && `(${catCounts[c]})`}
            </button>
          );
        })}
        <div className="mr-auto flex gap-2">
          <button onClick={() => { setAddingLink(true); setEditId(null); }} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl transition-colors">
            <Link2 size={12} /> קישור
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl transition-colors disabled:opacity-60">
            <Upload size={12} /> {uploading ? `${progress}%` : 'העלה קובץ'}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" accept="image/*,video/*,.pdf,.doc,.docx" onChange={e => handleUpload(e.target.files?.[0])} />
        </div>
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
          <div className="flex justify-between text-xs text-indigo-700 mb-1.5 font-semibold"><span>מעלה קובץ...</span><span>{progress}%</span></div>
          <div className="h-1.5 bg-indigo-100 rounded-full"><div className="h-1.5 bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {/* Add/Edit link form */}
      {addingLink && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <h4 className="font-bold text-slate-800 text-sm text-right">{editId ? 'עריכת קובץ' : 'הוספת קישור / מסמך'}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">קטגוריה</label>
              <select value={linkForm.category || 'documents'} onChange={e => setLinkForm(p => ({ ...p, category: e.target.value as FileCategory }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
                {(Object.keys(FILE_CATS) as FileCategory[]).map(c => <option key={c} value={c}>{FILE_CATS[c].label}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-slate-500 mb-1 block">סוג</label>
              <select value={linkForm.kind || 'link'} onChange={e => setLinkForm(p => ({ ...p, kind: e.target.value as FileKind }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
                {(['link', 'image', 'video', 'pdf', 'doc', 'other'] as FileKind[]).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-xs text-slate-500 mb-1 block">כותרת *</label><input value={linkForm.title || ''} onChange={e => setLinkForm(p => ({ ...p, title: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right" placeholder="שם הקובץ / מסמך..." /></div>
          <div><label className="text-xs text-slate-500 mb-1 block">URL *</label><input dir="ltr" value={linkForm.url || ''} onChange={e => setLinkForm(p => ({ ...p, url: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-left" placeholder="https://..." /></div>
          <div><label className="text-xs text-slate-500 mb-1 block">תוכן לקריאת AI <span className="text-indigo-500">(מה ה-AI צריך לדעת על קובץ זה?)</span></label>
            <textarea value={linkForm.aiContext || ''} onChange={e => setLinkForm(p => ({ ...p, aiContext: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right resize-none" placeholder="תאר את תוכן הקובץ, הפרטים החשובים, ממצאים עיקריים — ה-AI ישתמש בזה לענות על שאלות..." />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAddingLink(false); setEditId(null); setLinkForm({ category: 'documents', kind: 'link', title: '', url: '', aiContext: '', notes: '' }); }} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl">ביטול</button>
            <button onClick={saveLink} disabled={!linkForm.title?.trim() || !linkForm.url?.trim()} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 disabled:opacity-40">שמור</button>
          </div>
        </div>
      )}

      {/* Files grid */}
      {filtered.length === 0 && !addingLink ? (
        <div className="text-center py-12 text-slate-300">
          <Folder size={40} className="mx-auto mb-3 opacity-50" />
          <p className="font-semibold">אין חומרים עדיין</p>
          <p className="text-sm mt-1">העלה קבצים או הוסף קישורים לחומרי הלקוח</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {filtered.map(f => {
            const catCfg = FILE_CATS[f.category]; const CatIcon = catCfg.icon;
            return (
              <div key={f.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm group">
                {/* Preview area */}
                <div className="h-28 bg-slate-50 flex items-center justify-center relative overflow-hidden">
                  {f.kind === 'image' ? (
                    <img src={f.url} alt={f.title} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      {kindIcon(f.kind) || <FileText size={28} className="text-slate-300" />}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${catCfg.bg} ${catCfg.color}`}>{catCfg.label}</span>
                    </div>
                  )}
                  {/* Overlay actions */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a href={f.url} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"><ExternalLink size={14} /></a>
                    <button onClick={() => startEdit(f)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"><Edit2 size={14} /></button>
                    <button onClick={() => deleteFile(f)} className="w-8 h-8 rounded-xl bg-red-500/70 hover:bg-red-500 flex items-center justify-center text-white"><Trash2 size={14} /></button>
                  </div>
                  {/* AI badge */}
                  {f.aiContext && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-violet-500 flex items-center justify-center" title="תוכן AI מוגדר"><Brain size={10} className="text-white" /></div>}
                </div>
                {/* Info */}
                <div className="p-3 text-right">
                  <p className="font-bold text-slate-800 text-sm truncate">{f.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-400">{f.size ? fmtSize(f.size) : f.kind}</span>
                    <span className={`text-[10px] font-bold ${catCfg.color}`}><CatIcon size={9} className="inline ml-0.5" />{catCfg.label}</span>
                  </div>
                  {f.aiContext && <p className="text-[10px] text-violet-500 mt-1 truncate">AI: {f.aiContext.slice(0, 40)}...</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROPOSALS TAB
═══════════════════════════════════════════════════════════════════════════ */
const PROPOSAL_STATUS: Record<Proposal['status'], { label: string; color: string; bg: string }> = {
  draft:    { label: 'טיוטה',    color: 'text-slate-600',   bg: 'bg-slate-100'   },
  sent:     { label: 'נשלח',     color: 'text-blue-700',    bg: 'bg-blue-100'    },
  viewed:   { label: 'נצפה',     color: 'text-amber-700',   bg: 'bg-amber-100'   },
  accepted: { label: 'אושר ✓',  color: 'text-emerald-700', bg: 'bg-emerald-100' },
  rejected: { label: 'נדחה',    color: 'text-red-600',     bg: 'bg-red-100'     },
};

function blankItem(): ProposalItem { return { id: Date.now().toString(), name: '', description: '', quantity: 1, unitPrice: 0 }; }

function exportToPdf(proposal: Proposal, tmpl: string, includeVat: boolean) {
  const subtotal = proposal.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discountAmt = subtotal * ((proposal.discount ?? 0) / 100);
  const afterDiscount = subtotal - discountAmt;
  const vatAmt = includeVat ? afterDiscount * 0.17 : 0;
  const total = afterDiscount + vatAmt;
  const fmtN = (n: number) => `₪${n.toLocaleString('he-IL')}`;

  const headerStyle = tmpl === 'dark' ? 'background:#0f172a;color:#fff;'
    : tmpl === 'minimal' ? 'background:#fff;color:#1e293b;border-bottom:4px solid #6366f1;'
    : tmpl === 'pro' ? 'background:linear-gradient(135deg,#059669,#0d9488);color:#fff;'
    : 'background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;';

  const subtitleColor = tmpl === 'minimal' ? '#6366f1' : 'rgba(255,255,255,0.7)';
  const headerTextColor = tmpl === 'minimal' ? '#1e293b' : '#fff';

  const itemsHtml = proposal.items.map((item, i) => `
    <tr style="background:${i%2===0?'#f8fafc':'#fff'}">
      <td style="padding:10px 16px;font-weight:700;color:#1e293b;text-align:right">${item.name}${item.description ? `<div style="font-size:11px;color:#94a3b8;font-weight:400">${item.description}</div>` : ''}</td>
      <td style="padding:10px 16px;text-align:center;color:#64748b">${item.quantity}</td>
      <td style="padding:10px 16px;text-align:center;color:#64748b">${fmtN(item.unitPrice)}</td>
      <td style="padding:10px 16px;text-align:left;font-weight:700;color:#1e293b">${fmtN(item.quantity * item.unitPrice)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>הצעת מחיר — ${proposal.title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1e293b; background:#fff; }
  @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
  .header { ${headerStyle} padding:40px 48px; }
  .header h1 { font-size:28px; font-weight:900; color:${headerTextColor}; margin-bottom:4px; }
  .header .subtitle { font-size:13px; color:${subtitleColor}; margin-bottom:20px; }
  .header .meta { display:flex; gap:32px; align-items:flex-start; justify-content:space-between; }
  .header .client { text-align:right; }
  .header .client-label { font-size:11px; color:${subtitleColor}; }
  .header .client-name { font-size:20px; font-weight:800; color:${headerTextColor}; }
  .body { padding:36px 48px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  th { background:#f1f5f9; padding:10px 16px; font-size:11px; color:#64748b; text-align:right; font-weight:700; }
  .totals { margin-right:auto; max-width:320px; }
  .totals-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:14px; color:#64748b; }
  .totals-total { display:flex; justify-content:space-between; padding:12px 0; border-top:2px solid #e2e8f0; margin-top:8px; }
  .totals-total .amount { font-size:24px; font-weight:900; color:#4f46e5; }
  .totals-total .label { font-size:15px; font-weight:700; color:#1e293b; }
  .notes { background:#f8fafc; border-radius:12px; padding:20px; margin-top:24px; }
  .notes h3 { font-size:13px; font-weight:700; color:#64748b; margin-bottom:8px; }
  .notes p { font-size:14px; color:#475569; line-height:1.7; }
  .footer { text-align:center; margin-top:40px; color:#cbd5e1; font-size:11px; }
  ${proposal.logoUrl ? `.logo { height:44px; width:auto; object-fit:contain; margin-bottom:12px; }` : ''}
</style>
</head>
<body>
<div class="header">
  ${proposal.logoUrl ? `<img src="${proposal.logoUrl}" alt="logo" class="logo" />` : ''}
  <div class="meta">
    <div>
      ${proposal.validUntil ? `<div style="font-size:13px;color:${subtitleColor}">בתוקף עד: ${new Date(proposal.validUntil).toLocaleDateString('he-IL')}</div>` : ''}
      <div style="font-size:13px;color:${subtitleColor};margin-top:4px">תאריך: ${new Date().toLocaleDateString('he-IL')}</div>
    </div>
    <div class="client">
      <div class="client-label">הצעת מחיר עבור</div>
      <div class="client-name">${proposal.clientName}</div>
      ${proposal.clientEmail ? `<div style="font-size:13px;color:${subtitleColor}">${proposal.clientEmail}</div>` : ''}
    </div>
  </div>
  <div class="subtitle">הצעת מחיר</div>
  <h1>${proposal.title}</h1>
</div>
<div class="body">
  <table>
    <thead><tr><th>שם / תיאור</th><th style="text-align:center">כמות</th><th style="text-align:center">מחיר יח׳</th><th style="text-align:left">סה״כ</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="totals">
    <div class="totals-row"><span>${fmtN(subtotal)}</span><span>סכום ביניים</span></div>
    ${discountAmt > 0 ? `<div class="totals-row"><span style="color:#10b981">-${fmtN(discountAmt)}</span><span>הנחה (${proposal.discount}%)</span></div>` : ''}
    ${vatAmt > 0 ? `<div class="totals-row"><span>+${fmtN(vatAmt)}</span><span>מע״מ 17%</span></div>` : ''}
    <div class="totals-total"><span class="amount">${fmtN(total)}</span><span class="label">סה״כ לתשלום</span></div>
  </div>
  ${proposal.notes ? `<div class="notes"><h3>הערות והתניות</h3><p>${proposal.notes.replace(/\n/g,'<br>')}</p></div>` : ''}
  <div class="footer">מסמך זה הופק אוטומטית במערכת RAY CRM</div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function ProposalBuilder({ proposal, onSave, onClose, clientName }: {
  proposal: Proposal; onSave: (p: Proposal) => void; onClose: () => void; clientName: string;
}) {
  const [p, setP] = useState<Proposal>(proposal);
  const [vat, setVat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [templateId, setTemplateId] = useState<'indigo'|'minimal'|'dark'|'pro'>((p.templateId as 'indigo'|'minimal'|'dark'|'pro') ?? 'indigo');

  const subtotal = p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discountAmt = subtotal * ((p.discount ?? 0) / 100);
  const afterDiscount = subtotal - discountAmt;
  const vatAmt = vat ? afterDiscount * 0.17 : 0;
  const total = afterDiscount + vatAmt;

  const headerClass = templateId === 'dark' ? 'bg-slate-900 text-white'
    : templateId === 'minimal' ? 'bg-white border-b-4 border-indigo-600 text-slate-900'
    : templateId === 'pro' ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white'
    : 'bg-gradient-to-br from-indigo-600 to-violet-700 text-white';

  const subtitleClass = templateId === 'minimal' ? 'text-indigo-600' : 'text-white/70';
  const inputClass = templateId === 'minimal' ? 'text-slate-900 border-slate-300' : 'text-white border-white/30';

  function updateItem(id: string, field: keyof ProposalItem, value: string | number) {
    setP(prev => ({ ...prev, items: prev.items.map(i => i.id === id ? { ...i, [field]: value } : i) }));
  }
  function addItem() { setP(prev => ({ ...prev, items: [...prev.items, blankItem()] })); }
  function removeItem(id: string) { setP(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) })); }
  function setStatus(s: Proposal['status']) { const updated = { ...p, status: s }; setP(updated); onSave(updated); }

  function copyLink() {
    const text = `הצעת מחיר: ${p.title}\nלקוח: ${p.clientName}\nסה״כ: ${fmt(total)}\n\n${p.items.map(i => `• ${i.name}: ${i.quantity} × ${fmt(i.unitPrice)} = ${fmt(i.quantity * i.unitPrice)}`).join('\n')}${p.notes ? `\n\nהערות: ${p.notes}` : ''}`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="space-y-5">
      {/* Template + Logo bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {([
              { id: 'indigo', label: 'אינדיגו', preview: 'bg-gradient-to-r from-indigo-600 to-violet-600' },
              { id: 'minimal', label: 'מינימלי', preview: 'bg-white border-2 border-indigo-600' },
              { id: 'dark', label: 'כהה', preview: 'bg-slate-900' },
              { id: 'pro', label: 'פרו', preview: 'bg-gradient-to-r from-emerald-500 to-teal-500' },
            ] as { id: 'indigo'|'minimal'|'dark'|'pro'; label: string; preview: string }[]).map(t => (
              <button key={t.id} onClick={() => { setTemplateId(t.id); setP(v => ({...v, templateId: t.id})); }}
                className={`flex flex-col items-center gap-1 transition-all ${templateId === t.id ? 'opacity-100' : 'opacity-50 hover:opacity-75'}`}>
                <div className={`w-10 h-7 rounded-lg ${t.preview} ${templateId === t.id ? 'ring-2 ring-indigo-500 ring-offset-1 scale-110' : ''}`} />
                <span className="text-[10px] text-slate-500 font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Palette size={13} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-500">תבנית</span>
          </div>
        </div>
        {/* Logo URL */}
        <div className="flex items-center gap-3">
          <input dir="ltr" value={p.logoUrl || ''} onChange={e => setP(v => ({...v, logoUrl: e.target.value}))} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-slate-400" placeholder="https://... URL ללוגו החברה (אופציונלי)" />
          {p.logoUrl && <img src={p.logoUrl} alt="logo" className="h-8 w-auto object-contain rounded" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />}
          <span className="text-xs text-slate-500 flex-shrink-0">לוגו</span>
        </div>
      </div>

      {/* Back + status + actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(PROPOSAL_STATUS) as Proposal['status'][]).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all ${p.status === s ? `${PROPOSAL_STATUS[s].bg} ${PROPOSAL_STATUS[s].color} border-current/20` : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}>
              {PROPOSAL_STATUS[s].label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={copyLink} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl transition-colors">
            {copied ? <CheckCheck size={12} className="text-emerald-500" /> : <Copy size={12} />} {copied ? 'הועתק!' : 'העתק'}
          </button>
          <button onClick={() => exportToPdf(p, templateId, vat)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl transition-colors">
            <Printer size={12} /> הדפס / PDF
          </button>
          <button onClick={() => { onSave(p); onClose(); }} className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl transition-colors">
            <Check size={12} /> שמור וסגור
          </button>
        </div>
      </div>

      {/* Proposal document */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto print:shadow-none print:border-0">
        <div className="min-w-[640px]">
        {/* Header */}
        <div className={`${headerClass} px-4 md:px-8 py-5 md:py-7 print:px-6 print:py-5`}>
          {p.logoUrl && <img src={p.logoUrl} alt="logo" className="h-10 w-auto object-contain mb-3 rounded" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />}
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm ${subtitleClass}`}>הצעת מחיר</p>
              <div className="flex items-center gap-3 mt-1">
                <input value={p.title} onChange={e => setP(v => ({ ...v, title: e.target.value }))} className={`text-2xl font-black bg-transparent border-b focus:outline-none focus:border-current/80 placeholder-current/50 w-72 print:border-0 ${inputClass}`} placeholder="שם ההצעה..." dir="rtl" />
              </div>
            </div>
            <div className="text-right">
              <p className={`text-xs ${subtitleClass}`}>לקוח</p>
              <input value={p.clientName} onChange={e => setP(v => ({ ...v, clientName: e.target.value }))} className={`font-bold text-lg bg-transparent border-b focus:outline-none text-right print:border-0 ${inputClass}`} dir="rtl" />
              {p.clientEmail !== undefined && (
                <input value={p.clientEmail || ''} onChange={e => setP(v => ({ ...v, clientEmail: e.target.value }))} className={`block text-sm bg-transparent border-b focus:outline-none mt-0.5 print:border-0 ${subtitleClass}`} placeholder="מייל..." dir="ltr" />
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <div className={`flex items-center gap-2 text-sm ${subtitleClass}`}>
              <Calendar size={13} />
              <span>בתוקף עד:</span>
              <input type="date" value={p.validUntil || ''} onChange={e => setP(v => ({ ...v, validUntil: e.target.value }))} className={`bg-transparent border-b focus:outline-none print:border-0 ${inputClass}`} />
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${templateId === 'minimal' ? 'bg-indigo-100 text-indigo-700' : 'bg-white/20 text-white'}`}>{PROPOSAL_STATUS[p.status].label}</span>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6 print:px-6">
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <button onClick={addItem} className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 print:hidden">
                <Plus size={13} /> הוסף שורה
              </button>
              <h3 className="font-bold text-slate-800">פריטי ההצעה</h3>
            </div>
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 text-xs font-bold text-slate-400 text-right mb-2 px-2">
              <span className="col-span-1 print:hidden"></span>
              <span className="col-span-4">שם / תיאור</span>
              <span className="col-span-2 text-center">כמות</span>
              <span className="col-span-2 text-center">מחיר יח׳</span>
              <span className="col-span-2 text-left">סה״כ</span>
              <span className="col-span-1 print:hidden"></span>
            </div>
            <div className="space-y-2">
              {p.items.map((item, idx) => (
                <div key={item.id} className={`grid grid-cols-12 gap-2 items-start p-2.5 rounded-xl ${idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}>
                  <div className="col-span-1 flex items-center pt-1.5 print:hidden">
                    <GripVertical size={13} className="text-slate-300" />
                  </div>
                  <div className="col-span-4">
                    <input value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} className="w-full text-sm font-semibold text-slate-800 bg-transparent border-b border-slate-200 focus:outline-none focus:border-indigo-400 text-right" placeholder="שם הפריט *" />
                    <input value={item.description || ''} onChange={e => updateItem(item.id, 'description', e.target.value)} className="w-full text-xs text-slate-400 bg-transparent border-b border-slate-100 focus:outline-none focus:border-indigo-300 text-right mt-1" placeholder="תיאור (אופציונלי)..." />
                  </div>
                  <div className="col-span-2 text-center">
                    <input type="number" min={1} value={item.quantity} onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))} className="w-full text-center text-sm font-semibold bg-transparent border-b border-slate-200 focus:outline-none focus:border-indigo-400" />
                  </div>
                  <div className="col-span-2 text-center">
                    <input type="number" min={0} value={item.unitPrice || ''} onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))} className="w-full text-center text-sm bg-transparent border-b border-slate-200 focus:outline-none focus:border-indigo-400" placeholder="0" />
                  </div>
                  <div className="col-span-2 text-left">
                    <span className="text-sm font-bold text-slate-800">{fmt(item.quantity * item.unitPrice)}</span>
                  </div>
                  <div className="col-span-1 print:hidden">
                    <button onClick={() => removeItem(item.id)} className="w-5 h-5 rounded-md bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 mt-1"><X size={10} /></button>
                  </div>
                </div>
              ))}
              {p.items.length === 0 && <div className="text-center py-6 text-slate-300 text-sm">לחץ "הוסף שורה" כדי להתחיל</div>}
            </div>
          </div>

          {/* Totals */}
          <div className="mr-auto max-w-xs space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-slate-800">{fmt(subtotal)}</span>
              <span className="text-slate-500">סכום ביניים</span>
            </div>
            {/* Discount */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} max={100} value={p.discount ?? ''} onChange={e => setP(v => ({ ...v, discount: Number(e.target.value) || undefined }))} className="w-14 border border-slate-200 rounded-lg px-2 py-0.5 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 print:border-0" placeholder="0" />
                <Percent size={11} className="text-slate-400" />
                {discountAmt > 0 && <span className="text-emerald-600 font-semibold">-{fmt(discountAmt)}</span>}
              </div>
              <span className="text-slate-500">הנחה</span>
            </div>
            {/* VAT */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer print:hidden">
                  <input type="checkbox" checked={vat} onChange={e => setVat(e.target.checked)} className="rounded" />
                  כולל מע״מ 17%
                </label>
                {vat && <span className="text-slate-600">+{fmt(vatAmt)}</span>}
              </div>
              <span className="text-slate-500">מע״מ</span>
            </div>
            {/* Total */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-xl font-black text-indigo-600">{fmt(total)}</span>
              <span className="font-bold text-slate-800">סה״כ לתשלום</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <h3 className="font-bold text-slate-700 mb-2 text-right text-sm">הערות והתניות</h3>
            <textarea value={p.notes || ''} onChange={e => setP(v => ({ ...v, notes: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right print:border-0" placeholder="תנאי תשלום, לו״ז אספקה, הגבלות אחריות..." />
          </div>
        </div>
        </div>{/* end min-w-[640px] */}
      </div>
    </div>
  );
}

function ProposalsTab({ project, onSave, clientName }: { project: Project; onSave: (p: Project) => void; clientName: string }) {
  const proposals = project.proposals ?? [];
  const [openId, setOpenId] = useState<string | null>(null);

  function createProposal() {
    const now = new Date().toISOString();
    const p: Proposal = { id: Date.now().toString(), title: 'הצעת מחיר חדשה', clientName, items: [blankItem()], status: 'draft', createdAt: now };
    onSave({ ...project, proposals: [...proposals, p], updatedAt: now });
    setOpenId(p.id);
  }

  function updateProposal(p: Proposal) {
    onSave({ ...project, proposals: proposals.map(x => x.id === p.id ? p : x), updatedAt: new Date().toISOString() });
  }

  function deleteProposal(id: string) {
    onSave({ ...project, proposals: proposals.filter(p => p.id !== id), updatedAt: new Date().toISOString() });
    if (openId === id) setOpenId(null);
  }

  // Open a specific proposal
  const openProposal = openId ? proposals.find(p => p.id === openId) : null;
  if (openProposal) {
    return <ProposalBuilder proposal={openProposal} onSave={updateProposal} onClose={() => setOpenId(null)} clientName={clientName} />;
  }

  const totalValue = proposals.filter(p => p.status === 'accepted').reduce((s, p) => s + p.items.reduce((ss, i) => ss + i.quantity * i.unitPrice, 0), 0);

  return (
    <div className="space-y-4">
      {/* Stats + create */}
      <div className="flex items-center justify-between">
        <button onClick={createProposal} className="flex items-center gap-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl transition-colors shadow-sm">
          <Plus size={14} /> הצעת מחיר חדשה
        </button>
        {proposals.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-slate-400">הצעות מאושרות</p>
            <p className="font-black text-indigo-600">{fmt(totalValue)}</p>
          </div>
        )}
      </div>

      {/* Proposals list */}
      {proposals.length === 0 ? (
        <div className="text-center py-12 text-slate-300">
          <Receipt size={40} className="mx-auto mb-3 opacity-50" />
          <p className="font-semibold">אין הצעות מחיר עדיין</p>
          <p className="text-sm mt-1">לחץ "הצעת מחיר חדשה" להתחיל</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(p => {
            const total = p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * (1 - (p.discount ?? 0) / 100);
            const st = PROPOSAL_STATUS[p.status];
            return (
              <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => deleteProposal(p.id)} className="w-7 h-7 rounded-xl bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400"><Trash2 size={12} /></button>
                </div>
                <div className="flex-1 text-right min-w-0">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                    <h4 className="font-black text-slate-900 truncate">{p.title}</h4>
                  </div>
                  <div className="flex items-center justify-end gap-3 text-xs text-slate-400">
                    <span>{p.items.length} פריטים</span>
                    {p.validUntil && <span>בתוקף עד {fmtD(p.validUntil)}</span>}
                    <span>{fmtD(p.createdAt)}</span>
                  </div>
                </div>
                <div className="text-left flex-shrink-0">
                  <p className="text-lg font-black text-indigo-600">{fmt(total)}</p>
                </div>
                <button onClick={() => setOpenId(p.id)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors flex-shrink-0">
                  <PenLine size={12} /> ערוך
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLIENT DETAIL
═══════════════════════════════════════════════════════════════════════════ */
function ClientDetail({ lead, account, onSave, onBack, onLeadClick, currentUser, team }: {
  lead: Lead; account: AccountData; onSave: (a: AccountData) => void;
  onBack: () => void; onLeadClick: (l: Lead) => void;
  currentUser: string; team: string[];
}) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const score = calcHealth(lead, undefined, account.contractEnd);
  const hm = healthMeta(score);

  // Save a project back into the account
  const saveProject = (updatedProject: Project) => {
    const updatedAccount: AccountData = {
      ...account,
      projects: account.projects.some(p => p.id === updatedProject.id)
        ? account.projects.map(p => p.id === updatedProject.id ? updatedProject : p)
        : [...account.projects, updatedProject],
      updatedAt: new Date().toISOString(),
    };
    onSave(updatedAccount);
    setSelectedProject(updatedProject);
  };

  // If a project is selected, show the project detail
  if (selectedProject) {
    const freshProject = account.projects.find(p => p.id === selectedProject.id) ?? selectedProject;
    return (
      <ProjectDetailView
        lead={lead}
        account={account}
        project={freshProject}
        onSaveProject={saveProject}
        onBack={() => setSelectedProject(null)}
        onLeadClick={onLeadClick}
        currentUser={currentUser}
        team={team}
      />
    );
  }

  // Otherwise show the projects list
  return (
    <div className="space-y-5">
      {/* Back + open lead */}
      <div className="flex items-center justify-between">
        <button onClick={() => onLeadClick(lead)} className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors"><Zap size={12} className="text-indigo-500" /> פתח כרטיס ליד</button>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">חזרה לרשימה <ArrowRight size={16} /></button>
      </div>

      {/* Client header card */}
      <div className={`bg-white rounded-2xl border-2 ${hm.ring} shadow-sm p-5`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={`px-3 py-1.5 rounded-xl text-sm font-black ${hm.lightBg} ${hm.text}`}>{score}% {hm.label}</div>
            <div className="flex gap-1.5">
              {lead.phone && <a href={`tel:${lead.phone}`} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"><Phone size={14} /></a>}
              {lead.email && <a href={`mailto:${lead.email}`} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"><Mail size={14} /></a>}
              {lead.phone && <a href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center text-emerald-500 transition-colors"><MessageCircle size={14} /></a>}
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-black text-slate-900">{lead.company}</h2>
            <p className="text-slate-500 text-sm">{lead.contactName} · {lead.assignedTo}</p>
          </div>
        </div>
      </div>

      {/* Projects section */}
      <ProjectsList
        account={account}
        team={team}
        onSelectProject={setSelectedProject}
        onSaveAccount={onSave}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLIENT CARD (grid)
═══════════════════════════════════════════════════════════════════════════ */
function ClientCard({ lead, account, onClick }: { lead: Lead; account: AccountData | undefined; onClick: () => void }) {
  const score = calcHealth(lead, undefined, account?.contractEnd);
  const hm = healthMeta(score);
  const allPayments = (account?.projects ?? []).flatMap(p => p.payments ?? []);
  const overduePay = allPayments.some(p => p.status === 'overdue');
  const daysLeft = account?.contractEnd ? daysTo(account.contractEnd) : null;
  const cmMedia = (account?.projects ?? []).flatMap(p => (p.mediaRecords ?? []).filter(r => r.month === currentMonth()));
  const cmLeads = cmMedia.reduce((s, r) => s + r.leads, 0);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const overdueT = lead.tasks.filter(t => { if (t.completed) return false; try { return new Date(t.date + 'T00:00:00') < midnight; } catch { return false; } });
  const projectCount = account?.projects?.length ?? 0;
  const allUpsell = (account?.projects ?? []).some(p => p.upsellNote);

  return (
    <button onClick={onClick} className={`w-full text-right bg-white rounded-2xl border-2 ${hm.ring} shadow-sm hover:shadow-lg transition-all p-5 group`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${hm.lightBg} ${hm.text} flex-shrink-0`}>{score}%</span>
        <div className="min-w-0"><h3 className="font-black text-slate-900 truncate">{lead.company}</h3><p className="text-xs text-slate-500 truncate">{lead.contactName}</p></div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full mb-3"><div className={`h-1.5 rounded-full ${hm.bg} transition-all`} style={{ width: `${score}%` }} /></div>
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div className="bg-slate-50 rounded-xl p-2 text-right"><p className="text-slate-400 mb-0.5">ריטיינר</p><p className="font-bold text-slate-800">{account?.monthlyRetainer ? fmtK(account.monthlyRetainer) : '—'}</p></div>
        <div className="bg-slate-50 rounded-xl p-2 text-right"><p className="text-slate-400 mb-0.5">לידים החודש</p><p className="font-bold text-indigo-600">{cmLeads || '—'}</p></div>
      </div>
      {projectCount > 0 && <div className="mb-3 text-xs text-slate-500 text-right">{projectCount} פרויקטים</div>}
      <div className="flex gap-1.5 flex-wrap">
        {score < 40 && <span className="text-xs bg-red-600 text-white font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><Shield size={9} /> Deal Shield</span>}
        {overdueT.length > 0 && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">⚠ {overdueT.length} משימות</span>}
        {overduePay && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">💳 תשלום</span>}
        {daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">📅 חידוש {daysLeft}י</span>}
        {allUpsell && <span className="text-xs bg-violet-100 text-violet-700 font-semibold px-2 py-0.5 rounded-full">🚀 אפסל</span>}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
interface DealsProps {
  leads: Lead[];
  team?: { name: string }[];
  currentUser: string;
  onLeadClick: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type FilterKey = 'all' | 'healthy' | 'warning' | 'critical' | 'renewal';

interface ShieldAlert { company: string; risk: string; recommendation: string; priority: 'high' | 'medium'; }

export default function Deals({ leads, team = [], currentUser, onLeadClick, onToast }: DealsProps) {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [filter, setFilter]     = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [shieldLoading, setShieldLoading] = useState(false);
  const [shieldAlerts,  setShieldAlerts]  = useState<ShieldAlert[] | null>(null);
  const [shieldOpen,    setShieldOpen]    = useState(false);

  const activeClients = useMemo(() => leads.filter(l => l.status === 'לקוח פעיל'), [leads]);
  const teamNames = useMemo(() => team.map(m => m.name), [team]);
  const getAcc = (id: string) => accounts.find(a => a.leadId === id);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'accounts'), snap => {
      setAccounts(snap.docs.map(d => d.data() as AccountData));
    });
    return () => unsub();
  }, []);

  function openClient(lead: Lead) {
    if (!getAcc(lead.id)) setAccounts(p => [...p, blankAccount(lead.id, lead.budget ?? 0)]);
    setSelected(lead);
  }

  // Deep-strips undefined from any value (Firestore rejects undefined anywhere)
  function deepClean<T>(val: T): T {
    if (Array.isArray(val)) return val.map(deepClean) as unknown as T;
    if (val !== null && typeof val === 'object') {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, deepClean(v)])
      ) as T;
    }
    return val;
  }

  async function saveAccount(data: AccountData) {
    try {
      const clean = deepClean(data);
      await setDoc(doc(db, 'accounts', data.leadId), clean);
      setAccounts(p => p.map(a => a.leadId === data.leadId ? data : a));
      onToast?.('נשמר ✓', 'success');
    } catch (err) {
      console.error('saveAccount error:', err);
      onToast?.('שגיאה בשמירה', 'error');
    }
  }

  async function runDealShield() {
    const apiKey = getApiKey();
    if (!apiKey) return;
    setShieldLoading(true); setShieldAlerts(null); setShieldOpen(true);
    const atRisk = activeClients
      .map(l => ({ l, a: getAcc(l.id), score: calcHealth(l, undefined, getAcc(l.id)?.contractEnd) }))
      .filter(x => x.score < 60)
      .sort((a, b) => a.score - b.score)
      .slice(0, 6);
    if (atRisk.length === 0) { setShieldAlerts([]); setShieldLoading(false); return; }
    const summary = atRisk.map(({ l, a, score }) => {
      const issues = [];
      const overdueT = l.tasks.filter(t => !t.completed && new Date(t.date + 'T00:00:00') < new Date()).length;
      if (overdueT > 0) issues.push(`${overdueT} משימות באיחור`);
      const allPayments = (a?.projects ?? []).flatMap(p => p.payments ?? []);
      if (allPayments.some(p => p.status === 'overdue')) issues.push('תשלום באיחור');
      if (a?.contractEnd && (new Date(a.contractEnd).getTime() - Date.now()) / 86400000 < 30) issues.push('חוזה מסתיים');
      return `${l.company} (${score}%) - ${issues.join(', ') || 'ללא קשר אחרון'}`;
    }).join('\n');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-6', max_tokens: 1200,
        messages: [{ role: 'user', content: `אתה מומחה שימור לקוחות. הלקוחות הבאים בסיכון:\n\n${summary}\n\nעבור כל לקוח, תן המלצה ספציפית וממוקדת (משפט אחד) לשמירת הלקוח.\nהחזר JSON בלבד:\n[{"company":"שם החברה","risk":"הסיכון העיקרי","recommendation":"מה לעשות עכשיו","priority":"high|medium"}]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const jsonMatch = txt.match(/\[[\s\S]*\]/);
      if (jsonMatch) setShieldAlerts(JSON.parse(jsonMatch[0]) as ShieldAlert[]);
      else setShieldAlerts([]);
    } catch { setShieldAlerts([]); }
    finally { setShieldLoading(false); }
  }

  const mrr = activeClients.reduce((s, l) => s + (getAcc(l.id)?.monthlyRetainer ?? l.budget ?? 0), 0);
  const attention = activeClients.filter(l => calcHealth(l, undefined, getAcc(l.id)?.contractEnd) < 60).length;
  const totalManagedMedia = accounts.reduce((s, a) => s + (a.projects ?? []).flatMap(p => p.mediaRecords ?? []).reduce((ss, r) => ss + r.spend, 0), 0);
  const renewalSoon = activeClients.filter(l => { const a = getAcc(l.id); if (!a?.contractEnd) return false; const d = daysTo(a.contractEnd); return d >= 0 && d <= 30; }).length;

  const filtered = useMemo(() => activeClients.filter(l => {
    const a = getAcc(l.id); const sc = calcHealth(l, undefined, a?.contractEnd);
    switch (filter) {
      case 'healthy':  return sc >= 70;
      case 'warning':  return sc >= 40 && sc < 70;
      case 'critical': return sc < 40;
      case 'renewal':  { const d = a?.contractEnd ? daysTo(a.contractEnd) : null; return d !== null && d >= 0 && d <= 30; }
      default: return true;
    }
  }).sort((a, b) => calcHealth(a, undefined, getAcc(a.id)?.contractEnd) - calcHealth(b, undefined, getAcc(b.id)?.contractEnd)), [activeClients, accounts, filter]);

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',      label: 'הכל',          count: activeClients.length },
    { key: 'critical', label: '🔴 קריטי',     count: activeClients.filter(l => calcHealth(l, undefined, getAcc(l.id)?.contractEnd) < 40).length },
    { key: 'warning',  label: '🟡 דורש טיפול',count: activeClients.filter(l => { const s = calcHealth(l, undefined, getAcc(l.id)?.contractEnd); return s >= 40 && s < 70; }).length },
    { key: 'healthy',  label: '🟢 תקין',      count: activeClients.filter(l => calcHealth(l, undefined, getAcc(l.id)?.contractEnd) >= 70).length },
    { key: 'renewal',  label: '📅 חידוש',     count: renewalSoon },
  ];

  // Detail view
  if (selected) {
    const acc = getAcc(selected.id) ?? blankAccount(selected.id, selected.budget ?? 0);
    return <ClientDetail lead={selected} account={acc} onSave={saveAccount} onBack={() => setSelected(null)} onLeadClick={onLeadClick} currentUser={currentUser} team={teamNames} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <div><h1 className="text-xl font-black text-slate-900">ניהול לקוחות פעילים</h1><p className="text-slate-500 text-sm">{activeClients.length} לקוחות פעילים</p></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'לקוחות פעילים', value: activeClients.length, icon: <Users size={18} className="text-indigo-600" />, bg: 'bg-indigo-50', sub: 'סה״כ' },
          { label: 'MRR', value: fmtK(mrr), icon: <DollarSign size={18} className="text-emerald-600" />, bg: 'bg-emerald-50', sub: 'הכנסה חודשית' },
          { label: 'תקציב מדיה', value: fmtK(totalManagedMedia), icon: <BarChart2 size={18} className="text-blue-600" />, bg: 'bg-blue-50', sub: 'כולל מנוהל' },
          { label: 'דורשים טיפול', value: attention, icon: <AlertTriangle size={18} className={attention > 0 ? 'text-amber-500' : 'text-slate-400'} />, bg: attention > 0 ? 'bg-amber-50' : 'bg-slate-50', sub: 'health < 60%' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className={`w-10 h-10 ${k.bg} rounded-xl flex items-center justify-center mb-3`}>{k.icon}</div>
            <div className="text-2xl font-black text-slate-900 mb-0.5">{k.value}</div>
            <div className="text-sm font-semibold text-slate-700">{k.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filter === f.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            {f.label}
            {f.count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${filter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{f.count}</span>}
          </button>
        ))}
        <button
          onClick={runDealShield}
          disabled={shieldLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white shadow-sm transition-all disabled:opacity-60 mr-auto"
        >
          {shieldLoading ? <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full" /> : <Shield size={14} />}
          Deal Shield
        </button>
      </div>

      {/* Deal Shield Panel */}
      {shieldOpen && (
        <div className="bg-white border-2 border-red-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setShieldOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Shield size={15} className="text-red-500" /> Deal Shield — לקוחות בסיכון</h3>
          </div>
          {shieldLoading ? (
            <div className="flex items-center justify-center gap-3 py-6 text-slate-500">
              <span className="animate-spin w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full inline-block" />
              מנתח לקוחות בסיכון...
            </div>
          ) : shieldAlerts && shieldAlerts.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-emerald-600 font-bold text-lg">🛡 כל הלקוחות תקינים!</p>
              <p className="text-slate-400 text-sm mt-1">אין לקוחות בסיכון כרגע</p>
            </div>
          ) : shieldAlerts ? (
            <div className="space-y-3">
              {shieldAlerts.map((alert, i) => (
                <div key={i} className={`rounded-xl border p-4 text-right ${alert.priority === 'high' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${alert.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{alert.priority === 'high' ? '🔴 קריטי' : '🟡 בינוני'}</span>
                    <div>
                      <p className="font-black text-slate-900">{alert.company}</p>
                      <p className="text-xs text-slate-500">{alert.risk}</p>
                    </div>
                  </div>
                  <div className="bg-white/70 rounded-lg p-2.5">
                    <p className="text-xs font-bold text-red-700 mb-1">→ פעולה מיידית</p>
                    <p className="text-sm text-slate-800">{alert.recommendation}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {activeClients.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center"><div className="text-5xl mb-4">👥</div><h3 className="font-bold text-slate-700 text-lg mb-2">אין לקוחות פעילים</h3><p className="text-slate-400 text-sm">שנה סטטוס ליד ל״לקוח פעיל״ כדי שיופיע כאן</p></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center"><p className="text-slate-400">אין לקוחות בקטגוריה זו</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(lead => <ClientCard key={lead.id} lead={lead} account={getAcc(lead.id)} onClick={() => openClient(lead)} />)}
        </div>
      )}
    </div>
  );
}
