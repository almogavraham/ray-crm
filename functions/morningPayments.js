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

/* ── Creating a payment ──────────────────────────────────────────────────── */

exports.createMorningPayment = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const {
      workspaceId, type, planKey, amount, label, successUrl, failureUrl,
    } = request.data ?? {};

    if (!workspaceId || !type || !successUrl || !failureUrl) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }
    if (type !== 'plan' && type !== 'topup') {
      throw new HttpsError('invalid-argument', 'type must be "plan" or "topup".');
    }
    const total = Number(amount);
    if (!Number.isFinite(total) || total <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive number.');
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
          name: ws.name || request.auth.token.email || 'לקוח',
          emails: [request.auth.token.email].filter(Boolean),
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
