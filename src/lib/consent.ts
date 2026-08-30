/**
 * consent.ts — cookie consent, and the gate every future tracking tag goes through.
 *
 * The site loads no trackers today. This exists so that when GA4, Meta Pixel or
 * anything else is added, the correct behaviour is the *easy* behaviour: register
 * the tag with `onConsent('analytics', …)` and it simply will not run until the
 * visitor has agreed. Bolting consent on after the tags are already firing is how
 * sites end up non-compliant, because by then the tag is load-bearing.
 *
 * Categories follow the usual split. `necessary` is not offered as a choice —
 * it covers the session cookie that makes login work, which cannot be declined
 * while still using the product, and pretending otherwise would be a fake choice.
 */

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing';

export interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** ISO timestamp of the decision — needed to show consent was actually given. */
  decidedAt: string;
  /** Bumping this re-asks everyone, e.g. when a new category is introduced. */
  version: number;
}

/** Raise this when the categories or their meaning change. */
export const CONSENT_VERSION = 1;
const KEY = 'ray-cookie-consent';

const DENIED: ConsentState = {
  necessary: true, analytics: false, marketing: false,
  decidedAt: '', version: CONSENT_VERSION,
};

export function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    // An old decision is not consent for a new set of categories.
    if (parsed.version !== CONSENT_VERSION) return null;
    return { ...DENIED, ...parsed, necessary: true };
  } catch {
    // Private mode, blocked storage, corrupt value — all mean "no decision on
    // record", and the only safe reading of no record is no consent.
    return null;
  }
}

/** The effective state: denied until the visitor says otherwise. */
export function currentConsent(): ConsentState {
  return readConsent() ?? DENIED;
}

type Listener = (c: ConsentState) => void;
const listeners = new Set<Listener>();
/** Tags registered before a decision was made, waiting for their category. */
const pending: { category: Exclude<ConsentCategory, 'necessary'>; run: () => void }[] = [];
const alreadyRun = new Set<() => void>();

export function saveConsent(choice: { analytics: boolean; marketing: boolean }): ConsentState {
  const state: ConsentState = {
    necessary: true,
    analytics: choice.analytics,
    marketing: choice.marketing,
    decidedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* choice still applies this session */ }
  applyToGoogleConsentMode(state);
  flushPending(state);
  listeners.forEach(l => l(state));
  return state;
}

/** Let the visitor take it back — required, and the banner links to it. */
export function withdrawConsent(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  applyToGoogleConsentMode(DENIED);
  listeners.forEach(l => l(DENIED));
  // Tags already loaded cannot be unloaded from this page; a reload is the only
  // honest way to reach a state where they are genuinely not running.
  window.location.reload();
}

export function subscribeConsent(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Register a tracking tag. Runs immediately if its category is already allowed,
 * otherwise waits — and never runs at all if the visitor declines.
 */
export function onConsent(category: Exclude<ConsentCategory, 'necessary'>, run: () => void): void {
  const c = currentConsent();
  if (c[category]) { runOnce(run); return; }
  pending.push({ category, run });
}

function runOnce(run: () => void) {
  if (alreadyRun.has(run)) return;
  alreadyRun.add(run);
  try { run(); } catch (err) { console.error('[consent] tag failed', err); }
}

function flushPending(state: ConsentState) {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (state[pending[i].category]) { runOnce(pending[i].run); pending.splice(i, 1); }
  }
}

/**
 * Google Consent Mode v2. Harmless when gtag is absent, and means GA4/Ads will
 * behave correctly from the moment they are added rather than needing this
 * wired up retroactively.
 */
function applyToGoogleConsentMode(state: ConsentState) {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
  if (!w.dataLayer) return;
  const fn = w.gtag ?? ((...a: unknown[]) => { w.dataLayer!.push(a); });
  fn('consent', 'update', {
    analytics_storage:        state.analytics ? 'granted' : 'denied',
    ad_storage:               state.marketing ? 'granted' : 'denied',
    ad_user_data:             state.marketing ? 'granted' : 'denied',
    ad_personalization:       state.marketing ? 'granted' : 'denied',
    functionality_storage:    'granted',
    security_storage:         'granted',
  });
}

/** Call once at start-up so a returning visitor's choice is in force. */
export function initConsent(): void {
  const stored = readConsent();
  if (stored) { applyToGoogleConsentMode(stored); flushPending(stored); }
  else applyToGoogleConsentMode(DENIED);
}
