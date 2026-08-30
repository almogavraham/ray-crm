/**
 * automationEngine.ts — shared CRM automation logic.
 *
 * One place that knows how to (a) decide whether a lead matches a workflow and
 * (b) apply the "safe" actions of that workflow to a lead. Both the manual
 * runner in the automations UI and the event-driven auto-run in App.tsx use
 * this, so a rule always behaves identically no matter what triggered it.
 *
 * SAFE actions = pure local data changes that are cheap and reversible
 * (status, colour flag, hot flag, note, follow-up date, task). Actions with
 * real-world side effects or token cost — AI WhatsApp/email drafts and webhooks —
 * are deliberately NOT auto-applied; those still run only from an explicit
 * user action.
 *
 * Loop safety: `applySafeActions` returns `null` when nothing would actually
 * change, so an automation that has already been applied to a lead can never
 * retrigger itself on the resulting update.
 */

import type { Lead, Task, TaskPriority } from '../types';

export type TriggerType =
  | 'days_inactive' | 'status_is' | 'score_above' | 'score_below' | 'budget_above' | 'source_is' | 'has_overdue_task'
  | 'status_is_not' | 'budget_below' | 'is_hot' | 'is_not_hot' | 'days_since_created'
  | 'never_contacted' | 'followup_overdue' | 'has_no_open_tasks' | 'assigned_to_is'
  | 'has_objection' | 'has_solution' | 'missing_email' | 'missing_phone'
  | 'no_answer_count_gte' | 'hours_since_no_answer' | 'hours_since_last_contact'
  | 'hours_since_created' | 'flag_color_is' | 'has_no_flag'
  | 'was_contacted' | 'contact_method_is';

export type WFActionType =
  | 'create_task' | 'change_status' | 'send_whatsapp_ai' | 'send_email_ai' | 'add_note' | 'assign_to' | 'send_webhook'
  | 'mark_hot' | 'unmark_hot' | 'set_followup'
  | 'set_flag_color' | 'clear_flag_color'
  // Template sends: the same reviewed wording every time. Preferred over the
  // AI variants whenever the message does not need to differ per lead.
  | 'send_email_template' | 'send_whatsapp_template';

export interface WorkflowCondition { id: string; type: TriggerType; value: string; }
export interface WorkflowAction    { id: string; type: WFActionType; config: Record<string, string>; }
export interface Workflow {
  id: string; name: string; description?: string; active: boolean;
  conditionLogic: 'and' | 'or';
  conditions: WorkflowCondition[];
  actions:    WorkflowAction[];
  createdAt: string; runCount: number; lastRunAt?: string;
  /** When true the rule is applied the moment a lead changes, with no approval step. */
  autoRun?: boolean;
}

/**
 * A message an automation wants sent. Sends are deliberately NOT part of
 * `applySafeActions`: that function is pure and returns a lead, while sending
 * is async, leaves the system, and must be de-duplicated. Keeping them on
 * separate tracks is what stops a resend from riding along with a field edit.
 */
export interface PendingSend {
  workflowId: string;
  workflowName: string;
  channel: 'email' | 'whatsapp';
  templateId: string;
}

/** Template-send action types, mapped to the channel they go out on. */
export const SEND_ACTIONS: Record<string, 'email' | 'whatsapp'> = {
  send_email_template:    'email',
  send_whatsapp_template: 'whatsapp',
};

/** Actions applied automatically on lead-change events. */
export const SAFE_ACTIONS: WFActionType[] = [
  'change_status', 'set_flag_color', 'clear_flag_color',
  'mark_hot', 'unmark_hot', 'set_followup', 'add_note', 'create_task', 'assign_to',
];

/**
 * Does this action complete without a human? The single source of truth for
 * every AUTO / MANUAL badge in the UI. Email templates do go out on their own;
 * WhatsApp cannot — there is no unattended WhatsApp API here, so it is only
 * ever prepared for someone to send. Deriving the badge from `SAFE_ACTIONS`
 * alone labelled auto-sending email as manual, which is worse than no badge:
 * it tells the customer nothing will leave the system when something will.
 */
export function runsAutomatically(type: WFActionType): boolean {
  return SAFE_ACTIONS.includes(type) || SEND_ACTIONS[type] === 'email';
}

/* ══════════════════════════════════════════════════════════════════════════
   Canonical vocabulary — the single source of truth for the form builder,
   the AI chat and the server scanner. Keeping it here is what stops the UI
   and the AI prompt from drifting apart.
   ══════════════════════════════════════════════════════════════════════════ */
