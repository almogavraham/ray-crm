/**
 * morningPayments.js — taking money through Morning, and hearing back about it.
 *
 * Two halves:
 *
 *   createMorningPayment  builds a hosted payment page and returns its URL.
 *   morningWebhook        receives the notification once a payment succeeds.
 *
 * Design notes that are not obvious from the endpoints:
 *
 * **VAT is Morning's job, not ours.** An income row carries a vatType: 1 means
 * the price already includes VAT, 0 means Morning adds it at the business's own
 * rate. We send the final, VAT-inclusive amount with vatType 1, so there is
 * exactly one number in play and no VAT rate anywhere in this file to go stale
 * the way the hard-coded 1.17 did. Morning back-computes the split for the
 * invoice. Sending an inclusive amount with vatType 0 would charge VAT twice.
 *
 * **A notification is a hint, not a fact.** The callback URL is public, so
 * anything can POST to it claiming a payment succeeded — and a webhook that
 * upgrades a plan on being told to is a way to buy nothing and get everything.
 * Every delivery is therefore confirmed against Morning's own API before it
 * changes anything, and the HMAC signature is checked as well when the delivery
 * carries one.
 *
 * **Failing the delivery is worse than failing the work.** Morning disables a
 * webhook after 15 failed deliveries, and a disabled webhook loses every future
 * payment silently. So each delivery is written to Firestore first and
 * acknowledged, and the processing happens after. A processing bug then costs
 * one unapplied payment sitting in a collection we can replay — not the whole
 * channel.
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { morningRequest, isProduction } = require('./morning');

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

/** Where Morning should announce a successful payment. */
const NOTIFY_URL = 'https://us-central1-chex-crm.cloudfunctions.net/morningWebhook';

/** Document type 320 — חשבונית מס / קבלה. */
const DOC_TAX_INVOICE_RECEIPT = 320;
/** Payment group 100 — credit card. Bit/Apple Pay/Google Pay are excluded on
 *  purpose: they have no test path, so every trial with them moves real money. */
const GROUP_CREDIT_CARD = 100;

/**
 * What each plan costs, before VAT, in shekels.
 *
 * The server has to hold these. The browser used to send the amount, which
 * meant a modified client could ask for a ₪1 payment page and then claim the
 * enterprise plan — the price is an authorization decision, and authorization
 * decisions cannot be taken on the client's word.
 *
 * Keep in step with PLANS in src/pages/BillingPage.tsx. They cannot share a
 * module (CommonJS here, TypeScript there), so instead of hoping they stay
 * equal, the caller sends what it displayed and a mismatch is rejected — drift
 * surfaces as a loud error on the first click rather than as a wrong charge.
 */
const PLAN_PRICE_ILS = { basic: 89, pro: 179, enterprise: 329 };

/**
 * VAT is added on top, matching what the pricing page promises. This constant
 * exists only to turn the listed price into the total to charge; the split on
 * the invoice itself is computed by Morning from its own tax settings, so a
 * rate change here cannot make the invoice wrong — only the total, which is
 * checked against the client's displayed price on every call.
 */
const VAT_RATE = 0.18;

/** The amount actually charged for a plan, to the agora. */
const planTotal = (planKey) => {
  const base = PLAN_PRICE_ILS[planKey];
  if (base === undefined) return null;
  return Math.round(base * (1 + VAT_RATE) * 100) / 100;
};

/* ── Creating a payment ──────────────────────────────────────────────────── */

