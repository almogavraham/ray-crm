import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, Volume2, Image, Search, Users, Calendar,
  Key, Loader2, Download, Trash2, Play, Pause,
  CheckCircle, AlertCircle, Copy, Check, X,
  Zap, Clock, CreditCard, ChevronRight, Sparkles,
  RefreshCw, ExternalLink,
} from 'lucide-react';
import type { WorkspaceProfile } from '../types';
import { db } from '../lib/firebase';
import { doc, collection, setDoc, onSnapshot, deleteDoc, updateDoc } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface AiStudioProps {
  workspace?: WorkspaceProfile;
  currentUser?: string;
  onNavigateToBilling?: () => void;
  onToast?: (msg: string, type?: string) => void;
}

/* ─── Types ──────────────────────────────────────────────────────────────── */
type ToolStatus = 'coming_soon' | 'needs_key' | 'ready';
type ToolId = 'kling' | 'elevenlabs' | 'ideogram' | 'hunter' | 'heygen' | 'buffer';

interface StudioTool {
  id: ToolId;
  name: string;
  nameHe: string;
  description: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  status: ToolStatus;
  creditCost: number;
  creditUnit: string;
}

interface AiStudioKeys {
  elevenlabs?: string;
  hunter?: string;
  ideogram?: string;
}

interface StudioCreation {
  id: string;
  tool: ToolId;
  type: 'audio' | 'image' | 'text' | 'lead';
  url?: string;
  content?: string;
  prompt: string;
  createdAt: string;
  creditsUsed: number;
  metadata?: Record<string, string>;
}

interface HunterResult {
  email: string;
  score: number;
  sources?: { uri: string }[];
  linkedin?: string;
}

/* ─── Constants ──────────────────────────────────────────────────────────── */
const VOICE_IDS: Record<string, string> = {
  'Rachel':        '21m00Tcm4TlvDq8ikWAM',
  'Adam':          'pNInz6obpgDQGcFmaJgB',
  'Antoni':        'ErXwobaYiN019PkySvjV',
  'Bella':         'EXAVITQu4vr4xnSDxMaL',
  'Oren (עברית)':  'dDmMDMHkK2IqKHhfPG1n',
  'Dalia (עברית)': 'XB0fDUnXU5powFXDhCwa',
};

const IDEOGRAM_ASPECT_MAP: Record<string, string> = {
  '1:1':  'ASPECT_1_1',
  '16:9': 'ASPECT_16_9',
  '9:16': 'ASPECT_9_16',
};

const TOOLS: StudioTool[] = [
  {
    id: 'kling',
    name: 'Kling Video',
    nameHe: 'יוצר וידאו AI',
    description: 'צור סרטוני AI מטקסט — ריאליסטי, קולנועי, אנימציה',
    icon: Video,
    color: '#7c3aed',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
    status: 'coming_soon',
    creditCost: 50,
    creditUnit: 'לכל 5 שניות',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    nameHe: 'יוצר קול AI',
    description: 'המרת טקסט לקול טבעי — עברית ואנגלית',
    icon: Volume2,
    color: '#0ea5e9',
    gradient: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
    status: 'needs_key',
    creditCost: 5,
    creditUnit: 'לכל 1,000 תווים',
  },
  {
    id: 'ideogram',
    name: 'Ideogram',
    nameHe: 'יוצר תמונות עם טקסט',
    description: 'תמונות AI עם טקסט עברי/אנגלי — לוגואים, פוסטים, מודעות',
    icon: Image,
    color: '#e11d48',
    gradient: 'linear-gradient(135deg, #e11d48 0%, #9f1239 100%)',
    status: 'needs_key',
    creditCost: 10,
    creditUnit: 'לכל תמונה',
  },
  {
    id: 'hunter',
    name: 'Hunter.io',
    nameHe: 'מאתר מיילים ופרטי ליד',
    description: 'מצא כתובת אימייל של כל איש קשר לפי שם וחברה',
    icon: Search,
    color: '#d97706',
    gradient: 'linear-gradient(135deg, #d97706 0%, #92400e 100%)',
    status: 'needs_key',
    creditCost: 5,
    creditUnit: 'לכל חיפוש',
  },
  {
    id: 'heygen',
    name: 'HeyGen',
    nameHe: 'אווטאר מדבר',
    description: 'צור סרטון עם אווטאר AI דובר — לשיווק ומכירות',
    icon: Users,
    color: '#059669',
    gradient: 'linear-gradient(135deg, #059669 0%, #064e3b 100%)',
    status: 'coming_soon',
    creditCost: 100,
    creditUnit: 'לכל דקה',
  },
  {
    id: 'buffer',
    name: 'Buffer',
    nameHe: 'תזמון פוסטים',
    description: 'תזמן פוסטים לכל הרשתות החברתיות אוטומטית',
    icon: Calendar,
    color: '#4338ca',
    gradient: 'linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)',
    status: 'coming_soon',
    creditCost: 2,
    creditUnit: 'לכל פוסט מתוזמן',
  },
];

/* ─── Sub-components ─────────────────────────────────────────────────────── */

/** Reusable label + input wrapper */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>{label}</label>
      {children}
    </div>
  );
}

/** Credits deducted pill */
function CreditPill({ cost, unit, color }: { cost: number; unit: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: color + '22', color }}
    >
      <Zap size={10} />
      {cost} קרדיטים {unit}
    </span>
  );
}

