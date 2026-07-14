/**
 * presentationExport.ts
 * Export presentations to PPTX, Google Slides, and Canva.
 */

import type { MediaGalleryItem } from '../components/MediaStudio';

/* ── Shared types (mirrors MarketingAgent's inline types) ─────────────────── */
export interface PresentationSlide {
  id: string;
  title: string;
  body: string;
  imageId: string | null;
  bgColor: string;
  textColor: string;
  layout: 'text-only' | 'image-right' | 'image-left' | 'image-top' | 'image-full';
}
export interface PresentationDoc {
  id: string;
  name: string;
  slides: PresentationSlide[];
  createdAt: number;
  updatedAt: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function hexToRgbFloat(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace('#', '').padEnd(6, '0');
  const n = parseInt(h, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

function hexToRgb255(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').padEnd(6, '0');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, data] = dataUri.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ── Layout → PPTX positions ─────────────────────────────────────────────── */
interface PptxPos { x: number; y: number; w: number; h: number }
type Align = 'left' | 'center' | 'right';

function imgPos(layout: string): PptxPos {
  switch (layout) {
    case 'image-right': return { x: 5.5, y: 0.5, w: 4.0, h: 6.5 };
    case 'image-left':  return { x: 0.5, y: 0.5, w: 4.0, h: 6.5 };
    case 'image-top':   return { x: 2.0, y: 0.2, w: 6.0, h: 3.2 };
    case 'image-full':  return { x: 0.0, y: 0.0, w: 10.0, h: 7.5 };
    default:            return { x: 2.5, y: 1.0, w: 5.0, h: 5.0 };
  }
}

function txtPos(layout: string): { title: PptxPos & { align: Align }; body: PptxPos & { align: Align } } {
  switch (layout) {
    case 'image-right': return {
      title: { x: 0.5, y: 1.5, w: 4.5, h: 1.5, align: 'right' },
      body:  { x: 0.5, y: 3.2, w: 4.5, h: 3.5, align: 'right' },
    };
    case 'image-left': return {
      title: { x: 5.0, y: 1.5, w: 4.5, h: 1.5, align: 'left' },
      body:  { x: 5.0, y: 3.2, w: 4.5, h: 3.5, align: 'left' },
    };
    case 'image-top': return {
      title: { x: 1.0, y: 3.7, w: 8.0, h: 1.5, align: 'center' },
      body:  { x: 1.0, y: 5.3, w: 8.0, h: 2.0, align: 'center' },
    };
    default: return {
      title: { x: 1.0, y: 1.8, w: 8.0, h: 1.5, align: 'center' },
      body:  { x: 1.0, y: 3.5, w: 8.0, h: 3.5, align: 'center' },
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. PPTX EXPORT (pptxgenjs)
 * ══════════════════════════════════════════════════════════════════════════ */
export async function exportToPPTX(pres: PresentationDoc, gallery: MediaGalleryItem[]): Promise<void> {
  const { default: pptxgen } = await import('pptxgenjs');
  const deck = new pptxgen();

  deck.layout = 'LAYOUT_WIDE'; // 16:9

  for (const slide of pres.slides) {
    const s = deck.addSlide();

    // Background color
    const bg = hexToRgb255(slide.bgColor);
    s.background = { color: `${bg.r.toString(16).padStart(2,'0')}${bg.g.toString(16).padStart(2,'0')}${bg.b.toString(16).padStart(2,'0')}` };

    const img = slide.imageId ? gallery.find(i => i.id === slide.imageId) : null;
    const pos = txtPos(slide.layout);
    const color = slide.textColor.replace('#', '').padEnd(6, 'ffffff');

    // Image
    if (img && slide.layout !== 'text-only') {
      const ip = imgPos(slide.layout);
      if (img.url.startsWith('data:')) {
        s.addImage({ data: img.url, x: ip.x, y: ip.y, w: ip.w, h: ip.h });
      } else {
        // Remote URL — try direct, fallback skip
        try { s.addImage({ path: img.url, x: ip.x, y: ip.y, w: ip.w, h: ip.h }); } catch { /* skip */ }
      }
    }

    // Title
    if (slide.title) {
      s.addText(slide.title, {
        x: pos.title.x, y: pos.title.y, w: pos.title.w, h: pos.title.h,
        align: pos.title.align, color, fontSize: 32, bold: true, fontFace: 'Arial',
        rtlMode: true,
      });
    }

    // Body
    if (slide.body) {
      s.addText(slide.body, {
        x: pos.body.x, y: pos.body.y, w: pos.body.w, h: pos.body.h,
        align: pos.body.align, color, fontSize: 18, fontFace: 'Arial',
        rtlMode: true,
      });
    }
  }

  await deck.writeFile({ fileName: `${pres.name || 'מצגת'}.pptx` });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. GOOGLE SLIDES EXPORT
 * ══════════════════════════════════════════════════════════════════════════ */

/** Request a Google access token with Slides + Drive scope (for images) */
export async function requestSlidesToken(clientId: string): Promise<string> {
  // Load GIS script
  await new Promise<void>((resolve, reject) => {
    if ((window as unknown as Record<string, unknown>).google) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load GIS'));
    document.head.appendChild(s);
  });

  return new Promise((resolve, reject) => {
    const g = (window as unknown as { google: { accounts: { oauth2: { initTokenClient: (o: object) => { requestAccessToken: (o?: object) => void } } } } }).google;
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/drive.file',
      callback: (response: { access_token?: string; error?: string }) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error ?? 'token_error'));
      },
    });
    client.requestAccessToken();
  });
}

const EMU = 914400; // English Metric Units per inch

export async function exportToGoogleSlides(
  pres: PresentationDoc,
  gallery: MediaGalleryItem[],
  accessToken: string
): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // 1. Create blank presentation
  const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST', headers,
    body: JSON.stringify({ title: pres.name || 'מצגת' }),
  });
  if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
  const { presentationId, slides: defaultSlides } = await createRes.json() as {
    presentationId: string; slides: Array<{ objectId: string }>;
  };

