/**
 * AutomationStudio — one place to build and understand the automation system.
 *
 * The pieces existed but were scattered: the rule builder lived in the sales
 * agent, message wording was hard-coded per action, and there was no way to see
 * a rule as anything but a sentence. Splitting a single mental model ("what
 * happens automatically in my CRM") across three screens is what made it feel
 * complicated.
 *
 * Visual direction is deliberately linear and technical — hairline rules, mono
 * labels for structure, no card shadows or rounded blobs. This screen shows a
 * machine; it should read like an instrument panel, not a marketing page.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  Workflow as WfIcon, Mail, MessageCircle, ListChecks, Sparkles,
  Power, Trash2, Plus, Loader2, ChevronLeft,
} from 'lucide-react';
import AutomationCanvas from '../components/AutomationCanvas';
import TemplateEditor from '../components/TemplateEditor';
import { loadTemplates } from '../lib/messageTemplates';
import type { MessageTemplate } from '../lib/messageTemplates';
import AutomationChat from '../components/AutomationChat';
import { describeCondition, describeAction, runsAutomatically } from '../lib/automationEngine';
import type { Workflow } from '../lib/automationEngine';
import type { Lead, TeamMember, StandaloneTask, TaskPriority } from '../types';

type Tab = 'board' | 'email' | 'whatsapp' | 'tasks';

const TABS: { key: Tab; label: string; icon: React.ElementType; hint: string }[] = [
  { key: 'board',    label: 'לוח האוטומציות', icon: WfIcon,        hint: 'FLOW' },
  { key: 'email',    label: 'תבניות מייל',     icon: Mail,          hint: 'EMAIL' },
  { key: 'whatsapp', label: 'תבניות וואטסאפ',  icon: MessageCircle, hint: 'WHATSAPP' },
  { key: 'tasks',    label: 'משימות',          icon: ListChecks,    hint: 'TASKS' },
];

interface Props {
  workspaceId?: string;
  leads: Lead[];
  team?: TeamMember[];
  currentUser?: string;
  statuses: string[];
  sources: string[];
  onCreateTask?: (t: StandaloneTask) => void;
  standaloneTasks?: StandaloneTask[];
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}

export default function AutomationStudio({
  workspaceId, leads, team, currentUser, statuses, sources, onCreateTask,
  standaloneTasks, onToast,
}: Props) {
  const [tab, setTab] = useState<Tab>('board');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [flows, setFlows] = useState<Workflow[]>([]);
  const [selId, setSel] = useState<string | null>(null);
  const [chat, setChat] = useState(false);
  const [seed, setSeed] = useState<string>('');
  const [saving, setSaving] = useState(false);

  /* ── Live workflows ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    void loadTemplates(workspaceId).then(t => { if (alive) setTemplates(t); });
    return () => { alive = false; };
  }, [workspaceId, tab]);

  useEffect(() => {
    if (!workspaceId) return;
    const unsub = onSnapshot(
      collection(db, 'workspaces', workspaceId, 'workflows'),
      snap => {
        const list = snap.docs.map(d => ({ ...(d.data() as Workflow), id: d.id }));
        setFlows(list);
        setSel(prev => prev && list.some(f => f.id === prev) ? prev : (list[0]?.id ?? null));
      },
      err => console.error('[studio workflows]', err),
    );
    return () => unsub();
  }, [workspaceId]);

  const selected = useMemo(() => flows.find(f => f.id === selId) ?? null, [flows, selId]);

  const persist = async (wf: Workflow) => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'workspaces', workspaceId, 'workflows', wf.id), wf, { merge: true });
    } catch (e) {
      onToast(`שמירה נכשלה: ${(e as Error).message}`, 'error');
    } finally { setSaving(false); }
  };

  const toggle = (wf: Workflow) => void persist({ ...wf, active: !wf.active });

  const remove = async (wf: Workflow) => {
    if (!workspaceId) return;
    if (!window.confirm(`למחוק את "${wf.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'workspaces', workspaceId, 'workflows', wf.id));
      onToast('האוטומציה נמחקה', 'info');
    } catch (e) { onToast(`מחיקה נכשלה: ${(e as Error).message}`, 'error'); }
  };

  const saveFromChat = async (draft: {
    name: string; description: string; conditionLogic: 'and' | 'or';
    conditions: Workflow['conditions']; actions: Workflow['actions'];
  }) => {
    if (!workspaceId) { onToast('אין סביבת עבודה', 'error'); return; }
    const wf: Workflow = {
      id: `wf_${Date.now()}`, name: draft.name, active: true,
      conditionLogic: draft.conditionLogic, conditions: draft.conditions, actions: draft.actions,
      createdAt: new Date().toISOString(), runCount: 0,
    };
    await persist(wf);
    setSel(wf.id); setTab('board');
    onToast(`"${wf.name}" נוצרה ✓`, 'success');
  };

  const askChat = (prompt: string) => { setSeed(prompt); setChat(true); };

  /* ── Chrome ─────────────────────────────────────────────────────────────── */
  const rule = { borderBottom: '1px solid var(--as-line)' };

  return (
    <div dir="rtl" className="auto-studio -mx-4 md:-mx-6 -mt-4 md:-mt-6 min-h-screen"
      style={{ background: 'var(--as-ground)' }}>

      {/* Header */}
      <div className="px-5 md:px-8 pt-7 pb-4" style={rule}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <button onClick={() => askChat('')}
            className="flex items-center gap-2 px-4 py-2.5 text-[12px] font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', borderRadius: 10 }}>
            <Sparkles size={14} />בנה עם הצ'אט
          </button>
          <div className="text-right">
            <div className="text-[10px] font-mono tracking-[0.18em] mb-1" style={{ color: 'var(--as-text-3)' }}>
              AUTOMATION STUDIO
            </div>
            <h1 className="text-2xl md:text-[28px] font-black" style={{ color: 'var(--as-text)', letterSpacing: '-0.02em' }}>
              בונה האוטומציות
            </h1>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--as-text-2)' }}>
              כללים, תבניות הודעה ומשימות — במקום אחד. תאר מה אתה רוצה שיקרה, והצ'אט יבנה.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-5 flex-wrap justify-end">
          {TABS.map(t => {
            const on = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex items-center gap-2 px-3.5 py-2 text-[12px] font-bold transition-colors"
                style={{
                  color: on ? 'var(--as-text)' : 'var(--as-text-3)',
                  borderBottom: on ? '2px solid #6366f1' : '2px solid transparent',
                }}>
                <span className="font-mono text-[9px] tracking-wider opacity-50">{t.hint}</span>
                {t.label}
                <t.icon size={13} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-5 md:px-8 py-6">
        {tab === 'board' && (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
            <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">

              {/* Rule list */}
              <div className="space-y-1.5 order-1">
                <div className="flex items-center justify-between px-1 pb-2" style={rule}>
                  <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--as-text-3)' }}>
                    {flows.length} RULES · {flows.filter(f => f.active).length} ON
                  </span>
                  <button onClick={() => askChat('')} className="p-1" style={{ color: 'var(--as-text-2)' }}>
                    <Plus size={14} />
                  </button>
                </div>

                {flows.length === 0 ? (
                  <p className="text-[12px] py-8 text-center" style={{ color: 'var(--as-text-3)' }}>
                    אין עדיין אוטומציות.<br />לחץ "בנה עם הצ'אט".
                  </p>
                ) : flows.map(f => {
                  const on = f.id === selId;
                  const manual = (f.actions ?? []).some(a => !runsAutomatically(a.type));
                  return (
                    <button key={f.id} onClick={() => setSel(f.id)}
                      className="w-full text-right px-3 py-2.5 flex items-start gap-2.5 transition-colors"
                      style={{
                        background: on ? 'rgba(99,102,241,0.11)' : 'transparent',
                        borderInlineStart: on ? '2px solid #6366f1' : '2px solid transparent',
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                        style={{ background: f.active ? '#10b981' : 'var(--as-line-2)' }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-bold truncate"
                          style={{ color: 'var(--as-text)' }}>{f.name}</span>
                        <span className="block text-[10px] mt-0.5" style={{ color: 'var(--as-text-3)' }}>
                          {(f.conditions ?? []).length} תנאים · {(f.actions ?? []).length} פעולות
                          {manual && <span style={{ color: 'var(--as-warn)' }}> · ידני</span>}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Canvas + detail */}
              <div className="order-2 min-w-0">
                {!selected ? (
                  <div className="flex items-center justify-center py-24 text-[12px]"
                    style={{ color: 'var(--as-text-3)' }}>בחר אוטומציה מהרשימה</div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap pb-3" style={rule}>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => remove(selected)} className="p-1.5"
                          style={{ color: 'rgba(248,113,113,0.75)' }}><Trash2 size={13} /></button>
                        <button onClick={() => toggle(selected)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold"
                          style={{
                            borderRadius: 8,
                            background: selected.active ? 'rgba(16,185,129,0.13)' : 'var(--as-surf)',
                            border: `1px solid ${selected.active ? 'rgba(16,185,129,0.35)' : 'var(--as-line)'}`,
                            color: selected.active ? 'var(--as-ok)' : 'var(--as-text-3)',
                          }}>
                          <Power size={12} />{selected.active ? 'פעילה' : 'כבויה'}
                        </button>
                        {saving && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--as-text-3)' }} />}
                      </div>
                      <div className="text-right min-w-0">
                        <input
                          value={selected.name}
                          onChange={e => void persist({ ...selected, name: e.target.value })}
                          className="bg-transparent text-lg font-bold text-right focus:outline-none w-full"
                          style={{ color: 'var(--as-text)' }} />
                        <p className="text-[11px]" style={{ color: 'var(--as-text-3)' }}>
                          רץ {selected.runCount ?? 0} פעמים
                        </p>
                      </div>
                    </div>

                    <AutomationCanvas
                      workflow={selected}
                      statuses={statuses}
                      sources={sources}
                      templates={templates}
                      onChange={wf => void persist(wf)}
                      onAskChat={askChat}
                    />

                    {/* Plain-language restatement — the canvas shows shape, this
                        confirms meaning. Both, because people check one against
                        the other before trusting a rule with their pipeline. */}
                    <div className="pt-3" style={{ borderTop: '1px solid var(--as-line)' }}>
                      <div className="text-[10px] font-mono tracking-wider mb-2 text-right"
                        style={{ color: 'var(--as-text-3)' }}>IN WORDS</div>
                      <p className="text-[12.5px] leading-relaxed text-right" style={{ color: 'var(--as-text-2)' }}>
                        <b style={{ color: 'var(--as-info)' }}>כאשר </b>
                        {(selected.conditions ?? []).map(c => describeCondition(c)).join(
                          selected.conditionLogic === 'or' ? ' או ' : ' וגם ') || '—'}
                        <b style={{ color: 'var(--as-ok)' }}> אז </b>
                        {(selected.actions ?? []).map(a => describeAction(a)).join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'email' && workspaceId && (
          <TemplateEditor workspaceId={workspaceId} channel="email" onToast={onToast} />
        )}
        {tab === 'whatsapp' && workspaceId && (
          <TemplateEditor workspaceId={workspaceId} channel="whatsapp" onToast={onToast} />
        )}
        {tab === 'tasks' && (
          <TaskComposer team={team} currentUser={currentUser} leads={leads}
            standaloneTasks={standaloneTasks}
            onCreateTask={onCreateTask} onToast={onToast} onAskChat={askChat} />
        )}
      </div>

      {chat && (
        <AutomationChat
          leads={leads}
          statuses={statuses}
          sources={sources}
          team={team}
          seedPrompt={seed}
          onSave={saveFromChat}
          onClose={() => { setChat(false); setSeed(''); }}
        />
      )}
    </div>
  );
}

/* ── Task composer ─────────────────────────────────────────────────────────── */
/**
 * Creating a task by hand, next to the rules that create them automatically.
 * Deliberately in the same studio: seeing both makes it obvious when a task you
 * keep creating manually should become an automation instead — and the button
 * at the bottom turns exactly that thought into a rule.
 */
function TaskComposer({ team, currentUser, leads, standaloneTasks, onCreateTask, onToast, onAskChat }: {
  team?: TeamMember[]; currentUser?: string; leads: Lead[];
  standaloneTasks?: StandaloneTask[];
  onCreateTask?: (t: StandaloneTask) => void;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onAskChat: (p: string) => void;
}) {
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('09:00');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignee, setAssignee] = useState(currentUser ?? '');
  const [leadId, setLeadId] = useState('');

  const inp: React.CSSProperties = {
    background: 'var(--as-surf)', border: '1px solid var(--as-line)',
    color: 'var(--as-text)', borderRadius: 9, padding: '9px 11px', fontSize: 13, width: '100%',
  };
  const lbl = 'text-[10px] font-mono tracking-wider mb-1.5 block text-right';

  const submit = () => {
    const d = desc.trim();
    if (!d) { onToast('כתוב מה צריך לעשות', 'error'); return; }
    onCreateTask?.({
      id: `${Date.now()}-studio`, description: d, date, time, priority,
      completed: false, assignedTo: assignee || currentUser || '', assignedBy: currentUser ?? '',
      createdAt: new Date().toISOString(), ...(leadId ? { leadId } : {}),
    });
    onToast('המשימה נוצרה ✓', 'success');
    setDesc(''); setLeadId('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={lbl} style={{ color: 'var(--as-text-3)' }}>WHAT</label>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="מה צריך לעשות?" style={inp} />
        </div>
        <div>
          <label className={lbl} style={{ color: 'var(--as-text-3)' }}>WHEN</label>
          <div className="flex gap-2">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inp, width: 110 }} />
          </div>
        </div>
        <div>
          <label className={lbl} style={{ color: 'var(--as-text-3)' }}>PRIORITY</label>
          <div className="flex gap-1.5">
            {([['high', 'גבוהה', '#ef4444'], ['medium', 'בינונית', '#f59e0b'], ['low', 'נמוכה', '#64748b']] as const).map(([k, label, col]) => (
              <button key={k} onClick={() => setPriority(k)}
                className="flex-1 py-2 text-[11px] font-bold"
                style={{
                  borderRadius: 9,
                  background: priority === k ? `${col}22` : 'var(--as-surf)',
                  border: `1px solid ${priority === k ? col : 'var(--as-line)'}`,
                  color: priority === k ? col : 'var(--as-text-3)',
                }}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl} style={{ color: 'var(--as-text-3)' }}>OWNER</label>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={inp}>
            <option value="">ללא שיוך</option>
            {(team ?? []).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} style={{ color: 'var(--as-text-3)' }}>LEAD (OPTIONAL)</label>
          <select value={leadId} onChange={e => setLeadId(e.target.value)} style={inp}>
            <option value="">ללא ליד</option>
            {leads.slice(0, 200).map(l => <option key={l.id} value={l.id}>{l.company}</option>)}
          </select>
        </div>
      </div>

      <button onClick={submit}
        className="w-full py-2.5 text-[13px] font-bold text-white"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', borderRadius: 10 }}>
        צור משימה
      </button>

      <div className="pt-4 flex items-center gap-2 justify-end" style={{ borderTop: '1px solid var(--as-line)' }}>
        <button onClick={() => onAskChat(desc.trim()
          ? `בנה אוטומציה שתיצור את המשימה "${desc.trim()}" אוטומטית — מתי היא צריכה לרוץ?`
          : 'אני רוצה אוטומציה שתיצור משימות אוטומטית')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold"
          style={{ borderRadius: 8, background: 'rgba(139,92,246,0.13)', border: '1px solid rgba(139,92,246,0.32)', color: 'var(--as-accent)' }}>
          <ChevronLeft size={12} />הפוך את זה לאוטומציה
        </button>
        <span className="text-[11px] text-right" style={{ color: 'var(--as-text-3)' }}>
          יוצר את אותה משימה שוב ושוב?
        </span>
      </div>
    </div>

      <UpcomingTasks leads={leads} standaloneTasks={standaloneTasks} />
    </div>
  );
}

/* ── Upcoming tasks ────────────────────────────────────────────────────────── */
/**
 * What is already scheduled, beside the form that schedules more. Tasks live in
 * two places — standalone, and attached to a lead — and a list that showed only
 * one of them would quietly under-report the day, so both are merged here and
 * each row says which lead it belongs to.
 */
function UpcomingTasks({ leads, standaloneTasks }: {
  leads: Lead[]; standaloneTasks?: StandaloneTask[];
}) {
  const rows = useMemo(() => {
    const out: { id: string; description: string; date: string; time: string;
                 priority?: TaskPriority; who?: string; lead?: string }[] = [];
    for (const t of standaloneTasks ?? []) {
      if (t.completed) continue;
      out.push({
        id: t.id, description: t.description, date: t.date, time: t.time,
        priority: t.priority, who: t.assignedTo,
        lead: t.leadId ? leads.find(l => l.id === t.leadId)?.company : undefined,
      });
    }
    for (const l of leads) {
      for (const t of l.tasks ?? []) {
        if (t.completed) continue;
        out.push({
          id: `${l.id}:${t.id}`, description: t.description, date: t.date,
          time: t.time, priority: t.priority, who: t.assignedTo, lead: l.company,
        });
      }
    }
    return out.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [leads, standaloneTasks]);

  const today = new Date().toISOString().slice(0, 10);
  const PRI: Record<string, string> = {
    high: 'var(--as-danger)', medium: 'var(--as-warn)', low: 'var(--as-text-3)',
  };

  return (
    <div>
      <div className="flex items-baseline gap-2 justify-between mb-2.5">
        <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--as-text-3)' }}>
          {rows.length} OPEN
        </span>
        <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--as-text-3)' }}>
          UPCOMING
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl py-10 text-center"
          style={{ background: 'var(--as-surf)', border: '1px dashed var(--as-line-2)' }}>
          <p className="text-xs" style={{ color: 'var(--as-text-3)' }}>אין משימות פתוחות.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)' }}>
          {rows.slice(0, 12).map((r, i) => {
            const overdue = r.date < today;
            return (
              <div key={r.id} className="px-3.5 py-2.5 flex items-start gap-3"
                style={i ? { borderTop: '1px solid var(--as-line)' } : undefined}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                  style={{ background: PRI[r.priority ?? 'low'] ?? 'var(--as-text-3)' }} />
                <div className="min-w-0 flex-1 text-right">
                  <div className="text-[12.5px] truncate" style={{ color: 'var(--as-text)' }}>
                    {r.description}
                  </div>
                  <div className="text-[10px] mt-0.5 flex items-center gap-1.5 justify-end flex-wrap"
                    style={{ color: 'var(--as-text-3)' }}>
                    {r.who && <span>· {r.who}</span>}
                    {r.lead && <span>· {r.lead}</span>}
                    <span dir="ltr" style={overdue ? { color: 'var(--as-danger)' } : undefined}>
                      {r.date} {r.time}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {rows.length > 12 && (
            <div className="px-3.5 py-2 text-[10px] text-center"
              style={{ borderTop: '1px solid var(--as-line)', color: 'var(--as-text-3)' }}>
              ועוד {rows.length - 12} משימות
            </div>
          )}
        </div>
      )}
    </div>
  );
}
