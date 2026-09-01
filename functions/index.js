// Public endpoint behind embeddable website forms (form id is the capability,
// since a form on a public page cannot hold a secret).
const formIngest = require('./formIngest');
exports.formSubmit = formIngest.formSubmit;

const siteContact = require('./siteContact');
exports.siteContact = siteContact.siteContact;

// The public REST API other systems integrate against, plus the key
// management the app calls to issue and revoke credentials for it.
const publicApi = require('./publicApi');
exports.api          = publicApi.api;
exports.createApiKey = publicApi.createApiKey;
exports.listApiKeys  = publicApi.listApiKeys;
exports.revokeApiKey = publicApi.revokeApiKey;

// Payments through Morning, which is also the invoicing system — so a
// successful charge issues the חשבונית מס itself. Replaces Stripe, which
// cannot be used at all: it does not support Israel as a merchant country.
const morningPayments = require('./morningPayments');
exports.createMorningPayment = morningPayments.createMorningPayment;
exports.morningWebhook       = morningPayments.morningWebhook;

// Gmail authorization-code flow — a connection that outlives the browser.
const gmailOAuth = require('./gmailOAuth');
exports.gmailConnectUrl    = gmailOAuth.gmailConnectUrl;
exports.gmailOAuthCallback = gmailOAuth.gmailOAuthCallback;
exports.gmailAccessToken   = gmailOAuth.gmailAccessToken;
exports.gmailDisconnect    = gmailOAuth.gmailDisconnect;

// Nightly point-in-time snapshot — the only thing that recovers from a bulk
// overwrite, which deletes-only protections (recycle bin) cannot.
const dailyBackup = require('./dailyBackup');
exports.dailyBackup = dailyBackup.dailyBackup;

// New signups land in the admin's own pipeline as leads (see the file for why
// this has to be a server trigger rather than client code in the signup flow).
const newWorkspaceLead = require('./newWorkspaceLead');
exports.onWorkspaceCreated = newWorkspaceLead.onWorkspaceCreated;

// Social network functions (LinkedIn, TikTok, Twitter token exchange + posting)
const socialFunctions = require('./social');
exports.exchangeSocialToken = socialFunctions.exchangeSocialToken;
exports.postToSocial        = socialFunctions.postToSocial;

// Google Ads API functions
const googleAdsFunctions = require('./googleAds');
exports.googleAdsListAccounts   = googleAdsFunctions.googleAdsListAccounts;
exports.googleAdsListCampaigns  = googleAdsFunctions.googleAdsListCampaigns;
exports.googleAdsCreateCampaign = googleAdsFunctions.googleAdsCreateCampaign;
exports.googleAdsToggleCampaign = googleAdsFunctions.googleAdsToggleCampaign;

// AI media generation (Kling video, Nano Banana video)
const mediaFunctions = require('./media');
exports.createKlingVideo        = mediaFunctions.createKlingVideo;
exports.getKlingVideoStatus     = mediaFunctions.getKlingVideoStatus;
exports.generateNanoBananaVideo = mediaFunctions.generateNanoBananaVideo;
exports.getNanoBananaStatus     = mediaFunctions.getNanoBananaStatus;

/**
 * Firebase Cloud Functions — CRM Admin Operations
 * These run server-side with Firebase Admin SDK privileges.
 *
 * Deployed to: chex-crm (Firebase project)
 * Deploy cmd : firebase deploy --only functions
 */

const { onCall: _onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');

// NOTE: App Check is NOT initialized on the client (no initializeAppCheck in
// src/lib/firebase.ts). Enforcing it here rejects EVERY callable request with a
// generic "Unauthenticated" error, regardless of a valid Firebase auth token.
// Auth is still verified inside each handler via `request.auth`. To re-enable
// App Check later, first call initializeAppCheck() on the client, then flip this.
const onCall = (opts, handler) => _onCall({ ...opts, enforceAppCheck: false }, handler);
const admin = require('firebase-admin');

admin.initializeApp();

// Autonomous Marketing Agent — scheduled publisher (drains scheduledPosts queue).
// Required AFTER admin.initializeApp() so the scheduler can use admin.firestore().
exports.autopilotScheduler = require('./autopilot').autopilotScheduler;

// CRM automations — background detection; execution stays behind user approval.
exports.workflowScanner = require('./workflowScanner').workflowScanner;

/* ══════════════════════════════════════════════════════════════════════════
 * anthropicProxy  — secure server-side proxy for all Anthropic API calls.
 *
 * Uses Firebase onCall — auth is handled automatically by the Firebase SDK.
 * No CORS or IAM configuration needed.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.anthropicProxy = onCall(
  {
    region:         'us-central1',
    timeoutSeconds: 180,
    memory:         '512MiB',
  },
  async (request) => {
    /* ── Auth check (automatic via Firebase SDK) ─────────────────────────── */
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to use AI features.');
    }

    /* ── API key check ───────────────────────────────────────────────────── */
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpsError('internal', 'Anthropic API key not configured on server.');
    }

    /* ── Call Anthropic (non-streaming — onCall doesn't support SSE) ────── */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey });

    /* ── Rate limiting: max 100 AI requests per user per day ────────────────── */
    const db = admin.firestore();
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const rateRef = db.doc(`_rateLimits/${request.auth.uid}/days/${today}`);
    const MAX_DAILY_REQUESTS = 100;

    const rateDoc = await rateRef.get();
    const currentCount = rateDoc.exists ? (rateDoc.data().count ?? 0) : 0;

    if (currentCount >= MAX_DAILY_REQUESTS) {
      throw new HttpsError('resource-exhausted', `Daily AI request limit (${MAX_DAILY_REQUESTS}) reached. Try again tomorrow.`);
    }
    // Increment atomically (fire-and-forget, non-blocking)
    rateRef.set({ count: currentCount + 1, date: today }, { merge: true }).catch(() => {});

    /* ── Validate & sanitize request ────────────────────────────────────────── */
    const ALLOWED_MODELS = [
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-3-5-haiku-20241022',
      'claude-sonnet-4-5',
      'claude-sonnet-4-6',
      'claude-3-5-sonnet-20241022',
      'claude-3-7-sonnet-20250219',
      'claude-opus-4-5',
      'claude-opus-4-6',
      'claude-opus-4-8',
    ];
    const MAX_TOKENS_LIMIT = 8192;

    const model = request.data?.model;
    if (!model || !ALLOWED_MODELS.includes(model)) {
      throw new HttpsError('invalid-argument', `Model not allowed: ${model}. Allowed: ${ALLOWED_MODELS.join(', ')}`);
    }

    const maxTokens = request.data?.max_tokens ?? 1024;
    if (typeof maxTokens !== 'number' || maxTokens < 1 || maxTokens > MAX_TOKENS_LIMIT) {
      throw new HttpsError('invalid-argument', `max_tokens must be between 1 and ${MAX_TOKENS_LIMIT}`);
    }

    const messages = request.data?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      throw new HttpsError('invalid-argument', 'messages must be a non-empty array with at most 50 items');
    }

    const safePayload = {
      model,
      max_tokens:  maxTokens,
      messages,
      ...(request.data.system  ? { system:  request.data.system  } : {}),
      ...(request.data.tools   ? { tools:   request.data.tools   } : {}),
      ...(request.data.tool_choice ? { tool_choice: request.data.tool_choice } : {}),
    };

    try {
      const response = await client.messages.create(safePayload);
      // Firestore-safe: convert to plain object
      return JSON.parse(JSON.stringify(response));
    } catch (err) {
      console.error('anthropicProxy Anthropic error:', JSON.stringify({
        status:  err?.status,
        type:    err?.error?.type,
        message: err?.message,
        model:   safePayload.model,
      }));
      throw new HttpsError('internal', `Anthropic ${err?.status ?? ''} ${err?.error?.type ?? ''}: ${err?.message ?? err}`);
    }
  },
);

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

/**
 * deleteAuthUser — permanently deletes a Firebase Auth account.
 *
 * Only callable by the super-admin. Used when a workspace owner
 * is deleted from AdminPanel so the email can be re-used for
 * a fresh registration.
 *
 * Request data: { uid: string }
 * Returns:      { success: boolean, message?: string }
 */