  const requests: object[] = [];

  // Delete default empty slide
  if (defaultSlides?.length) {
    requests.push({ deleteObject: { objectId: defaultSlides[0].objectId } });
  }

  // Upload images to Drive so Slides can reference them by URL
  const driveImageUrls: Record<string, string> = {};
  for (const slide of pres.slides) {
    if (!slide.imageId) continue;
    const img = gallery.find(i => i.id === slide.imageId);
    if (!img || driveImageUrls[slide.imageId]) continue;
    try {
      const blob = img.url.startsWith('data:') ? dataUriToBlob(img.url) : await fetch(img.url).then(r => r.blob());
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name: `slide-img-${slide.imageId}`, mimeType: blob.type })], { type: 'application/json' }));
      form.append('file', blob);
      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webContentLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (uploadRes.ok) {
        const { id } = await uploadRes.json() as { id: string };
        // Make publicly readable so Slides can use it
        await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
          method: 'POST', headers,
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
        driveImageUrls[slide.imageId] = `https://drive.google.com/uc?id=${id}`;
      }
    } catch { /* skip image if upload fails */ }
  }

  // Build slide requests
  for (let i = 0; i < pres.slides.length; i++) {
    const slide = pres.slides[i];
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
    const slideId = `s${i}_${safe(slide.id)}`;
    const titleId = `t${i}`;
    const bodyId  = `b${i}`;
    const imgId   = `img${i}`;

    requests.push({ createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } });

    // Background
    const bgRgb = hexToRgbFloat(slide.bgColor);
    requests.push({ updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: bgRgb } } } },
      fields: 'pageBackgroundFill',
    }});

    const txtRgb = hexToRgbFloat(slide.textColor);
    const pageW = 9144000; // 10 inches in EMU
    const pageH = 5143500; // 5.625 inches in EMU

    // Image
    const imgUrl = slide.imageId ? driveImageUrls[slide.imageId] : null;
    if (imgUrl && slide.layout !== 'text-only') {
      let imgX = 0, imgY = 0, imgW = pageW, imgH = pageH;
      switch (slide.layout) {
        case 'image-right': imgX = Math.round(5.5*EMU); imgY = Math.round(0.5*EMU); imgW = Math.round(4*EMU); imgH = Math.round(5*EMU); break;
        case 'image-left':  imgX = Math.round(0.5*EMU); imgY = Math.round(0.5*EMU); imgW = Math.round(4*EMU); imgH = Math.round(5*EMU); break;
        case 'image-top':   imgX = Math.round(2*EMU);   imgY = Math.round(0.2*EMU); imgW = Math.round(6*EMU); imgH = Math.round(3*EMU); break;
        default: imgX = 0; imgY = 0; imgW = pageW; imgH = pageH; break;
      }
      requests.push({ createImage: {
        objectId: imgId,
        url: imgUrl,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: imgW, unit: 'EMU' }, height: { magnitude: imgH, unit: 'EMU' } },
          transform: { scaleX: 1, scaleY: 1, translateX: imgX, translateY: imgY, unit: 'EMU' },
        },
      }});
    }

    // Title text box
    if (slide.title) {
      let tx = Math.round(EMU), ty = Math.round(1.5*EMU), tw = Math.round(8*EMU), th = Math.round(1.5*EMU);
      if (slide.layout === 'image-right') { tx = Math.round(0.5*EMU); tw = Math.round(4.5*EMU); }
      if (slide.layout === 'image-left')  { tx = Math.round(5*EMU);   tw = Math.round(4.5*EMU); }
      if (slide.layout === 'image-top')   { ty = Math.round(3.7*EMU); }

      requests.push({ createShape: { objectId: titleId, shapeType: 'TEXT_BOX', elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: tw, unit: 'EMU' }, height: { magnitude: th, unit: 'EMU' } },
        transform: { scaleX: 1, scaleY: 1, translateX: tx, translateY: ty, unit: 'EMU' },
      }}});
      requests.push({ insertText: { objectId: titleId, text: slide.title } });
      requests.push({ updateTextStyle: { objectId: titleId, fields: 'fontSize,bold,foregroundColor',
        style: { fontSize: { magnitude: 36, unit: 'PT' }, bold: true,
          foregroundColor: { opaqueColor: { rgbColor: txtRgb } } } } });
      requests.push({ updateParagraphStyle: { objectId: titleId, fields: 'alignment',
        style: { alignment: 'CENTER' } } });
    }

    // Body text box
    if (slide.body) {
      let bx = Math.round(EMU), by = Math.round(3.2*EMU), bw = Math.round(8*EMU), bh = Math.round(2.5*EMU);
      if (slide.layout === 'image-right') { bx = Math.round(0.5*EMU); bw = Math.round(4.5*EMU); }
      if (slide.layout === 'image-left')  { bx = Math.round(5*EMU);   bw = Math.round(4.5*EMU); }
      if (slide.layout === 'image-top')   { by = Math.round(5.4*EMU); }

      requests.push({ createShape: { objectId: bodyId, shapeType: 'TEXT_BOX', elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: bw, unit: 'EMU' }, height: { magnitude: bh, unit: 'EMU' } },
        transform: { scaleX: 1, scaleY: 1, translateX: bx, translateY: by, unit: 'EMU' },
      }}});
      requests.push({ insertText: { objectId: bodyId, text: slide.body } });
      requests.push({ updateTextStyle: { objectId: bodyId, fields: 'fontSize,foregroundColor',
        style: { fontSize: { magnitude: 20, unit: 'PT' },
          foregroundColor: { opaqueColor: { rgbColor: txtRgb } } } } });
      requests.push({ updateParagraphStyle: { objectId: bodyId, fields: 'alignment',
        style: { alignment: 'CENTER' } } });
    }
  }

  // 2. Batch update
  const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
    method: 'POST', headers, body: JSON.stringify({ requests }),
  });
  if (!batchRes.ok) {
    const err = await batchRes.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Batch update failed: ${batchRes.status}`);
  }

  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}

/** Fetch thumbnail image URLs for every slide in a Google Slides presentation */
export async function fetchSlideThumbnails(
  presentationId: string,
  accessToken: string,
): Promise<string[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const presRes = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}`,
    { headers },
  );
  if (!presRes.ok) throw new Error(`Fetch presentation failed: ${presRes.status}`);
  const presData = await presRes.json() as { slides: Array<{ objectId: string }> };

  const urls: string[] = [];
  for (const slide of presData.slides ?? []) {
    const thumbRes = await fetch(
      `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${slide.objectId}/thumbnail`,
      { headers },
    );
    if (thumbRes.ok) {
      const d = await thumbRes.json() as { contentUrl?: string };
      if (d.contentUrl) urls.push(d.contentUrl);
    }
  }
  return urls;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. CANVA CONNECT API
 * ══════════════════════════════════════════════════════════════════════════ */