/* ── Tool Card ────────────────────────────────────────────────────────────── */
interface ToolCardProps {
  tool: StudioTool;
  isActive: boolean;
  apiKeys: AiStudioKeys;
  onClick: () => void;
}

function ToolCard({ tool, isActive, apiKeys, onClick }: ToolCardProps) {
  const { c } = useTheme();
  const Icon = tool.icon;

  const resolvedStatus: ToolStatus = (() => {
    if (tool.status === 'coming_soon') return 'coming_soon';
    if (tool.id === 'elevenlabs') return apiKeys.elevenlabs ? 'ready' : 'needs_key';
    if (tool.id === 'ideogram')   return apiKeys.ideogram   ? 'ready' : 'needs_key';
    if (tool.id === 'hunter')     return apiKeys.hunter     ? 'ready' : 'needs_key';
    return 'needs_key';
  })();

  const statusLabel =
    resolvedStatus === 'coming_soon' ? 'בקרוב' :
    resolvedStatus === 'needs_key'   ? 'נדרש מפתח' :
    'פעיל';

  const statusColor =
    resolvedStatus === 'coming_soon' ? '#64748b' :
    resolvedStatus === 'needs_key'   ? '#f59e0b' :
    '#10b981';

  return (
    <button
      onClick={onClick}
      className="relative flex flex-col gap-3 p-4 rounded-2xl border text-right transition-all duration-200"
      style={{
        background: isActive ? tool.color + '15' : c.cardBg,
        borderColor: isActive ? tool.color + '60' : c.cardBorder,
        boxShadow: isActive ? `0 0 20px ${tool.color}25` : 'none',
        cursor: resolvedStatus === 'coming_soon' ? 'default' : 'pointer',
        opacity: resolvedStatus === 'coming_soon' ? 0.8 : 1,
      }}
    >
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: tool.gradient }}
      >
        <Icon size={20} color="white" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: statusColor + '22', color: statusColor }}
          >
            {statusLabel}
          </span>
          <span className="text-sm font-bold truncate" style={{ color: c.textPrimary }}>
            {tool.nameHe}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-right" style={{ color: c.textMuted }}>
          {tool.description}
        </p>
      </div>

      {/* Cost */}
      <CreditPill cost={tool.creditCost} unit={tool.creditUnit} color={tool.color} />

      {/* Active chevron */}
      {isActive && (
        <div
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: tool.color }}
        >
          <ChevronRight size={16} />
        </div>
      )}
    </button>
  );
}

/* ── Key Setup ────────────────────────────────────────────────────────────── */
interface KeySetupProps {
  toolId: 'elevenlabs' | 'ideogram' | 'hunter';
  workspaceId: string;
  onSaved: () => void;
  onToast?: (msg: string, type?: string) => void;
}

const KEY_INSTRUCTIONS: Record<string, { url: string; steps: string[] }> = {
  elevenlabs: {
    url: 'https://elevenlabs.io',
    steps: [
      'היכנס ל-elevenlabs.io',
      'לך ל-Profile → API Keys',
      'צור מפתח חדש והכנס כאן:',
    ],
  },
  ideogram: {
    url: 'https://ideogram.ai',
    steps: [
      'היכנס ל-ideogram.ai',
      'לך ל-Account → API',
      'צור מפתח API חדש והכנס כאן:',
    ],
  },
  hunter: {
    url: 'https://hunter.io',
    steps: [
      'היכנס ל-hunter.io',
      'לך ל-API → Your API Key',
      'העתק את המפתח שלך והכנס כאן:',
    ],
  },
};

