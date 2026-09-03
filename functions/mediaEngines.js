/**
 * mediaEngines.js — every image and video engine, behind one door.
 *
 * Two things were wrong with how media generation worked:
 *
 *  1. The operator's keys sat in Firestore `system/apiKeys`, which every
 *     signed-in user can read. The browser then called OpenAI and Google
 *     directly with the raw key. Any customer could open devtools and walk off
 *     with the OpenAI key that bills the operator.
 *  2. Each engine was wired in a different place with a different shape —
 *     Ideogram in a lib, DALL·E and Imagen and Veo inline in a 7500-line page,
 *     Kling and Runway as proxies that made the *client* supply the key.
 *     Adding an engine meant a new code path in whichever screen wanted it.
 *
 * Now keys live in `system/mediaKeys`, readable only by the Admin SDK here
 * (rules deny client reads). The client asks `mediaEngineStatus` which engines
 * are configured — booleans, never values — and calls `generateMedia` naming
 * an engine. The key never leaves this file.
 *
 * Results are written to Storage under the workspace and returned as a URL,
 * so a generated image survives the chat window closing and can be published
 * later; a data: URL in React state does neither.
 *
 * Legacy `system/apiKeys` is still read as a fallback so keys the operator
 * already entered keep working until they are re-saved into the new document.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

/* ── The catalogue. Kept in step with src/lib/mediaEngines.ts ─────────────── */
const ENGINES = {
  pollinations: { kind: 'image', keys: [] },
  imagen:       { kind: 'image', keys: ['google'] },
  dalle:        { kind: 'image', keys: ['openai'] },
  ideogram:     { kind: 'image', keys: ['ideogram'] },
  veo:          { kind: 'video', keys: ['google'] },
  kling:        { kind: 'video', keys: ['klingAccessKey', 'klingSecretKey'] },
  runway:       { kind: 'video', keys: ['runway'] },
};

/* ── Money ────────────────────────────────────────────────────────────────
 * Budgets are per PROVIDER (that is how the bills arrive: Imagen and Veo share
 * one Google balance), metered in the currency the operator pays in. A
 * generation charges the customer's virtual balance real × 2 — the same margin
 * as Anthropic tokens — and records the real price on the operator's meter.
 * Pollinations is free and skips all of it.
 * Keep PRICE in step with src/lib/engineBudgets.ts, which shows these numbers. */
const PROVIDER_OF = { imagen: 'google', veo: 'google', dalle: 'openai', ideogram: 'ideogram', kling: 'kling', runway: 'runway' };
const CURRENCY = { google: 'ILS', openai: 'USD', ideogram: 'USD', kling: 'USD', runway: 'USD' };
const PRICE = { pollinations: 0, imagen: 0.15, veo: 10, dalle: 0.04, ideogram: 0.08, kling: 0.14, runway: 0.25 };
const CLIENT_MULTIPLIER = 2;

/** Refuse before spending the operator's money when the workspace has none of it. */
async function requireEngineBalance(db, wid, engine) {
  const provider = PROVIDER_OF[engine];
  if (!provider) return null;
  const price = PRICE[engine] ?? 0;
  const snap = await db.collection('workspaces').doc(wid).get();
  const bal = Number(snap.data()?.engineBalances?.[provider] ?? 0);
  const need = price * CLIENT_MULTIPLIER;
  if (bal + 1e-9 < need) {
    const cur = CURRENCY[provider] === 'ILS' ? '₪' : '$';
    throw new HttpsError('resource-exhausted',
      `אין מספיק יתרה ל-${provider} בסביבה זו (יש ${cur}${bal.toFixed(2)}, נדרש ${cur}${need.toFixed(2)}). האדמין יכול להוסיף בלוח האדמין ← טוקנים ← מנועי מדיה.`);
  }
  return { provider, price, charged: need };
}

