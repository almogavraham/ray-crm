/**
 * autopilot.js — the autonomous Marketing Agent's server side.
 *
 * A scheduled Cloud Function (Cloud Scheduler → Pub/Sub, v2 onSchedule) that
 * runs every 15 minutes and:
 *
 *   1. DRAINS the publish queue: for every workspace with autopilotEnabled,
 *      finds scheduledPosts whose time has arrived and publishes them to
 *      Facebook / Instagram — even when the app is closed. This is what makes
 *      the agent truly autonomous.
 *
 *   2. (optional, gated by config.autopilotAutoGenerate) GENERATES a fresh plan
 *      on its own cadence and emails the owner for approval.
 *
 * Publishing helpers replicate the Graph API logic used by the createFacebookPost
 * / createInstagramPost onCall handlers in index.js, so both paths stay in sync.
 *
 * Page/IG tokens live in Firestore under workspace.metaIntegration.pages[], so
 * this server worker can publish without the client.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const GRAPH = 'https://graph.facebook.com/v21.0';

/* ── Publish helpers (plain functions, reusable) ──────────────────────────── */
async function publishFacebook(pageId, message, pageToken, imageUrl) {
  let res;
  if (imageUrl) {
    res = await fetch(`${GRAPH}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: message, url: imageUrl, access_token: pageToken }),
    });
  } else {
    res = await fetch(`${GRAPH}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: pageToken }),
    });
  }
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `Graph API ${res.status}`);
  const postId = data.post_id || data.id;
  return { postId, url: postId ? `https://facebook.com/${postId}` : undefined };
}

async function publishInstagram(igUserId, caption, pageToken, imageUrl) {
  const containerBody = { caption, access_token: pageToken };
  if (imageUrl) { containerBody.image_url = imageUrl; containerBody.media_type = 'IMAGE'; }
  const cRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerBody),
  });
  const cData = await cRes.json();
  if (!cRes.ok || cData.error) throw new Error(cData.error?.message ?? `IG container ${cRes.status}`);
  const pRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: cData.id, access_token: pageToken }),
  });
  const pData = await pRes.json();
  if (!pRes.ok || pData.error) throw new Error(pData.error?.message ?? `IG publish ${pRes.status}`);
  return { postId: pData.id, url: `https://instagram.com` };
}

/* ── Resolve the page auth for a workspace ────────────────────────────────── */
function resolvePageAuth(ws) {
  const meta = ws.metaIntegration;
  const page = meta?.pages?.find(p => p.subscribed) ?? meta?.pages?.[0];
  if (!page) return null;
  return {
    pageId:    page.id,
    pageToken: page.accessToken || meta.accessToken,
    igUserId:  page.instagramBusinessAccountId || null,
  };
}

/* ── Server-side notification helper ──────────────────────────────────────── */
/* Mirrors the client path: workspaces/{wid}/notifications/{autoId} (see notifications.ts). */
async function notify(db, wid, n) {
  try {
    await db.collection('workspaces').doc(wid).collection('notifications').doc().set({
      ...n, read: false, createdAt: Date.now(),
    });
  } catch (e) { console.error('[autopilot notify]', e); }
}

/* ── Queue drain ──────────────────────────────────────────────────────────── */
async function drainWorkspace(db, wid, ws) {
  const now = Date.now();
  const itemsRef = db.collection('workspaces').doc(wid)
    .collection('marketingAgent').doc('scheduledPosts').collection('items');

  // Single inequality → no composite index needed; filter status in code.
  const dueSnap = await itemsRef.where('scheduledTime', '<=', now).get();
  if (dueSnap.empty) return { published: 0, failed: 0 };

  const auth = resolvePageAuth(ws);
  let published = 0, failed = 0;

  for (const docSnap of dueSnap.docs) {
    const post = docSnap.data();
    if (post.status !== 'pending') continue;

    try {
      if (!auth || !auth.pageToken) throw new Error('אין חיבור Meta פעיל לפרסום');
      const imageUrl = post.imageUrl || undefined; // Storage HTTPS URL, Graph-friendly
      let result;
      if (post.platform === 'instagram') {
        if (!auth.igUserId) throw new Error('אין חשבון Instagram מקושר');
        result = await publishInstagram(auth.igUserId, post.message, auth.pageToken, imageUrl);
      } else {
        result = await publishFacebook(auth.pageId, post.message, auth.pageToken, imageUrl);
      }
      await docSnap.ref.update({ status: 'posted', fbPostId: result.postId, postUrl: result.url ?? null, postedAt: now });
      published++;
    } catch (err) {
      await docSnap.ref.update({ status: 'failed', error: String(err.message || err) });
      failed++;
      await notify(db, wid, {
        type: 'autopilot_failed',
        title: '⚠️ פרסום אוטומטי נכשל',
        body: `פוסט לא פורסם: ${String(err.message || err)}`,
        link: 'marketing-agent',
      });
    }
  }

  if (published > 0) {
    await notifyClientPath(db, wid, {
      type: 'autopilot_published',
      title: `✅ ${published} פוסטים פורסמו אוטומטית`,
      body: 'סוכן השיווק פרסם את הפוסטים המתוזמנים.',
      link: 'marketing-agent',
    });
  }
  return { published, failed };
}

