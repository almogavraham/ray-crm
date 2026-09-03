/**
 * chatDigest.ts — what the specialist chats have been talking about, in a form
 * the general assistant can read.
 *
 * There are five chats. Four are specialists — sales, marketing, automations,
 * mail — and each keeps its own conversation. The fifth, the general assistant,
 * knew nothing about any of them, so "what did we decide about the מרקטינג
 * campaign?" got a blank stare from the one chat the user thinks of as the one
 * that knows everything.
 *
 * This turns the other four sessions into a short briefing that is appended to
 * the assistant's system prompt. It is a digest, not a transcript: the last few
 * turns of each, truncated, newest last. That is deliberate —
 *
 *  • A full transcript of four chats would dwarf the pipeline data in the same
 *    prompt and cost real money on every single message.
 *  • The assistant needs to know what was discussed and decided, not to replay
 *    every word. If it needs the detail, the user still has the chat open.
 *
 * Reading is one-way. The assistant sees the specialists; the specialists do
 * not see it. Feeding its answers back into their prompts would make four
 * conversations echo each other, and there would be no way to tell which chat
 * originally said a thing.
 */

import { useSyncExternalStore } from 'react';
import { getSession, subscribe } from './chatSessionStore';
import type { ChatId } from './chatSessionStore';

/** Every chat's message shape starts with these two fields. */
interface AnyMsg { role?: string; text?: string; content?: string }

const CHATS: { id: ChatId; label: string }[] = [
  { id: 'sales',      label: 'RAY SALES (מכירות ולידים)' },
  { id: 'marketing',  label: 'RAY MARKETING (שיווק וקמפיינים)' },
  { id: 'automation', label: 'בונה האוטומציות' },
  { id: 'mail',       label: 'RAY MAIL (מיילים)' },
];

/** Turns per chat. Enough to carry a decision and its reason, not a transcript. */
const TURNS_PER_CHAT = 6;
/** Characters per turn. A long answer's opening usually carries its point. */
const MAX_CHARS = 320;

const textOf = (m: AnyMsg): string => {
  const raw = typeof m?.text === 'string' ? m.text
    : typeof m?.content === 'string' ? m.content : '';
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS) + '…' : clean;
};

/**
 * A Hebrew briefing of the other chats, or '' when they are all empty — an
 * empty string so the caller can skip the block entirely rather than send the
 * model a heading with nothing under it.
 */
export function buildChatDigest(exclude?: ChatId): string {
  const parts: string[] = [];

  for (const { id, label } of CHATS) {
    if (id === exclude) continue;
    const msgs = (getSession(id).msgs ?? []) as AnyMsg[];
    if (!msgs.length) continue;

    const recent = msgs.slice(-TURNS_PER_CHAT)
      .map(m => {
        const t = textOf(m);
        if (!t) return '';
        return `${m.role === 'user' ? 'המשתמש' : 'הצ׳אט'}: ${t}`;
      })
      .filter(Boolean);
    if (!recent.length) continue;

    parts.push(`— ${label} (${msgs.length} הודעות בשיחה):\n${recent.join('\n')}`);
  }

  if (!parts.length) return '';

  return [
    '\n══ מה נאמר בצ׳אטים האחרים ══',
    'אתה המוח המרכזי של המערכת ורואה גם את השיחות של הצ׳אטים המתמחים.',
    'זהו תקציר של ההודעות האחרונות בכל צ׳אט — לא התמלול המלא.',
    'השתמש בזה כדי לענות על שאלות המשך ("מה סיכמנו עם...", "מה הצ׳אט של השיווק אמר")',
    'ולהצליב מידע בין תחומים. אל תמציא פרטים שלא מופיעים כאן —',
    'אם חסר לך מידע, אמור זאת והפנה לצ׳אט הרלוונטי.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

/** Which chats currently hold a conversation — drives the "המוח" indicator. */
export function activeChatLabels(exclude?: ChatId): string[] {
  return CHATS
    .filter(c => c.id !== exclude && (getSession(c.id).msgs ?? []).length > 0)
    .map(c => c.label.replace(/\s*\(.*\)$/, ''));
}

/**
 * The same list, kept live.
 *
 * `useChatSession` subscribes to one chat; this reads across all four, so it
 * subscribes to the store itself. The snapshot is joined into a string because
 * `useSyncExternalStore` compares by identity and a fresh array every call
 * would loop forever.
 */
export function useBrainSources(exclude?: ChatId): string[] {
  const joined = useSyncExternalStore(
    subscribe,
    () => activeChatLabels(exclude).join('|'),
    () => activeChatLabels(exclude).join('|'),
  );
  return joined ? joined.split('|') : [];
}