function KeySetup({ toolId, workspaceId, onSaved, onToast }: KeySetupProps) {
  const { c, isDark } = useTheme();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const instructions = KEY_INSTRUCTIONS[toolId];

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspaceId), {
        [`aiStudioKeys.${toolId}`]: value.trim(),
      });
      onToast?.('מפתח API נשמר בהצלחה ✓', 'success');
      onSaved();
    } catch (err) {
      console.error(err);
      onToast?.('שגיאה בשמירת המפתח', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-2xl border p-5 space-y-4"
      style={{ background: c.subtleBg, borderColor: c.cardBorder }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 justify-end">
        <span className="text-base font-bold" style={{ color: c.textPrimary }}>
          הגדרת API Key — {toolId === 'elevenlabs' ? 'ElevenLabs' : toolId === 'ideogram' ? 'Ideogram' : 'Hunter.io'}
        </span>
        <Key size={18} style={{ color: c.accentText }} />
      </div>

      {/* Steps */}
      <ol className="space-y-1 text-right list-none">
        {instructions.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 justify-end text-sm" style={{ color: c.textSecondary }}>
            <span>{step}</span>
            <span
              className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
              style={{ background: c.accentBg, color: c.accentText }}
            >
              {i + 1}
            </span>
          </li>
        ))}
      </ol>

      {/* Link */}
      <a
        href={instructions.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium"
        style={{ color: c.accentText }}
      >
        <ExternalLink size={13} />
        פתח {instructions.url}
      </a>

      {/* Input + Save */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="flex items-center gap-1 px-4 py-2 rounded-xl font-medium text-sm transition-colors flex-shrink-0"
          style={{
            background: value.trim() && !saving ? c.accentBg : isDark ? '#1e2a3a' : '#e2e8f0',
            color: value.trim() && !saving ? c.accentText : c.textMuted,
            cursor: value.trim() && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          שמור
        </button>
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="הכנס את המפתח כאן..."
          dir="ltr"
          className="flex-1 rounded-xl px-3 py-2 text-sm outline-none border"
          style={{
            background: c.inputBg,
            color: c.inputText,
            borderColor: c.inputBorder,
          }}
        />
      </div>

      {/* Security note */}
      <p className="text-xs text-right" style={{ color: c.textMuted }}>
        🔒 המפתח נשמר בצורה מאובטחת ב-Firestore ומשויך לסביבת העבודה שלך בלבד
      </p>
    </div>
  );
}

/* ── Coming Soon Panel ────────────────────────────────────────────────────── */
function ComingSoonPanel({ tool }: { tool: StudioTool }) {
  const { c } = useTheme();
  const Icon = tool.icon;

  const extraNote =
    tool.id === 'kling'
      ? 'Kling API מוכנה — בקרוב נוסיף Cloud Function לתמיכה מלאה'
      : tool.id === 'heygen'
      ? 'HeyGen API מוכנה — בקרוב נוסיף ממשק יצירת אווטאר מדבר'
      : 'הכלי בפיתוח — יהיה זמין בקרוב';

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-16 px-6 text-center">
      {/* Animated icon */}
      <div
        className="w-24 h-24 rounded-3xl flex items-center justify-center relative"
        style={{ background: tool.gradient, boxShadow: `0 0 40px ${tool.color}40` }}
      >
        <Icon size={44} color="white" />
        <span
          className="absolute -top-2 -right-2 text-xl animate-bounce"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
        >
          🚀
        </span>
      </div>

      {/* Title */}
      <div>
        <h3 className="text-2xl font-black mb-2" style={{ color: '#fff' }}>
          {tool.nameHe}
        </h3>
        <p className="text-lg font-semibold mb-1" style={{ color: tool.color }}>
          בקרוב...
        </p>
        <p className="text-sm max-w-xs mx-auto" style={{ color: c.textMuted }}>
          {tool.description}
        </p>
      </div>

      {/* Technical note */}
      <div
        className="rounded-2xl border px-5 py-4 max-w-sm text-sm"
        style={{ background: tool.color + '10', borderColor: tool.color + '30', color: c.textSecondary }}
      >
        <span className="text-base mr-1">⚙️</span>
        {extraNote}
      </div>

      {/* Cost preview */}
      <CreditPill cost={tool.creditCost} unit={tool.creditUnit} color={tool.color} />
    </div>
  );
}

/* ── ElevenLabs Panel ─────────────────────────────────────────────────────── */
interface ElevenLabsPanelProps {
  apiKey: string;
  credits: number;
  workspaceId: string;
  onDeductCredits: (amount: number) => Promise<void>;
  onSaveCreation: (c: Omit<StudioCreation, 'id'>) => Promise<void>;
  onToast?: (msg: string, type?: string) => void;
}

function ElevenLabsPanel({ apiKey, credits, workspaceId, onDeductCredits, onSaveCreation, onToast }: ElevenLabsPanelProps) {
  const { c, isDark } = useTheme();
  const COST_PER_1K = 5;

  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Rachel');
  const [stability, setStability] = useState(50);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const charCount = text.length;
  const estimatedCredits = Math.max(1, Math.ceil(charCount / 1000) * COST_PER_1K);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    if (credits < estimatedCredits) {
      setError('אין מספיק קרדיטים לפעולה זו');
      return;
    }
    setLoading(true);
    setError('');
    setAudioUrl(null);
    try {
      const voiceId = VOICE_IDS[voice] ?? VOICE_IDS['Rachel'];
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: stability / 100, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      await onDeductCredits(estimatedCredits);
      await onSaveCreation({
        tool: 'elevenlabs',
        type: 'audio',
        url,
        prompt: text.slice(0, 200),
        createdAt: new Date().toISOString(),
        creditsUsed: estimatedCredits,
        metadata: { voice },
      });
      onToast?.('הקול נוצר בהצלחה ✓', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setError(`שגיאה: ${msg.slice(0, 120)}`);
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `voice_${Date.now()}.mp3`;
    a.click();
  };

  const inputStyle = {
    background: c.inputBg,
    color: c.inputText,
    borderColor: c.inputBorder,
  };

  return (
    <div className="space-y-4 p-1">
      {/* Text area */}
      <FieldRow label="טקסט להמרה (מקסימום 2,500 תווים)">
        <div className="relative">
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, 2500))}
            placeholder="הכנס את הטקסט שתרצה להמיר לקול..."
            rows={5}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border resize-none text-right"
            style={inputStyle}
            dir="auto"
          />
          <span
            className="absolute bottom-2 left-3 text-xs"
            style={{ color: charCount > 2200 ? '#ef4444' : c.textMuted }}
          >
            {charCount.toLocaleString()} / 2,500
          </span>
        </div>
      </FieldRow>

      {/* Voice */}
      <FieldRow label="קול">
        <select
          value={voice}
          onChange={e => setVoice(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm outline-none border"
          style={inputStyle}
        >
          {Object.keys(VOICE_IDS).map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </FieldRow>

      {/* Stability */}
      <FieldRow label={`יציבות קול: ${stability}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={stability}
          onChange={e => setStability(Number(e.target.value))}
          className="w-full accent-sky-500"
        />
        <div className="flex justify-between text-xs" style={{ color: c.textMuted }}>
          <span>מגוון (0)</span>
          <span>יציב (100)</span>
        </div>
      </FieldRow>

      {/* Cost estimate */}
      {charCount > 0 && (
        <div
          className="flex items-center justify-between text-xs rounded-xl p-3"
          style={{ background: isDark ? 'rgba(14,165,233,0.1)' : '#e0f2fe', color: '#0369a1' }}
        >
          <span className="font-semibold">עלות משוערת: {estimatedCredits} קרדיטים</span>
          <span>יתרה: {credits} קרדיטים</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-sm text-right" style={{ color: '#ef4444' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!text.trim() || loading || credits < estimatedCredits}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
        style={{
          background: text.trim() && !loading ? 'linear-gradient(135deg,#0ea5e9,#0369a1)' : isDark ? '#1e2a3a' : '#e2e8f0',
          color: text.trim() && !loading ? 'white' : c.textMuted,
          cursor: text.trim() && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
        {loading ? 'יוצר קול...' : 'צור קול AI'}
      </button>

      {/* Audio result */}
      {audioUrl && (
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: isDark ? 'rgba(14,165,233,0.08)' : '#e0f2fe', borderColor: '#0ea5e9' + '40' }}
        >
          <div className="flex items-center justify-between">
            <button onClick={handleDownload} className="flex items-center gap-1 text-sm font-medium" style={{ color: '#0ea5e9' }}>
              <Download size={14} />
              הורד MP3
            </button>
            <div className="flex items-center gap-2">
              <CheckCircle size={16} style={{ color: '#10b981' }} />
              <span className="text-sm font-semibold" style={{ color: c.textPrimary }}>הקול מוכן!</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#0ea5e9', color: 'white' }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="flex-1 h-2 rounded-full" style={{ background: isDark ? '#1e3a4a' : '#bae6fd' }}>
              <div className="h-2 rounded-full w-0 transition-all" style={{ background: '#0ea5e9' }} />
            </div>
          </div>
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}

/* ── Ideogram Panel ───────────────────────────────────────────────────────── */
interface IdeogramPanelProps {
  apiKey: string;
  credits: number;
  onDeductCredits: (amount: number) => Promise<void>;
  onSaveCreation: (c: Omit<StudioCreation, 'id'>) => Promise<void>;
  onToast?: (msg: string, type?: string) => void;
}

function IdeogramPanel({ apiKey, credits, onDeductCredits, onSaveCreation, onToast }: IdeogramPanelProps) {
  const { c, isDark } = useTheme();
  const COST = 10;

  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('DESIGN');
  const [aspect, setAspect] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (credits < COST) {
      setError('אין מספיק קרדיטים');
      return;
    }
    setLoading(true);
    setError('');
    setImageUrl(null);
    try {
      const res = await fetch('https://api.ideogram.ai/generate', {
        method: 'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_request: {
            prompt,
            model: 'V_2',
            aspect_ratio: IDEOGRAM_ASPECT_MAP[aspect],
            style_type: style,
            magic_prompt_option: 'AUTO',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? JSON.stringify(data));
      const url = data.data?.[0]?.url;
      if (!url) throw new Error('לא התקבלה תמונה בתשובה');
      setImageUrl(url);
      await onDeductCredits(COST);
      await onSaveCreation({
        tool: 'ideogram',
        type: 'image',
        url,
        prompt: prompt.slice(0, 200),
        createdAt: new Date().toISOString(),
        creditsUsed: COST,
        metadata: { style, aspect },
      });
      onToast?.('התמונה נוצרה בהצלחה ✓', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setError(`שגיאה: ${msg.slice(0, 150)}`);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { background: c.inputBg, color: c.inputText, borderColor: c.inputBorder };

  const STYLES = ['DESIGN', 'REALISTIC', 'RENDER_3D', 'ANIME'];
  const ASPECTS = ['1:1', '16:9', '9:16'];

  return (
    <div className="space-y-4 p-1">
      {/* Prompt */}
      <FieldRow label="תיאור התמונה (אנגלית / עברית)">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder='למשל: "A modern logo for a digital marketing agency in Israel with Hebrew text"'
          rows={4}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border resize-none"
          style={{ ...inputStyle, textAlign: 'right' }}
          dir="auto"
        />
      </FieldRow>

      {/* Style */}
      <FieldRow label="סגנון">
        <div className="grid grid-cols-4 gap-2">
          {STYLES.map(s => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className="py-2 rounded-xl text-xs font-medium border transition-all"
              style={{
                background: style === s ? '#e11d4820' : c.subtleBg,
                borderColor: style === s ? '#e11d48' : c.cardBorder,
                color: style === s ? '#e11d48' : c.textSecondary,
              }}
            >
              {s === 'DESIGN' ? 'עיצוב' : s === 'REALISTIC' ? 'ריאלי' : s === 'RENDER_3D' ? '3D' : 'אנימה'}
            </button>
          ))}
        </div>
      </FieldRow>

      {/* Aspect ratio */}
      <FieldRow label="יחס גובה-רוחב">
        <div className="grid grid-cols-3 gap-2">
          {ASPECTS.map(a => (
            <button
              key={a}
              onClick={() => setAspect(a)}
              className="py-2 rounded-xl text-xs font-medium border transition-all"
              style={{
                background: aspect === a ? '#e11d4820' : c.subtleBg,
                borderColor: aspect === a ? '#e11d48' : c.cardBorder,
                color: aspect === a ? '#e11d48' : c.textSecondary,
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </FieldRow>

      {/* Credits */}
      <div
        className="flex items-center justify-between text-xs rounded-xl p-3"
        style={{ background: isDark ? '#e11d4810' : '#fff1f2', color: '#9f1239' }}
      >
        <span>יתרה: {credits} קרדיטים</span>
        <span className="font-semibold">עלות: {COST} קרדיטים לתמונה</span>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-sm" style={{ color: '#ef4444' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Generate */}
      <button
        onClick={handleGenerate}
        disabled={!prompt.trim() || loading || credits < COST}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
        style={{
          background: prompt.trim() && !loading ? 'linear-gradient(135deg,#e11d48,#9f1239)' : isDark ? '#1e2a3a' : '#e2e8f0',
          color: prompt.trim() && !loading ? 'white' : c.textMuted,
          cursor: prompt.trim() && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Image size={16} />}
        {loading ? 'יוצר תמונה...' : 'צור תמונה AI'}
      </button>

      {/* Result */}
      {imageUrl && (
        <div className="rounded-2xl overflow-hidden border" style={{ borderColor: '#e11d4840' }}>
          <img src={imageUrl} alt="Generated" className="w-full object-cover" style={{ maxHeight: 320 }} />
          <div
            className="flex items-center justify-between p-3"
            style={{ background: isDark ? '#1a0a12' : '#fff1f2' }}
          >
            <div className="flex gap-2">
              <a
                href={imageUrl}
                download={`image_${Date.now()}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-medium"
                style={{ color: '#e11d48' }}
              >
                <Download size={14} />
                הורד
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(imageUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="flex items-center gap-1 text-sm font-medium"
                style={{ color: copied ? '#10b981' : '#e11d48' }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'הועתק' : 'העתק URL'}
              </button>
            </div>
            <CheckCircle size={16} style={{ color: '#10b981' }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Hunter Panel ─────────────────────────────────────────────────────────── */
interface HunterPanelProps {
  apiKey: string;
  credits: number;
  onDeductCredits: (amount: number) => Promise<void>;
  onSaveCreation: (c: Omit<StudioCreation, 'id'>) => Promise<void>;
  onToast?: (msg: string, type?: string) => void;
}

function HunterPanel({ apiKey, credits, onDeductCredits, onSaveCreation, onToast }: HunterPanelProps) {
  const { c, isDark } = useTheme();
  const COST = 5;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [domain, setDomain]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<HunterResult | null>(null);
  const [error, setError]         = useState('');
  const [copied, setCopied]       = useState(false);

  const handleSearch = async () => {
    if (!firstName.trim() || !lastName.trim() || !domain.trim()) return;
    if (credits < COST) {
      setError('אין מספיק קרדיטים');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.errors?.length) {
        throw new Error(data.errors?.[0]?.details ?? 'שגיאה בחיפוש');
      }
      const d = data.data;
      setResult({
        email: d.email ?? '',
        score: d.score ?? 0,
        sources: d.sources ?? [],
        linkedin: d.linkedin ?? '',
      });
      await onDeductCredits(COST);
      await onSaveCreation({
        tool: 'hunter',
        type: 'lead',
        content: d.email,
        prompt: `${firstName} ${lastName} @ ${domain}`,
        createdAt: new Date().toISOString(),
        creditsUsed: COST,
        metadata: { email: d.email, score: String(d.score) },
      });
      onToast?.('נמצאה כתובת מייל ✓', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setError(`שגיאה: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { background: c.inputBg, color: c.inputText, borderColor: c.inputBorder };

  return (
    <div className="space-y-4 p-1">
      {/* Fields */}
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="שם פרטי">
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder='Almog'
            dir="ltr"
            className="rounded-xl px-3 py-2 text-sm outline-none border"
            style={inputStyle}
          />
        </FieldRow>
        <FieldRow label="שם משפחה">
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder='Avraham'
            dir="ltr"
            className="rounded-xl px-3 py-2 text-sm outline-none border"
            style={inputStyle}
          />
        </FieldRow>
      </div>

      <FieldRow label="דומיין / חברה">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder='example.com'
          dir="ltr"
          className="rounded-xl px-3 py-2 text-sm outline-none border"
          style={inputStyle}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
      </FieldRow>

      {/* Credits */}
      <div
        className="flex items-center justify-between text-xs rounded-xl p-3"
        style={{ background: isDark ? '#d9770610' : '#fffbeb', color: '#92400e' }}
      >
        <span>יתרה: {credits} קרדיטים</span>
        <span className="font-semibold">עלות: {COST} קרדיטים לחיפוש</span>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-sm" style={{ color: '#ef4444' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search button */}
      <button
        onClick={handleSearch}
        disabled={!firstName.trim() || !lastName.trim() || !domain.trim() || loading || credits < COST}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
        style={{
          background: firstName.trim() && lastName.trim() && domain.trim() && !loading
            ? 'linear-gradient(135deg,#d97706,#92400e)'
            : isDark ? '#1e2a3a' : '#e2e8f0',
          color: firstName.trim() && !loading ? 'white' : c.textMuted,
          cursor: firstName.trim() && !loading ? 'pointer' : 'not-allowed',
        }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        {loading ? 'מחפש...' : 'חפש מייל'}
      </button>

      {/* Result */}
      {result && (
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ background: isDark ? '#d9770608' : '#fffbeb', borderColor: '#d97706' + '40' }}
        >
          {/* Email */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(result.email); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="flex items-center gap-1 text-sm font-medium flex-shrink-0"
              style={{ color: copied ? '#10b981' : '#d97706' }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'הועתק' : 'העתק'}
            </button>
            <div className="text-left">
              <p className="font-mono text-sm font-bold" style={{ color: c.textPrimary, direction: 'ltr' }}>
                {result.email || 'לא נמצא מייל'}
              </p>
            </div>
          </div>

          {/* Score */}
          {result.email && (
            <div className="flex items-center justify-between text-sm">
              <div
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                style={{
                  background: result.score > 70 ? '#10b98120' : result.score > 40 ? '#f59e0b20' : '#ef444420',
                  color: result.score > 70 ? '#10b981' : result.score > 40 ? '#f59e0b' : '#ef4444',
                }}
              >
                ציון אמינות: {result.score}%
              </div>
              {result.linkedin && (
                <a
                  href={result.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: '#0ea5e9' }}
                >
                  <ExternalLink size={12} />
                  LinkedIn
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Creations Gallery ────────────────────────────────────────────────────── */
interface CreationsGalleryProps {
  workspaceId: string;
  creations: StudioCreation[];
  onDelete: (id: string) => void;
}

function CreationsGallery({ creations, onDelete }: CreationsGalleryProps) {
  const { c, isDark } = useTheme();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  const toolMeta: Record<ToolId, { color: string; label: string }> = {
    kling:       { color: '#7c3aed', label: '🎬 וידאו' },
    elevenlabs:  { color: '#0ea5e9', label: '🔊 קול' },
    ideogram:    { color: '#e11d48', label: '🎨 תמונה' },
    hunter:      { color: '#d97706', label: '🔍 ליד' },
    heygen:      { color: '#059669', label: '🤖 אווטאר' },
    buffer:      { color: '#4338ca', label: '📅 פוסט' },
  };

  if (creations.length === 0) {
    return (
      <div
        className="rounded-2xl border p-8 text-center"
        style={{ background: c.subtleBg, borderColor: c.cardBorder }}
      >
        <div className="text-4xl mb-3">🎬</div>
        <p className="text-sm" style={{ color: c.textMuted }}>
          היצירות שלך יופיעו כאן לאחר שתשתמש בכלים
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {creations.map(creation => {
        const meta = toolMeta[creation.tool];
        const isCurrentlyPlaying = playingId === creation.id;

        return (
          <div
            key={creation.id}
            className="rounded-2xl border overflow-hidden"
            style={{ background: c.cardBg, borderColor: c.cardBorder }}
          >
            {/* Preview area */}
            {creation.type === 'image' && creation.url && (
              <img
                src={creation.url}
                alt={creation.prompt}
                className="w-full h-36 object-cover"
              />
            )}
            {creation.type === 'audio' && creation.url && (
              <div
                className="h-20 flex items-center justify-center gap-3 px-4"
                style={{ background: isDark ? '#0c1a2a' : '#e0f2fe' }}
              >
                <button
                  onClick={() => {
                    const a = audioRefs.current[creation.id];
                    if (!a) return;
                    if (isCurrentlyPlaying) {
                      a.pause();
                      setPlayingId(null);
                    } else {
                      // Pause others
                      Object.entries(audioRefs.current).forEach(([id, el]) => {
                        if (id !== creation.id && el) el.pause();
                      });
                      a.play();
                      setPlayingId(creation.id);
                    }
                  }}
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: '#0ea5e9', color: 'white' }}
                >
                  {isCurrentlyPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: '#bae6fd' }} />
                <audio
                  ref={el => { audioRefs.current[creation.id] = el; }}
                  src={creation.url}
                  onEnded={() => setPlayingId(null)}
                />
              </div>
            )}
            {creation.type === 'lead' && (
              <div
                className="h-20 flex items-center justify-center"
                style={{ background: isDark ? '#1a1000' : '#fffbeb' }}
              >
                <p
                  className="font-mono text-sm font-bold"
                  style={{ color: '#d97706', direction: 'ltr' }}
                >
                  {creation.content || '—'}
                </p>
              </div>
            )}

            {/* Info */}
            <div className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onDelete(creation.id)}
                  className="p-1 rounded-lg transition-colors flex-shrink-0"
                  style={{ color: c.textMuted }}
                  title="מחק"
                >
                  <Trash2 size={13} />
                </button>
                <div className="text-right flex-1 min-w-0">
                  <span
                    className="inline-flex items-center text-xs px-2 py-0.5 rounded-full mb-1"
                    style={{ background: meta.color + '20', color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <p className="text-xs truncate" style={{ color: c.textSecondary }}>
                    {creation.prompt}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs" style={{ color: c.textMuted }}>
                <span className="flex items-center gap-1">
                  <Zap size={10} />
                  {creation.creditsUsed}
                </span>
                <span>
                  {new Date(creation.createdAt).toLocaleDateString('he-IL')}
                </span>
              </div>

              {/* Download for images/audio */}
              {(creation.type === 'image' || creation.type === 'audio') && creation.url && (
                <a
                  href={creation.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-end gap-1 text-xs font-medium"
                  style={{ color: meta.color }}
                >
                  <Download size={12} />
                  הורד
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main AiStudio Component ────────────────────────────────────────────── */
export default function AiStudio({ workspace, currentUser: _currentUser, onNavigateToBilling, onToast }: AiStudioProps) {
  const { c, isDark } = useTheme();

  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [panelOpen, setPanelOpen]   = useState(false);
  const [apiKeys, setApiKeys]       = useState<AiStudioKeys>({});
  const [creations, setCreations]   = useState<StudioCreation[]>([]);
  const [credits, setCredits]       = useState(0);
  const [keyRefresh, setKeyRefresh] = useState(0);

  const workspaceId = workspace?.id ?? '';

  /* ── Load workspace doc (API keys + credits) ──────────────────────────── */
  useEffect(() => {
    if (!workspaceId) return;
    const unsub = onSnapshot(doc(db, 'workspaces', workspaceId), snap => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      setApiKeys((data.aiStudioKeys as AiStudioKeys) ?? {});
      setCredits(typeof data.studioCredits === 'number' ? data.studioCredits : 0);
    });
    return () => unsub();
  }, [workspaceId]);

  /* ── Load creations ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!workspaceId) return;
    const unsub = onSnapshot(
      collection(db, 'workspaces', workspaceId, 'studioCreations'),
      snap => {
        const items: StudioCreation[] = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as StudioCreation))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCreations(items);
      },
      err => console.error('studioCreations snapshot error', err),
    );
    return () => unsub();
  }, [workspaceId]);

  /* ── Open tool panel ──────────────────────────────────────────────────── */
  const openTool = useCallback((id: ToolId) => {
    const tool = TOOLS.find(t => t.id === id);
    if (!tool || tool.status === 'coming_soon') {
      setActiveTool(id);
      setPanelOpen(true);
      return;
    }
    setActiveTool(id);
    setPanelOpen(true);
  }, []);

  const closeTool = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => setActiveTool(null), 300);
  }, []);

  /* ── Credit operations ────────────────────────────────────────────────── */
  const deductCredits = useCallback(async (amount: number) => {
    if (!workspaceId) return;
    const newBalance = Math.max(0, credits - amount);
    setCredits(newBalance);
    await updateDoc(doc(db, 'workspaces', workspaceId), { studioCredits: newBalance });
  }, [workspaceId, credits]);

  /* ── Save creation ────────────────────────────────────────────────────── */
  const saveCreation = useCallback(async (creation: Omit<StudioCreation, 'id'>) => {
    if (!workspaceId) return;
    const id = Date.now().toString();
    await setDoc(doc(db, 'workspaces', workspaceId, 'studioCreations', id), { ...creation, id });
  }, [workspaceId]);

  /* ── Delete creation ──────────────────────────────────────────────────── */
  const deleteCreation = useCallback(async (id: string) => {
    if (!workspaceId) return;
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'studioCreations', id));
    onToast?.('נמחק ✓', 'info');
  }, [workspaceId, onToast]);

  /* ── Resolve active tool status ───────────────────────────────────────── */
  const getResolvedStatus = (tool: StudioTool): ToolStatus => {
    if (tool.status === 'coming_soon') return 'coming_soon';
    if (tool.id === 'elevenlabs') return apiKeys.elevenlabs ? 'ready' : 'needs_key';
    if (tool.id === 'ideogram')   return apiKeys.ideogram   ? 'ready' : 'needs_key';
    if (tool.id === 'hunter')     return apiKeys.hunter     ? 'ready' : 'needs_key';
    return 'needs_key';
  };

  /* ── Active tool data ─────────────────────────────────────────────────── */
  const activeTool_ = TOOLS.find(t => t.id === activeTool);
  const activeStatus = activeTool_ ? getResolvedStatus(activeTool_) : null;

  /* ── Panel content ────────────────────────────────────────────────────── */
  const renderPanelContent = () => {
    if (!activeTool_) return null;

    // Coming soon
    if (activeStatus === 'coming_soon') {
      return <ComingSoonPanel tool={activeTool_} />;
    }

    // Needs key
    if (activeStatus === 'needs_key') {
      if (activeTool_.id === 'elevenlabs' || activeTool_.id === 'ideogram' || activeTool_.id === 'hunter') {
        return (
          <div className="p-4">
            <KeySetup
              toolId={activeTool_.id}
              workspaceId={workspaceId}
              onSaved={() => setKeyRefresh(n => n + 1)}
              onToast={onToast}
            />
          </div>
        );
      }
      return null;
    }

    // Not enough credits check
    if (credits < activeTool_.creditCost && activeStatus === 'ready') {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
          <div className="text-5xl">💸</div>
          <div>
            <h3 className="text-lg font-bold mb-1" style={{ color: c.textPrimary }}>אין מספיק קרדיטים</h3>
            <p className="text-sm" style={{ color: c.textMuted }}>
              יתרה: {credits} | נדרש: {activeTool_.creditCost}
            </p>
          </div>
          <button
            onClick={onNavigateToBilling}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm"
            style={{ background: c.accentBg, color: c.accentText }}
          >
            <CreditCard size={15} />
            הוסף קרדיטים
          </button>
        </div>
      );
    }

    // Tool panels
    if (activeTool === 'elevenlabs' && apiKeys.elevenlabs) {
      return (
        <div className="p-4">
          <ElevenLabsPanel
            key={keyRefresh}
            apiKey={apiKeys.elevenlabs}
            credits={credits}
            workspaceId={workspaceId}
            onDeductCredits={deductCredits}
            onSaveCreation={saveCreation}
            onToast={onToast}
          />
        </div>
      );
    }

    if (activeTool === 'ideogram' && apiKeys.ideogram) {
      return (
        <div className="p-4">
          <IdeogramPanel
            key={keyRefresh}
            apiKey={apiKeys.ideogram}
            credits={credits}
            onDeductCredits={deductCredits}
            onSaveCreation={saveCreation}
            onToast={onToast}
          />
        </div>
      );
    }

    if (activeTool === 'hunter' && apiKeys.hunter) {
      return (
        <div className="p-4">
          <HunterPanel
            key={keyRefresh}
            apiKey={apiKeys.hunter}
            credits={credits}
            onDeductCredits={deductCredits}
            onSaveCreation={saveCreation}
            onToast={onToast}
          />
        </div>
      );
    }

    return null;
  };

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div
      className="min-h-screen p-4 md:p-6"
      dir="rtl"
      style={{
        background: c.pageBg || (isDark ? '#0b1120' : '#f1f5f9'),
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
      }}
    >
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black flex items-center gap-2" style={{ color: c.textPrimary }}>
              AI Studio 🎬
            </h1>
            <p className="text-sm mt-1" style={{ color: c.textMuted }}>
              ארגז כלים AI ליצירת תוכן, קול, תמונות וחיפוש לידים
            </p>
          </div>

          {/* Credits pill + top-up */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-xl border"
              style={{
                background: isDark ? '#1a2236' : '#fff',
                borderColor: c.accentBorder,
              }}
            >
              <Zap size={15} style={{ color: c.accentText }} />
              <span className="font-bold text-sm" style={{ color: c.accentText }}>
                {credits.toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: c.textMuted }}>קרדיטים</span>
            </div>
            <button
              onClick={onNavigateToBilling}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all"
              style={{ background: c.accentBg, color: c.accentText }}
            >
              <CreditCard size={14} />
              הוסף קרדיטים
            </button>
          </div>
        </div>

        {/* ── Main layout: tool grid + panel ──────────────────────────────── */}
        <div className="flex gap-4 items-start">

          {/* Tool grid */}
          <div
            className={`grid gap-3 transition-all duration-300 ${
              panelOpen
                ? 'grid-cols-1 w-full md:w-72 md:flex-shrink-0'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 flex-1'
            }`}
          >
            {TOOLS.map(tool => (
              <ToolCard
                key={tool.id}
                tool={tool}
                isActive={activeTool === tool.id && panelOpen}
                apiKeys={apiKeys}
                onClick={() => {
                  if (activeTool === tool.id && panelOpen) {
                    closeTool();
                  } else {
                    openTool(tool.id);
                  }
                }}
              />
            ))}
          </div>

          {/* Tool panel (slide-in drawer) */}
          {panelOpen && activeTool_ && (
            <div
              className="flex-1 rounded-2xl border overflow-hidden transition-all duration-300"
              style={{
                background: c.cardBg,
                borderColor: activeTool_.color + '40',
                boxShadow: `0 0 32px ${activeTool_.color}18`,
                minHeight: 480,
              }}
            >
              {/* Panel header */}
              <div
                className="flex items-center justify-between px-5 py-4 border-b"
                style={{
                  background: `linear-gradient(135deg, ${activeTool_.color}18, ${activeTool_.color}08)`,
                  borderColor: activeTool_.color + '30',
                }}
              >
                <button
                  onClick={closeTool}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: c.textMuted }}
                >
                  <X size={16} />
                </button>

                <div className="flex items-center gap-2">
                  <div>
                    <h2 className="text-base font-bold text-right" style={{ color: c.textPrimary }}>
                      {activeTool_.nameHe}
                    </h2>
                    {activeStatus === 'ready' && (
                      <p className="text-xs text-right" style={{ color: c.textMuted }}>
                        יתרה: {credits} קרדיטים
                      </p>
                    )}
                  </div>
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: activeTool_.gradient }}
                  >
                    <activeTool_.icon size={18} color="white" />
                  </div>
                </div>
              </div>

              {/* Panel body — scrollable */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                {renderPanelContent()}
              </div>

              {/* Reset key link (when ready) */}
              {activeStatus === 'ready' && (
                <div
                  className="px-5 py-3 border-t flex items-center justify-end"
                  style={{ borderColor: c.divider }}
                >
                  <button
                    onClick={() => setKeyRefresh(n => n + 1)}
                    className="flex items-center gap-1 text-xs"
                    style={{ color: c.textMuted }}
                  >
                    <RefreshCw size={11} />
                    עדכן מפתח
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Creations gallery ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs" style={{ color: c.textMuted }}>
              {creations.length} יצירות שמורות
            </span>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: c.textPrimary }}>
              יצירות אחרונות
              <Sparkles size={18} style={{ color: c.accentText }} />
            </h2>
          </div>
          <CreationsGallery
            workspaceId={workspaceId}
            creations={creations}
            onDelete={deleteCreation}
          />
        </section>

        {/* No workspace fallback */}
        {!workspaceId && (
          <div
            className="rounded-2xl border p-8 text-center"
            style={{ background: c.subtleBg, borderColor: c.cardBorder }}
          >
            <div className="text-3xl mb-3">⚠️</div>
            <p className="text-sm font-medium" style={{ color: c.textSecondary }}>
              AI Studio זמין רק לסביבות עבודה מחוברות
            </p>
          </div>
        )}

      </div>

      {/* ── Bottom safe area for mobile ─────────────────────────────────── */}
      <div className="h-20 md:h-6" />
    </div>
  );
}
