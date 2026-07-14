/**
 * CampaignMediaCreator.tsx
 *
 * Step-by-step modal for creating image or video media for a campaign.
 * Supports:
 *   - Ideogram  → marketing images
 *   - Kling     → realistic / cinematic videos
 *   - Nano Banana → animated / creative videos
 *
 * The agent learns from approved/rejected media and builds better prompts
 * automatically over time using the product profile.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Image, Video, Sparkles, RefreshCw, Check, X,
  ChevronRight, ChevronLeft, Loader2, Key, AlertCircle,
  Play, Pause, Download, Zap, Info, Star, Eye,
} from 'lucide-react';
import type { WorkspaceProfile } from '../types';
import type {
  MediaType, VideoStyle, ProductProfile, ApprovedMedia, MediaKeys, GeneratedMedia,
} from '../lib/mediaGeneration';
import {
  selectVideoEngine, buildMediaPrompt, generateImage,
  startKlingVideo, pollKlingVideo, startNanoBananaVideo, pollNanoBananaVideo,
  recordApprovedMedia, recordRejectedPrompt, engineLabel,
} from '../lib/mediaGeneration';

/* ── Props ──────────────────────────────────────────────────────────────────── */
interface Props {
  open:          boolean;
  onClose:       () => void;
  onApproved:    (media: GeneratedMedia) => void;
  campaignGoal:  string;
  workspace?:    WorkspaceProfile;
  workspaceId?:  string;
  profile:       ProductProfile | null;
  onToast?:      (msg: string, type?: 'success' | 'error' | 'info') => void;
  title?:        string;   // optional override for the modal header
}

/* ── Style options ───────────────────────────────────────────────────────────── */
type MediaChoice = { type: MediaType; style: VideoStyle | 'image'; label: string; sublabel: string; engine: 'ideogram' | 'kling' | 'nano-banana'; icon: React.ElementType; color: string; emoji: string };

const MEDIA_CHOICES: MediaChoice[] = [
  {
    type: 'image', style: 'image', label: 'תמונה שיווקית', sublabel: 'Ideogram · AI image + text',
    engine: 'ideogram', icon: Image, color: '#e11d48', emoji: '🖼️',
  },
  {
    type: 'video-kling', style: 'realistic', label: 'סרטון ריאליסטי', sublabel: 'Kling · צילום חי, תאורה טבעית',
    engine: 'kling', icon: Video, color: '#7c3aed', emoji: '🎬',
  },
  {
    type: 'video-kling', style: 'cinematic', label: 'סרטון קולנועי', sublabel: 'Kling · דרמטי, קינמטוגרפי',
    engine: 'kling', icon: Video, color: '#6d28d9', emoji: '🎥',
  },
  {
    type: 'video-kling', style: 'product-showcase', label: 'הצגת מוצר', sublabel: 'Kling · מוצר בפוקוס, רקע נקי',
    engine: 'kling', icon: Video, color: '#5b21b6', emoji: '📦',
  },
  {
    type: 'video-nano', style: 'animated', label: 'סרטון אנימציה', sublabel: 'Nano Banana · גרפיקה בתנועה',
    engine: 'nano-banana', icon: Video, color: '#d97706', emoji: '✨',
  },
  {
    type: 'video-nano', style: 'social-ad', label: 'פרסומת לרשתות', sublabel: 'Nano Banana · מושך עין, ברשתות',
    engine: 'nano-banana', icon: Video, color: '#ea580c', emoji: '📱',
  },
  {
    type: 'video-nano', style: 'creative', label: 'וידאו יצירתי', sublabel: 'Nano Banana · ייחודי, בולט',
    engine: 'nano-banana', icon: Video, color: '#c2410c', emoji: '🎨',
  },
];