/** Generate PKCE code verifier */
export function generateCodeVerifier(): string {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate PKCE code challenge (SHA-256 of verifier) */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build Canva OAuth URL (PKCE flow) */
export function getCanvaAuthUrl(clientId: string, redirectUri: string, codeChallenge: string, state: string): string {
  return 'https://www.canva.com/api/oauth/authorize?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'design:content:write design:content:read asset:read asset:write',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
}

/** Open Canva OAuth in a popup and wait for the authorization code */
export async function canvaOAuthPopup(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'canva_oauth', 'width=520,height=680,left=200,top=100');
    if (!popup) { reject(new Error('Popup blocked — אפשר חלונות קופצים')); return; }

    const timer = setInterval(() => {
      try {
        if (popup.closed) { clearInterval(timer); reject(new Error('החלון נסגר לפני השלמת ההרשאה')); return; }
        const url = new URL(popup.location.href);
        if (url.origin !== window.location.origin) return; // still on canva.com
        const code  = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (code && state === expectedState) {
          popup.close();
          clearInterval(timer);
          resolve(code);
        } else if (url.searchParams.get('error')) {
          popup.close();
          clearInterval(timer);
          reject(new Error(url.searchParams.get('error_description') ?? 'canva_error'));
        }
      } catch { /* cross-origin: still on canva.com, keep polling */ }
    }, 400);

    // Timeout after 5 minutes
    setTimeout(() => { clearInterval(timer); popup.close(); reject(new Error('timeout')); }, 300_000);
  });
}

