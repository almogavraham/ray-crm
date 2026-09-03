/**
 * engineBudgets.ts — money loaded per media provider, and how much each
 * workspace may spend of it.
 *
 * The Anthropic budget has its own meter in the admin tokens page: what was
 * loaded, what customers have really consumed, what is still free to promise.
 * Image and video engines had nothing — a customer could generate Veo videos
 * at ₪10 each against a Google balance the operator loaded with ₪50, with no
 * meter, no cap and no way to say "this workspace gets ₪20 of that".
 *
 * Budgets are per PROVIDER, not per engine, because that is how the bills
 * arrive: Imagen and Veo draw on one Google balance, so they share one meter.
 *
 * Each provider is metered in the currency the operator pays it in. Converting
 * everything to dollars would hide the number the operator actually sees on
 * their card statement, and a meter that does not match the statement is one
 * nobody trusts.
 *
 * The same two-tier model as Anthropic tokens: a workspace holds a virtual
 * balance per provider; a generation deducts the real price × 2 from it and
 * the real price from the operator's meter. Deductions happen server-side in
 * generateMedia, where the price list lives; this file only reads and grants.
 */

import { doc, getDoc, setDoc, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { db } from './firebase';
import type { EngineId } from './mediaEngines';

export type ProviderId = 'google' | 'openai' | 'ideogram' | 'kling' | 'runway';
export type Currency = 'ILS' | 'USD';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  currency: Currency;
  engines: EngineId[];
  color: string;
  billingUrl: string;
}

export const PROVIDERS: ProviderDef[] = [
  { id: 'google',   label: 'Google (Imagen + Veo)', currency: 'ILS', engines: ['imagen', 'veo'], color: '#4285f4', billingUrl: 'https://aistudio.google.com/billing' },
  { id: 'openai',   label: 'OpenAI (DALL·E)',       currency: 'USD', engines: ['dalle'],         color: '#10b981', billingUrl: 'https://platform.openai.com/settings/organization/billing' },
  { id: 'ideogram', label: 'Ideogram',              currency: 'USD', engines: ['ideogram'],      color: '#8b5cf6', billingUrl: 'https://ideogram.ai/manage-api' },
  { id: 'kling',    label: 'Kling',                 currency: 'USD', engines: ['kling'],         color: '#ec4899', billingUrl: 'https://klingai.com/global/dev' },
  { id: 'runway',   label: 'Runway',                currency: 'USD', engines: ['runway'],        color: '#14b8a6', billingUrl: 'https://dev.runwayml.com/' },
];

export const PROVIDER_BY_ID: Record<string, ProviderDef> = Object.fromEntries(PROVIDERS.map(p => [p.id, p]));

export const PROVIDER_OF_ENGINE: Partial<Record<EngineId, ProviderId>> = {
  imagen: 'google', veo: 'google', dalle: 'openai', ideogram: 'ideogram', kling: 'kling', runway: 'runway',
};

/**
 * What one generation really costs the operator, in the provider's currency.
 * Mirrors PRICE in functions/mediaEngines.js, which is the copy that charges;
 * this one is for showing "≈ ₪0.15 לתמונה" next to a meter.
 */
export const PRICE: Record<EngineId, number> = {
  pollinations: 0,
  imagen: 0.15,      // ILS — Imagen 4 fast ≈ $0.04
  veo: 10,           // ILS — Veo 3 fast, 8s ≈ $2.8
  dalle: 0.04,       // USD — 1024×1024 standard
  ideogram: 0.08,    // USD
  kling: 0.14,       // USD — 5s std
  runway: 0.25,      // USD — 5s Gen-3 turbo
};

/** What the customer is charged: real × 2, the same margin as Anthropic tokens. */
export const CLIENT_MULTIPLIER = 2;

export function fmtMoney(amount: number, currency: Currency): string {
  const n = Math.abs(amount) >= 100 ? amount.toFixed(0) : amount.toFixed(2);
  return currency === 'ILS' ? `₪${n}` : `$${n}`;
}

/* ── Operator meters: system/engineBudgets ──────────────────────────────── */

export interface ProviderBudget {
  loaded: number;    // what the operator loaded at the provider, cumulative
  usedReal: number;  // real spend recorded by generateMedia, cumulative
}
export type EngineBudgets = Partial<Record<ProviderId, ProviderBudget>>;

const budgetsRef = () => doc(db, 'system', 'engineBudgets');

export async function loadEngineBudgets(): Promise<EngineBudgets> {
  try {
    const snap = await getDoc(budgetsRef());
    return snap.exists() ? (snap.data() as EngineBudgets) : {};
  } catch { return {}; }
}

/** "I loaded X at the provider so far" — sets the meter's top, keeps usage. */
export async function setProviderLoaded(provider: ProviderId, loaded: number): Promise<void> {
  await setDoc(budgetsRef(), { [provider]: { loaded } }, { merge: true });
}

/* ── Per-workspace balances: workspaces/{wid}.engineBalances ─────────────── */

export interface EngineHistoryEntry {
  id: string;
  provider: ProviderId;
  type: 'grant' | 'usage';
  amount: number;         // + credit / − debit, in the provider's currency (virtual)
  engine?: EngineId;
  description: string;
  timestamp: string;
}

/** Grant a workspace virtual balance for one provider. Admin only. */
export async function addEngineTokens(wid: string, provider: ProviderId, amount: number, description = 'Admin credit'): Promise<void> {
  if (!(amount > 0)) return;
  const entry: EngineHistoryEntry = {
    id: `eg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    provider, type: 'grant', amount, description, timestamp: new Date().toISOString(),
  };
  await updateDoc(doc(db, 'workspaces', wid), {
    [`engineBalances.${provider}`]: increment(amount),
    engineHistory: arrayUnion(entry),
  });
}

/** Sum of a field across workspaces, for "promised to customers" per provider. */
export function sumField(
  workspaces: Array<{ engineBalances?: Partial<Record<ProviderId, number>>; engineUsed?: Partial<Record<ProviderId, number>> }>,
  field: 'engineBalances' | 'engineUsed',
  provider: ProviderId,
): number {
  return workspaces.reduce((s, w) => s + (Number(w[field]?.[provider]) || 0), 0);
}