export const TRIGGER_LABELS: Record<TriggerType, string> = {
  days_inactive:    'ימים ללא עדכון ≥',
  status_is:        'סטטוס הוא',
  status_is_not:    'סטטוס אינו',
  score_above:      'ציון AI מעל',
  score_below:      'ציון AI מתחת ל-',
  budget_above:     'תקציב מעל ₪',
  budget_below:     'תקציב מתחת ל-₪',
  source_is:        'מקור הוא',
  has_overdue_task: 'יש משימה באיחור',
  is_hot:           'מסומן כליד חם 🔥',
  is_not_hot:       'לא מסומן כחם',
  days_since_created: 'ימים מאז נוצר ≥',
  never_contacted:  'מעולם לא נוצר קשר',
  followup_overdue: 'מעקב מתוכנן שעבר זמנו',
  has_no_open_tasks:'אין משימות פתוחות',
  assigned_to_is:   'משויך ל-',
  has_objection:    'יש התנגדות רשומה',
  has_solution:     'כולל פתרון/מוצר',
  missing_email:    'חסר אימייל',
  missing_phone:    'חסר טלפון',
  no_answer_count_gte:      'לא ענה ≥ X פעמים 📵',
  hours_since_no_answer:    'שעות מאז שלא ענה ≥',
  hours_since_last_contact: 'שעות מאז יצירת קשר ≥',
  hours_since_created:      'שעות מאז שנוצר ≥',
  flag_color_is:            'צבע סימון הוא',
  has_no_flag:              'ללא צבע סימון',
  was_contacted:            'תועדה פנייה ללקוח ✅',
  contact_method_is:        'הפנייה האחרונה הייתה',
};

export const ACTION_LABELS: Record<WFActionType, string> = {
  create_task:      '📋 צור משימה',
  change_status:    '🔄 שנה סטטוס',
  send_whatsapp_ai: '💬 שלח WhatsApp (AI)',
  send_email_ai:    '📧 שלח מייל (AI)',
  add_note:         '📝 הוסף הערה',
  assign_to:        '👤 שייך לאיש צוות',
  send_webhook:     '🔗 שלח Webhook',
  mark_hot:         '🔥 סמן כליד חם',
  unmark_hot:       '❄️ הסר סימון חם',
  set_followup:     '📅 קבע מעקב בעוד X ימים',
  set_flag_color:   '🎨 צבע את הליד',
  clear_flag_color: '⬜ הסר צבע',
  send_email_template:    '📧 שלח מייל מתבנית',
  send_whatsapp_template: '💬 שלח WhatsApp מתבנית',
};

/** Triggers that take no value (pure boolean checks). */
export const VALUELESS_TRIGGERS: TriggerType[] = [
  'has_overdue_task', 'is_hot', 'is_not_hot', 'never_contacted',
  'followup_overdue', 'has_no_open_tasks', 'has_objection', 'missing_email', 'missing_phone',
  'has_no_flag', 'was_contacted',
];

export const FLAG_COLORS: { value: string; label: string }[] = [
  { value: '#ef4444', label: '🔴 אדום' },
  { value: '#f59e0b', label: '🟠 כתום' },
  { value: '#eab308', label: '🟡 צהוב' },
  { value: '#10b981', label: '🟢 ירוק' },
  { value: '#3b82f6', label: '🔵 כחול' },
  { value: '#8b5cf6', label: '🟣 סגול' },
];

export const CONTACT_METHODS: { value: string; label: string }[] = [
  { value: 'phone',     label: '📞 טלפון' },
  { value: 'email',     label: '✉️ מייל' },
  { value: 'whatsapp',  label: '💬 וואטסאפ' },
  { value: 'in_person', label: '🤝 פנים-אל-פנים' },
  { value: 'meeting',   label: '📅 פגישה נקבעה' },
  { value: 'quote',     label: '📄 הצעת מחיר' },
  { value: 'no_answer', label: '📵 לא ענה' },
];

/** Human-readable one-line summary of a condition — used in previews. */
export function describeCondition(c: WorkflowCondition): string {
  const label = TRIGGER_LABELS[c.type] ?? c.type;
  if (VALUELESS_TRIGGERS.includes(c.type)) return label;
  if (c.type === 'flag_color_is')     return `${label} ${FLAG_COLORS.find(f => f.value === c.value)?.label ?? c.value}`;
  if (c.type === 'contact_method_is') return `${label} ${CONTACT_METHODS.find(m => m.value === c.value)?.label ?? c.value}`;
  return `${label} ${c.value}`;
}