/** Exchange authorization code for access token */
export async function exchangeCanvaCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; error_description?: string };
    throw new Error(err.error_description ?? err.error ?? `Token exchange failed: ${res.status}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * Upload gallery images as Canva assets and create a presentation design.
 * Returns the Canva edit URL.
 */
export async function createCanvaPresentation(
  pres: PresentationDoc,
  gallery: MediaGalleryItem[],
  accessToken: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // Upload images used in slides
  const canvaAssets: Record<string, string> = {}; // imageId → canva assetId
  const uniqueImageIds = [...new Set(pres.slides.map(s => s.imageId).filter(Boolean))] as string[];

  for (const imageId of uniqueImageIds) {
    const img = gallery.find(i => i.id === imageId);
    if (!img) continue;
    try {
      const blob = img.url.startsWith('data:') ? dataUriToBlob(img.url) : await fetch(img.url).then(r => r.blob());
      const nameB64 = btoa(`slide-${imageId}`).replace(/=+$/, '');

      const uploadRes = await fetch('https://api.canva.com/rest/v1/assets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': blob.type,
          'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameB64 }),
        },
        body: blob,
      });
      if (!uploadRes.ok) continue;

      const uploadData = await uploadRes.json() as { job?: { id?: string } };
      const jobId = uploadData.job?.id;
      if (!jobId) continue;

      // Poll until asset is ready
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(1500);
        const pollRes = await fetch(`https://api.canva.com/rest/v1/assets/${jobId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!pollRes.ok) break;
        const pollData = await pollRes.json() as { asset?: { id?: string } };
        if (pollData.asset?.id) { canvaAssets[imageId] = pollData.asset.id; break; }
      }
    } catch { /* skip this image */ }
  }

  // Create a Presentation design
  const createRes = await fetch('https://api.canva.com/rest/v1/designs', {
    method: 'POST', headers,
    body: JSON.stringify({
      design_type: { type: 'preset', name: 'Presentation' },
      title: pres.name || 'מצגת',
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `Design creation failed: ${createRes.status}`);
  }
  const createData = await createRes.json() as { design?: { id?: string; urls?: { edit_url?: string } } };
  const editUrl = createData.design?.urls?.edit_url;
  if (!editUrl) throw new Error('No edit URL returned from Canva');

  // Note: Canva Connect API v1 does not support adding pages/elements programmatically.
  // The user will add content in the Canva editor. Uploaded assets appear in "Uploads".

  return editUrl;
}
