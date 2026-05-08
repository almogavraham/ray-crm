import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, DollarSign, Calendar,
  TrendingUp, Users, RefreshCw, X, ChevronLeft, Plus,
  Zap, FileText, Phone, Mail,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, onSnapshot } from 'firebase/firestore';
import type { Lead, AccountData, PaymentRecord } from '../types';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface DealsProps {
  leads: Lead[];
  currentUser: string;
  onLeadClick: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type FilterKey = 'all' | 'healthy' | 'warning' | 'critical' | 'renewal';

/* ─── Health score ────────────────────────────────────────────────────────── */
function calcHealth(lead: Lead, acc: AccountData | undefined): number {
  let score = 100;
  const now = new Date();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

  // Recency of contact (notes)
  if (lead.notes.length === 0) {
    score -= 30;
  } else {
    const sorted = [...lead.notes].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const last = new Date(sorted[0].timestamp);
    const days = (now.getTime() - last.getTime()) / 86_400_000;
    if (days > 30) score -= 35;
    else if (days > 14) score -= 20;
    else if (days > 7)  score -= 10;
  }

  // Overdue tasks
  const overdue = lead.tasks.filter(t => {
    if (t.completed) return false;
    try { return new Date(t.date + 'T00:00:00') < todayMidnight; } catch { return false; }
  });
  score -= Math.min(overdue.length * 15, 30);

  // Contract expiry
  if (acc?.contractEnd) {
    const end = new Date(acc.contractEnd);
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
    if (daysLeft < 0)  score -= 30;
    else if (daysLeft < 14) score -= 20;
    else if (daysLeft < 30) score -= 10;
  }

  // Overdue payment
  if (acc?.payments?.some(p => p.status === 'overdue')) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function healthLabel(score: number): { label: string; color: string; bg: string; ring: string } {
  if (score >= 70) return { label: 'תקין',        color: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200' };
  if (score >= 40) return { label: 'דורש טיפול',  color: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200' };
  return               { label: 'קריטי',         color: 'text-red-600',     bg: 'bg-red-50',     ring: 'ring-red-200' };
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}
function fmtDate(d: string) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function fmtMonth(m: string) {
  try {
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  } catch { return m; }
}
function daysSinceNote(lead: Lead): number | null {
  if (!lead.notes.length) return null;
  const sorted = [...lead.notes].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return Math.floor((Date.now() - new Date(sorted[0].timestamp).getTime()) / 86_400_000);
}

/* ─── Account Modal ──────────────────────────────────────────────────────── */
function AccountModal({
  lead, account, onSave, onClose,
}: {
  lead: Lead;
  account: AccountData | undefined;
  onSave: (data: AccountData) => void;
  onClose: () => void;
}) {
  const blank: AccountData = {
    leadId: lead.id,
    contractStart: '',
    contractEnd: '',
    monthlyRetainer: lead.budget ?? 0,
    payments: [],
    upsellNote: '',
    updatedAt: new Date().toISOString(),
  };
  const [form, setForm] = useState<AccountData>(account ?? blank);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AccountData>(k: K, v: AccountData[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  // Current month payment helper
  const cm = currentMonth();
  const cmPayment = form.payments.find(p => p.month === cm);

  function setCurrentPaymentStatus(status: PaymentRecord['status']) {
    setForm(prev => {
      const filtered = prev.payments.filter(p => p.month !== cm);
      const rec: PaymentRecord = {
        id: Date.now().toString(),
        month: cm,
        amount: prev.monthlyRetainer,
        status,
        ...(status === 'paid' ? { paidAt: new Date().toISOString() } : {}),
      };
      return { ...prev, payments: [...filtered, rec] };
    });
  }

  async function handleSave() {
    setSaving(true);
    const data: AccountData = { ...form, updatedAt: new Date().toISOString() };
    onSave(data);
    setSaving(false);
    onClose();
  }

  const pastPayments = form.payments
    .filter(p => p.month !== cm)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 4);

  const payBtnCls = (s: PaymentRecord['status']) =>
    `flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${
      cmPayment?.status === s
        ? s === 'paid'    ? 'bg-emerald-500 text-white border-emerald-500'
        : s === 'pending' ? 'bg-amber-500 text-white border-amber-500'
        :                   'bg-red-500 text-white border-red-500'
        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <X size={15} className="text-slate-500" />
          </button>
          <div className="text-right">
            <h2 className="font-bold text-slate-900">{lead.company}</h2>
            <p className="text-xs text-slate-500">{lead.contactName}</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Contract dates */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">חוזה</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">תחילת חוזה</label>
                <input
                  type="date"
                  value={form.contractStart}
                  onChange={e => set('contractStart', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">סיום חוזה</label>
                <input
                  type="date"
                  value={form.contractEnd}
                  onChange={e => set('contractEnd', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            </div>
          </div>

          {/* Retainer */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">ריטיינר חודשי</p>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₪</span>
              <input
                type="number"
                min={0}
                value={form.monthlyRetainer || ''}
                onChange={e => set('monthlyRetainer', Number(e.target.value))}
                className="w-full border border-slate-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="0"
              />
            </div>
          </div>

          {/* Current month payment */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              תשלום — {fmtMonth(cm)}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPaymentStatus('paid')}    className={payBtnCls('paid')}>✓ שולם</button>
              <button onClick={() => setCurrentPaymentStatus('pending')}  className={payBtnCls('pending')}>⏳ ממתין</button>
              <button onClick={() => setCurrentPaymentStatus('overdue')}  className={payBtnCls('overdue')}>⚠ באיחור</button>
            </div>
          </div>

          {/* Payment history */}
          {pastPayments.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">היסטוריית תשלומים</p>
              <div className="space-y-1.5">
                {pastPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                    <div className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      p.status === 'paid'    ? 'bg-emerald-100 text-emerald-700' :
                      p.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                              'bg-red-100 text-red-600'
                    }`}>
                      {p.status === 'paid' ? 'שולם' : p.status === 'pending' ? 'ממתין' : 'באיחור'}
                    </div>
                    <span className="text-sm text-slate-700">{fmtMonth(p.month)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upsell note */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">הזדמנות אפסל 🚀</p>
            <textarea
              value={form.upsellNote}
              onChange={e => set('upsellNote', e.target.value)}
              rows={3}
              placeholder="פוטנציאל להרחבת שירות, שדרוג חבילה..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors"
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Client Card ─────────────────────────────────────────────────────────── */
function ClientCard({
  lead, account, onEdit, onOpen,
}: {
  lead: Lead;
  account: AccountData | undefined;
  onEdit: () => void;
  onOpen: () => void;
}) {
  const score     = calcHealth(lead, account);
  const hl        = healthLabel(score);
  const daysLeft  = account?.contractEnd ? daysUntil(account.contractEnd) : null;
  const daySince  = daysSinceNote(lead);
  const openTasks = lead.tasks.filter(t => !t.completed);
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const overdueTasks  = openTasks.filter(t => {
    try { return new Date(t.date + 'T00:00:00') < todayMidnight; } catch { return false; }
  });

  const totalSols     = lead.solutions.length;
  const deliveredSols = lead.solutions.filter(s => s.delivered).length;
  const inProgressSols = lead.solutions.filter(s => s.inProgress && !s.delivered).length;
  const solPct        = totalSols > 0 ? Math.round((deliveredSols / totalSols) * 100) : 0;

  const cm      = currentMonth();
  const cmPay   = account?.payments?.find(p => p.month === cm);

  const contractEndUrgency = daysLeft !== null
    ? daysLeft < 0    ? 'text-red-600 font-bold'
    : daysLeft < 14   ? 'text-red-500 font-semibold'
    : daysLeft < 30   ? 'text-amber-600 font-semibold'
    : 'text-slate-600'
    : 'text-slate-400';

  return (
    <div className={`bg-white rounded-2xl border-2 shadow-sm hover:shadow-md transition-all ${hl.ring} ring-2`}>
      {/* Card header */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Health pill */}
            <span className={`text-xs font-bold px-2 py-1 rounded-full ${hl.bg} ${hl.color}`}>
              {score}% {hl.label}
            </span>
          </div>
          <div className="text-right min-w-0">
            <h3 className="font-bold text-slate-900 text-sm leading-tight truncate">{lead.company}</h3>
            <p className="text-xs text-slate-500 truncate">{lead.contactName}</p>
          </div>
        </div>

        {/* Health bar */}
        <div className="mt-3 h-1.5 bg-slate-100 rounded-full">
          <div
            className={`h-1.5 rounded-full transition-all duration-700 ${
              score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">

        {/* Solutions progress */}
        {totalSols > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-slate-700">{deliveredSols}/{totalSols} הושלמו</span>
              <span className="text-slate-500">התקדמות פרויקט</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full">
              <div
                className="h-2 bg-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${solPct}%` }}
              />
            </div>
            {inProgressSols > 0 && (
              <p className="text-xs text-indigo-500 mt-1">{inProgressSols} בביצוע</p>
            )}
          </div>
        )}

        {/* Contract info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 rounded-xl p-2.5 text-right">
            <p className="text-xs text-slate-400 mb-0.5">ריטיינר</p>
            <p className="text-sm font-bold text-slate-800">
              {account?.monthlyRetainer ? `₪${account.monthlyRetainer.toLocaleString()}` : '—'}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-2.5 text-right">
            <p className="text-xs text-slate-400 mb-0.5">סיום חוזה</p>
            <p className={`text-sm ${contractEndUrgency}`}>
              {daysLeft !== null
                ? daysLeft < 0  ? `פג לפני ${Math.abs(daysLeft)}י`
                : daysLeft === 0 ? 'היום!'
                : `${daysLeft} ימים`
                : '—'}
            </p>
          </div>
        </div>

        {/* Payment status */}
        <div className="flex items-center justify-between">
          <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            cmPay?.status === 'paid'    ? 'bg-emerald-100 text-emerald-700' :
            cmPay?.status === 'overdue' ? 'bg-red-100 text-red-600' :
            cmPay?.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                          'bg-slate-100 text-slate-400'
          }`}>
            {cmPay?.status === 'paid'    ? '✓ שולם החודש' :
             cmPay?.status === 'overdue' ? '⚠ תשלום באיחור' :
             cmPay?.status === 'pending' ? '⏳ ממתין לתשלום' :
                                           'תשלום לא עודכן'}
          </div>
          {daySince !== null && (
            <span className={`text-xs ${daySince > 14 ? 'text-amber-500 font-semibold' : 'text-slate-400'}`}>
              {daySince === 0 ? 'עדכון היום' : `לפני ${daySince}י`}
            </span>
          )}
        </div>

        {/* Upsell note */}
        {account?.upsellNote && (
          <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
            <p className="text-xs font-bold text-violet-700 mb-0.5">🚀 הזדמנות אפסל</p>
            <p className="text-xs text-violet-600 leading-relaxed line-clamp-2">{account.upsellNote}</p>
          </div>
        )}

        {/* Alerts */}
        <div className="flex gap-2 flex-wrap">
          {overdueTasks.length > 0 && (
            <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">
              ⚠ {overdueTasks.length} משימות באיחור
            </span>
          )}
          {openTasks.length > 0 && overdueTasks.length === 0 && (
            <span className="text-xs bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full">
              {openTasks.length} משימות פתוחות
            </span>
          )}
          {daysLeft !== null && daysLeft <= 30 && daysLeft >= 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
              📅 חידוש בעוד {daysLeft}י
            </span>
          )}
          {daysLeft !== null && daysLeft < 0 && (
            <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">
              🚨 חוזה פג!
            </span>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 rounded-xl transition-colors"
        >
          <FileText size={12} />
          עדכן חוזה
        </button>
        <button
          onClick={onOpen}
          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 rounded-xl transition-colors"
        >
          <ChevronLeft size={12} />
          פתח ליד
        </button>
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function Deals({ leads, currentUser: _currentUser, onLeadClick, onToast }: DealsProps) {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [filter,   setFilter]   = useState<FilterKey>('all');
  const [editLead, setEditLead] = useState<Lead | null>(null);

  // Only active clients
  const activeClients = useMemo(() => leads.filter(l => l.status === 'לקוח פעיל'), [leads]);

  // Firestore — accounts collection
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'accounts'), snap => {
      setAccounts(snap.docs.map(d => d.data() as AccountData));
    });
    return () => unsub();
  }, []);

  const getAccount = (leadId: string) => accounts.find(a => a.leadId === leadId);

  async function saveAccount(data: AccountData) {
    try {
      const clean = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      ) as AccountData;
      await setDoc(doc(db, 'accounts', data.leadId), clean);
      onToast?.('חוזה עודכן ✓', 'success');
    } catch {
      onToast?.('שגיאה בשמירה', 'error');
    }
  }

  // KPIs
  const mrr = useMemo(() =>
    activeClients.reduce((s, l) => s + (getAccount(l.id)?.monthlyRetainer ?? l.budget ?? 0), 0),
  [activeClients, accounts]);

  const needsAttention = useMemo(() =>
    activeClients.filter(l => calcHealth(l, getAccount(l.id)) < 60).length,
  [activeClients, accounts]);

  const renewalSoon = useMemo(() =>
    activeClients.filter(l => {
      const acc = getAccount(l.id);
      if (!acc?.contractEnd) return false;
      const d = daysUntil(acc.contractEnd);
      return d >= 0 && d <= 30;
    }).length,
  [activeClients, accounts]);

  // Filtering
  const filtered = useMemo(() => {
    return activeClients.filter(l => {
      const acc   = getAccount(l.id);
      const score = calcHealth(l, acc);
      const d     = acc?.contractEnd ? daysUntil(acc.contractEnd) : null;
      switch (filter) {
        case 'healthy':  return score >= 70;
        case 'warning':  return score >= 40 && score < 70;
        case 'critical': return score < 40;
        case 'renewal':  return d !== null && d >= 0 && d <= 30;
        default:         return true;
      }
    });
  }, [activeClients, accounts, filter]);

  // Sort: critical first, then by health ascending
  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      calcHealth(a, getAccount(a.id)) - calcHealth(b, getAccount(b.id))
    ),
  [filtered, accounts]);

  const FILTERS: { key: FilterKey; label: string; count?: number }[] = [
    { key: 'all',      label: 'כל הלקוחות', count: activeClients.length },
    { key: 'critical', label: '🔴 קריטי',    count: activeClients.filter(l => calcHealth(l, getAccount(l.id)) < 40).length },
    { key: 'warning',  label: '🟡 טיפול',    count: activeClients.filter(l => { const s = calcHealth(l, getAccount(l.id)); return s >= 40 && s < 70; }).length },
    { key: 'healthy',  label: '🟢 תקין',     count: activeClients.filter(l => calcHealth(l, getAccount(l.id)) >= 70).length },
    { key: 'renewal',  label: '📅 חידוש',    count: renewalSoon },
  ];

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div />
        <div>
          <h1 className="text-xl font-black text-slate-900">ניהול לקוחות פעילים</h1>
          <p className="text-slate-500 text-sm">{activeClients.length} לקוחות פעילים</p>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'לקוחות פעילים',
            value: activeClients.length,
            sub: 'סה״כ',
            icon: <Users size={18} className="text-indigo-600" />,
            bg: 'bg-indigo-50',
          },
          {
            label: 'הכנסה חודשית',
            value: `₪${(mrr / 1000).toFixed(0)}K`,
            sub: 'MRR',
            icon: <DollarSign size={18} className="text-emerald-600" />,
            bg: 'bg-emerald-50',
          },
          {
            label: 'דורשים טיפול',
            value: needsAttention,
            sub: 'health < 60%',
            icon: <AlertTriangle size={18} className={needsAttention > 0 ? 'text-amber-500' : 'text-slate-400'} />,
            bg: needsAttention > 0 ? 'bg-amber-50' : 'bg-slate-50',
          },
          {
            label: 'חידושים קרובים',
            value: renewalSoon,
            sub: '30 ימים הבאים',
            icon: <RefreshCw size={18} className={renewalSoon > 0 ? 'text-violet-600' : 'text-slate-400'} />,
            bg: renewalSoon > 0 ? 'bg-violet-50' : 'bg-slate-50',
          },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-xl ${k.bg}`}>{k.icon}</div>
            </div>
            <div className="text-2xl font-black text-slate-900 mb-0.5">{k.value}</div>
            <div className="text-sm font-semibold text-slate-700">{k.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              filter === f.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {f.label}
            {f.count !== undefined && f.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                filter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>{f.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Empty State ─────────────────────────────────────────────────────── */}
      {activeClients.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h3 className="font-bold text-slate-700 text-lg mb-2">אין לקוחות פעילים עדיין</h3>
          <p className="text-slate-400 text-sm max-w-xs mx-auto">
            כשליד יועבר לסטטוס ״לקוח פעיל״ בדף הלידים, הוא יופיע כאן
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400">אין לקוחות בקטגוריה זו</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(lead => (
            <ClientCard
              key={lead.id}
              lead={lead}
              account={getAccount(lead.id)}
              onEdit={() => setEditLead(lead)}
              onOpen={() => onLeadClick(lead)}
            />
          ))}
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      {activeClients.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-slate-500 mb-3 text-right">💡 חישוב ציון בריאות</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-500 text-right">
            <div className="flex items-center justify-end gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" />אין תקשורת 14+ ימים: -20</div>
            <div className="flex items-center justify-end gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />משימות באיחור: -15 כ"א</div>
            <div className="flex items-center justify-end gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" />חוזה פג/עומד לפוג: -20</div>
            <div className="flex items-center justify-end gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400" />תשלום באיחור: -20</div>
          </div>
        </div>
      )}

      {/* ── Account Modal ──────────────────────────────────────────────────── */}
      {editLead && (
        <AccountModal
          lead={editLead}
          account={getAccount(editLead.id)}
          onSave={saveAccount}
          onClose={() => setEditLead(null)}
        />
      )}
    </div>
  );
}