exports.deleteAuthUser = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    // ── Auth guard ──────────────────────────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    if (request.auth.token.email !== SUPER_ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'Super-admin access required.');
    }

    const { uid } = request.data;
    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'uid is required.');
    }

    // Prevent the super-admin from accidentally deleting themselves
    if (uid === request.auth.uid) {
      throw new HttpsError('invalid-argument', 'Cannot delete your own account.');
    }

    try {
      await admin.auth().deleteUser(uid);
      return { success: true };
    } catch (error) {
      // Treat "user not found" as success — already deleted
      if (error.code === 'auth/user-not-found') {
        return { success: true, message: 'User was already deleted from Auth.' };
      }
      console.error('deleteAuthUser error:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * sendPasswordResetToOwner — sends a password-reset email to a workspace owner.
 * Triggered from AdminPanel for technical support.
 *
 * Request data: { email: string }
 * Returns:      { success: boolean }
 */
/* ══════════════════════════════════════════════════════════════════════════
 * leadsWebhook — receives incoming leads from any external platform.
 *
 * URL:  POST /leadsWebhook?ws={workspaceId}&key={webhookSecret}
 *
 * Supports:
 *   • Generic flat JSON  → { name, email, phone, company, ... }
 *   • Facebook Lead Ads  → { entry:[{changes:[{value:{field_data:[...]}}]}] }
 *   • Any Zapier / Make / n8n payload
 *   • GET request → Facebook webhook verification challenge
 * ══════════════════════════════════════════════════════════════════════════ */
exports.leadsWebhook = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    const db = admin.firestore();
    const wsId   = req.query.ws  || req.query.workspace;
    const secret = req.query.key || req.query.secret;

    // ── Facebook webhook verification (GET) ─────────────────────────────────
    if (req.method === 'GET') {
      const mode      = req.query['hub.mode'];
      const challenge = req.query['hub.challenge'];
      const verify    = req.query['hub.verify_token'];
      if (mode === 'subscribe' && verify && verify === secret) {
        console.log('Facebook webhook verified for workspace:', wsId);
        res.status(200).send(challenge);
        return;
      }
      res.status(200).json({ status: 'RAY CRM Webhook endpoint active' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    if (!wsId || !secret) {
      res.status(400).json({ error: 'Missing ws or key parameter' });
      return;
    }

    // ── Validate secret against Firestore ────────────────────────────────────
    let wsData;
    try {
      const wsSnap = await db.collection('workspaces').doc(wsId).get();
      if (!wsSnap.exists) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      wsData = wsSnap.data();
    } catch (err) {
      console.error('leadsWebhook: Firestore error', err);
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    // Timing-safe comparison to prevent timing attacks
    const crypto = require('crypto');
    const secretValid = wsData.webhookSecret && secret &&
      wsData.webhookSecret.length === secret.length &&
      crypto.timingSafeEqual(Buffer.from(wsData.webhookSecret), Buffer.from(secret));
    if (!secretValid) {
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = req.body;
    let parsed = null;

    // ── Google Ads Lead Form Extensions ─────────────────────────────────────
    // Format: { google_key, lead_id, user_column_data: [{column_name, string_value}], campaign_name, ... }
    if (body?.user_column_data && Array.isArray(body.user_column_data)) {
      // Verify Google webhook key if configured
      const googleKey = wsData.googleAdsWebhookKey;
      if (googleKey && body.google_key !== googleKey) {
        console.warn('[leadsWebhook] Google Ads: invalid google_key');
        res.status(401).json({ error: 'Invalid Google webhook key' });
        return;
      }

      // Map Google column names → flat object
      const flat = {};
      body.user_column_data.forEach(col => {
        const key = (col.column_name || '').toLowerCase();
        flat[key] = col.string_value || '';
      });

      // Add campaign metadata as source context
      flat.source        = 'גוגל';
      flat.utm_source    = 'google';
      flat.campaign_name = body.campaign_name || '';
      flat.campaign_id   = body.campaign_id  || '';
      flat.lead_id       = body.lead_id      || '';
      flat.form_name     = body.form_name    || '';

      // Google column names → normalize
      if (flat.full_name)     flat.name         = flat.full_name;
      if (flat.phone_number)  flat.phone        = flat.phone_number;
      if (flat.email_address) flat.email        = flat.email_address;
      if (flat.company_name)  flat.company      = flat.company_name;
      if (flat.job_title)     flat.job_title    = flat.job_title;

      parsed = parseLead(flat, 'גוגל');
      if (body.campaign_name) parsed.source = `גוגל — ${body.campaign_name}`;
      if (body.is_test) console.log('[leadsWebhook] Google Ads TEST lead received');
    }

    // Meta real-time leadgen notification (has leadgen_id, no field_data yet)
    // Format: { object:"page", entry:[{changes:[{field:"leadgen", value:{leadgen_id,page_id}}]}] }
    if (body?.object === 'page' && body?.entry?.[0]?.changes?.[0]?.field === 'leadgen') {
      const value    = body.entry[0].changes[0].value;
      const leadgenId = value.leadgen_id;
      const pageId    = value.page_id;

      // Find the page access token from metaIntegration
      const metaPages = wsData.metaIntegration?.pages ?? [];
      const page = metaPages.find(p => p.id === pageId);
      const pageToken = page?.accessToken;

      if (leadgenId && pageToken) {
        try {
          const gRes  = await fetch(
            `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${pageToken}&fields=field_data,created_time,form_id`
          );
          const gData = await gRes.json();
          if (!gData.error && gData.field_data) {
            const flat = {};
            gData.field_data.forEach(f => { flat[f.name] = Array.isArray(f.values) ? f.values[0] : f.values; });
            parsed = parseLead(flat, 'פייסבוק');
          }
        } catch (fetchErr) {
          console.error('[leadsWebhook] Graph API fetch error:', fetchErr);
        }
      }
      // If we couldn't fetch the lead, still return 200 so Meta doesn't retry
      if (!parsed) {
        console.warn('[leadsWebhook] Meta real-time: no token or fetch failed for leadgen', leadgenId);
        res.status(200).json({ received: true });
        return;
      }
    }
    // Facebook Lead Ads with embedded field_data (older webhook format)
    else if (body?.entry?.[0]?.changes?.[0]?.value?.field_data) {
      const fieldData = body.entry[0].changes[0].value.field_data;
      const flat = {};
      fieldData.forEach(f => { flat[f.name] = Array.isArray(f.values) ? f.values[0] : f.values; });
      parsed = parseLead(flat, 'פייסבוק');
    }
    // Flat JSON (Zapier, Make, generic)
    else if (body && typeof body === 'object' && !Array.isArray(body)) {
      const defaultSrc = wsData.webhookDefaultSource || 'פרסום ממומן';
      parsed = parseLead(body, defaultSrc);
    }
    // Array of leads (bulk)
    else if (Array.isArray(body) && body.length > 0) {
      const defaultSrc = wsData.webhookDefaultSource || 'פרסום ממומן';
      parsed = parseLead(body[0], defaultSrc);
    }

    if (!parsed) {
      res.status(400).json({ error: 'Could not parse lead from request body' });
      return;
    }

    // ── Build the Lead document ──────────────────────────────────────────────
    const now = new Date();
    const dd  = String(now.getDate()).padStart(2, '0');
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    const leadId  = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const newLead = {
      id:             leadId,
      company:        parsed.company || parsed.contactName || 'ליד חדש',
      contactName:    parsed.contactName || '',
      email:          parsed.email || '',
      phone:          parsed.phone || '',
      status:         'חדש',
      budget:         parsed.budget || 0,
      solutions:      [],
      assignedTo:     wsData.webhookDefaultAssignedTo || '',
      source:         parsed.source,
      lastUpdate:     dateStr,
      createdAt:      Date.now(),
      aiScore:        50,
      notes:          [],
      tasks:          [],
      futureNotes:    [],
      waitingContent: false,
      _webhookSource: 'webhook',   // internal tag for debugging
    };

    // ── Save to Firestore ────────────────────────────────────────────────────
    try {
      await db.collection('workspaces').doc(wsId).collection('leads').doc(leadId).set(newLead);
      console.log(`[leadsWebhook] Created lead ${leadId} for workspace ${wsId} (${parsed.source})`);
      res.status(200).json({ success: true, leadId });
    } catch (err) {
      console.error('[leadsWebhook] Error saving lead:', err);
      res.status(500).json({ error: 'Failed to save lead' });
    }
  }
);

/**
 * parseLead — maps any flat key-value object to our Lead fields.
 * Handles many common field name variations from different platforms.
 */
function parseLead(data, defaultSource) {
  const get = (...keys) => {
    for (const k of keys) {
      const v = data[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  };

  // Name
  const firstName   = get('first_name', 'firstName', 'fname', 'שם פרטי');
  const lastName    = get('last_name',  'lastName',  'lname', 'שם משפחה');
  const fullName    = get('full_name', 'fullName', 'name', 'contact_name',
                          'lead_name', 'שם', 'שם מלא');
  const contactName = fullName
    || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || '');

  // Contact
  const email = get('email', 'email_address', 'mail', 'אימייל', 'דוא"ל');
  const phone = get(
    'phone', 'phone_number', 'phone_num', 'mobile', 'cell', 'telephone',
    'mobile_number', 'טלפון', 'נייד', 'מספר טלפון',
  );

  // Company
  const company = get(
    'company', 'company_name', 'business', 'business_name',
    'organization', 'חברה', 'עסק', 'שם עסק',
  );

  // Budget
  const budgetRaw = get('budget', 'amount', 'deal_value', 'value', 'price', 'תקציב');
  const budget    = budgetRaw ? (parseInt(budgetRaw.replace(/[^\d]/g, ''), 10) || 0) : 0;

  // Source detection
  let source = defaultSource;
  const srcHint = get('source', 'utm_source', 'platform', 'channel', 'lead_source', 'מקור');
  if (srcHint) {
    const s = srcHint.toLowerCase();
    if      (s.includes('facebook') || s.includes('fb') || s.includes('meta')) source = 'פייסבוק';
    else if (s.includes('instagram') || s.includes('ig'))                       source = 'אינסטגרם';
    else if (s.includes('google'))                                               source = 'גוגל';
    else if (s.includes('organic') || s.includes('אורגני'))                     source = 'אורגני';
    else if (s.includes('referral') || s.includes('refer') || s.includes('הפניה')) source = 'הפניה';
    else                                                                         source = 'פרסום ממומן';
  }

  return { contactName, email, phone, company, budget, source };
}

/* ══════════════════════════════════════════════════════════════════════════
 * metaOAuthCallback — handles Facebook OAuth redirect after user approval.
 *
 * Facebook redirects here: GET /metaOAuthCallback?code=...&state={workspaceId}
 *
 * Flow:
 *  1. Reads workspace's metaAppId + metaAppSecret from Firestore
 *  2. Exchanges code → short-lived user token
 *  3. Extends to long-lived token (~60 days)
 *  4. Fetches user's Facebook Pages + page access tokens
 *  5. Stores metaIntegration in Firestore
 *  6. Redirects back to CRM with ?meta_connected=success
 * ══════════════════════════════════════════════════════════════════════════ */
exports.metaOAuthCallback = onRequest(
  { region: 'us-central1', cors: false },
  async (req, res) => {
    const allowedOrigins = [
      'https://admin.ray-crm.com',
      'https://ray-crm.com',
      'https://ray-crm-app.web.app',
      'https://chex-crm.web.app',
    ];
    // Decode state: base64("workspaceId|origin") or plain workspaceId (legacy)
    const rawState = String(req.query.state || '');
    let workspaceId = rawState;
    let redirectOrigin = 'https://ray-crm-app.web.app';
    try {
      const decoded = Buffer.from(rawState, 'base64').toString('utf8');
      if (decoded.includes('|')) {
        const [wsId, origin] = decoded.split('|');
        workspaceId = wsId;
        if (allowedOrigins.includes(origin)) redirectOrigin = origin;
      }
    } catch { /* legacy state — use as-is */ }
    const REDIRECT_BASE = `${redirectOrigin}/?page=integrations`;
    const { code, error } = req.query;

    if (error) {
      res.redirect(`${REDIRECT_BASE}&meta_error=${encodeURIComponent(String(error))}`);
      return;
    }
    if (!code || !workspaceId) {
      res.redirect(`${REDIRECT_BASE}&meta_error=missing_params`);
      return;
    }

    const db = admin.firestore();

    // ── Load workspace credentials ───────────────────────────────────────────
    let wsData;
    try {
      const snap = await db.collection('workspaces').doc(workspaceId).get();
      if (!snap.exists) { res.redirect(`${REDIRECT_BASE}&meta_error=workspace_not_found`); return; }
      wsData = snap.data();
    } catch {
      res.redirect(`${REDIRECT_BASE}&meta_error=db_error`); return;
    }

    const appId     = wsData.metaAppId;
    const appSecret = wsData.metaAppSecret;
    if (!appId || !appSecret) {
      res.redirect(`${REDIRECT_BASE}&meta_error=app_credentials_missing`); return;
    }

    const REDIRECT_URI = 'https://us-central1-chex-crm.cloudfunctions.net/metaOAuthCallback';

    try {
      // ── Step 1: Exchange code for short-lived user token ─────────────────
      const tokenRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token` +
        `?client_id=${appId}&client_secret=${appSecret}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
      );
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error.message);
      const shortToken = tokenData.access_token;

      // ── Step 2: Extend to long-lived token (~60 days) ────────────────────
      const llRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token` +
        `?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}` +
        `&fb_exchange_token=${shortToken}`
      );
      const llData    = await llRes.json();
      const longToken = llData.access_token || shortToken;
      const expiresIn = llData.expires_in   || 5183944; // ~60 days

      // ── Step 3: Get user's Facebook Pages ───────────────────────────────
      const pagesRes  = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts` +
        `?access_token=${longToken}&fields=id,name,access_token,category,fan_count`
      );
      const pagesData = await pagesRes.json();
      const pages = (pagesData.data ?? []).map(p => ({
        id:          p.id,
        name:        p.name,
        category:    p.category    ?? '',
        fanCount:    p.fan_count   ?? 0,
        accessToken: p.access_token,
        subscribed:  false,
        leadCount:   0,
      }));

      // Fetch Instagram Business Account for each page
      const pagesWithIG = await Promise.all(pages.map(async (page) => {
        try {
          const igRes = await fetch(
            `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.accessToken}`
          );
          const igData = await igRes.json();
          return {
            ...page,
            instagramBusinessAccountId: igData.instagram_business_account?.id ?? null,
          };
        } catch {
          return { ...page, instagramBusinessAccountId: null };
        }
      }));

      // ── Step 4b: Fetch user's Ad Accounts ─────────────────────────────────
      let adAccounts = [];
      try {
        const adAccountsRes = await fetch(
          `https://graph.facebook.com/v21.0/me/adaccounts` +
          `?fields=id,name,currency,account_status,funding_source_details` +
          `&access_token=${longToken}&limit=50`
        );
        const adAccountsData = await adAccountsRes.json();
        adAccounts = (adAccountsData.data ?? []).map(a => ({
          id:              a.id.replace('act_', ''),
          name:            a.name || '',
          currency:        a.currency || 'ILS',
          hasPaymentMethod: !!(a.funding_source_details),
          status:          a.account_status === 1 ? 'ACTIVE' :
                           a.account_status === 2 ? 'DISABLED' :
                           a.account_status === 9 ? 'UNSETTLED' : 'OTHER',
        }));
      } catch (e) {
        console.warn('[metaOAuthCallback] Could not fetch ad accounts:', e.message);
      }

      // ── Step 4: Persist to Firestore ─────────────────────────────────────
      const now       = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      await db.collection('workspaces').doc(workspaceId).update({
        metaIntegration: {
          connected:            true,
          userAccessToken:      longToken,
          expiresAt,
          pages:                pagesWithIG,
          adAccounts,
          connectedAt:          now,
          updatedAt:            now,
          hasPostingPermission: true,
        },
      });

      console.log(`[metaOAuthCallback] Connected workspace ${workspaceId} — ${pagesWithIG.length} pages`);
      res.redirect(`${REDIRECT_BASE}&meta_connected=success&pages=${pages.length}`);
    } catch (err) {
      console.error('[metaOAuthCallback] Error:', err);
      res.redirect(`${REDIRECT_BASE}&meta_error=${encodeURIComponent(err.message)}`);
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * metaSubscribePage — subscribe/unsubscribe a Facebook Page to leadgen events.
 *
 * When subscribed, Facebook sends real-time POST to the workspace's webhook URL
 * whenever a new lead form is submitted on that page.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.metaSubscribePage = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { workspaceId, pageId, subscribe } = request.data;
    const db = admin.firestore();

    const snap = await db.collection('workspaces').doc(workspaceId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Workspace not found.');
    const wsData = snap.data();

    const integration = wsData.metaIntegration;
    if (!integration?.connected) throw new HttpsError('failed-precondition', 'Meta not connected.');

    const page = (integration.pages ?? []).find(p => p.id === pageId);
    if (!page) throw new HttpsError('not-found', 'Page not found in integration.');

    const webhookSecret = wsData.webhookSecret;
    const webhookUrl    = webhookSecret
      ? `https://us-central1-chex-crm.cloudfunctions.net/leadsWebhook?ws=${workspaceId}&key=${webhookSecret}`
      : null;

    if (subscribe) {
      // Subscribe the page to leadgen webhook events
      const subRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            subscribed_fields: ['leadgen'],
            access_token:      page.accessToken,
          }),
        }
      );
      const subData = await subRes.json();
      if (subData.error) throw new HttpsError('internal', subData.error.message);
      console.log(`[metaSubscribePage] Subscribed page ${pageId} for workspace ${workspaceId}`);
    } else {
      // Unsubscribe
      const delRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?access_token=${page.accessToken}`,
        { method: 'DELETE' }
      );
      const delData = await delRes.json();
      if (delData.error) throw new HttpsError('internal', delData.error.message);
    }

    // Update subscribed flag in Firestore
    const updatedPages = integration.pages.map(p =>
      p.id === pageId ? { ...p, subscribed: subscribe } : p
    );
    await db.collection('workspaces').doc(workspaceId).update({
      'metaIntegration.pages':     updatedPages,
      'metaIntegration.updatedAt': new Date().toISOString(),
    });

    return { success: true, webhookUrl };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * metaDisconnect — revoke Meta integration for a workspace.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.metaDisconnect = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { workspaceId } = request.data;
    const db = admin.firestore();

    await db.collection('workspaces').doc(workspaceId).update({
      'metaIntegration.connected':       false,
      'metaIntegration.userAccessToken': admin.firestore.FieldValue.delete(),
      'metaIntegration.updatedAt':       new Date().toISOString(),
    });

    console.log(`[metaDisconnect] Disconnected workspace ${workspaceId}`);
    return { success: true };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * createCheckoutSession — creates a Stripe Checkout session.
 *
 * Request data:
 *   type: 'topup' | 'plan'
 *   workspaceId: string
 *   dollars: number          (topup: USD amount)
 *   planKey?: string         (plan: 'pro' | 'enterprise')
 *   priceIls?: number        (plan: price in ILS before VAT)
 *   label: string            (display label)
 *   successUrl: string
 *   cancelUrl: string
 *
 * Returns: { url: string }
 * ══════════════════════════════════════════════════════════════════════════ */
/**
 * Resolve a plan key to its Stripe recurring Price.
 *
 * Looked up by product name rather than a hard-coded price id, so changing a
 * price in the dashboard does not require a redeploy — and so there is no id to
 * copy by hand and get wrong. Cached per instance because it is the same three
 * products on every checkout.
 */
const PLAN_PRODUCT_NAME = {
  basic:      'RAY CRM — Basic',
  pro:        'RAY CRM — Pro',
  enterprise: 'RAY CRM — Enterprise',
};
const planPriceCache = {};

async function resolvePlanPrice(stripe, planKey) {
  if (planPriceCache[planKey]) return planPriceCache[planKey];

  const wanted = PLAN_PRODUCT_NAME[planKey];
  if (!wanted) throw new HttpsError('invalid-argument', `Unknown plan: ${planKey}`);

  const prices = await stripe.prices.list({ active: true, type: 'recurring', limit: 100, expand: ['data.product'] });
  const match = prices.data.find(pr => pr.product && pr.product.name === wanted);
  if (!match) {
    throw new HttpsError(
      'failed-precondition',
      `No active recurring price found for "${wanted}". Create the product in Stripe with a monthly ILS price.`,
    );
  }
  planPriceCache[planKey] = match.id;
  return match.id;
}

/**
 * The live plan prices, read from Stripe.
 *
 * The billing page used to hard-code 89/179/329 while Stripe held the real
 * numbers, so changing a price meant editing code and redeploying — and the two
 * could silently disagree, showing a customer one price and charging another.
 * This makes Stripe the single source of truth for both.
 */
/**
 * Set tax_behavior on the plan prices so Stripe Tax can add VAT on top.
 *
 * A price created without it is "unspecified", and automatic tax refuses to
 * compute against that — so this is a prerequisite for VAT ever being charged
 * correctly. Stripe only allows the field to be set while it is unspecified,
 * which is why this is a one-way, idempotent repair rather than a toggle.
 *
 * "exclusive" means the ₪89/179/329 are pre-VAT and tax is added, matching what
 * the pricing page has always told customers ("+ מע\"מ").
 */
exports.setPlanTaxBehavior = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (request.auth.token.email !== SUPER_ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'Super-admin only.');
    }
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new HttpsError('failed-precondition', 'Stripe not configured.');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const prices = await stripe.prices.list({
      active: true, type: 'recurring', limit: 100, expand: ['data.product'],
    });
    const wanted = new Set(Object.values(PLAN_PRODUCT_NAME));
    const out = [];

    for (const pr of prices.data) {
      if (!pr.product || !wanted.has(pr.product.name)) continue;
      if (pr.tax_behavior && pr.tax_behavior !== 'unspecified') {
        out.push({ price: pr.id, product: pr.product.name, taxBehavior: pr.tax_behavior, changed: false });
        continue;
      }
      try {
        const updated = await stripe.prices.update(pr.id, { tax_behavior: 'exclusive' });
        out.push({ price: pr.id, product: pr.product.name, taxBehavior: updated.tax_behavior, changed: true });
      } catch (err) {
        out.push({ price: pr.id, product: pr.product.name, error: err.message });
      }
    }
    return { results: out };
  },
);

exports.getPlanPricing = onCall(
  { region: 'us-central1' },
  async () => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return { configured: false, plans: [] };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    try {
      const prices = await stripe.prices.list({
        active: true, type: 'recurring', limit: 100, expand: ['data.product'],
      });
      const plans = Object.entries(PLAN_PRODUCT_NAME).map(([key, name]) => {
        const m = prices.data.find(pr => pr.product && pr.product.name === name);
        if (!m) return null;
        return {
          key,
          priceId:  m.id,
          amount:   (m.unit_amount ?? 0) / 100,
          currency: m.currency,
          interval: m.recurring?.interval ?? 'month',
          // Whether the displayed amount already contains tax, so the page can
          // say "+ VAT" or not without guessing.
          taxBehavior: m.tax_behavior ?? 'unspecified',
        };
      }).filter(Boolean);
      return { configured: true, plans };
    } catch (err) {
      console.error('[getPlanPricing]', err);
      return { configured: false, plans: [], error: err.message };
    }
  },
);

/**
 * One Stripe customer per workspace, reused for every purchase.
 *
 * Checkout will happily create a fresh customer on each session, but that
 * scatters a workspace's billing across unrelated customer records: a second
 * upgrade becomes a second active subscription rather than a change to the
 * first, and nothing in the dashboard connects them. Reusing one customer also
 * makes `customer_update` legal — Stripe rejects it outright when no customer
 * is supplied, which is what took plan checkout down.
 *
 * The id is only stored on a workspace that already exists; checkout is not a
 * path that should be able to bring a workspace into being.
 */
async function getOrCreateStripeCustomer(stripe, workspaceId, email) {
  const ref = admin.firestore().collection('workspaces').doc(workspaceId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data()?.stripeCustomerId : null;
  if (existing) {
    // Verify rather than trust: a customer deleted in the dashboard would
    // otherwise fail every future checkout with a stale id.
    try {
      const c = await stripe.customers.retrieve(existing);
      if (c && !c.deleted) return existing;
    } catch { /* fall through and mint a new one */ }
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    name: snap.exists ? (snap.data()?.name ?? undefined) : undefined,
    metadata: { workspaceId },
  });
  if (snap.exists) {
    await ref.set({ stripeCustomerId: customer.id }, { merge: true }).catch(e =>
      // The customer exists either way; losing the pointer costs a duplicate
      // record next time, not this sale.
      console.error('[getOrCreateStripeCustomer] could not persist id', e));
  }
  return customer.id;
}

/**
 * The Israeli VAT rate added to every charge.
 *
 * Stripe Tax — which computes rates automatically — is not available to Israeli
 * accounts at all ("Stripe Tax isn't yet supported for your country"), and
 * requesting automatic_tax without it does not fail loudly: Stripe accepts the
 * session and silently computes nothing, so checkout showed a bare price and no
 * VAT was ever collected. A manual Tax Rate is the supported alternative.
 *
 * Looked up by metadata rather than a hard-coded id, so the rate can be swapped
 * from the dashboard: when the VAT rate next changes, create a new rate carrying
 * the same marker and deactivate the old one, with no redeploy and no repeat of
 * the stale hard-coded 1.17 this replaced.
 *
 * Returns null rather than throwing when none is found — refusing the sale would
 * be a worse failure than charging without a tax line — but says so in the log.
 *
 * KNOWN LIMITATION: this rate is applied to every customer regardless of where
 * they are, so a buyer outside Israel is charged Israeli VAT they do not owe —
 * exports are zero-rated. Stripe offers no fix for this account: `Stripe Tax`
 * is unavailable to Israeli accounts, and `dynamic_tax_rates` (which chose a
 * rate by billing country) has been removed from the API. It is harmless while
 * the product is Hebrew-only and priced in ILS. Before selling abroad, decide
 * the rate here from the workspace's own country — which this server knows at
 * session-creation time — rather than from the address Stripe collects later.
 */
let vatRateCache;
async function resolveVatRate(stripe) {
  if (vatRateCache !== undefined) return vatRateCache;
  const rates = await stripe.taxRates.list({ active: true, limit: 100 });
  const rate = rates.data.find(r => r.metadata?.ray_vat === 'il');
  if (!rate) {
    console.warn('[resolveVatRate] no active tax rate tagged ray_vat=il — charging without VAT');
  }
  vatRateCache = rate ? rate.id : null;
  return vatRateCache;
}

exports.createCheckoutSession = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new HttpsError('internal', 'Stripe not configured on server.');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const {
      type, workspaceId, dollars, planKey, priceIls, label, successUrl, cancelUrl,
    } = request.data;

    if (!workspaceId || !successUrl || !cancelUrl || !type) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    let lineItem;
    let metadata;

    if (type === 'topup') {
      if (!dollars || dollars <= 0) throw new HttpsError('invalid-argument', 'Invalid dollar amount.');
      lineItem = {
        price_data: {
          currency: 'usd',
          product_data: { name: `RAY CRM — ${label || dollars + '$'} טוקני AI` },
          unit_amount: Math.round(dollars * 100), // cents
        },
        quantity: 1,
      };
      metadata = { workspaceId, type: 'topup', dollars: String(dollars), label: label ?? '' };

    } else if (type === 'plan') {
      if (!planKey) throw new HttpsError('invalid-argument', 'Missing plan data.');
      // A plan is a SUBSCRIPTION. It used to be charged with mode:'payment' and
      // an inline price, which billed the customer exactly once — every renewal
      // would have had to be collected by hand.
      const priceId = await resolvePlanPrice(stripe, planKey);
      lineItem = { price: priceId, quantity: 1 };
      metadata = { workspaceId, type: 'plan', planKey, label: label ?? '' };

    } else {
      throw new HttpsError('invalid-argument', 'Invalid type. Must be "topup" or "plan".');
    }

    try {
      const isSubscription = type === 'plan';
      const customerId = await getOrCreateStripeCustomer(
        stripe, workspaceId, request.auth.token.email,
      );
      const vatRateId = await resolveVatRate(stripe);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer: customerId,
        line_items: [vatRateId ? { ...lineItem, tax_rates: [vatRateId] } : lineItem],
        mode: isSubscription ? 'subscription' : 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        // Collected so the invoice carries a real address, and saved back onto
        // the reused customer rather than being discarded with the session.
        billing_address_collection: 'required',
        customer_update: { address: 'auto', name: 'auto' },
        // The subscription carries its own copy: webhooks for renewals and
        // cancellations arrive against the subscription, not the checkout
        // session, and without this they would not know which workspace to act on.
        ...(isSubscription ? { subscription_data: { metadata } } : {}),
      });

      console.log(`[createCheckoutSession] Created session ${session.id} for workspace ${workspaceId} (${type}, vat=${vatRateId ?? 'none'})`);
      return { url: session.url };
    } catch (err) {
      console.error('[createCheckoutSession] Stripe error:', err);
      throw new HttpsError('internal', err.message);
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * stripeWebhook — receives Stripe payment events (checkout.session.completed).
 *
 * On topup:
 *   • Adds dollars to workspace tokenBalance + tokenPlanAllocation
 *   • Deducts dollars/2 from admin quota  (50% margin)
 *
 * On plan:
 *   • Updates workspace plan + status
 *   • Resets tokenBalance / tokenPlanAllocation to plan allocation
 * ══════════════════════════════════════════════════════════════════════════ */
exports.stripeWebhook = onRequest(
  { region: 'us-central1', cors: false },
  async (req, res) => {
    const stripeKey     = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeKey || !webhookSecret) {
      console.error('[stripeWebhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
      res.status(500).json({ error: 'Stripe not configured' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('[stripeWebhook] Signature error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    /* ── Subscription lifecycle ────────────────────────────────────────────
     * Without these a cancelled or unpaid subscription would leave the customer
     * on a paid plan forever: the only event previously handled was the initial
     * checkout, so Stripe could stop collecting and the app would never know.
     */
    if (event.type === 'customer.subscription.deleted'
     || event.type === 'customer.subscription.updated'
     || event.type === 'invoice.payment_failed') {
      const obj = event.data.object;
      const wid = obj.metadata?.workspaceId
        ?? obj.subscription_details?.metadata?.workspaceId;
      if (!wid) { res.json({ received: true }); return; }

      const db = admin.firestore();
      const ended = event.type === 'customer.subscription.deleted'
        || ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status);
      const pastDue = event.type === 'invoice.payment_failed' || obj.status === 'past_due';

      try {
        await db.collection('workspaces').doc(wid).update(
          ended
            // Downgrade rather than delete: the customer keeps their data and
            // can resubscribe, they simply lose the paid tier.
            ? { plan: 'basic', subscriptionStatus: 'canceled', subscriptionEndedAt: new Date().toISOString() }
            : { subscriptionStatus: pastDue ? 'past_due' : (obj.status ?? 'active') },
        );
        console.log(`[stripeWebhook] ${event.type} → workspace ${wid} (${ended ? 'downgraded' : obj.status})`);
      } catch (err) {
        console.error(`[stripeWebhook] failed to apply ${event.type} for ${wid}`, err);
      }
      res.json({ received: true });
      return;
    }

    if (event.type !== 'checkout.session.completed') {
      res.json({ received: true });
      return;
    }

    const session = event.data.object;
    const meta    = session.metadata ?? {};
    const { workspaceId, type, dollars, planKey } = meta;

    if (!workspaceId) {
      console.error('[stripeWebhook] No workspaceId in session metadata');
      res.json({ received: true });
      return;
    }

    const db  = admin.firestore();
    const now = new Date().toISOString();

    try {
      if (type === 'topup') {
        /* ── Token top-up ─────────────────────────────────────────────── */
        const dollarsNum = parseFloat(dollars);

        // 1. Add to workspace balance
        await db.runTransaction(async (tx) => {
          const wsRef  = db.collection('workspaces').doc(workspaceId);
          const wsSnap = await tx.get(wsRef);
          if (!wsSnap.exists) throw new Error('Workspace not found');
          const ws = wsSnap.data();

          const newBalance    = (ws.tokenBalance    ?? 0) + dollarsNum;
          const newAllocation = (ws.tokenPlanAllocation ?? 0) + dollarsNum;
          const history       = (ws.tokenHistory ?? []).slice(-49);
          history.push({
            id:              `topup_${Date.now()}`,
            type:            'topup',
            amount:          dollarsNum,
            description:     `רכישת טוקנים: ${meta.label || dollarsNum + '$'}`,
            timestamp:       now,
            stripeSessionId: session.id,
          });

          tx.update(wsRef, {
            tokenBalance:        newBalance,
            tokenPlanAllocation: newAllocation,
            tokenHistory:        history,
          });
        });

        // 2. Deduct 50% from admin quota (admin's real Anthropic cost)
        const adminRef = db.collection('system').doc('adminQuota');
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(adminRef);
          if (snap.exists) {
            tx.update(adminRef, {
              allocated: (snap.data().allocated ?? 0) + dollarsNum / 2,
            });
          }
        });

        console.log(`[stripeWebhook] Topup OK: ws=${workspaceId} +$${dollarsNum}`);

      } else if (type === 'plan') {
        /* ── Plan upgrade ─────────────────────────────────────────────── */
        const PLAN_TOKENS = { pro: 50, enterprise: 200 };
        const planDollars = PLAN_TOKENS[planKey] ?? 0;

        await db.runTransaction(async (tx) => {
          const wsRef  = db.collection('workspaces').doc(workspaceId);
          const wsSnap = await tx.get(wsRef);
          if (!wsSnap.exists) throw new Error('Workspace not found');
          const ws = wsSnap.data();

          const history = (ws.tokenHistory ?? []).slice(-49);
          history.push({
            id:              `plan_${Date.now()}`,
            type:            'plan',
            amount:          planDollars,
            description:     `שדרוג תוכנית: ${planKey}`,
            timestamp:       now,
            stripeSessionId: session.id,
          });

          tx.update(wsRef, {
            plan:                planKey,
            status:              'active',
            tokenBalance:        planDollars,
            tokenPlanAllocation: planDollars,
            tokenHistory:        history,
          });
        });

        console.log(`[stripeWebhook] Plan upgrade OK: ws=${workspaceId} → ${planKey}`);
      }
    } catch (err) {
      console.error('[stripeWebhook] Processing error:', err);
      // Return 200 so Stripe doesn't retry — log for manual resolution
      res.json({ received: true, processingError: err.message });
      return;
    }

    res.json({ received: true });
  }
);

exports.sendPasswordResetToOwner = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    if (request.auth.token.email !== SUPER_ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'Super-admin access required.');
    }

    const { email } = request.data;
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'email is required.');
    }

    try {
      await admin.auth().generatePasswordResetLink(email);
      // Note: generatePasswordResetLink returns the link; we send via Firebase's
      // built-in email or you can use a mail service. For now we use sendEmail.
      // The simplest approach: use Firebase Auth's built-in reset email.
      // Unfortunately Admin SDK doesn't directly "send" — it generates a link.
      // We'll mark success and the frontend will call sendPasswordResetEmail
      // via the client SDK which does send the email.
      return { success: true };
    } catch (error) {
      console.error('sendPasswordResetToOwner error:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * sendEmail — sends an email using the workspace's configured email provider.
 *
 * Supported providers:
 *   'gmail'   — Gmail SMTP using App Password (default)
 *   'outlook' — Microsoft Office 365 SMTP using App Password
 *
 * Credentials are read server-side from Firestore — never exposed to client.
 *
 * Request data:
 *   { workspaceId?: string, to: string, subject: string,
 *     htmlBody: string, textBody?: string }
 *
 * Returns: { success: true }
 * ══════════════════════════════════════════════════════════════════════════ */
/**
 * Resend transactional-email sender.
 *
 * Platform mail (invites, system notices) goes out through Resend rather than a
 * customer's Gmail SMTP for three reasons:
 *   • From can be any verified-domain address, so noreply@ray-crm.com actually
 *     appears as the sender — SMTP providers rewrite From to the authenticated
 *     mailbox and silently ignore what we asked for.
 *   • Gmail's per-day send caps don't apply, and one workspace tripping a cap
 *     can't take down sign-ups for everyone.
 *   • Deliveries, bounces and spam complaints are queryable when a customer
 *     reports "I never got the invite".
 *
 * Node 20 has global fetch, so this needs no extra dependency.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_PLATFORM_FROM = 'RAY CRM <noreply@ray-crm.com>';

/** Statuses that mean the request was rejected outright — nothing was sent, so
 *  falling back to SMTP cannot produce a duplicate. */
const RESEND_SAFE_TO_RETRY = new Set([401, 403, 404, 422]);

async function sendViaResend({ apiKey, from, to, subject, html, text, replyTo, headers }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(headers ? { headers } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    err.safeToRetry = RESEND_SAFE_TO_RETRY.has(res.status);
    throw err;
  }
  return res.json().catch(() => ({}));
}

exports.sendEmail = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to send email.');
    }

    const {
      workspaceId, to, subject, htmlBody, textBody,
      // Platform mail (invites, system notices) should come FROM RAY, not from
      // whichever customer mailbox happens to be configured on the workspace.
      preferPlatform, replyTo, fromNameOverride, noReply,
    } = request.data || {};

    if (!to || !subject || (!htmlBody && !textBody)) {
      throw new HttpsError('invalid-argument', 'Missing required fields: to, subject, htmlBody or textBody.');
    }

    const db = admin.firestore();

    // ── Platform mail via Resend, when configured ──────────────────────────
    // Tried BEFORE reading SMTP credentials: platform mail must not depend on
    // the workspace having its own mailbox set up at all.
    const resendKey = process.env.RESEND_API_KEY;
    if (preferPlatform && resendKey) {
      let platformFrom = DEFAULT_PLATFORM_FROM;
      try {
        const sysSnap = await db.collection('system').doc('emailConfig').get();
        platformFrom = (sysSnap.data() || {}).platformFrom || DEFAULT_PLATFORM_FROM;
      } catch { /* fall back to the default sender */ }

      try {
        await sendViaResend({
          apiKey: resendKey,
          from: platformFrom,
          to,
          subject,
          html: htmlBody || textBody,
          text: textBody || undefined,
          replyTo,
          headers: noReply
            ? { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }
            : undefined,
        });
        console.log(`sendEmail: sent to ${to} via Resend as ${platformFrom}`);
        return { success: true, via: 'resend' };
      } catch (err) {
        // Only a definitively-rejected request falls through to SMTP; anything
        // else may already have been accepted and retrying would double-send.
        console.error('sendEmail: Resend error:', err.message);
        if (!err.safeToRetry) {
          throw new HttpsError('internal', `Failed to send email via Resend: ${err.message}`);
        }
        console.warn('sendEmail: falling back to SMTP after recoverable Resend error');
      }
    }

    // ── Read email credentials from Firestore ──────────────────────────────
    let gmailUser, gmailAppPassword, fromName, emailProvider;

    const readPlatform = async () => {
      const sysSnap = await db.collection('system').doc('emailConfig').get();
      const d = sysSnap.data() || {};
      return {
        gmailUser: d.gmailUser,
        gmailAppPassword: d.gmailAppPassword,
        fromName: d.fromName,
        emailProvider: d.emailProvider || 'gmail',
      };
    };
    const readWorkspace = async (wid) => {
      const wsSnap = await db.collection('workspaces').doc(wid).get();
      const cfg = (wsSnap.data() || {}).emailConfig || {};
      return {
        gmailUser: cfg.gmailUser,
        gmailAppPassword: cfg.gmailAppPassword,
        fromName: cfg.fromName,
        emailProvider: cfg.emailProvider || 'gmail',
      };
    };

    try {
      let chosen = null;
      if (preferPlatform) {
        // Platform sender first; fall back to the workspace so a deployment
        // without a RAY mailbox configured still sends rather than failing.
        chosen = await readPlatform();
        if ((!chosen.gmailUser || !chosen.gmailAppPassword) && workspaceId) {
          chosen = await readWorkspace(workspaceId);
        }
      } else if (workspaceId) {
        chosen = await readWorkspace(workspaceId);
      } else {
        chosen = await readPlatform();
      }
      ({ gmailUser, gmailAppPassword, fromName, emailProvider } = chosen);
    } catch (err) {
      console.error('sendEmail: Firestore read error:', err);
      throw new HttpsError('internal', 'Failed to read email config.');
    }

    if (!gmailUser || !gmailAppPassword) {
      throw new HttpsError(
        'failed-precondition',
        'Email not configured. Please add email credentials in Integrations → חיבור אימייל.'
      );
    }

    // ── Build SMTP transport based on provider ────────────────────────────
    const nodemailer = require('nodemailer');
    let smtpConfig;

    if (emailProvider === 'outlook') {
      // Microsoft Office 365 / Outlook SMTP
      smtpConfig = {
        host:   'smtp.office365.com',
        port:   587,
        secure: false,
        auth:   { user: gmailUser, pass: gmailAppPassword },
        tls:    { ciphers: 'SSLv3', rejectUnauthorized: false },
      };
    } else {
      // Gmail (default)
      smtpConfig = {
        service: 'gmail',
        auth:    { user: gmailUser, pass: gmailAppPassword },
      };
    }

    const transporter = nodemailer.createTransport(smtpConfig);

    // IMPORTANT: the From ADDRESS cannot be chosen freely. Gmail and Office 365
    // both rewrite From to the authenticated mailbox unless that address is a
    // verified "send mail as" alias on the account. So we control the display
    // NAME (which is free) and steer replies with Reply-To, rather than
    // pretending to send from an address the provider would silently replace.
    const effectiveName = fromNameOverride || fromName;
    const fromHeader = effectiveName
      ? `"${effectiveName}" <${gmailUser}>`
      : gmailUser;

    // A no-reply message should not invite a reply that nobody reads. Reply-To
    // points at the dead address, and the auto-response headers tell well-behaved
    // clients and mailing systems not to generate replies or out-of-office bounces.
    const noReplyHeaders = noReply
      ? {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        }
      : undefined;

    try {
      await transporter.sendMail({
        from:    fromHeader,
        to,
        subject,
        html:    htmlBody  || textBody,
        text:    textBody  || htmlBody,
        ...(replyTo ? { replyTo } : {}),
        ...(noReplyHeaders ? { headers: noReplyHeaders } : {}),
      });
      console.log(`sendEmail: sent to ${to} via ${gmailUser} (provider: ${emailProvider})`);
      return { success: true };
    } catch (err) {
      console.error('sendEmail: Nodemailer error:', err);
      const msg = err.message || 'Unknown error';
      if (msg.includes('Invalid login') || msg.includes('Username and Password not accepted') || msg.includes('535')) {
        const providerName = emailProvider === 'outlook' ? 'Outlook' : 'Gmail';
        throw new HttpsError('unauthenticated', `${providerName} App Password is incorrect. Please check Integrations → חיבור אימייל.`);
      }
      throw new HttpsError('internal', `Failed to send email: ${msg}`);
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * whatsappWebhook  — receives incoming WhatsApp messages from Meta.
 *
 * Meta sends:
 *   GET  — webhook verification (hub.challenge handshake)
 *   POST — incoming messages / status updates
 *
 * Stores messages in Firestore:
 *   workspaces/{wid}/whatsapp/conversations/{phone}/messages/{msgId}
 *
 * Then calls Anthropic to draft an AI reply (stored in Firestore).
 *
 * Setup:
 *   1. Deploy this function → copy its URL
 *   2. Meta Developer portal → WhatsApp → Configuration → Webhook URL = this URL
 *   3. Verify token = value stored in workspaces/{wid}/whatsapp/config.webhookToken
 * ══════════════════════════════════════════════════════════════════════════ */
exports.whatsappWebhook = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    const db = admin.firestore();

    /* ── GET: Meta webhook verification ─────────────────────────────────── */
    if (req.method === 'GET') {
      const mode      = req.query['hub.mode'];
      const token     = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token) {
        // Find a workspace whose webhookToken matches
        const snap = await db.collectionGroup('whatsapp')
          .where('webhookToken', '==', token).limit(1).get().catch(() => null);

        if (snap && !snap.empty) {
          console.log('WhatsApp webhook verified ✓');
          res.status(200).send(challenge);
          return;
        }
      }
      res.sendStatus(403);
      return;
    }

    /* ── POST: Incoming message ──────────────────────────────────────────── */
    if (req.method !== 'POST') { res.sendStatus(405); return; }

    // ── Verify Meta X-Hub-Signature-256 ────────────────────────────────────
    const crypto = require('crypto');
    const waAppSecret = process.env.META_APP_SECRET;
    if (waAppSecret) {
      const sig = req.headers['x-hub-signature-256'];
      const rawBody = JSON.stringify(req.body);
      const expected = 'sha256=' + crypto.createHmac('sha256', waAppSecret).update(rawBody).digest('hex');
      if (!sig || sig.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        console.warn('whatsappWebhook: invalid signature — possible forgery attempt');
        res.sendStatus(403);
        return;
      }
    }

    res.sendStatus(200); // Acknowledge immediately (Meta requires < 1s)

    try {
      const body = req.body;
      if (body.object !== 'whatsapp_business_account') return;

      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field !== 'messages') continue;
          const val      = change.value;
          const phoneId  = val?.metadata?.phone_number_id;
          const messages = val?.messages || [];
          const contacts = val?.contacts || [];

          if (!phoneId || !messages.length) continue;

          // Find the workspace this phoneNumberId belongs to
          const cfgSnap = await db.collectionGroup('whatsapp')
            .where('phoneNumberId', '==', phoneId).limit(1).get();
          if (cfgSnap.empty) { console.warn('No workspace for phoneId', phoneId); continue; }

          const cfgDoc  = cfgSnap.docs[0];
          const wid     = cfgDoc.ref.parent.parent?.id;
          if (!wid) continue;

          const cfg = cfgDoc.data();

          // Load knowledge base for AI context
          const kbSnap = await db.collection(`workspaces/${wid}/emailAgent/knowledge/entries`).get();
          const knowledge = kbSnap.docs.map(d => d.data());
          const knowledgeText = knowledge.length
            ? knowledge.map(k => `שאלה: ${k.question}\nתשובה: ${k.answer}`).join('\n\n')
            : '';

          for (const msg of messages) {
            if (msg.type !== 'text') continue; // Skip non-text for now
            const phone     = msg.from;
            const msgText   = msg.text?.body ?? '';
            const msgId     = msg.id;
            const timestamp = parseInt(msg.timestamp ?? '0') * 1000;

            // Get contact name
            const contact = contacts.find(c => c.wa_id === phone);
            const name    = contact?.profile?.name || phone;

            const convRef = db.doc(`workspaces/${wid}/whatsapp/conversations/${phone}`);
            const msgRef  = convRef.collection('messages').doc(msgId);

            // Skip duplicates
            const existing = await msgRef.get();
            if (existing.exists) continue;

            // Update conversation summary
            await convRef.set({
              phone, name,
              lastMessage:   msgText,
              lastMessageAt: timestamp,
              status:        'active',
              updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            // Store the incoming message
            await msgRef.set({
              id: msgId, from: 'customer', text: msgText, timestamp,
              status: 'received', aiDraft: null, aiStatus: 'processing',
            });

            // Generate AI reply
            let aiDraft = '';
            let confidence = 70;
            let uncertainties = [];
            try {
              const Anthropic = require('@anthropic-ai/sdk');
              const agentCfgSnap = await db.doc(`workspaces/${wid}/emailAgent/config`).get();
              const agentCfg = agentCfgSnap.exists ? agentCfgSnap.data() : {};

              const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
              const aiResp = await client.messages.create({
                model: 'claude-opus-4-5',
                max_tokens: 512,
                messages: [{
                  role: 'user',
                  content: `אתה ${agentCfg.agentName || 'סוכן מכירות AI'} שעונה על הודעות WhatsApp.
סגנון: ${agentCfg.agentPersonality || 'מקצועי וידידותי'}.
שפה: עברית קצרה ולעניין (WhatsApp, לא מייל).

=== בסיס ידע ===
${knowledgeText || 'אין ידע מוגדר.'}

=== הודעה מ-${name} (${phone}) ===
${msgText}

=== חתימה ===
${agentCfg.signature || ''}

החזר JSON:
{"draft":"תגובת WhatsApp קצרה","confidence":85,"uncertainties":["שאלה אם לא יודע"]}`,
                }],
              });

              const text = aiResp?.content?.[0]?.text ?? '';
              const match = text.match(/\{[\s\S]*\}/);
              const parsed = JSON.parse(match?.[0] ?? '{}');
              aiDraft       = parsed.draft ?? text;
              confidence    = parsed.confidence ?? 70;
              uncertainties = parsed.uncertainties ?? [];
            } catch (aiErr) {
              console.error('AI error:', aiErr);
              aiDraft = '(שגיאת AI — ענה ידנית)';
            }

            // Update message with AI draft
            await msgRef.update({ aiDraft, confidence, uncertainties, aiStatus: 'ready' });
          }
        }
      }
    } catch (err) {
      // Log only the message — never log the full error object (may contain tokens/secrets)
      console.error('whatsappWebhook error:', err?.message ?? String(err));
    }
  }
);

/* ── sendWhatsApp — sends a WhatsApp message via Meta Graph API ──────────── */
exports.sendWhatsApp = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { phoneNumberId, accessToken, to, text } = request.data;
    if (!phoneNumberId || !accessToken || !to || !text) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type:              'text',
          text:              { preview_url: false, body: text },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new HttpsError('internal', `WhatsApp API error: ${err}`);
    }
    return { success: true };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * createFacebookPost — proxy for posting to a Facebook page.
 * Avoids exposing the page-level access token in the browser.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.createFacebookPost = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { pageId, message, pageToken, imageUrl } = request.data;
    if (!pageId || !message || !pageToken) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    if (imageUrl) {
      let res, data;
      if (imageUrl.startsWith('data:')) {
        // Binary upload via multipart — Facebook rejects data: URLs
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new HttpsError('invalid-argument', 'Invalid image data URL');
        const buffer = Buffer.from(match[2], 'base64');
        const form = new FormData();
        form.append('source', new Blob([buffer], { type: match[1] }), 'image.jpg');
        form.append('caption', message);
        form.append('access_token', pageToken);
        res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, { method: 'POST', body: form });
      } else {
        // Public HTTPS URL
        res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: message, url: imageUrl, access_token: pageToken }),
        });
      }
      data = await res.json();
      if (!res.ok || data.error) throw new HttpsError('internal', data.error?.message ?? `Graph API ${res.status}`);
      return { postId: data.post_id || data.id };
    } else {
      // Text-only post to /feed
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, access_token: pageToken }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new HttpsError('internal', data.error?.message ?? `Graph API ${res.status}`);
      return { postId: data.id };
    }
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * createInstagramPost — posts to an Instagram Business account via Meta Graph API.
 * Requires instagram_content_publish permission on the page access token.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.createInstagramPost = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { igUserId, caption, imageUrl, pageToken } = request.data;
    if (!igUserId || !caption || !pageToken) {
      throw new HttpsError('invalid-argument', 'Missing required fields: igUserId, caption, pageToken.');
    }

    // If imageUrl is a data: URL, upload to Facebook first to get a public HTTPS URL
    let resolvedImageUrl = imageUrl || null;
    if (imageUrl && imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const buffer = Buffer.from(match[2], 'base64');
        const form = new FormData();
        form.append('source', new Blob([buffer], { type: match[1] }), 'image.jpg');
        form.append('published', 'false');
        form.append('access_token', pageToken);
        // We need a FB page ID — derive from igUserId via token or require it as param
        // For now upload to /me/photos (user-level, not page-level)
        const uploadRes = await fetch(`https://graph.facebook.com/v21.0/me/photos`, { method: 'POST', body: form });
        const uploadData = await uploadRes.json();
        if (uploadData.error || !uploadData.id) {
          // Fall back to text-only if upload fails
          resolvedImageUrl = null;
        } else {
          // Fetch the image URL from Facebook
          const photoRes = await fetch(`https://graph.facebook.com/v21.0/${uploadData.id}?fields=images&access_token=${pageToken}`);
          const photoData = await photoRes.json();
          resolvedImageUrl = photoData.images?.[0]?.source ?? null;
        }
      }
    }

    // Step 1: Create media container
    const containerBody = { caption, access_token: pageToken };
    if (resolvedImageUrl) {
      containerBody.image_url = resolvedImageUrl;
      containerBody.media_type = 'IMAGE';
    }

    const containerRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });
    const containerData = await containerRes.json();
    if (!containerRes.ok || containerData.error) {
      throw new HttpsError('internal', containerData.error?.message ?? `Instagram container creation failed: ${containerRes.status}`);
    }

    // Step 2: Publish the container
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerData.id, access_token: pageToken }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || publishData.error) {
      throw new HttpsError('internal', publishData.error?.message ?? `Instagram publish failed: ${publishRes.status}`);
    }

    return { postId: publishData.id };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * createFacebookAdsCampaign — creates a full paid campaign via Facebook Marketing API.
 * Flow: Campaign → Ad Set (with targeting + budget) → Ad Creative → Ad
 * ══════════════════════════════════════════════════════════════════════════ */
