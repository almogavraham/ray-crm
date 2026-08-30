/**
 * adminImpersonation.ts — let a superadmin open a customer workspace as if they
 * were inside it.
 *
 * How it works, and why this way:
 *
 * The whole app derives its Firestore paths from one value — the workspace the
 * AuthContext is subscribed to. So rather than threading an "acting as" flag
 * through every page, impersonation just points that single subscription at a
 * different workspace id. Leads, settings, agents and automations then all read
 * the customer's data with no further changes.
 *
 * Deliberate choices:
 *  • The superadmin's own `users/{uid}.workspaceId` is NEVER rewritten. Editing
 *    it would be a persistent, easy-to-forget change to a real account, and a
 *    failed cleanup would leave the admin stranded in someone else's workspace.
 *  • State lives in sessionStorage, so it dies with the tab. An admin cannot
 *    accidentally still be impersonating next week.
 *  • Firestore rules already grant the superadmin access to every workspace, so
 *    this needs no rule changes and grants no new privilege — it only changes
 *    which workspace the UI points at.
 */

const KEY = 'ray:admin-impersonate';

export interface Impersonation {
  workspaceId: string;
  workspaceName: string;
  startedAt: number;
}

const listeners = new Set<() => void>();

export function getImpersonation(): Impersonation | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Impersonation;
    return v && typeof v.workspaceId === 'string' && v.workspaceId ? v : null;
  } catch {
    return null;
  }
}

/** Begin acting inside `workspaceId`. Caller reloads so every subscription re-runs. */
export function startImpersonation(workspaceId: string, workspaceName: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      workspaceId, workspaceName, startedAt: Date.now(),
    } satisfies Impersonation));
  } catch { /* private mode — impersonation simply won't stick */ }
  listeners.forEach(l => l());
}

export function stopImpersonation(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach(l => l());
}

export function subscribeImpersonation(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
