/**
 * AutomationCanvas — an automation drawn as the flow it actually is.
 *
 * A rule reads as a sentence in the list view ("if X and Y then do A, B"), which
 * is fine for one rule and useless for understanding a system of them. Drawn as
 * a flow, three things become obvious at a glance that prose hides: how many
 * conditions gate the rule, whether they are AND or OR, and which actions are
 * automatic versus waiting for a human.
 *
 * Rendered as SVG rather than positioned divs so the connectors are real
 * geometry — they stay attached at any zoom and never drift out of alignment
 * with their nodes.
 *
 * Layout is computed, not stored. There is no value in letting someone drag a
 * condition somewhere meaningless; the shape of the rule IS the layout, so the
 * canvas derives it and spends the interaction budget on editing instead.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, X, Zap, GitBranch, Play, Hand, RotateCcw } from 'lucide-react';
import {
  TRIGGER_LABELS, ACTION_LABELS, SAFE_ACTIONS, SEND_ACTIONS, VALUELESS_TRIGGERS, runsAutomatically,
  describeCondition, describeAction,
} from '../lib/automationEngine';
import type { Workflow, WorkflowCondition, WorkflowAction, TriggerType, WFActionType } from '../lib/automationEngine';
import type { MessageTemplate } from '../lib/messageTemplates';

/* ── Geometry ─────────────────────────────────────────────────────────────── */
const PAD = 28;
const NODE_W = 210;
const NODE_H = 54;
const COL_GAP = 96;
const CANVAS_W = PAD * 2 + NODE_W * 3 + COL_GAP * 2;
/**
 * Column 0 is the RIGHTMOST column. SVG coordinates are unaffected by
 * dir="rtl", so a Hebrew flow has to be mirrored in the maths — otherwise
 * the trigger lands on the left and every elbow connector, which is written
 * to leave `from`'s left edge, runs backwards through the node it came from.
 */
const colX = (i: number) => CANVAS_W - PAD - NODE_W - i * (NODE_W + COL_GAP);
const ROW_GAP = 18;

type Kind = 'trigger' | 'gate' | 'action';
interface Node {
  id: string; kind: Kind; x: number; y: number;
  title: string; sub?: string; auto?: boolean;
}

/** RTL flow: the trigger sits on the RIGHT and the flow runs leftwards. */
function layout(wf: Workflow) {
  const conds = wf.conditions ?? [];
  const acts = wf.actions ?? [];
  const rows = Math.max(conds.length, acts.length, 1);
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP;
  const width = CANVAS_W;
  const stackY = (idx: number, count: number) => {
    const block = count * NODE_H + (count - 1) * ROW_GAP;
    return (height - block) / 2 + idx * (NODE_H + ROW_GAP);
  };

  const nodes: Node[] = [];
  conds.forEach((c, i) => nodes.push({
    id: `c${c.id}`, kind: 'trigger', x: colX(0), y: stackY(i, conds.length),
    title: TRIGGER_LABELS[c.type] ?? c.type,
    sub: VALUELESS_TRIGGERS.includes(c.type) ? undefined : c.value,
  }));

  const gateY = (height - NODE_H) / 2;
  nodes.push({
    id: 'gate', kind: 'gate', x: colX(1), y: gateY,
    title: conds.length > 1 ? (wf.conditionLogic === 'or' ? 'לפחות אחד מתקיים' : 'כל התנאים מתקיימים') : 'כאשר',
    sub: conds.length > 1 ? (wf.conditionLogic === 'or' ? 'OR' : 'AND') : undefined,
  });

  acts.forEach((a, i) => nodes.push({
    id: `a${a.id}`, kind: 'action', x: colX(2), y: stackY(i, acts.length),
    title: (ACTION_LABELS[a.type] ?? a.type).replace(/^\S+\s/, ''),
    sub: describeAction(a).replace(/^\S+\s/, '').slice(0, 46),
    auto: runsAutomatically(a.type),
  }));

  // A node the user dragged wins over the computed column. Everything else
  // keeps flowing automatically, so adding a condition to a hand-arranged rule
  // does not require re-arranging the whole board.
  const saved = wf.board ?? {};
  for (const n of nodes) {
    const p2 = saved[n.id];
    if (p2 && Number.isFinite(p2.x) && Number.isFinite(p2.y)) { n.x = p2.x; n.y = p2.y; }
  }

  // Grow the canvas around whatever the nodes ended up covering, so a node
  // dragged past the original bounds is not clipped out of view.
  const spanW = Math.max(width,  ...nodes.map(n => n.x + NODE_W + PAD));
  const spanH = Math.max(height, ...nodes.map(n => n.y + NODE_H + PAD));

  return { nodes, width: spanW, height: spanH, conds, acts };
}

