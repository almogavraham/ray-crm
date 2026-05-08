import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowRight, CheckCircle2, Clock, DollarSign, Calendar,
  TrendingUp, Users, AlertTriangle, RefreshCw, X, Plus,
  FileText, Phone, Mail, MessageCircle, Star, ChevronDown,
  Trash2, Edit2, Check, MoreVertical, Zap, Activity,
  CreditCard, Package, StickyNote,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import type {
  Lead, AccountData, ManagedSolution, SolutionStatus,
  PaymentRecord, PaymentType, ActivityEntry, ActivityType,
} from '../types';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────────────── */
const SOL_STATUS: Record<SolutionStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  not_started: { label: 'טרם החל',   color: 'text-slate-500',  bg: 'bg-slate-100',  icon: Clock },
  in_progress:  { label: 'בביצוע',    color: 'text-blue-600',   bg: 'bg-blue-100',   icon: TrendingUp },
  delivered:    { label: 'הועבר',     color: 'text-amber-600',  bg: 'bg-amber-100',  icon: Package },
  approved:     { label: 'אושר ✓',   color: 'text-emerald-600',bg: 'bg-emerald-100',icon: CheckCircle2 },
};

const PAY_STATUS = {
  paid:      { label: 'שולם',    color: 'text-emerald-700', bg: 'bg-emerald-100' },
  pending:   { label: 'ממתין',   color: 'text-amber-700',   bg: 'bg-amber-100'   },
  overdue:   { label: 'באיחור',  color: 'text-red-600',     bg: 'bg-red-100'     },
  cancelled: { label: 'בוטל',    color: 'text-slate-500',   bg: 'bg-slate-100'   },
};

const PAY_TYPE: Record<PaymentType, string> = {
  retainer: 'ריטיינר', one_time: 'חד-פעמי', bonus: 'בונוס',
};

