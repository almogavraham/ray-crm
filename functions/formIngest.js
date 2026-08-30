/**
 * formIngest.js — public endpoint behind embeddable lead-capture forms.
 *
 * The existing `leadsWebhook` authenticates with a workspace secret, which is
 * right for server-to-server but impossible for a form: the HTML sits on a
 * public page, so anything embedded in it is public too. Instead each form gets
 * its own long random id that acts as the capability — public, but unguessable,
 * scoped to one form, and revocable by disabling that form without touching any
 * other integration.
 *
 * Abuse controls, in the order they reject:
 *  • form must exist and be enabled,
 *  • honeypot field must be empty (catches the majority of naive bots),
 *  • per-form hourly cap, so a hostile page cannot fill a customer's pipeline.
 *
 * UTM parameters are captured from the embedding page. That is the whole reason
 * attribution works at all — by the time a human types their name, the campaign
 * that brought them is only knowable from the page they are standing on.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const MAX_PER_HOUR = 60;
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);

exports.formSubmit = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    const db = admin.firestore();
    const body = req.body || {};
    const wsId   = str(req.query.ws   || body.ws, 120);
    const formId = str(req.query.form || body.form, 120);

    if (!wsId || !formId) { res.status(400).json({ error: 'Missing ws or form' }); return; }

    // Honeypot: a field hidden from humans. Anything filling it is automated.
    if (str(body._hp)) { res.status(200).json({ ok: true }); return; }   // lie quietly to bots

    let form, wsData;
    try {
      const [wsSnap, formsSnap] = await Promise.all([
        db.collection('workspaces').doc(wsId).get(),
        db.collection('workspaces').doc(wsId).collection('config').doc('leadForms').get(),
      ]);
      if (!wsSnap.exists) { res.status(404).json({ error: 'Not found' }); return; }
      wsData = wsSnap.data() || {};
      const forms = (formsSnap.exists ? formsSnap.data().forms : []) || [];
      form = forms.find(f => f.id === formId);
    } catch (err) {
      console.error('formSubmit: read failed', err);
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    if (!form || form.enabled === false) { res.status(404).json({ error: 'Form not available' }); return; }

    // Per-form hourly cap.
    try {
      const since = Date.now() - 3600_000;
      const recent = await db.collection('workspaces').doc(wsId).collection('leads')
        .where('formId', '==', formId).where('createdAt', '>=', since).get();
      if (recent.size >= MAX_PER_HOUR) {
        console.warn(`formSubmit: hourly cap hit for ${wsId}/${formId}`);
        res.status(429).json({ error: 'Too many submissions' });
        return;
      }
    } catch { /* an index-missing error must not block a real lead */ }

    const now = new Date();
    const he = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const id = `form_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    const utm = {
      utmSource:   str(body.utm_source, 120),
      utmMedium:   str(body.utm_medium, 120),
      utmCampaign: str(body.utm_campaign, 160),
      utmTerm:     str(body.utm_term, 160),
      utmContent:  str(body.utm_content, 160),
      landingPage: str(body.page_url, 500),
      referrer:    str(body.referrer, 500),
    };

    const message = str(body.message, 2000);
    const lead = {
      id,
      company:     str(body.company, 160) || str(body.name, 160) || 'ליד מטופס',
      contactName: str(body.name, 160),
      email:       str(body.email, 200),
      phone:       str(body.phone, 60),
      status:      form.defaultStatus || 'חדש',
      source:      form.defaultSource || 'טופס אתר',
      budget: 0,
      aiScore: 0,
      assignedTo: form.assignTo || '',
      lastUpdate: he,
      createdAt: now.getTime(),
      solutions: [], tasks: [], futureNotes: [], waitingContent: false,
      formId,
      formName: str(form.name, 120),
      ...Object.fromEntries(Object.entries(utm).filter(([, v]) => v)),
      notes: message ? [{
        id: `${now.getTime()}-msg`, text: message, author: 'טופס אתר', timestamp: now.toISOString(),
      }] : [],
      activityLog: [{
        id: `${now.getTime()}-act`, type: 'note', author: 'מערכת', timestamp: now.toISOString(),
        content: `ליד נכנס מטופס "${str(form.name, 120)}"`
          + (utm.utmCampaign ? ` · קמפיין: ${utm.utmCampaign}` : '')
          + (utm.utmSource ? ` · מקור: ${utm.utmSource}` : ''),
      }],
    };

    try {
      await db.collection('workspaces').doc(wsId).collection('leads').doc(id).set(lead);
      await db.collection('workspaces').doc(wsId).collection('auditLog')
        .doc(`${now.getTime()}-form`).set({
          id: `${now.getTime()}-form`, action: 'lead.create', actor: 'טופס אתר', at: now.getTime(),
          targetId: id, targetName: lead.company,
          summary: `ליד חדש מטופס "${lead.formName}"${utm.utmCampaign ? ` · קמפיין ${utm.utmCampaign}` : ''}`,
        }).catch(() => {});
      console.log(`formSubmit: lead ${id} created in ${wsId} via ${formId}`);
      res.status(200).json({ ok: true, redirect: form.redirectUrl || null });
    } catch (err) {
      console.error('formSubmit: write failed', err);
      res.status(500).json({ error: 'Could not save' });
    }
    void wsData;
  },
);