exports.createFacebookAdsCampaign = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const {
      adAccountId,    // WITHOUT 'act_' prefix
      pageId,
      pageToken,
      campaignName,
      objective,      // OUTCOME_AWARENESS | OUTCOME_TRAFFIC | OUTCOME_ENGAGEMENT | OUTCOME_LEADS | OUTCOME_SALES
      budgetType,     // 'daily' | 'lifetime'
      budgetAmount,   // number in ILS (shekels)
      startTime,      // ISO date string (optional)
      endTime,        // ISO date string (optional, required for lifetime budget)
      targeting,      // { countries, ageMin, ageMax, genders, interests }
      adCreative,     // { headline, primaryText, imageUrl, callToAction, websiteUrl }
    } = request.data;

    if (!adAccountId || !pageId || !pageToken || !campaignName || !objective || !budgetAmount) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    const BASE = 'https://graph.facebook.com/v19.0';
    const ACT  = `act_${adAccountId}`;

    // Helper for API calls
    async function fbPost(endpoint, body) {
      const res  = await fetch(`${BASE}/${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, access_token: pageToken }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new HttpsError('internal', data.error?.message ?? `Facebook API error at ${endpoint}: ${res.status}`);
      }
      return data;
    }

    // ── Step 1: Create Campaign ──────────────────────────────────────────────
    const campaign = await fbPost(`${ACT}/campaigns`, {
      name:                  campaignName,
      objective,
      status:                'ACTIVE',
      special_ad_categories: [],
    });

    // ── Step 2: Create Ad Set ────────────────────────────────────────────────
    const optimizationGoal =
      objective === 'OUTCOME_LEADS'    ? 'LEAD_GENERATION'      :
      objective === 'OUTCOME_SALES'    ? 'OFFSITE_CONVERSIONS'  :
      objective === 'OUTCOME_TRAFFIC'  ? 'LINK_CLICKS'          :
      'REACH';

    const billingEvent =
      objective === 'OUTCOME_LEADS'    ? 'IMPRESSIONS' :
      objective === 'OUTCOME_TRAFFIC'  ? 'LINK_CLICKS' :
      'IMPRESSIONS';

    const targetingSpec = {
      geo_locations: {
        countries: targeting?.countries ?? ['IL'],
        ...(targeting?.cities?.length > 0 && { cities: targeting.cities }),
      },
      age_min: targeting?.ageMin ?? 18,
      age_max: targeting?.ageMax ?? 65,
      ...(targeting?.genders?.length > 0 && { genders: targeting.genders }),
      ...(targeting?.interests?.length > 0 && {
        flexible_spec: [{ interests: targeting.interests }],
      }),
    };

    const adSetBody = {
      name:              `${campaignName} — Ad Set`,
      campaign_id:       campaign.id,
      optimization_goal: optimizationGoal,
      billing_event:     billingEvent,
      targeting:         targetingSpec,
      status:            'ACTIVE',
    };

    // Budget: convert ILS to agorot (cents × 100 for Israeli currency)
    const budgetInAgorot = Math.round(Number(budgetAmount) * 100);
    if (budgetType === 'daily') {
      adSetBody.daily_budget = budgetInAgorot;
    } else {
      adSetBody.lifetime_budget = budgetInAgorot;
      if (endTime) adSetBody.end_time = new Date(endTime).toISOString();
    }
    if (startTime) adSetBody.start_time = new Date(startTime).toISOString();

    const adSet = await fbPost(`${ACT}/adsets`, adSetBody);

    // ── Step 3: Create Ad Creative ───────────────────────────────────────────
    const linkData = {
      message:      adCreative?.primaryText ?? campaignName,
      name:         adCreative?.headline    ?? campaignName,
      link:         adCreative?.websiteUrl  ?? 'https://www.facebook.com',
      call_to_action: {
        type:  adCreative?.callToAction ?? 'LEARN_MORE',
        value: { link: adCreative?.websiteUrl ?? 'https://www.facebook.com' },
      },
    };
    if (adCreative?.imageUrl) linkData.picture = adCreative.imageUrl;

    const creative = await fbPost(`${ACT}/adcreatives`, {
      name:               `${campaignName} — Creative`,
      object_story_spec:  { page_id: pageId, link_data: linkData },
    });

    // ── Step 4: Create Ad ────────────────────────────────────────────────────
    const ad = await fbPost(`${ACT}/ads`, {
      name:     `${campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status:   'ACTIVE',
    });

    return {
      campaignId:    campaign.id,
      adSetId:       adSet.id,
      creativeId:    creative.id,
      adId:          ad.id,
      adsManagerUrl: `https://www.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}&selected_campaign_ids=${campaign.id}`,
    };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * replyFacebookComment — proxy for replying to a Facebook comment.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.replyFacebookComment = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { commentId, message, pageToken } = request.data;
    if (!commentId || !message || !pageToken) {
      throw new HttpsError('invalid-argument', 'Missing required fields.');
    }

    const res = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: pageToken }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new HttpsError('internal', data.error?.message ?? `Graph API ${res.status}`);
    }
    return { success: true, replyId: data.id };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * facebookCommentsWebhook — receives Meta Webhooks for page comments.
 *
 * Setup in Meta Developers:
 *   Webhook URL: https://us-central1-chex-crm.cloudfunctions.net/facebookCommentsWebhook
 *   Verify token: stored in workspaces/{wid}/marketingAgent/config as webhookToken
 *   Subscribe to: page.feed (comments on posts)
 * ══════════════════════════════════════════════════════════════════════════ */