/** Record a successful generation: customer virtual balance, operator meter. */
async function chargeEngine(db, wid, engine, meta) {
  const { provider, price, charged } = meta;
  const entry = {
    id: `eu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    provider, type: 'usage', amount: -charged, engine,
    description: `${engine} generation`, timestamp: new Date().toISOString(),
  };
  const wsRef = db.collection('workspaces').doc(wid);
  await db.runTransaction(async tx => {
    const snap = await tx.get(wsRef);
    const bal = Number(snap.data()?.engineBalances?.[provider] ?? 0);
    tx.update(wsRef, {
      [`engineBalances.${provider}`]: Math.max(0, bal - charged),
      [`engineUsed.${provider}`]: admin.firestore.FieldValue.increment(price),
      engineHistory: admin.firestore.FieldValue.arrayUnion(entry),
    });
  });
  await db.doc('system/engineBudgets').set(
    { [provider]: { usedReal: admin.firestore.FieldValue.increment(price) } }, { merge: true },
  ).catch(e => console.warn('[chargeEngine] meter update failed', e.message));
}

/** Every key name the admin page may write. Anything else is dropped. */
const KEY_NAMES = ['openai', 'google', 'ideogram', 'klingAccessKey', 'klingSecretKey', 'runway', 'heygen', 'canva'];

/* ── Keys ─────────────────────────────────────────────────────────────────── */

async function loadKeys() {
  const db = admin.firestore();
  const [fresh, legacy] = await Promise.all([
    db.doc('system/mediaKeys').get(),
    db.doc('system/apiKeys').get(),
  ]);
  const out = {};
  const l = legacy.exists ? legacy.data() : {};
  const f = fresh.exists ? fresh.data() : {};
  for (const k of KEY_NAMES) out[k] = String(f[k] ?? l[k] ?? '').trim();
  return out;
}

function configuredEngines(keys) {
  const out = {};
  for (const [id, def] of Object.entries(ENGINES)) {
    out[id] = def.keys.every(k => Boolean(keys[k]));
  }
  return out;
}

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
}
function requireSuperAdmin(request) {
  requireAuth(request);
  if (request.auth.token.email !== SUPER_ADMIN_EMAIL) throw new HttpsError('permission-denied', 'Super admin only.');
}

/**
 * Which engines can be used right now. Booleans only — this is the one thing
 * about the keys a customer is allowed to know.
 */
exports.mediaEngineStatus = onCall({ region: 'us-central1' }, async (request) => {
  requireAuth(request);
  const keys = await loadKeys();
  return { engines: configuredEngines(keys) };
});

/**
 * Save keys. Blank means "leave as is" so the admin page can show ✓ without
 * ever having the value, and re-saving an unrelated key cannot wipe another.
 * Writes the two the marketing page still reads directly into the legacy doc
 * as well, so nothing that works today stops working.
 */
exports.saveMediaKeys = onCall({ region: 'us-central1' }, async (request) => {
  requireSuperAdmin(request);
  const db = admin.firestore();
  const incoming = request.data?.keys ?? {};
  const patch = {};
  const cleaned = [];
  for (const k of KEY_NAMES) {
    const v = incoming[k];
    if (typeof v === 'string' && v.trim()) {
      // API keys are ASCII. A paste from an RTL page can carry invisible
      // direction marks or a smart quote, which read as "wrong key" downstream
      // with no visible difference. Strip anything outside printable ASCII and
      // say so, rather than store a key that can never match.
      const raw = v.trim();
      const ascii = raw.replace(/[^!-~]/g, '');
      if (ascii !== raw) cleaned.push(k);
      patch[k] = ascii;
    }
    if (v === null) patch[k] = admin.firestore.FieldValue.delete();   // explicit clear
  }
  if (!Object.keys(patch).length) return { saved: [], cleaned };
  await db.doc('system/mediaKeys').set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
  const legacy = {};
  for (const k of ['openai', 'google', 'heygen', 'canva']) if (k in patch) legacy[k] = patch[k];
  if (Object.keys(legacy).length) await db.doc('system/apiKeys').set(legacy, { merge: true });
  return { saved: Object.keys(patch), cleaned };
});

/**
 * Prove a key works with the cheapest call the provider offers — listing
 * models, not generating anything. "Saved" and "works" are different facts,
 * and the difference shows up as a failed campaign at 9pm.
 */
exports.testMediaEngine = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  requireSuperAdmin(request);
  const engine = String(request.data?.engine ?? '');
  const def = ENGINES[engine];
  if (!def) throw new HttpsError('invalid-argument', `Unknown engine ${engine}`);
  const keys = await loadKeys();
  if (!def.keys.every(k => keys[k])) return { ok: false, message: 'לא הוגדר מפתח' };

  try {
    switch (engine) {
      case 'pollinations':
        return { ok: true, message: 'לא דורש מפתח' };
      case 'imagen':
      case 'veo': {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys.google}&pageSize=1`);
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, message: 'המפתח תקין' } : { ok: false, message: d.error?.message ?? `HTTP ${r.status}` };
      }
      case 'dalle': {
        const r = await fetch('https://api.openai.com/v1/models/dall-e-3', { headers: { Authorization: `Bearer ${keys.openai}` } });
        const d = await r.json().catch(() => ({}));
        if (r.ok) return { ok: true, message: 'המפתח תקין' };
        const msg = d.error?.message ?? `HTTP ${r.status}`;
        // OpenAI answers "model does not exist" for a valid key whose project
        // has no access to the image model — a project/permissions problem,
        // not a wrong key. Say which, so the fix is in the right place.
        // OpenAI's own 401 text names the key it saw, masked (sk-proj-***abcd),
        // which is the one fact that settles "did my paste arrive intact".
        if (r.status === 401) return { ok: false, message: `המפתח נדחה (401). OpenAI: ${msg}` };
        if (/does not exist|do not have access/i.test(msg)) {
          return { ok: false, message: 'המפתח תקין, אבל לפרויקט הזה אין גישה ל-DALL·E 3. ב-platform.openai.com ← Settings ← Project ← Limits ← אפשר Model access ל-dall-e-3, או צור מפתח בפרויקט ה-Default' };
        }
        return { ok: false, message: msg };
      }
      case 'ideogram': {
        // Ideogram has no free "who am I"; a deliberately empty request returns
        // 400 with a valid key and 401 with a bad one.
        const r = await fetch('https://api.ideogram.ai/generate', {
          method: 'POST', headers: { 'Api-Key': keys.ideogram, 'Content-Type': 'application/json' }, body: '{}',
        });
        return r.status === 401 || r.status === 403
          ? { ok: false, message: 'המפתח נדחה' }
          : { ok: true, message: 'המפתח התקבל' };
      }
      case 'kling': {
        const jwt = klingJwt(keys.klingAccessKey, keys.klingSecretKey);
        const r = await fetch('https://api.klingai.com/v1/videos/text2video?pageNum=1&pageSize=1', { headers: { Authorization: `Bearer ${jwt}` } });
        const d = await r.json().catch(() => ({}));
        return d.code === 0 ? { ok: true, message: 'המפתחות תקינים' } : { ok: false, message: d.message ?? `HTTP ${r.status}` };
      }
      case 'runway': {
        const r = await fetch('https://api.dev.runwayml.com/v1/organization', {
          headers: { Authorization: `Bearer ${keys.runway}`, 'X-Runway-Version': '2024-11-06' },
        });
        const d = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, message: `תקין${d.creditBalance != null ? ` · ${d.creditBalance} קרדיטים` : ''}` } : { ok: false, message: d.error ?? d.message ?? `HTTP ${r.status}` };
      }
      default:
        return { ok: false, message: 'אין בדיקה למנוע זה' };
    }
  } catch (e) {
    return { ok: false, message: String(e.message ?? e) };
  }
});

