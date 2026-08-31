/**
 * setupStripe.js — provision a Stripe account with everything RAY CRM needs.
 *
 *   node scripts/setupStripe.js            (run from crm-app/functions)
 *
 * Creates, if missing: the three plan products with their monthly ILS prices,
 * the Israeli VAT rate, and the billing webhook endpoint — then writes the
 * webhook signing secret into functions/.env.
 *
 * Why this file exists: the original account was registered in Thailand, and a
 * Stripe account's country cannot be changed after creation. Everything had to
 * be rebuilt in a new account, and doing that by hand invites exactly the kind
 * of quiet mistake that took a day to find the first time — a price with no
 * tax_behavior collects no VAT, and a missing webhook takes the customer's
 * money without upgrading their plan. Neither failure announces itself.
 *
 * Safe to re-run: every step checks for what it created last time and skips it.
 * Nothing here is ever updated or deleted — change things in the dashboard.
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

/* Read .env directly: `dotenv` is not a dependency here, because in production
 * Firebase loads this file itself at deploy time. */
function loadEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { raw, vars: out };
}

/* ── What a correct account looks like ──────────────────────────────────── */

const EXPECTED_COUNTRY = 'IL';

// Must stay byte-identical to PLAN_PRODUCT_NAME in index.js: resolvePlanPrice
// finds a plan's price by matching this name, so a changed dash breaks checkout
// with no error beyond "plan not configured".
const PLANS = [
  { key: 'basic',      name: 'RAY CRM — Basic',      ils: 89 },
  { key: 'pro',        name: 'RAY CRM — Pro',        ils: 179 },
  { key: 'enterprise', name: 'RAY CRM — Enterprise', ils: 329 },
];

const VAT_PERCENT = 18;          // Israeli VAT since January 2025
const VAT_MARKER  = 'il';        // metadata.ray_vat — how resolveVatRate finds it

const WEBHOOK_URL = 'https://stripewebhook-kq5xh5yhsq-uc.a.run.app';
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
];

/* ── Steps ──────────────────────────────────────────────────────────────── */

async function ensurePlans(stripe) {
  const [products, prices] = await Promise.all([
    stripe.products.list({ active: true, limit: 100 }),
    stripe.prices.list({ active: true, type: 'recurring', limit: 100 }),
  ]);

  for (const plan of PLANS) {
    let product = products.data.find(p => p.name === plan.name);
    if (product) {
      console.log(`  product  ${plan.key.padEnd(11)} exists   ${product.id}`);
    } else {
      product = await stripe.products.create({
        name: plan.name, metadata: { ray_plan: plan.key },
      });
      console.log(`  product  ${plan.key.padEnd(11)} created  ${product.id}`);
    }

    const price = prices.data.find(p => p.product === product.id);
    if (price) {
      // tax_behavior is write-once: Stripe only accepts it while it is
      // "unspecified", and an unspecified price silently collects no VAT.
      const note = price.tax_behavior === 'exclusive' ? '' : `  ⚠ tax_behavior=${price.tax_behavior}`;
      console.log(`  price    ${plan.key.padEnd(11)} exists   ${price.id}${note}`);
      continue;
    }
    const created = await stripe.prices.create({
      product: product.id,
      currency: 'ils',
      unit_amount: plan.ils * 100,
      recurring: { interval: 'month' },
      // "exclusive" means the listed price is pre-VAT and tax is added on top,
      // which is what the pricing page promises the customer.
      tax_behavior: 'exclusive',
    });
    console.log(`  price    ${plan.key.padEnd(11)} created  ${created.id}  ₪${plan.ils}/mo`);
  }
}

async function ensureVatRate(stripe) {
  const rates = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = rates.data.find(r => r.metadata?.ray_vat === VAT_MARKER);
  if (found) {
    console.log(`  vat rate             exists   ${found.id}  ${found.percentage}%`);
    return;
  }
  const rate = await stripe.taxRates.create({
    display_name: 'מע"מ',
    description: `Israel VAT ${VAT_PERCENT}%`,
    jurisdiction: 'IL',
    country: 'IL',
    percentage: VAT_PERCENT,
    inclusive: false,
    metadata: { ray_vat: VAT_MARKER },
  });
  console.log(`  vat rate             created  ${rate.id}  ${VAT_PERCENT}%`);
}

async function ensureWebhook(stripe, envRaw) {
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = list.data.find(e => e.url === WEBHOOK_URL);
  if (found) {
    // Stripe returns the signing secret only when the endpoint is created, so
    // an endpoint that already exists cannot hand it over again. Say so plainly
    // rather than leaving a broken secret in place.
    console.log(`  webhook              exists   ${found.id}`);
    console.log('    ⚠ signing secret cannot be re-read. If STRIPE_WEBHOOK_SECRET');
    console.log('      is missing or wrong, delete this endpoint and re-run.');
    return;
  }
  const ep = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS, description: 'RAY CRM billing events',
  });
  if (!ep.secret) throw new Error('Stripe returned no signing secret');

  // Written straight to disk. A signing secret is credential material and must
  // not pass through a terminal, a log, or a chat transcript.
  const body = envRaw.replace(/\r?\n*$/, '').replace(/^STRIPE_WEBHOOK_SECRET=.*$\n?/m, '');
  fs.writeFileSync(ENV_PATH, `${body}\nSTRIPE_WEBHOOK_SECRET=${ep.secret}\n`, 'utf8');
  console.log(`  webhook              created  ${ep.id}`);
  console.log('    secret written to functions/.env');
}

/* ── Main ───────────────────────────────────────────────────────────────── */

(async () => {
  const { raw, vars } = loadEnv();
  const key = vars.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is missing from functions/.env');

  const stripe = require('stripe')(key);
  const account = await stripe.accounts.retrieve();

  console.log(`account   : ${account.id}`);
  console.log(`country   : ${account.country}`);
  console.log(`currency  : ${String(account.default_currency).toUpperCase()}`);
  console.log(`mode      : ${key.startsWith('sk_test') || key.startsWith('rk_test') ? 'TEST' : 'LIVE'}`);
  console.log('');

  // The guard this script was written for. Provisioning into the wrong country
  // is not recoverable — the country is fixed at account creation — so refuse
  // rather than build a second account that has to be abandoned too.
  if (account.country !== EXPECTED_COUNTRY) {
    console.error(`REFUSING: account country is ${account.country}, expected ${EXPECTED_COUNTRY}.`);
    console.error('A Stripe account\'s country cannot be changed after it is created.');
    console.error('Create an account registered in Israel and put its secret key in functions/.env.');
    process.exit(1);
  }

  await ensurePlans(stripe);
  await ensureVatRate(stripe);
  await ensureWebhook(stripe, raw);

  console.log('');
  console.log('Done. Next: npx firebase deploy --only functions');
  if (!account.charges_enabled || !account.payouts_enabled) {
    console.log('');
    console.log(`Note: charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}.`);
    console.log('Real money cannot move until the account is activated and a bank account added.');
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
