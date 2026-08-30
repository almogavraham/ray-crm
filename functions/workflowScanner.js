/**
 * workflowScanner.js — background detection for CRM automations ("אוטומציות").
 *
 * Runs on a schedule and, for every workspace, evaluates each ACTIVE workflow
 * against that workspace's leads. When a workflow matches leads it does NOT
 * mutate anything — it files a *pending approval* record and notifies the user.
 * The actual actions (status changes, tasks, AI drafts, …) are executed from the
 * client only after the user approves, so the system never silently rewrites
 * real CRM data on its own.
 *
 * Detection therefore works 24/7 even with the app closed, while every
 * data-changing step stays behind an explicit human decision.
 *
 * Match logic here MUST mirror `matches()` in src/pages/Agents.tsx.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

/* ── Date helpers — mirror parseDateHE/daysSinceUpdate on the client ──────── */
function parseDateHE(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{10,}$/.test(dateStr)) {
    const d = new Date(Number(dateStr));
    return isNaN(d.getTime()) ? null : d;
  }
  const sep = dateStr.includes('/') ? '/' : '.';
  const parts = String(dateStr).split(sep);
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year) return null;
  const d = new Date(year < 100 ? 2000 + year : year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function daysSinceUpdate(lead) {
  const date = parseDateHE(lead.lastUpdate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (date) return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86400000));
  if (lead.createdAt) {
    const t = typeof lead.createdAt === 'number' ? lead.createdAt : Date.parse(lead.createdAt);
    if (!isNaN(t)) return Math.max(0, Math.floor((today.getTime() - t) / 86400000));
  }
  return 0;
}

/* ── Condition evaluation — keep in sync with the client ──────────────────── */
function evalCondition(lead, c) {
  const num = () => parseInt(c.value, 10);
  switch (c.type) {
    case 'days_inactive':     return daysSinceUpdate(lead) >= num();
    case 'status_is':         return lead.status === c.value;
    case 'status_is_not':     return lead.status !== c.value;
    case 'score_above':       return (lead.aiScore || 0) > num();
    case 'score_below':       return (lead.aiScore || 0) < num();
    case 'budget_above':      return (lead.budget || 0) > num();
    case 'budget_below':      return (lead.budget || 0) < num();
    case 'source_is':         return lead.source === c.value;
    case 'has_overdue_task': {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      return (lead.tasks || []).some(tk => {
        if (tk.completed) return false;
        try { return new Date(tk.date + 'T00:00:00') < t; } catch { return false; }
      });
    }
    case 'is_hot':            return Boolean(lead.isHot);
    case 'is_not_hot':        return !lead.isHot;
    case 'days_since_created': {
      if (!lead.createdAt) return false;
      const t = typeof lead.createdAt === 'number' ? lead.createdAt : Date.parse(lead.createdAt);
      if (isNaN(t)) return false;
      return (Date.now() - t) / 86400000 >= num();
    }
    case 'never_contacted':   return !lead.lastContactDate;
    case 'followup_overdue': {
      if (!lead.nextFollowUpDate) return false;
      try { return new Date(lead.nextFollowUpDate) < new Date(); } catch { return false; }
    }
    case 'has_no_open_tasks': return !(lead.tasks || []).some(tk => !tk.completed);
    case 'assigned_to_is':    return lead.assignedTo === c.value;
    case 'has_objection':     return Boolean(lead.objection);
    case 'has_solution':      return (lead.solutions || []).some(s => s.name === c.value);
    case 'missing_email':     return !String(lead.email || '').trim();
    case 'missing_phone':     return !String(lead.phone || '').trim();
    case 'no_answer_count_gte': return (lead.noAnswerCount || 0) >= num();
    case 'hours_since_no_answer': {
      if (!lead.lastNoAnswerAt) return false;
      const t = Date.parse(lead.lastNoAnswerAt);
      return isNaN(t) ? false : (Date.now() - t) / 3600000 >= num();
    }
    case 'hours_since_last_contact': {
      if (!lead.lastContactDate) return false;
      const t = Date.parse(lead.lastContactDate);
      return isNaN(t) ? false : (Date.now() - t) / 3600000 >= num();
    }
    case 'hours_since_created': {
      if (!lead.createdAt) return false;
      const t = typeof lead.createdAt === 'number' ? lead.createdAt : Date.parse(lead.createdAt);
      return isNaN(t) ? false : (Date.now() - t) / 3600000 >= num();
    }
    case 'flag_color_is':     return lead.flagColor === c.value;
    case 'has_no_flag':       return !lead.flagColor;
    default:                  return false;
  }
}

