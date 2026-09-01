/**
 * publicApi.js — the REST API other systems integrate against.
 *
 *   https://us-central1-chex-crm.cloudfunctions.net/api/v1/...
 *
 * The system already had two ways in, and neither is a general API: the leads
 * webhook takes a workspace secret and only accepts leads, and form ingest uses
 * an unguessable form id because a form on a public page cannot hold a secret.
 * Neither lets a customer's own software read what is in their CRM.
 *
 * Decisions worth stating, because each prevents a failure that is expensive to
 * discover later:
 *
 * **Keys are stored hashed.** Only the SHA-256 of a key is written down, so a
 * dump of Firestore does not hand anyone API access, and a key cannot be
 * recovered — it is shown once, at creation, and never again. That is a
 * deliberate inconvenience: an API key that can be re-read is a password that
 * never expires.
 *
 * **Writes take a whitelist, never the request body.** A caller can set the
 * fields a caller should set. It cannot set `aiScore`, rewrite `activityLog`,
 * or invent `createdAt` — spreading the body into the document would let any
 * integration silently corrupt data the product computes for itself.
 *
 * **Every response has the same shape.** Errors are always
 * `{ error: { code, message } }` with a real HTTP status, because an integrator
 * debugging at 2am should not have to guess whether 200 means success.
 *
 * **Rate limited per key**, so one runaway loop cannot exhaust a workspace's
 * quota or the project's.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const API_VERSION = 'v1';

/** Requests per key per minute. Generous for integrations, fatal to loops. */
const RATE_LIMIT_PER_MIN = 120;

/** Hard ceiling on a page, whatever the caller asks for. */
const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;

/* ── Errors ──────────────────────────────────────────────────────────────── */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad        = (msg) => new ApiError(400, 'invalid_request', msg);
const unauthed   = (msg) => new ApiError(401, 'unauthorized', msg);
const notFound   = (what) => new ApiError(404, 'not_found', `${what} not found.`);

/* ── Authentication ──────────────────────────────────────────────────────── */

const hashKey = (key) => crypto.createHash('sha256').update(key, 'utf8').digest('hex');

/**
 * Resolve `Authorization: Bearer ray_sk_…` to a workspace.
 *
 * The lookup is by hash, so the plaintext key never has to exist anywhere but
 * in the caller's own configuration.
 */
async function authenticate(db, req) {
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    throw unauthed('Missing Authorization header. Use: Authorization: Bearer YOUR_API_KEY');
  }
  const presented = m[1].trim();

  const snap = await db.collection('apiKeys').doc(hashKey(presented)).get();
  if (!snap.exists) throw unauthed('Invalid API key.');

  const key = snap.data();
  if (key.revokedAt) throw unauthed('This API key has been revoked.');
  if (!key.workspaceId) throw unauthed('This API key is not attached to a workspace.');

  return { keyDoc: snap.ref, ...key };
}

/**
 * A fixed window per key. Coarse on purpose: precise limiting would cost more
 * reads than the requests it protects.
 */
async function enforceRateLimit(db, keyHash) {
  const minute = Math.floor(Date.now() / 60000);
  const ref = db.collection('apiRateLimits').doc(`${keyHash}_${minute}`);
  const count = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const next = (doc.exists ? doc.data().count : 0) + 1;
    // expiresAt lets a TTL policy clear these; without it the collection grows
    // by one document per key per minute, forever.
    tx.set(ref, { count: next, expiresAt: new Date(Date.now() + 120_000) });
    return next;
  });
  if (count > RATE_LIMIT_PER_MIN) {
    throw new ApiError(429, 'rate_limited',
      `Rate limit exceeded: ${RATE_LIMIT_PER_MIN} requests per minute. Retry shortly.`);
  }
}

/* ── Serialisation ───────────────────────────────────────────────────────── */

/**
 * What a lead looks like over the wire.
 *
 * Explicit rather than "everything we store": the internal document carries
 * fields that are ours (AI scoring internals, the full activity log) and
 * exposing the raw shape would make every future storage change a breaking API
 * change for every integrator.
 */
