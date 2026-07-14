/**
 * googleAds.js — Google Ads API integration.
 * Functions: list accounts, list campaigns, create campaign, toggle campaign status.
 */

'use strict';

const { onCall: _onCall, HttpsError } = require('firebase-functions/v2/https');
const onCall = (opts, handler) => _onCall({ ...opts, enforceAppCheck: true }, handler);

const ADS_VER  = 'v18';
const ADS_BASE = `https://googleads.googleapis.com/${ADS_VER}`;

/* ── Internal helper: call Google Ads REST API ──────────────────────────── */
async function adsRequest(accessToken, path, method = 'GET', body = null, loginCustomerId = null) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) throw new HttpsError('failed-precondition', 'GOOGLE_ADS_DEVELOPER_TOKEN not configured in Cloud Functions environment.');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': devToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/-/g, '');

  const url    = path.startsWith('http') ? path : `${ADS_BASE}/${path}`;
  const opts   = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = data?.error?.details?.[0]?.errors?.[0]?.message
      || data?.error?.message
      || JSON.stringify(data);
    throw new HttpsError('internal', `Google Ads API: ${detail}`);
  }
  return data;
}

/* ── Internal helper: get stored access token from Firestore ─────────────── */
async function getGoogleToken(db, workspaceId) {
  const snap = await db.doc(`workspaces/${workspaceId}/socialConnections/google`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Google account not connected. Connect Google first in Integrations.');
  const { accessToken } = snap.data();
  if (!accessToken) throw new HttpsError('failed-precondition', 'No access token — please reconnect your Google account.');
  return accessToken;
}

/* ── Refresh access token using refresh token ─────────────────────────────── */
async function refreshGoogleToken(db, workspaceId) {
  const snap = await db.doc(`workspaces/${workspaceId}/socialConnections/google`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Google account not connected.');
  const conn = snap.data();
  if (!conn.refreshToken) throw new HttpsError('failed-precondition', 'No refresh token available.');

  // Get client credentials
  const credSnap = await db.doc(`workspaces/${workspaceId}/socialConnections/google`).get();
  const { clientId, clientSecret } = credSnap.data() || {};

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refreshToken,
      client_id: clientId || '',
      client_secret: clientSecret || '',
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new HttpsError('internal', data.error_description || 'Token refresh failed');

  // Update stored token
  await db.doc(`workspaces/${workspaceId}/socialConnections/google`).update({
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}

/* ══════════════════════════════════════════════════════════════════════════
 * googleAdsListAccounts — list all Google Ads accounts the user can access.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.googleAdsListAccounts = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { workspaceId } = request.data;
    if (!workspaceId) throw new HttpsError('invalid-argument', 'workspaceId required.');

    const admin = require('firebase-admin');
    const db    = admin.firestore();
    let   accessToken = await getGoogleToken(db, workspaceId);

    // List all accessible customers
    let listData;
    try {
      listData = await adsRequest(accessToken, 'customers:listAccessibleCustomers');
    } catch (err) {
      // Try refreshing token once
      try {
        accessToken = await refreshGoogleToken(db, workspaceId);
        listData    = await adsRequest(accessToken, 'customers:listAccessibleCustomers');
      } catch {
        throw err;
      }
    }

    const resourceNames = listData.resourceNames || [];
    const customerIds   = resourceNames.map(r => r.split('/')[1]);

    // Fetch basic info for each account
    const accounts = (await Promise.allSettled(customerIds.map(async (id) => {
      try {
        const res = await adsRequest(accessToken, `customers/${id}/googleAds:searchStream`, 'POST', {
          query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.test_account FROM customer LIMIT 1',
        }, id);
        const row = res[0]?.results?.[0]?.customer ?? {};
        return {
          id,
          name:       row.descriptiveName || `חשבון ${id}`,
          currency:   row.currencyCode    || 'ILS',
          timezone:   row.timeZone        || 'Asia/Jerusalem',
          isTest:     row.testAccount     || false,
        };
      } catch {
        return { id, name: `חשבון ${id}`, currency: 'ILS', timezone: 'Asia/Jerusalem', isTest: false };
      }
    }))).filter(r => r.status === 'fulfilled').map(r => r.value);

    return { accounts };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * googleAdsListCampaigns — list campaigns with performance metrics.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.googleAdsListCampaigns = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { workspaceId, customerId } = request.data;
    if (!workspaceId || !customerId) throw new HttpsError('invalid-argument', 'workspaceId and customerId required.');

    const admin      = require('firebase-admin');
    const db         = admin.firestore();
    const accessToken = await getGoogleToken(db, workspaceId);
    const cid        = String(customerId).replace(/-/g, '');

    const res = await adsRequest(accessToken, `customers/${cid}/googleAds:searchStream`, 'POST', {
      query: `
        SELECT
          campaign.id, campaign.name, campaign.status, campaign.start_date, campaign.end_date,
          campaign_budget.amount_micros,
          metrics.impressions, metrics.clicks, metrics.ctr,
          metrics.average_cpc, metrics.conversions, metrics.cost_micros,
          metrics.all_conversions
        FROM campaign
        WHERE campaign.advertising_channel_type IN ('SEARCH','DISPLAY','PERFORMANCE_MAX')
          AND segments.date DURING LAST_30_DAYS
        ORDER BY campaign.name ASC
        LIMIT 50
      `,
    }, cid);

    const campaigns = (res[0]?.results || []).map(r => ({
      id:           r.campaign?.id          ?? '',
      name:         r.campaign?.name        ?? '',
      status:       r.campaign?.status      ?? 'UNKNOWN',
      startDate:    r.campaign?.startDate   ?? '',
      budgetMicros: Number(r.campaignBudget?.amountMicros ?? 0),
      impressions:  Number(r.metrics?.impressions  ?? 0),
      clicks:       Number(r.metrics?.clicks       ?? 0),
      ctr:          Number(r.metrics?.ctr          ?? 0),
      avgCpc:       Number(r.metrics?.averageCpc   ?? 0),
      conversions:  Number(r.metrics?.conversions  ?? 0),
      costMicros:   Number(r.metrics?.costMicros   ?? 0),
    }));

    return { campaigns };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * googleAdsCreateCampaign — create a Search campaign with Lead Form Extension.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.googleAdsCreateCampaign = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const {
      workspaceId, customerId,
      campaignName, dailyBudget,
      keywords,     // [{ text: string, matchType: 'BROAD'|'PHRASE'|'EXACT' }]
      headlines,    // string[]  (3-15, max 30 chars each)
      descriptions, // string[]  (2-4, max 90 chars each)
      finalUrl,     // landing page URL
      webhookUrl,   // leads webhook URL
      locationId,   // geo target constant ID (default: 2376 = Israel)
      businessName,
    } = request.data;

    if (!workspaceId || !customerId || !campaignName) {
      throw new HttpsError('invalid-argument', 'workspaceId, customerId, campaignName required.');
    }

    const admin      = require('firebase-admin');
    const db         = admin.firestore();
    const accessToken = await getGoogleToken(db, workspaceId);
    const cid        = String(customerId).replace(/-/g, '');

    /* ── 1. Campaign Budget ── */
    const budgetRes = await adsRequest(accessToken, `customers/${cid}/campaignBudgets:mutate`, 'POST', {
      operations: [{
        create: {
          name:           `${campaignName} — תקציב`,
          amountMicros:   String(Math.round((dailyBudget || 50) * 1_000_000)),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      }],
    }, cid);
    const budgetRN = budgetRes.results[0].resourceName;

    /* ── 2. Campaign ── */
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const campaignRes = await adsRequest(accessToken, `customers/${cid}/campaigns:mutate`, 'POST', {
      operations: [{
        create: {
          name:                    campaignName,
          advertisingChannelType:  'SEARCH',
          status:                  'PAUSED',          // user activates manually
          campaignBudget:          budgetRN,
          startDate:               today,
          networkSettings: {
            targetGoogleSearch:   true,
            targetSearchNetwork:  true,
            targetContentNetwork: false,
          },
          manualCpc: { enhancedCpcEnabled: true },
        },
      }],
    }, cid);
    const campaignRN = campaignRes.results[0].resourceName;
    const campaignId = campaignRN.split('/').pop();

    /* ── 3. Geo target (Israel by default) ── */
    const geoId = locationId || '2376'; // 2376 = Israel
    await adsRequest(accessToken, `customers/${cid}/campaignCriteria:mutate`, 'POST', {
      operations: [{
        create: {
          campaign:  campaignRN,
          location:  { geoTargetConstant: `geoTargetConstants/${geoId}` },
          negative:  false,
        },
      }],
    }, cid).catch(e => console.warn('Geo target failed (non-fatal):', e.message));

    /* ── 4. Ad Group ── */
    const adGroupRes = await adsRequest(accessToken, `customers/${cid}/adGroups:mutate`, 'POST', {
      operations: [{
        create: {
          name:         `${campaignName} — קבוצת מודעות`,
          campaign:     campaignRN,
          type:         'SEARCH_STANDARD',
          status:       'ENABLED',
          cpcBidMicros: '2000000', // 2 ILS default
        },
      }],
    }, cid);
    const adGroupRN = adGroupRes.results[0].resourceName;

    /* ── 5. Keywords ── */
    if (keywords && keywords.length > 0) {
      await adsRequest(accessToken, `customers/${cid}/adGroupCriteria:mutate`, 'POST', {
        operations: keywords.slice(0, 20).map(kw => ({
          create: {
            adGroup:  adGroupRN,
            keyword: { text: kw.text, matchType: kw.matchType || 'BROAD' },
            status:   'ENABLED',
          },
        })),
      }, cid);
    }

    /* ── 6. Responsive Search Ad ── */
    const safeHeadlines    = (headlines    || ['פרסום מקצועי', 'צור קשר עכשיו', 'שירות איכותי']).slice(0, 15);
    const safeDescriptions = (descriptions || ['אנחנו כאן לעזור לך להצליח. צור קשר היום.', 'שירות מקצועי ואמין. בוא נדבר.']).slice(0, 4);

    await adsRequest(accessToken, `customers/${cid}/adGroupAds:mutate`, 'POST', {
      operations: [{
        create: {
          adGroup: adGroupRN,
          status:  'ENABLED',
          ad: {
            responsiveSearchAd: {
              headlines:    safeHeadlines.map(h    => ({ text: h.slice(0, 30) })),
              descriptions: safeDescriptions.map(d => ({ text: d.slice(0, 90) })),
            },
            finalUrls: [finalUrl || 'https://admin.ray-crm.com'],
          },
        },
      }],
    }, cid);

    /* ── 7. Lead Form Asset + Campaign Asset ── */
    if (webhookUrl) {
      try {
        const lfRes = await adsRequest(accessToken, `customers/${cid}/assets:mutate`, 'POST', {
          operations: [{
            create: {
              name: `${campaignName} — Lead Form`,
              type: 'LEAD_FORM',
              leadFormAsset: {
                callToActionType:        'LEARN_MORE',
                callToActionDescription: 'מלא פרטים לקבלת מידע נוסף',
                businessName:            businessName || campaignName,
                headline:                'צור קשר עכשיו',
                description:             'מלא את הטופס ונחזור אליך בהקדם',
                privacyPolicyUrl:        'https://admin.ray-crm.com/privacy-policy.html',
                postSubmitHeadline:      'תודה! ניצור איתך קשר בקרוב',
                postSubmitDescription:   'קיבלנו את פרטיך ונחזור אליך',
                fields: [
                  { inputType: 'FULL_NAME' },
                  { inputType: 'EMAIL' },
                  { inputType: 'PHONE_NUMBER' },
                ],
                deliveryMethods: [{
                  webhook: {
                    advertiserWebhookUrl: webhookUrl,
                    googleSecret:         '',
                    payloadSchemaVersion: 3,
                  },
                }],
              },
            },
          }],
        }, cid);

        const lfRN = lfRes.results[0].resourceName;

        await adsRequest(accessToken, `customers/${cid}/campaignAssets:mutate`, 'POST', {
          operations: [{
            create: {
              campaign:  campaignRN,
              asset:     lfRN,
              fieldType: 'LEAD_FORM',
            },
          }],
        }, cid);
      } catch (lfErr) {
        console.warn('Lead form creation failed (non-fatal):', lfErr.message);
        // Campaign is still created — lead form can be added manually
      }
    }

    return {
      success:      true,
      campaignId,
      campaignName,
      resourceName: campaignRN,
      message:      'הקמפיין נוצר בהצלחה! הוא במצב "מושהה" — הפעל אותו ב-Google Ads כשתהיה מוכן.',
    };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * googleAdsToggleCampaign — enable or pause a campaign.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.googleAdsToggleCampaign = onCall(
  { region: 'us-central1', timeoutSeconds: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { workspaceId, customerId, campaignId, status } = request.data;
    if (!workspaceId || !customerId || !campaignId) {
      throw new HttpsError('invalid-argument', 'workspaceId, customerId, campaignId required.');
    }
    if (!['ENABLED', 'PAUSED'].includes(status)) {
      throw new HttpsError('invalid-argument', 'status must be ENABLED or PAUSED.');
    }

    const admin      = require('firebase-admin');
    const db         = admin.firestore();
    const accessToken = await getGoogleToken(db, workspaceId);
    const cid        = String(customerId).replace(/-/g, '');

    await adsRequest(accessToken, `customers/${cid}/campaigns:mutate`, 'POST', {
      operations: [{
        update:     { resourceName: `customers/${cid}/campaigns/${campaignId}`, status },
        updateMask: 'status',
      }],
    }, cid);

    return { success: true, campaignId, status };
  }
);
