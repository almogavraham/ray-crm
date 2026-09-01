/**
 * webhooks.js — telling other systems when something happens here.
 *
 * The REST API lets a customer's software ask what is in their CRM. It gives
 * them no way to find out that a lead just arrived without asking repeatedly,
 * which is the thing most integrations actually want. Polling every minute is
 * both slow and wasteful; this pushes instead.
 *
 * Events: lead.created, lead.updated, task.created.
 *
 * Decisions worth stating:
 *
 * **Deliveries are signed.** Each carries an HMAC-SHA256 of the exact body,
 * keyed with the endpoint's own secret, so the receiver can prove the call came
 * from us. Without it their endpoint is a public URL that anything can POST an
 * invented lead to — the same hole we closed on our own payment webhook.
 *
 * **A failed delivery never fails the write.** These run on Firestore triggers.
 * Throwing would make the trigger retry, so a customer's broken endpoint would
 * re-run the handler against the same document indefinitely. Failures are
 * recorded and swallowed.
 *
 * **A dead endpoint gets switched off.** After 15 consecutive failures it is
 * disabled rather than retried forever — the same threshold our own payment
 * provider applies to us, and for the same reason.
 *
 * **The payload is the API's own shape.** Events reuse the serialisers the REST
 * endpoints use, so `lead.created` carries exactly what `GET /v1/leads/{id}`
 * returns. Two shapes for one object means integrators write two parsers.
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { leadOut, taskOut } = require('./publicApi');

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

const EVENTS = ['lead.created', 'lead.updated', 'task.created'];

/** Consecutive failures before an endpoint is switched off. */
const FAILURE_LIMIT = 15;

/** A receiver that cannot answer in this long is treated as failed. */
const TIMEOUT_MS = 10_000;

/* ── Sending ─────────────────────────────────────────────────────────────── */

/**
 * Deliver one event to every endpoint in a workspace subscribed to it.
 *
 * Never throws: the caller is a Firestore trigger, and a rejected promise there
 * means the trigger runs again on the same document.
 */
