/**
 * FormBuilder — create an embeddable lead-capture form and copy its snippet.
 *
 * The point of this screen is to turn "connect your website" from a developer
 * task into a copy-paste. So it shows the snippet immediately, defaults every
 * setting to something sensible, and never asks a question the customer would
 * have to research.
 */

import { useEffect, useState } from 'react';
import {
  Code2, Plus, Copy, Check, Trash2, Loader2, Power, Globe, Eye,
} from 'lucide-react';
import {
  loadForms, saveForms, newFormId, embedSnippet, DEFAULT_FORM,
} from '../lib/leadForms';
import type { LeadForm } from '../lib/leadForms';

export default function FormBuilder({ workspaceId, statuses, sources, team, onToast }: {
  workspaceId: string;
  statuses: string[];
  sources: string[];
  team?: { name: string }[];
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadForms(workspaceId).then(f => { if (alive) { setForms(f); setLoading(false); } });
    return () => { alive = false; };
  }, [workspaceId]);

  const persist = async (next: LeadForm[]) => {
    setForms(next);
    try { await saveForms(workspaceId, next); }
    catch (e) { onToast(`שמירה נכשלה: ${(e as Error).message}`, 'error'); }
  };

  const create = () => {
    const f: LeadForm = {
      ...DEFAULT_FORM(),
      id: newFormId(),
      defaultStatus: statuses[0] ?? 'חדש',
      defaultSource: sources.find(s => s.includes('אתר')) ?? 'טופס אתר',
      createdAt: Date.now(),
    };
    void persist([...forms, f]);
    setOpenId(f.id);
    onToast('טופס נוצר — העתק את הקוד לאתר שלך', 'success');
  };

  const patch = (id: string, p: Partial<LeadForm>) =>
    void persist(forms.map(f => (f.id === id ? { ...f, ...p } : f)));

  const remove = (f: LeadForm) => {
    if (!window.confirm(`למחוק את "${f.name}"?\n\nהטופס באתר יפסיק לעבוד מיד.`)) return;
    void persist(forms.filter(x => x.id !== f.id));
    onToast('הטופס נמחק', 'info');
  };

  const copy = (f: LeadForm) => {
    navigator.clipboard?.writeText(embedSnippet(workspaceId, f)).catch(() => {});
    setCopied(f.id); setTimeout(() => setCopied(null), 2000);
    onToast('הקוד הועתק — הדבק אותו בדף באתר', 'success');
  };

  const inp: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', borderRadius: 10, padding: '8px 10px', fontSize: 13, width: '100%',
  };
  const lbl = 'text-[11px] font-bold mb-1.5 block';

  if (loading) {
    return <p className="text-center py-10 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>טוען…</p>;
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-start gap-2 justify-between flex-wrap">
        <button onClick={create}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          <Plus size={13} />טופס חדש
        </button>
        <p className="text-[11px] text-right flex-1 min-w-[240px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          כל טופס מייצר קוד להדבקה באתר. לידים נכנסים ישירות למערכת עם ייחוס הקמפיין
          (UTM) שהביא אותם — בלי צורך במפתח ובלי Webhook.
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-2xl py-12 text-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.14)' }}>
          <Globe size={26} className="mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.2)' }} />
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>אין עדיין טפסים</p>
        </div>
      ) : forms.map(f => {
        const open = openId === f.id;
        return (
          <div key={f.id} className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

            <div className="px-4 py-3 flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => remove(f)} title="מחק"
                  className="p-1.5 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                  <Trash2 size={12} />
                </button>
                <button onClick={() => copy(f)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1"
                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
                  {copied === f.id ? <Check size={12} /> : <Copy size={12} />}
                  {copied === f.id ? 'הועתק' : 'העתק קוד'}
                </button>
                <button onClick={() => setOpenId(open ? null : f.id)}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                  <Eye size={12} />
                </button>
              </div>

              <div className="text-right min-w-0 flex-1">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded"
                    style={f.enabled
                      ? { background: 'rgba(16,185,129,0.15)', color: '#34d399' }
                      : { background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                    {f.enabled ? 'פעיל' : 'מושבת'}
                  </span>
                  <span className="text-sm font-bold truncate" style={{ color: 'rgba(255,255,255,0.88)' }}>{f.name}</span>
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  נכנס כ״{f.defaultStatus}״ · מקור ״{f.defaultSource}״
                </p>
              </div>
            </div>

            {open && (
              <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>שם הטופס</label>
                    <input value={f.name} onChange={e => patch(f.id, { name: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>הודעת תודה</label>
                    <input value={f.successMessage} onChange={e => patch(f.id, { successMessage: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>סטטוס התחלתי</label>
                    <select value={f.defaultStatus} onChange={e => patch(f.id, { defaultStatus: e.target.value })} style={inp}>
                      {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>מקור הגעה</label>
                    <select value={f.defaultSource} onChange={e => patch(f.id, { defaultSource: e.target.value })} style={inp}>
                      {[...new Set([f.defaultSource, 'טופס אתר', ...sources])].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>שיוך אוטומטי</label>
                    <select value={f.assignTo ?? ''} onChange={e => patch(f.id, { assignTo: e.target.value })} style={inp}>
                      <option value="">ללא שיוך</option>
                      {(team ?? []).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl} style={{ color: 'rgba(255,255,255,0.5)' }}>הפניה אחרי שליחה (לא חובה)</label>
                    <input value={f.redirectUrl ?? ''} onChange={e => patch(f.id, { redirectUrl: e.target.value })}
                      placeholder="https://…/thank-you" dir="ltr" style={inp} />
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-end flex-wrap">
                  {([['email', 'אימייל'], ['company', 'שם חברה'], ['message', 'הודעה']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 text-[11px] cursor-pointer"
                      style={{ color: 'rgba(255,255,255,0.55)' }}>
                      <input type="checkbox" checked={f.fields[k]}
                        onChange={e => patch(f.id, { fields: { ...f.fields, [k]: e.target.checked } })}
                        className="accent-indigo-500" />
                      {label}
                    </label>
                  ))}
                  <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>שדות (שם וטלפון תמיד):</span>
                </div>

                <button onClick={() => patch(f.id, { enabled: !f.enabled })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                  style={f.enabled
                    ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }
                    : { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
                  <Power size={12} />{f.enabled ? 'השבת טופס' : 'הפעל טופס'}
                </button>

                <div>
                  <label className={lbl + ' flex items-center gap-1.5 justify-end'} style={{ color: 'rgba(255,255,255,0.5)' }}>
                    קוד להדבקה באתר <Code2 size={12} />
                  </label>
                  <textarea readOnly value={embedSnippet(workspaceId, f)} rows={6} dir="ltr"
                    onClick={e => (e.target as HTMLTextAreaElement).select()}
                    className="w-full rounded-xl p-3 text-[10.5px] font-mono resize-y"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.55)' }} />
                  <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    הדבק בכל דף באתר. הטופס יורש את פרמטרי ה‑UTM של הדף, כך שתדע איזה קמפיין הביא כל ליד.
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