/* ── The scheduled function ───────────────────────────────────────────────── */
exports.autopilotScheduler = onSchedule(
  { schedule: 'every 15 minutes', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const db = admin.firestore();
    let wsSnap;
    try {
      wsSnap = await db.collection('workspaces').where('autopilotEnabled', '==', true).get();
    } catch (err) {
      console.error('[autopilot] workspace query failed', err);
      return;
    }
    console.log(`[autopilot] scanning ${wsSnap.size} workspace(s)`);

    for (const wsDoc of wsSnap.docs) {
      const wid = wsDoc.id;
      const ws = wsDoc.data();
      try {
        const { published, failed } = await drainWorkspace(db, wid, ws);
        if (published || failed) console.log(`[autopilot] ${wid}: published=${published} failed=${failed}`);
      } catch (err) {
        console.error(`[autopilot] workspace ${wid} failed`, err);
      }
      try {
        await maybeSendMorningDigest(db, wid, ws);
      } catch (err) {
        console.error(`[autopilot] digest ${wid} failed`, err);
      }
    }
  }
);

/* ── Morning digest ───────────────────────────────────────────────────────── */
function israelDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); } // YYYY-MM-DD
function israelHour() { return parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }), 10); }

async function maybeSendMorningDigest(db, wid, ws) {
  // Gate FIRST (cheap) — only in the 07:00–08:59 Israel window, once per day.
  const hour = israelHour();
  if (hour < 7 || hour > 8) return;
  const today = israelDate();
  if (ws.lastDigestDate === today) return;

  // Collect today's + overdue open tasks from the workspace's leads.
  const leadsSnap = await db.collection(`workspaces/${wid}/leads`).get();
  const lines = [];
  leadsSnap.docs.forEach(d => {
    const lead = d.data();
    (lead.tasks || []).forEach(t => {
      if (t.completed) return;
      const due = String(t.date || '');
      if (due && due.slice(0, 10) <= today) {
        lines.push(`- [${t.priority || 'medium'}] ${t.description}${lead.company ? ` (${lead.company})` : ''} — ${due.slice(0, 10)}`);
      }
    });
  });

  // Mark the day as handled regardless (avoid retry storms if there's nothing to send).
  await db.doc(`workspaces/${wid}`).set({ lastDigestDate: today }, { merge: true }).catch(() => {});
  if (!lines.length) return;

  let body = `${lines.length} משימות פתוחות להיום. פתח את דף המשימות להתחיל.`;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: 'אתה מנהל מכירות ותיק שנותן תדרוך בוקר קצר וממוקד. קבל רשימת משימות פתוחות/באיחור ותן: פתיחה אנרגטית קצרה + 3 העדיפויות המובילות להיום לפי השפעה על הכנסות. תמציתי מאוד בעברית, בולטים קצרים, בלי הקדמות.',
      messages: [{ role: 'user', content: lines.slice(0, 40).join('\n') }],
    });
    const text = (resp.content.find(b => b.type === 'text') || {}).text;
    if (text && text.trim()) body = text.trim();
  } catch (err) {
    console.error('[digest ai]', err.message || err);
  }

  await notify(db, wid, { type: 'info', title: '☀️ תדרוך הבוקר שלך', body, link: 'tasks' });
  console.log(`[autopilot] digest sent to ${wid} (${lines.length} tasks)`);
}
