/**
 * gmailOAuth.js — a Gmail connection that survives the browser being closed.
 *
 * The app has always used Google's implicit browser flow: it hands the page an
 * access token that dies in about an hour and never issues a refresh token. So
 * the connection could only be kept alive by re-minting from an open tab, and
 * once every tab was closed for an hour the mailbox went dark until someone
 * clicked reconnect. Worse, the silent re-mint needs a popup, and browsers block
 * popups that no click asked for.
 *
 * This is the authorization-code flow instead:
 *
 *   1. `gmailConnectUrl`  — build a consent URL with access_type=offline.
 *   2. `gmailOAuthCallback` — Google redirects here with a one-time code; we
 *      exchange it for a REFRESH token using the client secret, which only the
 *      server holds, and store it.
 *   3. `gmailAccessToken` — mint a fresh access token from that refresh token,
 *      on demand, forever, with no user present and no popup.
 *
 * The refresh token is long-lived credential material. It is stored in a
 * top-level `gmailAuth` collection that Firestore rules deny to every client, so
 * only the Admin SDK — which bypasses rules — can read it. It is never returned
 * to the browser; the browser only ever receives short-lived access tokens.
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const CALLBACK_URL = 'https://us-central1-chex-crm.cloudfunctions.net/gmailOAuthCallback';

const APP_BASE = {
  admin:  'https://admin.ray-crm.com',
  client: 'https://ray-crm.com',
};

const authDoc = (db, wid) => db.collection('gmailAuth').doc(wid);

/** The caller must be signed in, and be in this workspace or the super admin. */
async function assertMember(db, request, wid) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  if (request.auth.token.email === SUPER_ADMIN_EMAIL) return;
  const snap = await db.collection('users').doc(request.auth.uid).get();
  if (!snap.exists || snap.data()?.workspaceId !== wid) {
    throw new HttpsError('permission-denied', 'Not a member of this workspace.');
  }
}

function clientCreds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new HttpsError(
      'failed-precondition',
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured on the server.',
    );
  }
  return { id, secret };
}

/* ── 1. Build the consent URL ─────────────────────────────────────────────── */
exports.gmailConnectUrl = onCall(
  { region: 'us-central1' },
  async (request) => {
    const db = admin.firestore();
    const wid = String(request.data?.workspaceId ?? '');
    if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
    await assertMember(db, request, wid);
    const { id } = clientCreds();

    // A one-time nonce rather than putting the workspace id straight in `state`:
    // the callback is a public URL, and a guessable state would let anyone
    // attach their own mailbox to someone else's workspace.
    const nonceRef = db.collection('gmailAuthNonce').doc();
    await nonceRef.set({
      workspaceId: wid,
      uid: request.auth.uid,
      surface: request.data?.surface === 'client' ? 'client' : 'admin',
      createdAt: Date.now(),
    });

    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: id,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: SCOPES,
      // offline + consent is what actually produces a refresh token. Google
      // omits it on repeat authorisations unless consent is forced.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: String(request.data?.loginHint ?? ''),
      state: nonceRef.id,
    }).toString();

    return { url };
  },
);

/* ── 2. Exchange the code for a refresh token ─────────────────────────────── */
exports.gmailOAuthCallback = onRequest(
  { region: 'us-central1', cors: false },
  async (req, res) => {
    const db = admin.firestore();
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    const err = String(req.query.error ?? '');

    let back = `${APP_BASE.admin}/?gmail_connected=error`;

    try {
      if (err) throw new Error(err);
      if (!code || !state) throw new Error('missing code or state');

      const nonceRef = db.collection('gmailAuthNonce').doc(state);
      const nonce = await nonceRef.get();
      if (!nonce.exists) throw new Error('invalid or expired state');
      const { workspaceId, surface } = nonce.data();
      // One-time: consume it immediately so a replayed callback cannot rebind.
      await nonceRef.delete().catch(() => {});
      back = `${APP_BASE[surface] ?? APP_BASE.admin}/?gmail_connected=`;

      const { id, secret } = (() => {
        const i = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        if (!i || !s) throw new Error('server OAuth credentials not configured');
        return { id: i, secret: s };
      })();

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: id, client_secret: secret,
          redirect_uri: CALLBACK_URL, grant_type: 'authorization_code',
        }).toString(),
      });
      const tok = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tok.error_description || tok.error || `token exchange ${tokenRes.status}`);
      if (!tok.refresh_token) {
        // Without this the whole point is lost, so fail loudly rather than
        // storing a connection that dies again in an hour.
        throw new Error('Google returned no refresh token — revoke the app at myaccount.google.com/permissions and connect again');
      }

      let email = '';
      try {
        const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        if (me.ok) email = (await me.json()).email ?? '';
      } catch { /* the address is a convenience, not a requirement */ }

      await authDoc(db, workspaceId).set({
        workspaceId,
        refreshToken: tok.refresh_token,
        email,
        scope: tok.scope ?? SCOPES,
        connectedAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });

      console.log(`[gmailOAuthCallback] workspace ${workspaceId} connected as ${email || 'unknown'}`);
      res.redirect(`${back}success&email=${encodeURIComponent(email)}`);
    } catch (e) {
      console.error('[gmailOAuthCallback]', e);
      res.redirect(`${back.replace(/=$/, '=')}error&reason=${encodeURIComponent(String(e.message ?? e).slice(0, 200))}`);
    }
  },
);

/* ── 3. Mint an access token on demand ────────────────────────────────────── */
exports.gmailAccessToken = onCall(
  { region: 'us-central1' },
  async (request) => {
    const db = admin.firestore();
    const wid = String(request.data?.workspaceId ?? '');
    if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
    await assertMember(db, request, wid);

    const snap = await authDoc(db, wid).get();
    if (!snap.exists || !snap.data()?.refreshToken) {
      throw new HttpsError('failed-precondition', 'no_refresh_token');
    }
    const { refreshToken, email } = snap.data();
    const { id, secret } = clientCreds();

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id, client_secret: secret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }).toString(),
    });
    const tok = await r.json();

    if (!r.ok) {
      const reason = tok.error ?? `http_${r.status}`;
      // invalid_grant means the user revoked access or changed their password.
      // Clear the dead credential so the UI stops pretending it is connected.
      if (reason === 'invalid_grant') {
        await authDoc(db, wid).delete().catch(() => {});
        throw new HttpsError('failed-precondition', 'revoked');
      }
      throw new HttpsError('internal', `refresh failed: ${reason}`);
    }

    return {
      accessToken: tok.access_token,
      expiresIn: tok.expires_in ?? 3600,
      email: email ?? '',
    };
  },
);

/* ── 4. Disconnect ────────────────────────────────────────────────────────── */
exports.gmailDisconnect = onCall(
  { region: 'us-central1' },
  async (request) => {
    const db = admin.firestore();
    const wid = String(request.data?.workspaceId ?? '');
    if (!wid) throw new HttpsError('invalid-argument', 'workspaceId is required.');
    await assertMember(db, request, wid);

    const snap = await authDoc(db, wid).get();
    const refreshToken = snap.exists ? snap.data()?.refreshToken : null;
    // Tell Google too, so "disconnect" means disconnected rather than merely
    // forgotten on our side.
    if (refreshToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(e => console.error('[gmailDisconnect] revoke failed', e));
    }
    await authDoc(db, wid).delete().catch(() => {});
    return { ok: true };
  },
);
