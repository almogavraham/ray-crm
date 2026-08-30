/**
 * chatSessionStore.ts — conversation state that outlives the chat window.
 *
 * The three copilots used to keep everything in component state, which meant
 * closing the window threw away the conversation *and* orphaned any request
 * still in flight: the promise kept running, resolved into a component that no
 * longer existed, and the answer vanished.
 *
 * Moving the session here fixes all three things at once:
 *  • History survives close/reopen, and a page refresh (localStorage).
 *  • A request that is still running when you close the window keeps going,
 *    because it writes to this store rather than to a React component.
 *  • Answers that land while the window is shut bump an `unread` counter, which
 *    the floating buttons render as a badge.
 *
 * Sessions are keyed by workspace so switching workspaces can't leak one
 * client's conversation into another's window.
 */

import { useSyncExternalStore } from 'react';

export type ChatId = 'sales' | 'marketing' | 'automation';

export interface ChatSession<M = unknown> {
  msgs: M[];
  /** A request is in flight (kept here so reopening still shows the spinner). */
  busy: boolean;
  /** Label for a long-running action, e.g. "יוצר תמונות (2/6)…". */
  working: string | null;
  /** Answers that arrived while the window was closed. */
  unread: number;
  /** Whether the opening briefing has already been generated. */
  booted: boolean;
  /** Window currently mounted. */
  open: boolean;
  /** Per-chat scratch state (the automation builder's live draft, etc.). */
  extra: Record<string, unknown>;
}

const EMPTY: ChatSession = {
  msgs: [], busy: false, working: null, unread: 0, booted: false, open: false, extra: {},
};

/** Cap what we keep — long chats would otherwise blow the localStorage quota. */
const MAX_PERSISTED = 40;

const sessions = new Map<string, ChatSession>();
const listeners = new Set<() => void>();

let scope = 'default';

/** Point the store at a workspace. Switching scope hides the other one's chats. */
export function setChatScope(wid: string | undefined | null): void {
  const next = wid || 'default';
  if (next === scope) return;
  scope = next;
  sessions.clear();
  emit();
}

const keyOf = (id: ChatId) => `${scope}:${id}`;
const storageKey = (id: ChatId) => `ray:chat:${scope}:${id}`;

function emit() { listeners.forEach(l => l()); }

/** Load a persisted conversation. Anything unparseable is discarded silently. */
function hydrate(id: ChatId): ChatSession {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (raw) {
      const saved = JSON.parse(raw) as { msgs?: unknown[]; booted?: boolean; extra?: Record<string, unknown> };
      if (Array.isArray(saved.msgs)) {
        return { ...EMPTY, msgs: saved.msgs, booted: Boolean(saved.booted), extra: saved.extra ?? {} };
      }
    }
  } catch { /* quota, private mode, or corrupt entry — start fresh */ }
  return { ...EMPTY };
}

function persist(id: ChatId, s: ChatSession): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify({
      msgs: s.msgs.slice(-MAX_PERSISTED),
      booted: s.booted,
      extra: s.extra,
    }));
  } catch { /* over quota — the in-memory session still works for this tab */ }
}

export function getSession<M = unknown>(id: ChatId): ChatSession<M> {
  const k = keyOf(id);
  let s = sessions.get(k);
  if (!s) { s = hydrate(id); sessions.set(k, s); }
  return s as ChatSession<M>;
}

/**
 * Apply a patch. Always produces a NEW session object — useSyncExternalStore
 * compares snapshots by identity, so mutating in place would not re-render.
 */
export function updateSession(id: ChatId, patch: Partial<ChatSession> | ((s: ChatSession) => Partial<ChatSession>)): void {
  const k = keyOf(id);
  const cur = getSession(id);
  const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
  sessions.set(k, next);
  persist(id, next);
  emit();
}

/**
 * Append a message. When the window is closed this is what turns into a badge —
 * only assistant messages count, since the user always knows what they typed.
 */
export function appendMessage<M>(id: ChatId, msg: M, opts: { countsAsUnread?: boolean } = {}): void {
  const cur = getSession(id);
  const counts = opts.countsAsUnread ?? true;
  updateSession(id, {
    msgs: [...cur.msgs, msg],
    unread: !cur.open && counts ? cur.unread + 1 : cur.unread,
  });
}

/** Replace the whole message list (used when echoing the user's own turn). */
export function setMessages<M>(id: ChatId, msgs: M[] | ((prev: M[]) => M[])): void {
  const cur = getSession(id);
  const next = typeof msgs === 'function' ? (msgs as (p: M[]) => M[])(cur.msgs as M[]) : msgs;
  updateSession(id, { msgs: next as unknown[] });
}

export function setOpen(id: ChatId, open: boolean): void {
  updateSession(id, open ? { open: true, unread: 0 } : { open: false });
}

export function clearSession(id: ChatId): void {
  sessions.set(keyOf(id), { ...EMPTY });
  try { localStorage.removeItem(storageKey(id)); } catch { /* ignore */ }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Subscribe a component to one chat's session. */
export function useChatSession<M = unknown>(id: ChatId): ChatSession<M> {
  return useSyncExternalStore(
    subscribe,
    () => getSession<M>(id),
    () => getSession<M>(id),
  );
}

/** Badge state for a floating button: unread count plus "still thinking". */
export function useChatBadge(id: ChatId): { unread: number; busy: boolean } {
  const s = useChatSession(id);
  return { unread: s.unread, busy: s.busy || Boolean(s.working) };
}
