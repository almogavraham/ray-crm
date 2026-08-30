/**
 * TemplateEditor — write the email and WhatsApp bodies automations send.
 *
 * Preview is always visible rather than behind a toggle. A template is written
 * once and then sent unattended hundreds of times, so the moment to catch a
 * broken variable or an awkward line is while typing it — not after a customer
 * receives `{{frist_name}}`.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, Mail, MessageCircle, Check, AlertTriangle, Loader2 } from 'lucide-react';
import {
  loadTemplates, saveTemplates, previewTemplate, unknownVariables,
  VARIABLES, STARTER_TEMPLATES,
} from '../lib/messageTemplates';
import type { MessageTemplate, TemplateChannel } from '../lib/messageTemplates';

export default function TemplateEditor({ workspaceId, channel, onToast }: {
  workspaceId: string;
  channel: TemplateChannel;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [all, setAll] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTemplates(workspaceId).then(t => { if (alive) { setAll(t); setLoading(false); } });
    return () => { alive = false; };
  }, [workspaceId]);

  const mine = all.filter(t => t.channel === channel);

  const persist = async (next: MessageTemplate[]) => {
    setAll(next); setSaving(true);
    try { await saveTemplates(workspaceId, next); }
    catch (e) { onToast(`שמירה נכשלה: ${(e as Error).message}`, 'error'); }
    finally { setSaving(false); }
  };

  const create = (seed?: Omit<MessageTemplate, 'id' | 'createdAt'>) => {
    const t: MessageTemplate = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      channel,
      name: seed?.name ?? 'תבנית חדשה',
      subject: seed?.subject ?? (channel === 'email' ? '' : undefined),
      body: seed?.body ?? '',
      createdAt: Date.now(),
    };
    void persist([...all, t]);
    setOpenId(t.id);
  };

  const patch = (id: string, p: Partial<MessageTemplate>) =>
    void persist(all.map(t => (t.id === id ? { ...t, ...p, updatedAt: Date.now() } : t)));

  const remove = (t: MessageTemplate) => {
    if (!window.confirm(`למחוק את "${t.name}"?\n\nאוטומציות שמשתמשות בה יפסיקו לשלוח.`)) return;
    void persist(all.filter(x => x.id !== t.id));
    onToast('התבנית נמחקה', 'info');
  };

  const insertVar = (t: MessageTemplate, key: string) =>
    patch(t.id, { body: `${t.body}{{${key}}}` });

  const inp: React.CSSProperties = {
    background: 'var(--as-surf)', border: '1px solid var(--as-line)',
    color: 'var(--as-text)', borderRadius: 9, padding: '8px 10px', fontSize: 13, width: '100%',
  };

  if (loading) return <p className="text-center py-10 text-xs" style={{ color: 'var(--as-text-3)' }}>טוען…</p>;

  const Icon = channel === 'email' ? Mail : MessageCircle;
  const accent = channel === 'email' ? '#6366f1' : '#22c55e';

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => create()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white"
            style={{ background: accent }}>
            <Plus size={12} />תבנית חדשה
          </button>
          {mine.length === 0 && STARTER_TEMPLATES.filter(s => s.channel === channel).map(s => (
            <button key={s.name} onClick={() => create(s)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: 'var(--as-surf)', border: '1px dashed var(--as-line-2)', color: 'var(--as-text-2)' }}>
              + {s.name}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-mono tracking-wider flex items-center gap-1.5"
          style={{ color: 'var(--as-text-3)' }}>
          {saving && <Loader2 size={10} className="animate-spin" />}
          {mine.length} TEMPLATES
        </span>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl py-12 text-center"
          style={{ background: 'var(--as-surf)', border: '1px dashed var(--as-line-2)' }}>
          <Icon size={24} className="mx-auto mb-2" style={{ color: 'var(--as-text-4)' }} />
          <p className="text-xs" style={{ color: 'var(--as-text-3)' }}>
            אין עדיין תבניות. התחל מאחת המוכנות למעלה או צור חדשה.
          </p>
        </div>
      ) : mine.map(t => {
        const open = openId === t.id;
        const unknown = unknownVariables(`${t.subject ?? ''} ${t.body}`);
        return (
          <div key={t.id} className="rounded-xl overflow-hidden"
            style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)' }}>
            <button onClick={() => setOpenId(open ? null : t.id)}
              className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-right">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {unknown.length > 0 && <AlertTriangle size={12} style={{ color: 'var(--as-warn)' }} />}
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold truncate" style={{ color: 'var(--as-text)' }}>{t.name}</div>
                <div className="text-[10px] truncate" style={{ color: 'var(--as-text-3)' }}>
                  {(t.subject || t.body || '—').slice(0, 70)}
                </div>
              </div>
            </button>

            {open && (
              <div className="px-3.5 pb-3.5 space-y-2.5" style={{ borderTop: '1px solid var(--as-line)' }}>
                <div className="flex gap-2 pt-3">
                  <input value={t.name} onChange={e => patch(t.id, { name: e.target.value })}
                    placeholder="שם התבנית" style={{ ...inp, flex: 1 }} />
                  <button onClick={() => remove(t)} className="p-2 rounded-lg flex-shrink-0"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--as-danger)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>

                {channel === 'email' && (
                  <input value={t.subject ?? ''} onChange={e => patch(t.id, { subject: e.target.value })}
                    placeholder="שורת נושא" style={inp} />
                )}

                <textarea value={t.body} onChange={e => patch(t.id, { body: e.target.value })}
                  rows={channel === 'email' ? 7 : 4}
                  placeholder={channel === 'email' ? 'גוף המייל…' : 'תוכן ההודעה…'}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />

                <div className="flex flex-wrap gap-1.5 justify-end">
                  {VARIABLES.map(v => (
                    <button key={v.key} onClick={() => insertVar(t, v.key)} title={v.label}
                      className="px-2 py-1 rounded text-[10px] font-mono"
                      style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)', color: 'var(--as-text-2)' }}>
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                  <span className="text-[10px] self-center" style={{ color: 'var(--as-text-3)' }}>הוסף משתנה:</span>
                </div>

                {unknown.length > 0 && (
                  <p className="text-[11px] flex items-center gap-1.5 justify-end" style={{ color: 'var(--as-warn)' }}>
                    משתנים לא מוכרים: {unknown.map(u => `{{${u}}}`).join(', ')} — יישלחו ריקים.
                    <AlertTriangle size={12} />
                  </p>
                )}

                <div className="rounded-lg p-3"
                  style={{ background: 'var(--as-well)', border: '1px solid var(--as-line)' }}>
                  <div className="text-[10px] font-mono tracking-wider mb-1.5 flex items-center gap-1.5 justify-end"
                    style={{ color: 'var(--as-text-3)' }}>
                    PREVIEW <Check size={10} />
                  </div>
                  {channel === 'email' && t.subject && (
                    <p className="text-[12px] font-bold mb-1.5" style={{ color: 'var(--as-text)' }}>
                      {previewTemplate(t.subject)}
                    </p>
                  )}
                  <p className="text-[12px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--as-text-2)' }}>
                    {previewTemplate(t.body) || '—'}
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
