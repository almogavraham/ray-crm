/**
 * siteContact.js — the public contact form on ray-crm.com.
 *
 * Separate from `formSubmit` (the embeddable customer form) on purpose. That
 * endpoint is addressed by workspace id + form id, which would mean shipping
 * RAY's own workspace id inside the public marketing bundle. This one takes no
 * target at all: it resolves the staging workspace the same way
 * newWorkspaceLead.js does, so there is nothing in the page worth forging.
 *
 * Consent is stored with the lead, not merely checked. Israeli marketing law
 * requires the sender to be able to show that consent was given, and a boolean
 * that says "true" proves nothing — so the exact wording the person agreed to,
 * and when, is written alongside it.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

/** Per-IP cap. Generous for humans, useless for a script. */
const MAX_PER_IP_PER_HOUR = 5;
/** A human cannot read the form and fill it in under this. */
const MIN_FILL_MS = 2500;

const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);

/** Loose on purpose: rejecting an unusual but real address loses a customer. */
const looksLikeEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const looksLikePhone = p => String(p ?? '').replace(/\D/g, '').length >= 9;

exports.siteContact = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const db = admin.firestore();
    const body = req.body || {};

    // Honeypot — a field hidden from humans. Answer 200 so the bot believes it
    // succeeded and does not come back to probe for what rejected it.
    if (str(body._hp)) { res.status(200).json({ ok: true }); return; }

    const elapsed = Number(body.elapsedMs) || 0;
    if (elapsed > 0 && elapsed < MIN_FILL_MS) { res.status(200).json({ ok: true }); return; }

    const name    = str(body.name, 160);
    const phone   = str(body.phone, 60);
    const email   = str(body.email, 200);
    const company = str(body.company, 160);
    const message = str(body.message, 2000);

    if (!name)                       { res.status(400).json({ error: 'שם הוא שדה חובה' }); return; }
    if (!looksLikePhone(phone))      { res.status(400).json({ error: 'מספר טלפון לא תקין' }); return; }
    if (email && !looksLikeEmail(email)) { res.status(400).json({ error: 'כתובת אימייל לא תקינה' }); return; }
    if (body.consent !== true)       { res.status(400).json({ error: 'נדרש אישור לתנאים' }); return; }

    const ip = str(req.headers['x-forwarded-for'], 60).split(',')[0].trim()
      || str(req.ip, 60) || 'unknown';

    // Resolve RAY Staging by flag rather than a hard-coded id, so this keeps
    // working if the superadmin account (and therefore the id) ever changes.
    let stagingId = null;
    try {
      const snap = await db.collection('workspaces')
        .where('isAdminWorkspace', '==', true).limit(1).get();
      if (!snap.empty) stagingId = snap.docs[0].id;
    } catch (err) {
      console.error('siteContact: staging lookup failed', err);
      res.status(500).json({ error: 'שגיאה זמנית — נסה שוב' });
      return;
    }
    if (!stagingId) {
      console.error('siteContact: no admin workspace found — lead would be lost');
      res.status(500).json({ error: 'שגיאה זמנית — נסה שוב' });
      return;
    }

    // Per-IP hourly cap. Counted on the submission ledger rather than on leads,
    // so a rejected attempt still counts against the attacker.
    const hourAgo = Date.now() - 3600_000;
    try {
      const recent = await db.collection('workspaces').doc(stagingId)
        .collection('siteContactLog')
        .where('ip', '==', ip).where('at', '>=', hourAgo).get();
      if (recent.size >= MAX_PER_IP_PER_HOUR) {
        res.status(429).json({ error: 'נשלחו יותר מדי פניות. נסה שוב בעוד שעה.' });
        return;
      }
    } catch { /* a missing index must never block a real enquiry */ }

    const now = new Date();
    const he = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const id = `site_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    const utm = {
      utmSource:   str(body.utm_source, 120),
      utmMedium:   str(body.utm_medium, 120),
      utmCampaign: str(body.utm_campaign, 160),
      utmTerm:     str(body.utm_term, 160),
      utmContent:  str(body.utm_content, 160),
      landingPage: str(body.page_url, 500),
      referrer:    str(body.referrer, 500),
    };

    const consent = {
      // The wording actually shown, so a later dispute is settled by the record
      // rather than by whatever the form says today.
      termsText:     str(body.consentText, 1000),
      termsVersion:  str(body.consentVersion, 40),
      acceptedAt:    now.toISOString(),
      marketingOptIn: body.marketingOptIn === true,
      ip,
      userAgent: str(req.headers['user-agent'], 400),
    };

    const lead = {
      id,
      company:     company || name,
      contactName: name,
      email, phone,
      status: 'חדש',
      source: 'אתר RAY',
      budget: 0, aiScore: 0, assignedTo: '',
      lastUpdate: he,
      createdAt: now.getTime(),
      solutions: [], tasks: [], futureNotes: [], waitingContent: false,
      formId: 'site-contact',
      formName: 'טופס יצירת קשר — ray-crm.com',
      contactConsent: consent,
      marketingOptIn: consent.marketingOptIn,
      ...Object.fromEntries(Object.entries(utm).filter(([, v]) => v)),
      notes: message ? [{
        id: `${now.getTime()}-msg`, text: message,
        author: 'טופס האתר', timestamp: now.toISOString(),
      }] : [],
      activityLog: [{
        id: `${now.getTime()}-act`, type: 'note', author: 'מערכת', timestamp: now.toISOString(),
        content: `פנייה חדשה מטופס יצירת קשר באתר`
          + (consent.marketingOptIn ? ' · אישר קבלת דיוור' : ' · לא אישר דיוור')
          + (utm.utmCampaign ? ` · קמפיין: ${utm.utmCampaign}` : '')
          + (utm.utmSource ? ` · מקור: ${utm.utmSource}` : ''),
      }],
    };

    try {
      await db.collection('workspaces').doc(stagingId).collection('leads').doc(id).set(lead);
    } catch (err) {
      console.error('siteContact: lead write failed', err);
      res.status(500).json({ error: 'לא הצלחנו לשמור את הפנייה — נסה שוב' });
      return;
    }

    // Best-effort extras: the enquiry is already safe, so neither of these may
    // turn a successful submission into an error the visitor sees.
    await db.collection('workspaces').doc(stagingId).collection('siteContactLog')
      .doc(id).set({ id, ip, at: now.getTime(), leadId: id })
      .catch(err => console.error('siteContact: log write failed', err));

    await db.collection('workspaces').doc(stagingId).collection('auditLog')
      .doc(`${now.getTime()}-site`).set({
        id: `${now.getTime()}-site`, action: 'lead.create', actor: 'טופס האתר',
        at: now.getTime(), targetId: id, targetName: lead.company,
        summary: `פנייה חדשה מהאתר${utm.utmCampaign ? ` · קמפיין ${utm.utmCampaign}` : ''}`,
      })
      .catch(err => console.error('siteContact: audit write failed', err));

    console.log(`siteContact: lead ${id} created in ${stagingId}`);
    res.status(200).json({ ok: true });
  },
);
