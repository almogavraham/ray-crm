/**
 * gmailServerAuth.ts — the browser half of the permanent Gmail connection.
 *
 * The server holds the refresh token and mints access tokens from it. This
 * module never sees the refresh token; it asks for a short-lived access token
 * and installs it, which is why the connection survives the browser being
 * closed for a week rather than an hour.
 *
 * The old implicit flow is kept as a fallback, not removed: a workspace that
 * connected the old way keeps working until someone reconnects properly.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { adoptToken } from './gmailAgent';

interface TokenReply { accessToken: string; expiresIn: number; email: string }

const callConnectUrl   = httpsCallable<{ workspaceId: string; loginHint?: string; surface?: string }, { url: string }>(functions, 'gmailConnectUrl');
const callAccessToken  = httpsCallable<{ workspaceId: string }, TokenReply>(functions, 'gmailAccessToken');
const callDisconnect   = httpsCallable<{ workspaceId: string }, { ok: boolean }>(functions, 'gmailDisconnect');

/** Cached so a burst of surfaces mounting at once makes one round trip. */
let inFlight: Promise<string | null> | null = null;
let cached: { token: string; expiry: number } | null = null;

/**
 * A live access token minted from the server-held refresh token, or null when
 * this workspace has no permanent connection yet.
 *
 * Never throws for the "not connected" case — callers use it as one option
 * among several, and an exception there would be control flow, not an error.
 */
export async function getServerGmailToken(workspaceId?: string | null): Promise<string | null> {
  if (!workspaceId) return null;
  if (cached && cached.expiry - Date.now() > 60_000) return cached.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data } = await callAccessToken({ workspaceId });
      if (!data?.accessToken) return null;
      const expiry = Date.now() + (data.expiresIn ?? 3600) * 1000;
      cached = { token: data.accessToken, expiry };
      // Install it so every existing surface — all of which read the module
      // token in gmailAgent — picks it up without being rewritten.
      adoptToken(data.accessToken, expiry);
      return data.accessToken;
    } catch (e) {
      const code = (e as { message?: string })?.message ?? '';
      // 'no_refresh_token' simply means this workspace has not connected the
      // permanent way yet; 'revoked' means the user withdrew access at Google.
      if (!/no_refresh_token|revoked/.test(code)) {
        console.error('[gmailServerAuth] token mint failed', e);
      }
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** True when this workspace has a server-held refresh token. */
export async function hasPermanentGmail(workspaceId?: string | null): Promise<boolean> {
  return (await getServerGmailToken(workspaceId)) !== null;
}

/**
 * Start the permanent connection. Opens Google's consent screen in a new tab —
 * from a click, so no popup blocker is involved, which is the failure the
 * background re-mint could never get past.
 */
export async function connectGmailPermanently(
  workspaceId: string,
  loginHint?: string,
): Promise<void> {
  const surface = window.location.hostname.startsWith('admin.') ? 'admin' : 'client';
  const { data } = await callConnectUrl({ workspaceId, loginHint, surface });
  if (!data?.url) throw new Error('לא הצלחתי לבנות את כתובת ההרשאה');
  window.location.href = data.url;
}

/** Revoke at Google and forget the refresh token. */
export async function disconnectGmail(workspaceId: string): Promise<void> {
  await callDisconnect({ workspaceId });
  cached = null;
}

/**
 * Read the result Google redirected back with, then scrub it from the URL so a
 * refresh does not replay a stale banner.
 */
export function readConnectResult(): { status: 'success' | 'error'; email?: string; reason?: string } | null {
  const q = new URLSearchParams(window.location.search);
  const status = q.get('gmail_connected');
  if (status !== 'success' && status !== 'error') return null;
  const out = {
    status,
    email: q.get('email') ?? undefined,
    reason: q.get('reason') ?? undefined,
  } as const;
  q.delete('gmail_connected'); q.delete('email'); q.delete('reason');
  const rest = q.toString();
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  return out;
}