exports.createMorningPayment = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const {
      workspaceId, type, planKey, amount, label, successUrl, failureUrl,
      customer, consent,
    } = request.data ?? {};

    if (!workspaceId || !type || !successUrl || !failureUrl) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }
    if (type !== 'plan' && type !== 'topup') {
      throw new HttpsError('invalid-argument', 'type must be "plan" or "topup".');
    }
    // For a plan the price comes from this server, never from the caller. The
    // amount the caller sent is treated as the price it *displayed*, and a
    // disagreement means the two lists have drifted — which must stop the sale
    // rather than quietly charge whichever number won.
    let total;
    if (type === 'plan') {
      total = planTotal(planKey);
      if (total === null) {
        throw new HttpsError('invalid-argument', `Unknown plan "${planKey}".`);
      }
      const shown = Number(amount);
      if (Number.isFinite(shown) && Math.abs(shown - total) > 0.01) {
        console.error(`[createMorningPayment] price drift: page showed ${shown}, server says ${total} for ${planKey}`);
        throw new HttpsError(
          'failed-precondition',
          'המחיר שמוצג בעמוד אינו תואם את המחיר במערכת. רענן את הדף ונסה שוב.',
        );
      }
    } else {
      total = Number(amount);
      if (!Number.isFinite(total) || total <= 0) {
        throw new HttpsError('invalid-argument', 'amount must be a positive number.');
      }
    }

    const db = admin.firestore();
    const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsSnap.exists) throw new HttpsError('not-found', 'Workspace not found.');
    const ws = wsSnap.data();

    // Membership check: without it any signed-in user could start a payment
    // that credits somebody else's workspace.
    if (request.auth.token.email !== SUPER_ADMIN_EMAIL) {
      const me = await db.collection('users').doc(request.auth.uid).get();
      if (!me.exists || me.data()?.workspaceId !== workspaceId) {
        throw new HttpsError('permission-denied', 'Not a member of this workspace.');
      }
    }

    const description = label || (type === 'plan' ? `RAY CRM — ${planKey}` : 'RAY CRM — טוקני AI');

    let result;
    try {
      result = await morningRequest('/payments/form', {
        description,
        type: DOC_TAX_INVOICE_RECEIPT,
        amount: total,
        currency: 'ILS',
        vatType: 0,           // document level: let the business's own setup decide
        lang: 'he',           // Hebrew payment page — the reason Stripe was unusable
        maxPayments: 1,
        group: GROUP_CREDIT_CARD,
        client: {
          // The checkout form's details when it collected them, falling back to
          // the workspace for a purchase started from inside the app.
          name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim()
            || ws.name || request.auth.token.email || 'לקוח',
          emails: [customer?.email || request.auth.token.email].filter(Boolean),
          ...(customer?.phone ? { phone: String(customer.phone) } : {}),
          ...(customer?.country ? { country: String(customer.country) } : {}),
        },
        income: [{
          description,
          quantity: 1,
          price: total,
          currency: 'ILS',
          vatType: 1,         // the price already includes VAT — see the file header
        }],
        successUrl,
        failureUrl,
        notifyUrl: NOTIFY_URL,
        // Echoed back to us on the notification. This is how a payment is tied
        // to a workspace; the notification carries no other link to our data.
        custom: JSON.stringify({ workspaceId, type, planKey: planKey ?? null }),
      });
    } catch (err) {
      console.error('[createMorningPayment]', err.message);
      throw new HttpsError('internal', err.message);
    }

    if (!result?.url) {
      throw new HttpsError('internal', 'Morning returned no payment URL.');
    }

    // Record what the buyer agreed to, with the wording and version they were
    // actually shown. The checkout page tells them their acceptance is stored;
    // a dispute months later is then settled by this rather than by whatever
    // the terms page happens to say by then.
    if (consent?.text) {
      await db.collection('workspaces').doc(workspaceId)
        .collection('checkoutConsents').add({
          uid: request.auth.uid,
          email: customer?.email ?? request.auth.token.email ?? null,
          type, planKey: planKey ?? null, amount: total,
          consentText: String(consent.text).slice(0, 1000),
          consentVersion: consent.version ?? null,
          acceptedAt: consent.acceptedAt ?? new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          customer: customer ?? null,
        })
        .catch(err => console.error('[createMorningPayment] consent not recorded', err));
    }

    console.log(`[createMorningPayment] ws=${workspaceId} type=${type} amount=${total}`);
    return { url: result.url };
  },
);

/* ── Receiving the result ────────────────────────────────────────────────── */

