/**
 * newWorkspaceLead.js — every new RAY signup becomes a lead in RAY Staging.
 *
 * When a customer creates a workspace, that is a sales event: someone just
 * self-served into the product. This drops them straight into the admin's own
 * pipeline as an "הזדמנויות" lead, so signups are worked like any other lead
 * instead of being noticed by chance in the admin console.
 *
 * WHY A SERVER TRIGGER, not client code in the signup flow:
 * the person signing up is not a member of RAY Staging, and the Firestore rules
 * (correctly) refuse cross-workspace writes. A client attempt would just fail.
 * The Admin SDK runs above the rules, so the trigger is the only honest place
 * for this.
 *
 * Idempotent: the lead id is derived from the workspace id, so a retry or a
 * duplicate trigger delivery overwrites the same document instead of piling up
 * duplicates. Firestore triggers are at-least-once, so this matters.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

/** Admin/staging workspaces must not create leads about themselves. */
const isInternalWorkspace = (wid, data) =>
  String(wid).startsWith('admin_') || data?.isAdminWorkspace === true;

exports.onWorkspaceCreated = onDocumentCreated(
  { document: 'workspaces/{wid}', region: 'us-central1' },
  async (event) => {
    const wid = event.params.wid;
    const ws = event.data?.data();
    if (!ws) return;
    if (isInternalWorkspace(wid, ws)) {
      console.log(`onWorkspaceCreated: skipping internal workspace ${wid}`);
      return;
    }

    const db = admin.firestore();

    // Find the RAY Staging workspace — it is whichever admin_* workspace exists.
    // Looked up rather than hard-coded so this keeps working if the superadmin
    // account (and therefore the id) ever changes.
    let stagingId = null;
    try {
      const snap = await db.collection('workspaces')
        .where('isAdminWorkspace', '==', true).limit(1).get();
      if (!snap.empty) stagingId = snap.docs[0].id;
    } catch (err) {
      console.error('onWorkspaceCreated: staging lookup failed', err);
    }
    if (!stagingId) {
      console.warn('onWorkspaceCreated: no admin workspace found — nothing to do');
      return;
    }

    const now = new Date();
    const he = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;

    // Deterministic id → safe under at-least-once delivery.
    const leadId = `signup_${wid}`;

    const lead = {
      id: leadId,
      company: ws.name || 'סביבה חדשה',
      contactName: ws.ownerName || ws.name || '',
      email: ws.email || '',
      phone: ws.phone || '',
      status: 'הזדמנויות',
      budget: 0,
      source: 'הרשמה עצמית',
      assignedTo: '',
      lastUpdate: he,
      createdAt: now.getTime(),
      aiScore: 0,
      solutions: [],
      notes: [{
        id: `${now.getTime()}-signup`,
        text: `נרשמה סביבה חדשה: ${ws.name || wid}`
          + (ws.industry ? ` · ענף: ${ws.industry}` : '')
          + (ws.plan ? ` · תוכנית: ${ws.plan}` : ''),
        author: 'מערכת',
        timestamp: now.toISOString(),
      }],
      tasks: [],
      futureNotes: [],
      waitingContent: false,
      activityLog: [{
        id: `${now.getTime()}-act`,
        type: 'note',
        content: 'ליד נוצר אוטומטית מהרשמה חדשה למערכת',
        author: 'מערכת',
        timestamp: now.toISOString(),
      }],
    };

    try {
      await db.collection('workspaces').doc(stagingId)
        .collection('leads').doc(leadId).set(lead, { merge: true });
      console.log(`onWorkspaceCreated: lead ${leadId} added to ${stagingId} for "${ws.name}"`);
    } catch (err) {
      console.error('onWorkspaceCreated: failed to write lead', err);
    }
  },
);
