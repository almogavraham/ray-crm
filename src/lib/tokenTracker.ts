/**
 * tokenTracker.ts
 * Core token-balance system — tracks AI API cost per workspace and manages
 * credits (plan allocation, top-ups) and debits (actual Claude usage).
 *
 * All amounts are in USD with up to 6 decimal places of precision.
 */

import {
  doc, getDoc, updateDoc, arrayUnion, increment, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import type { TokenHistoryEntry } from '../types';

/* ── Claude model pricing (USD per 1 million tokens) ──────────────────────── */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Opus 4 family
  'claude-opus-4-6':              { input: 15,   output: 75   },
  'claude-opus-4':                { input: 15,   output: 75   },
  'claude-3-opus-20240229':       { input: 15,   output: 75   },
  // Sonnet 3.5 / 3.7 family
  'claude-sonnet-4-5':            { input: 3,    output: 15   },
  'claude-3-7-sonnet-20250219':   { input: 3,    output: 15   },
  'claude-3-5-sonnet-20241022':   { input: 3,    output: 15   },
  'claude-3-5-sonnet-20240620':   { input: 3,    output: 15   },
  'claude-3-sonnet-20240229':     { input: 3,    output: 15   },
  // Haiku family
  'claude-3-5-haiku-20241022':    { input: 0.8,  output: 4    },
  'claude-3-haiku-20240307':      { input: 0.25, output: 1.25 },
};

const DEFAULT_PRICING = { input: 3, output: 15 }; // safe fallback (Sonnet)

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Calculate USD cost from token counts. */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const cost =
    (inputTokens  / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  return parseFloat(cost.toFixed(6));
}

/** Workspace Firestore ref. */
const wsRef = (workspaceId: string) => doc(db, 'workspaces', workspaceId);

/* ── Read ─────────────────────────────────────────────────────────────────── */

/** Returns current token balance in USD. Returns null if workspace not found. */
export async function getTokenBalance(workspaceId: string): Promise<number | null> {
  const snap = await getDoc(wsRef(workspaceId));
  if (!snap.exists()) return null;
  return (snap.data()?.tokenBalance as number) ?? 0;
}

/** Returns true if the workspace has any positive balance. */
export async function hasBalance(workspaceId: string): Promise<boolean> {
  const bal = await getTokenBalance(workspaceId);
  return bal !== null && bal > 0.000001; // ignore sub-micro-cent rounding
}

/* ── Write ────────────────────────────────────────────────────────────────── */

/**
 * Deduct cost from workspace token balance after a successful AI call.
 * Uses a Firestore transaction to avoid race conditions.
 * Clamps balance at 0 (never goes negative).
 */
export async function deductTokens(
  workspaceId: string,
  cost:        number,
  model:       string,
  description: string,
): Promise<void> {
  if (cost <= 0) return;

  const entry: TokenHistoryEntry = {
    id:          `use_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type:        'usage',
    amount:      -cost,
    model,
    description,
    timestamp:   new Date().toISOString(),
  };

  const ref = wsRef(workspaceId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const currentBalance: number = (snap.data()?.tokenBalance as number) ?? 0;
    const newBalance = Math.max(0, currentBalance - cost);
    tx.update(ref, {
      tokenBalance: newBalance,
      tokenUsed:    increment(cost),
      tokenHistory: arrayUnion(entry),
    });
  });
}

/**
 * Add tokens to a workspace balance (plan grant, top-up, or manual admin credit).
 */
export async function addTokens(
  workspaceId: string,
  dollars:     number,
  type:        'plan' | 'topup' | 'manual',
  description: string,
): Promise<void> {
  if (dollars <= 0) return;

  const entry: TokenHistoryEntry = {
    id:          `add_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    amount:      dollars,
    description,
    timestamp:   new Date().toISOString(),
  };

  await updateDoc(wsRef(workspaceId), {
    tokenBalance: increment(dollars),
    tokenHistory: arrayUnion(entry),
    ...(type === 'plan' ? { tokenPlanAllocation: dollars } : {}),
  });
}

/**
 * Grant plan tokens when a workspace is assigned a plan.
 * Replaces any previous plan allocation (does NOT stack plan grants).
 */
export async function grantPlanTokens(
  workspaceId:  string,
  planName:     string,
  dollars:      number,
): Promise<void> {
  if (dollars <= 0) return;

  const entry: TokenHistoryEntry = {
    id:          `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type:        'plan',
    amount:      dollars,
    description: `Plan: ${planName} — $${dollars} token allocation`,
    timestamp:   new Date().toISOString(),
  };

  // Set balance to plan amount (replaces, does not accumulate)
  await updateDoc(wsRef(workspaceId), {
    tokenBalance:        dollars,
    tokenPlanAllocation: dollars,
    tokenUsed:           0,
    tokenHistory:        arrayUnion(entry),
  });
}

/* ── Top-up packages ─────────────────────────────────────────────────────── */
export const TOPUP_PACKAGES = [
  { id: 'topup5',  dollars: 5,  label: '$5',  tokens: '~1.6M tokens' },
  { id: 'topup10', dollars: 10, label: '$10', tokens: '~3.3M tokens' },
  { id: 'topup25', dollars: 25, label: '$25', tokens: '~8.3M tokens' },
] as const;

/* ── Plan token config (read from Firestore system/config) ──────────────── */
export type PlanTokenConfig = Record<string, number>; // plan → USD amount

export const DEFAULT_PLAN_TOKEN_AMOUNTS: PlanTokenConfig = {
  trial:      1,
  basic:      10,
  pro:        50,
  enterprise: 200,
};

export async function getPlanTokenConfig(): Promise<PlanTokenConfig> {
  try {
    const snap = await getDoc(doc(db, 'system', 'config'));
    return (snap.data()?.planTokenAmounts as PlanTokenConfig) ?? DEFAULT_PLAN_TOKEN_AMOUNTS;
  } catch {
    return DEFAULT_PLAN_TOKEN_AMOUNTS;
  }
}

/* ── Convenience: format balance for display ─────────────────────────────── */
export function formatBalance(dollars: number): string {
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars > 0)  return `$${dollars.toFixed(4)}`;
  return '$0.00';
}

/** Returns % of plan allocation remaining (0–100). */
export function balancePercent(balance: number, planAllocation: number): number {
  if (planAllocation <= 0) return 100;
  return Math.min(100, Math.round((balance / planAllocation) * 100));
}