function matches(lead, wf) {
  const conditions = wf.conditions || [];
  if (!conditions.length) return false;              // never match on an empty rule
  const results = conditions.map(c => evalCondition(lead, c));
  return wf.conditionLogic === 'or' ? results.some(Boolean) : results.every(Boolean);
}

/* ── Notification (same path the client reads: workspaces/{wid}/notifications) ── */
async function notify(db, wid, n) {
  try {
    await db.collection('workspaces').doc(wid).collection('notifications').doc().set({
      ...n, read: false, createdAt: Date.now(),
    });
  } catch (e) { console.error('[workflowScanner notify]', e); }
}

/* ── Scan one workspace ───────────────────────────────────────────────────── */
async function scanWorkspace(db, wid) {
  const wfSnap = await db.collection(`workspaces/${wid}/workflows`).where('active', '==', true).get();
  if (wfSnap.empty) return 0;

  // Only pay for the leads read when this workspace actually has active rules.
  const leadsSnap = await db.collection(`workspaces/${wid}/leads`).get();
  if (leadsSnap.empty) return 0;
  const leads = leadsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const runsCol = db.collection(`workspaces/${wid}/workflowRuns`);
  let created = 0;

  for (const wfDoc of wfSnap.docs) {
    const wf = wfDoc.data();
    try {
      const matched = leads.filter(l => matches(l, wf));
      if (!matched.length) continue;

      // Don't pile up duplicates: one open request per workflow at a time.
      const existing = await runsCol
        .where('workflowId', '==', wf.id)
        .where('status', '==', 'pending_approval')
        .limit(1).get();
      if (!existing.empty) continue;

      const runRef = runsCol.doc();
      await runRef.set({
        id: runRef.id,
        workflowId: wf.id,
        workflowName: wf.name || 'אוטומציה',
        status: 'pending_approval',
        leadIds: matched.map(l => l.id),
        leadNames: matched.slice(0, 5).map(l => l.company || l.contactName || ''),
        matchCount: matched.length,
        createdAt: Date.now(),
      });
      created++;

      await notify(db, wid, {
        type: 'info',
        title: `⚡ אוטומציה "${wf.name}" מצאה ${matched.length} לידים`,
        body: 'האוטומציה ממתינה לאישורך כדי לרוץ. פתח את דף האוטומציות לאישור.',
        link: 'workflows',
      });
    } catch (err) {
      console.error(`[workflowScanner] ${wid}/${wf.id} failed`, err);
    }
  }
  return created;
}

/* ── The scheduled function ───────────────────────────────────────────────── */
exports.workflowScanner = onSchedule(
  { schedule: 'every 30 minutes', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore();
    let wsSnap;
    try {
      wsSnap = await db.collection('workspaces').get();
    } catch (err) {
      console.error('[workflowScanner] workspace query failed', err);
      return;
    }

    let totalCreated = 0;
    for (const wsDoc of wsSnap.docs) {
      try {
        totalCreated += await scanWorkspace(db, wsDoc.id);
      } catch (err) {
        console.error(`[workflowScanner] workspace ${wsDoc.id} failed`, err);
      }
    }
    console.log(`[workflowScanner] scanned ${wsSnap.size} workspace(s), ${totalCreated} approval request(s) created`);
  }
);