exports.facebookCommentsWebhook = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    // ── GET: Meta webhook verification challenge ──
    if (req.method === 'GET') {
      const mode      = req.query['hub.mode'];
      const token     = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token) {
        // Find workspace with matching webhook token
        const db = admin.firestore();
        const snap = await db.collectionGroup('config')
          .where('webhookToken', '==', token)
          .limit(1)
          .get()
          .catch(() => null);

        if (snap && !snap.empty) {
          res.status(200).send(challenge);
        } else {
          res.sendStatus(403);
        }
      } else {
        res.sendStatus(400);
      }
      return;
    }

    // ── POST: Incoming comment notification ──
    if (req.method === 'POST') {
      try {
        // ── Verify Meta signature (X-Hub-Signature-256) ──────────────────────
        const crypto = require('crypto');
        const appSecret = process.env.META_APP_SECRET;
        // Always verify — if META_APP_SECRET is not set, reject to avoid open webhook
        if (!appSecret) {
          console.error('facebookCommentsWebhook: META_APP_SECRET not configured — rejecting all requests');
          res.sendStatus(500);
          return;
        }
        const sig = req.headers['x-hub-signature-256'];
        const rawBody = JSON.stringify(req.body);
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
        if (!sig || sig.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
          console.warn('facebookCommentsWebhook: invalid signature — possible forgery attempt');
          res.sendStatus(403);
          return;
        }

        const body = req.body;
        const db   = admin.firestore();
        const Anthropic = require('@anthropic-ai/sdk');

        for (const entry of (body.entry ?? [])) {
          const pageId = entry.id;

          // Find workspace by page ID
          const wsSnap = await db.collection('workspaces')
            .where('metaIntegration.pages', 'array-contains-any', [{ id: pageId }])
            .limit(1)
            .get()
            .catch(() => null);

          for (const change of (entry.changes ?? [])) {
            if (change.field !== 'feed') continue;
            const val = change.value;
            if (val.item !== 'comment') continue;
            if (val.verb !== 'add')     continue;

            const commentId  = val.comment_id ?? val.id;
            const message    = val.message ?? '';
            const fromName   = val.from?.name ?? 'Unknown';
            const postId     = val.post_id ?? '';
            const createdAt  = Date.now();

            // Determine workspace ID
            let wid = wsSnap && !wsSnap.empty ? wsSnap.docs[0].id : null;
            if (!wid) continue;

            // Load config
            const cfgSnap = await db.doc(`workspaces/${wid}/marketingAgent/config`).get().catch(() => null);
            const cfg = cfgSnap?.exists ? cfgSnap.data() : {};

            const apiKey = process.env.ANTHROPIC_API_KEY;
            let aiDraft = '';
            let confidence = 70;
            let uncertainties = [];

            if (apiKey && message) {
              try {
                const client = new Anthropic({ apiKey });
                const resp = await client.messages.create({
                  model: 'claude-haiku-4-5',
                  max_tokens: 200,
                  messages: [{
                    role: 'user',
                    content: `ענה על תגובה בפייסבוק מ-${fromName}: "${message}"
עסק: ${cfg.agentName || 'עסק מקצועי'}
טון: ${cfg.replyTone || 'ידידותי'}
החזר JSON: {"reply":"...","confidence":85,"uncertainties":[]}`,
                  }],
                });
                const text = resp.content?.[0]?.text ?? '';
                const m = text.match(/\{[\s\S]*\}/);
                const p = JSON.parse(m?.[0] ?? '{}');
                aiDraft       = p.reply ?? text;
                confidence    = p.confidence ?? 70;
                uncertainties = p.uncertainties ?? [];
              } catch (e) {
                console.error('AI error:', e);
                aiDraft = '(שגיאת AI)';
              }
            }

            // Save comment draft to Firestore
            await db.collection(`workspaces/${wid}/marketingAgent/commentDrafts/items`).add({
              commentId,
              postId,
              fromName,
              commentText: message,
              aiDraft,
              confidence,
              uncertainties,
              status:    'pending',
              createdAt,
            });
          }
        }
      } catch (err) {
        console.error('facebookCommentsWebhook error:', err);
      }
      res.sendStatus(200);
    }
  }
);