/** Right-to-left elbow connector between two node edges. */
function elbow(from: Node, to: Node): string {
  const x1 = from.x, y1 = from.y + NODE_H / 2;                 // left edge of `from`
  const x2 = to.x + NODE_W, y2 = to.y + NODE_H / 2;            // right edge of `to`
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}

interface Props {
  workflow: Workflow;
  statuses: string[];
  sources: string[];
  templates?: MessageTemplate[];
  onChange?: (wf: Workflow) => void;
  onAskChat?: (prompt: string) => void;
}

export default function AutomationCanvas({ workflow, statuses, sources, templates, onChange, onAskChat }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Live position while dragging. Committed to the workflow on release so a
  // drag is one undoable change rather than a write per mouse-move.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const base = useMemo(() => layout(workflow), [workflow]);
  // Apply the in-flight drag to the node array itself, so the connectors follow
  // the node while it moves instead of snapping only on release.
  const { nodes, width, height, conds, acts } = useMemo(() => {
    if (!drag) return base;
    const nodes2 = base.nodes.map(n => (n.id === drag.id ? { ...n, x: drag.x, y: drag.y } : n));
    return {
      ...base,
      nodes: nodes2,
      width:  Math.max(base.width,  ...nodes2.map(n => n.x + NODE_W + PAD)),
      height: Math.max(base.height, ...nodes2.map(n => n.y + NODE_H + PAD)),
    };
  }, [base, drag]);
  const gate = nodes.find(n => n.id === 'gate')!;
  const editable = Boolean(onChange);

  const patch = (p: Partial<Workflow>) => onChange?.({ ...workflow, ...p });

  const removeCond = (id: string) =>
    patch({ conditions: conds.filter(c => c.id !== id) });
  const removeAct = (id: string) =>
    patch({ actions: acts.filter(a => a.id !== id) });

  const addCond = () => patch({
    conditions: [...conds, { id: `${Date.now()}`, type: 'status_is' as TriggerType, value: statuses[0] ?? '' }],
  });
  const addAct = () => patch({
    actions: [...acts, { id: `${Date.now()}`, type: 'create_task' as WFActionType, config: { description: 'משימה חדשה', priority: 'medium' } }],
  });

  const COLORS: Record<Kind, { line: string; text: string; dot: string }> = {
    trigger: { line: 'rgba(99,102,241,0.55)',  text: 'var(--as-info)', dot: '#6366f1' },
    gate:    { line: 'var(--as-line-2)', text: 'var(--as-text-2)', dot: 'var(--as-text-3)' },
    action:  { line: 'rgba(16,185,129,0.5)',   text: 'var(--as-ok)', dot: '#10b981' },
  };

  /** Client point → SVG user units. The svg is rendered at its natural size, so
   *  this is a straight offset, but it must account for scroll and page zoom. */
  const toSvg = useCallback((e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const sx = (svgRef.current?.width.baseVal.value ?? r.width) / (r.width || 1);
    const sy = (svgRef.current?.height.baseVal.value ?? r.height) / (r.height || 1);
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }, []);

  const startDrag = useCallback((e: React.PointerEvent, n: Node) => {
    if (!onChange) return;                       // read-only board stays static
    const p = toSvg(e);
    setDrag({ id: n.id, x: n.x, y: n.y, dx: p.x - n.x, dy: p.y - n.y });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, [onChange, toSvg]);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const p = toSvg(e);
    // Never let a node go negative: SVG has no negative canvas, so it would be
    // dragged permanently out of reach.
    setDrag(d => (d ? { ...d, x: Math.max(0, p.x - d.dx), y: Math.max(0, p.y - d.dy) } : d));
  }, [drag, toSvg]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!drag || !onChange) return;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    onChange({ ...workflow, board: { ...(workflow.board ?? {}), [drag.id]: { x: Math.round(drag.x), y: Math.round(drag.y) } } });
    setDrag(null);
  }, [drag, onChange, workflow]);

  /** Reset to the automatic layout — an escape hatch from a messy board. */
  const resetBoard = useCallback(() => {
    if (!onChange) return;
    const next = { ...workflow };
    delete next.board;
    onChange(next);
  }, [onChange, workflow]);

  return (
    <div className="space-y-3" dir="rtl">
      {/* Column legend — names the three stages once so the board needs no caption */}
      <div className="flex items-center gap-6 justify-end text-[10px] font-mono tracking-wider"
        style={{ color: 'var(--as-text-3)' }}>
        <span className="flex items-center gap-1.5"><Play size={10} />ACTIONS</span>
        <span className="flex items-center gap-1.5"><GitBranch size={10} />LOGIC</span>
        <span className="flex items-center gap-1.5"><Zap size={10} />TRIGGERS</span>
      </div>

      <div className="overflow-auto rounded-2xl"
        style={{
          background:
            'radial-gradient(circle at 1px 1px, var(--as-line-2) 1px, transparent 0) 0 0 / 22px 22px, var(--as-ground-2)',
          border: '1px solid var(--as-line)',
        }}>
        <svg ref={svgRef} width={width} height={height}
          onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
          style={{ display: 'block', minWidth: '100%', touchAction: drag ? 'none' : undefined }}>
          <defs>
            <marker id="ac-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--as-surf-2)" />
            </marker>
          </defs>

          {/* Conditions → gate */}
          {nodes.filter(n => n.kind === 'trigger').map(n => (
            <path key={`e-${n.id}`} d={elbow(n, gate)} fill="none"
              stroke={COLORS.trigger.line} strokeWidth="1.25" markerEnd="url(#ac-arrow)" />
          ))}
          {/* Gate → actions */}
          {nodes.filter(n => n.kind === 'action').map(n => (
            <path key={`e-${n.id}`} d={elbow(gate, n)} fill="none"
              stroke={COLORS.action.line} strokeWidth="1.25" markerEnd="url(#ac-arrow)" />
          ))}

          {nodes.map(n => {
            const c = COLORS[n.kind];
            const on = sel === n.id;
            return (
              <g key={n.id}
                onClick={() => { if (!drag) setSel(on ? null : n.id); }}
                onPointerDown={e => startDrag(e, n)}
                style={{ cursor: onChange ? (drag?.id === n.id ? 'grabbing' : 'grab') : 'pointer' }}>
                <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx="10"
                  fill={on ? 'var(--as-surf-2)' : 'var(--as-surf)'}
                  stroke={on ? c.dot : 'var(--as-line)'} strokeWidth={on ? 1.5 : 1} />
                <circle cx={n.x + NODE_W - 13} cy={n.y + 13} r="3" fill={c.dot} />
                <text x={n.x + NODE_W - 24} y={n.y + 22} textAnchor="end"
                  fill={c.text} fontSize="12" fontWeight="600"
                  style={{ fontFamily: 'system-ui, sans-serif' }}>
                  {n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title}
                </text>
                {n.sub && (
                  <text x={n.x + NODE_W - 12} y={n.y + 39} textAnchor="end"
                    fill="var(--as-surf-2)" fontSize="10.5"
                    style={{ fontFamily: 'system-ui, sans-serif' }}>
                    {n.sub.length > 30 ? n.sub.slice(0, 29) + '…' : n.sub}
                  </text>
                )}
                {n.kind === 'action' && (
                  <text x={n.x + 12} y={n.y + 39} fill={n.auto ? '#34d399' : 'var(--as-warn)'} fontSize="9"
                    style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {n.auto ? 'AUTO' : 'MANUAL'}
                  </text>
                )}
                {editable && on && n.id !== 'gate' && (
                  <g onClick={e => {
                    e.stopPropagation();
                    n.kind === 'trigger' ? removeCond(n.id.slice(1)) : removeAct(n.id.slice(1));
                    setSel(null);
                  }}>
                    <circle cx={n.x + 13} cy={n.y + 13} r="8" fill="rgba(239,68,68,0.9)" />
                    <path d={`M ${n.x + 9.5} ${n.y + 9.5} L ${n.x + 16.5} ${n.y + 16.5} M ${n.x + 16.5} ${n.y + 9.5} L ${n.x + 9.5} ${n.y + 16.5}`}
                      stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}

          {conds.length === 0 && (
            <text x={colX(0) + NODE_W / 2} y={height / 2} textAnchor="middle"
              fill="var(--as-text-3)" fontSize="11">אין תנאים</text>
          )}
          {acts.length === 0 && (
            <text x={colX(2) + NODE_W / 2} y={height / 2} textAnchor="middle"
              fill="var(--as-text-3)" fontSize="11">אין פעולות</text>
          )}
        </svg>
      </div>

      {editable && (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          {onChange && Object.keys(workflow.board ?? {}).length > 0 && (
            <button onClick={resetBoard} title="החזר את הפריסה האוטומטית"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)', color: 'var(--as-text-2)' }}>
              <RotateCcw size={12} />סדר מחדש
            </button>
          )}
          {onAskChat && (
            <button onClick={() => onAskChat(`שפר את האוטומציה "${workflow.name}" — מה חסר בה?`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.35)', color: 'var(--as-accent)' }}>
              <Hand size={12} />שאל את הבונה
            </button>
          )}
          <button onClick={addAct}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.32)', color: 'var(--as-ok)' }}>
            <Plus size={12} />פעולה
          </button>
          <button onClick={addCond}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
            style={{ background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.35)', color: 'var(--as-info)' }}>
            <Plus size={12} />תנאי
          </button>
          {conds.length > 1 && (
            <button onClick={() => patch({ conditionLogic: workflow.conditionLogic === 'or' ? 'and' : 'or' })}
              className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold"
              style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)', color: 'var(--as-text-2)' }}>
              {workflow.conditionLogic === 'or' ? 'OR' : 'AND'}
            </button>
          )}
        </div>
      )}

      {/* Inline editor for whatever node is selected */}
      {editable && sel && sel !== 'gate' && (
        <NodeEditor
          workflow={workflow} selId={sel} statuses={statuses} sources={sources}
          templates={templates}
          onChange={onChange!} onClose={() => setSel(null)} />
      )}
    </div>
  );
}

/* ── Editing the selected node ─────────────────────────────────────────────── */
function NodeEditor({ workflow, selId, statuses, sources, templates, onChange, onClose }: {
  workflow: Workflow; selId: string; statuses: string[]; sources: string[];
  templates?: MessageTemplate[];
  onChange: (wf: Workflow) => void; onClose: () => void;
}) {
  const isCond = selId.startsWith('c');
  const rawId = selId.slice(1);
  const cond = (workflow.conditions ?? []).find(c => c.id === rawId);
  const act  = (workflow.actions ?? []).find(a => a.id === rawId);
  if (!cond && !act) return null;

  const inp: React.CSSProperties = {
    background: 'var(--as-surf)', border: '1px solid var(--as-line)',
    color: 'var(--as-text)', borderRadius: 8, padding: '7px 9px', fontSize: 12, width: '100%',
  };

  const setCond = (p: Partial<WorkflowCondition>) => onChange({
    ...workflow,
    conditions: (workflow.conditions ?? []).map(c => (c.id === rawId ? { ...c, ...p } : c)),
  });
  const setAct = (p: Partial<WorkflowAction>) => onChange({
    ...workflow,
    actions: (workflow.actions ?? []).map(a => (a.id === rawId ? { ...a, ...p } : a)),
  });

  return (
    <div className="rounded-xl p-3.5 space-y-2.5"
      style={{ background: 'var(--as-surf)', border: '1px solid var(--as-line)' }}>
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--as-text-3)' }}>
          <X size={13} />
        </button>
        <span className="text-[11px] font-mono tracking-wider" style={{ color: 'var(--as-text-2)' }}>
          {isCond ? 'EDIT TRIGGER' : 'EDIT ACTION'}
        </span>
      </div>

      {cond && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={cond.type} onChange={e => setCond({ type: e.target.value as TriggerType, value: '' })} style={inp}>
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map(t => (
              <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
            ))}
          </select>
          {!VALUELESS_TRIGGERS.includes(cond.type) && (
            cond.type === 'status_is' || cond.type === 'status_is_not' ? (
              <select value={cond.value} onChange={e => setCond({ value: e.target.value })} style={inp}>
                <option value="">בחר סטטוס</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : cond.type === 'source_is' ? (
              <select value={cond.value} onChange={e => setCond({ value: e.target.value })} style={inp}>
                <option value="">בחר מקור</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input value={cond.value} onChange={e => setCond({ value: e.target.value })}
                placeholder="ערך" style={inp} />
            )
          )}
          <p className="col-span-full text-[11px] text-right" style={{ color: 'var(--as-text-2)' }}>
            {describeCondition(cond)}
          </p>
        </div>
      )}

      {act && (
        <div className="space-y-2">
          <select value={act.type} onChange={e => setAct({ type: e.target.value as WFActionType, config: {} })} style={inp}>
            {(Object.keys(ACTION_LABELS) as WFActionType[]).map(t => (
              <option key={t} value={t}>{ACTION_LABELS[t]}</option>
            ))}
          </select>
          {SEND_ACTIONS[act.type] && (() => {
            const channel = SEND_ACTIONS[act.type];
            const mine = (templates ?? []).filter(t => t.channel === channel);
            return (
              <>
                <select value={act.config?.templateId ?? ''}
                  onChange={e => setAct({ config: { ...act.config, templateId: e.target.value } })}
                  style={inp}>
                  <option value="">בחר תבנית…</option>
                  {mine.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {mine.length === 0 && (
                  <p className="text-[10.5px] text-right" style={{ color: 'var(--as-warn)' }}>
                    אין עדיין תבניות {channel === 'email' ? 'מייל' : 'וואטסאפ'} — צור אחת בלשונית התבניות.
                  </p>
                )}
                {!act.config?.templateId && mine.length > 0 && (
                  <p className="text-[10.5px] text-right" style={{ color: 'var(--as-warn)' }}>
                    בלי תבניות נבחרת הפעולה הזו לא תישלח.
                  </p>
                )}
                <p className="text-[10.5px] text-right" style={{ color: 'var(--as-text-2)' }}>
                  {channel === 'email'
                    ? 'המייל יישלח אוטומטית, פעם אחת בלבד לכל ליד בכלל הזה.'
                    : 'וואטסאפ לא נשלח לבד — המערכת תכין לך את ההודעה ואתה תלחץ שליחה.'}
                </p>
              </>
            );
          })()}
          {!SAFE_ACTIONS.includes(act.type) && !SEND_ACTIONS[act.type] && (
            <p className="text-[10.5px] text-right" style={{ color: 'var(--as-warn)' }}>
              פעולה זו לא רצה אוטומטית — היא תמתין לאישור שלך.
            </p>
          )}
          <p className="text-[11px] text-right" style={{ color: 'var(--as-text-2)' }}>{describeAction(act)}</p>
        </div>
      )}
    </div>
  );
}
