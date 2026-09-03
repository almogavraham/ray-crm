/**
 * tokenTracker.ts
 * Core token-balance system — tracks AI API cost per workspace and manages
 * credits (plan allocation, top-ups) and debits (actual Claude usage).
 *
 * All amounts are in USD with up to 6 decimal places of precision.
 */

import {
  doc, getDoc, updateDoc, arrayUnion, increment, runTransaction, setDoc,
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
/**
 * Multiplier applied to real Anthropic cost when deducting from a client workspace.
 * Client pays 2x the real cost → admin earns 50% margin on every AI call.
 * Real cost is also deducted from the admin quota for accurate budget tracking.
 */
export const CLIENT_COST_MULTIPLIER = 2;

/**
 * Deduct cost from workspace token balance after a successful AI call.
 * - Client balance  decreases by  cost × CLIENT_COST_MULTIPLIER  (virtual)
 * - Admin quota     decreases by  cost                            (real)
 * Uses a Firestore transaction to avoid race conditions.
 */
/** Threshold (% of plan allocation) below which we flag a workspace as low-balance */
export const TOKEN_LOW_PCT = 20;

export async function deductTokens(
  workspaceId: string,
  cost:        number,
  model:       string,
  description: string,
): Promise<void> {
  if (cost <= 0) return;

  // What the client "pays" in their virtual balance
  const clientDeduction = parseFloat((cost * CLIENT_COST_MULTIPLIER).toFixed(6));

  const entry: TokenHistoryEntry = {
    id:          `use_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type:        'usage',
    amount:      -clientDeduction,   // client sees 2× usage
    model,
    description,
    timestamp:   new Date().toISOString(),
  };

  const ref = wsRef(workspaceId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const currentBalance: number = (data.tokenBalance as number) ?? 0;
    const planAllocation: number = (data.tokenPlanAllocation as number) ?? 0;
    const newBalance = Math.max(0, currentBalance - clientDeduction);

    // Flag workspace as low-balance if below threshold
    const pct = planAllocation > 0 ? (newBalance / planAllocation) * 100 : 0;
    const isLow = newBalance <= 0.000001 || (planAllocation > 0 && pct < TOKEN_LOW_PCT);

    tx.update(ref, {
      tokenBalance:   newBalance,
      tokenUsed:      increment(cost),          // track REAL cost for analytics
      tokenHistory:   arrayUnion(entry),
      tokenLowAlert:  isLow,                    // workspace alert flag
    });
  });

  // Deduct real cost from admin's Anthropic budget (best-effort)
  deductFromAdminQuota(cost).catch(console.error);
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
    tokenBalance:  increment(dollars),
    tokenHistory:  arrayUnion(entry),
    tokenLowAlert: false,          // clear alert when tokens are added
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

/**
 * What each plan is worth in AI credit, in dollars of real Anthropic spend.
 *
 * These are the operator's cost, not a price shown to anyone: the customer sees
 * a token count, never this figure. Kept in dollars because that is the unit
 * the credit is actually bought in — converting to tokens here would bake in a
 * rate that changes with the model.
 */
export const DEFAULT_PLAN_TOKEN_AMOUNTS: PlanTokenConfig = {
  trial:      0.5,   // מתנת פתיחה — $0.50
  basic:      10,    // Basic — $10
  pro:        20,    // Pro — $20
  enterprise: 50,    // Enterprise — $50
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

/* ── Token count display ─────────────────────────────────────────────────── */
/** How many display tokens equal $1 */
export const TOKENS_PER_DOLLAR = 300_000;

/** Convert dollars → displayable token count */
export function dollarsToTokens(dollars: number): number {
  return Math.round(dollars * TOKENS_PER_DOLLAR);
}

/** Format a token count for display (e.g. 1500000 → "1.5M", 300000 → "300K") */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000)     return `${Math.round(tokens / 1_000)}K`;
  return tokens.toLocaleString();
}

/** Format balance as token string (dollars input) */
export function formatTokenDisplay(dollars: number): string {
  return formatTokenCount(dollarsToTokens(dollars));
}

/* ── Admin quota (stored in system/adminQuota) ───────────────────────────── */

const adminQuotaRef = () => doc(db, 'system', 'adminQuota');

export interface AdminQuota {
  totalBudget: number;   // dollars the admin has set as total budget
  allocated:   number;   // dollars allocated to workspaces so far
}

export async function getAdminQuota(): Promise<AdminQuota> {
  try {
    const snap = await getDoc(adminQuotaRef());
    if (!snap.exists()) return { totalBudget: 0, allocated: 0 };
    return { totalBudget: snap.data().totalBudget ?? 0, allocated: snap.data().allocated ?? 0 };
  } catch { return { totalBudget: 0, allocated: 0 }; }
}

/** Set admin total budget (does NOT change allocated) */
export async function setAdminQuotaBudget(totalBudget: number): Promise<void> {
  await setDoc(adminQuotaRef(), { totalBudget }, { merge: true });
}

/** Add to admin budget (when admin tops up their own supply) */
export async function addToAdminBudget(dollars: number): Promise<void> {
  await runTransaction(db, async tx => {
    const snap = await tx.get(adminQuotaRef());
    const prev = snap.data()?.totalBudget ?? 0;
    tx.set(adminQuotaRef(), { totalBudget: prev + dollars, allocated: snap.data()?.allocated ?? 0 });
  });
}

/**
 * Check if admin quota has enough remaining budget.
 * Returns false if quota not set (treat as unlimited in that case).
 */
export async function adminQuotaHasRoom(dollars: number): Promise<boolean> {
  const { totalBudget, allocated } = await getAdminQuota();
  if (totalBudget <= 0) return true; // no limit set
  return (totalBudget - allocated) >= dollars;
}

/** Deduct from admin allocated (call after workspace purchase succeeds) */
export async function deductFromAdminQuota(dollars: number): Promise<void> {
  if (dollars <= 0) return;
  await runTransaction(db, async tx => {
    const snap = await tx.get(adminQuotaRef());
    const allocated = (snap.data()?.allocated ?? 0) + dollars;
    tx.set(adminQuotaRef(), { totalBudget: snap.data()?.totalBudget ?? 0, allocated });
  });
}
