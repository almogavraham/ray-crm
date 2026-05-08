import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Briefcase, TrendingUp, Trophy, X, ChevronDown,
  Trash2, Pencil, FileText, CheckCircle2, XCircle,
  DollarSign, Calendar, User, Percent, MoreVertical,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import type { Deal, Proposal, ProposalItem, DealStage, Lead, TeamMember } from '../types';

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STAGES: { id: DealStage; label: string; color: string; bg: string; icon: React.ElementType }[] = [
  { id: 'new',         label: 'חדש',           color: 'text-indigo-700', bg: 'bg-indigo-100', icon: Plus },
  { id: 'proposal',    label: 'הצעה נשלחה',    color: 'text-blue-700',   bg: 'bg-blue-100',   icon: FileText },
  { id: 'negotiation', label: 'משא ומתן',      color: 'text-amber-700',  bg: 'bg-amber-100',  icon: TrendingUp },
  { id: 'won',         label: 'נסגר ✓',        color: 'text-emerald-700',bg: 'bg-emerald-100',icon: Trophy },
  { id: 'lost',        label: 'אבד',           color: 'text-red-600',    bg: 'bg-red-100',    icon: XCircle },
];

const STAGE_PROB: Record<DealStage, number> = {
  new: 20, proposal: 40, negotiation: 70, won: 100, lost: 0,
};

const fmt  = (n: number) => `₪${n.toLocaleString('he-IL')}`;
const fmtK = (n: number) => n >= 1000 ? `₪${(n/1000).toFixed(0)}K` : fmt(n);