/* ── Key check helpers ───────────────────────────────────────────────────────── */
function keysFor(choice: MediaChoice, keys: MediaKeys): string[] {
  if (choice.engine === 'ideogram')     return keys.ideogramKey    ? [] : ['ideogramKey'];
  if (choice.engine === 'kling')        return (keys.klingAccessKey && keys.klingSecretKey) ? [] : ['klingAccessKey', 'klingSecretKey'];
  if (choice.engine === 'nano-banana')  return keys.nanoBananaKey  ? [] : ['nanoBananaKey'];
  return [];
}

const KEY_LABELS: Record<string, string> = {
  ideogramKey:      'Ideogram API Key',
  klingAccessKey:   'Kling Access Key (AK)',
  klingSecretKey:   'Kling Secret Key (SK)',
  nanoBananaKey:    'Nano Banana API Key',
  nanoBananaEndpoint: 'Nano Banana Endpoint (optional)',
};

/* ── Progress line component ─────────────────────────────────────────────────── */
function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i < step ? '#4f46e5' : '#e2e8f0' }}
        />
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Main component
 * ══════════════════════════════════════════════════════════════════════════════ */
export default function CampaignMediaCreator({
  open, onClose, onApproved, campaignGoal, workspace, workspaceId, profile, onToast,
  title = 'יצירת מדיה לקמפיין',
}: Props) {
  /* Steps: 0=choose type, 1=prompt, 2=generating, 3=preview */
  const [step,       setStep]       = useState(0);
  const [choice,     setChoice]     = useState<MediaChoice | null>(null);
  const [prompt,     setPrompt]     = useState('');
  const [buildingPrompt, setBuildingPrompt] = useState(false);
  const [media,      setMedia]      = useState<GeneratedMedia | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pollMsg,    setPollMsg]    = useState('');
  const [error,      setError]      = useState('');
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [keyValues,  setKeyValues]  = useState<Record<string, string>>({});
  const [isPlaying,  setIsPlaying]  = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pollRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve API keys from workspace + local form overrides
  const resolvedKeys: MediaKeys = {
    ideogramKey:       keyValues.ideogramKey      || workspace?.aiStudioKeys?.ideogram,
    klingAccessKey:    keyValues.klingAccessKey    || workspace?.aiStudioKeys?.klingAccessKey,
    klingSecretKey:    keyValues.klingSecretKey    || workspace?.aiStudioKeys?.klingSecretKey,
    nanoBananaKey:     keyValues.nanoBananaKey     || workspace?.aiStudioKeys?.nanoBananaKey,
    nanoBananaEndpoint:keyValues.nanoBananaEndpoint|| workspace?.aiStudioKeys?.nanoBananaEndpoint,
  };

  /* ── Reset on open ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setStep(0);
      setChoice(null);
      setPrompt('');
      setMedia(null);
      setError('');
      setMissingKeys([]);
      setGenerating(false);
      setPollMsg('');
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [open]);

  /* ── Choose media type ────────────────────────────────────────────────────── */
  const handleChoose = async (ch: MediaChoice) => {
    const missing = keysFor(ch, resolvedKeys);
    if (missing.length) {
      setMissingKeys(missing);
      setChoice(ch);
      return;
    }
    setMissingKeys([]);
    setChoice(ch);
    await advanceToPrompt(ch);
  };

  const advanceToPrompt = async (ch: MediaChoice) => {
    setStep(1);
    setBuildingPrompt(true);
    setError('');
    try {
      const p = await buildMediaPrompt(campaignGoal, ch.type, ch.style, profile);
      setPrompt(p);
    } catch {
      setPrompt('');
    } finally {
      setBuildingPrompt(false);
    }
  };

  /* ── Generate ─────────────────────────────────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!choice || !prompt.trim()) return;
    setStep(2);
    setGenerating(true);
    setError('');
    setMedia(null);
    setPollMsg('מתחיל יצירה...');

    try {
      if (choice.type === 'image') {
        // Ideogram — direct call, synchronous
        const aspect = campaignGoal.includes('סטורי') || campaignGoal.includes('story')
          ? '9:16' : '1:1';
        setPollMsg('יוצר תמונה...');
        const url = await generateImage(prompt, resolvedKeys.ideogramKey!, aspect as '1:1' | '16:9' | '9:16');
        const gen: GeneratedMedia = {
          type: 'image', url, prompt, engine: 'ideogram', generatedAt: Date.now(),
        };
        setMedia(gen);
        setStep(3);

      } else if (choice.type === 'video-kling') {
        const duration = choice.style === 'product-showcase' ? 5 : 10;
        const taskId   = await startKlingVideo(prompt, duration as 5 | 10, '16:9', 'std', resolvedKeys);
        setPollMsg('שולח ל-Kling AI...');
        // Poll until done
        await pollLoop(taskId, 'kling');

      } else {
        // Nano Banana
        const taskId = await startNanoBananaVideo(prompt, resolvedKeys);
        setPollMsg('שולח ל-Nano Banana...');
        await pollLoop(taskId, 'nano-banana');
      }
    } catch (e) {
      setError((e as Error).message || 'שגיאה ביצירה');
      setStep(1);
    } finally {
      setGenerating(false);
    }
  }, [choice, prompt, resolvedKeys, campaignGoal]);

  /* ── Polling loop ─────────────────────────────────────────────────────────── */
  const pollLoop = async (taskId: string, engine: 'kling' | 'nano-banana') => {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes at 5s intervals

    while (attempts < maxAttempts) {
      await new Promise(r => { pollRef.current = setTimeout(r, 5000); });
      attempts++;

      let status: string;
      let videoUrl: string | null;
      let thumbnailUrl: string | null = null;
      let progress = '';

      if (engine === 'kling') {
        const res = await pollKlingVideo(taskId, resolvedKeys);
        status       = res.status;
        videoUrl     = res.videoUrl;
        thumbnailUrl = res.thumbnailUrl;
        progress     = res.progress;
        setPollMsg(attempts < 6 ? 'יוצר סרטון ב-Kling AI...' :
          attempts < 20 ? 'מעבד פריימים...' : 'מסיים הרנדור...');
      } else {
        const res = await pollNanoBananaVideo(taskId, resolvedKeys);
        status   = res.status;
        videoUrl = res.videoUrl;
        progress = String(Math.round((res.progress || 0) * 100)) + '%';
        setPollMsg(`Nano Banana — ${progress}`);
      }

      const succeeded = status === 'succeed' || status === 'SUCCEEDED';
      const failed    = status === 'failed'  || status === 'FAILED';

      if (failed) throw new Error('יצירת הסרטון נכשלה. נסה שוב.');
      if (succeeded && videoUrl) {
        const gen: GeneratedMedia = {
          type:         choice!.type,
          url:          videoUrl,
          thumbnailUrl: thumbnailUrl ?? undefined,
          prompt,
          engine,
          taskId,
          generatedAt:  Date.now(),
        };
        setMedia(gen);
        setStep(3);
        return;
      }
    }
    throw new Error('הסרטון לקח יותר מדי זמן. נסה שוב.');
  };

  /* ── Approve ──────────────────────────────────────────────────────────────── */
  const handleApprove = async () => {
    if (!media || !choice) return;
    if (workspaceId) {
      const approved: ApprovedMedia = {
        id:        `media_${Date.now()}`,
        type:      media.type,
        url:       media.url,
        thumbnailUrl: media.thumbnailUrl,
        prompt:    media.prompt,
        style:     choice.style,
        engine:    media.engine,
        approvedAt: Date.now(),
      };
      await recordApprovedMedia(workspaceId, approved).catch(() => {});
    }
    onApproved(media);
    onClose();
    onToast?.('מדיה אושרה ונשמרה! 🎉', 'success');
  };

  /* ── Reject / try again ───────────────────────────────────────────────────── */
  const handleReject = async () => {
    if (workspaceId && prompt) {
      await recordRejectedPrompt(workspaceId, prompt).catch(() => {});
    }
    // Go back to prompt edit
    setMedia(null);
    setStep(1);
    onToast?.('נסה לשנות את הפרומפט וצור שוב', 'info');
  };

  /* ── Key entry form ───────────────────────────────────────────────────────── */
  const handleKeysSave = async () => {
    if (!choice) return;
    const stillMissing = keysFor(choice, resolvedKeys);
    if (stillMissing.length) {
      onToast?.('יש למלא את כל המפתחות', 'error');
      return;
    }
    setMissingKeys([]);
    await advanceToPrompt(choice);
  };

  if (!open) return null;

  /* ══════════════════════════════════════════════════════════════════════════
   * Render
   * ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Sparkles size={15} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-white text-sm">{title}</h2>
              <p className="text-[10px] text-slate-400">
                {step === 0 ? 'בחר סוג מדיה' : step === 1 ? 'עריכת פרומפט' : step === 2 ? 'יצירה...' : 'תצוגה מקדימה'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-3 pb-1">
          <StepBar step={step + 1} total={4} />
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ── Step 0: Choose media type ──────────────────────────────────── */}
          {step === 0 && !missingKeys.length && (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                מטרת הקמפיין: <span className="font-semibold text-slate-700 dark:text-slate-200">{campaignGoal || '—'}</span>
              </p>
              <div className="grid grid-cols-1 gap-2">
                {MEDIA_CHOICES.map((ch, i) => (
                  <button
                    key={i}
                    onClick={() => handleChoose(ch)}
                    className="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all text-right"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                      style={{ background: ch.color + '18' }}
                    >
                      {ch.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{ch.label}</p>
                      <p className="text-xs text-slate-400">{ch.sublabel}</p>
                    </div>
                    <ChevronLeft size={14} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step 0: Missing keys form ─────────────────────────────────── */}
          {step === 0 && missingKeys.length > 0 && choice && (
            <>
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-2">
                <Key size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">נדרש מפתח API עבור {engineLabel(choice.engine)}</p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">הזן את המפתחות כדי להמשיך. הם יישמרו בהגדרות הסביבה.</p>
                </div>
              </div>
              <div className="space-y-3">
                {missingKeys.map(k => (
                  <div key={k}>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{KEY_LABELS[k] || k}</label>
                    <input
                      type={k.includes('Secret') || k.includes('Key') ? 'password' : 'text'}
                      value={keyValues[k] || ''}
                      onChange={e => setKeyValues(v => ({ ...v, [k]: e.target.value }))}
                      className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
                      placeholder={`הכנס ${KEY_LABELS[k] || k}...`}
                      dir="ltr"
                    />
                  </div>
                ))}

                {/* Links to get keys */}
                {choice.engine === 'kling' && (
                  <a href="https://klingai.com/developer" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                    <ChevronLeft size={11} />
                    השג מפתחות Kling באתר הפיתוח
                  </a>
                )}
                {choice.engine === 'nano-banana' && (
                  <a href="https://dev.runwayml.com" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                    <ChevronLeft size={11} />
                    השג מפתח Nano Banana / Runway
                  </a>
                )}
                {choice.engine === 'ideogram' && (
                  <a href="https://ideogram.ai/manage-api" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:underline flex items-center gap-1">
                    <ChevronLeft size={11} />
                    השג מפתח Ideogram
                  </a>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setMissingKeys([]); setChoice(null); }}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  חזור
                </button>
                <button
                  onClick={handleKeysSave}
                  disabled={missingKeys.some(k => !keyValues[k]?.trim())}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40 transition-colors"
                  style={{ background: '#4f46e5' }}
                >
                  המשך
                </button>
              </div>
            </>
          )}

          {/* ── Step 1: Prompt editor ─────────────────────────────────────── */}
          {step === 1 && (
            <>
              {choice && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-700">
                  <span className="text-lg">{choice.emoji}</span>
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{choice.label}</p>
                    <p className="text-[10px] text-slate-400">{choice.sublabel}</p>
                  </div>
                </div>
              )}

              {buildingPrompt ? (
                <div className="flex items-center gap-2 py-4 text-indigo-500">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-sm">הסוכן בונה פרומפט מותאם למוצר שלך...</span>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <button
                        onClick={async () => {
                          if (!choice) return;
                          setBuildingPrompt(true);
                          const p = await buildMediaPrompt(campaignGoal, choice.type, choice.style, profile).catch(() => prompt);
                          setPrompt(p);
                          setBuildingPrompt(false);
                        }}
                        className="text-xs text-indigo-500 hover:underline flex items-center gap-1"
                      >
                        <RefreshCw size={10} />
                        צור פרומפט חדש
                      </button>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                        פרומפט יצירה (אנגלית)
                      </label>
                    </div>
                    <textarea
                      rows={5}
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      className="w-full text-sm rounded-2xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
                      dir="ltr"
                      placeholder="Describe the visual content in English..."
                    />
                    <p className="text-[10px] text-slate-400 mt-1 text-left">{prompt.length} / 400 תווים</p>
                  </div>

                  {/* Product profile context shown */}
                  {profile?.productName && (
                    <div className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-3 flex items-start gap-2">
                      <Star size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">מבוסס על פרופיל המוצר</p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                          {profile.productName} · {profile.approvedMedia.length} מדיות מאושרות ← הסוכן לומד את הטעם שלך!
                        </p>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                      <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setStep(0); setError(''); }}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <ChevronRight size={12} />
                  חזור
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || buildingPrompt}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  <Zap size={13} />
                  צור עכשיו
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Generating ───────────────────────────────────────────── */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <div
                className="w-20 h-20 rounded-3xl flex items-center justify-center relative"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
              >
                <Sparkles size={36} className="text-white animate-pulse" />
              </div>
              <div>
                <p className="font-bold text-slate-800 dark:text-white text-base">יוצר מדיה...</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{pollMsg}</p>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 animate-pulse"
                  style={{ width: '60%' }}
                />
              </div>
              <p className="text-xs text-slate-400">
                {choice?.type === 'image'
                  ? 'תמונה AI נוצרת — כ-10 שניות'
                  : 'וידאו AI נוצר — עד 5 דקות, אנחנו מסקנים 😊'}
              </p>
            </div>
          )}

          {/* ── Step 3: Preview & approve ─────────────────────────────────── */}
          {step === 3 && media && (
            <>
              {/* Media preview */}
              <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 relative group">
                {media.type === 'image' ? (
                  <img
                    src={media.url}
                    alt="תוצאה"
                    className="w-full object-contain max-h-64"
                  />
                ) : (
                  <div className="relative">
                    <video
                      ref={videoRef}
                      src={media.url}
                      poster={media.thumbnailUrl}
                      className="w-full max-h-64 object-contain"
                      loop
                      playsInline
                    />
                    <button
                      onClick={() => {
                        if (!videoRef.current) return;
                        if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); }
                        else { videoRef.current.play(); setIsPlaying(true); }
                      }}
                      className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                        {isPlaying ? <Pause size={20} className="text-slate-800" /> : <Play size={20} className="text-slate-800 mr-0.5" />}
                      </div>
                    </button>
                  </div>
                )}

                {/* Download button */}
                <a
                  href={media.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Download size={13} />
                </a>
              </div>

              {/* Engine badge + prompt */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-mono truncate flex-1">{media.prompt.slice(0, 80)}...</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 font-medium flex-shrink-0 mr-2">
                    {engineLabel(media.engine)}
                  </span>
                </div>
              </div>

              {/* Info about learning */}
              <div className="rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-3 flex items-start gap-2">
                <Info size={12} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  אם תאשר, הסוכן ישמור את הסגנון הזה ויעשה קמפיינים דומים בעתיד אוטומטית.
                </p>
              </div>

              {/* Approve / Reject */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleReject}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center gap-2 transition-colors"
                >
                  <X size={13} />
                  לא מתאים, צור שוב
                </button>
                <button
                  onClick={handleApprove}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all"
                  style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}
                >
                  <Check size={13} />
                  אשר ושמור!
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
