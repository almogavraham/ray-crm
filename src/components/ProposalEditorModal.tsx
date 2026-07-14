/**
 * ProposalEditorModal
 * Opens from a lead card — pre-fills from the lead's solutions.
 * Lets the user edit items, then saves to Firestore + generates a printable PDF.
 */
import { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, Save, Send, Printer, Copy, Loader2, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Lead, WorkspaceProfile } from '../types';

interface ProposalItem {
  id: string;
  name: string;
  description: string;
  price: number;
  priceType: 'monthly' | 'one_time';
  quantity: number;
}

interface Props {
  lead: Lead;
  workspace: WorkspaceProfile;
  onClose: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function ProposalEditorModal({ lead, workspace, onClose, onToast }: Props) {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [clientName,  setClientName]  = useState(lead.company ?? lead.name ?? '');
  const [clientEmail, setClientEmail] = useState(lead.email ?? '');
  const [validDays,   setValidDays]   = useState<number>(14);
  const [notes,       setNotes]       = useState('');
  const [footer,      setFooter]      = useState('');
  const [items,       setItems]       = useState<ProposalItem[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [savedToken,  setSavedToken]  = useState<string | null>(null);

  // New-item form
  const [newName,      setNewName]      = useState('');
  const [newDesc,      setNewDesc]      = useState('');
  const [newPrice,     setNewPrice]     = useState('');
  const [newPriceType, setNewPriceType] = useState<'monthly' | 'one_time'>('monthly');
  const [newQty,       setNewQty]       = useState('1');
  const [showAddForm,  setShowAddForm]  = useState(false);

  // ── Pre-fill from lead solutions ────────────────────────────────────────────
  useEffect(() => {
    const preItems: ProposalItem[] = (lead.solutions ?? [])
      .filter((s: any) => s && (typeof s === 'string' || s.name))
      .map((s: any, i: number) => {
        const name      = typeof s === 'string' ? s : s.name ?? '';
        const price     = typeof s === 'object' && s.price ? Number(s.price) : lead.budget ?? 0;
        const priceType = typeof s === 'object' && s.priceType === 'one_time' ? 'one_time' : 'monthly';
        return { id: `pre-${i}`, name, description: '', price, priceType, quantity: 1 };
      });
    setItems(preItems);

    // Load default footer from workspace salesSettings if available
    const ws = workspace as any;
    const footer = ws?.salesSettings?.proposalFooter ?? '';
    const vdays  = ws?.salesSettings?.proposalValidDays ?? 14;
    setFooter(footer);
    setValidDays(vdays);
  }, []);

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalMonthly = items.filter(i => i.priceType === 'monthly').reduce((s, i) => s + i.price * i.quantity, 0);
  const totalOneTime = items.filter(i => i.priceType === 'one_time').reduce((s, i) => s + i.price * i.quantity, 0);
  const fmt = (n: number) => `₪${n.toLocaleString('he-IL')}`;

  // ── Item actions ─────────────────────────────────────────────────────────────
  const addItem = () => {
    if (!newName.trim() || !newPrice) return;
    setItems(prev => [...prev, {
      id: Date.now().toString(),
      name: newName.trim(),
      description: newDesc.trim(),
      price: Number(newPrice),
      priceType: newPriceType,
      quantity: Math.max(1, Number(newQty) || 1),
    }]);
    setNewName(''); setNewDesc(''); setNewPrice(''); setNewQty('1');
    setShowAddForm(false);
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  const updateItem = (id: string, field: keyof ProposalItem, value: string | number) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));

  // ── Generate proposal number ─────────────────────────────────────────────────
  const genProposalNumber = async (): Promise<string> => {
    try {
      const snap = await getDocs(collection(db, 'workspaces', workspace.id, 'proposals'));
      const count = snap.size + 1;
      const d = new Date();
      return `P-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(count).padStart(3,'0')}`;
    } catch {
      return `P-${Date.now()}`;
    }
  };

  const genToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ── Save to Firestore ────────────────────────────────────────────────────────
  const save = async (status: 'draft' | 'sent') => {
    if (!clientName.trim()) { onToast?.('נא להזין שם לקוח', 'error'); return; }
    if (items.length === 0)  { onToast?.('נא להוסיף לפחות פריט אחד', 'error'); return; }
    setSaving(true);
    try {
      const proposalNumber = await genProposalNumber();
      const token = genToken();
      const validUntil = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
      await addDoc(collection(db, 'workspaces', workspace.id, 'proposals'), {
        proposalNumber, clientName, clientEmail,
        leadId: lead.id,
        items, notes, footer, validUntil, status,
        totalMonthly, totalOneTime,
        createdAt: new Date().toISOString(),
        approvalToken: token,
      });
      setSavedToken(token);
      onToast?.(status === 'sent' ? 'הצעת המחיר נשלחה ✓' : 'הצעה נשמרה כטיוטה ✓', 'success');
    } catch (e) {
      onToast?.('שגיאה בשמירה', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Print PDF ────────────────────────────────────────────────────────────────
  const print = () => {
    const createdDate = new Date().toLocaleDateString('he-IL');
    const validDate   = new Date(Date.now() + validDays * 86400000).toLocaleDateString('he-IL');
    const monthlyRows = items.filter(i => i.priceType === 'monthly');
    const oneTimeRows = items.filter(i => i.priceType === 'one_time');

    const buildTable = (rows: ProposalItem[], label: string, color: string) => rows.length === 0 ? '' : `
      <h3 style="color:${color};font-size:14px;margin:20px 0 8px;font-weight:700">${label}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:${color}18">
            <th style="padding:10px 12px;text-align:right;border-bottom:2px solid ${color};font-weight:700">שירות / מוצר</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:2px solid ${color};font-weight:700">תיאור</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:2px solid ${color};font-weight:700">כמות</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid ${color};font-weight:700">מחיר</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid ${color};font-weight:700">סה"כ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item, idx) => `
            <tr style="background:${idx%2===0?'#fafafa':'#fff'}">
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${item.name}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px">${item.description || '—'}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:left">₪${item.price.toLocaleString('he-IL')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-weight:700;color:${color}">₪${(item.price*item.quantity).toLocaleString('he-IL')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
      <title>הצעת מחיר — ${clientName}</title>
      <style>body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;color:#1a1a2e;direction:rtl}
      .page{max-width:800px;margin:0 auto;padding:40px}@media print{body{padding:0}}</style>
      </head><body><div class="page">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #6366f1">
          <div>
            <h1 style="font-size:28px;font-weight:900;color:#6366f1;margin:0">${workspace.name}</h1>
            <p style="color:#666;margin:4px 0;font-size:13px">${workspace.email ?? ''}</p>
          </div>
          <div style="text-align:left">
            <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;margin-bottom:6px">הצעת מחיר</div>
            <p style="margin:2px 0;font-size:12px;color:#888">תאריך: ${createdDate}</p>
            <p style="margin:2px 0;font-size:12px;color:#888">תוקף עד: ${validDate}</p>
          </div>
        </div>
        <!-- Client -->
        <div style="background:#f8f9ff;border:2px solid #e0e7ff;border-radius:12px;padding:16px;margin-bottom:24px">
          <h3 style="color:#6366f1;font-size:13px;margin:0 0 8px;font-weight:700">📋 פרטי לקוח</h3>
          <p style="margin:2px 0;font-size:15px;font-weight:700">${clientName}</p>
          ${clientEmail ? `<p style="margin:2px 0;font-size:13px;color:#666">${clientEmail}</p>` : ''}
        </div>
        <!-- Items -->
        ${buildTable(monthlyRows, '📅 שירותים חודשיים (ריטיינר)', '#6366f1')}
        ${buildTable(oneTimeRows, '📦 תשלום חד-פעמי', '#10b981')}
        <!-- Totals -->
        <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#f8f9ff,#eef2ff);border-radius:12px;border:2px solid #c7d2fe">
          ${monthlyRows.length > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-weight:600;color:#333">סה"כ חודשי</span><span style="font-size:20px;font-weight:900;color:#6366f1">₪${totalMonthly.toLocaleString('he-IL')} / חודש</span></div>` : ''}
          ${oneTimeRows.length > 0 ? `<div style="display:flex;justify-content:space-between"><span style="font-weight:600;color:#333">סה"כ חד-פעמי</span><span style="font-size:20px;font-weight:900;color:#10b981">₪${totalOneTime.toLocaleString('he-IL')}</span></div>` : ''}
        </div>
        ${notes ? `<div style="margin-top:24px"><h3 style="font-size:13px;color:#444;margin:0 0 8px;font-weight:700">📝 הערות</h3><p style="font-size:13px;color:#555;line-height:1.6;white-space:pre-line">${notes}</p></div>` : ''}
        <!-- Signature -->
        <div style="margin-top:40px;padding-top:24px;border-top:2px dashed #c7d2fe">
          <h3 style="font-size:14px;color:#6366f1;margin:0 0 24px;font-weight:700">✍️ אישור והסכמה</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
            <div><p style="font-size:12px;color:#888;margin:0 0 4px">חתימת לקוח</p><div style="border-bottom:2px solid #333;height:40px;margin-bottom:8px"></div><p style="font-size:12px;color:#888">תאריך: ________________</p></div>
            <div><p style="font-size:12px;color:#888;margin:0 0 4px">שם מלא</p><div style="border-bottom:2px solid #333;height:40px;margin-bottom:8px"></div><p style="font-size:12px;color:#888">ת.ז.: ________________</p></div>
          </div>
        </div>
        ${footer ? `<div style="margin-top:32px;padding:16px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#777;line-height:1.6;white-space:pre-line">${footer}</div>` : ''}
        <p style="text-align:center;margin-top:32px;font-size:11px;color:#aaa">מסמך זה הופק באמצעות RAY CRM</p>
      </div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const copyLink = () => {
    if (!savedToken) { onToast?.('שמור קודם את ההצעה', 'info'); return; }
    const url = `${window.location.origin}?proposal=${savedToken}`;
    navigator.clipboard.writeText(url).then(() => onToast?.('הקישור הועתק ✓', 'success'));
  };

  // ── Styles ────────────────────────────────────────────────────────────────────
  const inp = 'bg-slate-700/80 text-white text-xs rounded-lg px-2 py-2 border border-slate-600 focus:outline-none focus:border-indigo-500 text-right transition-colors';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl flex flex-col"
        style={{ background: '#1e2d45', border: '1px solid rgba(255,255,255,0.14)' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
          style={{ background: '#1e2d45', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              <FileText size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white">📄 הצעת מחיר</h2>
              <p className="text-[11px] text-slate-400">{lead.company ?? lead.name}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-700/60 text-slate-400 hover:bg-slate-600 hover:text-white transition-all">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Client details */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-300">📋 פרטי לקוח</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">שם לקוח</label>
                <input type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                  className={inp + ' w-full'} placeholder="חברת X בע״מ" />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">אימייל לקוח</label>
                <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                  className={inp + ' w-full'} placeholder="client@email.com" dir="ltr" />
              </div>
            </div>
            <div className="w-32">
              <label className="text-[11px] text-slate-400 block mb-1">תוקף (ימים)</label>
              <input type="number" min={1} max={365} value={validDays}
                onChange={e => setValidDays(Number(e.target.value))}
                className={inp + ' w-full'} />
            </div>
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-300">🛒 פריטים</p>
              <button onClick={() => setShowAddForm(v => !v)}
                className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                {showAddForm ? <ChevronUp size={11} /> : <Plus size={11} />}
                {showAddForm ? 'סגור' : 'הוסף פריט'}
              </button>
            </div>

            {/* Items list */}
            {items.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-4">אין פריטים עדיין — הוסף פריט ידנית</p>
            ) : (
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id} className="rounded-xl p-3 space-y-2"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div className="flex items-center gap-2">
                      <input type="text" value={item.name}
                        onChange={e => updateItem(item.id, 'name', e.target.value)}
                        className={inp + ' flex-1'} placeholder="שם השירות" />
                      <button onClick={() => removeItem(item.id)}
                        className="flex-shrink-0 p-1.5 rounded-lg text-red-400 hover:bg-red-900/30 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="text" value={item.description}
                        onChange={e => updateItem(item.id, 'description', e.target.value)}
                        className={inp + ' flex-1'} placeholder="תיאור (אופציונלי)" />
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={item.priceType}
                        onChange={e => updateItem(item.id, 'priceType', e.target.value)}
                        className={inp}>
                        <option value="monthly">חודשי</option>
                        <option value="one_time">חד-פעמי</option>
                      </select>
                      <div className="flex items-center gap-1 flex-1 bg-slate-700/60 border border-slate-600 rounded-lg px-2 py-2 focus-within:border-indigo-500 transition-colors">
                        <span className="text-[11px] text-slate-400">₪</span>
                        <input type="number" min={0} value={item.price}
                          onChange={e => updateItem(item.id, 'price', Number(e.target.value))}
                          className="flex-1 bg-transparent text-white text-xs text-right focus:outline-none"
                          placeholder="מחיר" />
                      </div>
                      <div className="flex items-center gap-1 bg-slate-700/60 border border-slate-600 rounded-lg px-2 py-2 w-16 focus-within:border-indigo-500 transition-colors">
                        <span className="text-[11px] text-slate-400">×</span>
                        <input type="number" min={1} value={item.quantity}
                          onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                          className="flex-1 bg-transparent text-white text-xs text-right focus:outline-none" />
                      </div>
                      <span className="text-xs font-bold flex-shrink-0"
                        style={{ color: item.priceType === 'monthly' ? '#818cf8' : '#34d399' }}>
                        {fmt(item.price * item.quantity)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add item form */}
            {showAddForm && (
              <div className="rounded-xl p-4 space-y-3"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px dashed rgba(99,102,241,0.3)' }}>
                <p className="text-[11px] font-bold text-indigo-300">+ פריט חדש</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    className={inp + ' w-full'} placeholder="שם השירות / מוצר *" />
                  <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                    className={inp + ' w-full'} placeholder="תיאור (אופציונלי)" />
                </div>
                <div className="flex gap-2 items-center">
                  <select value={newPriceType} onChange={e => setNewPriceType(e.target.value as 'monthly' | 'one_time')}
                    className={inp}>
                    <option value="monthly">חודשי</option>
                    <option value="one_time">חד-פעמי</option>
                  </select>
                  <div className="flex items-center gap-1 flex-1 bg-slate-700/60 border border-slate-600 rounded-lg px-2 py-2 focus-within:border-indigo-500 transition-colors">
                    <span className="text-[11px] text-slate-400">₪</span>
                    <input type="number" min={0} value={newPrice} onChange={e => setNewPrice(e.target.value)}
                      className="flex-1 bg-transparent text-white text-xs text-right focus:outline-none" placeholder="מחיר *" />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-700/60 border border-slate-600 rounded-lg px-2 py-2 w-16 focus-within:border-indigo-500 transition-colors">
                    <span className="text-[11px] text-slate-400">×</span>
                    <input type="number" min={1} value={newQty} onChange={e => setNewQty(e.target.value)}
                      className="flex-1 bg-transparent text-white text-xs text-right focus:outline-none" />
                  </div>
                  <button onClick={addItem}
                    className="flex-shrink-0 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors">
                    הוסף
                  </button>
                </div>
              </div>
            )}

            {/* Totals */}
            {items.length > 0 && (
              <div className="flex gap-4 pt-2 px-1">
                {totalMonthly > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-400">סה"כ חודשי</p>
                    <p className="text-base font-black" style={{ color: '#818cf8' }}>{fmt(totalMonthly)} / חודש</p>
                  </div>
                )}
                {totalOneTime > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-400">סה"כ חד-פעמי</p>
                    <p className="text-base font-black" style={{ color: '#34d399' }}>{fmt(totalOneTime)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes + Footer */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-300">📝 הערות ותנאים</p>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">הערות להצעה</label>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                className={inp + ' w-full resize-none'}
                placeholder="הערות נוספות שיופיעו במסמך..." />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">תנאים / הערת סיום</label>
              <textarea rows={2} value={footer} onChange={e => setFooter(e.target.value)}
                className={inp + ' w-full resize-none'}
                placeholder="לדוגמה: תנאי תשלום: 50% מקדמה, 50% עם סיום." />
            </div>
          </div>
        </div>

        {/* Sticky footer actions */}
        <div className="sticky bottom-0 px-5 py-4 flex items-center gap-2 flex-wrap"
          style={{ background: '#1e2d45', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={() => save('draft')} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            שמור טיוטה
          </button>
          <button onClick={() => save('sent')} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            שמור וסמן כנשלחה
          </button>
          <div className="flex-1" />
          <button onClick={print}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
            <Printer size={12} /> הדפס / PDF
          </button>
          <button onClick={copyLink}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            title={savedToken ? 'העתק קישור ללקוח' : 'שמור קודם'}>
            <Copy size={12} /> העתק קישור
          </button>
        </div>
      </div>
    </div>
  );
}