async function dispatch(workspaceId, event, data) {
  const db = admin.firestore();

  let endpoints;
  try {
    const snap = await db.collection('webhookEndpoints')
      .where('workspaceId', '==', workspaceId)
      .where('active', '==', true)
      .get();
    endpoints = snap.docs.filter(d => (d.data().events ?? []).includes(event));
  } catch (err) {
    console.error('[webhooks] could not read endpoints', err);
    return;
  }
  if (!endpoints.length) return;

  const body = JSON.stringify({
    id: `evt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    event,
    created_at: new Date().toISOString(),
    workspace_id: workspaceId,
    data,
  });

  await Promise.all(endpoints.map(async (doc) => {
    const ep = doc.data();
    const signature = crypto.createHmac('sha256', ep.secret).update(body).digest('hex');

    // Without an explicit abort, a receiver that accepts the connection and
    // never answers holds this function open until the platform kills it.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ray-Event': event,
          'X-Ray-Signature': signature,
          'User-Agent': 'RAY CRM Webhooks/1.0',
        },
        body,
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await doc.ref.update({
        lastDeliveryAt: new Date().toISOString(),
        lastError: null,
        consecutiveFailures: 0,
      });
    } catch (err) {
      const failures = (ep.consecutiveFailures ?? 0) + 1;
      const reason = abort.signal.aborted ? `timeout after ${TIMEOUT_MS}ms` : String(err.message ?? err);
      console.error(`[webhooks] ${event} → ${ep.url} failed (${failures}): ${reason}`);

      await doc.ref.update({
        consecutiveFailures: failures,
        lastError: reason.slice(0, 300),
        lastFailureAt: new Date().toISOString(),
        // Switched off rather than retried forever. The record stays so the
        // owner can see why it stopped instead of finding it silently idle.
        ...(failures >= FAILURE_LIMIT
          ? { active: false, disabledAt: new Date().toISOString(), disabledReason: 'too many consecutive failures' }
          : {}),
      }).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }));
}

/* ── Triggers ────────────────────────────────────────────────────────────── */

exports.onLeadCreated = onDocumentCreated(
  { document: 'workspaces/{workspaceId}/leads/{leadId}', region: 'us-central1' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await dispatch(event.params.workspaceId, 'lead.created', leadOut(snap.id, snap.data()));
  },
);

exports.onLeadUpdated = onDocumentUpdated(
  { document: 'workspaces/{workspaceId}/leads/{leadId}', region: 'us-central1' },
  async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after) return;

    // Firestore fires on every write, including ones that changed nothing a
    // subscriber can see — a touched timestamp, an internal counter. Comparing
    // the serialised shape means an integration is woken only when the data it
    // actually receives has changed.
    const nextView = leadOut(after.id, after.data());
    if (before?.exists) {
      const prevView = leadOut(before.id, before.data());
      const ignore = new Set(['last_update']);
      const differs = Object.keys(nextView).some(k =>
        !ignore.has(k) && JSON.stringify(nextView[k]) !== JSON.stringify(prevView[k]));
      if (!differs) return;
    }
    await dispatch(event.params.workspaceId, 'lead.updated', nextView);
  },
);

exports.onTaskCreated = onDocumentCreated(
  { document: 'workspaces/{workspaceId}/tasks/{taskId}', region: 'us-central1' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await dispatch(event.params.workspaceId, 'task.created', taskOut(snap.id, snap.data()));
  },
);

/* ── Management, called from the app ─────────────────────────────────────── */

async function assertMember(db, request, wid) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  if (request.auth.token.email === SUPER_ADMIN_EMAIL) return;
  const me = await db.collection('users').doc(request.auth.uid).get();
  if (!me.exists || me.data()?.workspaceId !== wid) {
    throw new HttpsError('permission-denied', 'Not a member of this workspace.');
  }
}

exports.createWebhook = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  const url = String(request.data?.url ?? '').trim();
  const events = Array.isArray(request.data?.events) ? request.data.events : [];

  if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
  await assertMember(db, request, wid);

  // Plain http would send the payload, and its signature, in the clear.
  if (!/^https:\/\/.+/i.test(url)) {
    throw new HttpsError('invalid-argument', 'הכתובת חייבת להתחיל ב-https://');
  }
  const chosen = events.filter(e => EVENTS.includes(e));
  if (!chosen.length) {
    throw new HttpsError('invalid-argument', 'יש לבחור לפחות אירוע אחד.');
  }

  // Generated rather than chosen by the user: a secret people invent tends to
  // be one they already use somewhere else.
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const ref = await db.collection('webhookEndpoints').add({
    workspaceId: wid,
    url,
    events: chosen,
    secret,
    active: true,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    createdBy: request.auth.token.email ?? request.auth.uid,
    lastDeliveryAt: null,
    lastError: null,
  });

  // Returned once, like an API key: it has to reach the receiver's config, and
  // it is never shown again.
  return { id: ref.id, secret };
});

exports.listWebhooks = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
  await assertMember(db, request, wid);

  const snap = await db.collection('webhookEndpoints').where('workspaceId', '==', wid).get();
  return {
    webhooks: snap.docs.map(d => {
      const w = d.data();
      // Deliberately without `secret`.
      return {
        id: d.id, url: w.url, events: w.events ?? [], active: w.active !== false,
        createdAt: w.createdAt ?? null, lastDeliveryAt: w.lastDeliveryAt ?? null,
        lastError: w.lastError ?? null, consecutiveFailures: w.consecutiveFailures ?? 0,
        disabledReason: w.disabledReason ?? null,
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    availableEvents: EVENTS,
  };
});

exports.deleteWebhook = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  const id = String(request.data?.id ?? '');
  if (!wid || !id) throw new HttpsError('invalid-argument', 'workspaceId and id are required.');
  await assertMember(db, request, wid);

  const ref = db.collection('webhookEndpoints').doc(id);
  const snap = await ref.get();
  // Checked, not assumed: otherwise a caller could delete another workspace's
  // endpoint by guessing its id.
  if (!snap.exists || snap.data()?.workspaceId !== wid) {
    throw new HttpsError('not-found', 'Webhook not found in this workspace.');
  }
  await ref.delete();
  return { ok: true };
});

/** Send a test event, so an endpoint can be proven before it matters. */
exports.testWebhook = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  const id = String(request.data?.id ?? '');
  if (!wid || !id) throw new HttpsError('invalid-argument', 'workspaceId and id are required.');
  await assertMember(db, request, wid);

  const snap = await db.collection('webhookEndpoints').doc(id).get();
  if (!snap.exists || snap.data()?.workspaceId !== wid) {
    throw new HttpsError('not-found', 'Webhook not found in this workspace.');
  }
  const ep = snap.data();
  const body = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    event: 'lead.created',
    created_at: new Date().toISOString(),
    workspace_id: wid,
    test: true,
    data: leadOut('lead_test_000', {
      company: 'בדיקה', contactName: 'לקוח לדוגמה',
      email: 'test@example.com', phone: '0500000000',
      status: 'חדש', source: 'API', budget: 0, createdAt: Date.now(),
    }),
  });
  const signature = crypto.createHmac('sha256', ep.secret).update(body).digest('hex');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ray-Event': 'lead.created',
        'X-Ray-Signature': signature,
        'User-Agent': 'RAY CRM Webhooks/1.0',
      },
      body,
      signal: abort.signal,
    });
    // The status is reported rather than judged: a receiver answering 404 is
    // information the owner needs, not an error on our side.
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: abort.signal.aborted ? `timeout after ${TIMEOUT_MS}ms` : String(err.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
});
