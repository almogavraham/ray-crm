/**
 * openLeadCards.ts — several lead cards open at once.
 *
 * The card used to be a single `selectedLead`: opening one closed the last.
 * That is fine for "look at this lead" and useless for the thing people
 * actually do — compare two, copy a price from one into another, work a
 * shortlist without losing their place each time.
 *
 * The list is an ORDER, not a set: the last id is the front-most card. Opening
 * an already-open lead does not open a second copy of it — it raises the one
 * that exists, because two windows onto one record would each hold their own
 * unsaved edits and the last one closed would win.
 *
 * Capped, because unbounded is not a feature here. Click through a list of
 * thirty leads and thirty windows is not "power user", it is a screen you have
 * to clean up. At the cap the LEAST RECENTLY RAISED card closes — the one the
 * user has not touched in the longest time, which is the one they are done
 * with. Its edits are safe: the card autosaves and flushes on unmount.
 *
 * On a narrow screen the cards are full-screen sheets, so stacking them would
 * hide all but the top one behind a card the user cannot see to close. There,
 * one at a time is the honest behaviour.
 */

import { useCallback, useState } from 'react';

/** How many cards may be open at once on a wide screen. */
export const MAX_OPEN_CARDS = 4;

/** Base stacking order. Cards sit at BASE_Z + position, below nested dialogs. */
const BASE_Z = 50;

export interface OpenCards {
  /** Open lead ids, back to front. */
  ids: string[];
  open: (id: string) => void;
  close: (id: string) => void;
  /** Raise a card to the front. */
  focus: (id: string) => void;
  /** z-index for a card, so the focused one draws over the others. */
  zOf: (id: string) => number;
  /** The card's position slot — stable for as long as it stays open. */
  slotOf: (id: string) => number;
}

/**
 * @param multi   false on narrow screens, where each card is a full-screen
 *                sheet and a second one would simply hide the first.
 * @param onEvict Called with the id of a card closed to make room at the cap.
 *                A window vanishing with no explanation reads as a bug, so the
 *                caller gets the chance to say what happened.
 */
interface State {
  /** Open ids, back to front. Reordered by focus. */
  ids: string[];
  /**
   * Which position slot each open card holds.
   *
   * Kept apart from `ids` on purpose. Slots decide the remembered position, so
   * deriving one from the stack order would re-key every card each time one was
   * raised — and clicking a card to bring it forward would quietly reassign
   * where it is remembered. A slot is claimed on open and released on close.
   */
  slots: Record<string, number>;
}

/** Lowest slot nobody is holding, so a closed card's spot gets reused. */
function freeSlot(slots: Record<string, number>): number {
  const taken = new Set(Object.values(slots));
  for (let i = 0; i < MAX_OPEN_CARDS; i++) if (!taken.has(i)) return i;
  return 0;
}

export function useOpenLeadCards(multi: boolean, onEvict?: (id: string) => void): OpenCards {
  const [{ ids, slots }, setState] = useState<State>({ ids: [], slots: {} });

  const open = useCallback((id: string) => {
    setState(prev => {
      if (!multi) return { ids: [id], slots: { [id]: 0 } };
      // Already open: raise it rather than duplicate it, and leave its slot be.
      if (prev.ids.includes(id)) {
        return { ...prev, ids: [...prev.ids.filter(x => x !== id), id] };
      }

      let ids = [...prev.ids, id];
      const slots = { ...prev.slots };

      if (ids.length > MAX_OPEN_CARDS) {
        // Over the cap. The front of the array is the least recently raised —
        // the card the user has gone longest without touching.
        const evicted = ids[0];
        ids = ids.slice(1);
        delete slots[evicted];
        // Deferred: this runs inside a state updater, and a toast that sets
        // state synchronously here would be a render during a render.
        if (onEvict) queueMicrotask(() => onEvict(evicted));
      }

      slots[id] = freeSlot(slots);
      return { ids, slots };
    });
  }, [multi, onEvict]);

  const close = useCallback((id: string) => {
    setState(prev => {
      const slots = { ...prev.slots };
      delete slots[id];
      return { ids: prev.ids.filter(x => x !== id), slots };
    });
  }, []);

  const focus = useCallback((id: string) => {
    setState(prev => (
      // Cheap no-op when it is already on top: this runs on every pointer down
      // inside a card, and new state each time would re-render all of them.
      prev.ids[prev.ids.length - 1] === id || !prev.ids.includes(id)
        ? prev
        : { ...prev, ids: [...prev.ids.filter(x => x !== id), id] }
    ));
  }, []);

  const zOf = useCallback((id: string) => BASE_Z + Math.max(0, ids.indexOf(id)), [ids]);
  const slotOf = useCallback((id: string) => slots[id] ?? 0, [slots]);

  return { ids, open, close, focus, zOf, slotOf };
}