const ACT_TYPE: Record<ActivityType, { label: string; icon: React.ElementType; color: string }> = {
  note:      { label: 'הערה',    icon: StickyNote,      color: 'text-slate-500' },
  call:      { label: 'שיחה',    icon: Phone,           color: 'text-blue-500'  },
  meeting:   { label: 'פגישה',   icon: Users,           color: 'text-violet-500'},
  email:     { label: 'מייל',    icon: Mail,            color: 'text-indigo-500'},
  whatsapp:  { label: 'WhatsApp',icon: MessageCircle,   color: 'text-emerald-500'},
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */
function calcHealth(lead: Lead, acc: AccountData | undefined): number {
  let score = 100;
  const now = new Date();
  const midnight = new Date(); midnight.setHours(0,0,0,0);

  // Contact recency — prefer activityLog, fall back to lead.notes
  const allTimestamps = [
    ...(acc?.activityLog ?? []).map(a => a.timestamp),
    ...lead.notes.map(n => n.timestamp),
  ].sort((a,b) => b.localeCompare(a));
  if (!allTimestamps.length) {
    score -= 30;
  } else {
    const days = (now.getTime() - new Date(allTimestamps[0]).getTime()) / 86_400_000;
    if (days > 30) score -= 35;
    else if (days > 14) score -= 20;
    else if (days > 7)  score -= 10;
  }

  // Overdue tasks
  const overdue = lead.tasks.filter(t => {
    if (t.completed) return false;
    try { return new Date(t.date + 'T00:00:00') < midnight; } catch { return false; }
  });
  score -= Math.min(overdue.length * 15, 30);

  // Contract expiry
  if (acc?.contractEnd) {
    const d = Math.ceil((new Date(acc.contractEnd).getTime() - now.getTime()) / 86_400_000);
    if (d < 0) score -= 30; else if (d < 14) score -= 20; else if (d < 30) score -= 10;
  }

  // Overdue payment
  if (acc?.payments?.some(p => p.status === 'overdue')) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function healthMeta(score: number) {
  if (score >= 70) return { label: 'תקין',       bg: 'bg-emerald-500', ring: 'ring-emerald-200', text: 'text-emerald-700', lightBg: 'bg-emerald-50' };
  if (score >= 40) return { label: 'דורש טיפול', bg: 'bg-amber-500',   ring: 'ring-amber-200',   text: 'text-amber-700',   lightBg: 'bg-amber-50'   };
  return               { label: 'קריטי',        bg: 'bg-red-500',     ring: 'ring-red-200',     text: 'text-red-600',     lightBg: 'bg-red-50'     };
}

const fmt    = (n: number) => `₪${n.toLocaleString('he-IL')}`;
const fmtK   = (n: number) => n >= 1000 ? `₪${(n/1000).toFixed(0)}K` : fmt(n);
const fmtD   = (s: string) => { try { return new Date(s).toLocaleDateString('he-IL', { day:'numeric', month:'short', year:'numeric' }); } catch { return s; } };
const daysTo = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
const ago    = (ts: string) => { const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000); return d === 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`; };
const todayStr = () => new Date().toISOString().split('T')[0];

function blankAccount(leadId: string, budget: number): AccountData {
  return {
    leadId, contractStart: '', contractEnd: '', monthlyRetainer: budget,
    solutions: [], payments: [], activityLog: [], upsellNote: '', updatedAt: '',
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   OVERVIEW TAB
───────────────────────────────────────────────────────────────────────────── */
function OverviewTab({ lead, account, onSave, currentUser }: {
  lead: Lead; account: AccountData; onSave: (a: AccountData) => void; currentUser: string;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(account);
  const [newLog, setNewLog] = useState('');
  const [logType, setLogType] = useState<ActivityType>('note');

  useEffect(() => { setForm(account); }, [account]);

  const score = calcHealth(lead, account);
  const hm    = healthMeta(score);

  const openTasks = lead.tasks.filter(t => !t.completed);
  const midnight  = new Date(); midnight.setHours(0,0,0,0);
  const overdueT  = openTasks.filter(t => { try { return new Date(t.date+'T00:00:00') < midnight; } catch { return false; } });
  const totalPaid = account.payments.filter(p => p.status === 'paid').reduce((s,p) => s+p.amount, 0);

  function saveContract() {
    onSave({ ...account, ...form, updatedAt: new Date().toISOString() });
    setEditing(false);
  }

  function addLog() {
    if (!newLog.trim()) return;
    const entry: ActivityEntry = {
      id: Date.now().toString(), type: logType, text: newLog.trim(),
      author: currentUser, timestamp: new Date().toISOString(),
    };
    const updated = { ...account, activityLog: [entry, ...(account.activityLog ?? [])], updatedAt: new Date().toISOString() };
    onSave(updated);
    setNewLog('');
  }

  const recentLog = [...(account.activityLog ?? []), ...lead.notes.map(n => ({
    id: n.id, type: 'note' as ActivityType, text: n.text, author: n.author, timestamp: n.timestamp,
  }))].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8);

  return (
    <div className="space-y-5">
      {/* Health breakdown */}
      <div className={`${hm.lightBg} rounded-2xl p-5 ring-1 ${hm.ring}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-2xl font-black ${hm.text}`}>{score}%</span>
          <div className="text-right">
            <p className="font-bold text-slate-800">ציון בריאות לקוח</p>
            <p className={`text-sm font-semibold ${hm.text}`}>{hm.label}</p>
          </div>
        </div>
        <div className="h-2.5 bg-white/60 rounded-full">
          <div className={`h-2.5 rounded-full ${hm.bg} transition-all duration-700`} style={{ width: `${score}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          {overdueT.length > 0 && <span className="bg-red-100 text-red-600 font-semibold px-2 py-1 rounded-lg">⚠ {overdueT.length} משימות באיחור</span>}
          {account.contractEnd && daysTo(account.contractEnd) <= 30 && daysTo(account.contractEnd) >= 0 &&
            <span className="bg-amber-100 text-amber-700 font-semibold px-2 py-1 rounded-lg">📅 חידוש בעוד {daysTo(account.contractEnd)} ימים</span>}
          {account.payments.some(p => p.status === 'overdue') &&
            <span className="bg-red-100 text-red-600 font-semibold px-2 py-1 rounded-lg">💳 תשלום באיחור</span>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'הכנסה כוללת', value: fmt(totalPaid), icon: <DollarSign size={15} className="text-emerald-600" />, bg: 'bg-emerald-50' },
          { label: 'משימות פתוחות', value: openTasks.length, icon: <Clock size={15} className="text-blue-600" />, bg: 'bg-blue-50' },
          { label: 'פתרונות', value: `${account.solutions.filter(s=>s.status==='approved').length}/${account.solutions.length}`, icon: <Package size={15} className="text-violet-600" />, bg: 'bg-violet-50' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
            <div className={`w-8 h-8 ${s.bg} rounded-xl flex items-center justify-center mx-auto mb-1.5`}>{s.icon}</div>
            <div className="text-lg font-black text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Contract + settings */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => editing ? saveContract() : setEditing(true)}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${editing ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {editing ? <><Check size={12} /> שמור</> : <><Edit2 size={12} /> ערוך</>}
          </button>
          <h3 className="font-bold text-slate-800">פרטי חוזה</h3>
        </div>
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 mb-1 block">תחילת חוזה</label>
                <input type="date" value={form.contractStart} onChange={e => setForm(p => ({...p, contractStart: e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
              <div><label className="text-xs text-slate-500 mb-1 block">סיום חוזה</label>
                <input type="date" value={form.contractEnd} onChange={e => setForm(p => ({...p, contractEnd: e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            </div>
            <div><label className="text-xs text-slate-500 mb-1 block">ריטיינר חודשי (₪)</label>
              <input type="number" min={0} value={form.monthlyRetainer||''} onChange={e => setForm(p => ({...p, monthlyRetainer: Number(e.target.value)}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">הצעד הבא</label>
              <input type="text" value={form.nextStep||''} onChange={e => setForm(p => ({...p, nextStep: e.target.value}))} placeholder="מה הצעד הבא עם הלקוח?" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">הזדמנות אפסל</label>
              <textarea value={form.upsellNote||''} onChange={e => setForm(p => ({...p, upsellNote: e.target.value}))} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="פוטנציאל שדרוג / הרחבת שירות..." /></div>
            <div>
              <label className="text-xs text-slate-500 mb-2 block">שביעות רצון לקוח</label>
              <div className="flex gap-1 justify-end">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setForm(p => ({...p, satisfactionScore: n}))}
                    className={`text-xl transition-all ${(form.satisfactionScore??0) >= n ? 'text-amber-400' : 'text-slate-200'}`}>★</button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-sm text-right">
            {[
              { label: 'תחילת חוזה', value: account.contractStart ? fmtD(account.contractStart) : '—' },
              { label: 'סיום חוזה', value: account.contractEnd ? `${fmtD(account.contractEnd)} (${daysTo(account.contractEnd)} ימים)` : '—' },
              { label: 'ריטיינר', value: account.monthlyRetainer ? fmt(account.monthlyRetainer) : '—' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-slate-50">
                <span className="text-slate-700 font-medium">{r.value}</span>
                <span className="text-slate-400 text-xs">{r.label}</span>
              </div>
            ))}
            {account.nextStep && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-right mt-2">
                <p className="text-xs font-bold text-indigo-600 mb-1">→ הצעד הבא</p>
                <p className="text-sm text-indigo-800">{account.nextStep}</p>
              </div>
            )}
            {account.upsellNote && (
              <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 text-right mt-2">
                <p className="text-xs font-bold text-violet-600 mb-1">🚀 הזדמנות אפסל</p>
                <p className="text-sm text-violet-800">{account.upsellNote}</p>
              </div>
            )}
            {(account.satisfactionScore ?? 0) > 0 && (
              <div className="flex items-center justify-between pt-1">
                <div className="flex gap-0.5">{[1,2,3,4,5].map(n => <span key={n} className={`text-lg ${(account.satisfactionScore??0)>=n?'text-amber-400':'text-slate-200'}`}>★</span>)}</div>
                <span className="text-xs text-slate-400">שביעות רצון</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activity log */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-4 text-right">לוג פעילות</h3>
        <div className="flex gap-2 mb-4">
          <button onClick={addLog} disabled={!newLog.trim()}
            className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-2 rounded-xl text-xs font-bold transition-colors">
            הוסף
          </button>
          <input value={newLog} onChange={e => setNewLog(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addLog()}
            placeholder="מה קרה עם הלקוח?"
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right" />
          <select value={logType} onChange={e => setLogType(e.target.value as ActivityType)}
            className="border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-600 focus:outline-none bg-white">
            {(Object.keys(ACT_TYPE) as ActivityType[]).map(t => <option key={t} value={t}>{ACT_TYPE[t].label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          {recentLog.length === 0 && <p className="text-center text-slate-300 py-4 text-sm">אין פעילות עדיין</p>}
          {recentLog.map(e => {
            const at = ACT_TYPE[e.type];
            const Icon = at.icon;
            return (
              <div key={e.id} className="flex gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="text-right flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-snug">{e.text}</p>
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <span className="text-xs text-slate-300">{ago(e.timestamp)}</span>
                    <span className="text-xs text-slate-400">{e.author}</span>
                  </div>
                </div>
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100 ${at.color}`}>
                  <Icon size={13} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   SOLUTIONS TAB
───────────────────────────────────────────────────────────────────────────── */
function SolutionsTab({ account, onSave, team }: {
  account: AccountData; onSave: (a: AccountData) => void; team: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const blank = (): Partial<ManagedSolution> => ({ name: '', description: '', status: 'not_started', dueDate: '', assignedTo: '', notes: '' });
  const [form, setForm] = useState<Partial<ManagedSolution>>(blank());

  const solutions = account.solutions ?? [];

  function save() {
    if (!form.name?.trim()) return;
    const now = new Date().toISOString();
    if (editId) {
      const updated = solutions.map(s => s.id === editId ? { ...s, ...form } as ManagedSolution : s);
      onSave({ ...account, solutions: updated, updatedAt: now });
      setEditId(null);
    } else {
      const sol: ManagedSolution = { id: Date.now().toString(), createdAt: now, ...form, name: form.name!, status: form.status ?? 'not_started' };
      onSave({ ...account, solutions: [...solutions, sol], updatedAt: now });
      setAdding(false);
    }
    setForm(blank());
  }

  function changeStatus(id: string, status: SolutionStatus) {
    const updated = solutions.map(s => s.id === id ? { ...s, status } : s);
    onSave({ ...account, solutions: updated, updatedAt: new Date().toISOString() });
  }

  function deleteSol(id: string) {
    onSave({ ...account, solutions: solutions.filter(s => s.id !== id), updatedAt: new Date().toISOString() });
  }

  function startEdit(s: ManagedSolution) { setEditId(s.id); setForm({ ...s }); setAdding(false); }

  const approved = solutions.filter(s => s.status === 'approved').length;
  const pct = solutions.length > 0 ? Math.round((approved / solutions.length) * 100) : 0;

  const SolForm = () => (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-500 mb-1 block">שם הפתרון *</label>
          <input value={form.name||''} onChange={e => setForm(p=>({...p,name:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" placeholder="ניהול מדיה חברתית..." /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">סטטוס</label>
          <select value={form.status||'not_started'} onChange={e => setForm(p=>({...p,status:e.target.value as SolutionStatus}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white">
            {(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => <option key={k} value={k}>{SOL_STATUS[k].label}</option>)}
          </select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-slate-500 mb-1 block">תאריך יעד</label>
          <input type="date" value={form.dueDate||''} onChange={e => setForm(p=>({...p,dueDate:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" /></div>
        <div><label className="text-xs text-slate-500 mb-1 block">אחראי</label>
          <select value={form.assignedTo||''} onChange={e => setForm(p=>({...p,assignedTo:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none bg-white">
            <option value="">ללא שיוך</option>
            {team.map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
      </div>
      <div><label className="text-xs text-slate-500 mb-1 block">תיאור / הערות</label>
        <textarea value={form.description||''} onChange={e => setForm(p=>({...p,description:e.target.value}))} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" /></div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setAdding(false); setEditId(null); setForm(blank()); }} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">ביטול</button>
        <button onClick={save} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500">שמור</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Progress */}
      {solutions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="font-black text-slate-900">{pct}%</span>
            <span className="text-slate-500">{approved}/{solutions.length} אושרו</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full">
            <div className="h-2.5 bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500 justify-end">
            {(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => {
              const count = solutions.filter(s => s.status === k).length;
              if (!count) return null;
              const m = SOL_STATUS[k];
              return <span key={k} className={`font-semibold ${m.color}`}>{m.label}: {count}</span>;
            })}
          </div>
        </div>
      )}

      {/* Add button */}
      {!adding && !editId && (
        <button onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 py-3 rounded-2xl text-sm font-semibold transition-all">
          <Plus size={16} /> הוסף פתרון
        </button>
      )}
      {adding && <SolForm />}

      {/* Solutions list */}
      <div className="space-y-3">
        {solutions.length === 0 && !adding && (
          <div className="text-center py-12 text-slate-300">
            <Package size={32} className="mx-auto mb-3 opacity-50" />
            <p className="font-semibold">אין פתרונות עדיין</p>
            <p className="text-sm mt-1">הוסף את הפתרונות שאתה מספק ללקוח</p>
          </div>
        )}
        {solutions.map(s => {
          const m = SOL_STATUS[s.status];
          const Icon = m.icon;
          const isEditing = editId === s.id;
          if (isEditing) return <SolForm key={s.id} />;
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => deleteSol(s.id)} className="w-7 h-7 rounded-xl bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                  <button onClick={() => startEdit(s)} className="w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                    <Edit2 size={12} />
                  </button>
                </div>
                <div className="flex-1 text-right min-w-0">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${m.bg} ${m.color} flex items-center gap-1`}>
                      <Icon size={10} />{m.label}
                    </span>
                    <h4 className="font-bold text-slate-800">{s.name}</h4>
                  </div>
                  {s.description && <p className="text-xs text-slate-500 mb-1.5">{s.description}</p>}
                  <div className="flex items-center justify-end gap-3 text-xs text-slate-400">
                    {s.assignedTo && <span>👤 {s.assignedTo}</span>}
                    {s.dueDate && <span>📅 {fmtD(s.dueDate)}</span>}
                  </div>
                </div>
              </div>
              {/* Quick status change */}
              <div className="mt-3 flex gap-1.5 justify-end flex-wrap">
                {(Object.keys(SOL_STATUS) as SolutionStatus[]).map(k => (
                  <button key={k} onClick={() => changeStatus(s.id, k)}
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

/* ─────────────────────────────────────────────────────────────────────────────
   PAYMENTS TAB
───────────────────────────────────────────────────────────────────────────── */
function PaymentsTab({ account, onSave }: { account: AccountData; onSave: (a: AccountData) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<PaymentRecord>>({ date: todayStr(), type: 'retainer', status: 'paid', amount: account.monthlyRetainer });

  const payments = (account.payments ?? []).sort((a,b) => b.date.localeCompare(a.date));

  function addPayment() {
    if (!form.amount || !form.date) return;
    const rec: PaymentRecord = {
      id: Date.now().toString(), date: form.date!, amount: Number(form.amount),
      type: form.type ?? 'retainer', status: form.status ?? 'paid',
      ...(form.invoiceNumber ? { invoiceNumber: form.invoiceNumber } : {}),
      ...(form.notes ? { notes: form.notes } : {}),
      ...(form.status === 'paid' ? { paidAt: new Date().toISOString() } : {}),
    };
    onSave({ ...account, payments: [rec, ...payments], updatedAt: new Date().toISOString() });
    setAdding(false);
    setForm({ date: todayStr(), type: 'retainer', status: 'paid', amount: account.monthlyRetainer });
  }

  function toggleStatus(id: string) {
    const updated = payments.map(p => {
      if (p.id !== id) return p;
      const next: PaymentRecord['status'] = p.status === 'paid' ? 'pending' : p.status === 'pending' ? 'overdue' : 'paid';
      return { ...p, status: next, ...(next === 'paid' ? { paidAt: new Date().toISOString() } : {}) };
    });
    onSave({ ...account, payments: updated, updatedAt: new Date().toISOString() });
  }

  function deletePayment(id: string) {
    onSave({ ...account, payments: payments.filter(p => p.id !== id), updatedAt: new Date().toISOString() });
  }

  const totalPaid    = payments.filter(p => p.status==='paid').reduce((s,p)=>s+p.amount,0);
  const totalPending = payments.filter(p => p.status==='pending').reduce((s,p)=>s+p.amount,0);
  const totalOverdue = payments.filter(p => p.status==='overdue').reduce((s,p)=>s+p.amount,0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'שולם', value: totalPaid,    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
          { label: 'ממתין', value: totalPending, color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-100'   },
          { label: 'באיחור', value: totalOverdue, color: 'text-red-600',   bg: 'bg-red-50',     border: 'border-red-100'     },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-3 text-center`}>
            <div className={`text-lg font-black ${s.color}`}>{fmtK(s.value)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Add payment */}
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 py-3 rounded-2xl text-sm font-semibold transition-all">
          <Plus size={16} /> הוסף תשלום / חשבונית
        </button>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">סכום (₪) *</label>
              <input type="number" min={0} value={form.amount||''} onChange={e => setForm(p=>({...p,amount:Number(e.target.value)}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
            <div><label className="text-xs text-slate-500 mb-1 block">תאריך</label>
              <input type="date" value={form.date||''} onChange={e => setForm(p=>({...p,date:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">סוג</label>
              <select value={form.type||'retainer'} onChange={e => setForm(p=>({...p,type:e.target.value as PaymentType}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
                {(Object.keys(PAY_TYPE) as PaymentType[]).map(k => <option key={k} value={k}>{PAY_TYPE[k]}</option>)}
              </select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">סטטוס</label>
              <select value={form.status||'paid'} onChange={e => setForm(p=>({...p,status:e.target.value as PaymentRecord['status']}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
                {(Object.keys(PAY_STATUS) as PaymentRecord['status'][]).map(k => <option key={k} value={k}>{PAY_STATUS[k].label}</option>)}
              </select></div>
          </div>
          <div><label className="text-xs text-slate-500 mb-1 block">מס׳ חשבונית</label>
            <input value={form.invoiceNumber||''} onChange={e => setForm(p=>({...p,invoiceNumber:e.target.value}))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="INV-001" /></div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAdding(false)} className="px-4 py-2 text-xs font-bold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">ביטול</button>
            <button onClick={addPayment} disabled={!form.amount || !form.date} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 disabled:opacity-40">הוסף תשלום</button>
          </div>
        </div>
      )}

      {/* Payments list */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {payments.length === 0 && (
          <div className="text-center py-12 text-slate-300">
            <CreditCard size={32} className="mx-auto mb-3 opacity-50" />
            <p className="font-semibold">אין תשלומים עדיין</p>
          </div>
        )}
        {payments.map((p, i) => {
          const ps = PAY_STATUS[p.status];
          return (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < payments.length-1 ? 'border-b border-slate-100' : ''} hover:bg-slate-50 transition-colors`}>
              <button onClick={() => deletePayment(p.id)} className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-400 flex-shrink-0">
                <Trash2 size={11} />
              </button>
              <div className="flex-1 text-right">
                <div className="flex items-center justify-end gap-2">
                  {p.invoiceNumber && <span className="text-xs text-slate-400 font-mono">{p.invoiceNumber}</span>}
                  <span className="text-xs text-slate-400">{PAY_TYPE[p.type]}</span>
                  <span className="font-bold text-slate-800">{fmt(p.amount)}</span>
                </div>
                <span className="text-xs text-slate-400">{fmtD(p.date)}</span>
              </div>
              <button onClick={() => toggleStatus(p.id)}
                className={`text-xs font-bold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${ps.bg} ${ps.color}`}>
                {ps.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   CLIENT DETAIL (full page view)
───────────────────────────────────────────────────────────────────────────── */
function ClientDetail({ lead, account, onSave, onBack, onLeadClick, currentUser, team }: {
  lead: Lead; account: AccountData; onSave: (a: AccountData) => void;
  onBack: () => void; onLeadClick: (l: Lead) => void;
  currentUser: string; team: string[];
}) {
  const [tab, setTab] = useState<'overview' | 'solutions' | 'payments'>('overview');
  const score = calcHealth(lead, account);
  const hm    = healthMeta(score);

  const TABS = [
    { key: 'overview'  as const, label: 'סקירה',     icon: Activity    },
    { key: 'solutions' as const, label: 'פתרונות',   icon: Package     },
    { key: 'payments'  as const, label: 'תשלומים',   icon: CreditCard  },
  ];

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button onClick={() => onLeadClick(lead)}
          className="flex items-center gap-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors">
          <Zap size={12} className="text-indigo-500" /> פתח כרטיס ליד
        </button>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">
          חזרה לרשימה <ArrowRight size={16} />
        </button>
      </div>

      {/* Header card */}
      <div className={`bg-white rounded-2xl border-2 ${hm.ring} shadow-sm p-5`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-xl text-sm font-black ${hm.lightBg} ${hm.text}`}>
              {score}% {hm.label}
            </div>
            <div className="flex gap-1">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                  <Phone size={14} />
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                  <Mail size={14} />
                </a>
              )}
              {lead.phone && (
                <a href={`https://wa.me/${lead.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                  className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center text-emerald-500 transition-colors">
                  <MessageCircle size={14} />
                </a>
              )}
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-black text-slate-900">{lead.company}</h2>
            <p className="text-slate-500 text-sm">{lead.contactName} · {lead.assignedTo}</p>
          </div>
        </div>
        <div className="mt-4 h-2 bg-slate-100 rounded-full">
          <div className={`h-2 rounded-full ${hm.bg} transition-all duration-700`} style={{ width: `${score}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <Icon size={14} />{t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview'  && <OverviewTab  lead={lead} account={account} onSave={onSave} currentUser={currentUser} />}
      {tab === 'solutions' && <SolutionsTab account={account} onSave={onSave} team={team} />}
      {tab === 'payments'  && <PaymentsTab  account={account} onSave={onSave} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   CLIENT CARD (grid view)
───────────────────────────────────────────────────────────────────────────── */
function ClientCard({ lead, account, onClick }: {
  lead: Lead; account: AccountData | undefined; onClick: () => void;
}) {
  const score    = calcHealth(lead, account);
  const hm       = healthMeta(score);
  const solutions = account?.solutions ?? [];
  const approved  = solutions.filter(s => s.status === 'approved').length;
  const solPct    = solutions.length > 0 ? Math.round((approved/solutions.length)*100) : 0;
  const overdue   = account?.payments?.some(p => p.status === 'overdue');
  const midnight  = new Date(); midnight.setHours(0,0,0,0);
  const overdueT  = lead.tasks.filter(t => { if(t.completed)return false; try{return new Date(t.date+'T00:00:00')<midnight;}catch{return false;} });
  const daysLeft  = account?.contractEnd ? daysTo(account.contractEnd) : null;

  return (
    <button onClick={onClick} className={`w-full text-right bg-white rounded-2xl border-2 ${hm.ring} shadow-sm hover:shadow-lg transition-all p-5 group`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${hm.lightBg} ${hm.text} flex-shrink-0`}>{score}%</span>
        <div className="min-w-0">
          <h3 className="font-black text-slate-900 truncate">{lead.company}</h3>
          <p className="text-xs text-slate-500 truncate">{lead.contactName}</p>
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full mb-3">
        <div className={`h-1.5 rounded-full ${hm.bg} transition-all duration-700`} style={{ width: `${score}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div className="bg-slate-50 rounded-xl p-2 text-right">
          <p className="text-slate-400 mb-0.5">ריטיינר</p>
          <p className="font-bold text-slate-800">{account?.monthlyRetainer ? fmtK(account.monthlyRetainer) : '—'}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2 text-right">
          <p className="text-slate-400 mb-0.5">חוזה</p>
          <p className={`font-bold ${daysLeft !== null && daysLeft < 30 ? 'text-amber-600' : 'text-slate-800'}`}>
            {daysLeft !== null ? (daysLeft < 0 ? 'פג!' : `${daysLeft}י`) : '—'}
          </p>
        </div>
      </div>
      {solutions.length > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-slate-400 mb-1"><span>{approved}/{solutions.length}</span><span>פתרונות</span></div>
          <div className="h-1.5 bg-slate-100 rounded-full"><div className="h-1.5 bg-indigo-400 rounded-full" style={{width:`${solPct}%`}} /></div>
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {overdueT.length > 0 && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">⚠ {overdueT.length} משימות</span>}
        {overdue && <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">💳 תשלום</span>}
        {daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">📅 חידוש</span>}
        {account?.upsellNote && <span className="text-xs bg-violet-100 text-violet-700 font-semibold px-2 py-0.5 rounded-full">🚀 אפסל</span>}
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
interface DealsProps {
  leads: Lead[];
  team?: { name: string }[];
  currentUser: string;
  onLeadClick: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type FilterKey = 'all' | 'healthy' | 'warning' | 'critical' | 'renewal';

export default function Deals({ leads, team = [], currentUser, onLeadClick, onToast }: DealsProps) {
  const [accounts, setAccounts]       = useState<AccountData[]>([]);
  const [filter,   setFilter]         = useState<FilterKey>('all');
  const [selected, setSelected]       = useState<Lead | null>(null);

  const activeClients = useMemo(() => leads.filter(l => l.status === 'לקוח פעיל'), [leads]);
  const teamNames = useMemo(() => team.map(m => m.name), [team]);
  const getAcc = (id: string) => accounts.find(a => a.leadId === id);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'accounts'), snap => {
      setAccounts(snap.docs.map(d => d.data() as AccountData));
    });
    return () => unsub();
  }, []);

  // When navigating to detail, ensure account exists
  function openClient(lead: Lead) {
    if (!getAcc(lead.id)) {
      const blank = blankAccount(lead.id, lead.budget ?? 0);
      setAccounts(p => [...p, blank]);
    }
    setSelected(lead);
  }

  async function saveAccount(data: AccountData) {
    try {
      const clean = Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)) as AccountData;
      await setDoc(doc(db, 'accounts', data.leadId), clean);
      setAccounts(p => p.map(a => a.leadId === data.leadId ? data : a));
      onToast?.('נשמר ✓', 'success');
    } catch { onToast?.('שגיאה בשמירה', 'error'); }
  }

  // KPIs
  const mrr         = activeClients.reduce((s,l) => s + (getAcc(l.id)?.monthlyRetainer ?? l.budget ?? 0), 0);
  const attention   = activeClients.filter(l => calcHealth(l, getAcc(l.id)) < 60).length;
  const renewalSoon = activeClients.filter(l => { const a=getAcc(l.id); if(!a?.contractEnd)return false; const d=daysTo(a.contractEnd); return d>=0&&d<=30; }).length;
  const totalPaid   = accounts.reduce((s,a) => s + a.payments.filter(p=>p.status==='paid').reduce((ss,p)=>ss+p.amount,0), 0);

  // Filter
  const filtered = useMemo(() => activeClients.filter(l => {
    const a=getAcc(l.id); const sc=calcHealth(l,a);
    switch(filter) {
      case 'healthy':  return sc>=70;
      case 'warning':  return sc>=40&&sc<70;
      case 'critical': return sc<40;
      case 'renewal':  { const d=a?.contractEnd?daysTo(a.contractEnd):null; return d!==null&&d>=0&&d<=30; }
      default: return true;
    }
  }).sort((a,b) => calcHealth(a,getAcc(a.id)) - calcHealth(b,getAcc(b.id))), [activeClients, accounts, filter]);

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',      label: 'הכל',          count: activeClients.length },
    { key: 'critical', label: '🔴 קריטי',     count: activeClients.filter(l=>calcHealth(l,getAcc(l.id))<40).length },
    { key: 'warning',  label: '🟡 דורש טיפול',count: activeClients.filter(l=>{const s=calcHealth(l,getAcc(l.id));return s>=40&&s<70;}).length },
    { key: 'healthy',  label: '🟢 תקין',      count: activeClients.filter(l=>calcHealth(l,getAcc(l.id))>=70).length },
    { key: 'renewal',  label: '📅 חידוש',     count: renewalSoon },
  ];

  // Detail view
  if (selected) {
    const acc = getAcc(selected.id) ?? blankAccount(selected.id, selected.budget ?? 0);
    return (
      <ClientDetail
        lead={selected} account={acc}
        onSave={saveAccount}
        onBack={() => setSelected(null)}
        onLeadClick={onLeadClick}
        currentUser={currentUser}
        team={teamNames}
      />
    );
  }

  // Grid view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <div>
          <h1 className="text-xl font-black text-slate-900">ניהול לקוחות פעילים</h1>
          <p className="text-slate-500 text-sm">{activeClients.length} לקוחות פעילים</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'לקוחות פעילים', value: activeClients.length,       icon: <Users size={18} className="text-indigo-600" />,                            bg: 'bg-indigo-50', sub: 'סה״כ' },
          { label: 'MRR',            value: fmtK(mrr),                  icon: <DollarSign size={18} className="text-emerald-600" />,                      bg: 'bg-emerald-50', sub: 'הכנסה חודשית' },
          { label: 'הכנסה כוללת',   value: fmtK(totalPaid),            icon: <TrendingUp size={18} className="text-blue-600" />,                         bg: 'bg-blue-50', sub: 'כל הזמנים' },
          { label: 'דורשים טיפול',  value: attention,                   icon: <AlertTriangle size={18} className={attention>0?'text-amber-500':'text-slate-400'}/>, bg: attention>0?'bg-amber-50':'bg-slate-50', sub: 'health < 60%' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className={`w-10 h-10 ${k.bg} rounded-xl flex items-center justify-center mb-3`}>{k.icon}</div>
            <div className="text-2xl font-black text-slate-900 mb-0.5">{k.value}</div>
            <div className="text-sm font-semibold text-slate-700">{k.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${filter===f.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            {f.label}
            {f.count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${filter===f.key?'bg-white/20 text-white':'bg-slate-100 text-slate-500'}`}>{f.count}</span>}
          </button>
        ))}
      </div>

      {/* Grid */}
      {activeClients.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h3 className="font-bold text-slate-700 text-lg mb-2">אין לקוחות פעילים</h3>
          <p className="text-slate-400 text-sm">שנה סטטוס ליד ל״לקוח פעיל״ כדי שיופיע כאן</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400">אין לקוחות בקטגוריה זו</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(lead => (
            <ClientCard key={lead.id} lead={lead} account={getAcc(lead.id)} onClick={() => openClient(lead)} />
          ))}
        </div>
      )}
    </div>
  );
}