const leadOut = (id, d) => ({
  id,
  company: d.company ?? '',
  contact_name: d.contactName ?? '',
  email: d.email ?? '',
  phone: d.phone ?? '',
  status: d.status ?? '',
  source: d.source ?? '',
  budget: typeof d.budget === 'number' ? d.budget : 0,
  assigned_to: d.assignedTo ?? '',
  ai_score: typeof d.aiScore === 'number' ? d.aiScore : null,
  is_hot: Boolean(d.isHot),
  created_at: d.createdAt ? new Date(d.createdAt).toISOString() : null,
  last_update: d.lastUpdate ?? null,
  next_follow_up: d.nextFollowUpDate ?? null,
  custom_fields: d.customFields ?? {},
  attribution: {
    utm_source: d.utmSource ?? null,
    utm_medium: d.utmMedium ?? null,
    utm_campaign: d.utmCampaign ?? null,
    landing_page: d.landingPage ?? null,
    referrer: d.referrer ?? null,
  },
});

const taskOut = (id, d) => ({
  id,
  description: d.description ?? '',
  date: d.date ?? null,
  time: d.time ?? null,
  completed: Boolean(d.completed),
  priority: d.priority ?? 'medium',
  type: d.type ?? 'followup',
  assigned_to: d.assignedTo ?? '',
  lead_id: d.leadId ?? null,
  created_at: d.createdAt ?? null,
});

/* ── Input ───────────────────────────────────────────────────────────────── */

const str = (v, n = 300) => (v === undefined || v === null) ? undefined : String(v).trim().slice(0, n);

/** Only these may be set through the API, and only to these types. */
function leadIn(body, { partial }) {
  const out = {};
  const map = {
    company: 'company', contact_name: 'contactName', email: 'email',
    phone: 'phone', status: 'status', source: 'source',
    assigned_to: 'assignedTo', next_follow_up: 'nextFollowUpDate',
  };
  for (const [from, to] of Object.entries(map)) {
    const v = str(body[from]);
    if (v !== undefined) out[to] = v;
  }
  if (body.budget !== undefined) {
    const n = Number(body.budget);
    if (!Number.isFinite(n) || n < 0) throw bad('budget must be a non-negative number.');
    out.budget = n;
  }
  if (body.is_hot !== undefined) out.isHot = Boolean(body.is_hot);
  if (body.custom_fields !== undefined) {
    if (typeof body.custom_fields !== 'object' || Array.isArray(body.custom_fields)) {
      throw bad('custom_fields must be an object.');
    }
    out.customFields = body.custom_fields;
  }

  if (!partial) {
    // A lead with no way to reach anyone is not a lead. Requiring one contact
    // channel here is cheaper than discovering a pipeline full of blanks.
    if (!out.company && !out.contactName) throw bad('Either company or contact_name is required.');
    if (!out.email && !out.phone) throw bad('Either email or phone is required.');
  }
  if (partial && Object.keys(out).length === 0) throw bad('No writable fields in request body.');
  return out;
}

function taskIn(body) {
  const description = str(body.description, 1000);
  if (!description) throw bad('description is required.');
  const date = str(body.date, 40);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date is required, as YYYY-MM-DD.');

  const priority = str(body.priority, 20) ?? 'medium';
  if (!['low', 'medium', 'high'].includes(priority)) throw bad('priority must be low, medium or high.');

  return {
    description, date,
    time: str(body.time, 10) ?? '09:00',
    priority,
    type: str(body.type, 40) ?? 'followup',
    assignedTo: str(body.assigned_to, 120) ?? '',
    ...(body.lead_id ? { leadId: str(body.lead_id, 120) } : {}),
    completed: false,
    createdAt: new Date().toISOString(),
    createdVia: 'api',
  };
}

/* ── Handlers ────────────────────────────────────────────────────────────── */

async function listLeads(db, ctx, req) {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE, MAX_PAGE);
  let q = db.collection('workspaces').doc(ctx.workspaceId).collection('leads');

  if (req.query.status) q = q.where('status', '==', String(req.query.status));
  if (req.query.assigned_to) q = q.where('assignedTo', '==', String(req.query.assigned_to));

  // Ordered by creation so a cursor is stable. Ordering by lastUpdate would
  // move rows between pages while the caller is walking them.
  q = q.orderBy('createdAt', 'desc').limit(limit + 1);
  if (req.query.cursor) {
    const after = Number(req.query.cursor);
    if (!Number.isFinite(after)) throw bad('cursor is not valid.');
    q = q.startAfter(after);
  }

  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  const last = docs[docs.length - 1];
  return {
    data: docs.map(d => leadOut(d.id, d.data())),
    has_more: snap.docs.length > limit,
    next_cursor: snap.docs.length > limit && last ? String(last.data().createdAt ?? '') : null,
  };
}

