/**
 * gmailKeepAlive.ts — keeps the Gmail connection alive for as long as the app is.
 *
 * Google hands a browser client an access token that expires in ~1 hour and
 * gives NO refresh token. So a mailbox that was connected yesterday reads as
 * "disconnected" today even though nothing was revoked — which is exactly the
 * failure the user kept hitting.
 *
 * The fix available to a pure browser app is to re-mint continuously. Because
 * consent was already granted, `prompt: ''` returns a fresh token with no popup
 * and no user interaction. This module does that:
 *
 *   • once on app start,
 *   • every 45 minutes while a tab is open,
 *   • whenever the tab regains focus (covers laptop sleep, which stops timers),
 *   • and on demand, before any operation that needs a live token.
 *
 * The refreshed token is written back to Firestore, so every surface (email
 * agent, copilots, scheduled scans that run while a tab is open) sees it.
 *
 * LIMIT worth being honest about: this only runs while the app is open in a
 * browser. Staying connected with every tab closed needs the server to hold a
 * refresh token, which requires switching from the implicit token flow to the
 * authorization-code flow (`initCodeClient` + `access_type=offline`) and
 * exchanging the code in a Cloud Function that holds the client secret.
 */

import { loadAgentConfig, saveAgentConfig, requestGmailTokenSilent } from './gmailAgent';
import type { EmailAgentConfig } from '../types';

/** Re-mint when fewer than this many ms remain, so callers never race expiry. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;   // 10 minutes
const REFRESH_EVERY_MS  = 45 * 60 * 1000;   // comfortably inside the ~60-min life
const TOKEN_LIFE_MS     = 58 * 60 * 1000;   // what we record after a refresh

let timer: ReturnType<typeof setInterval> | null = null;
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
 * Refresh every Gmail account whose token is missing or near expiry.
 * Returns true if at least one account ended up with a live token.
 * Concurrent calls share one run — several surfaces mount at once on load.
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
          anyLive = true; liveEmail ??= acct.email;
          continue;
        }

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
          // Silent refresh needs consent again (revoked, signed out of Google,
          // or a different client). Leave the account alone — the UI still
          // offers an explicit reconnect.
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

/** Call before any operation that needs a live token right now. */
export async function ensureFreshGmailToken(wid: string, clientIdFallback?: string): Promise<boolean> {
  return refreshGmailTokens(wid, clientIdFallback);
}

function onFocus() {
  // Timers do not fire while the machine sleeps, so a wake-up can find a token
  // that expired hours ago. Re-check whenever the tab becomes visible again.
  if (document.visibilityState === 'visible' && currentWid) {
    void refreshGmailTokens(currentWid, fallbackClientId);
  }
}

/**
 * Start keeping this workspace's Gmail connection alive. Idempotent, and safe
 * to call again when the workspace changes.
 */
export function startGmailKeepAlive(wid: string | undefined | null, clientIdFallback?: string): void {
  stopGmailKeepAlive();
  if (!wid) return;

  currentWid = wid;
  fallbackClientId = clientIdFallback;

  void refreshGmailTokens(wid, clientIdFallback);
  timer = setInterval(() => { void refreshGmailTokens(wid, clientIdFallback); }, REFRESH_EVERY_MS);

  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('online', onFocus);
}

export function stopGmailKeepAlive(): void {
  if (timer) { clearInterval(timer); timer = null; }
  document.removeEventListener('visibilitychange', onFocus);
  window.removeEventListener('online', onFocus);
  currentWid = null;
}