/** Constant-time compare that cannot throw on a length mismatch. */
function signatureMatches(expected, received) {
  if (!received) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

exports.morningWebhook = onRequest(
  { region: 'us-central1', cors: false },
  async (req, res) => {
    const db = admin.firestore();

    // The signature is computed over the exact bytes received. Firebase parses
    // the body for convenience, and re-serializing that would change the bytes
    // and never match, so the raw buffer is what gets hashed.
    const raw = req.rawBody;
    const secret = process.env.MORNING_WEBHOOK_SECRET;
    const signature = req.get('x-webhook-signature');

    if (secret && signature) {
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      if (!signatureMatches(expected, signature)) {
        console.error('[morningWebhook] signature mismatch — rejected');
        res.status(401).send('invalid signature');
        return;
      }
    } else if (secret) {
      // A configured secret with no signature on the delivery means either a
      // forgery or the plain notifyUrl callback, which is unsigned. Either way
      // it is not proof of anything — it is recorded and confirmed below.
      console.warn('[morningWebhook] delivery carried no signature');
    } else {
      // No secret configured on this deployment, so signatures cannot be
      // checked at all and the confirmation against Morning's API is the only
      // thing standing between a forged POST and a free plan. Logged on every
      // delivery so this is visible in production rather than assumed.
      console.warn('[morningWebhook] MORNING_WEBHOOK_SECRET is not set — deliveries are unsigned');
    }

    let payload = null;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { /* recorded as-is below */ }

    // Deterministic id: Morning retries failed deliveries, and a retry must not
    // be applied twice.
    const deliveryId = req.get('x-webhook-delivery-id')
      || crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
    const ref = db.collection('morningDeliveries').doc(deliveryId);

    try {
      if ((await ref.get()).exists) {
        console.log(`[morningWebhook] duplicate delivery ${deliveryId} — ignored`);
        res.status(200).send('ok');
        return;
      }
      await ref.set({
        deliveryId,
        topic: req.get('x-webhook-topic') ?? null,
        signed: Boolean(secret && signature),
        receivedAt: new Date().toISOString(),
        // The notification's shape is not documented. Storing it whole means
        // the first real payment tells us what it actually looks like, instead
        // of being lost to a parser written against a guess.
        payload: payload ?? { unparsed: raw.toString('utf8').slice(0, 4000) },
        status: 'received',
      });
    } catch (err) {
      // Could not even record it. Fail loudly rather than acknowledge a
      // payment we have no memory of.
      console.error('[morningWebhook] could not record delivery', err);
      res.status(500).send('storage error');
      return;
    }

    // Acknowledged from here on: the delivery is durable, so nothing below can
    // cost us the webhook channel.
    res.status(200).send('ok');

    try {
      await applyPayment(db, ref, payload);
    } catch (err) {
      console.error(`[morningWebhook] delivery ${deliveryId} recorded but not applied:`, err);
      await ref.set({ status: 'failed', error: String(err.message ?? err) }, { merge: true })
        .catch(() => {});
    }
  },
);

/**
 * Turn a recorded delivery into a plan change — only after Morning confirms it.
 */
async function applyPayment(db, ref, payload) {
  if (!payload) throw new Error('delivery had no parsable JSON body');

  let meta;
  try {
    meta = JSON.parse(payload.custom ?? payload.data?.custom ?? '{}');
  } catch {
    throw new Error('custom field was not the JSON we wrote');
  }
  const { workspaceId, type, planKey } = meta;
  if (!workspaceId) throw new Error('no workspaceId in custom');

  // The confirmation. Nothing above this line is trusted: we ask Morning
  // whether a document really exists for this payment before crediting anyone.
  const documentId = payload.documentId ?? payload.data?.id ?? payload.id;
  if (!documentId) throw new Error('no document id in delivery');

  const doc = await morningRequest(`/documents/${encodeURIComponent(documentId)}`, null, { method: 'GET' });
  if (!doc) throw new Error(`Morning has no document ${documentId}`);

  const paid = Number(doc.amount ?? doc.total ?? 0);
  if (!(paid > 0)) throw new Error(`document ${documentId} shows no amount paid`);

  // The amount has to cover the plan being claimed. Without this, a real ₪10
  // token purchase yields a real document id, and replaying it with a custom
  // field naming the enterprise plan would buy the top tier for ten shekels.
  if (type === 'plan') {
    const expected = planTotal(planKey);
    if (expected === null) throw new Error(`unknown plan "${planKey}"`);
    if (paid + 0.01 < expected) {
      throw new Error(`document ${documentId} paid ${paid} but ${planKey} costs ${expected}`);
    }
  }

  // One document, one application. The delivery id cannot carry this: it comes
  // from the request, so anything replaying a document simply sends a new one.
  // create() fails if the id is taken, which makes this a claim rather than a
  // check — two concurrent replays cannot both pass it.
  try {
    await db.collection('morningAppliedDocuments').doc(String(documentId)).create({
      workspaceId, type, planKey: planKey ?? null, amount: paid,
      appliedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err.code === 6 || /already exists/i.test(String(err.message))) {
      throw new Error(`document ${documentId} was already applied — ignoring replay`);
    }
    throw err;
  }

  await db.collection('workspaces').doc(workspaceId).update(
    type === 'plan'
      ? { plan: planKey, subscriptionStatus: 'active', planUpdatedAt: new Date().toISOString() }
      : { lastTopupAt: new Date().toISOString() },
  );

  await ref.set({
    status: 'applied', workspaceId, type, planKey: planKey ?? null,
    documentId, amount: paid, appliedAt: new Date().toISOString(),
  }, { merge: true });

  console.log(`[morningWebhook] applied ${type} for ${workspaceId} (doc ${documentId}, ${paid} ILS, ${isProduction() ? 'prod' : 'sandbox'})`);
}