async function getLead(db, ctx, id) {
  const snap = await db.collection('workspaces').doc(ctx.workspaceId).collection('leads').doc(id).get();
  if (!snap.exists) throw notFound('Lead');
  return { data: leadOut(snap.id, snap.data()) };
}

async function createLead(db, ctx, req) {
  const fields = leadIn(req.body || {}, { partial: false });
  const id = `api_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = Date.now();

  const lead = {
    id,
    company: '', contactName: '', email: '', phone: '',
    status: 'חדש', source: 'API', budget: 0,
    solutions: [], assignedTo: '', aiScore: 0,
    notes: [], tasks: [], futureNotes: [], waitingContent: false,
    ...fields,
    createdAt: now,
    lastUpdate: new Date(now).toISOString(),
    createdVia: 'api',
  };
  await db.collection('workspaces').doc(ctx.workspaceId).collection('leads').doc(id).set(lead);
  return { data: leadOut(id, lead), _status: 201 };
}

async function updateLead(db, ctx, id, req) {
  const ref = db.collection('workspaces').doc(ctx.workspaceId).collection('leads').doc(id);
  if (!(await ref.get()).exists) throw notFound('Lead');
  const fields = leadIn(req.body || {}, { partial: true });
  await ref.update({ ...fields, lastUpdate: new Date().toISOString() });
  const after = await ref.get();
  return { data: leadOut(after.id, after.data()) };
}

async function listTasks(db, ctx, req) {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE, MAX_PAGE);
  let q = db.collection('workspaces').doc(ctx.workspaceId).collection('tasks');
  if (req.query.completed !== undefined) q = q.where('completed', '==', req.query.completed === 'true');
  if (req.query.lead_id) q = q.where('leadId', '==', String(req.query.lead_id));
  const snap = await q.limit(limit).get();
  return { data: snap.docs.map(d => taskOut(d.id, d.data())) };
}

async function createTask(db, ctx, req) {
  const task = taskIn(req.body || {});
  const id = `api_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await db.collection('workspaces').doc(ctx.workspaceId).collection('tasks').doc(id).set({ ...task, id });
  return { data: taskOut(id, task), _status: 201 };
}

/* ── Router ──────────────────────────────────────────────────────────────── */

exports.api = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const db = admin.firestore();
    // Strip the function name when called through the cloudfunctions.net host,
    // so /api/v1/leads and /v1/leads both resolve.
    const path = req.path.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    const segments = path.split('/').filter(Boolean);

    try {
      if (segments[0] !== API_VERSION) {
        throw new ApiError(404, 'not_found',
          `Unknown API version. This API is served under /${API_VERSION}/ — see https://ray-crm.com/api`);
      }

      const ctx = await authenticate(db, req);
      await enforceRateLimit(db, ctx.keyDoc.id);

      const [, resource, id] = segments;
      const method = req.method.toUpperCase();
      let result;

      if (resource === 'me' && method === 'GET') {
        result = { data: { workspace_id: ctx.workspaceId, key_name: ctx.name ?? null, scopes: ctx.scopes ?? ['read', 'write'] } };
      } else if (resource === 'leads' && !id && method === 'GET')    result = await listLeads(db, ctx, req);
      else if   (resource === 'leads' && !id && method === 'POST')   result = await createLead(db, ctx, req);
      else if   (resource === 'leads' && id  && method === 'GET')    result = await getLead(db, ctx, id);
      else if   (resource === 'leads' && id  && (method === 'PATCH' || method === 'PUT')) result = await updateLead(db, ctx, id, req);
      else if   (resource === 'tasks' && !id && method === 'GET')    result = await listTasks(db, ctx, req);
      else if   (resource === 'tasks' && !id && method === 'POST')   result = await createTask(db, ctx, req);
      else {
        throw new ApiError(405, 'method_not_allowed',
          `${method} /${API_VERSION}/${resource ?? ''} is not a valid endpoint. See https://ray-crm.com/api`);
      }

      // Fire-and-forget: usage stats must never delay or fail a real request.
      ctx.keyDoc.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});

      const status = result._status ?? 200;
      delete result._status;
      res.status(status).json(result);

    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      // A filtered query needs a composite index, and a newly added one is
      // unusable for a few minutes while it builds. That is temporary and
      // retryable, so it must not be reported as a generic failure — an
      // integrator would go hunting for a bug in their own request.
      if (err.code === 9 || /requires an index/i.test(String(err.message))) {
        console.error('[api] index not ready:', req.method, req.path, err.message);
        res.status(503).json({
          error: {
            code: 'index_building',
            message: 'This filter is temporarily unavailable while a database index finishes building. Retry in a few minutes.',
          },
        });
        return;
      }

      // An unexpected failure is ours. Log it in full; tell the caller only
      // that it happened, since the detail could describe internal structure.
      console.error('[api]', req.method, req.path, err);
      res.status(500).json({
        error: { code: 'internal_error', message: 'Something went wrong on our side. Please retry.' },
      });
    }
  },
);

