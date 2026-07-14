/**
 * social.js — Social network OAuth token exchange + unified posting proxy.
 * Exported functions are merged into index.js via require().
 */

const { onCall: _onCall, HttpsError } = require('firebase-functions/v2/https');

// Enforce Firebase App Check on every callable function
const onCall = (opts, handler) => _onCall({ ...opts, enforceAppCheck: true }, handler);

/* ══════════════════════════════════════════════════════════════════════════
 * exchangeSocialToken — server-side OAuth code → access token exchange.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.exchangeSocialToken = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { platform, code, workspaceId, redirectUri } = request.data;
    if (!platform || !code || !workspaceId || !redirectUri) {
      throw new HttpsError('invalid-argument', 'Missing required fields: platform, code, workspaceId, redirectUri.');
    }

    // Read clientId & clientSecret from Firestore server-side (never trust the client)
    const admin = require('firebase-admin');
    const db = admin.firestore();
    const credSnap = await db
      .doc(`workspaces/${workspaceId}/socialConnections/${platform}`)
      .get()
      .catch(() => null);

    if (!credSnap || !credSnap.exists) {
      throw new HttpsError('not-found', `No credentials found for platform "${platform}". Please save your App credentials first.`);
    }
    const stored = credSnap.data();
    const clientId     = stored.clientId;
    const clientSecret = stored.clientSecret;

    if (!clientId || !clientSecret) {
      throw new HttpsError('failed-precondition', `clientId or clientSecret missing for platform "${platform}".`);
    }

    let tokenUrl, bodyParams, profileUrl;

    if (platform === 'linkedin') {
      tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
      bodyParams = { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret };
      profileUrl = 'https://api.linkedin.com/v2/userinfo';

    } else if (platform === 'tiktok') {
      tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
      bodyParams = { client_key: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri };
      profileUrl = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name';

    } else if (platform === 'twitter') {
      tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      bodyParams = { code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: 'challenge', client_id: clientId };
      profileUrl = 'https://api.twitter.com/2/users/me';

    } else if (platform === 'youtube') {
      tokenUrl = 'https://oauth2.googleapis.com/token';
      bodyParams = { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' };
      profileUrl = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

    } else if (platform === 'google') {
      tokenUrl = 'https://oauth2.googleapis.com/token';
      bodyParams = { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' };
      profileUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';

    } else {
      throw new HttpsError('invalid-argument', `Unsupported platform: ${platform}`);
    }

    const body = new URLSearchParams(bodyParams);
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new HttpsError('internal', tokenData.error_description || tokenData.message || 'Token exchange failed');
    }

    const accessToken  = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn    = tokenData.expires_in;

    // Fetch basic profile info
    let accountName = '', accountId = '';
    try {
      const profRes = await fetch(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const prof = await profRes.json();
      if (platform === 'linkedin') {
        accountName = prof.name || prof.localizedFirstName || '';
        accountId   = prof.sub || '';
      } else if (platform === 'tiktok') {
        accountName = prof.data && prof.data.user ? prof.data.user.display_name : '';
        accountId   = prof.data && prof.data.user ? prof.data.user.open_id : '';
      } else if (platform === 'twitter') {
        accountName = prof.data ? (prof.data.name || prof.data.username || '') : '';
        accountId   = prof.data ? (prof.data.id || '') : '';
      } else if (platform === 'youtube') {
        const ch = prof.items && prof.items[0];
        accountName = ch ? ch.snippet.title : '';
        accountId   = ch ? ch.id : '';
      } else if (platform === 'google') {
        accountName = prof.name || prof.email || '';
        accountId   = prof.sub  || '';
      }
    } catch (e) {
      console.warn('Profile fetch failed:', e);
    }

    return { accessToken, refreshToken, expiresIn, accountName, accountId };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * postToSocial — unified proxy for posting to any connected social network.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.postToSocial = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { platform, accessToken, message, pageId } = request.data;
    if (!platform || !accessToken || !message) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    let postId = '', url = '';

    if (platform === 'linkedin') {
      const authorUrn = pageId ? `urn:li:organization:${pageId}` : `urn:li:person:me`;
      const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: message },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new HttpsError('internal', data.message || 'LinkedIn post failed');
      postId = data.id || '';

    } else if (platform === 'twitter') {
      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      const data = await res.json();
      if (!res.ok) throw new HttpsError('internal', data.detail || 'Twitter post failed');
      postId = data.data ? data.data.id : '';
      url    = `https://twitter.com/i/web/status/${postId}`;

    } else {
      throw new HttpsError('invalid-argument', `Posting to ${platform} not yet supported via this proxy`);
    }

    return { postId, url };
  }
);
