/**
 * gmailKeepAlive.ts — keeps the Gmail connection alive for as long as the app is.
 *
 * Google hands a browser client an access token that expires in ~1 hour and
 * gives NO refresh token. So a mailbox that was connected yesterday reads as
 * "disconnected" today even though nothing was revoked.
 *
 * What this module does, and — just as important — what it no longer does:
 *
 *   • On app start and whenever a tab regains focus it ADOPTS a cached token
 *     that is still live. That is the whole of the automatic behaviour.
 *   • It re-mints a token only when an operation actually needs one
 *     (`getLiveGmailToken` / `ensureFreshGmailToken`), preferring the
 *     server-held refresh token, which needs no popup and no open tab.
 *
 * It used to re-mint automatically on load, every 45 minutes and on every
 * focus. `requestAccessToken({ prompt: '' })` skips the *consent* screen, but
 * it still opens Google's OAuth window — on desktop the browser blocked it
 * ("Failed to open popup window" in the console, harmless), on a phone it
 * opened full-screen as a Google sign-in the moment the app loaded, and the
 * app was unusable behind it. A background job must never be allowed to put a
 * Google login in front of someone who was opening their CRM.
 *
 * LIMIT worth being honest about: the implicit browser flow cannot refresh
 * without a Google window. Staying connected with no popups at all requires
 * the permanent connection (authorization-code flow in gmailServerAuth), which
 * the UI offers and this module prefers whenever it exists.
 */

import {
  loadAgentConfig, saveAgentConfig, requestGmailTokenSilent, getActiveToken, adoptToken,
} from './gmailAgent';
import type { EmailAgentConfig } from '../types';

/** Re-mint when fewer than this many ms remain, so callers never race expiry. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;   // 10 minutes
const TOKEN_LIFE_MS     = 58 * 60 * 1000;   // what we record after a refresh

let currentWid: string | null = null;
let fallbackClientId: string | undefined;
let inFlight: Promise<boolean> | null = null;
let lastResult: { at: number; ok: boolean; email?: string } = { at: 0, ok: false };

export interface KeepAliveState {
  ok: boolean;
  email?: string;
  checkedAt: number;
}

export function getKeepAliveState(): KeepAliveState {
  return { ok: lastResult.ok, email: lastResult.email, checkedAt: lastResult.at };
}

/**
 * A phone or tablet. The implicit OAuth window cannot be opened silently there:
 * it takes over the screen. On these devices only the server-held connection
 * refreshes on its own; the browser flow runs only from an explicit reconnect.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Bring any still-live cached token into memory. No network, no Google window.
 * This is everything the automatic path is allowed to do.
 */
async function adoptCachedTokens(wid: string): Promise<boolean> {
  try {
    const cfg = await loadAgentConfig(wid);
    const accounts = cfg?.accounts?.filter(a => a.provider === 'gmail') ?? [];
    let anyLive = false;
    let liveEmail: string | undefined;
    for (const acct of accounts) {
      const healthy = acct.cachedToken && acct.cachedTokenExpiry
        && acct.cachedTokenExpiry - Date.now() > REFRESH_MARGIN_MS;
      if (healthy) {
        adoptToken(acct.cachedToken!, acct.cachedTokenExpiry!);
        anyLive = true; liveEmail ??= acct.email;
      }
    }
    lastResult = { at: Date.now(), ok: anyLive, email: liveEmail };
    return anyLive;
  } catch {
    lastResult = { at: Date.now(), ok: false };
    return false;
  }
}

/**
 * Refresh every Gmail account whose token is missing or near expiry.
 * Returns true if at least one account ended up with a live token.
 * Concurrent calls share one run.
 *
 * This opens Google's OAuth window when a re-mint is needed, so it is called
 * only from an operation the user started — never from a timer or on load.
 */