/** Human-readable one-line summary of an action — used in previews. */
export function describeAction(a: WorkflowAction): string {
  const label = ACTION_LABELS[a.type] ?? a.type;
  const cfg = a.config ?? {};
  switch (a.type) {
    case 'change_status':   return `${label} → ${cfg.status ?? '?'}`;
    case 'set_flag_color':  return `${label} ${FLAG_COLORS.find(f => f.value === cfg.color)?.label ?? cfg.color ?? ''}`;
    case 'set_followup':    return `${label.replace('X', cfg.days ?? '7')}`;
    case 'assign_to':       return `${label} ${cfg.assignee ?? ''}`;
    case 'create_task':     return `${label}: ${cfg.description ?? ''}`;
    case 'add_note':        return `${label}: ${cfg.noteText ?? ''}`;
    default:                return label;
  }
}

/* ── Date helpers ─────────────────────────────────────────────────────────── */
function parseDateLoose(s?: string): number {
  if (!s) return 0;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const t = new Date(str.slice(0, 10) + 'T00:00:00').getTime();
    return isNaN(t) ? 0 : t;
  }
  if (/^\d{10,}$/.test(str)) return Number(str);
  const sep = str.includes('/') ? '/' : '.';
  const p = str.split(sep);
  if (p.length !== 3) { const t = Date.parse(str); return isNaN(t) ? 0 : t; }
  const [d, m, yRaw] = p.map(Number);
  if (!d || !m || !yRaw) return 0;
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  const t = new Date(y, m - 1, d).getTime();
  return isNaN(t) ? 0 : t;
}

