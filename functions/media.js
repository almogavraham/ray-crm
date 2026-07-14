/**
 * media.js — AI media generation Cloud Functions.
 *
 * Handles server-side calls to Kling (JWT auth) and Nano Banana video APIs,
 * keeping API secrets off the browser.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Build a signed JWT for Kling API.
 * Algorithm: HMAC-SHA256  Format: base64url(header).base64url(payload).sig
 */
function buildKlingJWT(accessKey, secretKey) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const data    = `${header}.${payload}`;
  const sig     = crypto.createHmac('sha256', secretKey).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * createKlingVideo — submit text-to-video task to Kling API.
 * Returns { taskId } — the caller polls with getKlingVideoStatus.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.createKlingVideo = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { prompt, duration = 5, aspectRatio = '16:9', mode = 'std', accessKey, secretKey } = request.data;
    if (!prompt || !accessKey || !secretKey) {
      throw new HttpsError('invalid-argument', 'Missing prompt, accessKey or secretKey.');
    }
    if (!['5', '10', 5, 10].includes(duration)) {
      throw new HttpsError('invalid-argument', 'Duration must be 5 or 10.');
    }

    const jwt = buildKlingJWT(accessKey, secretKey);

    const body = {
      model_name:   'kling-v1',
      prompt,
      negative_prompt: 'blurry, low quality, watermark, text overlay',
      mode,                     // 'std' | 'pro'
      duration:     String(duration),
      aspect_ratio: aspectRatio, // '16:9' | '9:16' | '1:1'
    };

    const res  = await fetch('https://api.klingai.com/v1/videos/text2video', {
      method:  'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.code !== 0) {
      throw new HttpsError('internal', `Kling error ${data.code}: ${data.message}`);
    }

    return { taskId: data.data.task_id };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * getKlingVideoStatus — poll task status.
 * Returns { status: 'processing'|'succeed'|'failed', videoUrl?, thumbnailUrl?, progress }
 * ══════════════════════════════════════════════════════════════════════════ */
exports.getKlingVideoStatus = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { taskId, accessKey, secretKey } = request.data;
    if (!taskId || !accessKey || !secretKey) {
      throw new HttpsError('invalid-argument', 'Missing taskId, accessKey or secretKey.');
    }

    const jwt = buildKlingJWT(accessKey, secretKey);

    const res  = await fetch(`https://api.klingai.com/v1/videos/text2video/${taskId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = await res.json();

    if (data.code !== 0) {
      throw new HttpsError('internal', `Kling error ${data.code}: ${data.message}`);
    }

    const task      = data.data;
    const succeeded = task.task_status === 'succeed';
    const video     = succeeded && task.task_result?.videos?.[0];

    return {
      status:       task.task_status,           // 'submitted' | 'processing' | 'succeed' | 'failed'
      progress:     task.task_status_msg || '',
      videoUrl:     video ? video.url       : null,
      thumbnailUrl: video ? video.cover_image_url : null,
    };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * generateNanoBananaVideo — proxy for Nano Banana (Runway-compatible) API.
 * Nano Banana uses a Runway-style POST endpoint with API key in header.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.generateNanoBananaVideo = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { prompt, imageUrl, duration = 4, apiKey, endpoint } = request.data;
    if (!prompt || !apiKey) {
      throw new HttpsError('invalid-argument', 'Missing prompt or apiKey.');
    }

    // Default to Runway Gen-3 Alpha Turbo endpoint if not specified
    const url = endpoint || 'https://api.dev.runwayml.com/v1/image_to_video';

    // Support two modes: image_to_video (with imageUrl) and text_to_video
    const body = imageUrl
      ? { promptImage: imageUrl, promptText: prompt, model: 'gen3a_turbo', duration, ratio: '1280:768' }
      : { promptText: prompt,   model: 'gen3a_turbo', duration, ratio: '1280:768' };

    const res = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new HttpsError('internal', data.message || data.error || 'Nano Banana error');
    }

    // Runway returns { id } — caller polls /v1/tasks/{id}
    return { taskId: data.id || data.task_id };
  }
);

/* ══════════════════════════════════════════════════════════════════════════
 * getNanoBananaStatus — poll Nano Banana / Runway task status.
 * ══════════════════════════════════════════════════════════════════════════ */
exports.getNanoBananaStatus = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { taskId, apiKey, endpoint } = request.data;
    if (!taskId || !apiKey) throw new HttpsError('invalid-argument', 'Missing taskId or apiKey.');

    const base = (endpoint || 'https://api.dev.runwayml.com/v1').replace(/\/image_to_video$/, '');
    const res  = await fetch(`${base}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
    });
    const data = await res.json();
    if (!res.ok) throw new HttpsError('internal', data.message || 'Nano Banana status error');

    const succeeded = data.status === 'SUCCEEDED';
    return {
      status:   data.status,                          // 'RUNNING' | 'SUCCEEDED' | 'FAILED'
      progress: data.progress ?? 0,
      videoUrl: succeeded ? (data.output?.[0] ?? null) : null,
    };
  }
);
