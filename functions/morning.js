/**
 * morning.js — the Morning (חשבונית ירוקה) API client.
 *
 * Morning is both the payment processor and the invoicing system, which is the
 * reason it was chosen over Stripe and over a separate Israeli gateway: a
 * successful charge issues the חשבונית מס itself, so there is no second system
 * to keep in step and no window where money was taken but no document exists.
 *
 * Two things this file exists to get right:
 *
 *  • **Tokens are short-lived.** Access tokens last one hour. Minting one per
 *    request would be wasteful and slow; caching one forever would start
 *    failing with 401 an hour in. So the token is cached with a margin and
 *    re-minted before it expires, and concurrent callers share one mint rather
 *    than racing to make several.
 *
 *  • **Errors must say what actually went wrong.** Morning answers HTTP 400
 *    with a numeric errorCode and, often, no message at all. `2600` reads as
 *    "no active payment terminal" — a setup problem the operator can fix in
 *    minutes — but as a bare `400` it looks like a bug in our request and sends
 *    someone hunting through the payload. The codes that describe an account or
 *    configuration state are translated here.
 *
 * ENVIRONMENT (functions/.env):
 *   MORNING_API_KEY     OAuth client id
 *   MORNING_API_SECRET  OAuth client secret
 *   MORNING_ENV         'production' | 'sandbox'  (default: sandbox)
 *
 * Keys are per-environment: a production key is rejected by the sandbox and
 * vice versa. The environment is declared rather than inferred, because
 * guessing wrong against production writes real tax documents.
 */

const ENVS = {
  production: {
    idp: 'https://api.morning.co/idp/v1/oauth/token',
    api: 'https://api.greeninvoice.co.il/api/v1',
  },
  sandbox: {
    idp: 'https://api.sandbox.morning.dev/idp/v1/oauth/token',
    api: 'https://sandbox.d.greeninvoice.co.il/api/v1',
  },
};

/**
 * Error codes worth naming. Everything else falls through to the code itself,
 * which is still better than a bare 400 — the full table lives in Morning's
 * OpenAPI spec.
 */
const ERROR_TEXT = {
  2600: 'לא נמצא מסוף סליקה פעיל בחשבון Morning — יש להשלים את הגדרות התשלומים הדיגיטליים ולקבל אישור לאתר',
  2601: 'בעיה בחיוב האשראי — יש לפנות לתמיכה של Morning',
  2602: 'שגיאה בחיבור תוסף הסליקה',
  2603: 'שגיאה בחיוב כרטיס האשראי',
  2607: 'סוג טוקן לא תקין',
};

function config() {
  const name = (process.env.MORNING_ENV || 'sandbox').toLowerCase();
  const env = ENVS[name] ?? ENVS.sandbox;
  const id = process.env.MORNING_API_KEY;
  const secret = process.env.MORNING_API_SECRET;
  if (!id || !secret) {
    throw new Error('MORNING_API_KEY / MORNING_API_SECRET are not configured on the server.');
  }
  return { ...env, id, secret, name };
}

/** True when this deployment is pointed at real books. */
const isProduction = () => (process.env.MORNING_ENV || '').toLowerCase() === 'production';

/* ── Token, cached across invocations of a warm instance ─────────────────── */

let cached = null;      // { token, expiresAt }
let inFlight = null;

/** Re-mint this long before expiry, so a request never carries a dying token. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

async function getToken() {
  if (cached && cached.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return cached.token;
  if (inFlight) return inFlight;

  const { idp, id, secret } = config();
  inFlight = (async () => {
    try {
      const res = await fetch(idp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials', client_id: id, client_secret: secret,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.accessToken) {
        // These are the OAuth errors that mean something specific.
        const hint = body.error === 'invalid_client'
          ? ' — the key/secret is wrong, or belongs to the other environment'
          : body.error === 'unauthorized_client'
            ? ' — the Morning subscription does not include API access'
            : body.error === 'invalid_grant'
              ? ' — the API key is expired, revoked or still pending'
              : '';
        throw new Error(`Morning auth failed (${body.error || res.status})${hint}`);
      }
      // Trust the server's own expiry rather than assuming the documented hour.
      const ttlMs = (body.expiresIn ? body.expiresIn * 1000 : 3600_000);
      cached = { token: body.accessToken, expiresAt: Date.now() + ttlMs };
      return body.accessToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ── Requests ────────────────────────────────────────────────────────────── */

/**
 * Call a Morning endpoint. Returns the parsed body on success and throws with a
 * readable message otherwise — never returns a failure for the caller to
 * forget to check.
 */
async function morningRequest(path, body, { method = 'POST' } = {}) {
  const { api } = config();
  const token = await getToken();

  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const parsed = await res.json().catch(() => null);

  // A 200 can still carry a failure: the payment endpoints report errors in the
  // body via errorCode while answering 200/201.
  const code = parsed?.errorCode;
  if (!res.ok || (code !== undefined && code !== 0)) {
    const detail = ERROR_TEXT[code]
      || parsed?.errorDescription
      || parsed?.description
      || (code !== undefined ? `errorCode ${code}` : `HTTP ${res.status}`);
    const err = new Error(`Morning ${path}: ${detail}`);
    err.errorCode = code;
    err.status = res.status;
    throw err;
  }
  return parsed;
}

/** Number of documents in the account — used to prove a call wrote nothing. */
async function documentCount() {
  const r = await morningRequest('/documents/search', { pageSize: 1 });
  return r?.total ?? null;
}

module.exports = {
  getToken, morningRequest, documentCount, isProduction,
  ENVS, ERROR_TEXT,
};