/* ─── Proposal Builder ───────────────────────────────────────────────────── */
function ProposalBuilder({ deal, onSave, onClose }: {
  deal: Deal;
  onSave: (proposal: Proposal) => void;
  onClose: () => void;
}) {
  const [title,       setTitle]       = useState('הצעת מחיר - ' + deal.company);
  const [clientEmail, setClientEmail] = useState('');
  const [validUntil,  setValidUntil]  = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ProposalItem[]>([
    { id: '1', name: '', description: '', quantity: 1, unitPrice: 0 },
  ]);
  const [discount, setDiscount] = useState(0);

  const addItem = () => setItems(p => [...p, { id: Date.now().toString(), name: '', description: '', quantity: 1, unitPrice: 0 }]);
  const removeItem = (id: string) => setItems(p => p.filter(i => i.id !== id));
  const updateItem = (id: string, k: keyof ProposalItem, v: string | number) =>
    setItems(p => p.map(i => i.id === id ? { ...i, [k]: v } : i));

  const subtotal  = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discountAmt = subtotal * (discount / 100);
  const total     = subtotal - discountAmt;

  const inp = 'border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-slate-400 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-black text-lg text-slate-800">בניית הצעת מחיר</h2>
            <p className="text-xs text-slate-400">{deal.company} · {deal.clientName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><X size={14} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Title + Email + Valid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs font-semibold text-slate-600 block mb-1">כותרת הצעה</label>
              <input className={inp + ' w-full'} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">מייל לקוח</label>
              <input className={inp + ' w-full'} type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">בתוקף עד</label>
              <input className={inp + ' w-full'} type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">פריטים</label>
              <button onClick={addItem} className="text-xs text-indigo-600 font-semibold hover:text-indigo-700 flex items-center gap-1"><Plus size={12} />הוסף פריט</button>
            </div>
            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1">
                <div className="col-span-4">שירות / מוצר</div>
                <div className="col-span-3">תיאור</div>
                <div className="col-span-2 text-center">כמות</div>
                <div className="col-span-2 text-center">מחיר יח׳</div>
                <div className="col-span-1" />
              </div>
              {items.map(item => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-slate-50 rounded-xl p-2">
                  <input className={inp + ' col-span-4 bg-white text-sm'} value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} placeholder="שם השירות" />
                  <input className={inp + ' col-span-3 bg-white text-xs'} value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} placeholder="תיאור" />
                  <input className={inp + ' col-span-2 bg-white text-center text-sm'} type="number" min={1} value={item.quantity} onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))} />
                  <input className={inp + ' col-span-2 bg-white text-center text-sm'} type="number" min={0} value={item.unitPrice || ''} onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))} placeholder="0" />
                  <button onClick={() => removeItem(item.id)} className="col-span-1 w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center mx-auto"><Trash2 size={11} className="text-red-500" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>סכום ביניים</span><span className="font-semibold">{fmt(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>הנחה (%)</span>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={100} value={discount} onChange={e => setDiscount(Number(e.target.value))}
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-slate-400" />
                <span className="text-slate-400 text-xs">={fmt(discountAmt)}</span>
              </div>
            </div>
            <div className="flex justify-between font-black text-base text-slate-800 border-t border-slate-200 pt-2">
              <span>סה״כ לתשלום</span><span className="text-indigo-700">{fmt(total)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">הערות לצד הלקוח</label>
            <textarea className={inp + ' w-full resize-none'} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="תנאי תשלום, הערות כלליות..." />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={() => {
              const proposal: Proposal = {
                id: Date.now().toString(),
                title,
                clientName: deal.clientName,
                ...(clientEmail ? { clientEmail } : {}),
                items: items.filter(i => i.name.trim()),
                discount,
                validUntil,
                ...(notes.trim() ? { notes } : {}),
                status: 'draft',
                createdAt: new Date().toISOString(),
              };
              onSave(proposal);
            }}
            className="flex-1 bg-black hover:bg-neutral-800 text-white py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            שמור הצעה (₪{fmt(total).replace('₪','')} )
          </button>
          <button onClick={onClose} className="px-4 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Deal Modal ─────────────────────────────────────────────────────────── */
function DealModal({ initial, leads, team, currentUser, onSave, onClose }: {
  initial?: Deal;
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  onSave: (d: Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'proposals'>) => void;
  onClose: () => void;
}) {
  const [company,    setCompany]    = useState(initial?.company ?? '');
  const [clientName, setClientName] = useState(initial?.clientName ?? '');
  const [stage,      setStage]      = useState<DealStage>(initial?.stage ?? 'new');
  const [value,      setValue]      = useState(initial?.value ?? 0);
  const [prob,       setProb]       = useState(initial?.probability ?? STAGE_PROB[initial?.stage ?? 'new']);
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo ?? currentUser);
  const [closeDate,  setCloseDate]  = useState(initial?.expectedCloseDate ?? '');
  const [notes,      setNotes]      = useState(initial?.notes ?? '');

  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-slate-400 transition-colors';
  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-black text-lg text-slate-800">{initial ? 'עריכת עסקה' : 'עסקה חדשה'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><X size={14} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>שם חברה</label>
              <input className={inp} value={company} onChange={e => setCompany(e.target.value)} placeholder="שם החברה" />
            </div>
            <div className="col-span-2">
              <label className={lbl}>שם איש קשר</label>
              <input className={inp} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="שם הלקוח" />
            </div>
          </div>
          {/* Stage */}
          <div>
            <label className={lbl}>שלב</label>
            <div className="grid grid-cols-5 gap-1.5">
              {STAGES.map(s => (
                <button key={s.id} onClick={() => { setStage(s.id); setProb(STAGE_PROB[s.id]); }}
                  className={`py-2 rounded-xl border text-[10px] font-bold transition-all ${stage === s.id ? `${s.bg} ${s.color} border-current` : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>שווי עסקה (₪)</label>
              <input className={inp} type="number" min={0} value={value || ''} onChange={e => setValue(Number(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label className={lbl}>הסתברות (%)</label>
              <input className={inp} type="number" min={0} max={100} value={prob} onChange={e => setProb(Number(e.target.value))} />
            </div>
            <div>
              <label className={lbl}>מוקצה ל</label>
              <div className="relative">
                <select className={inp + ' appearance-none'} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                  <option value={currentUser}>{currentUser}</option>
                  {team.filter(m => m.name !== currentUser).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className={lbl}>תאריך סגירה משוער</label>
              <input className={inp} type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={lbl}>הערות</label>
            <textarea className={inp + ' resize-none'} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="פרטים נוספים..." />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={() => { if (company.trim()) onSave({ company, clientName, stage, value, probability: prob, assignedTo, expectedCloseDate: closeDate, ...(notes.trim() ? { notes } : {}) }); }}
            disabled={!company.trim()}
            className="flex-1 bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-bold transition-colors"
          >
            {initial ? 'שמור שינויים' : 'צור עסקה'}
          </button>
          <button onClick={onClose} className="px-4 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Deal Card ──────────────────────────────────────────────────────────── */
function DealCard({ deal, onEdit, onDelete, onProposal, onStageChange }: {
  deal: Deal;
  onEdit: () => void;
  onDelete: () => void;
  onProposal: () => void;
  onStageChange: (s: DealStage) => void;
}) {
  const [menu, setMenu] = useState(false);
  const stage = STAGES.find(s => s.id === deal.stage)!;
  const expectedRevenue = deal.value * (deal.probability / 100);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 text-sm truncate">{deal.company}</p>
          <p className="text-xs text-slate-500 truncate">{deal.clientName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 mr-2">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${stage.bg} ${stage.color}`}>{stage.label}</span>
          <div className="relative">
            <button onClick={() => setMenu(p => !p)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center">
              <MoreVertical size={13} className="text-slate-400" />
            </button>
            {menu && (
              <div className="absolute left-0 top-8 bg-white rounded-xl border border-slate-200 shadow-lg z-10 py-1 w-36" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { onEdit(); setMenu(false); }} className="w-full text-right px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Pencil size={11} />ערוך</button>
                <button onClick={() => { onProposal(); setMenu(false); }} className="w-full text-right px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"><FileText size={11} />בנה הצעה</button>
                <button onClick={() => { onDelete(); setMenu(false); }} className="w-full text-right px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2"><Trash2 size={11} />מחק</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Value + probability */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-slate-50 rounded-xl p-2.5">
          <p className="text-[10px] text-slate-400 flex items-center gap-1"><DollarSign size={9} />שווי עסקה</p>
          <p className="text-sm font-black text-slate-800">{fmtK(deal.value)}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-2.5">
          <p className="text-[10px] text-slate-400 flex items-center gap-1"><Percent size={9} />הסתברות</p>
          <p className="text-sm font-black text-slate-800">{deal.probability}%</p>
        </div>
      </div>

      {/* Probability bar */}
      <div className="h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full" style={{ width: `${deal.probability}%` }} />
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center gap-1"><User size={9} />{deal.assignedTo.split(' ')[0]}</div>
        {deal.expectedCloseDate && <div className="flex items-center gap-1"><Calendar size={9} />{new Date(deal.expectedCloseDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}</div>}
        <div className="font-semibold text-emerald-600">{fmtK(expectedRevenue)}</div>
      </div>

      {/* Proposals count */}
      {deal.proposals.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5">
          <FileText size={11} className="text-indigo-500" />
          <span className="text-[10px] text-slate-500">{deal.proposals.length} הצעות מחיר</span>
          <span className={`mr-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${deal.proposals[0].status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : deal.proposals[0].status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {deal.proposals[0].status === 'draft' ? 'טיוטה' : deal.proposals[0].status === 'sent' ? 'נשלחה' : deal.proposals[0].status === 'accepted' ? 'אושרה' : 'נדחתה'}
          </span>
        </div>
      )}

      {/* Stage change */}
      <div className="mt-3 flex gap-1">
        {STAGES.filter(s => s.id !== deal.stage).slice(0, 3).map(s => (
          <button key={s.id} onClick={() => onStageChange(s.id)}
            className="flex-1 py-1 rounded-lg text-[10px] font-semibold text-slate-400 border border-slate-200 hover:border-slate-300 hover:text-slate-600 transition-colors truncate">
            → {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
interface DealsProps {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  onToast?: (msg: string, type?: string) => void;
}

export default function Deals({ leads, team, currentUser, onToast }: DealsProps) {
  const [deals, setDeals]           = useState<Deal[]>([]);
  const [showModal, setShowModal]   = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const [editing, setEditing]       = useState<Deal | undefined>();
  const [stageFilter, setStageFilter] = useState<DealStage | 'all'>('all');

  /* Firestore */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'deals'), snap => {
      const data = snap.docs.map(d => d.data() as Deal);
      data.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setDeals(data);
    });
    return () => unsub();
  }, []);

  const saveDealToFS = useCallback(async (deal: Deal) => {
    const clean = Object.fromEntries(Object.entries(deal).filter(([,v]) => v !== undefined)) as Deal;
    await setDoc(doc(db, 'deals', deal.id), clean).catch(console.error);
  }, []);

  const handleSave = async (form: Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'proposals'>) => {
    const now = new Date().toISOString();
    const deal: Deal = {
      ...form,
      id:        editing?.id        ?? Date.now().toString(),
      proposals: editing?.proposals ?? [],
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveDealToFS(deal);
    setShowModal(false);
    setEditing(undefined);
    onToast?.(editing ? 'עסקה עודכנה ✓' : 'עסקה חדשה נוצרה ✓');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('למחוק את העסקה?')) return;
    await deleteDoc(doc(db, 'deals', id)).catch(console.error);
    onToast?.('עסקה נמחקה', 'info');
  };

  const handleStageChange = async (deal: Deal, stage: DealStage) => {
    const updated: Deal = { ...deal, stage, probability: STAGE_PROB[stage], updatedAt: new Date().toISOString(),
      ...(stage === 'won' ? { wonAt: new Date().toISOString() } : {}),
      ...(stage === 'lost' ? { lostAt: new Date().toISOString() } : {}),
    };
    await saveDealToFS(updated);
  };

  const handleAddProposal = async (proposal: Proposal) => {
    if (!editing) return;
    const updated: Deal = { ...editing, proposals: [proposal, ...editing.proposals], updatedAt: new Date().toISOString() };
    await saveDealToFS(updated);
    setShowProposal(false);
    onToast?.('הצעת מחיר נשמרה ✓');
  };

  /* KPIs */
  const kpis = useMemo(() => {
    const active  = deals.filter(d => d.stage !== 'lost');
    const won     = deals.filter(d => d.stage === 'won');
    const pipeline = active.reduce((s, d) => s + d.value * (d.probability / 100), 0);
    const closed  = won.reduce((s, d) => s + d.value, 0);
    const winRate = deals.length > 0 ? Math.round((won.length / deals.length) * 100) : 0;
    return { total: deals.length, pipeline, closed, winRate };
  }, [deals]);

  const filtered = useMemo(() =>
    stageFilter === 'all' ? deals : deals.filter(d => d.stage === stageFilter),
    [deals, stageFilter]
  );

  const openEdit = (d: Deal) => { setEditing(d); setShowModal(true); };
  const openProposal = (d: Deal) => { setEditing(d); setShowProposal(true); };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800">ניהול עסקאות</h1>
          <p className="text-sm text-slate-500 mt-0.5">מעקב עסקאות, הצעות מחיר ופייפליין מכירות</p>
        </div>
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 bg-black hover:bg-neutral-800 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm">
          <Plus size={16} /> עסקה חדשה
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Briefcase,  label: 'סה״כ עסקאות',    value: String(kpis.total),                    color: 'bg-indigo-500' },
          { icon: TrendingUp, label: 'פייפליין משוקלל', value: `₪${(kpis.pipeline/1000).toFixed(0)}K`, color: 'bg-blue-500' },
          { icon: Trophy,     label: 'עסקאות שנסגרו',  value: `₪${(kpis.closed/1000).toFixed(0)}K`,  color: 'bg-emerald-500' },
          { icon: Percent,    label: 'אחוז סגירה',      value: `${kpis.winRate}%`,                    color: 'bg-violet-500' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 shadow-sm">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={19} className="text-white" />
            </div>
            <div>
              <p className="text-xl font-black text-slate-800">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Stage filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm flex gap-2 flex-wrap">
        <button onClick={() => setStageFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${stageFilter === 'all' ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
          הכל ({deals.length})
        </button>
        {STAGES.map(s => (
          <button key={s.id} onClick={() => setStageFilter(s.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${stageFilter === s.id ? `${s.bg} ${s.color}` : 'text-slate-500 hover:bg-slate-100'}`}>
            {s.label} ({deals.filter(d => d.stage === s.id).length})
          </button>
        ))}
      </div>

      {/* Empty state */}
      {deals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
          <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center shadow-lg">
            <Briefcase size={36} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">עדיין אין עסקאות</h2>
            <p className="text-slate-400 text-sm max-w-sm">הוסף עסקה ראשונה, עקוב אחר השלב שלה ובנה הצעות מחיר מקצועיות.</p>
          </div>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-bold hover:bg-neutral-800">
            <Plus size={18} /> צור עסקה ראשונה
          </button>
        </div>
      )}

      {/* Deals grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              onEdit={() => openEdit(deal)}
              onDelete={() => handleDelete(deal.id)}
              onProposal={() => openProposal(deal)}
              onStageChange={s => handleStageChange(deal, s)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <DealModal
          initial={editing}
          leads={leads}
          team={team}
          currentUser={currentUser}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}
      {showProposal && editing && (
        <ProposalBuilder
          deal={editing}
          onSave={handleAddProposal}
          onClose={() => setShowProposal(false)}
        />
      )}
    </div>
  );
}