/* ── Key management, called from the app ─────────────────────────────────── */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

async function assertMember(db, request, wid) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  if (request.auth.token.email === SUPER_ADMIN_EMAIL) return;
  const me = await db.collection('users').doc(request.auth.uid).get();
  if (!me.exists || me.data()?.workspaceId !== wid) {
    throw new HttpsError('permission-denied', 'Not a member of this workspace.');
  }
}

exports.createApiKey = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
  await assertMember(db, request, wid);

  // 32 random bytes. The prefix is there so a leaked key is recognisable in a
  // log or a paste and can be revoked without anyone having to identify it.
  const secret = `ray_sk_${crypto.randomBytes(32).toString('hex')}`;
  await db.collection('apiKeys').doc(hashKey(secret)).set({
    workspaceId: wid,
    name: String(request.data?.name ?? 'API key').slice(0, 80),
    createdAt: new Date().toISOString(),
    createdBy: request.auth.token.email ?? request.auth.uid,
    lastUsedAt: null,
    revokedAt: null,
    // The last four characters, so the app can show which key is which. Not
    // enough to reconstruct anything.
    hint: secret.slice(-4),
  });

  // The only time this value exists outside the caller's own storage.
  return { key: secret, hint: secret.slice(-4) };
});

exports.listApiKeys = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
  await assertMember(db, request, wid);

  const snap = await db.collection('apiKeys').where('workspaceId', '==', wid).get();
  return {
    keys: snap.docs.map(d => ({
      id: d.id,                       // the hash: safe to show, useless to a caller
      name: d.data().name,
      hint: d.data().hint ?? null,
      createdAt: d.data().createdAt,
      lastUsedAt: d.data().lastUsedAt,
      revokedAt: d.data().revokedAt,
    })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
});

exports.revokeApiKey = onCall({ region: 'us-central1' }, async (request) => {
  const db = admin.firestore();
  const wid = String(request.data?.workspaceId ?? '');
  const keyId = String(request.data?.keyId ?? '');
  if (!wid || !keyId) throw new HttpsError('invalid-argument', 'workspaceId and keyId are required.');
  await assertMember(db, request, wid);

  const ref = db.collection('apiKeys').doc(keyId);
  const snap = await ref.get();
  // Checked rather than assumed: without it, a caller could revoke another
  // workspace's key by guessing its id.
  if (!snap.exists || snap.data()?.workspaceId !== wid) {
    throw new HttpsError('not-found', 'Key not found in this workspace.');
  }
  // Marked revoked rather than deleted, so the audit trail of what once had
  // access survives.
  await ref.update({ revokedAt: new Date().toISOString() });
  return { ok: true };
});

/*
 * Shared with the webhook sender, so an event carries exactly the same shape as
 * a GET on the same resource. Two serialisers for one object is how an
 * integrator ends up writing two parsers and discovering the difference in
 * production.
 */
module.exports.leadOut = leadOut;
module.exports.taskOut = taskOut;
