import React, { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { Save, Trash2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  shadow: boolean;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface MediaGalleryItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  engine: string;
  prompt: string;
  createdAt: number;
  thumbnailUrl?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  textOverlays?: TextOverlay[];
  subtitles?: SubtitleCue[];
  hue?: number;       // CSS hue-rotate in degrees, -180 to 180
  rotation?: number;  // 0, 90, 180, 270
  flipH?: boolean;
  flipV?: boolean;
}

export interface SlideItem {
  id: string;
  title: string;
  body: string;
  bgColor: string;
  textColor: string;
  imageId: string | null;
  layout: string;
}

export interface SlideMode {
  slides: SlideItem[];
  activeIndex: number;
  presentationName: string;
  savingPres: boolean;
  onSelectSlide: (i: number) => void;
  onUpdateSlide: (updater: (s: SlideItem) => SlideItem) => void;
  onUpdatePresName: (v: string) => void;
  onSave: () => void;
  onDeleteSlide: () => void;
}

interface Props {
  gallery: MediaGalleryItem[];
  onUpdateItem: (item: MediaGalleryItem) => void;
  onDeleteItem: (id: string) => void;
  onUseInCampaign: (item: MediaGalleryItem) => void;
  onRequestRegenerate: (prompt: string, type: 'image' | 'video', engine: string) => void;
  onAddToGallery?: (item: Omit<MediaGalleryItem, 'id' | 'createdAt'>) => void;
  onToast?: (msg: string, type?: string) => void;
  isDark?: boolean;
  focusId?: string | null;
  focusSeq?: number;
  onUseCaption?: (caption: string) => void;
  useInCampaignLabel?: string;
  allClosedInitially?: boolean;
  slideMode?: SlideMode;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESETS: Record<string, { brightness: number; contrast: number; saturation: number; label: string; emoji: string }> = {
  original: { brightness: 100, contrast: 100, saturation: 100, label: 'מקורי',  emoji: '◎' },
  warm:     { brightness: 106, contrast: 102, saturation: 118, label: 'Warm',   emoji: '🌅' },
  cool:     { brightness: 100, contrast: 106, saturation: 86,  label: 'Cool',   emoji: '❄️' },
  vintage:  { brightness: 94,  contrast: 84,  saturation: 66,  label: 'Vintage',emoji: '📷' },
  vivid:    { brightness: 108, contrast: 120, saturation: 140, label: 'Vivid',  emoji: '✨' },
  bw:       { brightness: 100, contrast: 118, saturation: 0,   label: 'B&W',    emoji: '⬛' },
  film:     { brightness: 88,  contrast: 78,  saturation: 88,  label: 'Film',   emoji: '🎞️' },
};

const PLATFORMS = [
  { id: 'fb',      name: 'Facebook פוסט',    emoji: '🟦', w: 1200, h: 630  },
  { id: 'ig-sq',   name: 'Instagram 1:1',    emoji: '📷', w: 1080, h: 1080 },
  { id: 'ig-story',name: 'Story / Reels',    emoji: '📱', w: 1080, h: 1920 },
  { id: 'yt',      name: 'YouTube Thumb',    emoji: '▶️',  w: 1280, h: 720  },
  { id: 'twitter', name: 'Twitter / X',      emoji: '🐦', w: 1600, h: 900  },
  { id: 'linkedin',name: 'LinkedIn',         emoji: '💼', w: 1200, h: 627  },
];

const ENGINE_LABEL: Record<string, string> = {
  imagen: '🎨 Imagen', dalle: '🖼️ DALL-E', veo: '🎥 Veo',
  'frame-capture': '📸 Frame', upload: '📤 העלאה', url: '🔗 קישור',
};

const SLIDE_BG_COLORS_MS = ['#1e1b4b','#0f172a','#14532d','#7f1d1d','#1e3a5f','#fff','#f8fafc'];
const SLIDE_TEXT_COLORS_MS = ['#ffffff','#f1f5f9','#1e293b'];
const SLIDE_LAYOUTS_MS = [
  { id:'text-only',   label:'טקסט בלבד'  },
  { id:'image-right', label:'תמונה ימין'  },
  { id:'image-left',  label:'תמונה שמאל'  },
  { id:'image-top',   label:'תמונה למעלה' },
  { id:'image-full',  label:'תמונה מלאה'  },
];

const STYLE_PRESETS = [
  { id: 'photorealistic', label: 'פוטו-ריאליסטי', suffix: ', photorealistic, 8k, highly detailed, professional photography' },
  { id: 'artistic',       label: 'אמנותי',        suffix: ', digital art, artistic, painterly, vivid colors, concept art' },
  { id: 'minimalist',     label: 'מינימליסט',     suffix: ', minimalist, clean, simple, white background, flat design' },
  { id: 'bold',           label: 'Bold & Graphic', suffix: ', bold colors, graphic design, high contrast, vector style' },
  { id: 'cinematic',      label: 'קולנועי',        suffix: ', cinematic, dramatic lighting, movie still, 4k, widescreen' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function padT(n: number, dec = false) {
  return dec ? n.toFixed(3).padStart(6, '0') : String(Math.floor(n)).padStart(2, '0');
}
function toVttTime(s: number) {
  return `${padT(Math.floor(s / 3600))}:${padT(Math.floor((s % 3600) / 60))}:${padT(s % 60, true)}`;
}
function makeVtt(cues: SubtitleCue[]) {
  return 'WEBVTT\n\n' + cues.map((c, i) =>
    `${i + 1}\n${toVttTime(c.start)} --> ${toVttTime(c.end)}\n${c.text}\n`
  ).join('\n');
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function drawItemToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  item: MediaGalleryItem,
  targetW: number,
  targetH: number,
  logoImg?: HTMLImageElement | null,
  logoOpts?: { opacity: number; position: string; scale: number },
) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetW, targetH);

  const filterStr = `brightness(${item.brightness ?? 100}%) contrast(${item.contrast ?? 100}%) saturate(${item.saturation ?? 100}%) hue-rotate(${item.hue ?? 0}deg)`;
  ctx.filter = filterStr;

  const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
  const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
  const sx = (targetW - sw) / 2, sy = (targetH - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh);
  ctx.filter = 'none';

  (item.textOverlays ?? []).forEach(o => {
    const fs = Math.round(o.fontSize * (targetW / 800));
    const isBold = o.bold !== false;
    const isItalic = o.italic;
    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fs}px ${o.fontFamily ?? 'Arial'}, sans-serif`;
    ctx.fillStyle = o.color;
    if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10; }
    ctx.textAlign = 'center';
    ctx.fillText(o.text, (o.x / 100) * targetW, (o.y / 100) * targetH);
    ctx.shadowBlur = 0;
  });

  if (logoImg && logoOpts) {
    const lw = (targetW * logoOpts.scale) / 100;
    const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    const mg = 16;
    const pos: Record<string, [number, number]> = {
      br: [targetW - lw - mg, targetH - lh - mg],
      bl: [mg,                  targetH - lh - mg],
      tr: [targetW - lw - mg, mg],
      tl: [mg,                  mg],
    };
    const [lx, ly] = pos[logoOpts.position] ?? pos.br;
    ctx.globalAlpha = logoOpts.opacity / 100;
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.globalAlpha = 1;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MediaStudio({
  gallery, onUpdateItem, onDeleteItem, onUseInCampaign, onRequestRegenerate, onAddToGallery, onToast, isDark, focusId, focusSeq, onUseCaption, useInCampaignLabel, allClosedInitially, slideMode,
}: Props) {

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selId,    setSelId]    = useState<string | null>(null);

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<MediaGalleryItem[]>([]);
  const [redoStack, setRedoStack] = useState<MediaGalleryItem[]>([]);

  // ── Overlay form & drag ───────────────────────────────────────────────────
  const [overlayForm, setOverlayForm] = useState({ text: '', x: 50, y: 85, fontSize: 30, color: '#ffffff', shadow: true, fontFamily: 'Arial', bold: true, italic: false });
  const [draggingOvId, setDraggingOvId] = useState<string | null>(null);
  const [dragOvStart,  setDragOvStart]  = useState({ clientX: 0, clientY: 0, origX: 0, origY: 0 });

  // ── Comparison slider ─────────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);
  const [comparePos,  setComparePos]  = useState(50);
  const [draggingComp, setDraggingComp] = useState(false);

  // ── Logo / watermark ──────────────────────────────────────────────────────
  const [logoUrl,       setLogoUrl]       = useState<string | null>(() => {
    try { return localStorage.getItem('media_studio_logo_v1'); } catch { return null; }
  });
  const [logoOpacity,   setLogoOpacity]   = useState(85);
  const [logoPosition,  setLogoPosition]  = useState<'br' | 'bl' | 'tr' | 'tl'>('br');
  const [logoScale,     setLogoScale]     = useState(20);

  // ── BG removal ────────────────────────────────────────────────────────────
  const [bgRemoving, setBgRemoving] = useState(false);

  // ── AI captions ───────────────────────────────────────────────────────────
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [aiCaptions,      setAiCaptions]      = useState<string[]>([]);

  // ── Prompt improver ───────────────────────────────────────────────────────
  const [regenPrompt,    setRegenPrompt]    = useState('');
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
  const [stylePreset, setStylePreset] = useState<string>('');
  const [overlayFontFamily, setOverlayFontFamily] = useState('Arial');
  const [overlayBold, setOverlayBold] = useState(false);
  const [overlayItalic, setOverlayItalic] = useState(false);

  // ── Platform export ───────────────────────────────────────────────────────
  const [exporting,    setExporting]    = useState(false);
  const [batchPlatform, setBatchPlatform] = useState<string | null>(null);

  // ── Collapsible sidebar sections ──────────────────────────────────────────
  const ALL_SECTION_IDS = ['slideEdit','filters','transform','text','bg','logo','platforms','trim','frame','subs','regen'];
  const [closedSections, setClosedSections] = useState<Set<string>>(() => {
    if (allClosedInitially) {
      const s = new Set(ALL_SECTION_IDS);
      s.delete('slideEdit'); // always open slideEdit by default
      return s;
    }
    return new Set(['platforms', 'regen']);
  });
  const toggleSection = (id: string) => setClosedSections(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  // ── Video ─────────────────────────────────────────────────────────────────
  const [currentSub, setCurrentSub] = useState<string | null>(null);
  const [cueForm,    setCueForm]    = useState({ start: '', end: '', text: '' });
  const [trimStart,  setTrimStart]  = useState(0);
  const [trimEnd,    setTrimEnd]    = useState(0);
  const [trimming,   setTrimming]   = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef      = useRef<HTMLVideoElement>(null);
  const previewRef    = useRef<HTMLDivElement>(null);
  const logoInputRef  = useRef<HTMLInputElement>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const sel = gallery.find(i => i.id === selId) ?? null;
  const filterStyle = sel
    ? `brightness(${sel.brightness ?? 100}%) contrast(${sel.contrast ?? 100}%) saturate(${sel.saturation ?? 100}%) hue-rotate(${sel.hue ?? 0}deg)`
    : '';
  const transformStyle = sel
    ? `rotate(${sel.rotation ?? 0}deg) scaleX(${sel.flipH ? -1 : 1}) scaleY(${sel.flipV ? -1 : 1})`
    : '';

  // ── Effects ───────────────────────────────────────────────────────────────

  // External focus — re-runs on focusSeq too so same-id re-focus works
  useEffect(() => {
    if (focusId && gallery.some(i => i.id === focusId)) { setSelId(focusId); }
  }, [focusId, focusSeq]); // eslint-disable-line

  // Auto-select latest
  useEffect(() => {
    if (gallery.length > 0 && !selId) setSelId(gallery[0].id);
  }, [gallery.length]); // eslint-disable-line

  // Reset on item change
  useEffect(() => {
    if (sel) { setRegenPrompt(sel.prompt); setCurrentSub(null); setCompareMode(false); setAiCaptions([]); }
    setUndoStack([]); setRedoStack([]);
  }, [selId]); // eslint-disable-line

  // Video trim init
  useEffect(() => {
    if (sel?.type === 'video' && videoRef.current) {
      const v = videoRef.current;
      const onMeta = () => { setTrimStart(0); setTrimEnd(v.duration || 0); };
      v.addEventListener('loadedmetadata', onMeta);
      return () => v.removeEventListener('loadedmetadata', onMeta);
    }
  }, [sel?.url]); // eslint-disable-line

  // Keyboard undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoStack, redoStack, sel]); // eslint-disable-line

  // ── Core update (with undo) ───────────────────────────────────────────────

  const upd = useCallback((patch: Partial<MediaGalleryItem>) => {
    if (!sel) return;
    setUndoStack(prev => [...prev.slice(-19), sel]);
    setRedoStack([]);
    onUpdateItem({ ...sel, ...patch });
  }, [sel, onUpdateItem]);

  const undo = useCallback(() => {
    if (!undoStack.length || !sel) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, sel]);
    setUndoStack(u => u.slice(0, -1));
    onUpdateItem(prev);
  }, [undoStack, sel, onUpdateItem]);

  const redo = useCallback(() => {
    if (!redoStack.length || !sel) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, sel]);
    setRedoStack(r => r.slice(0, -1));
    onUpdateItem(next);
  }, [redoStack, sel, onUpdateItem]);

  // ── Filter preset ─────────────────────────────────────────────────────────

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    upd({ brightness: p.brightness, contrast: p.contrast, saturation: p.saturation });
  };

  // ── Text overlay drag ─────────────────────────────────────────────────────

  const handleOvPointerDown = (e: React.PointerEvent, ov: TextOverlay) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setUndoStack(prev => [...prev.slice(-19), sel!]);
    setRedoStack([]);
    setDraggingOvId(ov.id);
    setDragOvStart({ clientX: e.clientX, clientY: e.clientY, origX: ov.x, origY: ov.y });
  };

  const handlePreviewPointerMove = (e: React.PointerEvent) => {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();

    if (draggingOvId && sel) {
      const dx = ((e.clientX - dragOvStart.clientX) / rect.width) * 100;
      const dy = ((e.clientY - dragOvStart.clientY) / rect.height) * 100;
      onUpdateItem({
        ...sel,
        textOverlays: sel.textOverlays?.map(o =>
          o.id === draggingOvId
            ? { ...o, x: Math.max(0, Math.min(100, dragOvStart.origX + dx)), y: Math.max(0, Math.min(100, dragOvStart.origY + dy)) }
            : o
        ),
      });
    }

    if (draggingComp) {
      const pct = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
      setComparePos(pct);
    }
  };

  const handlePreviewPointerUp = () => {
    setDraggingOvId(null);
    setDraggingComp(false);
  };

  const addOverlay = () => {
    if (!overlayForm.text) return;
    upd({ textOverlays: [...(sel?.textOverlays ?? []), { id: Date.now().toString(), ...overlayForm, fontFamily: overlayForm.fontFamily, bold: overlayForm.bold, italic: overlayForm.italic }] });
    setOverlayForm(p => ({ ...p, text: '' }));
  };

  // ── Save edited image (bake filters + overlays + logo into a new data URL) ──

  const [saving, setSaving] = useState(false);

  const handleSaveEdited = async () => {
    if (!sel || sel.type !== 'image') return;
    setSaving(true);
    try {
      const img = await loadImage(sel.url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      let logoImg: HTMLImageElement | null = null;
      if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch { /* skip */ } }
      drawItemToCanvas(canvas, img, sel, img.naturalWidth, img.naturalHeight, logoImg, { opacity: logoOpacity, position: logoPosition, scale: logoScale });
      const bakedUrl = canvas.toDataURL('image/jpeg', 0.93);
      // Commit: update the item's URL to the baked version and reset filter props (already baked in)
      onUpdateItem({
        ...sel,
        url: bakedUrl,
        thumbnailUrl: bakedUrl,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        textOverlays: [],
      });
      setUndoStack([]);
      setRedoStack([]);
      onToast?.('✅ עריכות נשמרו בגלריה!', 'success');
    } catch { onToast?.('שגיאה בשמירה', 'error'); }
    finally { setSaving(false); }
  };

  // ── Image download (filters + overlays + logo) ────────────────────────────

  const downloadImg = async () => {
    if (!sel || sel.type !== 'image') return;
    try {
      const img = await loadImage(sel.url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      let logoImg: HTMLImageElement | null = null;
      if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch { /* skip */ } }
      drawItemToCanvas(canvas, img, sel, img.naturalWidth, img.naturalHeight, logoImg, { opacity: logoOpacity, position: logoPosition, scale: logoScale });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `media-studio-${sel.id}.png`;
      a.click();
      onToast?.('⬇️ מוריד תמונה...', 'info');
    } catch { onToast?.('שגיאה בהורדה', 'error'); }
  };

  // ── Platform resize ───────────────────────────────────────────────────────

  const resizeForPlatform = async (item: MediaGalleryItem, plat: typeof PLATFORMS[0], logoImg?: HTMLImageElement | null) => {
    const img = await loadImage(item.url);
    const canvas = document.createElement('canvas');
    canvas.width = plat.w; canvas.height = plat.h;
    drawItemToCanvas(canvas, img, item, plat.w, plat.h, logoImg ?? null, { opacity: logoOpacity, position: logoPosition, scale: logoScale });
    return canvas;
  };

  const handlePlatformExport = async (platId: string) => {
    if (!sel || sel.type !== 'image') return;
    const plat = PLATFORMS.find(p => p.id === platId)!;
    setExporting(true);
    try {
      let logoImg: HTMLImageElement | null = null;
      if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch { /* skip */ } }
      const canvas = await resizeForPlatform(sel, plat, logoImg);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/jpeg', 0.93);
      a.download = `${plat.id}-${sel.id}.jpg`;
      a.click();
      onToast?.(`✅ ייוצא ל-${plat.name}!`, 'success');
    } catch { onToast?.('שגיאה בייצוא', 'error'); }
    finally { setExporting(false); }
  };

  const handleBatchExport = async (platId: string) => {
    const plat = PLATFORMS.find(p => p.id === platId)!;
    const imgItems = gallery.filter(i => i.type === 'image');
    if (!imgItems.length) { onToast?.('אין תמונות בגלריה', 'error'); return; }
    setBatchPlatform(platId);
    try {
      let logoImg: HTMLImageElement | null = null;
      if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch { /* skip */ } }
      const zip = new JSZip();
      for (let i = 0; i < imgItems.length; i++) {
        const item = imgItems[i];
        const canvas = await resizeForPlatform(item, plat, logoImg);
        const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/jpeg', 0.93));
        zip.file(`${plat.id}-${i + 1}.jpg`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `gallery-${plat.id}.zip`;
      a.click();
      onToast?.(`📦 ${imgItems.length} תמונות יוצאו ל-${plat.name}!`, 'success');
    } catch { onToast?.('שגיאה ב-Batch Export', 'error'); }
    finally { setBatchPlatform(null); }
  };

  // ── Background removal ────────────────────────────────────────────────────

  const handleRemoveBg = async () => {
    if (!sel || sel.type !== 'image') return;
    setBgRemoving(true);
    onToast?.('🔄 מוריד מודל AI... (פעם ראשונה ~15 שנ\')', 'info');
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const res = await fetch(sel.url);
      const blob = await res.blob();
      const resultBlob = await removeBackground(blob);
      const dataUrl = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(resultBlob);
      });
      upd({ url: dataUrl });
      onToast?.('✅ הרקע הוסר!', 'success');
    } catch (e) {
      onToast?.('שגיאה בהסרת רקע — נסה שוב', 'error');
    } finally { setBgRemoving(false); }
  };

  // ── Blur background (vignette) ────────────────────────────────────────────

  const handleBlurBg = async () => {
    if (!sel || sel.type !== 'image') return;
    try {
      const img = await loadImage(sel.url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Draw blurred background
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = w; blurCanvas.height = h;
      const bCtx = blurCanvas.getContext('2d')!;
      bCtx.filter = 'blur(24px)';
      bCtx.drawImage(img, 0, 0);
      ctx.drawImage(blurCanvas, 0, 0);

      // Overlay sharp center with radial mask
      const tempC = document.createElement('canvas');
      tempC.width = w; tempC.height = h;
      const tCtx = tempC.getContext('2d')!;
      tCtx.drawImage(img, 0, 0);
      tCtx.globalCompositeOperation = 'destination-in';
      const grad = tCtx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.6);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      tCtx.fillStyle = grad;
      tCtx.fillRect(0, 0, w, h);
      ctx.drawImage(tempC, 0, 0);

      upd({ url: canvas.toDataURL('image/png') });
      onToast?.('✅ רקע מטושטש!', 'success');
    } catch { onToast?.('שגיאה', 'error'); }
  };

  // ── Frame capture ─────────────────────────────────────────────────────────

  const captureFrame = () => {
    const v = videoRef.current;
    if (!sel || sel.type !== 'video' || !v) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    onAddToGallery?.({ url: dataUrl, type: 'image', engine: 'frame-capture', prompt: `פריים מ: ${sel.prompt}` });
    onToast?.('📸 פריים נוסף לגלריה!', 'success');
  };

  // ── Video trim ────────────────────────────────────────────────────────────

  const handleVideoTrim = async () => {
    const v = videoRef.current;
    if (!sel || sel.type !== 'video' || !v || trimEnd <= trimStart) return;
    setTrimming(true);
    onToast?.('✂️ חותך וידאו בזמן אמת...', 'info');
    try {
      v.currentTime = trimStart;
      await new Promise<void>(res => { v.onseeked = () => res(); });

      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d')!;

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.start(100);
      await v.play();

      await new Promise<void>((res) => {
        const draw = () => {
          if (v.currentTime >= trimEnd) { recorder.stop(); v.pause(); res(); return; }
          ctx.drawImage(v, 0, 0);
          requestAnimationFrame(draw);
        };
        draw();
      });

      await new Promise<void>(res => { recorder.onstop = () => res(); });
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      upd({ url });
      onToast?.('✅ וידאו נחתך!', 'success');
    } catch (e) {
      onToast?.('שגיאה בחיתוך וידאו', 'error');
    } finally { setTrimming(false); }
  };

  // ── Subtitle helpers ──────────────────────────────────────────────────────

  const handleTimeUpdate = () => {
    if (!sel?.subtitles?.length) { setCurrentSub(null); return; }
    const t = videoRef.current?.currentTime ?? 0;
    setCurrentSub(sel.subtitles.find(c => t >= c.start && t <= c.end)?.text ?? null);
  };

  const addCue = () => {
    const s = parseFloat(cueForm.start), e = parseFloat(cueForm.end);
    if (!cueForm.text || isNaN(s) || isNaN(e) || e <= s) { onToast?.('זמן לא תקין', 'error'); return; }
    const cues = [...(sel?.subtitles ?? []), { id: Date.now().toString(), start: s, end: e, text: cueForm.text }]
      .sort((a, b) => a.start - b.start);
    upd({ subtitles: cues });
    setCueForm({ start: '', end: '', text: '' });
  };

  // ── Logo ──────────────────────────────────────────────────────────────────

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setLogoUrl(url);
      try { localStorage.setItem('media_studio_logo_v1', url); } catch { /* quota */ }
      onToast?.('✅ לוגו נשמר!', 'success');
    };
    reader.readAsDataURL(file);
  };

  // ── AI Captions ───────────────────────────────────────────────────────────

  const generateCaptions = async () => {
    if (!sel || sel.type !== 'image') return;
    setCaptionsLoading(true); setAiCaptions([]);
    try {
      const base64 = sel.url.split(',')[1];
      const mediaType = (sel.url.match(/data:([^;]+)/)?.[1] ?? 'image/png') as 'image/png' | 'image/jpeg';
      const anthropic = getAnthropicProxy();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `אתה מומחה שיווק דיגיטלי. הסתכל על התמונה וכתוב בדיוק 3 כיתובי פוסט שיווקיים בעברית.
כל כיתוב: 2-4 שורות קצרות, אמוג'י מתאימים, קריאה לפעולה, מוכן לשימוש מיידי.

פורמט:
1. [כיתוב ראשון]

2. [כיתוב שני]

3. [כיתוב שלישי]` }
          ],
        }],
      });
      const text = (response.content.find((b: {type:string}) => b.type === 'text') as {text:string})?.text ?? '';
      const parts = text.split(/\n\s*\d+\.\s+/).map(s => s.trim()).filter(Boolean);
      setAiCaptions(parts.slice(0, 3));
    } catch { onToast?.('שגיאה ביצירת כיתובים', 'error'); }
    finally { setCaptionsLoading(false); }
  };

  // ── AI Prompt Improver ────────────────────────────────────────────────────

  const improvePrompt = async () => {
    if (!regenPrompt.trim()) return;
    setImprovingPrompt(true);
    try {
      const anthropic = getAnthropicProxy();
      const engineLabel = sel?.engine === 'dalle' ? 'DALL-E' : sel?.engine === 'veo' ? 'Veo (video)' : 'Google Imagen';
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `You are an expert at writing AI generation prompts for ${engineLabel}.

Improve this prompt: "${regenPrompt}"

Rules:
- Keep the core idea intact
- Add visual details: lighting, composition, mood, style, colors
- Add quality descriptors appropriate for ${engineLabel}
- Max 250 characters
- Output ONLY the improved prompt, no quotes, no explanation`,
        }],
      });
      const improved = (response.content.find((b: {type:string}) => b.type === 'text') as {text:string})?.text?.trim() ?? '';
      if (improved) { setRegenPrompt(improved); onToast?.('✨ פרומפט שופר!', 'success'); }
    } catch { onToast?.('שגיאה בשיפור פרומפט', 'error'); }
    finally { setImprovingPrompt(false); }
  };

  // ── Smart A/B Variants ────────────────────────────────────────────────────

  const generateVariants = async () => {
    if (!regenPrompt.trim() || !sel) return;
    setVariantsLoading(true);
    try {
      const anthropic = getAnthropicProxy();
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Write exactly 3 different prompt variations for AI ${sel.type} generation.
Base prompt: "${regenPrompt}"
Each variation explores a different angle/mood/style. Max 200 chars each.
Output ONLY the prompts, numbered 1. 2. 3., one per line.`,
        }],
      });
      const text = (response.content.find((b: {type:string}) => b.type === 'text') as {text:string})?.text ?? '';
      const variants = text.split('\n')
        .filter(l => /^\d+\./.test(l.trim()))
        .map(l => l.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
      variants.forEach(v => onRequestRegenerate(v, sel.type, sel.engine));
      onToast?.(`🚀 ${variants.length} וריאציות שנשלחו לייצור!`, 'success');
    } catch { onToast?.('שגיאה', 'error'); }
    finally { setVariantsLoading(false); }
  };

  // ── Video download ────────────────────────────────────────────────────────

  const downloadVid = () => {
    if (!sel || sel.type !== 'video') return;
    const a = document.createElement('a');
    a.href = sel.url; a.download = `media-studio-${sel.id}.mp4`; a.click();
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  // Only show the empty placeholder when there is no gallery AND we're not
  // editing a presentation. In slideMode the slide editor must render even with
  // an empty image gallery (e.g. text-only slides), otherwise the presentation
  // never appears in the canvas.

  if (!gallery.length && !slideMode) return (
    <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>
      <span className="text-5xl">🎬</span>
      <span className="text-sm">עדיין אין מדיה — צור תמונה או וידאו עם AI</span>
    </div>
  );

  // ── Theme ─────────────────────────────────────────────────────────────────

  const tc = {
    card:  isDark ? '#111827' : '#ffffff',
    panel: isDark ? 'rgba(255,255,255,0.04)' : '#f3f4f6',
    border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    text:  isDark ? '#e5e7eb' : '#111827',
    muted: isDark ? '#9ca3af' : '#6b7280',
    input: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
    inputBorder: isDark ? 'rgba(255,255,255,0.12)' : '#d1d5db',
  };

  // ── (Tab definitions removed — replaced by sidebar sections) ────────────

  // ── Sidebar section helper ────────────────────────────────────────────────

  const SbSection = ({ id, title, children, hide }: { id: string; title: string; children: React.ReactNode; hide?: boolean }) => {
    if (hide) return null;
    const open = !closedSections.has(id);
    return (
      <div style={{ borderBottom: `1px solid ${tc.border}` }}>
        <button className="w-full flex items-center justify-between px-3 py-2 text-left"
          style={{ background: 'transparent' }}
          onClick={() => toggleSection(id)}>
          <span className="text-[11px] font-bold" style={{ color: tc.text }}>{title}</span>
          <span style={{ color: tc.muted, fontSize: 10, transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
        </button>
        {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', direction: 'rtl', border: `1px solid ${tc.border}`, borderRadius: 16, overflow: 'hidden' }}>

      {/* ── RIGHT: Sidebar ─────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, width: 220, height: '100%', background: isDark ? '#0d1117' : '#f8fafc', borderLeft: `1px solid ${tc.border}`, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* ── Slide mode: slide thumbnails strip ────────────────────────── */}
        {slideMode && slideMode.slides.length > 0 && (
          <div style={{ borderBottom: `1px solid ${tc.border}` }}>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] font-bold" style={{ color: tc.text }}>🖥️ שקופיות ({slideMode.slides.length})</span>
            </div>
            <div className="flex gap-1 px-2 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {slideMode.slides.map((slide, i) => (
                <div key={slide.id} onClick={() => slideMode.onSelectSlide(i)}
                  className="flex-shrink-0 cursor-pointer rounded-lg overflow-hidden relative"
                  style={{ width: 60, height: 38, background: slide.bgColor ?? '#1e1b4b',
                    border: `2px solid ${i === slideMode.activeIndex ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
                    boxShadow: i === slideMode.activeIndex ? '0 0 0 1px rgba(124,58,237,0.4)' : 'none' }}>
                  <div className="absolute inset-0 flex items-center justify-center p-1">
                    <span className="text-[5px] font-bold text-center leading-tight line-clamp-2"
                      style={{ color: slide.textColor ?? '#fff' }}>
                      {slide.title || `${i + 1}`}
                    </span>
                  </div>
                  <div className="absolute bottom-0.5 right-0.5 text-[7px] font-bold"
                    style={{ color: 'rgba(255,255,255,0.7)', textShadow: '0 0 3px rgba(0,0,0,0.8)' }}>
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Slide mode: slide editing section ─────────────────────────── */}
        {slideMode && (() => {
          const activeSlide = slideMode.slides[slideMode.activeIndex];
          if (!activeSlide) return null;
          return (
            <SbSection id="slideEdit" title="✏️ עריכת שקופית">
              {/* Pres name + save + delete */}
              <div className="flex items-center gap-1">
                <input value={slideMode.presentationName}
                  onChange={e => slideMode.onUpdatePresName(e.target.value)}
                  className="flex-1 rounded-lg border px-1.5 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-400"
                  style={{ fontSize: 10, borderColor: tc.border, color: tc.text }}
                  placeholder="שם מצגת..." dir="rtl"/>
                <button onClick={slideMode.onSave} disabled={slideMode.savingPres}
                  className="p-1.5 rounded-lg disabled:opacity-50 flex-shrink-0"
                  style={{ background: '#10b981', color: '#fff' }} title="שמור">
                  {slideMode.savingPres
                    ? <div className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin"/>
                    : <Save size={11}/>}
                </button>
                <button onClick={slideMode.onDeleteSlide} disabled={slideMode.slides.length <= 1}
                  className="p-1.5 rounded-lg disabled:opacity-30 flex-shrink-0"
                  style={{ color: '#ef4444' }} title="מחק שקופית">
                  <Trash2 size={11}/>
                </button>
              </div>
              <div className="text-[9px] font-bold" style={{ color: '#7c3aed' }}>
                שקופית {slideMode.activeIndex + 1}/{slideMode.slides.length}
              </div>
              {/* Title */}
              <input value={activeSlide.title}
                onChange={e => slideMode.onUpdateSlide(s => ({ ...s, title: e.target.value }))}
                className="w-full rounded-lg border px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-400"
                style={{ fontSize: 10, borderColor: tc.border, color: tc.text }}
                placeholder="כותרת השקופית" dir="rtl"/>
              {/* Body */}
              <textarea rows={3} value={activeSlide.body}
                onChange={e => slideMode.onUpdateSlide(s => ({ ...s, body: e.target.value }))}
                className="w-full rounded-lg border px-2 py-1 bg-transparent resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                style={{ fontSize: 10, borderColor: tc.border, color: tc.text }}
                placeholder="תוכן השקופית..." dir="rtl"/>
              {/* Layout */}
              <select value={activeSlide.layout}
                onChange={e => slideMode.onUpdateSlide(s => ({ ...s, layout: e.target.value }))}
                className="w-full rounded-lg border px-1.5 py-1 bg-transparent focus:outline-none"
                style={{ fontSize: 10, borderColor: tc.border, color: tc.text }}>
                {SLIDE_LAYOUTS_MS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              {/* BG color */}
              <div className="space-y-1">
                <p className="text-[9px] font-semibold" style={{ color: tc.muted }}>צבע רקע</p>
                <div className="flex gap-1 flex-wrap">
                  {SLIDE_BG_COLORS_MS.map(c => (
                    <button key={c} onClick={() => slideMode.onUpdateSlide(s => ({ ...s, bgColor: c }))}
                      className="w-5 h-5 rounded transition-all"
                      style={{ background: c, border: `2px solid ${activeSlide.bgColor === c ? '#7c3aed' : 'transparent'}`, outline: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}` }}/>
                  ))}
                  <input type="color" value={activeSlide.bgColor}
                    onChange={e => slideMode.onUpdateSlide(s => ({ ...s, bgColor: e.target.value }))}
                    className="w-5 h-5 rounded cursor-pointer" title="צבע מותאם"/>
                </div>
              </div>
              {/* Text color */}
              <div className="space-y-1">
                <p className="text-[9px] font-semibold" style={{ color: tc.muted }}>צבע טקסט</p>
                <div className="flex gap-1">
                  {SLIDE_TEXT_COLORS_MS.map(c => (
                    <button key={c} onClick={() => slideMode.onUpdateSlide(s => ({ ...s, textColor: c }))}
                      className="w-5 h-5 rounded transition-all"
                      style={{ background: c, border: `2px solid ${activeSlide.textColor === c ? '#7c3aed' : 'transparent'}`, outline: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}` }}/>
                  ))}
                  <input type="color" value={activeSlide.textColor}
                    onChange={e => slideMode.onUpdateSlide(s => ({ ...s, textColor: e.target.value }))}
                    className="w-5 h-5 rounded cursor-pointer" title="צבע מותאם"/>
                </div>
              </div>
              {/* Remove image */}
              {activeSlide.imageId && (
                <button onClick={() => slideMode.onUpdateSlide(s => ({ ...s, imageId: null }))}
                  className="text-[9px] font-semibold text-red-400 hover:text-red-600 text-right w-full">
                  × הסר תמונה מהשקופית
                </button>
              )}
            </SbSection>
          );
        })()}

        {/* Gallery thumbnails */}
        <div style={{ borderBottom: `1px solid ${tc.border}` }}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] font-bold" style={{ color: tc.text }}>📁 גלריה ({gallery.length})</span>
          </div>
          {gallery.length === 0 ? (
            <div className="px-3 pb-3 text-center text-[10px]" style={{ color: tc.muted }}>אין פריטים עדיין</div>
          ) : (
            <div className="grid grid-cols-3 gap-1 px-2 pb-2">
              {gallery.map(item => (
                <div key={item.id} onClick={() => setSelId(item.id)}
                  className="relative cursor-pointer rounded-lg overflow-hidden"
                  style={{ paddingBottom: '75%', border: `2px solid ${selId === item.id ? '#7c3aed' : 'transparent'}`, boxShadow: selId === item.id ? '0 0 0 1px #7c3aed60' : 'none' }}>
                  {item.type === 'image'
                    ? <img src={item.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    : <div className="absolute inset-0 flex items-center justify-center text-white text-xs" style={{ background: '#0f172a' }}>▶</div>
                  }
                  {/* tiny engine badge */}
                  <div className="absolute bottom-0 inset-x-0 text-center" style={{ background: 'rgba(0,0,0,0.6)', fontSize: 7, color: '#e5e7eb', padding: '1px 2px' }}>
                    {item.engine === 'imagen' ? 'Img' : item.engine === 'dalle' ? 'DALL-E' : item.engine === 'veo' ? 'Veo' : item.engine}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {sel ? (
          <>
            {/* ── Image tools ── */}
            {sel.type === 'image' && (
              <>
                <SbSection id="filters" title="🎨 פרסטים ופילטרים">
                  <div className="grid grid-cols-4 gap-1 mb-1">
                    {Object.entries(PRESETS).map(([key, p]) => {
                      const active = (sel.brightness ?? 100) === p.brightness && (sel.contrast ?? 100) === p.contrast && (sel.saturation ?? 100) === p.saturation;
                      return (
                        <button key={key} onClick={() => applyPreset(key)}
                          className="flex flex-col items-center py-1 rounded-lg"
                          style={{ background: active ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'), border: `1px solid ${active ? '#7c3aed' : tc.border}`, fontSize: 8, color: active ? '#fff' : tc.muted }}>
                          <span style={{ fontSize: 11 }}>{p.emoji}</span>
                          <span>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(['brightness', 'contrast', 'saturation'] as const).map(k => (
                    <div key={k} className="space-y-0.5">
                      <div className="flex justify-between" style={{ fontSize: 9, color: tc.muted }}>
                        <span>{{ brightness: 'בהירות ☀️', contrast: 'ניגודיות 🌓', saturation: 'רוויה 🌈' }[k]}</span>
                        <span>{(sel as Record<string, number>)[k] ?? 100}%</span>
                      </div>
                      <input type="range" min={0} max={200}
                        value={(sel as Record<string, number>)[k] ?? 100}
                        onChange={e => upd({ [k]: +e.target.value })}
                        className="w-full" style={{ accentColor: '#7c3aed', height: 3 }} />
                    </div>
                  ))}
                  <div className="space-y-0.5">
                    <div className="flex justify-between" style={{ fontSize: 9, color: tc.muted }}>
                      <span>גוון 🎨</span>
                      <span>{sel.hue ?? 0}°</span>
                    </div>
                    <input type="range" min={-180} max={180}
                      value={sel.hue ?? 0}
                      onChange={e => upd({ hue: +e.target.value })}
                      className="w-full" style={{ accentColor: '#7c3aed', height: 3 }} />
                  </div>
                  <div className="flex gap-1 pt-1">
                    <button onClick={() => upd({ brightness: 100, contrast: 100, saturation: 100, hue: 0 })}
                      className="flex-1 py-1 rounded-lg text-[9px]" style={{ color: tc.muted, background: tc.panel, border: `1px solid ${tc.border}` }}>↺ איפוס</button>
                    <button onClick={() => setCompareMode(v => !v)}
                      className="flex-1 py-1 rounded-lg text-[9px] font-semibold"
                      style={{ background: compareMode ? '#7c3aed' : tc.panel, color: compareMode ? '#fff' : tc.muted, border: `1px solid ${compareMode ? '#7c3aed' : tc.border}` }}>
                      {compareMode ? '✕ סגור' : '◀▶ השווה'}
                    </button>
                  </div>
                </SbSection>

                <SbSection id="transform" title="🔄 טרנספורמציה">
                  <div className="grid grid-cols-4 gap-1">
                    <button onClick={() => upd({ rotation: ((sel.rotation ?? 0) - 90 + 360) % 360 })}
                      className="py-1.5 rounded-lg text-[10px] font-bold"
                      style={{ background: tc.panel, color: tc.text, border: `1px solid ${tc.border}` }}>↺ 90°</button>
                    <button onClick={() => upd({ rotation: ((sel.rotation ?? 0) + 90) % 360 })}
                      className="py-1.5 rounded-lg text-[10px] font-bold"
                      style={{ background: tc.panel, color: tc.text, border: `1px solid ${tc.border}` }}>↻ 90°</button>
                    <button onClick={() => upd({ flipH: !sel.flipH })}
                      className="py-1.5 rounded-lg text-[10px] font-bold"
                      title="הפוך אופקית"
                      style={{ background: sel.flipH ? '#7c3aed' : tc.panel, color: sel.flipH ? '#fff' : tc.text, border: `1px solid ${sel.flipH ? '#7c3aed' : tc.border}` }}>⇄ H</button>
                    <button onClick={() => upd({ flipV: !sel.flipV })}
                      className="py-1.5 rounded-lg text-[10px] font-bold"
                      title="הפוך אנכית"
                      style={{ background: sel.flipV ? '#7c3aed' : tc.panel, color: sel.flipV ? '#fff' : tc.text, border: `1px solid ${sel.flipV ? '#7c3aed' : tc.border}` }}>↕ V</button>
                  </div>
                  <button onClick={() => upd({ rotation: 0, flipH: false, flipV: false })}
                    className="w-full py-1 rounded-lg text-[9px]"
                    style={{ color: tc.muted, background: tc.panel, border: `1px solid ${tc.border}` }}>↺ איפוס טרנספורם</button>
                </SbSection>

                <SbSection id="text" title="📝 הוספת טקסט">
                  <input type="text" placeholder="הטקסט שלך..."
                    value={overlayForm.text}
                    onChange={e => setOverlayForm(p => ({ ...p, text: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addOverlay()}
                    className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                    style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} />
                  <select value={overlayForm.fontFamily}
                    onChange={e => setOverlayForm(p => ({ ...p, fontFamily: e.target.value }))}
                    className="w-full rounded-lg px-2 py-1 text-xs outline-none"
                    style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }}>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Impact">Impact (Bold)</option>
                    <option value="'Segoe UI'">Segoe UI</option>
                    <option value="Verdana">Verdana</option>
                    <option value="'Times New Roman'">Times New Roman</option>
                    <option value="'Courier New'">Courier New</option>
                  </select>
                  <div className="flex gap-1">
                    <button onClick={() => setOverlayForm(p => ({ ...p, bold: !p.bold }))}
                      className="flex-1 py-1 rounded-lg text-xs font-bold"
                      style={{ background: overlayForm.bold ? '#7c3aed' : tc.panel, color: overlayForm.bold ? '#fff' : tc.muted, border: `1px solid ${overlayForm.bold ? '#7c3aed' : tc.border}` }}>
                      B
                    </button>
                    <button onClick={() => setOverlayForm(p => ({ ...p, italic: !p.italic }))}
                      className="flex-1 py-1 rounded-lg text-xs italic"
                      style={{ background: overlayForm.italic ? '#7c3aed' : tc.panel, color: overlayForm.italic ? '#fff' : tc.muted, border: `1px solid ${overlayForm.italic ? '#7c3aed' : tc.border}` }}>
                      I
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <label style={{ fontSize: 9, color: tc.muted }}>
                      גודל
                      <input type="number" min={8} max={120} value={overlayForm.fontSize}
                        onChange={e => setOverlayForm(p => ({ ...p, fontSize: +e.target.value }))}
                        className="w-full rounded px-1 py-0.5 text-xs outline-none mt-0.5"
                        style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} />
                    </label>
                    <label style={{ fontSize: 9, color: tc.muted }}>
                      צבע
                      <input type="color" value={overlayForm.color}
                        onChange={e => setOverlayForm(p => ({ ...p, color: e.target.value }))}
                        className="w-full rounded cursor-pointer mt-0.5"
                        style={{ height: 24, border: `1px solid ${tc.inputBorder}` }} />
                    </label>
                  </div>
                  <label className="flex items-center gap-1 cursor-pointer" style={{ fontSize: 10, color: tc.muted }}>
                    <input type="checkbox" checked={overlayForm.shadow}
                      onChange={e => setOverlayForm(p => ({ ...p, shadow: e.target.checked }))} />
                    צל לטקסט
                  </label>
                  <button onClick={addOverlay} disabled={!overlayForm.text}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    style={{ background: '#7c3aed' }}>+ הוסף טקסט</button>
                  {(sel.textOverlays ?? []).map(o => (
                    <div key={o.id} className="flex items-center gap-1 rounded-lg px-2 py-1"
                      style={{ background: tc.card, border: `1px solid ${tc.border}`, fontSize: 10 }}>
                      <span className="flex-1 truncate font-bold" style={{ color: o.color }}>{o.text}</span>
                      <button onClick={() => upd({ textOverlays: sel.textOverlays?.filter(x => x.id !== o.id) })}
                        style={{ color: '#ef4444', fontSize: 12 }}>✕</button>
                    </div>
                  ))}
                </SbSection>

                <SbSection id="bg" title="🖼️ כלי רקע">
                  <button onClick={handleRemoveBg} disabled={bgRemoving}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
                    {bgRemoving ? '⏳ מסיר...' : '✂️ הסר רקע (AI)'}
                  </button>
                  <button onClick={handleBlurBg}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
                    🌀 טשטש רקע
                  </button>
                </SbSection>

                <SbSection id="logo" title="💼 לוגו / Watermark">
                  <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
                  <button onClick={() => logoInputRef.current?.click()}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold"
                    style={{ background: tc.card, border: `1px solid ${logoUrl ? '#10b981' : tc.border}`, color: logoUrl ? '#10b981' : tc.muted }}>
                    {logoUrl ? '✅ לוגו נטען' : '📤 העלה לוגו PNG'}
                  </button>
                  {logoUrl && (
                    <>
                      <div style={{ fontSize: 9, color: tc.muted }}>גודל: {logoScale}%
                        <input type="range" min={5} max={50} value={logoScale}
                          onChange={e => setLogoScale(+e.target.value)}
                          className="w-full mt-0.5" style={{ accentColor: '#7c3aed', height: 3 }} />
                      </div>
                      <div style={{ fontSize: 9, color: tc.muted }}>שקיפות: {logoOpacity}%
                        <input type="range" min={10} max={100} value={logoOpacity}
                          onChange={e => setLogoOpacity(+e.target.value)}
                          className="w-full mt-0.5" style={{ accentColor: '#7c3aed', height: 3 }} />
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {(['tr','tl','br','bl'] as const).map(pos => (
                          <button key={pos} onClick={() => setLogoPosition(pos)}
                            className="py-0.5 rounded text-[8px] font-semibold"
                            style={{ background: logoPosition === pos ? '#7c3aed' : tc.panel, color: logoPosition === pos ? '#fff' : tc.muted, border: `1px solid ${tc.border}` }}>
                            {{ tr: '↗ ימין עליון', tl: '↖ שמאל עליון', br: '↘ ימין תחתון', bl: '↙ שמאל תחתון' }[pos]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { setLogoUrl(null); localStorage.removeItem('media_studio_logo_v1'); }}
                        className="text-[9px] w-full text-center" style={{ color: '#ef4444' }}>🗑️ הסר לוגו</button>
                    </>
                  )}
                </SbSection>

                <SbSection id="platforms" title="📱 ייצוא לפלטפורמות">
                  <div className="space-y-1">
                    {PLATFORMS.map(plat => (
                      <button key={plat.id} onClick={() => handlePlatformExport(plat.id)} disabled={exporting}
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
                        style={{ background: tc.panel, border: `1px solid ${tc.border}`, color: tc.text }}>
                        <span>{plat.emoji}</span>
                        <span className="flex-1 text-right">{plat.name}</span>
                        <span style={{ fontSize: 8, color: tc.muted }}>{plat.w}×{plat.h}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ borderTop: `1px solid ${tc.border}`, paddingTop: 6 }}>
                    <p className="text-[9px] font-bold mb-1" style={{ color: tc.muted }}>📦 Batch ZIP</p>
                    <div className="grid grid-cols-3 gap-1">
                      {PLATFORMS.map(plat => (
                        <button key={plat.id} onClick={() => handleBatchExport(plat.id)} disabled={!!batchPlatform}
                          className="flex flex-col items-center gap-0.5 rounded-lg py-1 text-[8px] font-semibold disabled:opacity-50"
                          style={{ background: batchPlatform === plat.id ? '#7c3aed' : tc.panel, color: batchPlatform === plat.id ? '#fff' : tc.muted, border: `1px solid ${tc.border}` }}>
                          <span>{plat.emoji}</span>
                          {batchPlatform === plat.id ? '⏳' : plat.id.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </SbSection>
              </>
            )}

            {/* ── Video tools ── */}
            {sel.type === 'video' && (
              <>
                <SbSection id="trim" title="✂️ חיתוך וידאו">
                  <p style={{ fontSize: 9, color: tc.muted }}>משך: {trimEnd.toFixed(1)}s</p>
                  <div className="grid grid-cols-2 gap-1">
                    {(['trimStart', 'trimEnd'] as const).map((k, i) => (
                      <label key={k} style={{ fontSize: 9, color: tc.muted }}>
                        {['התחלה', 'סיום'][i]} (שנ')
                        <input type="number" step={0.1} min={0}
                          value={k === 'trimStart' ? trimStart : trimEnd}
                          onChange={e => k === 'trimStart' ? setTrimStart(+e.target.value) : setTrimEnd(+e.target.value)}
                          className="w-full rounded px-1 py-0.5 text-xs outline-none mt-0.5"
                          style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} />
                      </label>
                    ))}
                  </div>
                  <button onClick={() => { if (videoRef.current) setTrimStart(parseFloat(videoRef.current.currentTime.toFixed(1))); }}
                    className="w-full text-[9px] py-0.5 rounded-lg"
                    style={{ background: tc.card, color: '#2563eb', border: `1px solid ${tc.border}` }}>
                    ⏱️ זמן נוכחי = התחלה
                  </button>
                  <button onClick={handleVideoTrim} disabled={trimming || trimEnd <= trimStart}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                    {trimming ? '⏳ חותך...' : '✂️ חתוך וידאו'}
                  </button>
                </SbSection>

                <SbSection id="frame" title="📸 חילוץ פריים">
                  <p style={{ fontSize: 9, color: tc.muted }}>השהה ברגע הנכון ולחץ:</p>
                  <button onClick={captureFrame}
                    className="w-full rounded-lg py-1.5 text-xs font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                    📸 צלם פריים כתמונה
                  </button>
                </SbSection>

                <SbSection id="subs" title="💬 כתוביות">
                  <div className="grid grid-cols-3 gap-1">
                    {(['start', 'end'] as const).map(k => (
                      <label key={k} className="col-span-1" style={{ fontSize: 9, color: tc.muted }}>
                        {k === 'start' ? 'מ (שנ\')' : 'עד (שנ\')'}
                        <input type="number" step={0.1} min={0} placeholder={k === 'start' ? '0' : '5'}
                          value={k === 'start' ? cueForm.start : cueForm.end}
                          onChange={e => setCueForm(p => ({ ...p, [k]: e.target.value }))}
                          className="w-full rounded px-1 py-0.5 text-[10px] outline-none mt-0.5"
                          style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} />
                      </label>
                    ))}
                    <button
                      onClick={() => { if (videoRef.current) setCueForm(p => ({ ...p, start: videoRef.current!.currentTime.toFixed(1) })); }}
                      className="col-span-1 rounded text-[8px] py-0.5 mt-auto"
                      style={{ background: tc.card, color: '#2563eb', border: `1px solid ${tc.border}` }}>⏱️</button>
                  </div>
                  <input type="text" placeholder="טקסט הכתובית..."
                    value={cueForm.text}
                    onChange={e => setCueForm(p => ({ ...p, text: e.target.value }))}
                    className="w-full rounded-lg px-2 py-1.5 text-xs outline-none"
                    style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} />
                  <button
                    onClick={() => {
                      if (!cueForm.text || !sel) return;
                      const cue: SubtitleCue = { id: Date.now().toString(), start: parseFloat(cueForm.start) || 0, end: parseFloat(cueForm.end) || 5, text: cueForm.text };
                      upd({ subtitles: [...(sel.subtitles ?? []), cue] });
                      setCueForm({ start: '', end: '', text: '' });
                    }}
                    className="w-full rounded-lg py-1 text-xs font-semibold text-white"
                    style={{ background: '#7c3aed' }}>+ הוסף כתובית</button>
                  {(sel.subtitles ?? []).map(c => (
                    <div key={c.id} className="rounded-lg px-2 py-1 flex items-center gap-1"
                      style={{ background: tc.card, border: `1px solid ${tc.border}`, fontSize: 9 }}>
                      <span style={{ color: tc.muted }}>{c.start}s→{c.end}s</span>
                      <span className="flex-1 truncate" style={{ color: tc.text }}>{c.text}</span>
                      <button onClick={() => upd({ subtitles: sel.subtitles?.filter(x => x.id !== c.id) })}
                        style={{ color: '#ef4444' }}>✕</button>
                    </div>
                  ))}
                  {(sel.subtitles?.length ?? 0) > 0 && (
                    <button
                      onClick={() => {
                        const vtt = makeVtt(sel.subtitles ?? []);
                        const blob = new Blob([vtt], { type: 'text/vtt' });
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'subtitles.vtt'; a.click();
                      }}
                      className="w-full rounded-lg py-1 text-xs font-semibold"
                      style={{ background: tc.card, border: `1px solid ${tc.border}`, color: tc.text }}>
                      ⬇️ הורד VTT
                    </button>
                  )}
                </SbSection>
              </>
            )}

            <SbSection id="regen" title="🔄 ייצור מחדש">
              <div className="grid grid-cols-3 gap-1 mb-1">
                {STYLE_PRESETS.map(p => (
                  <button key={p.id} onClick={() => setStylePreset(prev => prev === p.id ? '' : p.id)}
                    className="py-1 rounded-lg text-[8px] font-semibold text-center leading-tight"
                    style={{ background: stylePreset === p.id ? '#7c3aed' : tc.panel, color: stylePreset === p.id ? '#fff' : tc.muted, border: `1px solid ${stylePreset === p.id ? '#7c3aed' : tc.border}` }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea
                value={regenPrompt}
                onChange={e => setRegenPrompt(e.target.value)}
                rows={3}
                placeholder="פרומפט לשיפור..."
                className="w-full rounded-lg px-2 py-1.5 text-xs outline-none resize-none"
                style={{ background: tc.input, border: `1px solid ${tc.inputBorder}`, color: tc.text }} dir="ltr" />
              <textarea
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                rows={2}
                placeholder="נגטיב פרומפט (ללא: blurry, text, watermark...)"
                className="w-full rounded-lg px-2 py-1.5 text-[10px] outline-none resize-none"
                style={{ background: tc.input, border: `1px solid rgba(239,68,68,0.3)`, color: tc.muted }} dir="ltr" />
              <div className="grid grid-cols-4 gap-1">
                {(['1:1','16:9','9:16','4:3'] as const).map(ar => (
                  <button key={ar} onClick={() => setAspectRatio(ar)}
                    className="py-1 rounded-lg text-[9px] font-bold"
                    style={{ background: aspectRatio === ar ? '#4f46e5' : tc.panel, color: aspectRatio === ar ? '#fff' : tc.muted, border: `1px solid ${aspectRatio === ar ? '#4f46e5' : tc.border}` }}>
                    {ar}
                  </button>
                ))}
              </div>
              <button onClick={improvePrompt} disabled={improvingPrompt || !regenPrompt.trim()}
                className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                {improvingPrompt ? '⏳ משפר...' : '✨ שפר פרומפט AI'}
              </button>
              <button onClick={() => {
                const suffix = stylePreset ? (STYLE_PRESETS.find(p => p.id === stylePreset)?.suffix ?? '') : '';
                onRequestRegenerate(regenPrompt + suffix, sel.type, sel.engine);
              }} disabled={!regenPrompt.trim()}
                className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                🔄 ייצר מחדש
              </button>
              <button onClick={generateVariants} disabled={variantsLoading || !regenPrompt.trim()}
                className="w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                {variantsLoading ? '⏳...' : '🔀 צור 3 A/B Variants'}
              </button>
            </SbSection>

            {/* Prompt snippet */}
            {sel.prompt && (
              <div className="px-3 py-2" style={{ borderTop: `1px solid ${tc.border}`, fontSize: 9, color: tc.muted }}>
                <span className="font-semibold" style={{ color: '#7c3aed' }}>פרומפט: </span>
                {sel.prompt.slice(0, 90)}{sel.prompt.length > 90 ? '...' : ''}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
            <span className="text-3xl">🖼️</span>
            <p className="text-xs" style={{ color: tc.muted }}>בחר פריט מהגלריה</p>
          </div>
        )}
      </div>

      {/* ── LEFT: Preview + actions ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ background: isDark ? '#0f172a' : '#e8edf2' }}>

        {/* Quick Actions bar */}
        {sel && (
          <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 flex-wrap"
            style={{ background: isDark ? '#161b27' : '#f8fafc', borderBottom: `1px solid ${tc.border}` }}>
            <span className="text-[10px] font-bold mr-1" style={{ color: tc.muted }}>פעולות מהירות:</span>
            {sel.type === 'image' && (
              <>
                <button onClick={handleRemoveBg} disabled={bgRemoving}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-50"
                  style={{ background: 'rgba(14,165,233,0.12)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.3)' }}>
                  ✂️ הסר רקע
                </button>
                <button onClick={handleBlurBg}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>
                  🌀 טשטש רקע
                </button>
                <button onClick={() => upd({ rotation: ((sel.rotation ?? 0) + 90) % 360 })}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                  ↻ סובב
                </button>
                <button onClick={() => applyPreset('vivid')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(251,191,36,0.12)', color: '#f59e0b', border: '1px solid rgba(251,191,36,0.3)' }}>
                  ✨ Vivid
                </button>
                <button onClick={() => setCompareMode(v => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: compareMode ? '#7c3aed' : 'rgba(124,58,237,0.12)', color: compareMode ? '#fff' : '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }}>
                  ◀▶ השוואה
                </button>
              </>
            )}
            <div className="flex-1" />
            <button onClick={generateCaptions} disabled={captionsLoading}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
              {captionsLoading ? '⏳...' : '🤖 כיתובים AI'}
            </button>
          </div>
        )}

        {/* Preview */}
        <div className="flex-1 relative overflow-hidden"
          style={{ cursor: draggingComp ? 'ew-resize' : draggingOvId ? 'grabbing' : 'default', background: '#0f172a' }}
          ref={previewRef}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerUp}>

          {slideMode ? (() => {
            // Presentation editing: render the live COMPOSITED slide (bg + image +
            // title + body per layout) so the user sees and edits the actual slide.
            const slide = slideMode.slides[slideMode.activeIndex];
            if (!slide) return null;
            const img = slide.imageId ? gallery.find(i => i.id === slide.imageId) : null;
            const layout = slide.layout || 'text-only';
            return (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ background: slide.bgColor || '#1e1b4b' }}>
                {img && layout === 'image-full' && <img src={img.url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />}
                <div className={`relative z-10 w-full flex items-center ${layout === 'image-right' ? 'flex-row-reverse gap-6' : layout === 'image-left' ? 'flex-row gap-6' : layout === 'image-top' ? 'flex-col gap-4' : 'flex-col justify-center'}`}>
                  {img && layout !== 'text-only' && layout !== 'image-full' && (
                    <img src={img.url} alt="" className={`object-cover rounded-xl shadow-xl flex-shrink-0 ${layout === 'image-top' ? 'w-48 h-32' : 'w-52 h-40'}`} />
                  )}
                  <div className={`${layout === 'text-only' || layout === 'image-full' ? 'text-center' : 'text-right'} space-y-3 min-w-0`}>
                    {slide.title && <h2 className="text-3xl font-black leading-tight break-words" style={{ color: slide.textColor || '#fff' }}>{slide.title}</h2>}
                    {slide.body && <p className="text-base leading-relaxed whitespace-pre-wrap break-words" style={{ color: slide.textColor || '#fff', opacity: 0.85 }}>{slide.body}</p>}
                    {!slide.title && !slide.body && <p className="text-sm" style={{ color: slide.textColor || '#fff', opacity: 0.45 }}>שקופית ריקה — הוסף כותרת וטקסט בסרגל ←</p>}
                  </div>
                </div>
              </div>
            );
          })() : !sel ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <span className="text-6xl opacity-30">🎬</span>
              <p className="text-sm font-semibold" style={{ color: '#4b5563' }}>אין מדיה — צור תמונה או וידאו עם AI</p>
            </div>
          ) : sel.type === 'image' ? (
            <div className="absolute inset-0 flex items-center justify-center select-none" style={{ userSelect: 'none' }}>
              <img src={sel.url} alt="" className="w-full h-full object-contain"
                style={{ filter: compareMode ? 'none' : filterStyle, transform: compareMode ? 'none' : transformStyle }} />
              {compareMode && (
                <>
                  <img src={sel.url} alt="" className="absolute inset-0 w-full h-full object-contain"
                    style={{ filter: filterStyle, transform: transformStyle, clipPath: `inset(0 0 0 ${comparePos}%)`, pointerEvents: 'none' }} />
                  <div className="absolute top-0 bottom-0 flex items-center justify-center"
                    style={{ left: `${comparePos}%`, width: 4, background: 'white', cursor: 'ew-resize', zIndex: 10 }}
                    onPointerDown={e => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); setDraggingComp(true); }}>
                    <div className="rounded-full w-5 h-5 flex items-center justify-center"
                      style={{ background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
                      <span style={{ fontSize: 8, color: '#333' }}>◀▶</span>
                    </div>
                  </div>
                  <div className="absolute top-2 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ left: `${Math.max(0, comparePos - 12)}%`, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>מקורי</div>
                  <div className="absolute top-2 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ left: `${Math.min(99, comparePos + 2)}%`, background: 'rgba(124,58,237,0.85)', color: '#fff' }}>ערוך</div>
                </>
              )}
              {(sel.textOverlays ?? []).map(o => (
                <div key={o.id}
                  style={{
                    position: 'absolute', left: `${o.x}%`, top: `${o.y}%`,
                    transform: 'translate(-50%,-50%)', color: o.color, fontSize: o.fontSize,
                    fontWeight: o.bold !== false ? 'bold' : 'normal',
                    fontStyle: o.italic ? 'italic' : 'normal',
                    fontFamily: o.fontFamily ?? 'Arial',
                    textShadow: o.shadow ? '0 2px 8px rgba(0,0,0,0.9)' : 'none',
                    cursor: 'grab', whiteSpace: 'nowrap', userSelect: 'none',
                    outline: draggingOvId === o.id ? '2px dashed rgba(124,58,237,0.7)' : 'none',
                  }}
                  onPointerDown={e => handleOvPointerDown(e, o)}>
                  {o.text}
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#000' }}>
              <video ref={videoRef} src={sel.url} controls playsInline preload="auto"
                onTimeUpdate={handleTimeUpdate}
                className="w-full h-full object-contain" style={{ display: 'block' }} />
              {currentSub && (
                <div className="absolute bottom-10 inset-x-0 flex justify-center pointer-events-none px-4">
                  <div className="px-3 py-1.5 rounded-lg text-white text-sm font-bold text-center"
                    style={{ background: 'rgba(0,0,0,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', maxWidth: '80%' }}>
                    {currentSub}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {aiCaptions.length > 0 && (
          <div className="flex-shrink-0 px-3 py-2 space-y-1.5" style={{ background: isDark ? '#0d1117' : '#f0f9ff', borderTop: `1px solid ${tc.border}` }}>
            <p className="text-[10px] font-bold mb-1" style={{ color: '#10b981' }}>🤖 כיתובים מוצעים</p>
            {aiCaptions.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5 cursor-pointer hover:opacity-80"
                style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#fff', border: `1px solid ${tc.border}` }}
                onClick={() => onUseCaption?.(c)}>
                <span className="text-[9px] font-bold mt-0.5 flex-shrink-0" style={{ color: '#7c3aed' }}>{i+1}</span>
                <span className="text-[10px] leading-relaxed flex-1" style={{ color: tc.text }} dir="rtl">{c}</span>
              </div>
            ))}
            <button onClick={() => setAiCaptions([])} className="text-[9px] w-full text-center mt-1" style={{ color: tc.muted }}>✕ סגור</button>
          </div>
        )}

        {/* ── Bottom action bar ───────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2"
          style={{ background: isDark ? '#161b27' : '#f1f5f9', borderTop: `1px solid ${tc.border}` }}>
          {/* Undo/Redo */}
          <button onClick={undo} disabled={!undoStack.length} title="Ctrl+Z"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm disabled:opacity-30 transition-opacity"
            style={{ background: tc.panel, color: tc.muted, border: `1px solid ${tc.border}` }}>↩</button>
          <button onClick={redo} disabled={!redoStack.length} title="Ctrl+Y"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm disabled:opacity-30 transition-opacity"
            style={{ background: tc.panel, color: tc.muted, border: `1px solid ${tc.border}` }}>↪</button>

          <div style={{ width: 1, height: 20, background: tc.border, margin: '0 4px' }} />

          {/* Save edited */}
          {sel?.type === 'image' && (
            <button onClick={handleSaveEdited} disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60 transition-opacity"
              style={{ background: saving ? '#6b7280' : 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
              {saving ? <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" /><span>שומר...</span></> : '💾 שמור'}
            </button>
          )}

          <div className="flex-1" />

          {/* Use in campaign / slide */}
          {sel && (
            <button onClick={() => onUseInCampaign(sel)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
              ✅ {useInCampaignLabel ?? 'השתמש בקמפיין'}
            </button>
          )}

          {/* Download */}
          {sel && (
            <button onClick={sel.type === 'image' ? downloadImg : downloadVid}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm text-white"
              style={{ background: '#2563eb' }} title="הורד">⬇️</button>
          )}

          {/* Delete */}
          {sel && (
            <button onClick={() => { if (window.confirm('למחוק?')) { onDeleteItem(sel.id); setSelId(null); } }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
              style={{ background: isDark ? 'rgba(239,68,68,0.15)' : '#fee2e2', color: '#dc2626' }}
              title="מחק">🗑️</button>
          )}
        </div>
      </div>

    </div>
  );
}