/* ── Generation ───────────────────────────────────────────────────────────── */

const bucket = () => admin.storage().bucket();

/** Put bytes in Storage under the workspace and hand back a public URL. */
async function store(wid, bytes, mime, ext) {
  const token = crypto.randomUUID();
  const path = `workspaces/${wid}/media/gen_${Date.now()}_${token.slice(0, 6)}.${ext}`;
  const file = bucket().file(path);
  await file.save(bytes, {
    contentType: mime,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function fetchBytes(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function klingJwt(accessKey, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secretKey).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Provider wording for "you cannot pay for this" varies; group it. */
const outOfCredit = (m) => /credit|quota|billing|insufficient|depleted|exceeded/i.test(String(m));

const IMAGE_SIZE = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792' };

/**
 * Make an image or start a video.
 *
 * Images return `{ url }`. Videos return `{ taskId }` for the engines that run
 * long, and the client polls `mediaTaskStatus`; Veo is polled here for up to
 * the callable's timeout because its operation handle is only usable with the
 * same key, which the client must never hold.
 */
exports.generateMedia = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    requireAuth(request);
    const { engine, prompt, aspect = '1:1', workspaceId, duration = 5, imageUrl } = request.data ?? {};
    const def = ENGINES[engine];
    if (!def) throw new HttpsError('invalid-argument', `Unknown engine ${engine}`);
    if (!prompt || typeof prompt !== 'string') throw new HttpsError('invalid-argument', 'prompt is required');
    if (!workspaceId) throw new HttpsError('invalid-argument', 'workspaceId is required');

    const keys = await loadKeys();
    if (!def.keys.every(k => keys[k])) {
      throw new HttpsError('failed-precondition', `המנוע ${engine} לא מוגדר — הוסף מפתח בלוח האדמין ← אינטגרציות`);
    }
    const db = admin.firestore();
    const charge = await requireEngineBalance(db, workspaceId, engine);

    // Wraps a finished result: charge, then hand back what was charged so the
    // chat can say so. Long-running video engines charge on task completion
    // in mediaTaskStatus instead, when the file actually exists.
    const done = async (result) => {
      if (charge && result.url) {
        await chargeEngine(db, workspaceId, engine, charge);
        return { ...result, charged: charge.charged, currency: CURRENCY[charge.provider] };
      }
      return result;
    };

    try {
      switch (engine) {
        case 'pollinations': {
          const models = ['flux-schnell', 'turbo', 'flux'];
          const [w, h] = aspect === '16:9' ? [1344, 768] : aspect === '9:16' ? [768, 1344] : [1024, 1024];
          let last = '';
          for (let i = 0; i < models.length; i++) {
            const seed = (Date.now() + i * 7919) % 99999;
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${models[i]}&width=${w}&height=${h}&nologo=true&seed=${seed}`;
            const r = await fetch(url);
            if (!r.ok) { last = `HTTP ${r.status}`; continue; }
            const bytes = Buffer.from(await r.arrayBuffer());
            if (bytes.length < 500) { last = 'empty image'; continue; }
            return done({ url: await store(workspaceId, bytes, 'image/jpeg', 'jpg'), engine, model: models[i] });
          }
          throw new Error(`Pollinations: ${last || 'no image'}`);
        }

        case 'dalle': {
          const r = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.openai}` },
            body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: IMAGE_SIZE[aspect] ?? IMAGE_SIZE['1:1'], response_format: 'b64_json', quality: 'standard' }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
          const b64 = d.data?.[0]?.b64_json;
          if (!b64) throw new Error('DALL·E returned no image');
          return done({ url: await store(workspaceId, Buffer.from(b64, 'base64'), 'image/png', 'png'), engine, model: 'dall-e-3' });
        }

        case 'imagen': {
          // Imagen 4 first; the Gemini image models as fallback — same key,
          // different endpoint, and one is often available when the other
          // has not been enabled on the account yet.
          let last = '';
          for (const model of ['imagen-4.0-fast-generate-001', 'imagen-4.0-generate-001']) {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${keys.google}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect } }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { last = d.error?.message ?? `HTTP ${r.status}`; if (outOfCredit(last)) throw new Error(last); continue; }
            const p = d.predictions?.[0] ?? {};
            const b64 = d.generatedImages?.[0]?.image?.imageBytes ?? p.bytesBase64Encoded;
            if (!b64) { last = `${model} returned no image`; continue; }
            const mime = p.mimeType ?? 'image/png';
            return done({ url: await store(workspaceId, Buffer.from(b64, 'base64'), mime, mime.includes('jpeg') ? 'jpg' : 'png'), engine, model });
          }
          for (const model of ['gemini-2.5-flash-image']) {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys.google}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { last = d.error?.message ?? `HTTP ${r.status}`; continue; }
            const part = (d.candidates?.[0]?.content?.parts ?? []).find(x => x.inlineData?.mimeType?.startsWith('image/'));
            if (!part) { last = `${model} returned no image`; continue; }
            const mime = part.inlineData.mimeType;
            return done({ url: await store(workspaceId, Buffer.from(part.inlineData.data, 'base64'), mime, mime.includes('jpeg') ? 'jpg' : 'png'), engine, model });
          }
          throw new Error(`Imagen: ${last}`);
        }

        case 'ideogram': {
          const ASPECT = { '1:1': 'ASPECT_1_1', '16:9': 'ASPECT_16_9', '9:16': 'ASPECT_9_16' };
          const r = await fetch('https://api.ideogram.ai/generate', {
            method: 'POST', headers: { 'Api-Key': keys.ideogram, 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_request: { prompt, aspect_ratio: ASPECT[aspect] ?? 'ASPECT_1_1', model: 'V_2', magic_prompt_option: 'AUTO' } }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error ?? d.message ?? `HTTP ${r.status}`);
          const src = d.data?.[0]?.url;
          if (!src) throw new Error('Ideogram returned no image');
          // Ideogram URLs expire; keep our own copy.
          return done({ url: await store(workspaceId, await fetchBytes(src), 'image/png', 'png'), engine, model: 'V_2' });
        }

        case 'veo': {
          let op = '', used = '', last = '';
          for (const model of ['veo-3.0-fast-generate-001', 'veo-3.0-generate-001', 'veo-2.0-generate-001']) {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${keys.google}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: aspect === '9:16' ? '9:16' : '16:9', sampleCount: 1 } }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { last = d.error?.message ?? `HTTP ${r.status}`; if (outOfCredit(last)) throw new Error(last); continue; }
            op = d.name; used = model; break;
          }
          if (!op) throw new Error(`Veo: ${last || 'no model accepted the request'}`);
          // Poll here: the operation is tied to the key.
          for (let i = 0; i < 26; i++) {
            await new Promise(res => setTimeout(res, 10000));
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op}?key=${keys.google}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error?.message ?? 'Veo poll failed');
            if (!d.done) continue;
            const gv = d.response?.generateVideoResponse ?? {};
            if ((gv.raiMediaFilteredCount ?? 0) > 0) throw new Error(`Veo חסם את הוידאו — שנה את הפרומפט (${(gv.raiMediaFilteredReasons ?? [])[0] ?? 'safety'})`);
            const s = gv.generatedSamples?.[0] ?? {};
            const pred = d.response?.predictions?.[0] ?? {};
            const b64 = s.bytesBase64Encoded ?? pred.bytesBase64Encoded;
            const uri = s.video?.uri ?? pred.uri ?? pred.gcsUri;
            if (b64) return done({ url: await store(workspaceId, Buffer.from(b64, 'base64'), 'video/mp4', 'mp4'), engine, model: used });
            if (uri) {
              const dl = uri.startsWith('gs://') ? uri.replace('gs://', 'https://storage.googleapis.com/') : uri;
              const bytes = await fetchBytes(dl, { 'x-goog-api-key': keys.google });
              return done({ url: await store(workspaceId, bytes, 'video/mp4', 'mp4'), engine, model: used });
            }
            throw new Error('Veo finished without a video');
          }
          throw new Error('Veo: timed out after 4 minutes');
        }

        case 'kling': {
          const jwt = klingJwt(keys.klingAccessKey, keys.klingSecretKey);
          const r = await fetch('https://api.klingai.com/v1/videos/text2video', {
            method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_name: 'kling-v1', prompt, negative_prompt: 'blurry, low quality, watermark, text overlay', mode: 'std', duration: String(duration === 10 ? 10 : 5), aspect_ratio: aspect === '1:1' ? '1:1' : aspect === '9:16' ? '9:16' : '16:9' }),
          });
          const d = await r.json().catch(() => ({}));
          if (d.code !== 0) throw new Error(`Kling ${d.code}: ${d.message}`);
          return { taskId: d.data.task_id, engine };
        }

        case 'runway': {
          const body = imageUrl
            ? { promptImage: imageUrl, promptText: prompt, model: 'gen3a_turbo', duration: duration === 10 ? 10 : 5, ratio: aspect === '9:16' ? '768:1280' : '1280:768' }
            : { promptText: prompt, model: 'gen3a_turbo', duration: duration === 10 ? 10 : 5, ratio: aspect === '9:16' ? '768:1280' : '1280:768' };
          const r = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
            method: 'POST',
            headers: { Authorization: `Bearer ${keys.runway}`, 'Content-Type': 'application/json', 'X-Runway-Version': '2024-11-06' },
            body: JSON.stringify(body),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.message ?? d.error ?? `Runway HTTP ${r.status}`);
          return { taskId: d.id ?? d.task_id, engine };
        }

        default:
          throw new HttpsError('invalid-argument', `No generator for ${engine}`);
      }
    } catch (e) {
      const msg = String(e.message ?? e);
      console.error(`[generateMedia] ${engine}:`, msg);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError(outOfCredit(msg) ? 'resource-exhausted' : 'internal', msg);
    }
  },
);