function daysSinceUpdate(lead: Lead): number {
  const t = parseDateLoose(lead.lastUpdate) || (lead.createdAt ?? 0);
  if (!t) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/* ── Condition evaluation ─────────────────────────────────────────────────── */
export function evalCondition(lead: Lead, c: WorkflowCondition): boolean {
  const n = () => parseInt(c.value, 10);
  switch (c.type) {
    case 'days_inactive':     return daysSinceUpdate(lead) >= n();
    case 'status_is':         return lead.status === c.value;
    case 'status_is_not':     return lead.status !== c.value;
    case 'score_above':       return (lead.aiScore ?? 0) > n();
    case 'score_below':       return (lead.aiScore ?? 0) < n();
    case 'budget_above':      return (lead.budget ?? 0) > n();
    case 'budget_below':      return (lead.budget ?? 0) < n();
    case 'source_is':         return lead.source === c.value;
    case 'has_overdue_task': {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      return (lead.tasks ?? []).some(tk => {
        if (tk.completed) return false;
        try { return new Date(tk.date + 'T00:00:00') < t; } catch { return false; }
      });
    }
    case 'is_hot':            return Boolean(lead.isHot);
    case 'is_not_hot':        return !lead.isHot;
    case 'days_since_created':
      return lead.createdAt ? (Date.now() - lead.createdAt) / 86_400_000 >= n() : false;
    case 'never_contacted':   return !lead.lastContactDate;
    case 'was_contacted':     return Boolean(lead.lastContactDate);
    case 'contact_method_is': return lead.contactMethod === c.value;
    case 'followup_overdue': {
      if (!lead.nextFollowUpDate) return false;
      const t = Date.parse(lead.nextFollowUpDate);
      return isNaN(t) ? false : t < Date.now();
    }
    case 'has_no_open_tasks': return !(lead.tasks ?? []).some(tk => !tk.completed);
    case 'assigned_to_is':    return lead.assignedTo === c.value;
    case 'has_objection':     return Boolean(lead.objection);
    case 'has_solution':      return (lead.solutions ?? []).some(s => s.name === c.value);
    case 'missing_email':     return !lead.email?.trim();
    case 'missing_phone':     return !lead.phone?.trim();
    case 'no_answer_count_gte': return (lead.noAnswerCount ?? 0) >= n();
    case 'hours_since_no_answer': {
      const t = Date.parse(lead.lastNoAnswerAt ?? '');
      return isNaN(t) ? false : (Date.now() - t) / 3_600_000 >= n();
    }
    case 'hours_since_last_contact': {
      const t = Date.parse(lead.lastContactDate ?? '');
      return isNaN(t) ? false : (Date.now() - t) / 3_600_000 >= n();
    }
    case 'hours_since_created':
      return lead.createdAt ? (Date.now() - lead.createdAt) / 3_600_000 >= n() : false;
    case 'flag_color_is':     return lead.flagColor === c.value;
    case 'has_no_flag':       return !lead.flagColor;
    default:                  return false;
  }
}

export function matchesWorkflow(lead: Lead, wf: Workflow): boolean {
  const conds = wf.conditions ?? [];
  if (!conds.length) return false;                     // an empty rule never matches
  const results = conds.map(c => evalCondition(lead, c));
  return wf.conditionLogic === 'or' ? results.some(Boolean) : results.every(Boolean);
}

const fill = (tpl: string, lead: Lead) =>
  (tpl || '').replace(/\{company\}/g, lead.company ?? '').replace(/\{name\}/g, lead.contactName ?? '');

/**
 * Apply a workflow's safe actions to a lead.
 * @returns the updated lead, or `null` when nothing would change (which is also
 *          what stops an automation from re-triggering on its own output).
 */
export function applySafeActions(lead: Lead, wf: Workflow, currentUser = ''): Lead | null {
  let next: Lead = lead;
  let changed = false;

  for (const action of wf.actions ?? []) {
    if (!SAFE_ACTIONS.includes(action.type)) continue;   // AI / webhooks stay manual
    const cfg = action.config ?? {};

    switch (action.type) {
      case 'change_status': {
        if (cfg.status && next.status !== cfg.status) {
          next = { ...next, status: cfg.status, lastUpdate: new Date().toLocaleDateString('he-IL') };
          changed = true;
        }
        break;
      }
      case 'set_flag_color': {
        const color = cfg.color || '#ef4444';
        if (next.flagColor !== color) {
          next = { ...next, flagColor: color, flagReason: cfg.reason || wf.name };
          changed = true;
        }
        break;
      }
      case 'clear_flag_color': {
        if (next.flagColor) { next = { ...next, flagColor: '', flagReason: '' }; changed = true; }
        break;
      }
      case 'mark_hot': {
        if (!next.isHot) { next = { ...next, isHot: true }; changed = true; }
        break;
      }
      case 'unmark_hot': {
        if (next.isHot) { next = { ...next, isHot: false }; changed = true; }
        break;
      }
      case 'assign_to': {
        const who = cfg.assignee || currentUser;
        if (who && next.assignedTo !== who) { next = { ...next, assignedTo: who }; changed = true; }
        break;
      }
      case 'set_followup': {
        const days = parseInt(cfg.days || '7') || 7;
        const d = new Date(); d.setDate(d.getDate() + days);
        const iso = d.toISOString();
        // Only rewrite when there's no follow-up yet or the existing one already passed,
        // so re-evaluation doesn't keep pushing the date forward forever.
        const cur = next.nextFollowUpDate ? Date.parse(next.nextFollowUpDate) : 0;
        if (!cur || cur < Date.now()) { next = { ...next, nextFollowUpDate: iso }; changed = true; }
        break;
      }
      case 'add_note': {
        const text = fill(cfg.noteText, next);
        // Skip if this automation already left this exact note.
        const exists = (next.notes ?? []).some(nt => nt.text === text);
        if (text && !exists) {
          next = { ...next, notes: [...(next.notes ?? []), {
            id: `${Date.now()}-auto`, text, author: 'אוטומציה', timestamp: new Date().toISOString(),
          }] };
          changed = true;
        }
        break;
      }
      case 'create_task': {
        const desc = fill(cfg.description || 'מעקב — {company}', next);
        const openSame = (next.tasks ?? []).some(t => !t.completed && t.description === desc);
        if (desc && !openSame) {
          const task: Task = {
            id: `${Date.now()}-auto`,
            description: desc,
            date: new Date().toISOString().split('T')[0],
            time: '09:00',
            completed: false,
            priority: (cfg.priority || 'medium') as TaskPriority,
            assignedTo: next.assignedTo || currentUser,
            assignedBy: 'אוטומציה',
          };
          next = { ...next, tasks: [...(next.tasks ?? []), task] };
          changed = true;
        }
        break;
      }
    }
  }

  return changed ? next : null;
}

/**
 * Run every eligible auto-run workflow against a lead.
 * @returns the updated lead plus the names of the rules that fired, or null.
 */
export function runAutoWorkflows(lead: Lead, workflows: Workflow[], currentUser = ''):
  { lead: Lead; applied: string[]; sends: PendingSend[] } | null {
  let current = lead;
  const applied: string[] = [];
  const sends: PendingSend[] = [];

  for (const wf of workflows) {
    if (!wf.active || wf.autoRun === false) continue;
    if (!matchesWorkflow(current, wf)) continue;

    const updated = applySafeActions(current, wf, currentUser);
    if (updated) { current = updated; applied.push(wf.name); }

    // Collected even when no field changed: a rule whose only action is "send
    // the follow-up template" changes nothing on the lead, and gating sends on
    // `updated` would silently drop exactly those rules.
    for (const a of wf.actions ?? []) {
      const channel = SEND_ACTIONS[a.type];
      const templateId = a.config?.templateId;
      if (!channel || !templateId) continue;
      sends.push({ workflowId: wf.id, workflowName: wf.name, channel, templateId });
    }
  }
  return (applied.length || sends.length) ? { lead: current, applied, sends } : null;
}