export async function refreshGmailTokens(
  wid: string,
  clientIdFallback?: string,
  force = false,
): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const cfg = await loadAgentConfig(wid);
      const accounts = cfg?.accounts?.filter(a => a.provider === 'gmail') ?? [];
      if (!accounts.length) { lastResult = { at: Date.now(), ok: false }; return false; }

      let changed = false;
      let anyLive = false;
      let liveEmail: string | undefined;
      const next = [...(cfg!.accounts ?? [])];

      for (const acct of accounts) {
        const healthy = acct.cachedTokenExpiry
          && acct.cachedTokenExpiry - Date.now() > REFRESH_MARGIN_MS;
        if (healthy && !force) {
          if (acct.cachedToken) adoptToken(acct.cachedToken, acct.cachedTokenExpiry!);
          anyLive = true; liveEmail ??= acct.email;
          continue;
        }

        // On a phone the "silent" request is a full-screen Google page. Not from
        // here; the explicit reconnect button is the only place that may do it.
        if (isTouchDevice()) continue;

        const clientId = acct.clientId || clientIdFallback;
        if (!clientId) continue;

        try {
          const token = await requestGmailTokenSilent(clientId, acct.email);
          const i = next.findIndex(a => a.id === acct.id);
          if (i !== -1) {
            next[i] = { ...next[i], cachedToken: token, cachedTokenExpiry: Date.now() + TOKEN_LIFE_MS };
            changed = true;
          }
          anyLive = true; liveEmail ??= acct.email;
        } catch {
          // Consent is needed again (revoked, signed out, different client).
          // Leave the account alone — the UI still offers an explicit reconnect.
        }
      }

      if (changed) {
        await saveAgentConfig(wid, { ...(cfg as EmailAgentConfig), accounts: next });
      }
      lastResult = { at: Date.now(), ok: anyLive, email: liveEmail };
      return anyLive;
    } catch {
      lastResult = { at: Date.now(), ok: false };
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * The token to use right now: the cached one if it is still live, otherwise the
 * server-held connection, otherwise a re-minted browser token.
 *
 * Every surface should call this instead of `getActiveToken()`. That accessor
 * is synchronous and only reports the in-memory token, which is why a mailbox
 * connected an hour ago reported itself disconnected.
 *
 * Returns null only when consent is genuinely gone — revoked, or signed out.
 */
export async function getLiveGmailToken(
  wid?: string | null,
  clientIdFallback?: string,
): Promise<string | null> {
  const cached = getActiveToken();
  if (cached) return cached;
  if (!wid) return null;

  // Prefer the server-held refresh token: it works with no popup, no open tab
  // and no recent user activity, which is everything the browser flow cannot do.
  const { getServerGmailToken } = await import('./gmailServerAuth');
  const server = await getServerGmailToken(wid);
  if (server) return server;

  // Fall back to the old implicit flow so a workspace that connected the old
  // way keeps working until it is reconnected properly.
  const ok = await refreshGmailTokens(wid, clientIdFallback);
  return ok ? getActiveToken() : null;
}

/** Call before any operation that needs a live token right now. */
export async function ensureFreshGmailToken(wid: string, clientIdFallback?: string): Promise<boolean> {
  return refreshGmailTokens(wid, clientIdFallback);
}

function onFocus() {
  // A wake-up can find a token that expired hours ago. Re-read the cache; do
  // not mint — that would put a Google window on screen unasked.
  if (document.visibilityState === 'visible' && currentWid) {
    void adoptCachedTokens(currentWid);
  }
}

/**
 * Start tracking this workspace's Gmail connection. Idempotent, and safe to
 * call again when the workspace changes. Adopts cached tokens; never mints.
 */
export function startGmailKeepAlive(wid: string | undefined | null, clientIdFallback?: string): void {
  stopGmailKeepAlive();
  if (!wid) return;

  currentWid = wid;
  fallbackClientId = clientIdFallback;

  void adoptCachedTokens(wid);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('online', onFocus);
}

export function stopGmailKeepAlive(): void {
  document.removeEventListener('visibilitychange', onFocus);
  window.removeEventListener('online', onFocus);
  currentWid = null;
  fallbackClientId = undefined;
}