/**
 * Poll a long-running video. On success the file is copied into our Storage
 * so the URL outlives the provider's short-lived link.
 */
exports.mediaTaskStatus = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (request) => {
  requireAuth(request);
  const { engine, taskId, workspaceId } = request.data ?? {};
  if (!taskId || !workspaceId) throw new HttpsError('invalid-argument', 'taskId and workspaceId are required');
  const keys = await loadKeys();
  const db = admin.firestore();

  if (engine === 'kling') {
    const jwt = klingJwt(keys.klingAccessKey, keys.klingSecretKey);
    const r = await fetch(`https://api.klingai.com/v1/videos/text2video/${taskId}`, { headers: { Authorization: `Bearer ${jwt}` } });
    const d = await r.json().catch(() => ({}));
    if (d.code !== 0) throw new HttpsError('internal', `Kling ${d.code}: ${d.message}`);
    const t = d.data;
    if (t.task_status === 'failed') return { status: 'failed', message: t.task_status_msg ?? '' };
    const v = t.task_status === 'succeed' && t.task_result?.videos?.[0];
    if (!v) return { status: 'processing', message: t.task_status_msg ?? '' };
    const url = await store(workspaceId, await fetchBytes(v.url), 'video/mp4', 'mp4');
    const meta = { provider: 'kling', price: PRICE.kling, charged: PRICE.kling * CLIENT_MULTIPLIER };
    await chargeEngine(db, workspaceId, 'kling', meta);
    return { status: 'done', url, thumbnailUrl: v.cover_image_url ?? null, charged: meta.charged, currency: 'USD' };
  }

  if (engine === 'runway') {
    const r = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${keys.runway}`, 'X-Runway-Version': '2024-11-06' },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpsError('internal', d.message ?? 'Runway status error');
    if (d.status === 'FAILED') return { status: 'failed', message: d.failure ?? d.failureCode ?? '' };
    if (d.status !== 'SUCCEEDED') return { status: 'processing', progress: d.progress ?? 0 };
    const src = d.output?.[0];
    if (!src) return { status: 'failed', message: 'no output' };
    const url = await store(workspaceId, await fetchBytes(src), 'video/mp4', 'mp4');
    const meta = { provider: 'runway', price: PRICE.runway, charged: PRICE.runway * CLIENT_MULTIPLIER };
    await chargeEngine(db, workspaceId, 'runway', meta);
    return { status: 'done', url, charged: meta.charged, currency: 'USD' };
  }

  throw new HttpsError('invalid-argument', `No task polling for ${engine}`);
});
