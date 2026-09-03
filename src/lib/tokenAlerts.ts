/**
 * tokenAlerts.ts — warn a workspace before its AI credit runs out.
 *
 * Running out of tokens stops the AI features working. Until now the only sign
 * was the sidebar meter turning amber, which nobody watches — so the first a
 * customer knew of it was a feature that stopped answering.
 *
 * Two things the wording has to get right:
 *
 *  • **What to tell them to do depends on what they already have.** Someone on
 *    the opening gift has to buy a plan; someone already paying for one only
 *    needs to top up. Telling a paying customer to "buy a plan" reads as a
 *    system that does not know they are already a customer.
 *
 *  • **It must fire once.** The balance is read on every render, so a naive
 *    check would create a notification per render. Each threshold is recorded
 *    on the workspace after firing, and only a recovery above the threshold
 *    clears it — so a customer who tops up and drains again is warned again,
 *    and one who simply sits near the line is not.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { createNotification } from './notifications';
import { balancePercent } from './tokenTracker';
import type { WorkspaceProfile } from '../types';

/** Below this share of the plan allocation, the balance counts as low. */
const LOW_PCT = 20;

/** Anything at or under this is spent — floating point, so not exactly zero. */
const EMPTY = 0.000001;

type Stage = 'low' | 'empty';

/** Plans that mean the customer is already paying. */
const PAYING = new Set(['basic', 'pro', 'enterprise']);

function wording(stage: Stage, isPaying: boolean) {
  if (stage === 'empty') {
    return isPaying
      ? { title: 'הטוקנים נגמרו', body: 'יתרת הטוקנים שלך אזלה ויכולות ה-AI מושבתות. יש לרכוש טוקנים כדי להמשיך.' }
      : { title: 'הטוקנים נגמרו', body: 'יתרת הטוקנים שלך אזלה ויכולות ה-AI מושבתות. יש לרכוש מסלול כדי להמשיך.' };
  }
  return isPaying
    ? { title: 'יתרת הטוקנים נמוכה', body: 'יתרת הטוקנים שלך עומדת להיגמר. יש לרכוש טוקנים.' }
    : { title: 'יתרת הטוקנים נמוכה', body: 'יתרת הטוקנים שלך עומדת להיגמר. יש לרכוש מסלול.' };
}

/**
 * Check the balance and notify if it has just crossed a threshold.
 *
 * Safe to call on every load: it writes at most one notification per crossing,
 * and never throws — a failed warning must not take down the screen that
 * triggered it.
 */
export async function checkTokenBalance(workspace: WorkspaceProfile | null | undefined): Promise<void> {
  if (!workspace?.id) return;

  const balance = workspace.tokenBalance ?? 0;
  const alloc   = workspace.tokenPlanAllocation ?? 0;
  // A workspace with no allocation has nothing to be low against — that is a
  // configuration state, not a warning worth sending.
  if (alloc <= 0) return;

  const stage: Stage | null =
    balance <= EMPTY ? 'empty'
    : balancePercent(balance, alloc) < LOW_PCT ? 'low'
    : null;

  const alerted = (workspace as { tokenAlertStage?: Stage | null }).tokenAlertStage ?? null;

  // Recovered: clear the marker so the next fall warns again.
  if (!stage) {
    if (alerted) {
      await updateDoc(doc(db, 'workspaces', workspace.id), { tokenAlertStage: null }).catch(() => {});
    }
    return;
  }

  // Already warned at this stage, or already warned about the worse one.
  if (alerted === stage || (alerted === 'empty' && stage === 'low')) return;

  const isPaying = PAYING.has(String(workspace.plan ?? ''));
  const { title, body } = wording(stage, isPaying);

  await createNotification(workspace.id, { type: 'info', title, body, link: 'billing' });
  await updateDoc(doc(db, 'workspaces', workspace.id), { tokenAlertStage: stage }).catch(() => {});
}
