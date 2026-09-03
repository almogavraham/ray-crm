/**
 * MarketingAgent.tsx
 *
 * AI Marketing Agent — Facebook page management, AI post creation,
 * comment reply automation, lead source tracking & analytics.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Megaphone, FileText, MessageSquare, MapPin, BarChart2, Settings,
  RefreshCw, Plus, Send, Check, X, ThumbsUp, MessageCircle, Share2,
  Eye, TrendingUp, Users, Zap, AlertCircle, ChevronRight, ChevronLeft,
  Globe, Edit3, Clock, Loader2, Heart, Info, Target,
  Image, Video, Star, Sparkles, Download, Trash2,
  ExternalLink, Activity,
  CheckCheck, ArrowRight, Rocket, BadgeCheck, ChevronDown, AlertTriangle,
  Layout, ChevronUp, Monitor, Palette, PanelLeft, Save,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { WorkspaceProfile, PlatformCampaign } from '../types';
import CampaignMediaCreator from '../components/CampaignMediaCreator';
import GoogleAdsCampaigns from '../components/GoogleAdsCampaigns';
import MediaStudio from '../components/MediaStudio';
import type { MediaGalleryItem } from '../components/MediaStudio';
import ContentPlanner from '../components/ContentPlanner';
import MarketingAutopilot from '../components/MarketingAutopilot';
import {
  PLATFORMS, loadSocialConnections, saveSocialConnection, deleteSocialConnection,
  openOAuthPopup, exchangeSocialToken, postToSocial, isConnectionValid,
} from '../lib/socialConnections';
import type { SocialConnection, SocialPlatform } from '../lib/socialConnections';
import type {
  FacebookPost, FacebookComment, CommentDraft,
  MarketingAgentConfig, PageInsights, ScheduledPost,
} from '../lib/facebookMarketing';
import {
  getPageToken, fetchPagePosts, fetchPostComments,
  createFacebookPost, createInstagramPost, replyToFacebookComment, fetchPageInsights,
  generatePostWithAI, loadMarketingConfig, saveMarketingConfig,
  loadCommentDrafts, saveCommentDraft, updateCommentDraft, deleteCommentDraft,
  loadScheduledPosts, saveScheduledPost, processCommentsWithAI,
  fetchPostMetrics, createFacebookAdsCampaign,
} from '../lib/facebookMarketing';
import type { MetaIntegration } from '../types';
import {
  loadCopyLibrary, saveCopyItem, updateCopyItem, deleteCopyItem,
  generateAdCopyVariations, generateCampaignBrief, getBudgetRecommendation,
  getAIInsights, buildAudienceWithAI, loadAudiences, saveAudience, deleteAudience,
  loadCompetitorAds, saveCompetitorAd, deleteCompetitorAd, analyzeCompetitorAd,
  generateRetargetingIdea, loadBriefs, saveBrief,
} from '../lib/marketingEnhancements';
import type { CopyItem, AudienceProfile, CompetitorAd, CampaignBrief } from '../lib/marketingEnhancements';
import type { ProductProfile, GeneratedMedia, PostLearning } from '../lib/mediaGeneration';
import {
  loadProductProfile, saveProductProfile, recordApprovedMedia, recordPublishedPost, isOutOfCredits } from '../lib/mediaGeneration';
import { db, storage } from '../lib/firebase';
import {
  exportToPPTX, exportToGoogleSlides, requestSlidesToken, fetchSlideThumbnails,
  generateCodeVerifier, generateCodeChallenge,
  getCanvaAuthUrl, canvaOAuthPopup, exchangeCanvaCode, createCanvaPresentation,
} from '../lib/presentationExport';
import type { PresentationDoc as PresDoc, PresentationSlide as PresSlide } from '../lib/presentationExport';
import { ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, getDocs, getDoc, query, orderBy, setDoc, doc, deleteDoc, where, updateDoc, onSnapshot } from 'firebase/firestore';
/* ── Toast type ─────────────────────────────────────────────────────────────── */
type ToastFnType = (msg: string, type?: 'success' | 'error' | 'info') => void;

/* ── Campaign record (Marketing Agent native) ───────────────────────────────── */
interface PublishResult {
  platform: string;
  postId:   string;
  postUrl?: string;
  error?:   string;
}

interface CampaignMetrics {
  likes:     number;
  comments:  number;
  shares:    number;
  reach:     number;
  updatedAt: number;
}

interface CampaignRecord {
  id:         string;
  name:       string;
  goal:       string;          // used as objective label
  platforms:  string[];
  text:       string;
  campaignType?: 'organic' | 'paid';
  objective?:  string;
  budgetType?: 'daily' | 'lifetime';
  budgetAmount?: number;
  adCampaignId?: string;       // Facebook Campaign ID
  adSetId?:      string;
  adId?:         string;
  adsManagerUrl?: string;
  targeting?:  {
    countries: string[];
    ageMin: number;
    ageMax: number;
    genders: number[];
    interests: string;
  };
  adHeadline?:  string;
  adWebsiteUrl?: string;
  adCta?:       string;
  mediaUrl?:  string;
  mediaThumbnailUrl?: string;
  mediaType?: 'image' | 'video-kling' | 'video-nano';
  mediaEngine?: string;
  status:     'draft' | 'published' | 'scheduled';
  createdAt:  number;
  publishedAt?: number;
  publishResults?: PublishResult[];
  metrics?:    CampaignMetrics;
}

/* ── Props ──────────────────────────────────────────────────────────────────── */
interface Props {
  workspaceId?: string;
  workspace?: WorkspaceProfile;
  onToast?: ToastFnType;
  onNavigate?: (page: string) => void;
}

/* ── Tab type ───────────────────────────────────────────────────────────────── */
type Tab = 'autopilot' | 'campaigns' | 'google' | 'creative' | 'settings' | 'studio';
// Sub-tabs inside the "פרסום ברשתות" (social advertising) hub, ordered by the
// campaign lifecycle: create → target audiences → engage (comments) → measure.
type CampaignsSubTab = 'create' | 'plan' | 'audiences' | 'comments' | 'analytics';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'autopilot',  label: 'אוטופיילוט',    icon: Rocket        },
  { id: 'studio',     label: 'סטודיו',        icon: Monitor       },
  { id: 'campaigns',  label: 'פרסום ברשתות', icon: Target        },
  { id: 'google',     label: 'פרסום בגוגל',  icon: Globe         },
  { id: 'creative',   label: 'יצירת תוכן',   icon: Zap           },
  { id: 'settings',   label: 'הגדרות',        icon: Settings      },
];

const CAMPAIGNS_SUBTABS: { id: CampaignsSubTab; label: string; icon: React.ElementType }[] = [
  { id: 'create',    label: 'קמפיינים', icon: Target        },
  { id: 'plan',      label: 'מתכנן תוכן', icon: Layout      },
  { id: 'audiences', label: 'קהלים',    icon: Users         },
  { id: 'comments',  label: 'תגובות',   icon: MessageSquare },
  { id: 'analytics', label: 'אנליטיקס', icon: BarChart2     },
];

/* ── Presentation types ──────────────────────────────────────────────────────── */
interface PresentationSlide {
  id: string;
  title: string;
  body: string;
  imageId: string | null;
  bgColor: string;
  textColor: string;
  layout: 'text-only' | 'image-right' | 'image-left' | 'image-top' | 'image-full';
}
interface PresentationDoc {
  id: string;
  name: string;
  slides: PresentationSlide[];
  createdAt: number;
  updatedAt: number;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)  return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `לפני ${hrs} שעות`;
  const days = Math.floor(hrs / 24);
  return `לפני ${days} ימים`;
}

const CONFIDENCE_COLOR = (c: number) =>
  c >= 80 ? '#10b981' : c >= 60 ? '#f59e0b' : '#ef4444';

const SOURCE_COLORS: Record<string, string> = {
  'פייסבוק':     '#1877f2',
  'אינסטגרם':    '#e1306c',
  'גוגל':        '#ea4335',
  'פרסום ממומן': '#f59e0b',
  'אורגני':      '#10b981',
  'הפניה':       '#8b5cf6',
  'אחר':         '#94a3b8',
};

/* ── Stat Card ──────────────────────────────────────────────────────────────── */
function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="rounded-2xl p-4 border flex items-start gap-3"
      style={{ background: `${color}10`, borderColor: `${color}30` }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}20` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-black mt-0.5" style={{ color }}>{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ── Post Card ──────────────────────────────────────────────────────────────── */
function PostCard({ post }: { post: FacebookPost }) {
  const [expanded, setExpanded] = useState(false);
  const preview = post.message.slice(0, 120);
  const hasMore = post.message.length > 120;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      {post.fullPicture && (
        <img src={post.fullPicture} alt="" className="w-full h-40 object-cover" />
      )}
      <div className="p-4">
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {expanded ? post.message : preview}
          {hasMore && !expanded && '...'}
        </p>
        {hasMore && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-indigo-500 mt-1 hover:underline"
          >
            {expanded ? 'הצג פחות' : 'הצג יותר'}
          </button>
        )}
        <p className="text-[11px] text-slate-400 mt-2">{fmtDate(post.createdTime)}</p>

        {/* Metrics row */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <ThumbsUp size={12} className="text-blue-500" /> {fmtNum(post.likes)}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <MessageCircle size={12} className="text-green-500" /> {fmtNum(post.comments)}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Share2 size={12} className="text-purple-500" /> {fmtNum(post.shares)}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Eye size={12} className="text-orange-500" /> {fmtNum(post.reach)}
          </span>
          {post.permalink && (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className="mr-auto text-xs text-indigo-500 hover:underline flex items-center gap-1"
            >
              <Globe size={11} /> צפה
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Comment Draft Card ─────────────────────────────────────────────────────── */
function CommentDraftCard({
  draft, onApprove, onEdit, onIgnore, pageToken, onToast,
}: {
  draft: CommentDraft;
  onApprove: (draftId: string, text: string, commentId: string) => Promise<void>;
  onEdit: (draftId: string, text: string) => void;
  onIgnore: (draftId: string) => Promise<void>;
  pageToken: string;
  onToast?: ToastFnType;
}) {
  const [editText, setEditText] = useState(draft.aiDraft);
  const [editing,  setEditing]  = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(draft.id, editText, draft.commentId);
      onToast?.('תגובה נשלחה ✓', 'success');
    } catch {
      onToast?.('שגיאה בשליחה', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (draft.status === 'sent' || draft.status === 'ignored') return null;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      {/* Original comment */}
      <div className="flex items-start gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {draft.fromName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{draft.fromName}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{draft.commentText}</p>
        </div>
      </div>

      {/* AI Draft */}
      <div className="flex items-center gap-2 mb-2">
        <Zap size={12} className="text-indigo-500" />
        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">תגובת AI</span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: `${CONFIDENCE_COLOR(draft.confidence)}20`, color: CONFIDENCE_COLOR(draft.confidence) }}
        >
          {draft.confidence}%
        </span>
      </div>

      {editing ? (
        <textarea
          className="w-full text-sm rounded-xl border border-indigo-300 dark:border-indigo-600 p-3 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
          rows={3}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          dir="rtl"
        />
      ) : (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">{editText}</p>
        </div>
      )}

      {/* Uncertainties */}
      {draft.uncertainties.length > 0 && (
        <div className="flex items-start gap-1.5 mt-2">
          <AlertCircle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{draft.uncertainties.join(' · ')}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          שלח
        </button>
        <button
          onClick={() => { setEditing(e => !e); if (editing) onEdit(draft.id, editText); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Edit3 size={12} />
          {editing ? 'שמור' : 'ערוך'}
        </button>
        <button
          onClick={() => onIgnore(draft.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-500 transition-colors mr-auto"
        >
          <X size={12} />
          התעלם
        </button>
        <span className="text-[10px] text-slate-400">{timeAgo(new Date(draft.createdAt).toISOString())}</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Main Component
 * ══════════════════════════════════════════════════════════════════════════════ */
export default function MarketingAgent({ workspaceId: wid, workspace, onToast, onNavigate }: Props) {
  const { c: tc, isDark } = useTheme();
  /* ── Tab ─────────────────────────────────────────────────────────────────── */
  // A copilot hand-off ("open the campaign builder") parks the target tab in
  // sessionStorage; honour it once, then clear it so a later refresh doesn't
  // silently jump the user somewhere they didn't ask for.
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const want = sessionStorage.getItem('ray:marketing-tab');
      sessionStorage.removeItem('ray:marketing-tab');
      const valid: Tab[] = ['autopilot', 'studio', 'campaigns', 'google', 'creative', 'settings'];
      if (want && (valid as string[]).includes(want)) return want as Tab;
    } catch { /* sessionStorage unavailable in private mode */ }
    return 'autopilot';
  });
  const [campaignsSubTab, setCampaignsSubTab] = useState<CampaignsSubTab>('create');
  const [onboardingCollapsed, setOnboardingCollapsed] = useState(true);

  // Studio sub-tabs
  const [mediaContentType, setMediaContentType] = useState<'image' | 'video' | 'presentation'>('image');

  // Presentations state
  const [presentations, setPresentations]         = useState<PresentationDoc[]>([]);
  const [activePresId, setActivePresId]           = useState<string | null>(null);
  const [activeSlideIdx, setActiveSlideIdx]       = useState(0);
  const [presPreview, setPresPreview]             = useState(false);
  const [presCurrentIdx, setPresCurrentIdx]       = useState(0);

  const activePresentation = presentations.find(p => p.id === activePresId) ?? null;
  const activeSlide = activePresentation?.slides?.[activeSlideIdx] ?? null;

  // AI presentation generator state
  const [aiPresPrompt,       setAiPresPrompt]       = useState('');
  const [aiPresSlideCount,   setAiPresSlideCount]   = useState(5);
  const [aiPresEngine,       setAiPresEngine]       = useState<'openai'|'google'>('openai');
  const [aiPresGenerating,   setAiPresGenerating]   = useState(false);
  const [aiPresProgress,     setAiPresProgress]     = useState('');
  const [aiPresShowPanel,    setAiPresShowPanel]    = useState(false);

  // Saved presentations gallery
  const [savedPresentations,  setSavedPresentations]  = useState<PresentationDoc[]>([]);
  const [savedPresLoaded,     setSavedPresLoaded]     = useState(false);
  const [savingPres,          setSavingPres]          = useState(false);

  // Claude presentation generation
  const [claudePresPrompt,     setClaudePresPrompt]     = useState('');
  const [claudePresSlideCount, setClaudePresSlideCount] = useState(5);
  const [claudePresGenerating, setClaudePresGenerating] = useState(false);
  const [claudePresProgress,   setClaudePresProgress]   = useState('');
  const [claudePresStyle,      setClaudePresStyle]      = useState<'professional' | 'creative' | 'minimal'>('professional');
  const [claudePresWithImages, setClaudePresWithImages] = useState(true);
  const [claudePresImgEngine,  setClaudePresImgEngine]  = useState<'dalle' | 'imagen'>('imagen');

  // Creative sub-tab
  const [creativeSubTab, setCreativeSubTab] = useState<'ai' | 'library' | 'brief'>('ai');

  // Copy Library
  const [copyItems, setCopyItems]           = useState<CopyItem[]>([]);
  const [copyLoading, setCopyLoading]       = useState(false);
  const [copyFilter, setCopyFilter]         = useState<CopyItem['type'] | 'all'>('all');
  const [copySearch, setCopySearch]         = useState('');
  const [showCopyGen, setShowCopyGen]       = useState(false);
  const [copyGenType, setCopyGenType]       = useState<CopyItem['type']>('headline');
  const [copyGenGoal, setCopyGenGoal]       = useState('');
  const [copyGenResults, setCopyGenResults] = useState<string[]>([]);
  const [copyGenLoading, setCopyGenLoading] = useState(false);

  // Analytics
  const [analyticsInsights, setAnalyticsInsights]   = useState<string[]>([]);
  const [insightsLoading, setInsightsLoading]         = useState(false);
  const [budgetRec, setBudgetRec]                     = useState<{ recommendations: { platform: string; currentSpend: number; recommendedSpend: number; reason: string }[]; summary: string } | null>(null);
  const [budgetLoading, setBudgetLoading]             = useState(false);
  const [totalBudgetInput, setTotalBudgetInput]       = useState('5000');

  // Audiences
  const [audiences, setAudiences]             = useState<AudienceProfile[]>([]);
  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [audienceProduct, setAudienceProduct]   = useState('');
  const [audienceGoal, setAudienceGoal]         = useState('');
  const [audienceCustomers, setAudienceCustomers] = useState('');
  const [audienceLoading, setAudienceLoading]   = useState(false);

  // Competitor
  const [competitors, setCompetitors]           = useState<CompetitorAd[]>([]);
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [compName, setCompName]                 = useState('');
  const [compAdText, setCompAdText]             = useState('');
  const [compAnalysis, setCompAnalysis]         = useState<Record<string, string>>({});
  const [compAnalyzing, setCompAnalyzing]       = useState<string | null>(null);

  // Campaign Brief
  const [briefs, setBriefs]               = useState<CampaignBrief[]>([]);
  const [showBriefForm, setShowBriefForm] = useState(false);
  const [briefProduct, setBriefProduct]   = useState('');
  const [briefGoal, setBriefGoal]         = useState('');
  const [briefAudience, setBriefAudience] = useState('');
  const [briefBudget, setBriefBudget]     = useState('5000');
  const [briefLoading, setBriefLoading]   = useState(false);
  const [generatedBrief, setGeneratedBrief] = useState<Omit<CampaignBrief,'id'|'createdAt'> | null>(null);

  // Retargeting
  const [retargetIdea, setRetargetIdea]       = useState<{ headline: string; body: string; cta: string; targetSegment: string } | null>(null);
  const [retargetLoading, setRetargetLoading] = useState(false);

  /* ── Page connection ─────────────────────────────────────────────────────── */
  // Live Meta integration data — must be declared BEFORE effectiveMeta uses it
  const [liveMetaIntegration, setLiveMetaIntegration] = useState<MetaIntegration | undefined>(workspace?.metaIntegration);
  // Use live data from Firestore listener (keeps fresh after OAuth reconnect)
  const effectiveMeta = liveMetaIntegration ?? workspace?.metaIntegration;
  // useMemo prevents new object reference on every render (breaks infinite useEffect loop)
  const pageAuth = useMemo(
    () => effectiveMeta ? getPageToken({ ...workspace!, metaIntegration: effectiveMeta }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMeta?.accessToken, effectiveMeta?.pages],
  );
  const isConnected = useMemo(
    () => !!pageAuth || !!effectiveMeta?.connected,
    [pageAuth, effectiveMeta?.connected],
  );
  const connectedPage = effectiveMeta?.pages?.find(p => p.subscribed) ?? effectiveMeta?.pages?.[0];

  /* ── Config ──────────────────────────────────────────────────────────────── */
  const [cfg, setCfg] = useState<MarketingAgentConfig>({
    enabled:             true,
    agentName:           workspace?.name ?? 'הצוות שלנו',
    signature:           workspace?.name ?? '',
    language:            'he',
    businessDescription: workspace?.prompt ?? '',
    agentInstructions:   workspace?.aiInstructions ?? '',
    contentPillars:      [],
    autoReplyComments:   false,
    replyTone:           'friendly',
    targetResponseTime:  60,
    blacklistedWords:    '',
    postingGuidelines:   '',
    emojiUsage:          'minimal',
    ctaStyle:            'soft',
    hashtagStrategy:     'auto',
    fixedHashtags:       '',
    maxPostLength:       0,
    autoSchedule:        false,
    postFrequency:       'manual',
    bestPostingTimes:    ['09:00', '13:00', '19:00'],
    maxDailyPosts:       3,
    requireApproval:     true,
    sensitiveTopics:     '',
  });
  const [savingCfg, setSavingCfg] = useState(false);

  /* ── Posts ───────────────────────────────────────────────────────────────── */
  const [posts,         setPosts]         = useState<FacebookPost[]>([]);
  const [postsLoading,  setPostsLoading]  = useState(false);
  const [insights,      setInsights]      = useState<PageInsights | null>(null);

  /* ── New Post modal ──────────────────────────────────────────────────────── */
  const [showNewPost,   setShowNewPost]   = useState(false);
  const [newPostText,   setNewPostText]   = useState('');
  const [postTopic,     setPostTopic]     = useState('');
  const [postTone,      setPostTone]      = useState<'professional' | 'friendly' | 'formal'>('friendly');
  const [aiGenerating,  setAiGenerating]  = useState(false);
  const [posting,       setPosting]       = useState(false);

  /* ── Comments ────────────────────────────────────────────────────────────── */
  const [drafts,         setDrafts]         = useState<CommentDraft[]>([]);
  const [draftsLoading,  setDraftsLoading]  = useState(false);
  const [scanningComments, setScanningComments] = useState(false);
  const [selectedPost,   setSelectedPost]   = useState<string>('');

  /* ── Leads source ────────────────────────────────────────────────────────── */
  const [leadsData,   setLeadsData]   = useState<Array<{ source: string; count: number; budget: number }>>([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);

  /* ── Campaigns ───────────────────────────────────────────────────────────── */
  const [campaigns,      setCampaigns]      = useState<PlatformCampaign[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);

  /* ── Scheduled posts ─────────────────────────────────────────────────────── */
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);

  /* ── Post publish platform picker ────────────────────────────────────────── */
  const [publishPlatforms, setPublishPlatforms] = useState<string[]>(['facebook']);
  const [showPublishPicker, setShowPublishPicker] = useState(false);

  /* ── Post media ──────────────────────────────────────────────────────────── */
  const [postMedia,            setPostMedia]            = useState<GeneratedMedia | null>(null);
  const [showPostMediaCreator, setShowPostMediaCreator] = useState(false);
  const [showGalleryPicker,    setShowGalleryPicker]    = useState<null | 'post' | 'campaign'>(null);

  /* ── Content AI tab ──────────────────────────────────────────────────────── */
  const [contentPrompt,        setContentPrompt]        = useState('');
  const [contentType,          setContentType]          = useState<'post' | 'blog' | 'newsletter' | 'video-script' | 'google-ad' | 'other'>('post');
  const [contentTone,          setContentTone]          = useState<'friendly' | 'professional' | 'formal'>('friendly');
  const [contentLength,        setContentLength]        = useState<'short' | 'medium' | 'long'>('medium');
  const [contentResult,        setContentResult]        = useState('');
  const [contentGenerating,    setContentGenerating]    = useState(false);
  const [showContentPublish,   setShowContentPublish]   = useState(false);
  const [contentPlatforms,     setContentPlatforms]     = useState<string[]>([]);
  const [publishingContent,    setPublishingContent]    = useState(false);

  /* ── Smart onboarding (first-time profile setup) ─────────────────────────── */
  const [showOnboarding,      setShowOnboarding]      = useState(false);
  const [onboardingName,      setOnboardingName]      = useState('');
  const [onboardingDesc,      setOnboardingDesc]      = useState('');
  const [onboardingAudience,  setOnboardingAudience]  = useState('');
  const [onboardingStyle,     setOnboardingStyle]     = useState('');
  const [savingOnboarding,    setSavingOnboarding]    = useState(false);

  /* ── Product profile & campaign media ────────────────────────────────────── */
  const [productProfile,      setProductProfile]      = useState<ProductProfile | null>(null);
  const [showMediaCreator,    setShowMediaCreator]     = useState(false);
  const [campaignGoalForMedia,setCampaignGoalForMedia] = useState('');
  // Media options
  const [showMediaOptions,    setShowMediaOptions]    = useState(false);
  const [mediaUrlInput,       setMediaUrlInput]       = useState('');
  const [showUrlInput,        setShowUrlInput]        = useState(false);
  const [pollinationsPrompt,  setPollinationsPrompt]  = useState('');
  const [pollinationsLoading, setPollinationsLoading] = useState(false);
  const [showPollinationsForm,setShowPollinationsForm]= useState(false);
  const [pollinationsModel,   setPollinationsModel]   = useState<'default'|'turbo'>('default');
  const [showFreeVideoPanel,  setShowFreeVideoPanel]  = useState(false);
  const [mediaPreviewStatus,  setMediaPreviewStatus]  = useState<'loading'|'ok'|'err'>('loading');
  const [isDraggingFile,      setIsDraggingFile]      = useState(false);
  // Advanced AI API keys & generator state
  const [apiKeys,         setApiKeys]         = useState<{openai:string;google:string;heygen:string;canva:string}>({openai:'',google:'',heygen:'',canva:''});
  const [slidesToken,        setSlidesToken]        = useState<string | null>(null);
  const [canvaToken,         setCanvaToken]         = useState<string | null>(null);
  const [exportingPres,      setExportingPres]      = useState<'pptx'|'slides'|'canva'|null>(null);
  const [googleSlidesThumbs, setGoogleSlidesThumbs] = useState<string[]>([]);
  const [googleSlidesUrl,    setGoogleSlidesUrl]    = useState<string | null>(null);
  const [fetchingThumbs,     setFetchingThumbs]     = useState(false);
  const [thumbsPresId,       setThumbsPresId]       = useState<string | null>(null);
  const [aiGenTool,       setAiGenTool]       = useState<'dalle'|'imagen'|'heygen'|'veo'|null>(null);
  const [aiGenPrompt,     setAiGenPrompt]     = useState('');
  const [aiGenLoading,    setAiGenLoading]    = useState(false);
  const [uploadingFile,       setUploadingFile]       = useState(false);
  const [uploadProgress,      setUploadProgress]      = useState(0);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const mediaSectionRef = useRef<HTMLDivElement>(null);
  const aiGenTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null); // force-reset guard
  const [generatedImagePopup, setGeneratedImagePopup] = useState<string | null>(null);
  // Campaign creation state
  const [showCampaignForm,    setShowCampaignForm]    = useState(false);
  const [campaignName,        setCampaignName]        = useState('');
  const [campaignGoal,        setCampaignGoal]        = useState('מכירות');
  const [campaignPlatforms,   setCampaignPlatforms]   = useState<string[]>(['facebook']);
  const [campaignMedia,       setCampaignMedia]       = useState<GeneratedMedia | null>(null);
  /* ── Product Assets ────────────────────────────────────────────────────── */
  interface ProductAsset { id: string; url: string; name: string; addedAt: number; }
  const ASSETS_LS_KEY = `product_assets_${wid ?? 'default'}`;
  const [productAssets,   setProductAssets]   = useState<ProductAsset[]>(() => {
    try { return JSON.parse(localStorage.getItem(`product_assets_${wid ?? 'default'}`) ?? '[]'); } catch { return []; }
  });
  const [assetsExpanded,  setAssetsExpanded]  = useState(true);
  const [useAssets,       setUseAssets]       = useState(true);
  const [enriching,       setEnriching]       = useState(false);
  const assetInputRef   = useRef<HTMLInputElement>(null);
  // Holds an enriched prompt so stale-closure handlers can read the updated value
  const overridePromptRef = useRef<string | null>(null);

  const GALLERY_LS_KEY = 'ray_crm_media_gallery_v1';
  const [mediaGallery,        setMediaGallery]        = useState<MediaGalleryItem[]>([]);
  const [galleryLoaded,       setGalleryLoaded]       = useState(false);
  const [showMediaStudio,     setShowMediaStudio]     = useState(false);
  const [showPresStudio,      setShowPresStudio]      = useState(false);
  const [studioFocusId,       setStudioFocusId]       = useState<string | null>(null);
  const [studioFocusSeq,      setStudioFocusSeq]      = useState(0);
  const [galleryFilter,       setGalleryFilter]       = useState<'all' | 'image' | 'video' | 'upload' | 'presentation'>('all');
  const [galleryPreview,      setGalleryPreview]      = useState<MediaGalleryItem | null>(null);
  const [campaignText,        setCampaignText]        = useState('');
  const [campaignTextPrompt,  setCampaignTextPrompt]  = useState('');
  const [campaignTextTone,    setCampaignTextTone]    = useState<'professional' | 'friendly' | 'formal'>('friendly');
  const [campaignTextGenerating, setCampaignTextGenerating] = useState(false);
  const [campaignSaving,      setCampaignSaving]      = useState(false);
  const [myCampaigns,         setMyCampaigns]         = useState<CampaignRecord[]>([]);
  const [campaignsLoadedMA,   setCampaignsLoadedMA]   = useState(false);
  // Wizard state
  const [campaignPlatform,    setCampaignPlatform]    = useState<'meta' | 'google' | null>(null);
  const [campaignType,        setCampaignType]        = useState<'organic' | 'paid'>('organic');
  const [wizardStep,          setWizardStep]          = useState(0);
  // Paid campaign fields
  const [campaignObjective,   setCampaignObjective]   = useState('OUTCOME_TRAFFIC');
  const [campaignBudgetType,  setCampaignBudgetType]  = useState<'daily' | 'lifetime'>('daily');
  const [campaignBudgetAmount,setCampaignBudgetAmount]= useState('50');
  const [campaignStartDate,   setCampaignStartDate]   = useState('');
  const [campaignEndDate,     setCampaignEndDate]     = useState('');
  const [campaignAgeMin,      setCampaignAgeMin]      = useState(18);
  const [campaignAgeMax,      setCampaignAgeMax]      = useState(65);
  const [campaignGenders,     setCampaignGenders]     = useState<number[]>([]);
  const [campaignCountry,     setCampaignCountry]     = useState('IL');
  const [campaignInterestTags,setCampaignInterestTags]= useState('');
  const [campaignHeadline,    setCampaignHeadline]    = useState('');
  const [campaignWebsiteUrl,  setCampaignWebsiteUrl]  = useState('');
  const [campaignCta,         setCampaignCta]         = useState('LEARN_MORE');
  const [campaignSelectedPageId, setCampaignSelectedPageId] = useState('');
  const [campaignSelectedAdAccountId, setCampaignSelectedAdAccountId] = useState('');
  const [paidCampaignPublishing, setPaidCampaignPublishing] = useState(false);
  // Product profile editing
  const [editingProfile,      setEditingProfile]      = useState(false);

  /* ── Social connections ──────────────────────────────────────────────────── */
  const [socialConns,        setSocialConns]        = useState<SocialConnection[]>([]);
  const [connectingPlatform, setConnectingPlatform] = useState<SocialPlatform | null>(null);
  const [showCredModal,      setShowCredModal]      = useState<SocialPlatform | null>(null);
  const [credClientId,       setCredClientId]       = useState('');
  const [credClientSecret,   setCredClientSecret]   = useState('');

  /* ── Load config + drafts on mount ─────────────────────────────────────────── */
  useEffect(() => {
    if (!wid) return;
    loadMarketingConfig(wid).then(c => {
      if (c) {
        setCfg(prev => ({
          ...prev,
          ...c,
          // Fallback: if businessDescription not set in config, use workspace.prompt
          businessDescription: c.businessDescription || workspace?.prompt || '',
          agentInstructions:   c.agentInstructions   || workspace?.aiInstructions || '',
        }));
      }
    });
    loadCommentDrafts(wid).then(setDrafts);
    loadScheduledPosts(wid).then(setScheduledPosts);
    loadSocialConnections(wid).then(setSocialConns);
    // Load new features data
    Promise.all([
      loadCopyLibrary(wid),
      loadAudiences(wid),
      loadCompetitorAds(wid),
      loadBriefs(wid),
    ]).then(([copyData, audienceData, competitorData, briefData]) => {
      setCopyItems(copyData);
      setAudiences(audienceData);
      setCompetitors(competitorData);
      setBriefs(briefData);
    });
    loadProductProfile(wid).then(profile => {
      setProductProfile(profile);
      // Auto-trigger onboarding for first-time users (no product name set)
      if (!profile.productName) {
        setOnboardingName(workspace?.name ?? '');
        setOnboardingDesc(workspace?.prompt ?? workspace?.description ?? '');
        setShowOnboarding(true);
      }
    });
  }, [wid, workspace?.name, workspace?.prompt]);

  /* ── Load page posts & insights when tab = posts ─────────────────────────── */
  const loadPosts = useCallback(async () => {
    if (!pageAuth) return;
    setPostsLoading(true);
    try {
      const [p, ins] = await Promise.all([
        fetchPagePosts(pageAuth.pageId, pageAuth.token, 20),
        fetchPageInsights(pageAuth.pageId, pageAuth.token),
      ]);
      setPosts(p);
      setInsights(ins);
    } catch (e) {
      onToast?.(`שגיאה בטעינת פוסטים: ${(e as Error).message}`, 'error');
    } finally {
      setPostsLoading(false);
    }
  }, [pageAuth, onToast]);

  // Posts are loaded on-demand (no tab trigger — posts tab removed)

  /* ── Load leads source breakdown ─────────────────────────────────────────── */
  useEffect(() => {
    if ((tab !== 'leads' && tab !== 'analytics') || leadsLoaded || !wid) return;
    getDocs(query(collection(db, 'workspaces', wid, 'leads'), orderBy('createdAt', 'desc')))
      .then(snap => {
        const countMap: Record<string, { count: number; budget: number }> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const src = (data.source as string) || 'לא ידוע';
          if (!countMap[src]) countMap[src] = { count: 0, budget: 0 };
          countMap[src].count++;
          countMap[src].budget += (data.budget as number) || 0;
        });
        const arr = Object.entries(countMap)
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.count - a.count);
        setLeadsData(arr);
        setLeadsLoaded(true);
      })
      .catch(() => setLeadsLoaded(true));
  }, [tab, leadsLoaded, wid]);

  /* ── Load ContentHub campaigns (legacy) ─────────────────────────────────── */
  useEffect(() => {
    if (tab !== 'campaigns' || campaignsLoaded || !wid) return;
    getDocs(query(collection(db, 'workspaces', wid, 'campaigns'), orderBy('createdAt', 'desc')))
      .then(snap => {
        setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlatformCampaign)));
        setCampaignsLoaded(true);
      })
      .catch(() => setCampaignsLoaded(true));
  }, [tab, campaignsLoaded, wid]);

  /* ── Load Marketing Agent native campaigns ───────────────────────────────── */
  useEffect(() => {
    if (tab !== 'campaigns' || campaignsLoadedMA || !wid) return;
    getDocs(query(collection(db, 'workspaces', wid, 'maCampaigns'), orderBy('createdAt', 'desc')))
      .then(snap => {
        setMyCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CampaignRecord)));
        setCampaignsLoadedMA(true);
      })
      .catch(() => setCampaignsLoadedMA(true));
  }, [tab, campaignsLoadedMA, wid]);

  /* ── Keep Meta integration data fresh via Firestore listener ─────────────── */
  useEffect(() => {
    if (!wid) return;
    const unsub = onSnapshot(doc(db, 'workspaces', wid), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as { metaIntegration?: MetaIntegration };
        if (data.metaIntegration) setLiveMetaIntegration(data.metaIntegration);
      }
    });
    return unsub;
  }, [wid]);

  /* ── Handlers ────────────────────────────────────────────────────────────── */

  /* ── Onboarding save ─────────────────────────────────────────────────────── */
  const handleSaveOnboarding = async () => {
    if (!wid || !onboardingName.trim()) return;
    setSavingOnboarding(true);
    try {
      const styleArr = onboardingStyle.split(',').map(s => s.trim()).filter(Boolean);
      const newProfile: ProductProfile = {
        productName:        onboardingName.trim(),
        productDescription: onboardingDesc.trim(),
        targetAudience:     onboardingAudience.trim(),
        brandColors:        [],
        styleKeywords:      styleArr,
        avoidKeywords:      [],
        approvedMedia:      [],
        rejectedPrompts:    [],
        publishedPosts:     [],
        lastUpdated:        Date.now(),
      };
      await saveProductProfile(wid, newProfile);
      setProductProfile(newProfile);
      setShowOnboarding(false);
      onToast?.('פרופיל המוצר נשמר! הסוכן כבר מתחיל ללמוד 🚀', 'success');
    } catch {
      onToast?.('שגיאה בשמירה', 'error');
    } finally {
      setSavingOnboarding(false);
    }
  };

  // ── Generate copy variations ──────────────────────────────────────────
  const handleGenerateCopy = async () => {
    if (!copyGenGoal.trim()) { onToast?.('הכנס מטרת הקמפיין', 'error'); return; }
    setCopyGenLoading(true);
    setCopyGenResults([]);
    try {
      const results = await generateAdCopyVariations(
        productProfile?.productName || briefProduct || 'המוצר שלנו',
        briefAudience || 'קהל יעד',
        'facebook', copyGenGoal, copyGenType, 5
      );
      setCopyGenResults(results);
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setCopyGenLoading(false); }
  };

  const handleSaveCopyItem = async (text: string) => {
    if (!wid) { onToast?.('שגיאה: workspace לא מוגדר', 'error'); return; }
    try {
      await saveCopyItem(wid, {
        platform: 'facebook', type: copyGenType, text,
        tags: copyGenGoal ? [copyGenGoal] : [],
        usageCount: 0, createdAt: Date.now(),
        // performance intentionally omitted — Firestore rejects undefined
      });
      setCopyItems(await loadCopyLibrary(wid));
      onToast?.('נשמר לספרייה ✅', 'success');
    } catch (err) {
      onToast?.(`שגיאה בשמירה: ${(err as Error).message}`, 'error');
    }
  };

  // ── Generate AI Insights ──────────────────────────────────────────────
  const handleGetInsights = async () => {
    setInsightsLoading(true);
    try {
      const campData = myCampaigns.map(c => ({
        name: c.name, platform: c.platforms?.[0] || 'facebook',
        impressions: c.metrics?.reach || 0, clicks: 0,
        leads: 0, spend: c.budgetAmount || 0,
      }));
      const insights = await getAIInsights(campData, cfg?.businessDescription || '');
      setAnalyticsInsights(insights);
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setInsightsLoading(false); }
  };

  const handleGetBudgetRec = async () => {
    setBudgetLoading(true);
    try {
      const campData = myCampaigns.map(c => ({
        name: c.name, platform: c.platforms?.[0] || 'facebook',
        spend: c.budgetAmount || 0, leads: 0,
        cpl: c.budgetAmount ? c.budgetAmount / Math.max(1, 0) : 0,
      }));
      const rec = await getBudgetRecommendation(campData, Number(totalBudgetInput));
      setBudgetRec(rec);
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setBudgetLoading(false); }
  };

  // ── Build audience ────────────────────────────────────────────────────
  const handleBuildAudience = async () => {
    if (!audienceProduct) { onToast?.('הכנס מוצר', 'error'); return; }
    setAudienceLoading(true);
    try {
      const profile = await buildAudienceWithAI(audienceProduct, audienceGoal, audienceCustomers);
      if (wid) {
        await saveAudience(wid, { ...profile, createdAt: Date.now() });
        setAudiences(await loadAudiences(wid));
      }
      setShowAudienceForm(false);
      setAudienceProduct(''); setAudienceGoal(''); setAudienceCustomers('');
      onToast?.('קהל נשמר! ✅', 'success');
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setAudienceLoading(false); }
  };

  // ── Save competitor ad ────────────────────────────────────────────────
  const handleSaveCompetitor = async () => {
    if (!compName || !compAdText) { onToast?.('מלא שם וטקסט', 'error'); return; }
    if (!wid) return;
    await saveCompetitorAd(wid, {
      competitorName: compName, pageName: compName,
      adText: compAdText, platforms: ['facebook'],
      startDate: new Date().toISOString().split('T')[0], savedAt: Date.now(),
    });
    setCompetitors(await loadCompetitorAds(wid));
    setShowAddCompetitor(false); setCompName(''); setCompAdText('');
    onToast?.('נשמר ✅', 'success');
  };

  // ── Generate brief ────────────────────────────────────────────────────
  const handleGenerateBrief = async () => {
    if (!briefProduct || !briefGoal) { onToast?.('מלא מוצר ומטרה', 'error'); return; }
    setBriefLoading(true);
    try {
      const brief = await generateCampaignBrief(
        briefProduct, briefGoal, briefAudience,
        Number(briefBudget), cfg?.businessDescription || ''
      );
      setGeneratedBrief(brief);
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setBriefLoading(false); }
  };

  const handleSaveBrief = async () => {
    if (!generatedBrief || !wid) return;
    await saveBrief(wid, { ...generatedBrief, createdAt: Date.now() });
    setBriefs(await loadBriefs(wid));
    setGeneratedBrief(null);
    setShowBriefForm(false);
    onToast?.('בריף נשמר ✅', 'success');
  };

  // ── Retargeting ───────────────────────────────────────────────────────
  const handleGenerateRetarget = async () => {
    setRetargetLoading(true);
    try {
      const idea = await generateRetargetingIdea(
        productProfile?.productName || 'המוצר שלנו',
        'לקוחות שביקרו באתר',
        cfg?.businessDescription || ''
      );
      setRetargetIdea(idea);
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setRetargetLoading(false); }
  };

  const handleGenerateCampaignText = async () => {
    // Use custom prompt if provided, otherwise fall back to campaign name/goal
    const topic = campaignTextPrompt.trim()
      || [campaignName, campaignGoal].filter(Boolean).join(' — ')
      || 'קמפיין שיווקי';
    setCampaignTextGenerating(true);
    try {
      const text = await generatePostWithAI(
        topic,
        campaignTextTone,
        workspace?.prompt ?? workspace?.name ?? '',
        cfg.language === 'auto' ? 'he' : cfg.language,
      );
      setCampaignText(text);
    } catch {
      onToast?.('שגיאה ביצירת תוכן', 'error');
    } finally {
      setCampaignTextGenerating(false);
    }
  };

  const [captionGenerating, setCaptionGenerating] = useState(false);

  const handleGenerateCaptionForText = async () => {
    const imgItem = mediaGallery.find(i => i.type === 'image');
    if (!imgItem) { onToast?.('אין תמונות בגלריה לייצר כיתוב', 'error'); return; }
    setCaptionGenerating(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();

      // Resolve base64 from any URL type (data:, https://, blob:)
      let base64: string;
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
      if (imgItem.url.startsWith('data:')) {
        const match = imgItem.url.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Invalid data URL');
        mediaType = (match[1] as typeof mediaType);
        base64 = match[2];
      } else {
        // fetch https:// or blob: and convert to base64
        const blob = await fetch(imgItem.url).then(r => r.blob());
        mediaType = (blob.type || 'image/jpeg') as typeof mediaType;
        base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res((reader.result as string).split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        });
      }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: `כתוב כיתוב פוסט שיווקי קצר וממיר בעברית לתמונה זו. 2-3 שורות, אמוג'י מתאימים, קריאה לפעולה. פלט: הכיתוב בלבד.` },
          ],
        }],
      });
      const caption = (response.content.find((b: { type: string }) => b.type === 'text') as { text: string })?.text?.trim() ?? '';
      if (caption) { setCampaignText(caption); onToast?.('✍️ כיתוב נוצר!', 'success'); }
    } catch (err) {
      console.error('[caption]', err);
      onToast?.('שגיאה ביצירת כיתוב', 'error');
    }
    finally { setCaptionGenerating(false); }
  };

  /* ── Persist product assets to localStorage ─────────────────────────── */
  useEffect(() => {
    try { localStorage.setItem(ASSETS_LS_KEY, JSON.stringify(productAssets)); }
    catch { /* quota full — skip */ }
  }, [productAssets, ASSETS_LS_KEY]);

  /* ── Upload product asset image with canvas resize ───────────────────── */
  const handleAssetUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const newAssets: ProductAsset[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) { onToast?.(`${file.name} — רק תמונות נתמכות`, 'error'); continue; }
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          const img = new window.Image();
          img.onload = () => {
            const MAX = 600;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(img.width  * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = reject;
          img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      newAssets.push({ id: `asset_${Date.now()}_${Math.random().toString(36).slice(2)}`, url, name: file.name, addedAt: Date.now() });
    }
    if (newAssets.length) {
      setProductAssets(prev => [...prev, ...newAssets]);
      onToast?.(`${newAssets.length} תמונה נוספה ✅`, 'success');
    }
  };

  /* ── Enrich prompt with Claude Vision analysis of product assets ──────── */
  const enrichPromptWithAssets = async (basePrompt: string): Promise<string> => {
    if (!productAssets.length || !useAssets) return basePrompt;
    setEnriching(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();
      const imageContent = productAssets.slice(0, 4).map(a => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (a.url.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg') as 'image/jpeg' | 'image/png',
          data: a.url.split(',')[1],
        },
      }));
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `אלה תמונות מוצר/פרויקט שהמשתמש העלה. הפרומפט המקורי שלו: "${basePrompt}"\n\nתאר בקצרה (עד 3 משפטים) את המוצר/הפרויקט שרואים בתמונות (צבעים, סגנון, אופי), ואז כתוב פרומפט AI משופר לייצור מדיה שמשלב את הוויזואל של המוצר עם הפרומפט המקורי. ענה רק עם הפרומפט המשופר, ללא הסברים נוספים.`,
            },
          ],
        }],
      });
      const enriched = (response.content[0] as { type: string; text: string }).text.trim();
      onToast?.('פרומפט הועשר עם תמונות המוצר ✅', 'success');
      return enriched || basePrompt;
    } catch (e) {
      console.error('enrichPromptWithAssets failed:', e);
      onToast?.('לא הצלחתי לנתח תמונות — משתמש בפרומפט המקורי', 'info');
      return basePrompt;
    } finally {
      setEnriching(false);
    }
  };

  /* ── Wrapper: enrich then call handler ───────────────────────────────── */
  const handleGenerateWithAssets = async (handler: () => void) => {
    if (!productAssets.length || !useAssets) { handler(); return; }
    const enriched = await enrichPromptWithAssets(aiGenPrompt);
    overridePromptRef.current = enriched;
    handler();
  };

  const handleGeneratePost = async () => {
    if (!postTopic.trim()) { onToast?.('הזן נושא לפוסט', 'error'); return; }
    setAiGenerating(true);
    try {
      const text = await generatePostWithAI(
        postTopic, postTone, workspace?.prompt ?? workspace?.name ?? '',
        cfg.language === 'auto' ? 'he' : cfg.language,
      );
      setNewPostText(text);
    } catch {
      onToast?.('שגיאה ביצירת פוסט', 'error');
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePublishPost = async () => {
    if (!newPostText.trim()) return;
    if (publishPlatforms.length === 0) { onToast?.('בחר לפחות פלטפורמה אחת לפרסום', 'error'); return; }
    setPosting(true);
    const results: string[] = [];
    const errors:  string[] = [];
    const mediaUrl = postMedia?.type === 'image' ? postMedia.url : undefined;
    try {
      // Facebook (via existing page integration)
      if (publishPlatforms.includes('facebook') && pageAuth) {
        try {
          await createFacebookPost(pageAuth.pageId, newPostText, pageAuth.token, mediaUrl);
          results.push('Facebook');
        } catch (e) { errors.push(`Facebook: ${(e as Error).message}`); }
      }
      // Other social platforms (via postToSocial Cloud Function)
      for (const plt of publishPlatforms.filter(p => p !== 'facebook')) {
        const conn = socialConns.find(c => c.platform === plt && c.connected && c.accessToken);
        if (!conn) continue;
        try {
          await postToSocial(plt as Parameters<typeof postToSocial>[0], conn.accessToken!, newPostText, undefined, conn.pageId);
          results.push(plt);
        } catch (e) { errors.push(`${plt}: ${(e as Error).message}`); }
      }
      if (results.length > 0) {
        onToast?.(`פוסט פורסם ב: ${results.join(', ')} 🎉`, 'success');

        // ── Learning: record this published post ──────────────────────────────
        if (wid) {
          const learning: PostLearning = {
            text:       newPostText,
            tone:       postTone,
            topic:      postTopic || 'פוסט כללי',
            platforms:  results,
            mediaType:  postMedia?.type,
            mediaUrl:   postMedia?.url,
            publishedAt: Date.now(),
          };
          recordPublishedPost(wid, learning).catch(() => {});

          // If post had approved media, record it in the product profile
          if (postMedia) {
            recordApprovedMedia(wid, {
              id:          `post_${Date.now()}`,
              type:        postMedia.type,
              url:         postMedia.url,
              thumbnailUrl: postMedia.thumbnailUrl,
              prompt:      postMedia.prompt,
              style:       'social-ad',
              engine:      postMedia.engine,
              approvedAt:  Date.now(),
            }).catch(() => {});
          }
        }

        setShowNewPost(false);
        setNewPostText('');
        setPostTopic('');
        setShowPublishPicker(false);
        setPostMedia(null);
        loadPosts();
      }
      if (errors.length > 0) onToast?.(errors.join(' | '), 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleSchedulePost = async () => {
    if (!newPostText.trim() || !wid) return;
    await saveScheduledPost(wid, {
      message: newPostText,
      scheduledTime: Date.now() + 24 * 3600 * 1000,
      status: 'pending',
      createdAt: Date.now(),
    });
    onToast?.('פוסט נשמר לתזמון', 'success');
    setShowNewPost(false);
    setNewPostText('');
    setPostTopic('');
  };

  const handleScanComments = async () => {
    if (!pageAuth || posts.length === 0 || !wid) return;
    setScanningComments(true);
    try {
      const existingIds = new Set(drafts.map(d => d.commentId));
      const postToScan = selectedPost || posts[0]?.id;
      const comments = await fetchPostComments(postToScan, pageAuth.token);
      const processed = await processCommentsWithAI(
        wid, comments, cfg, workspace?.prompt ?? workspace?.name ?? '', existingIds,
      );
      const updated = await loadCommentDrafts(wid);
      setDrafts(updated);
      onToast?.(processed > 0 ? `נוצרו ${processed} טיוטות תגובה` : 'אין תגובות חדשות לעיבוד', 'success');
    } catch (e) {
      onToast?.(`שגיאה: ${(e as Error).message}`, 'error');
    } finally {
      setScanningComments(false);
    }
  };

  const handleApprove = async (draftId: string, text: string, commentId: string) => {
    if (!pageAuth) throw new Error('לא מחובר לדף');
    await replyToFacebookComment(commentId, text, pageAuth.token);
    await updateCommentDraft(wid!, draftId, { status: 'sent', aiDraft: text });
    setDrafts(ds => ds.map(d => d.id === draftId ? { ...d, status: 'sent', aiDraft: text } : d));
  };

  const handleIgnore = async (draftId: string) => {
    await updateCommentDraft(wid!, draftId, { status: 'ignored' });
    setDrafts(ds => ds.map(d => d.id === draftId ? { ...d, status: 'ignored' } : d));
  };

  const handleEditDraft = (draftId: string, text: string) => {
    setDrafts(ds => ds.map(d => d.id === draftId ? { ...d, aiDraft: text } : d));
    updateCommentDraft(wid!, draftId, { aiDraft: text }).catch(() => {});
  };

  const handleSaveCfg = async () => {
    if (!wid) return;
    setSavingCfg(true);
    try {
      await saveMarketingConfig(wid, cfg);
      onToast?.('הגדרות נשמרו', 'success');
    } catch {
      onToast?.('שגיאה בשמירה', 'error');
    } finally {
      setSavingCfg(false);
    }
  };

  /* ── Campaign creation handlers ──────────────────────────────────────────── */
  const handleSaveCampaign = async (status: 'draft' | 'published') => {
    if (!wid) { onToast?.('שגיאה פנימית', 'error'); return; }
    // Auto-fill name from first line of text if empty
    const resolvedName = campaignName.trim()
      || campaignText.split('\n').find(l => l.trim())?.replace(/[#*_]/g, '').trim().slice(0, 40)
      || 'קמפיין חדש';
    if (!campaignName.trim()) setCampaignName(resolvedName);
    setCampaignSaving(true);
    try {
      const id = `camp_${Date.now()}`;
      let publishResults: PublishResult[] | undefined;

      if (status === 'published') {
        // Resolve which Facebook page to publish to (use selected page if available)
        const orgSelectedPage = effectiveMeta?.pages?.find(p => p.id === campaignSelectedPageId)
          ?? effectiveMeta?.pages?.find(p => p.subscribed)
          ?? effectiveMeta?.pages?.[0];
        const orgPageToken = orgSelectedPage?.accessToken || effectiveMeta?.userAccessToken || pageAuth?.token;
        const orgPageId    = orgSelectedPage?.id ?? pageAuth?.pageId;

        const tasks = campaignPlatforms.map(async (platform): Promise<PublishResult> => {
          if (platform === 'facebook') {
            if (!orgPageId || !orgPageToken) return { platform, postId: '', error: 'לא מחובר' };
            try {
              const postId = await createFacebookPost(
                orgPageId, campaignText, orgPageToken, campaignMedia?.url,
              );
              const postUrl = `https://www.facebook.com/${postId}`;
              return { platform, postId, postUrl };
            } catch (e) {
              return { platform, postId: '', error: (e as Error).message };
            }
          } else if (platform === 'instagram') {
            if (!orgPageToken) return { platform, postId: '', error: 'Facebook לא מחובר' };
            const igAccountId = orgSelectedPage?.instagramBusinessAccountId as string | undefined;
            if (!igAccountId) return { platform, postId: '', error: 'אין חשבון Instagram מקושר לדף Facebook. צור קשר בין הדף ל-Instagram Business בהגדרות Meta.' };
            try {
              const postId = await createInstagramPost(igAccountId, campaignText, orgPageToken!, campaignMedia?.url);
              return { platform, postId, postUrl: `https://www.instagram.com/` };
            } catch (e) {
              return { platform, postId: '', error: (e as Error).message };
            }
          } else {
            const conn = socialConns.find(c => c.platform === platform && c.connected && c.accessToken);
            if (!conn) return { platform, postId: '', error: 'לא מחובר' };
            try {
              const res = await postToSocial(
                platform as Parameters<typeof postToSocial>[0],
                conn.accessToken!,
                campaignText,
                campaignMedia?.url,
                conn.pageId,
              );
              return { platform, postId: res.postId, postUrl: res.url };
            } catch (e) {
              return { platform, postId: '', error: (e as Error).message };
            }
          }
        });

        const settled = await Promise.allSettled(tasks);
        publishResults = settled.map(s =>
          s.status === 'fulfilled' ? s.value : { platform: '?', postId: '', error: String((s as PromiseRejectedResult).reason) }
        );

        const successes = publishResults.filter(r => !r.error).length;
        const failures  = publishResults.filter(r =>  r.error).length;
        if (successes > 0) {
          onToast?.(`פורסם ב-${successes} פלטפורמות${failures > 0 ? `, ${failures} שגיאות` : ''} ✅`, 'success');
        } else {
          onToast?.('לא הצלחנו לפרסם באף פלטפורמה', 'error');
        }
      }

      const record: CampaignRecord = {
        id, name: resolvedName, goal: campaignGoal,
        platforms: campaignPlatforms, text: campaignText, status,
        createdAt: Date.now(),
        // Only include media fields if media exists (Firestore rejects undefined values)
        ...(campaignMedia?.url           && { mediaUrl:          campaignMedia.url }),
        ...(campaignMedia?.thumbnailUrl  && { mediaThumbnailUrl: campaignMedia.thumbnailUrl }),
        ...(campaignMedia?.type          && { mediaType:         campaignMedia.type as CampaignRecord['mediaType'] }),
        ...(campaignMedia?.engine        && { mediaEngine:       campaignMedia.engine }),
        ...(status === 'published'       && { publishedAt: Date.now() }),
        ...(publishResults && publishResults.length > 0 && { publishResults }),
      };
      await setDoc(doc(db, 'workspaces', wid, 'maCampaigns', id), record);
      setMyCampaigns(prev => [record, ...prev]);
      setShowCampaignForm(false);
      resetCampaignForm();
      if (status === 'draft') {
        onToast?.(`קמפיין "${record.name}" נשמר כטיוטה! ✅`, 'success');
      }
    } catch {
      onToast?.('שגיאה בשמירת קמפיין', 'error');
    } finally {
      setCampaignSaving(false);
    }
  };

  /* ── Load media gallery from Firestore (real-time) ─────────────────────── */
  useEffect(() => {
    if (!wid) return;
    const q = query(
      collection(db, 'workspaces', wid, 'mediaGallery'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q,
      snap => {
        setMediaGallery(snap.docs.map(d => d.data() as MediaGalleryItem));
        setGalleryLoaded(true);
        // Migrate any old localStorage items on first load
        try {
          const raw = localStorage.getItem(GALLERY_LS_KEY);
          if (raw) {
            const old = (JSON.parse(raw) as MediaGalleryItem[])
              .filter(i => i.url && !i.url.startsWith('blob:') && !i.url.startsWith('data:'));
            // Only migrate items that are already storage URLs (not base64)
            old.forEach(item => {
              setDoc(doc(db, 'workspaces', wid, 'mediaGallery', item.id), item).catch(() => {});
            });
            localStorage.removeItem(GALLERY_LS_KEY);
          }
        } catch { /* ignore */ }
      },
      () => setGalleryLoaded(true)
    );
    return unsub;
  }, [wid]); // eslint-disable-line

  /* ── Load saved presentations from Firestore ───────────────────────────── */
  useEffect(() => {
    if (!wid || savedPresLoaded) return;
    getDocs(query(collection(db, 'workspaces', wid, 'presentations'), orderBy('updatedAt', 'desc')))
      .then(snap => {
        const loaded = snap.docs.map(d => d.data() as PresentationDoc);
        setSavedPresentations(loaded);
        setPresentations(loaded);   // restore editor state on refresh
        setSavedPresLoaded(true);
      })
      .catch(() => setSavedPresLoaded(true));
  }, [wid, savedPresLoaded]); // eslint-disable-line

  /* ── Save active presentation to Firestore ──────────────────────────────── */
  const handleSavePresentation = async () => {
    if (!activePresentation || !wid) return;
    setSavingPres(true);
    try {
      const toSave = { ...activePresentation, updatedAt: Date.now() };
      await setDoc(doc(db, 'workspaces', wid, 'presentations', activePresentation.id), toSave);
      setSavedPresentations(prev => {
        const exists = prev.some(p => p.id === activePresentation.id);
        if (exists) return prev.map(p => p.id === activePresentation.id ? toSave : p);
        return [toSave, ...prev];
      });
      onToast?.('המצגת נשמרה בהצלחה ✅', 'success');
    } catch {
      onToast?.('שגיאה בשמירת המצגת', 'error');
    } finally {
      setSavingPres(false);
    }
  };

  /* ── Delete a saved presentation from Firestore ─────────────────────────── */
  const handleDeleteSavedPresentation = async (presId: string) => {
    if (!wid) return;
    setSavedPresentations(prev => prev.filter(p => p.id !== presId));
    await deleteDoc(doc(db, 'workspaces', wid, 'presentations', presId)).catch(() => {});
  };

  /* ── Compress a data URL to max 768px JPEG (keeps Firestore docs <300KB) ─── */
  const compressImage = (dataUrl: string, maxPx = 768, quality = 0.82): Promise<string> =>
    new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl); // fallback: use original
      img.src = dataUrl;
    });

  /* ── Persist one gallery item to Firestore (data URLs compressed first) ──── */
  const persistGalleryItem = async (item: MediaGalleryItem): Promise<MediaGalleryItem> => {
    if (!wid || item.url.startsWith('blob:')) return item;
    let url = item.url;
    // Compress base64 images before storing (Firestore 1MB doc limit)
    if (url.startsWith('data:')) {
      url = await compressImage(url);
    }
    const persisted: MediaGalleryItem = { ...item, url, thumbnailUrl: url };
    try {
      await setDoc(doc(db, 'workspaces', wid, 'mediaGallery', item.id), persisted);
    } catch (e) {
      console.error('[gallery] Firestore save failed:', e);
    }
    return persisted;
  };

  /* ── Media Gallery helpers ─────────────────────────────────────────────── */
  const focusInStudio = (id: string) => {
    setStudioFocusId(id);
    setStudioFocusSeq(s => s + 1);
  };

  const addToGallery = (item: Omit<MediaGalleryItem, 'id' | 'createdAt'>) => {
    const entry: MediaGalleryItem = { ...item, id: Date.now().toString(), createdAt: Date.now() };
    // Optimistic local insert (onSnapshot will reconcile)
    setMediaGallery(prev => [entry, ...prev.slice(0, 49)]);
    // Auto-focus new item in studio
    focusInStudio(entry.id);
    // Async: upload to Storage + save to Firestore; update local URL when done
    persistGalleryItem(entry).then(persisted => {
      if (persisted.url !== entry.url) {
        setMediaGallery(prev => prev.map(i => i.id === entry.id ? persisted : i));
      }
    });
    return entry;
  };

  /* ── Update a gallery item (used by MediaStudio) ─────────────────────── */
  const handleUpdateGalleryItem = (updated: MediaGalleryItem) => {
    setMediaGallery(prev => prev.map(i => i.id === updated.id ? updated : i));
    // If URL is a new data URL (e.g. after "Save Edit" baking), re-upload
    persistGalleryItem(updated).then(persisted => {
      if (persisted.url !== updated.url) {
        setMediaGallery(prev => prev.map(i => i.id === updated.id ? persisted : i));
      }
    });
  };

  /* ── Delete a gallery item ───────────────────────────────────────────── */
  const handleDeleteGalleryItem = (id: string) => {
    setMediaGallery(prev => prev.filter(i => i.id !== id));
    if (wid) deleteDoc(doc(db, 'workspaces', wid, 'mediaGallery', id)).catch(console.error);
  };

  const handleRequestRegenerate = (prompt: string, type: 'image' | 'video', engine: string) => {
    setAiGenPrompt(prompt);
    if (engine === 'dalle')  setAiGenTool('dalle');
    else if (engine === 'veo') setAiGenTool('veo');
    else setAiGenTool('imagen');
    setCampaignMedia(null); // reveal AI gen form
    setShowMediaOptions(true);
    setShowMediaStudio(false);
    onToast?.('📝 פרומפט מוכן — לחץ על כפתור הייצור', 'info');
  };

  /* ── Upload file to Firebase Storage ──────────────────────────────────── */
  const handleFileUpload = (fileInput: File | React.ChangeEvent<HTMLInputElement>) => {
    const file = fileInput instanceof File ? fileInput : fileInput.target.files?.[0];
    if (!file) return;
    if (!wid) { onToast?.('לא ניתן להעלות — אין workspace מחובר', 'error'); return; }
    if (file.size > 100 * 1024 * 1024) { onToast?.('הקובץ גדול מדי (מקסימום 100MB)', 'error'); return; }

    const isVideo = file.type.startsWith('video/');
    const ext     = file.name.includes('.') ? file.name.split('.').pop() : (isVideo ? 'mp4' : 'jpg');
    const path    = `workspaces/${wid}/campaign-media/${Date.now()}.${ext}`;
    const sRef    = storageRef(storage, path);
    const task    = uploadBytesResumable(sRef, file, { contentType: file.type });

    setUploadingFile(true);
    setUploadProgress(0);

    task.on('state_changed',
      snap => {
        setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      err => {
        onToast?.(`שגיאה בהעלאה: ${err.message}`, 'error');
        setUploadingFile(false);
        setUploadProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          setCampaignMedia({ url, type: isVideo ? 'video-kling' : 'image', engine: 'upload', thumbnailUrl: isVideo ? '' : url, prompt: '' });
          onToast?.(isVideo ? 'וידאו הועלה ✅' : 'תמונה הועלתה ✅', 'success');
        } catch (err) {
          onToast?.(`שגיאה בקבלת URL: ${(err as Error).message}`, 'error');
        } finally {
          setUploadingFile(false);
          setUploadProgress(0);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    );
  };

  /* ── Generate free image via AI ────────────────────────────────────────── */
  const handlePollinations = async () => {
    if (!pollinationsPrompt.trim()) return;
    setPollinationsLoading(true);
    const prompt = pollinationsPrompt.trim();
    const encoded = encodeURIComponent(prompt);

    // Try multiple Pollinations models with retries to handle rate limiting
    const models = ['flux-schnell', 'turbo', 'flux'];
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const model = models[attempt % models.length];
      const seed  = (Date.now() + attempt * 7919) % 99999;
      const url   = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=1024&height=1024&nologo=true&seed=${seed}`;

      try {
        if (attempt === 0) {
          onToast?.('מייצר תמונה AI... (עד 60 שניות)', 'info');
        } else {
          onToast?.(`השרת עמוס — מנסה שוב (${attempt + 1}/${MAX_RETRIES})...`, 'info');
          // Wait before retry
          await new Promise(r => setTimeout(r, 4000));
        }

        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 90000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.status === 402) {
          // Rate limited — try next model after delay
          continue;
        }

        if (!res.ok) continue;

        const blob = await res.blob();
        if (!blob || blob.size < 500) continue; // Invalid response

        // Upload to Firebase Storage
        let finalUrl = '';
        if (wid) {
          const sRef = storageRef(storage, `workspaces/${wid}/media/ai_${Date.now()}.jpg`);
          await uploadBytes(sRef, blob, { contentType: blob.type || 'image/jpeg' });
          finalUrl = await getDownloadURL(sRef);
        } else {
          finalUrl = URL.createObjectURL(blob);
        }

        setCampaignMedia({ url: finalUrl, type: 'image', engine: 'pollinations', thumbnailUrl: finalUrl, prompt });
        setShowPollinationsForm(false);
        setShowMediaOptions(false);
        setPollinationsPrompt('');
        onToast?.('תמונה נוצרה ✅', 'success');
        setPollinationsLoading(false);
        return;

      } catch (err) {
        if ((err as Error).name === 'AbortError') continue;
        // CORS or network error — try next
        continue;
      }
    }

    // All attempts failed — try as direct <img> src as last resort
    try {
      const seed2     = Date.now() % 99999;
      const directUrl = `https://image.pollinations.ai/prompt/${encoded}?model=turbo&width=512&height=512&nologo=true&seed=${seed2}`;
      setCampaignMedia({ url: directUrl, type: 'image', engine: 'pollinations', thumbnailUrl: directUrl, prompt });
      setShowPollinationsForm(false);
      setShowMediaOptions(false);
      setPollinationsPrompt('');
      onToast?.('שרת התמונות עמוס — התמונה תנסה להיטען. אם לא הצליח, נסה שוב בעוד דקה 🔄', 'info');
    } finally {
      setPollinationsLoading(false);
    }
  };


  /* ── OpenAI image generation ────────────────────────────────────────────────
     dall-e-2/3 removed May 2026. Current: gpt-image-2, gpt-image-1           */
  const handleDallE = async () => {
    const effectivePrompt = overridePromptRef.current ?? aiGenPrompt;
    overridePromptRef.current = null;
    if (!effectivePrompt.trim()) return;
    if (!apiKeys.openai) { onToast?.('הזן OpenAI API Key בהגדרות', 'error'); return; }
    setAiGenLoading(true);
    // Nuclear fallback: force-reset after 35s no matter what
    if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
    aiGenTimerRef.current = setTimeout(() => {
      setAiGenLoading(false);
      onToast?.('הפעולה לקחה יותר מ-35 שניות — ייתכן שיש בעיית רשת או ה-API Key שגוי', 'error');
    }, 35000);

    // ── Step 0: Fast connectivity test (5s) ────────────────────────────────
    try {
      onToast?.('בודק חיבור ל-OpenAI...', 'info');
      const testResult = await Promise.race([
        (async () => {
          const r = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKeys.openai}` },
          });
          const d = await r.json().catch(() => ({})) as Record<string, unknown>;
          return { ok: r.ok, status: r.status, data: d };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('net_timeout')), 5000)),
      ]);
      if (!testResult.ok) {
        const errMsg = (testResult.data as Record<string,Record<string,string>>)?.error?.message ?? `HTTP ${testResult.status}`;
        const isBadKey = testResult.status === 401 || errMsg.includes('API key') || errMsg.includes('Incorrect') || errMsg.includes('invalid');
        if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
        setAiGenLoading(false);
        onToast?.(isBadKey ? `OpenAI API Key שגוי: ${errMsg}` : `OpenAI שגיאה: ${errMsg}`, 'error');
        return;
      }
      onToast?.('חיבור ל-OpenAI תקין ✓ — מייצר תמונה...', 'info');
    } catch (e) {
      if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
      setAiGenLoading(false);
      const em = (e as Error).message;
      onToast?.(em === 'net_timeout'
        ? 'לא ניתן להגיע ל-OpenAI — בדוק חיבור אינטרנט'
        : `שגיאת רשת OpenAI: ${em}`, 'error');
      return;
    }

    // Timeout covers BOTH fetch AND res.json() — no hanging possible
    const tFetch = (body: object): Promise<{ ok: boolean; status: number; data: unknown }> =>
      Promise.race([
        (async () => {
          const res  = await fetch('https://api.openai.com/v1/images/generations', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeys.openai}` },
            body:    JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, status: res.status, data };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
      ]);

    const b64ToUrl = async (b64: string): Promise<string> => {
      // Always return data URL immediately — bypasses Firebase Storage CORS issues
      return `data:image/png;base64,${b64}`;
    };

    try {
      let imageUrl  = '';
      let usedModel = '';
      let lastErr   = '';

      // Try gpt-image-1 first (more widely available), then gpt-image-2
      const attempts = [
        { model: 'gpt-image-1', body: { model: 'gpt-image-1', prompt: effectivePrompt, n: 1, size: '1024x1024' } },
        { model: 'gpt-image-2', body: { model: 'gpt-image-2', prompt: effectivePrompt, n: 1, size: '1024x1024' } },
      ];

      for (let i = 0; i < attempts.length; i++) {
        const { model, body } = attempts[i];
        try {
          onToast?.(`ניסיון ${i + 1}/${attempts.length} — ${model}...`, 'info');
          const { ok, status, data } = await tFetch(body);

          if (!ok) {
            const msg: string = (data as Record<string,Record<string,string>>)?.error?.message ?? `HTTP ${status}`;
            lastErr = msg;
            // Skip-able errors: model not found, org verification required
            if (status === 404 || status === 403 ||
                msg.includes('does not exist') || msg.includes('not found') ||
                msg.includes('model_not_found') || msg.includes('verification') ||
                msg.includes('unsupported')) {
              onToast?.(`${model} לא זמין — מנסה הבא...`, 'info');
              continue;
            }
            throw new Error(msg); // hard error (billing, auth) → stop
          }

          const item = (data as Record<string, Array<Record<string,string>>>)?.data?.[0];
          const b64       = item?.b64_json;
          const directUrl = item?.url;
          if (directUrl) { imageUrl = directUrl; usedModel = model; break; }
          if (b64)       { imageUrl = await b64ToUrl(b64); usedModel = model; break; }
          lastErr = 'לא התקבלה תמונה מ-OpenAI';

        } catch (e) {
          const em = (e as Error).message ?? '';
          if (em === 'timeout') { lastErr = 'timeout'; onToast?.(`${model} לא הגיב — מנסה הבא...`, 'info'); continue; }
          if ((e as Error).name === 'AbortError') { lastErr = 'timeout'; continue; }
          throw e;
        }
      }

      if (!imageUrl) {
        const isOrg = lastErr.includes('verification') || lastErr.includes('organization') || lastErr.includes('403');
        throw new Error(isOrg ? '__org_verify__' : lastErr || '__no_model__');
      }

      setCampaignMedia({ url: imageUrl, type: 'image', engine: 'dalle', thumbnailUrl: imageUrl, prompt: effectivePrompt });
      addToGallery({ url: imageUrl, type: 'image', engine: 'dalle', thumbnailUrl: imageUrl, prompt: effectivePrompt });
      setAiGenTool(null); setAiGenPrompt(''); setShowMediaOptions(false);
      setGeneratedImagePopup(imageUrl);
      onToast?.(`✅ תמונה ${usedModel} נוצרה!`, 'success');
      setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);

    } catch (err) {
      const msg = (err as Error).message ?? '';
      const isBilling = msg.includes('insufficient') || msg.includes('billing') || msg.includes('credit') || msg.includes('quota');
      onToast?.(
        msg === 'timeout'        ? 'OpenAI לא הגיב תוך 20 שניות — בדוק חיבור אינטרנט ונסה שוב' :
        msg === '__org_verify__' ? 'gpt-image דורש אימות ארגון — platform.openai.com → Settings → Organization → Verify' :
        msg === '__no_model__'   ? 'אין גישה למודלי תמונות OpenAI — ייתכן שנדרש אימות ארגון ב-platform.openai.com' :
        isBilling                ? 'אין קרדיטים — הוסף ב-platform.openai.com/billing' :
        `OpenAI שגיאה: ${msg}`,
        'error'
      );
    } finally {
      if (aiGenTimerRef.current) { clearTimeout(aiGenTimerRef.current); aiGenTimerRef.current = null; }
      setAiGenLoading(false);
    }
  };

  /* ── Google Imagen 4 / Gemini image generation ────────────────────────────*/
  const handleGoogleImagen = async () => {
    const effectivePrompt = overridePromptRef.current ?? aiGenPrompt;
    overridePromptRef.current = null;
    if (!effectivePrompt.trim()) return;
    if (!apiKeys.google) { onToast?.('הזן Google AI API Key בהגדרות', 'error'); return; }
    setAiGenLoading(true);
    if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
    aiGenTimerRef.current = setTimeout(() => {
      setAiGenLoading(false);
      onToast?.('Google API לא הגיב — ייתכן שה-Billing לא פעיל או ה-API Key שגוי', 'error');
    }, 35000);

    // ── Step 0: Fast connectivity test (5s) ─────────────────────────────────
    try {
      onToast?.('בודק חיבור ל-Google AI...', 'info');
      const testResult = await Promise.race([
        (async () => {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeys.google}`);
          const d = await r.json().catch(() => ({})) as Record<string, unknown>;
          return { ok: r.ok, status: r.status, data: d };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('net_timeout')), 5000)),
      ]);
      if (!testResult.ok) {
        const errMsg = (testResult.data as Record<string,Record<string,string>>)?.error?.message ?? `HTTP ${testResult.status}`;
        const isBadKey = testResult.status === 400 || testResult.status === 403 || errMsg.includes('API key') || errMsg.includes('invalid');
        if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
        setAiGenLoading(false);
        onToast?.(isBadKey ? `Google API Key שגוי: ${errMsg}` : `Google שגיאה: ${errMsg}`, 'error');
        return;
      }
      onToast?.('חיבור ל-Google AI תקין ✓ — מייצר תמונה...', 'info');
    } catch (e) {
      if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
      setAiGenLoading(false);
      const em = (e as Error).message;
      onToast?.(em === 'net_timeout'
        ? 'לא ניתן להגיע ל-Google API — בדוק חיבור אינטרנט'
        : `שגיאת רשת Google: ${em}`, 'error');
      return;
    }

    // Timeout covers BOTH fetch AND json() — no hanging possible
    const gFetch = (url: string, body: object): Promise<{ ok: boolean; status: number; data: unknown }> =>
      Promise.race([
        (async () => {
          const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, status: res.status, data };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
      ]);

    // Convert b64 to data URL — bypasses Firebase Storage CORS issues entirely
    const b64ToDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`;

    try {
      let imageUrl = '';
      let lastErr  = '';
      let attempt  = 0;
      // When the key is out of credits, no other model on it can succeed. Kept
      // as a flag so the cascade stops rather than emitting one failure toast
      // per model and still producing nothing.
      let outOfCredits = false;

      // ── Strategy 1: Imagen 4 via :predict (fastest, highest quality) ────────
      const imagenModels = ['imagen-4.0-fast-generate-001', 'imagen-4.0-generate-001'];
      for (const model of imagenModels) {
        if (imageUrl) break;
        attempt++;
        try {
          onToast?.(`ניסיון ${attempt} — Imagen 4 (${model})...`, 'info');
          const { ok, status, data } = await gFetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKeys.google}`,
            { instances: [{ prompt: effectivePrompt }], parameters: { sampleCount: 1, aspectRatio: '1:1' } }
          );
          const d = data as Record<string, unknown>;
          if (!ok) {
            const msg = (d.error as Record<string,string>)?.message ?? `HTTP ${status}`;
            lastErr = msg;
            if (isOutOfCredits(msg)) { outOfCredits = true; break; }
            const skip = status === 404 || status === 400 || msg.includes('not found') || msg.includes('INVALID_ARGUMENT');
            onToast?.(`${model}: ${msg.substring(0, 60)} — מנסה הבא...`, 'info');
            if (skip) continue;
            throw new Error(msg);
          }
          // Imagen 4 response: predictions[].bytesBase64Encoded  OR  generatedImages[].image.imageBytes
          const preds = d.predictions as Array<Record<string,string>> | undefined;
          const imgs  = d.generatedImages as Array<Record<string,Record<string,string>>> | undefined;
          const b64   = imgs?.[0]?.image?.imageBytes ?? preds?.[0]?.bytesBase64Encoded ?? '';
          const mime  = preds?.[0]?.mimeType ?? 'image/png';
          if (!b64) { lastErr = `${model} לא החזיר תמונה`; continue; }
          imageUrl = b64ToDataUrl(b64, mime);
        } catch (e) {
          const em = (e as Error).message ?? '';
          if (em === 'timeout') { lastErr = 'timeout'; onToast?.(`${model} לא הגיב — מנסה הבא...`, 'info'); continue; }
          lastErr = em;
        }
      }

      // ── Strategy 2: Gemini image models via :generateContent ─────────────────
      if (!imageUrl && !outOfCredits) {
        const geminiModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
        for (const model of geminiModels) {
          if (imageUrl) break;
          attempt++;
          try {
            onToast?.(`ניסיון ${attempt} — Gemini Image (${model})...`, 'info');
            const { ok: gOk, status: gStatus, data: gData } = await gFetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys.google}`,
              {
                contents: [{ parts: [{ text: effectivePrompt }] }],
                generationConfig: { responseModalities: ['IMAGE'] },
              }
            );
            const data = gData as Record<string, unknown>;
            if (!gOk) {
              const msg = (data.error as Record<string,string>)?.message ?? `HTTP ${gStatus}`;
              lastErr = msg;
              if (isOutOfCredits(msg)) { outOfCredits = true; break; }
              onToast?.(`${model}: ${msg.substring(0,60)} — מנסה הבא...`, 'info'); continue;
            }
            const cands = data.candidates as Array<Record<string,Record<string,Array<Record<string,Record<string,string>>>>>> | undefined;
            const parts = cands?.[0]?.content?.parts ?? [];
            const imgPart = parts.find((p: Record<string,Record<string,string>>) => p.inlineData?.mimeType?.startsWith('image/'));
            if (!imgPart?.inlineData) { lastErr = `${model} לא החזיר תמונה`; continue; }
            const { data: b64g, mimeType } = imgPart.inlineData;
            imageUrl = b64ToDataUrl(b64g, mimeType);
          } catch (e) {
            const em = (e as Error).message ?? '';
            if (em === 'timeout') { lastErr = 'timeout'; onToast?.(`${model} לא הגיב — מנסה הבא...`, 'info'); continue; }
            lastErr = em;
          }
        }
      }

      if (!imageUrl) {
        // Every keyed engine failed. Rather than leave the user with nothing,
        // fall back to the free engine — it needs no key and no balance. Said
        // out loud, because the result is a different model than they picked.
        try {
          onToast?.(outOfCredits
            ? 'נגמרו הקרדיטים ב-Google AI Studio — מייצר במנוע החינמי במקום'
            : 'המנועים של Google לא הגיבו — מייצר במנוע החינמי במקום', 'info');
          const { pollinationsImage, notPersisted } = await import('../lib/marketingAutopilot');
          imageUrl = await pollinationsImage(effectivePrompt, wid);
          if (notPersisted.has(imageUrl)) {
            onToast?.('התמונה נוצרה אך לא נשמרה — Firebase Storage לא מוגדר בפרויקט. היא תיעלם ברענון ולא ניתן לפרסם אותה.', 'error');
          }
        } catch (fallbackErr) {
          throw new Error(outOfCredits
            ? 'נגמרו הקרדיטים ב-Google AI Studio, וגם המנוע החינמי לא זמין כרגע. טען קרדיטים ב-aistudio.google.com או נסה שוב בעוד כמה דקות.'
            : (lastErr || (fallbackErr as Error).message || 'כל המודלים נכשלו'));
        }
      }

      setCampaignMedia({ url: imageUrl, type: 'image', engine: 'imagen', thumbnailUrl: imageUrl, prompt: effectivePrompt });
      addToGallery({ url: imageUrl, type: 'image', engine: 'imagen', thumbnailUrl: imageUrl, prompt: effectivePrompt });
      setAiGenTool(null); setAiGenPrompt(''); setShowMediaOptions(false);
      setGeneratedImagePopup(imageUrl);
      onToast?.('✅ תמונה Google נוצרה!', 'success');
      setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);

    } catch (err) {
      const msg = (err as Error).message ?? '';
      const billing = msg.includes('billing') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('PERMISSION_DENIED');
      onToast?.(
        msg === 'timeout' ? 'Google לא הגיב תוך 20 שניות — בדוק חיבור ונסה שוב' :
        billing           ? 'Google Imagen דורש Billing מופעל ב-Google Cloud' :
        `Google שגיאה: ${msg}`,
        'error'
      );
    } finally {
      if (aiGenTimerRef.current) { clearTimeout(aiGenTimerRef.current); aiGenTimerRef.current = null; }
      setAiGenLoading(false);
    }
  };

  /* ── Google Veo — video generation via predictLongRunning ─────────────── */
  const handleVeo = async () => {
    const effectivePrompt = overridePromptRef.current ?? aiGenPrompt;
    overridePromptRef.current = null;
    if (!effectivePrompt.trim()) return;
    if (!apiKeys.google) { onToast?.('הזן Google AI API Key בהגדרות', 'error'); return; }
    setAiGenLoading(true);
    if (aiGenTimerRef.current) clearTimeout(aiGenTimerRef.current);
    aiGenTimerRef.current = setTimeout(() => {
      setAiGenLoading(false);
      onToast?.('Veo לא הגיב תוך 3 דקות — ייתכן שה-Billing לא פעיל', 'error');
    }, 180000); // 3 minutes for video

    const gPost = (url: string, body: object): Promise<{ ok: boolean; status: number; data: unknown }> =>
      Promise.race([
        (async () => {
          const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, status: res.status, data };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);

    const gGet = (url: string): Promise<{ ok: boolean; data: unknown }> =>
      Promise.race([
        (async () => {
          const res  = await fetch(url);
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, data };
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('poll_timeout')), 12000)),
      ]);

    try {
      // ── Step 1: Start video generation ─────────────────────────────────────
      let operationName = '';
      let usedModel     = '';
      const veoModels   = ['veo-3.0-fast-generate-001', 'veo-3.0-generate-001', 'veo-2.0-generate-001'];

      for (const model of veoModels) {
        onToast?.(`מתחיל Veo (${model})...`, 'info');
        const { ok, status, data } = await gPost(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKeys.google}`,
          { instances: [{ prompt: effectivePrompt }], parameters: { aspectRatio: '16:9', sampleCount: 1 } }
        );
        const d = data as Record<string, unknown>;
        if (!ok) {
          const msg = (d.error as Record<string,string>)?.message ?? `HTTP ${status}`;
          onToast?.(`${model}: ${msg.substring(0, 70)} — מנסה הבא...`, 'info');
          continue;
        }
        operationName = (d.name as string) ?? '';
        usedModel     = model;
        break;
      }

      if (!operationName) throw new Error('כל מודלי Veo נכשלו — ייתכן שה-Billing לא פעיל');

      // ── Step 2: Poll until done (every 10s, up to 18 attempts = 3min) ──────
      onToast?.(`✅ Veo מייצר (${usedModel}) — זה עשוי לקחת 1-2 דקות...`, 'info');
      let videoUrl = '';

      for (let i = 0; i < 18; i++) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // wait 10s
        onToast?.(`Veo מכין... (${(i + 1) * 10}s)`, 'info');

        const { ok, data } = await gGet(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKeys.google}`
        );
        const d = data as Record<string, unknown>;
        if (!ok) throw new Error((d.error as Record<string,string>)?.message ?? 'שגיאת polling');

        if (!d.done) continue; // still generating

        // ── Parse response ──────────────────────────────────────────────────
        const resp  = d.response as Record<string, unknown> | undefined;
        const preds = resp?.predictions as Array<Record<string,string>> | undefined;

        // ── Parse generateVideoResponse ─────────────────────────────────────
        type GenVideoResp = {
          raiMediaFilteredCount?: number;
          raiMediaFilteredReasons?: string[];
          generatedSamples?: Array<{ video?: { uri?: string; encoding?: string }; bytesBase64Encoded?: string; mimeType?: string }>;
        };
        const genVideo = (resp?.generateVideoResponse ?? {}) as GenVideoResp;

        // Safety filter blocked the video
        if ((genVideo.raiMediaFilteredCount ?? 0) > 0) {
          const reason = genVideo.raiMediaFilteredReasons?.[0] ?? 'תוכן חסום על ידי מסנן הבטיחות של Google';
          throw new Error(`Veo חסם את הוידאו: שנה את הפרומפט ונסה שוב. (${reason.substring(0, 120)})`);
        }

        // Extract video from generatedSamples
        const sample = genVideo.generatedSamples?.[0];
        const b64    = sample?.bytesBase64Encoded ?? preds?.[0]?.bytesBase64Encoded;
        const rawUri = sample?.video?.uri ?? preds?.[0]?.uri ?? preds?.[0]?.gcsUri;
        const mime2  = sample?.mimeType ?? preds?.[0]?.mimeType ?? 'video/mp4';

        console.log('[Veo] sample:', JSON.stringify(sample).substring(0, 300));

        if (b64) {
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          videoUrl    = URL.createObjectURL(new Blob([bytes], { type: mime2 }));
          break;
        }

        if (rawUri) {
          onToast?.('Veo: מוריד וידאו...', 'info');
          try {
            const addKey = (u: string) => u.includes('?') ? `${u}&key=${apiKeys.google}` : `${u}?key=${apiKeys.google}`;
            const fetchUrl = rawUri.startsWith('gs://')
              ? rawUri.replace('gs://', 'https://storage.googleapis.com/')
              : addKey(rawUri);
            const vRes = await Promise.race([
              fetch(fetchUrl, { headers: { 'x-goog-api-key': apiKeys.google } }),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('dl_timeout')), 60000))
            ]);
            if (!vRes.ok) throw new Error(`HTTP ${vRes.status} — נסה שוב`);
            videoUrl = URL.createObjectURL(await vRes.blob());
          } catch (fe) {
            console.error('[Veo] download failed:', (fe as Error).message);
            throw new Error(`Veo: לא הצלחתי להוריד את הוידאו — ${(fe as Error).message}`);
          }
          break;
        }

        throw new Error('Veo החזיר done=true אבל אין וידאו — ייתכן שהפרומפט חסום');
      }

      if (!videoUrl) throw new Error('Veo לא סיים תוך 3 דקות');

      setCampaignMedia({ url: videoUrl, type: 'video', engine: 'veo', thumbnailUrl: '', prompt: effectivePrompt });
      addToGallery({ url: videoUrl, type: 'video', engine: 'veo', thumbnailUrl: '', prompt: effectivePrompt });
      setAiGenTool(null); setAiGenPrompt(''); setShowMediaOptions(false);
      onToast?.(`✅ וידאו Veo (${usedModel}) נוצר!`, 'success');
      setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);

    } catch (err) {
      const msg = (err as Error).message ?? '';
      const billing = msg.includes('billing') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('PERMISSION_DENIED');
      onToast?.(
        billing ? `Veo דורש Billing — ${msg.substring(0, 80)}` :
        msg === 'timeout' ? 'Veo לא הגיב — בדוק חיבור אינטרנט' :
        `Veo שגיאה: ${msg}`,
        'error'
      );
    } finally {
      if (aiGenTimerRef.current) { clearTimeout(aiGenTimerRef.current); aiGenTimerRef.current = null; }
      setAiGenLoading(false);
    }
  };

  /* ── HeyGen — opens external site (direct API blocked by CORS in browser) ── */
  const handleHeygenVideo = () => {
    // HeyGen's API blocks browser-side requests (no CORS headers).
    // Guide user to create the video on HeyGen's site and paste the URL back.
    const encoded = encodeURIComponent(aiGenPrompt.trim());
    window.open(`https://app.heygen.com/create?prompt=${encoded}`, '_blank');
    onToast?.('HeyGen נפתח בטאב חדש — צור את הוידאו, העתק את ה-URL והדבק בשדה "הכנס URL" למטה', 'info');
    setShowUrlInput(true);
  };

  /* ── Set media from URL input ──────────────────────────────────────────── */
  const handleSetMediaUrl = () => {
    if (!mediaUrlInput.trim()) return;
    const isVideo = /\.(mp4|mov|webm|avi)/i.test(mediaUrlInput);
    setCampaignMedia({ url: mediaUrlInput.trim(), type: isVideo ? 'video-kling' : 'image', engine: 'url', thumbnailUrl: mediaUrlInput.trim(), prompt: '' });
    setMediaUrlInput('');
    setShowUrlInput(false);
    setShowMediaOptions(false);
    onToast?.('מדיה נוספה ✅', 'success');
  };

  const handleRefreshMetrics = useCallback(async (camp: CampaignRecord) => {
    if (!wid || !pageAuth) return;
    const fbResult = camp.publishResults?.find(r => r.platform === 'facebook' && r.postId && !r.error);
    if (!fbResult) return;
    try {
      const metrics = await fetchPostMetrics(fbResult.postId, pageAuth.token);
      await updateDoc(doc(db, 'workspaces', wid, 'maCampaigns', camp.id), { metrics });
      setMyCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, metrics } : c));
    } catch {
      onToast?.('שגיאה בטעינת נתונים', 'error');
    }
  }, [wid, pageAuth, onToast]);

  /* ── Reset image preview status when campaignMedia changes ─────────────── */
  useEffect(() => {
    // data: URLs are already in memory — no network load needed, show immediately
    if (campaignMedia?.url?.startsWith('data:')) {
      setMediaPreviewStatus('ok');
    } else {
      setMediaPreviewStatus('loading');
    }
  }, [campaignMedia?.url]);

  /* ── Load GLOBAL API keys (managed by admin in the Admin Console) ───────── */
  useEffect(() => {
    getDoc(doc(db, 'system', 'apiKeys')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setApiKeys({ openai: d.openai ?? '', google: d.google ?? '', heygen: d.heygen ?? '', canva: d.canva ?? '' });
      }
    }).catch(() => {});
  }, []);

  /* ── Presentation export handlers ────────────────────────────────────────── */
  const GOOGLE_CLIENT_ID = '1006025078719-76fhqfnov6orhb6oaro8t8l2skeijmkf.apps.googleusercontent.com';

  const handleExportPPTX = async () => {
    if (!activePresId) return;
    const pres = presentations.find(p => p.id === activePresId);
    if (!pres) return;
    setExportingPres('pptx');
    try {
      await exportToPPTX(pres as PresDoc, mediaGallery);
      onToast?.('קובץ PPTX הורד בהצלחה ✅', 'success');
    } catch (e: unknown) {
      onToast?.(`שגיאת ייצוא: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally { setExportingPres(null); }
  };

  const handleExportGoogleSlides = async () => {
    if (!activePresId) return;
    const pres = presentations.find(p => p.id === activePresId);
    if (!pres) return;
    setExportingPres('slides');
    try {
      let token = slidesToken;
      if (!token) {
        token = await requestSlidesToken(GOOGLE_CLIENT_ID);
        setSlidesToken(token);
      }
      let url: string;
      try {
        url = await exportToGoogleSlides(pres as PresDoc, mediaGallery, token);
      } catch (inner: unknown) {
        const innerMsg = inner instanceof Error ? inner.message : String(inner);
        // 403 = API not enabled or stale token — force re-auth
        if (innerMsg.includes('403') || innerMsg.includes('token') || innerMsg.includes('auth')) {
          setSlidesToken(null);
          const freshToken = await requestSlidesToken(GOOGLE_CLIENT_ID);
          setSlidesToken(freshToken);
          url = await exportToGoogleSlides(pres as PresDoc, mediaGallery, freshToken);
        } else {
          if (innerMsg.includes('403')) {
            throw new Error('403 — ודא ש-Google Slides API ו-Drive API מופעלים ב-Google Cloud Console עבור הפרויקט שלך');
          }
          throw inner;
        }
      }
      // Extract presentationId from URL and fetch thumbnails in background
      const presIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)\//);
      const presId = presIdMatch?.[1] ?? null;
      setGoogleSlidesUrl(url);
      setThumbsPresId(presId);
      setGoogleSlidesThumbs([]);
      onToast?.('המצגת יוצאה ✅ — טוען תצוגה מקדימה...', 'success');
      if (presId) {
        setFetchingThumbs(true);
        const activeToken = slidesToken ?? token ?? '';
        fetchSlideThumbnails(presId, activeToken)
          .then(thumbs => setGoogleSlidesThumbs(thumbs))
          .catch(() => {}) // thumbnails are optional
          .finally(() => setFetchingThumbs(false));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSlidesToken(null);
      const friendly = msg.includes('403')
        ? 'גישה נדחתה (403) — הפעל Google Slides API ו-Drive API ב-Google Cloud Console'
        : msg;
      onToast?.(`שגיאה: ${friendly}`, 'error');
    } finally { setExportingPres(null); }
  };

  const handleGeneratePresWithAI = async () => {
    if (!aiPresPrompt.trim()) return;
    const useOpenAI = aiPresEngine === 'openai';
    if (useOpenAI && !apiKeys.openai)  { onToast?.('הזן OpenAI API Key בהגדרות', 'error'); return; }
    if (!useOpenAI && !apiKeys.google) { onToast?.('הזן Google AI API Key בהגדרות', 'error'); return; }

    setAiPresGenerating(true);
    setAiPresProgress('🧠 יוצר מבנה שקופיות...');
    try {
      /* ── Step 1: generate slide structure ─────────────────────────────── */
      const systemPrompt = `You are a professional presentation designer. The user will describe a presentation they want.
Return ONLY a valid JSON object (no markdown, no extra text) with this structure:
{
  "title": "Presentation title in the user's language",
  "slides": [
    {
      "title": "Slide title",
      "body": "2-3 sentences of slide body text",
      "imagePrompt": "Detailed English prompt for an AI image generator (photorealistic, descriptive)",
      "bgColor": "#hex color (dark, professional)",
      "textColor": "#ffffff or #f1f5f9",
      "layout": "image-right"
    }
  ]
}
Generate exactly ${aiPresSlideCount} slides. The layout field must be one of: text-only, image-right, image-left, image-top, image-full.
Vary the layouts. Write slide titles and body in the same language as the user's request. Image prompts must be in English.`;

      let slidesJson: { title: string; slides: Array<{ title: string; body: string; imagePrompt: string; bgColor: string; textColor: string; layout: string }> };

      if (useOpenAI) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeys.openai}` },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: aiPresPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.7,
          }),
        });
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (!res.ok || data.error) throw new Error(data.error?.message ?? `OpenAI error ${res.status}`);
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenAI לא החזיר תוכן');
        slidesJson = JSON.parse(content);
      } else {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeys.google}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: aiPresPrompt }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          }
        );
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
        if (!res.ok || data.error) throw new Error(data.error?.message ?? `Gemini error ${res.status}`);
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini לא החזיר תוכן');
        slidesJson = JSON.parse(text);
      }

      const rawSlides = Array.isArray(slidesJson.slides) ? slidesJson.slides : [];
      if (rawSlides.length === 0) throw new Error('ה-AI לא הצליח ליצור שקופיות — נסה לנסח מחדש את הפרומפט');
      const presTitle = slidesJson.title ?? aiPresPrompt.slice(0, 40);

      /* ── Step 2: generate images for each slide ────────────────────────── */
      const builtSlides: PresentationSlide[] = [];
      const newGalleryItems: MediaGalleryItem[] = [];

      for (let i = 0; i < rawSlides.length; i++) {
        const s = rawSlides[i];
        setAiPresProgress(`🎨 יוצר תמונה לשקופית ${i + 1} מתוך ${rawSlides.length}...`);

        let imageId: string | null = null;
        const layout = (['text-only','image-right','image-left','image-top','image-full'].includes(s.layout) ? s.layout : 'image-right') as PresentationSlide['layout'];

        if (s.imagePrompt && layout !== 'text-only') {
          try {
            let imageUrl: string | null = null;
            if (useOpenAI) {
              const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeys.openai}` },
                body: JSON.stringify({ model: 'dall-e-3', prompt: s.imagePrompt, n: 1, size: '1792x1024', response_format: 'b64_json' }),
              });
              const imgData = await imgRes.json() as { data?: Array<{ b64_json?: string }> };
              const b64 = imgData.data?.[0]?.b64_json;
              if (b64) imageUrl = `data:image/png;base64,${b64}`;
            } else {
              const imgRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKeys.google}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ instances: [{ prompt: s.imagePrompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } }),
                }
              );
              const imgData = await imgRes.json() as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
              const pred = imgData.predictions?.[0];
              if (pred?.bytesBase64Encoded) imageUrl = `data:${pred.mimeType ?? 'image/png'};base64,${pred.bytesBase64Encoded}`;
            }

            if (imageUrl) {
              const galleryItem: MediaGalleryItem = {
                id: `ai-pres-${Date.now()}-${i}`,
                type: 'image',
                url: imageUrl,
                thumbnailUrl: imageUrl,
                engine: useOpenAI ? 'dalle' : 'imagen',
                prompt: s.imagePrompt,
                createdAt: Date.now(),
              };
              newGalleryItems.push(galleryItem);
              imageId = galleryItem.id;
            }
          } catch { /* skip image if generation fails */ }
        }

        builtSlides.push({
          id: `sl-${Date.now()}-${i}`,
          title: s.title ?? '',
          body: s.body ?? '',
          imageId,
          bgColor: s.bgColor ?? '#1e1b4b',
          textColor: s.textColor ?? '#ffffff',
          layout,
        });
      }

      /* ── Step 3: add gallery items + create presentation ──────────────── */
      setAiPresProgress('✅ מסיים...');
      if (newGalleryItems.length > 0) {
        setMediaGallery(prev => [...newGalleryItems, ...prev]);
      }

      const newPres: PresentationDoc = {
        id: `pr-${Date.now()}`,
        name: presTitle,
        slides: builtSlides,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPresentations(prev => [newPres, ...prev]);
      setActivePresId(newPres.id);
      setActiveSlideIdx(0);
      setAiPresShowPanel(false);
      setAiPresPrompt('');
      onToast?.(`✅ המצגת "${presTitle}" נוצרה עם ${builtSlides.length} שקופיות`, 'success');
    } catch (e: unknown) {
      onToast?.(`שגיאה: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setAiPresGenerating(false);
      setAiPresProgress('');
    }
  };

  const handleClaudePresGenerate = async () => {
    if (!claudePresPrompt.trim()) return;
    const wantImages = claudePresWithImages && (claudePresImgEngine === 'dalle' ? !!apiKeys.openai : !!apiKeys.google);
    setClaudePresGenerating(true);
    setClaudePresProgress('🧠 Claude מתכנן את המצגת...');
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();
      const styleGuide = claudePresStyle === 'professional'
        ? 'Professional and formal tone, concise structured content with clear takeaways'
        : claudePresStyle === 'creative'
        ? 'Creative and engaging tone, storytelling approach with vivid descriptions and emotion'
        : 'Clean and minimal — short punchy headlines, minimal body text, lots of whitespace energy';

      const imageField = wantImages
        ? `      "imagePrompt": "Detailed English prompt for an AI image generator — photorealistic, descriptive, NO text/words in image"`
        : '';
      const imageNote = wantImages
        ? `\nFor every slide that is NOT "text-only" layout, provide a detailed "imagePrompt" in English for AI image generation. The imagePrompt must describe a real-world scene, object, or concept — never contain text or labels.`
        : '\nSet layout to "text-only" for all slides (no images needed).';

      const systemPrompt = `You are an expert presentation designer who creates compelling presentations.
Return ONLY a valid JSON object (no markdown fences, no extra text) with this exact structure:
{
  "name": "Presentation title in the user's language",
  "slides": [
    {
      "title": "Slide title (short, max 8 words)",
      "body": "2-3 sentences of engaging content",
${imageField ? imageField + ',\n' : ''}      "bgColor": "#1e1b4b",
      "textColor": "#ffffff",
      "layout": "text-only"
    }
  ]
}
Generate exactly ${claudePresSlideCount} slides.
Style: ${styleGuide}
Layout must be one of: text-only, image-right, image-left, image-top, image-full. Vary the layouts throughout.
Use these professional dark background colors (vary them): #1e1b4b, #0f172a, #14532d, #7f1d1d, #1e3a5f.
First slide should be a compelling title/intro slide (text-only or image-full).
Last slide should be a summary or call-to-action slide.
Write ALL titles and body text in the SAME LANGUAGE as the user's request.${imageNote}`;

      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: claudePresPrompt }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (resp as any).content?.find((b: any) => b.type === 'text')?.text ?? '';
      if (!text) throw new Error('Claude לא החזיר תוכן');

      const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(clean) as {
        name: string;
        slides: Array<{ title: string; body: string; imagePrompt?: string; bgColor: string; textColor: string; layout: string }>;
      };

      if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
        throw new Error('Claude לא הצליח ליצור שקופיות — נסה לנסח מחדש');
      }

      /* ── Generate images for each slide ─────────────────────────────────── */
      const builtSlides: PresentationSlide[] = [];
      const newGalleryItems: MediaGalleryItem[] = [];

      for (let i = 0; i < parsed.slides.length; i++) {
        const s = parsed.slides[i];
        const layout = (['text-only','image-right','image-left','image-top','image-full'].includes(s.layout)
          ? s.layout : 'text-only') as PresentationSlide['layout'];

        let imageId: string | null = null;

        if (wantImages && s.imagePrompt && layout !== 'text-only') {
          setClaudePresProgress(`🎨 יוצר תמונה לשקופית ${i + 1} מתוך ${parsed.slides.length}...`);
          try {
            let imageUrl: string | null = null;

            if (claudePresImgEngine === 'dalle') {
              const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeys.openai}` },
                body: JSON.stringify({ model: 'dall-e-3', prompt: s.imagePrompt, n: 1, size: '1792x1024', response_format: 'b64_json' }),
              });
              const imgData = await imgRes.json() as { data?: Array<{ b64_json?: string }> };
              const b64 = imgData.data?.[0]?.b64_json;
              if (b64) imageUrl = `data:image/png;base64,${b64}`;
            } else {
              const imgRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKeys.google}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ instances: [{ prompt: s.imagePrompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } }),
                }
              );
              const imgData = await imgRes.json() as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
              const pred = imgData.predictions?.[0];
              if (pred?.bytesBase64Encoded) imageUrl = `data:${pred.mimeType ?? 'image/png'};base64,${pred.bytesBase64Encoded}`;
            }

            if (imageUrl) {
              const galleryItem: MediaGalleryItem = {
                id: `claude-pres-${Date.now()}-${i}`,
                type: 'image',
                url: imageUrl,
                thumbnailUrl: imageUrl,
                engine: claudePresImgEngine,
                prompt: s.imagePrompt,
                createdAt: Date.now(),
              };
              newGalleryItems.push(galleryItem);
              imageId = galleryItem.id;
            }
          } catch { /* skip image if generation fails */ }
        }

        builtSlides.push({
          id: `sl-${Date.now()}-${i}`,
          title: s.title ?? '',
          body: s.body ?? '',
          imageId,
          bgColor: s.bgColor ?? '#1e1b4b',
          textColor: s.textColor ?? '#ffffff',
          layout,
        });
      }

      setClaudePresProgress('✅ מסיים...');

      // Persist generated images to Firestore so they survive the gallery's
      // onSnapshot reconciliation (otherwise they vanish) and show in the gallery.
      if (newGalleryItems.length > 0) {
        setMediaGallery(prev => [...newGalleryItems, ...prev]); // optimistic
        await Promise.all(newGalleryItems.map(item => persistGalleryItem(item)));
      }

      const newPres: PresentationDoc = {
        id: `pr-${Date.now()}`,
        name: parsed.name ?? claudePresPrompt.slice(0, 40),
        slides: builtSlides,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Persist the presentation to Firestore and add it to savedPresentations
      // so it appears in Media Studio's "מצגות" gallery (which reads from there).
      if (wid) {
        await setDoc(doc(db, 'workspaces', wid, 'presentations', newPres.id), newPres)
          .catch(e => console.error('[claude-pres save]', e));
      }
      setSavedPresentations(prev => [newPres, ...prev]);
      setPresentations(prev => [newPres, ...prev]);
      setActivePresId(newPres.id);
      setActiveSlideIdx(0);
      setPresPreview(false);
      setClaudePresPrompt('');
      // bring the editor canvas into view so the new presentation is visible
      setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      const imgCount = newGalleryItems.length;
      onToast?.(`✅ המצגת "${newPres.name}" נוצרה — ${builtSlides.length} שקופיות${imgCount > 0 ? ` + ${imgCount} תמונות` : ''}`, 'success');
    } catch (e: unknown) {
      onToast?.(`שגיאה: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setClaudePresGenerating(false);
      setClaudePresProgress('');
    }
  };

  const handleExportCanva = async () => {
    if (!activePresId) return;
    const pres = presentations.find(p => p.id === activePresId);
    if (!pres) return;
    if (!apiKeys.canva) { onToast?.('הזן Canva Client ID בהגדרות תחת "מפתחות API"', 'error'); return; }
    setExportingPres('canva');
    try {
      let token = canvaToken;
      if (!token) {
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        const state = crypto.randomUUID();
        const redirectUri = `${window.location.origin}/canva-callback`;
        const authUrl = getCanvaAuthUrl(apiKeys.canva, redirectUri, challenge, state);
        const code = await canvaOAuthPopup(authUrl, state);
        const { accessToken } = await exchangeCanvaCode(code, verifier, apiKeys.canva, redirectUri);
        token = accessToken;
        setCanvaToken(token);
      }
      const editUrl = await createCanvaPresentation(pres as PresDoc, mediaGallery, token);
      window.open(editUrl, '_blank');
      onToast?.('המצגת נפתחה בקאנבה ✅', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('token') || msg.includes('auth')) setCanvaToken(null);
      onToast?.(`שגיאת Canva: ${msg}`, 'error');
    } finally { setExportingPres(null); }
  };

  const resetCampaignForm = () => {
    setCampaignName(''); setCampaignGoal('מכירות'); setCampaignPlatforms(['facebook']);
    setCampaignMedia(null); setCampaignText(''); setCampaignType('organic'); setWizardStep(0); setCampaignPlatform(null);
    setCampaignObjective('OUTCOME_TRAFFIC'); setCampaignBudgetType('daily');
    setCampaignBudgetAmount('50'); setCampaignStartDate(''); setCampaignEndDate('');
    setCampaignAgeMin(18); setCampaignAgeMax(65); setCampaignGenders([]);
    setCampaignInterestTags(''); setCampaignHeadline(''); setCampaignWebsiteUrl('');
    setCampaignCta('LEARN_MORE'); setCampaignSelectedPageId(''); setCampaignSelectedAdAccountId('');
  };

  const handleCreatePaidCampaign = async () => {
    if (!wid || !campaignName.trim()) { onToast?.('הזן שם לקמפיין', 'error'); return; }
    const adAccountId = campaignSelectedAdAccountId
      || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE' && a.hasPaymentMethod)?.id
      || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE')?.id
      || effectiveMeta?.adAccountId;  // fallback to manually set ID

    if (!adAccountId) {
      onToast?.('אין חשבון פרסום — חבר מחדש את Facebook בהגדרות → אינטגרציות', 'error');
      return;
    }
    const selectedPage = effectiveMeta?.pages?.find(p => p.id === campaignSelectedPageId)
      ?? effectiveMeta?.pages?.find(p => p.subscribed)
      ?? effectiveMeta?.pages?.[0];
    if (!selectedPage) { onToast?.('אין דף Facebook מחובר', 'error'); return; }
    const pageToken = selectedPage.accessToken || effectiveMeta?.userAccessToken;
    if (!pageToken) { onToast?.('אין טוקן לדף Facebook — חבר מחדש', 'error'); return; }

    setPaidCampaignPublishing(true);
    try {
      const interests = campaignInterestTags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
        .map(name => ({ id: '', name }));

      const result = await createFacebookAdsCampaign({
        adAccountId,
        pageId:      selectedPage.id,
        pageToken,
        campaignName,
        objective:   campaignObjective,
        budgetType:  campaignBudgetType,
        budgetAmount: Number(campaignBudgetAmount),
        ...(campaignStartDate && { startTime: new Date(campaignStartDate).toISOString() }),
        ...(campaignEndDate   && { endTime:   new Date(campaignEndDate).toISOString() }),
        targeting: {
          countries:  [campaignCountry],
          ageMin:     campaignAgeMin,
          ageMax:     campaignAgeMax,
          genders:    campaignGenders,
          interests,
        },
        adCreative: {
          headline:     campaignHeadline || campaignName,
          primaryText:  campaignText,
          callToAction: campaignCta,
          websiteUrl:   campaignWebsiteUrl,
          ...(campaignMedia?.url && { imageUrl: campaignMedia.url }),
        },
      });

      const id = `camp_${Date.now()}`;
      const record: CampaignRecord = {
        id, name: campaignName, goal: campaignObjective,
        platforms: ['facebook'], text: campaignText,
        campaignType: 'paid',
        objective: campaignObjective,
        budgetType: campaignBudgetType,
        budgetAmount: Number(campaignBudgetAmount),
        adCampaignId: result.campaignId,
        adSetId: result.adSetId,
        adId: result.adId,
        adsManagerUrl: result.adsManagerUrl,
        targeting: {
          countries: [campaignCountry],
          ageMin: campaignAgeMin,
          ageMax: campaignAgeMax,
          genders: campaignGenders,
          interests: campaignInterestTags,
        },
        adHeadline: campaignHeadline,
        adWebsiteUrl: campaignWebsiteUrl,
        adCta: campaignCta,
        status: 'published',
        createdAt: Date.now(),
        publishedAt: Date.now(),
        publishResults: [{ platform: 'facebook', postId: result.adId, postUrl: result.adsManagerUrl }],
        ...(campaignMedia?.url           && { mediaUrl:         campaignMedia.url }),
        ...(campaignMedia?.thumbnailUrl  && { mediaThumbnailUrl:campaignMedia.thumbnailUrl }),
        ...(campaignMedia?.type          && { mediaType:        campaignMedia.type as CampaignRecord['mediaType'] }),
      };
      await setDoc(doc(db, 'workspaces', wid, 'maCampaigns', id), record);
      setMyCampaigns(prev => [record, ...prev]);
      setShowCampaignForm(false);
      resetCampaignForm();
      onToast?.(`קמפיין "${campaignName}" פורסם בFacebook Ads! ✅ Campaign ID: ${result.campaignId}`, 'success');
    } catch (e) {
      onToast?.(`שגיאה: ${(e as Error).message}`, 'error');
    } finally {
      setPaidCampaignPublishing(false);
    }
  };

  const handlePublishDraft = async (camp: CampaignRecord) => {
    if (!wid) return;
    setCampaignSaving(true);
    try {
      const tasks = camp.platforms.map(async (platform): Promise<PublishResult> => {
        if (platform === 'facebook') {
          if (!pageAuth) return { platform, postId: '', error: 'לא מחובר' };
          try {
            const postId = await createFacebookPost(
              pageAuth.pageId, camp.text, pageAuth.token, camp.mediaUrl,
            );
            return { platform, postId, postUrl: `https://www.facebook.com/${postId}` };
          } catch (e) {
            return { platform, postId: '', error: (e as Error).message };
          }
        } else if (platform === 'instagram') {
          if (!pageAuth) return { platform, postId: '', error: 'Facebook לא מחובר' };
          const igAccountId = connectedPage?.instagramBusinessAccountId as string | undefined;
          if (!igAccountId) return { platform, postId: '', error: 'אין חשבון Instagram מקושר לדף Facebook. צור קשר בין הדף ל-Instagram Business בהגדרות Meta.' };
          try {
            const postId = await createInstagramPost(igAccountId, camp.text, pageAuth.token, camp.mediaUrl);
            return { platform, postId, postUrl: `https://www.instagram.com/` };
          } catch (e) {
            return { platform, postId: '', error: (e as Error).message };
          }
        } else {
          const conn = socialConns.find(c => c.platform === platform && c.connected && c.accessToken);
          if (!conn) return { platform, postId: '', error: 'לא מחובר' };
          try {
            const res = await postToSocial(
              platform as Parameters<typeof postToSocial>[0],
              conn.accessToken!,
              camp.text,
              camp.mediaUrl,
              conn.pageId,
            );
            return { platform, postId: res.postId, postUrl: res.url };
          } catch (e) {
            return { platform, postId: '', error: (e as Error).message };
          }
        }
      });

      const settled = await Promise.allSettled(tasks);
      const publishResults: PublishResult[] = settled.map(s =>
        s.status === 'fulfilled' ? s.value : { platform: '?', postId: '', error: String((s as PromiseRejectedResult).reason) }
      );

      const successes = publishResults.filter(r => !r.error).length;
      const failures  = publishResults.filter(r =>  r.error).length;

      const updates = {
        status: 'published' as const,
        publishedAt: Date.now(),
        publishResults,
      };
      await updateDoc(doc(db, 'workspaces', wid, 'maCampaigns', camp.id), updates);
      setMyCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, ...updates } : c));

      if (successes > 0) {
        onToast?.(`פורסם ב-${successes} פלטפורמות${failures > 0 ? `, ${failures} שגיאות` : ''} ✅`, 'success');
      } else {
        onToast?.('לא הצלחנו לפרסם באף פלטפורמה', 'error');
      }
    } catch {
      onToast?.('שגיאה בפרסום', 'error');
    } finally {
      setCampaignSaving(false);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!wid) return;
    await deleteDoc(doc(db, 'workspaces', wid, 'maCampaigns', id)).catch(() => {});
    setMyCampaigns(prev => prev.filter(c => c.id !== id));
    onToast?.('קמפיין נמחק', 'info');
  };

  /* ── Social connection handlers ──────────────────────────────────────────── */
  const getSocialConn = (platform: SocialPlatform) =>
    socialConns.find(c => c.platform === platform) ?? { platform, connected: false };

  /** For Facebook/Instagram: derive from existing Meta integration */
  const handleConnectMeta = (platform: 'facebook' | 'instagram') => {
    if (!workspace?.metaIntegration?.connected) {
      onToast?.('יש לחבר Meta תחת הגדרות → אינטגרציות קודם', 'error');
      return;
    }
    const meta  = workspace.metaIntegration;
    const page  = meta.pages?.find(p => p.subscribed) ?? meta.pages?.[0];
    const token = page?.accessToken ?? meta.userAccessToken ?? '';
    const conn: SocialConnection = {
      platform,
      connected: true,
      accountName: page?.name ?? '',
      accountId:   page?.id   ?? '',
      accessToken: token,
      connectedAt: Date.now(),
    };
    saveSocialConnection(wid!, conn).then(() => {
      setSocialConns(prev => {
        const rest = prev.filter(c => c.platform !== platform);
        return [...rest, conn];
      });
      onToast?.(`${platform === 'facebook' ? 'Facebook' : 'Instagram'} חובר בהצלחה!`, 'success');
    }).catch(() => onToast?.('שגיאה בשמירה', 'error'));
  };

  /** For OAuth-based platforms (LinkedIn, TikTok, Twitter, YouTube) */
  const handleConnectOAuth = async (platform: SocialPlatform) => {
    if (!credClientId.trim() || !credClientSecret.trim()) {
      setShowCredModal(platform);
      return;
    }
    setConnectingPlatform(platform);
    try {
      const code = await openOAuthPopup(platform, credClientId.trim());
      // The exchange takes one options object. It was being called with four
      // positional arguments, so `platform` arrived undefined and every OAuth
      // connection failed at the token step after the popup succeeded.
      const { accessToken, refreshToken, expiresIn, accountName, accountId } =
        await exchangeSocialToken({ platform, code, workspaceId: workspace?.id ?? '' });
      const conn: SocialConnection = {
        platform,
        connected: true,
        accountName,
        accountId,
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        clientId: credClientId.trim(),
        connectedAt: Date.now(),
      };
      await saveSocialConnection(wid!, conn);
      setSocialConns(prev => [...prev.filter(c => c.platform !== platform), conn]);
      onToast?.(`${platform} חובר בהצלחה! ✅`, 'success');
      setShowCredModal(null);
      setCredClientId('');
      setCredClientSecret('');
    } catch (e) {
      onToast?.(`שגיאת חיבור: ${(e as Error).message}`, 'error');
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleDisconnect = async (platform: SocialPlatform) => {
    if (!wid) return;
    await deleteSocialConnection(wid, platform).catch(() => {});
    setSocialConns(prev => prev.filter(c => c.platform !== platform));
    onToast?.(`${platform} נותק`, 'info');
  };

  const handleCredModalSubmit = () => {
    if (!showCredModal) return;
    handleConnectOAuth(showCredModal);
  };

  /* ── Content AI — generate ──────────────────────────────────────────────── */
  const handleGenerateContent = async () => {
    if (!contentPrompt.trim()) { onToast?.('הזן פרומפט ליצירת תוכן', 'error'); return; }
    setContentGenerating(true);
    setContentResult('');
    setShowContentPublish(false);
    try {
      const typeLabel: Record<typeof contentType, string> = {
        post:          'פוסט לרשתות חברתיות',
        blog:          'מאמר בלוג',
        newsletter:    'ניוזלטר / אימייל שיווקי',
        'video-script':'תסריט לסרטון',
        'google-ad':   'מודעת גוגל (כותרת + תיאור)',
        other:         'תוכן שיווקי',
      };
      const lengthLabel = contentLength === 'short' ? 'קצר (עד 100 מילים)' : contentLength === 'medium' ? 'בינוני (100-300 מילים)' : 'ארוך (300+ מילים)';
      const toneLabel   = contentTone === 'friendly' ? 'ידידותי ומזמין' : contentTone === 'professional' ? 'מקצועי ואמין' : 'פורמלי ורשמי';

      const businessCtx = productProfile?.productName
        ? `העסק: ${productProfile.productName}. ${productProfile.productDescription}. קהל יעד: ${productProfile.targetAudience}.`
        : workspace?.prompt ?? workspace?.name ?? '';

      const text = await generatePostWithAI(
        `${typeLabel} | ${contentPrompt}`,
        contentTone,
        `${businessCtx}\nאורך: ${lengthLabel}. טון: ${toneLabel}.`,
        cfg.language === 'auto' ? 'he' : cfg.language,
      );
      setContentResult(text);
      setShowContentPublish(true);
      // default-select all connected platforms for publish
      const connected: string[] = [];
      if (isConnected) connected.push('facebook');
      socialConns.filter(c => c.connected && c.platform !== 'facebook').forEach(c => connected.push(c.platform));
      setContentPlatforms(connected.slice(0, 2));
    } catch (e) {
      console.error('[Content AI] generatePostWithAI failed:', e);
      const msg = (e as Error)?.message ?? String(e);
      onToast?.(`שגיאה ביצירת תוכן: ${msg}`, 'error');
    } finally {
      setContentGenerating(false);
    }
  };

  const handlePublishContent = async () => {
    if (!contentResult.trim() || contentPlatforms.length === 0) return;
    setPublishingContent(true);
    const results: string[] = [];
    const errors:  string[] = [];
    try {
      if (contentPlatforms.includes('facebook') && pageAuth) {
        try {
          await createFacebookPost(pageAuth.pageId, contentResult, pageAuth.token);
          results.push('Facebook');
        } catch (e) { errors.push(`Facebook: ${(e as Error).message}`); }
      }
      for (const plt of contentPlatforms.filter(p => p !== 'facebook' && p !== 'google')) {
        const conn = socialConns.find(c => c.platform === plt && c.connected && c.accessToken);
        if (!conn) continue;
        try {
          await postToSocial(plt as Parameters<typeof postToSocial>[0], conn.accessToken!, contentResult, undefined, conn.pageId);
          results.push(plt);
        } catch (e) { errors.push(`${plt}: ${(e as Error).message}`); }
      }
      if (results.length > 0) {
        onToast?.(`תוכן פורסם ב: ${results.join(', ')} 🎉`, 'success');
        // record for learning
        if (wid) {
          recordPublishedPost(wid, {
            text:       contentResult,
            tone:       contentTone,
            topic:      contentPrompt,
            platforms:  results,
            publishedAt: Date.now(),
          }).catch(() => {});
        }
        setShowContentPublish(false);
        setContentResult('');
        setContentPrompt('');
      }
      if (errors.length > 0) onToast?.(errors.join(' | '), 'error');
    } finally {
      setPublishingContent(false);
    }
  };

  /* ── Pending drafts ──────────────────────────────────────────────────────── */
  const pendingDrafts = drafts.filter(d => d.status === 'pending');
  const totalLeads    = leadsData.reduce((s, r) => s + r.count, 0);

  /* ── Onboarding steps ──────────────────────────────────────────────────── */
  const onboardingSteps = useMemo(() => [
    {
      id: 'meta', emoji: '📘', label: 'חבר Facebook/Meta',
      desc: 'נדרש לפרסום פוסטים, מנוהל מ-דף אינטגרציות',
      done: isConnected,
      action: () => onNavigate?.('integrations'),
      actionLabel: 'חבר Facebook →',
      color: '#1877f2',
    },
    {
      id: 'social', emoji: '📱', label: 'חבר רשת נוספת',
      desc: 'Instagram, LinkedIn, TikTok, X — פרסם לכולן',
      done: socialConns.filter(sc => sc.connected).length >= 1,
      action: () => onNavigate?.('integrations'),
      actionLabel: 'חבר רשתות →',
      color: '#e1306c',
    },
    {
      id: 'profile', emoji: '🏢', label: 'פרופיל עסקי',
      desc: 'שם, קהל יעד, סגנון ויזואלי — כך ה-AI יוצר תוכן',
      done: !!(productProfile?.productName) && (cfg.businessDescription?.length ?? 0) > 15,
      // The onboarding banner renders inside the autopilot tab; 'posts' was
      // removed, and targeting it blanked the page instead of showing it.
      action: () => { setShowOnboarding(true); setTab('autopilot'); },
      actionLabel: 'הגדר פרופיל →',
      color: '#8b5cf6',
    },
    {
      id: 'pillars', emoji: '🎯', label: 'נושאי תוכן',
      desc: 'הגדר 2+ נושאי ליבה לפרסומים שלך',
      done: (cfg.contentPillars?.length ?? 0) >= 2,
      action: () => setTab('settings'),
      actionLabel: `הגדר נושאים (${cfg.contentPillars?.length ?? 0}/2) →`,
      color: '#f59e0b',
    },
    {
      id: 'schedule', emoji: '📅', label: 'תזמון פרסום',
      desc: 'בחר תדירות פרסום — לא "ידני"',
      done: cfg.postFrequency !== 'manual',
      action: () => setTab('settings'),
      actionLabel: 'הגדר תזמון →',
      color: '#10b981',
    },
    {
      id: 'campaign', emoji: '🚀', label: 'קמפיין ראשון',
      desc: 'צור קמפיין — הסוכן יתחיל לייצר תוכן',
      done: myCampaigns.length > 0,
      action: () => { setTab('campaigns'); setShowCampaignForm(true); },
      actionLabel: 'צור קמפיין →',
      color: '#6366f1',
    },
  ], [isConnected, socialConns, productProfile, cfg.businessDescription, cfg.contentPillars, cfg.postFrequency, myCampaigns]);

  const onboardingDone     = onboardingSteps.every(s => s.done);
  const onboardingProgress = onboardingSteps.filter(s => s.done).length;
  const nextStep           = onboardingSteps.find(s => !s.done);

  /* ── Presentation helpers ──────────────────────────────────────────────── */
  const makeSlide = (): PresentationSlide => ({
    id: `sl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    title:'', body:'', imageId:null, bgColor:'#1e1b4b', textColor:'#ffffff', layout:'text-only',
  });
  const makePres = (): PresentationDoc => ({
    id: `pr-${Date.now()}`, name:'מצגת חדשה', slides:[makeSlide()], createdAt:Date.now(), updatedAt:Date.now(),
  });
  const updateSlide = (fn: (s: PresentationSlide) => PresentationSlide) => {
    if(!activePresentation||activeSlide===null) return;
    const updated: PresentationDoc = {
      ...activePresentation,
      slides: activePresentation.slides.map((s,i) => i===activeSlideIdx ? fn(s) : s),
      updatedAt: Date.now(),
    };
    setPresentations(ps => ps.map(p => p.id===activePresId ? updated : p));
  };
  const slideImage = (s: PresentationSlide | null | undefined) =>
    (s?.imageId ? mediaGallery.find(i=>i.id===s.imageId) ?? null : null);

  /* ═══════════════════════════════════════════════════════════════════════════
   * Render
   * ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="w-full space-y-5" dir="rtl">

      {/* ══ Generated image popup ════════════════════════════════════════════ */}
      {generatedImagePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setGeneratedImagePopup(null)}>
          <div className="relative max-w-lg w-full rounded-3xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <img src={generatedImagePopup} alt="תמונה שנוצרה" className="w-full object-contain max-h-[70vh]" />
            <div className="absolute top-0 inset-x-0 p-3 flex items-center justify-between"
              style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)' }}>
              <span className="text-white text-sm font-black">✅ התמונה נוצרה ונשמרה במדיה לקמפיין</span>
              <button onClick={() => setGeneratedImagePopup(null)}
                className="w-7 h-7 rounded-full bg-white/20 text-white flex items-center justify-center text-xs font-bold">✕</button>
            </div>
            <div className="p-3 flex gap-2" style={{ background: 'rgba(15,15,20,0.9)' }}>
              <button onClick={() => setGeneratedImagePopup(null)}
                className="flex-1 py-2 rounded-xl text-sm font-black text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                אישור — המשך לעריכה
              </button>
              <a href={generatedImagePopup} download target="_blank" rel="noopener noreferrer"
                onClick={() => setGeneratedImagePopup(null)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white no-underline flex items-center gap-1"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                ⬇ הורד
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ══ Header ══════════════════════════════════════════════════════════ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            <Megaphone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black" style={{ color: tc.textPrimary }}>סוכן שיווק AI</h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {/* Connected platforms indicators */}
              {isConnected && (
                <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(24,119,242,0.12)', border: '1px solid rgba(24,119,242,0.25)', color: '#1877f2' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1877f2]" /> {connectedPage?.name ?? 'Facebook'}
                </span>
              )}
              {socialConns.filter(sc => sc.connected && sc.platform !== 'facebook').map(sc => {
                const pm = PLATFORMS.find(p => p.id === sc.platform);
                return (
                  <span key={sc.platform} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: `${pm?.color ?? '#6366f1'}15`, border: `1px solid ${pm?.color ?? '#6366f1'}30`, color: pm?.color ?? '#6366f1' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: pm?.color ?? '#6366f1' }} />
                    {sc.accountName || pm?.label}
                  </span>
                );
              })}
              {!isConnected && (
                <span className="text-[10px]" style={{ color: tc.textMuted }}>אין חיבורים פעילים</span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => { setTab('campaigns'); setShowCampaignForm(true); }}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all"
          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
          <Plus size={14} /> קמפיין חדש
        </button>
      </div>

      {/* ══ ONBOARDING WIZARD ═══════════════════════════════════════════════ */}
      {!onboardingDone && !onboardingCollapsed && (
        <div className="rounded-3xl overflow-hidden shadow-xl"
          style={{ background: 'linear-gradient(135deg,rgba(79,70,229,0.1),rgba(124,58,237,0.07))', border: '1px solid rgba(99,102,241,0.28)' }}>
          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(135deg,rgba(79,70,229,0.18),rgba(124,58,237,0.1))' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg shadow-lg"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow: '0 0 20px rgba(79,70,229,0.4)' }}>
                📣
              </div>
              <div>
                <h2 className="font-black text-base" style={{ color: tc.textPrimary }}>הגדרת סוכן שיווק AI</h2>
                <p className="text-[11px]" style={{ color: tc.textMuted }}>השלם {6 - onboardingProgress} צעדים נוספים כדי שהסוכן יתחיל לפרסם</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {onboardingSteps.map(s => (
                    <div key={s.id} className="w-7 h-1.5 rounded-full transition-all"
                      style={{ background: s.done ? '#10b981' : 'rgba(255,255,255,0.15)' }} />
                  ))}
                </div>
                <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>{onboardingProgress}/6</span>
              </div>
              <button onClick={() => setOnboardingCollapsed(true)}
                className="p-1.5 rounded-xl" style={{ color: tc.textMuted, background: 'rgba(255,255,255,0.06)' }}>
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Steps grid */}
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {onboardingSteps.map((step, idx) => (
              <div key={step.id}
                className="rounded-2xl p-3.5 transition-all cursor-pointer hover:scale-[1.02]"
                style={{
                  background: step.done
                    ? `linear-gradient(135deg,${step.color}14,${step.color}07)`
                    : step === nextStep ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
                  border: step.done ? `1px solid ${step.color}38` : step === nextStep ? '1px solid rgba(99,102,241,0.35)' : `1px solid rgba(255,255,255,0.06)`,
                  boxShadow: step === nextStep ? '0 0 18px rgba(99,102,241,0.12)' : 'none',
                }}
                onClick={step.done ? undefined : step.action}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xl">{step.emoji}</span>
                  {step.done
                    ? <CheckCheck size={14} style={{ color: step.color }} />
                    : <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black"
                        style={{ background: step === nextStep ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)', color: step === nextStep ? '#818cf8' : tc.textMuted, border: `1px solid ${step === nextStep ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                        {idx + 1}
                      </span>
                  }
                </div>
                <p className="text-[11px] font-bold mb-1 leading-tight" style={{ color: step.done ? step.color : tc.textPrimary }}>{step.label}</p>
                <p className="text-[9px] leading-relaxed mb-2" style={{ color: tc.textMuted }}>{step.desc}</p>
                {!step.done ? (
                  <div className="text-center text-[9px] font-bold py-1 rounded-lg transition-all"
                    style={{
                      background: step === nextStep ? `linear-gradient(135deg,${step.color},${step.color}cc)` : 'rgba(255,255,255,0.05)',
                      color: step === nextStep ? 'white' : tc.textMuted,
                    }}>
                    {step === nextStep ? step.actionLabel : 'עדיין לא'}
                  </div>
                ) : (
                  <p className="text-[9px] font-bold" style={{ color: step.color }}>✓ הושלם</p>
                )}
              </div>
            ))}
          </div>

          {/* CTA */}
          {nextStep && (
            <div className="px-5 pb-5">
              <button onClick={nextStep.action}
                className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:scale-[1.005] shadow-lg"
                style={{ background: `linear-gradient(135deg,${nextStep.color},${nextStep.color}cc)`, boxShadow: `0 4px 20px ${nextStep.color}38` }}>
                <span className="flex items-center gap-2">
                  <span>{nextStep.emoji}</span>
                  <span>הצעד הבא: {nextStep.label}</span>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsed bar */}
      {!onboardingDone && onboardingCollapsed && (
        <button onClick={() => setOnboardingCollapsed(false)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
          style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
          <Rocket size={14} style={{ color: '#818cf8' }} />
          <span className="text-sm font-semibold" style={{ color: tc.textSecondary }}>
            הגדרת הסוכן — {onboardingProgress}/6 שלבים הושלמו
          </span>
          <div className="flex-1 h-1.5 rounded-full mx-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(onboardingProgress / 6) * 100}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
          </div>
          <ChevronDown size={13} style={{ color: tc.textMuted }} />
        </button>
      )}

      {/* All-done banner */}
      {onboardingDone && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl"
          style={{ background: 'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(5,150,105,0.07))', border: '1px solid rgba(16,185,129,0.28)' }}>
          <BadgeCheck size={18} style={{ color: '#10b981' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: '#10b981' }}>הסוכן מוגדר ומוכן לפרסם!</p>
            <p className="text-[11px]" style={{ color: tc.textMuted }}>
              {[isConnected && connectedPage?.name, ...socialConns.filter(sc => sc.connected).map(sc => PLATFORMS.find(p => p.id === sc.platform)?.label)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={() => { setTab('campaigns'); setShowCampaignForm(true); }}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
            🚀 צור קמפיין
          </button>
        </div>
      )}

      {/* Pending comments alert */}
      {pendingDrafts.length > 0 && (
        <button onClick={() => { setTab('campaigns'); setCampaignsSubTab('comments'); }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all hover:scale-[1.005]"
          style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.1),rgba(217,119,6,0.07))', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div className="w-7 h-7 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(245,158,11,0.18)' }}>
            <MessageSquare size={14} style={{ color: '#f59e0b' }} />
          </div>
          <div className="flex-1 text-right">
            <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>
              {pendingDrafts.length} תגובה{pendingDrafts.length !== 1 ? 'ות' : ''} ממתינ{pendingDrafts.length !== 1 ? 'ות' : 'ת'} לאישורך
            </p>
            <p className="text-[10px]" style={{ color: tc.textMuted }}>הסוכן הכין תגובות AI — לחץ לאישור</p>
          </div>
          <ArrowRight size={14} style={{ color: '#f59e0b' }} />
        </button>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
        style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${tc.cardBorder}`, scrollbarWidth: 'none' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-1 justify-center"
            style={tab === id
              ? { background: isDark ? 'rgba(99,102,241,0.22)' : 'white', color: '#6366f1',
                  boxShadow: isDark ? '0 0 12px rgba(99,102,241,0.18)' : '0 1px 6px rgba(0,0,0,0.08)',
                  border: '1px solid rgba(99,102,241,0.28)' }
              : { color: tc.textMuted, background: 'transparent', border: '1px solid transparent' }}
          >
            <Icon size={13} />
            {label}
            {id === 'campaigns' && pendingDrafts.length > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                {pendingDrafts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Sub-tabs inside "פרסום ברשתות" (lifecycle: create → audiences → comments → analytics) ── */}
      {tab === 'campaigns' && (
        <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
          style={{ background: isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.05)', border: `1px solid ${isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.18)'}`, scrollbarWidth: 'none' }}>
          {CAMPAIGNS_SUBTABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setCampaignsSubTab(id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-1 justify-center"
              style={campaignsSubTab === id
                ? { background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: '#fff', boxShadow: '0 2px 10px rgba(124,58,237,0.3)' }
                : { color: tc.textMuted, background: 'transparent', border: '1px solid transparent' }}
            >
              <Icon size={13} />
              {label}
              {id === 'comments' && pendingDrafts.length > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                  {pendingDrafts.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* TAB: POSTS — REMOVED */}
      {false && tab === 'posts_removed' && (
        <div className="space-y-4">

          {/* ── Smart Onboarding banner ─────────────────────────────────── */}
          {showOnboarding && (
            <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-700 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/30 dark:to-violet-900/20 p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">🤖</span>
                    <h3 className="font-black text-slate-800 dark:text-white">בוא נכיר את המוצר שלך!</h3>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                    כדי שה-AI יוכל ליצור תוכן ומדיה שמדויקים לך — תן לו להכיר את העסק. ככל שידע יותר, הוא יהיה אוטומטי יותר.
                  </p>
                </div>
                <button onClick={() => setShowOnboarding(false)} className="p-1.5 rounded-xl hover:bg-white/50 transition-colors">
                  <X size={14} className="text-slate-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">שם העסק / המוצר *</label>
                  <input
                    type="text"
                    value={onboardingName}
                    onChange={e => setOnboardingName(e.target.value)}
                    className="w-full text-sm rounded-xl border border-indigo-200 dark:border-indigo-700 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="למשל: מסעדת הגינה הירוקה"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">קהל יעד</label>
                  <input
                    type="text"
                    value={onboardingAudience}
                    onChange={e => setOnboardingAudience(e.target.value)}
                    className="w-full text-sm rounded-xl border border-indigo-200 dark:border-indigo-700 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="למשל: משפחות, גיל 30-55"
                    dir="rtl"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">תיאור קצר של העסק</label>
                  <input
                    type="text"
                    value={onboardingDesc}
                    onChange={e => setOnboardingDesc(e.target.value)}
                    className="w-full text-sm rounded-xl border border-indigo-200 dark:border-indigo-700 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="מה אתם עושים? מה מייחד אתכם?"
                    dir="rtl"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">סגנון ויזואלי (מופרד בפסיק)</label>
                  <input
                    type="text"
                    value={onboardingStyle}
                    onChange={e => setOnboardingStyle(e.target.value)}
                    className="w-full text-sm rounded-xl border border-indigo-200 dark:border-indigo-700 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="למשל: minimalist, warm, luxury, fun, professional"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveOnboarding}
                  disabled={savingOnboarding || !onboardingName.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  {savingOnboarding
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Sparkles size={13} />
                  }
                  שמור ותן לסוכן להכיר אותך
                </button>
                <button
                  onClick={() => setShowOnboarding(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  אחר כך
                </button>
                <span className="text-[10px] text-indigo-400 mr-auto">
                  {productProfile?.approvedMedia.length
                    ? `✓ ${productProfile.approvedMedia.length} מדיות ו-${productProfile.publishedPosts?.length ?? 0} פוסטים למידה`
                    : 'הסוכן ילמד מכל פוסט ומדיה שתאשר'}
                </span>
              </div>
            </div>
          )}

          {/* ── Profile completion hint (when not onboarding) ────────────── */}
          {!showOnboarding && !productProfile?.productName && (
            <button
              onClick={() => setShowOnboarding(true)}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-indigo-300 dark:border-indigo-700 text-xs font-semibold text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Sparkles size={13} />
              הגדר פרופיל מוצר — ה-AI יצור תוכן שמותאם אישית לעסק שלך
              <ChevronRight size={12} className="mr-auto" />
            </button>
          )}

          {/* ── Learning progress strip (when profile exists) ────────────── */}
          {productProfile?.productName && (
            <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-4 py-2.5">
              <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-800 flex items-center justify-center flex-shrink-0">
                <Star size={13} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  הסוכן מכיר את <span className="font-black">{productProfile.productName}</span>
                </p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                  {productProfile.approvedMedia.length} מדיות ·{' '}
                  {productProfile.publishedPosts?.length ?? 0} פוסטים · מדייק עם כל פרסום
                </p>
              </div>
              <button
                onClick={() => { setShowOnboarding(true); setOnboardingName(productProfile.productName); setOnboardingDesc(productProfile.productDescription); setOnboardingAudience(productProfile.targetAudience); setOnboardingStyle(productProfile.styleKeywords.join(', ')); }}
                className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline flex-shrink-0"
              >
                עדכן
              </button>
            </div>
          )}

          {/* Insights row */}
          {insights && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="עוקבים" value={fmtNum(insights.fans)} icon={Users} color="#1877f2" />
              <StatCard label="חשיפות (30 יום)" value={fmtNum(insights.reach)} icon={Eye} color="#8b5cf6" />
              <StatCard label="אינטראקציות" value={fmtNum(insights.engagement)} icon={Heart} color="#ec4899" />
              <StatCard label="פוסטים שפורסמו" value={posts.length} icon={FileText} color="#10b981" />
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNewPost(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
            >
              <Plus size={14} />
              צור פוסט חדש
            </button>
            <button
              onClick={loadPosts}
              disabled={postsLoading}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw size={13} className={postsLoading ? 'animate-spin' : ''} />
              רענן
            </button>
          </div>

          {/* New post panel */}
          {showNewPost && (
            <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-5 space-y-4">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Zap size={15} className="text-indigo-500" />
                יצירת פוסט עם AI
              </h3>

              {/* Topic + tone row */}
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="נושא הפוסט (למשל: מבצע קיץ, שירות חדש...)"
                  className="flex-1 text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={postTopic}
                  onChange={e => setPostTopic(e.target.value)}
                  dir="rtl"
                />
                <select
                  className="text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
                  value={postTone}
                  onChange={e => setPostTone(e.target.value as typeof postTone)}
                >
                  <option value="friendly">ידידותי</option>
                  <option value="professional">מקצועי</option>
                  <option value="formal">פורמלי</option>
                </select>
                <button
                  onClick={handleGeneratePost}
                  disabled={aiGenerating}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  {aiGenerating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  כתוב AI
                </button>
              </div>

              {/* Post textarea */}
              <textarea
                className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 p-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                rows={5}
                placeholder="תוכן הפוסט..."
                value={newPostText}
                onChange={e => setNewPostText(e.target.value)}
                dir="rtl"
              />

              {/* ── Media section ───────────────────────────────────────── */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Image size={12} />
                    מדיה לפוסט
                    {productProfile?.approvedMedia.length
                      ? <span className="text-[10px] font-normal text-indigo-400">· AI לומד מ-{productProfile.approvedMedia.length} מדיות קודמות</span>
                      : null}
                  </p>
                  {postMedia && (
                    <button
                      onClick={() => setPostMedia(null)}
                      className="text-[10px] text-red-400 hover:text-red-600 font-semibold"
                    >
                      הסר
                    </button>
                  )}
                </div>

                {postMedia ? (
                  /* ── Media preview ── */
                  <div className="relative rounded-xl overflow-hidden bg-slate-900">
                    {postMedia.type === 'image' ? (
                      <img src={postMedia.url} alt="מדיה לפוסט" className="w-full max-h-48 object-cover" />
                    ) : (
                      <div className="flex items-center gap-3 p-3">
                        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-slate-800">
                          {postMedia.thumbnailUrl
                            ? <img src={postMedia.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-2xl">🎬</div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white">
                            {postMedia.type === 'video-kling' ? '🎬 סרטון Kling' : '✨ סרטון Nano Banana'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">{postMedia.prompt}</p>
                        </div>
                        <a href={postMedia.url} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                          <Eye size={12} className="text-white" />
                        </a>
                      </div>
                    )}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/50 text-[10px] text-white font-semibold flex items-center gap-1">
                      <Check size={9} /> מאושר
                    </div>
                  </div>
                ) : (
                  /* ── Add media buttons ── */
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setShowPostMediaCreator(true)}
                      className="w-full flex flex-col items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-indigo-200 dark:border-indigo-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-6 h-6 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                            <Image size={12} className="text-rose-500" />
                          </div>
                          <div className="w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                            <Video size={12} className="text-violet-500" />
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-indigo-500 group-hover:text-indigo-600">
                          צור תמונה או וידאו עם AI
                        </span>
                      </div>
                      {productProfile?.productName && (
                        <p className="text-[10px] text-slate-400">
                          מותאם אישית ל{productProfile.productName}
                          {productProfile.approvedMedia.length > 0 ? ` · סגנון מ-${productProfile.approvedMedia.length} מדיות` : ''}
                        </p>
                      )}
                    </button>
                    {mediaGallery.length > 0 && (
                      <button
                        onClick={() => setShowGalleryPicker('post')}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-violet-200 dark:border-violet-700 hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 transition-all"
                      >
                        <div className="flex -space-x-1">
                          {mediaGallery.filter(i=>i.type==='image').slice(0,3).map(i=>(
                            <img key={i.id} src={i.url} alt="" className="w-5 h-5 rounded object-cover border border-white dark:border-slate-700"/>
                          ))}
                        </div>
                        <span className="text-xs font-semibold" style={{ color:'#7c3aed' }}>בחר מגלריית הסטודיו ({mediaGallery.length})</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ── Platform picker ─────────────────────────────────────── */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">פרסם ל:</p>
                <div className="flex gap-2 flex-wrap">
                  {/* Facebook */}
                  {isConnected && (() => {
                    const on = publishPlatforms.includes('facebook');
                    return (
                      <button
                        onClick={() => setPublishPlatforms(prev => on ? prev.filter(p => p !== 'facebook') : [...prev, 'facebook'])}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                          on ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-500 text-slate-500 hover:border-blue-400'
                        }`}
                      >
                        📘 Facebook {connectedPage?.name ? `(${connectedPage.name})` : ''}
                      </button>
                    );
                  })()}
                  {/* Other connected platforms */}
                  {socialConns.filter(c => c.connected && c.accessToken && c.platform !== 'facebook').map(c => {
                    const pm = PLATFORMS.find(p => p.id === c.platform);
                    const on = publishPlatforms.includes(c.platform);
                    return (
                      <button
                        key={c.platform}
                        onClick={() => setPublishPlatforms(prev => on ? prev.filter(p => p !== c.platform) : [...prev, c.platform])}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                          on ? 'text-white border-transparent' : 'border-slate-200 dark:border-slate-500 text-slate-500 hover:border-indigo-400'
                        }`}
                        style={on ? { background: pm?.color } : {}}
                      >
                        {pm?.emoji} {c.accountName || pm?.label}
                      </button>
                    );
                  })}
                  {/* Shortcut to add more */}
                  {!isConnected && socialConns.filter(c=>c.connected).length === 0 && (
                    <button
                      onClick={() => setTab('settings')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-500"
                    >
                      <Plus size={10} /> חבר רשת חברתית
                    </button>
                  )}
                </div>
                {publishPlatforms.length === 0 && (
                  <p className="text-xs text-amber-500">⚠️ בחר לפחות פלטפורמה אחת לפרסום</p>
                )}
              </div>

              {/* Post actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePublishPost}
                  disabled={posting || !newPostText.trim() || publishPlatforms.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  פרסם ב-{publishPlatforms.length > 0 ? publishPlatforms.length : '?'} פלטפורמות
                </button>
                <button
                  onClick={handleSchedulePost}
                  disabled={!newPostText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <Clock size={13} />
                  תזמן
                </button>
                <button
                  onClick={() => { setShowNewPost(false); setNewPostText(''); setPostTopic(''); }}
                  className="px-3 py-2 rounded-xl text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}

          {/* Posts list */}
          {postsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <FileText size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{isConnected ? 'לא נמצאו פוסטים בדף' : 'חבר דף פייסבוק כדי לראות פוסטים'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {posts.map(post => <PostCard key={post.id} post={post} />)}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * SUB-TAB: COMMENTS (inside פרסום ברשתות)
       * ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'campaigns' && campaignsSubTab === 'comments' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className="text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
              value={selectedPost}
              onChange={e => setSelectedPost(e.target.value)}
            >
              <option value="">פוסט אחרון</option>
              {posts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.message.slice(0, 50)}...
                </option>
              ))}
            </select>
            <button
              onClick={handleScanComments}
              disabled={scanningComments || !isConnected}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
            >
              {scanningComments ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              סרוק תגובות עם AI
            </button>
            <span className="text-xs text-slate-500">
              {pendingDrafts.length} תגובות ממתינות
            </span>
          </div>

          {/* Drafts list */}
          {pendingDrafts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MessageSquare size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">אין תגובות הממתינות לאישור</p>
              <p className="text-xs mt-1">לחץ על "סרוק תגובות" כדי לעבד תגובות חדשות</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDrafts.map(draft => (
                <CommentDraftCard
                  key={draft.id}
                  draft={draft}
                  onApprove={handleApprove}
                  onEdit={handleEditDraft}
                  onIgnore={handleIgnore}
                  pageToken={pageAuth?.token ?? ''}
                  onToast={onToast}
                />
              ))}
            </div>
          )}

          {/* Sent/ignored history */}
          {drafts.filter(d => d.status !== 'pending').length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3">היסטוריה</h3>
              <div className="space-y-2">
                {drafts.filter(d => d.status !== 'pending').map(draft => (
                  <div key={draft.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        draft.status === 'sent' ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{draft.fromName}</p>
                      <p className="text-xs text-slate-500 truncate">{draft.commentText}</p>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {draft.status === 'sent' ? '✓ נשלח' : 'התעלמתי'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: LEAD SOURCES
       * ══════════════════════════════════════════════════════════════════════ */}
      {false && tab === 'leads_removed' && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="סה״כ לידים" value={totalLeads} icon={Users} color="#4f46e5" />
            <StatCard label="מקורות פעילים" value={leadsData.length} icon={MapPin} color="#10b981" />
            <StatCard
              label="תקציב כולל"
              value={`₪${leadsData.reduce((s, r) => s + r.budget, 0).toLocaleString('he-IL')}`}
              icon={TrendingUp}
              color="#f59e0b"
            />
          </div>

          {!leadsLoaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
          ) : leadsData.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <MapPin size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">לא נמצאו לידים</p>
            </div>
          ) : (
            <>
              {/* Source breakdown cards */}
              <div className="space-y-3">
                {leadsData.map(row => {
                  const color = SOURCE_COLORS[row.source] ?? '#94a3b8';
                  const pct = totalLeads > 0 ? Math.round((row.count / totalLeads) * 100) : 0;
                  return (
                    <div key={row.source}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                          <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">{row.source}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-500">{row.count} לידים</span>
                          <span className="text-sm font-black" style={{ color }}>{pct}%</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-slate-400">
                          תקציב ממוצע: ₪{row.count > 0 ? Math.round(row.budget / row.count).toLocaleString('he-IL') : 0}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          סה״כ: ₪{row.budget.toLocaleString('he-IL')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Info panel */}
              <div className="rounded-2xl border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-4">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">מעקב UTM אוטומטי</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
                      כדי לעקוב אחר מקור לידים מקמפיינים, הוסף פרמטרי UTM לקישורים שלך:
                    </p>
                    <code className="block mt-2 text-[11px] bg-blue-100 dark:bg-blue-800/50 rounded-lg p-2 text-blue-800 dark:text-blue-300 font-mono break-all">
                      ?utm_source=facebook&utm_medium=ad&utm_campaign=campaign_name
                    </code>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: STUDIO — Media Studio + AI Generation + Text + Gallery + Presentations
       * ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'studio' && (
        <div className="space-y-4" dir="rtl">


            {/* Two-column: MediaStudio (left) + AI gen (right) */}
            <div className="flex gap-4" ref={mediaSectionRef}>

              {/* LEFT: Media Studio */}
              <div className="flex-1 min-w-0 flex flex-col">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  {mediaContentType === 'presentation' ? 'עורך מצגת' : 'סטודיו מדיה'}
                </label>
                <div style={{ flex: 1, minHeight: 560, overflow: 'hidden', position: 'relative' }}>
                  {/* Slide preview navigation arrows */}
                  {mediaContentType === 'presentation' && presPreview && activePresentation && activePresentation.slides.length > 1 && (
                    <>
                      <button onClick={()=>setPresCurrentIdx(i=>Math.max(0,i-1))} disabled={presCurrentIdx===0}
                        style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',zIndex:20,width:40,height:40,borderRadius:'50%',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(6px)',color:'#fff',border:'1.5px solid rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:presCurrentIdx===0?0.3:1,transition:'opacity 0.15s' }}
                        title="שקופית קודמת"><ChevronRight size={20}/></button>
                      <button onClick={()=>setPresCurrentIdx(i=>Math.min((activePresentation.slides?.length??1)-1,i+1))} disabled={presCurrentIdx===(activePresentation.slides?.length??1)-1}
                        style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',zIndex:20,width:40,height:40,borderRadius:'50%',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(6px)',color:'#fff',border:'1.5px solid rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:presCurrentIdx===(activePresentation.slides?.length??1)-1?0.3:1,transition:'opacity 0.15s' }}
                        title="שקופית הבאה"><ChevronLeft size={20}/></button>
                    </>
                  )}
                  {/* Slide navigation arrows (edit mode) */}
                  {mediaContentType === 'presentation' && !presPreview && activePresentation && activePresentation.slides.length > 1 && (
                    <>
                      <button onClick={()=>setActiveSlideIdx(i=>Math.max(0,i-1))} disabled={activeSlideIdx===0}
                        style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',zIndex:20,width:40,height:40,borderRadius:'50%',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(6px)',color:'#fff',border:'1.5px solid rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:activeSlideIdx===0?0.3:1,transition:'opacity 0.15s' }}
                        title="שקופית קודמת"><ChevronRight size={20}/></button>
                      <button onClick={()=>setActiveSlideIdx(i=>Math.min(activePresentation.slides.length-1,i+1))} disabled={activeSlideIdx===activePresentation.slides.length-1}
                        style={{ position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',zIndex:20,width:40,height:40,borderRadius:'50%',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(6px)',color:'#fff',border:'1.5px solid rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',opacity:activeSlideIdx===activePresentation.slides.length-1?0.3:1,transition:'opacity 0.15s' }}
                        title="שקופית הבאה"><ChevronLeft size={20}/></button>
                      <div style={{ position:'absolute',left:'50%',bottom:12,transform:'translateX(-50%)',zIndex:20,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)',borderRadius:8,padding:'2px 10px',color:'#fff',fontSize:11,fontWeight:700 }}>
                        {activeSlideIdx+1} / {activePresentation.slides.length}
                      </div>
                    </>
                  )}
                  {/* Slide preview view */}
                  {mediaContentType === 'presentation' && presPreview && activePresentation ? (() => {
                    const slides = activePresentation.slides ?? [];
                    if (slides.length === 0) { setPresPreview(false); return null; }
                    const safeIdx = Math.min(Math.max(presCurrentIdx, 0), slides.length - 1);
                    const cur = slides[safeIdx];
                    const img = slideImage(cur);
                    return (
                      <div className="w-full h-full flex flex-col" style={{ background:'#000', borderRadius:12 }}>
                        <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden" style={{ background:cur?.bgColor??'#1e1b4b' }}>
                          {img && cur.layout==='image-full' && <img src={img.url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60"/>}
                          <div className={`relative z-10 w-full flex ${cur.layout==='image-right'?'flex-row-reverse gap-6':cur.layout==='image-left'?'flex-row gap-6':cur.layout==='image-top'?'flex-col items-center gap-4':'flex-col items-center justify-center'} items-center`}>
                            {img && cur.layout!=='text-only' && cur.layout!=='image-full' && (
                              <img src={img.url} alt="" className={`object-cover rounded-xl shadow-xl ${cur.layout==='image-top'?'w-48 h-32':'w-52 h-40'}`}/>
                            )}
                            <div className={`${cur.layout==='text-only'||cur.layout==='image-full'?'text-center':'text-right'} space-y-3`}>
                              {cur.title && <h2 className="text-3xl font-black leading-tight" style={{ color:cur.textColor }}>{cur.title}</h2>}
                              {cur.body && <p className="text-base leading-relaxed whitespace-pre-wrap" style={{ color:cur.textColor,opacity:0.85 }}>{cur.body}</p>}
                            </div>
                          </div>
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                            {slides.map((_,i) => (
                              <button key={i} onClick={()=>setPresCurrentIdx(i)} className="rounded-full transition-all"
                                style={{ width:i===presCurrentIdx?20:8,height:8,background:i===presCurrentIdx?cur.textColor:`${cur.textColor}40` }}/>
                            ))}
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5" style={{ background:'rgba(0,0,0,0.85)' }}>
                          <div className="flex items-center gap-2">
                            <button onClick={()=>setPresCurrentIdx(i=>Math.max(0,i-1))} disabled={presCurrentIdx===0}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-30" style={{ background:'rgba(255,255,255,0.15)' }}>← הקודמת</button>
                            <span className="text-white text-xs font-semibold tabular-nums">{presCurrentIdx+1} / {slides.length}</span>
                            <button onClick={()=>setPresCurrentIdx(i=>Math.min(slides.length-1,i+1))} disabled={presCurrentIdx===slides.length-1}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-30" style={{ background:'rgba(255,255,255,0.15)' }}>הבאה →</button>
                          </div>
                          <button onClick={()=>{setPresPreview(false);setPresCurrentIdx(0);}}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background:'#ef4444' }}>✕ סגור</button>
                        </div>
                      </div>
                    );
                  })() : (
                  <MediaStudio
                    gallery={mediaGallery}
                    isDark={isDark}
                    onUpdateItem={handleUpdateGalleryItem}
                    onDeleteItem={handleDeleteGalleryItem}
                    onAddToGallery={addToGallery}
                    onUseInCampaign={item => {
                      if (mediaContentType === 'presentation') {
                        if (!activeSlide) { onToast?.('בחר שקופית תחילה', 'error'); return; }
                        updateSlide(s => ({ ...s, imageId: item.id, layout: s.layout === 'text-only' ? 'image-right' : s.layout }));
                        onToast?.(`✅ תמונה הוכנסה לשקופית "${activeSlide.title || `שקופית ${activeSlideIdx+1}`}"`, 'success');
                      } else {
                        setCampaignMedia({ url:item.url, type:item.type==='video'?'video':'image', engine:item.engine as GeneratedMedia['engine'], thumbnailUrl:item.thumbnailUrl??'', prompt:item.prompt, generatedAt:item.createdAt });
                        onToast?.('✅ מדיה נבחרה לקמפיין — עבור לטאב פרסום', 'success');
                      }
                    }}
                    onRequestRegenerate={handleRequestRegenerate}
                    onToast={onToast}
                    focusId={mediaContentType === 'presentation' ? (activeSlide?.imageId ?? null) : studioFocusId}
                    focusSeq={mediaContentType === 'presentation' ? activeSlideIdx : studioFocusSeq}
                    onUseCaption={text => setCampaignText(text)}
                    useInCampaignLabel={mediaContentType === 'presentation' ? (activeSlide ? `הכנס לשקופית ${activeSlideIdx+1}` : 'בחר שקופית') : undefined}
                    allClosedInitially={mediaContentType === 'presentation'}
                    slideMode={mediaContentType === 'presentation' && activePresentation ? {
                      slides: activePresentation.slides,
                      activeIndex: activeSlideIdx,
                      presentationName: activePresentation.name,
                      savingPres,
                      onSelectSlide: (i) => setActiveSlideIdx(i),
                      onUpdateSlide: updateSlide,
                      onUpdatePresName: (name) => setPresentations(ps => ps.map(p => p.id === activePresId ? { ...p, name } : p)),
                      onSave: handleSavePresentation,
                      onDeleteSlide: () => {
                        setPresentations(ps => ps.map(p => p.id === activePresId ? { ...p, slides: p.slides.filter((_,i) => i !== activeSlideIdx), updatedAt: Date.now() } : p));
                        setActiveSlideIdx(i => Math.max(0, i - 1));
                      },
                    } : undefined}
                  />
                  )}
                </div>
                {mediaContentType !== 'presentation' && campaignMedia && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    {campaignMedia.type === 'image' && <img src={campaignMedia.url} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0"/>}
                    {campaignMedia.type === 'video' && <span className="text-lg">🎬</span>}
                    <span className="text-xs font-semibold flex-1" style={{ color: '#059669' }}>✓ מדיה נבחרה לקמפיין</span>
                    <button onClick={() => setTab('campaigns')} className="text-xs font-bold px-2.5 py-1 rounded-lg text-white" style={{ background: '#6366f1' }}>פרסם ←</button>
                    <button onClick={() => setCampaignMedia(null)} className="p-1 rounded-lg hover:opacity-75" style={{ color: '#dc2626' }}><X size={12}/></button>
                  </div>
                )}
              </div>

              {/* RIGHT: Content Panel */}
              <div className="flex-shrink-0 flex flex-col gap-3" style={{ width: 300 }}>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">סוג תוכן</label>

                {/* Type selector — 3 options */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl"
                  style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                  {([
                    ['image', '🖼️', 'תמונה'],
                    ['video', '🎥', 'וידאו'],
                    ['presentation', '🖥️', 'מצגת'],
                  ] as const).map(([type, icon, label]) => (
                    <button key={type}
                      onClick={() => {
                        setMediaContentType(type);
                        if (type === 'video') { if (aiGenTool !== 'veo' && aiGenTool !== 'heygen') setAiGenTool('veo'); }
                        else if (type === 'image') { if (aiGenTool === 'veo' || aiGenTool === 'heygen' || aiGenTool === null) setAiGenTool('imagen'); }
                      }}
                      className="py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5"
                      style={{ background: mediaContentType === type ? '#7c3aed' : 'transparent', color: mediaContentType === type ? '#fff' : tc.textMuted, boxShadow: mediaContentType === type ? '0 2px 10px rgba(124,58,237,0.35)' : 'none' }}>
                      <span>{icon}</span><span>{label}</span>
                    </button>
                  ))}
                </div>

                {/* ── IMAGE / VIDEO mode ──────────────────────────────────── */}
                {mediaContentType !== 'presentation' && (<>

                {/* Engine selector — image mode */}
                {aiGenTool !== 'veo' && aiGenTool !== 'heygen' && (
                  <div className="grid grid-cols-2 gap-2">
                    {([['imagen','🎨','Google Imagen','#4285f4'],['dalle','🖼️','DALL-E','#10b981']] as const).map(([eng,icon,lbl,color]) => (
                      <button key={eng} onClick={() => setAiGenTool(eng)}
                        className="py-2.5 rounded-xl text-xs font-bold border-2 transition-all flex items-center justify-center gap-1.5"
                        style={{ borderColor: aiGenTool===eng ? color : (isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.09)'), background: aiGenTool===eng ? `${color}18` : (isDark?'rgba(255,255,255,0.02)':'rgba(0,0,0,0.01)'), color: aiGenTool===eng ? color : tc.textMuted }}>
                        <span>{icon}</span><span>{lbl}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Engine selector — video mode */}
                {(aiGenTool === 'veo' || aiGenTool === 'heygen') && (
                  <div className="grid grid-cols-2 gap-2">
                    {([['veo','🎬','Google Veo','#7c3aed'],['heygen','🎭','HeyGen','#8b5cf6']] as const).map(([eng,icon,lbl,color]) => (
                      <button key={eng} onClick={() => setAiGenTool(eng as 'veo'|'heygen')}
                        className="py-2.5 rounded-xl text-xs font-bold border-2 transition-all flex items-center justify-center gap-1.5"
                        style={{ borderColor: aiGenTool===eng ? color : (isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.09)'), background: aiGenTool===eng ? `${color}18` : (isDark?'rgba(255,255,255,0.02)':'rgba(0,0,0,0.01)'), color: aiGenTool===eng ? color : tc.textMuted }}>
                        <span>{icon}</span><span>{lbl}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Veo badge */}
                {aiGenTool === 'veo' && (
                  <div className="rounded-xl px-3 py-2.5 flex items-center gap-2 text-xs font-semibold"
                    style={{ background: isDark?'rgba(124,58,237,0.1)':'rgba(124,58,237,0.07)', color:'#7c3aed', border:'1px solid rgba(124,58,237,0.25)' }}>
                    <span>🎥</span><span>Veo 3.0 — Google DeepMind</span>
                    <span className="mr-auto text-[10px] font-medium" style={{ color: tc.textMuted }}>~2 דקות</span>
                  </div>
                )}

                {/* HeyGen badge */}
                {aiGenTool === 'heygen' && (
                  <div className="rounded-xl px-3 py-2.5 flex items-center gap-2 text-xs font-semibold"
                    style={{ background: isDark?'rgba(139,92,246,0.1)':'rgba(139,92,246,0.07)', color:'#8b5cf6', border:'1px solid rgba(139,92,246,0.25)' }}>
                    <span>🎭</span><span>HeyGen — וידאו אווטאר AI</span>
                    <span className="mr-auto text-[10px] font-medium" style={{ color: tc.textMuted }}>דרך האתר</span>
                  </div>
                )}

                {/* API key warnings */}
                {(aiGenTool==='imagen'||aiGenTool==='veo') && !apiKeys.google && (
                  <div className="rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5" style={{ background:'rgba(245,158,11,0.08)',color:'#d97706',border:'1px solid rgba(245,158,11,0.25)' }}>
                    ⚠️ נדרש Google API Key — הגדרות → מפתחות API
                  </div>
                )}
                {aiGenTool==='dalle' && !apiKeys.openai && (
                  <div className="rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5" style={{ background:'rgba(245,158,11,0.08)',color:'#d97706',border:'1px solid rgba(245,158,11,0.25)' }}>
                    ⚠️ נדרש OpenAI API Key — הגדרות → מפתחות API
                  </div>
                )}
                {aiGenTool==='heygen' && !apiKeys.heygen && (
                  <div className="rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5" style={{ background:'rgba(245,158,11,0.08)',color:'#d97706',border:'1px solid rgba(245,158,11,0.25)' }}>
                    ⚠️ נדרש HeyGen API Key — הגדרות → מפתחות API
                  </div>
                )}

                {/* Product Assets Panel */}
                <div className="rounded-2xl overflow-hidden" style={{ border:`1px solid ${isDark?'rgba(124,58,237,0.2)':'rgba(124,58,237,0.15)'}`, background: isDark?'rgba(124,58,237,0.05)':'rgba(124,58,237,0.03)' }}>
                  <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" onClick={() => setAssetsExpanded(p=>!p)}
                    style={{ borderBottom: assetsExpanded ? `1px solid ${isDark?'rgba(124,58,237,0.15)':'rgba(124,58,237,0.1)'}` : undefined }}>
                    <span className="text-base">📦</span>
                    <span className="text-xs font-bold flex-1" style={{ color: isDark?'#c4b5fd':'#6d28d9' }}>תמונות מוצר / פרויקט</span>
                    {productAssets.length > 0 && (
                      <label className="flex items-center gap-1 cursor-pointer" onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={useAssets} onChange={e=>setUseAssets(e.target.checked)} className="w-3 h-3 accent-violet-500"/>
                        <span className="text-[10px]" style={{ color: isDark?'#a78bfa':'#7c3aed' }}>השתמש בתמונות</span>
                      </label>
                    )}
                    <span style={{ color: isDark?'#6b7280':'#9ca3af', fontSize:10 }}>{assetsExpanded?'▲':'▼'}</span>
                  </div>
                  {assetsExpanded && (
                    <div className="p-2.5 flex flex-col gap-2">
                      {productAssets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {productAssets.map(asset => (
                            <div key={asset.id} className="relative group" style={{ width:52,height:52 }}>
                              <img src={asset.url} alt={asset.name} className="w-full h-full object-cover rounded-lg" style={{ border:`1px solid ${isDark?'rgba(124,58,237,0.3)':'rgba(124,58,237,0.2)'}` }}/>
                              <button onClick={() => setProductAssets(prev=>prev.filter(a=>a.id!==asset.id))}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[9px] font-bold"
                                style={{ background:'#ef4444' }}>✕</button>
                            </div>
                          ))}
                          <button onClick={() => assetInputRef.current?.click()}
                            className="flex items-center justify-center rounded-lg text-lg transition-opacity hover:opacity-70"
                            style={{ width:52,height:52,border:`1.5px dashed ${isDark?'rgba(124,58,237,0.4)':'rgba(124,58,237,0.3)'}`,color:isDark?'#7c3aed':'#6d28d9',background:'transparent' }}>+</button>
                        </div>
                      )}
                      {productAssets.length === 0 && (
                        <button onClick={() => assetInputRef.current?.click()}
                          className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80"
                          style={{ border:`1.5px dashed ${isDark?'rgba(124,58,237,0.35)':'rgba(124,58,237,0.3)'}`,color:isDark?'#a78bfa':'#6d28d9',background:'transparent' }}>
                          <span>📤</span><span>העלה תמונות מוצר / לוגו / חומרים</span>
                        </button>
                      )}
                      {productAssets.length > 0 && useAssets && (
                        <p className="text-[10px] text-center" style={{ color: isDark?'#6b7280':'#9ca3af' }}>
                          ✨ Claude יבחן את התמונות ויעשיר את הפרומפט לפני הייצור
                        </p>
                      )}
                    </div>
                  )}
                  <input ref={assetInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>handleAssetUpload(e.target.files)}/>
                </div>

                {/* Prompt */}
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: tc.textMuted }}>פרומפט</span>
                    <span className="text-[10px]" style={{ color: tc.textMuted }}>English works best</span>
                  </div>
                  <textarea value={aiGenPrompt} onChange={e=>setAiGenPrompt(e.target.value)} rows={5}
                    placeholder={aiGenTool==='veo'?'Aerial view of Tel Aviv skyline at sunset, cinematic 4K...':aiGenTool==='heygen'?'Professional presenter talking about our new product launch...':'Modern office building exterior, professional photography...'}
                    className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none flex-1"
                    style={{ background:isDark?'rgba(255,255,255,0.06)':'#ffffff', border:`1.5px solid ${isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`, color:tc.text, lineHeight:1.65 }}
                    dir="ltr"/>
                </div>

                {/* Generate button */}
                {aiGenTool ? (
                  <button
                    onClick={() => {
                      if (aiGenTool === 'heygen') { handleHeygenVideo(); return; }
                      const h=aiGenTool==='dalle'?handleDallE:aiGenTool==='veo'?handleVeo:handleGoogleImagen;
                      handleGenerateWithAssets(h);
                    }}
                    disabled={aiGenLoading||enriching||!aiGenPrompt.trim()}
                    className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    style={{ background:aiGenTool==='dalle'?'linear-gradient(135deg,#10b981,#059669)':aiGenTool==='heygen'?'linear-gradient(135deg,#8b5cf6,#7c3aed)':aiGenTool==='veo'?'linear-gradient(135deg,#7c3aed,#4f46e5)':'linear-gradient(135deg,#4285f4,#1a73e8)', boxShadow:aiGenLoading?'none':'0 4px 14px rgba(0,0,0,0.2)' }}>
                    {enriching?(<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>מנתח תמונות מוצר...</span></>)
                      :aiGenLoading?(<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>{aiGenTool==='veo'?'מייצר וידאו... (1-2 דקות)':'מייצר תמונה...'}</span></>)
                      :aiGenTool==='heygen'?(<><span>🎭</span><span>פתח HeyGen ליצירת וידאו</span></>)
                      :(<><span>{aiGenTool==='veo'?'🎥':aiGenTool==='dalle'?'🖼️':'🎨'}</span><span>ייצר {aiGenTool==='veo'?'וידאו':'תמונה'} עם {aiGenTool==='veo'?'Veo':aiGenTool==='dalle'?'DALL-E':'Google Imagen'}{productAssets.length>0&&useAssets?' + מוצר':''}</span></>)}
                  </button>
                ) : (
                  <div className="text-center py-2 text-xs" style={{ color: tc.textMuted }}>בחר סוג מדיה כדי להתחיל ↑</div>
                )}

                {/* HeyGen — URL paste field (shown after opening HeyGen site) */}
                {aiGenTool === 'heygen' && showUrlInput && (
                  <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: isDark?'rgba(139,92,246,0.08)':'rgba(139,92,246,0.05)', border:'1px solid rgba(139,92,246,0.25)' }}>
                    <p className="text-[11px] font-semibold" style={{ color:'#8b5cf6' }}>📋 הדבק את URL הוידאו מ-HeyGen:</p>
                    <div className="flex gap-2">
                      <input value={mediaUrlInput} onChange={e=>setMediaUrlInput(e.target.value)}
                        placeholder="https://app.heygen.com/share/..."
                        className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                        style={{ background:isDark?'rgba(255,255,255,0.08)':'#fff', border:'1px solid rgba(139,92,246,0.3)', color:tc.text }}
                        dir="ltr"
                        onKeyDown={e=>{ if(e.key==='Enter') handleSetMediaUrl(); }}/>
                      <button onClick={handleSetMediaUrl} disabled={!mediaUrlInput.trim()}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                        style={{ background:'#8b5cf6' }}>הוסף</button>
                    </div>
                  </div>
                )}

                </>)}

                {/* ── PRESENTATION mode ─────────────────────────────────────── */}
                {mediaContentType === 'presentation' && (
                  <div className="flex flex-col gap-3">

                    {/* Presentations management */}
                    <div className="rounded-2xl overflow-hidden" style={{ border:`1.5px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}`, background:isDark?'rgba(255,255,255,0.02)':'#fff' }}>
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <span className="text-xs font-black flex-1" style={{ color:tc.text }}>🖥️ מצגות</span>
                        <button onClick={()=>{ const p=makePres(); setPresentations(ps=>[p,...ps]); setActivePresId(p.id); setActiveSlideIdx(0); }}
                          className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl text-white"
                          style={{ background:'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                          <Plus size={11}/> חדשה
                        </button>
                      </div>
                      {presentations.length > 0 && (
                        <div className="border-t px-2 pb-2 max-h-36 overflow-y-auto space-y-0.5" style={{ borderColor:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)' }}>
                          {presentations.map(pres => (
                            <div key={pres.id}
                              onClick={()=>{ setActivePresId(pres.id); setActiveSlideIdx(0); }}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-xl cursor-pointer transition-all"
                              style={{ background:activePresId===pres.id?(isDark?'rgba(124,58,237,0.15)':'rgba(124,58,237,0.08)'):'transparent' }}>
                              <span className="text-sm flex-shrink-0">🖥️</span>
                              <span className="text-xs font-semibold flex-1 truncate" style={{ color:activePresId===pres.id?'#7c3aed':tc.text }}>{pres.name}</span>
                              <button onClick={e=>{e.stopPropagation();if(window.confirm('למחוק מצגת?')){setPresentations(ps=>ps.filter(p=>p.id!==pres.id));if(activePresId===pres.id)setActivePresId(null);}}}
                                className="p-1 rounded-lg hover:opacity-75 flex-shrink-0" style={{ color:'#ef4444' }}>
                                <Trash2 size={10}/>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {presentations.length === 0 && (
                        <div className="px-3 pb-3 text-center text-[11px]" style={{ color:tc.textMuted }}>
                          לחץ "+ חדשה" ליצירת מצגת או השתמש ב-Claude למטה
                        </div>
                      )}
                    </div>

                    {/* Actions when pres active */}
                    {activePresentation && (
                      <div className="flex flex-col gap-2">
                        <button onClick={()=>{setPresPreview(true);setPresCurrentIdx(activeSlideIdx);}}
                          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold"
                          style={{ background:'linear-gradient(135deg,#7c3aed,#4f46e5)',color:'#fff' }}>
                          <Monitor size={11}/> הצג מצגת
                        </button>
                        <div className="flex gap-1.5">
                          <button onClick={handleExportPPTX} disabled={exportingPres==='pptx'} title="PowerPoint"
                            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-bold disabled:opacity-50"
                            style={{ background:isDark?'rgba(234,88,12,0.15)':'rgba(234,88,12,0.1)',color:'#ea580c',border:'1px solid rgba(234,88,12,0.3)' }}>
                            {exportingPres==='pptx'?<div className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin"/>:<><Download size={10}/> PPTX</>}
                          </button>
                          <button onClick={handleExportGoogleSlides} disabled={exportingPres==='slides'} title="Google Slides"
                            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-bold disabled:opacity-50"
                            style={{ background:isDark?'rgba(66,133,244,0.15)':'rgba(66,133,244,0.1)',color:'#4285f4',border:'1px solid rgba(66,133,244,0.3)' }}>
                            {exportingPres==='slides'?<div className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin"/>:<><ExternalLink size={10}/> Slides</>}
                          </button>
                          <button onClick={handleExportCanva} disabled={exportingPres==='canva'} title="Canva"
                            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[10px] font-bold disabled:opacity-50"
                            style={{ background:isDark?'rgba(0,200,200,0.12)':'rgba(0,180,180,0.1)',color:isDark?'#2dd4bf':'#0d9488',border:`1px solid ${isDark?'rgba(0,200,200,0.25)':'rgba(0,180,180,0.3)'}` }}>
                            {exportingPres==='canva'?<div className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin"/>:<>✦ Canva</>}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px" style={{ background:isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)' }}/>
                      <span className="text-[10px] font-semibold" style={{ color:tc.textMuted }}>יצירה עם AI</span>
                      <div className="flex-1 h-px" style={{ background:isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)' }}/>
                    </div>

                    {/* Claude creation — PRIMARY */}
                    <div className="rounded-2xl overflow-hidden" style={{ border:`1.5px solid rgba(124,58,237,0.35)`, background:isDark?'rgba(124,58,237,0.07)':'rgba(124,58,237,0.04)' }}>
                      <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ borderBottom:`1px solid ${isDark?'rgba(124,58,237,0.2)':'rgba(124,58,237,0.12)'}` }}>
                        <span className="text-lg">✨</span>
                        <div className="flex-1">
                          <p className="text-xs font-black" style={{ color:'#7c3aed' }}>יצירה עם Claude</p>
                          <p className="text-[9px]" style={{ color:tc.textMuted }}>ללא צורך ב-API key חיצוני</p>
                        </div>
                      </div>
                      <div className="px-3 py-3 space-y-2.5">
                        <textarea
                          rows={3}
                          value={claudePresPrompt}
                          onChange={e=>setClaudePresPrompt(e.target.value)}
                          placeholder={'תאר את המצגת: נושא, קהל יעד, סגנון...\nלדוגמה: מצגת שיווקית לעסק קטן בתחום הנדל"ן'}
                          dir="rtl"
                          disabled={claudePresGenerating}
                          className="w-full rounded-xl border px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                          style={{ background:isDark?'rgba(255,255,255,0.05)':'#fff', borderColor:isDark?'rgba(124,58,237,0.3)':'rgba(124,58,237,0.2)', color:tc.text }}
                        />
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold" style={{ color:tc.textMuted }}>מספר שקופיות</span>
                          <div className="flex gap-1">
                            {[3,5,7,10].map(n=>(
                              <button key={n} onClick={()=>setClaudePresSlideCount(n)}
                                className="flex-1 h-8 rounded-xl text-xs font-black transition-all"
                                style={{ background:claudePresSlideCount===n?'#7c3aed':(isDark?'rgba(255,255,255,0.08)':'#f1f5f9'), color:claudePresSlideCount===n?'#fff':tc.text }}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold" style={{ color:tc.textMuted }}>סגנון</span>
                          <div className="flex gap-1">
                            {([['professional','מקצועי'],['creative','יצירתי'],['minimal','מינימלי']] as const).map(([s,l])=>(
                              <button key={s} onClick={()=>setClaudePresStyle(s)}
                                className="flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all"
                                style={{ background:claudePresStyle===s?'#7c3aed':(isDark?'rgba(255,255,255,0.08)':'#f1f5f9'), color:claudePresStyle===s?'#fff':tc.text }}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Images toggle */}
                        <div className="rounded-xl p-2.5 space-y-2" style={{ background:isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)', border:`1px solid ${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}` }}>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <div
                              onClick={()=>setClaudePresWithImages(v=>!v)}
                              className="relative flex-shrink-0 transition-colors"
                              style={{ width:32, height:18, borderRadius:9, background:claudePresWithImages?'#7c3aed':(isDark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.15)'), cursor:'pointer' }}>
                              <div className="absolute top-1 transition-all" style={{ width:10, height:10, borderRadius:'50%', background:'#fff', left:claudePresWithImages?18:2 }}/>
                            </div>
                            <span className="text-[11px] font-bold" style={{ color:tc.text }}>גם תמונות AI לכל שקופית</span>
                          </label>
                          {claudePresWithImages && (
                            <div className="flex gap-1.5">
                              {([
                                ['imagen','🎨','Google Imagen','#4285f4',!!apiKeys.google],
                                ['dalle','🖼️','DALL-E 3','#10b981',!!apiKeys.openai],
                              ] as const).map(([eng,icon,lbl,color,hasKey])=>(
                                <button key={eng}
                                  onClick={()=>setClaudePresImgEngine(eng)}
                                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border"
                                  style={{
                                    borderColor: claudePresImgEngine===eng ? color : (isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.09)'),
                                    background: claudePresImgEngine===eng ? `${color}20` : 'transparent',
                                    color: claudePresImgEngine===eng ? color : tc.textMuted,
                                    opacity: hasKey ? 1 : 0.5,
                                  }}>
                                  <span>{icon}</span><span>{lbl}</span>
                                  {!hasKey && <span className="text-[8px]">⚠️</span>}
                                </button>
                              ))}
                            </div>
                          )}
                          {claudePresWithImages && (
                            <p className="text-[9px]" style={{ color:tc.textMuted }}>
                              {claudePresImgEngine==='imagen' && !apiKeys.google && '⚠️ נדרש Google API Key — הגדרות → מפתחות API'}
                              {claudePresImgEngine==='dalle' && !apiKeys.openai && '⚠️ נדרש OpenAI API Key — הגדרות → מפתחות API'}
                              {((claudePresImgEngine==='imagen' && apiKeys.google) || (claudePresImgEngine==='dalle' && apiKeys.openai)) && `✓ ${claudePresImgEngine==='imagen'?'Google Imagen':'DALL-E 3'} יצור תמונה לכל שקופית`}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={handleClaudePresGenerate}
                          disabled={claudePresGenerating||!claudePresPrompt.trim()}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50 transition-all"
                          style={{ background:'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow:claudePresGenerating?'none':'0 4px 14px rgba(124,58,237,0.35)' }}>
                          {claudePresGenerating
                            ?<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span className="text-xs truncate">{claudePresProgress||'יוצר...'}</span></>
                            :<><Sparkles size={14}/>{claudePresWithImages&&((claudePresImgEngine==='imagen'&&apiKeys.google)||(claudePresImgEngine==='dalle'&&apiKeys.openai))?'✨ יצור מצגת + תמונות':'✨ יצור מצגת'}</>}
                        </button>
                      </div>
                    </div>

                    {/* Divider 2 */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px" style={{ background:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)' }}/>
                      <span className="text-[10px] font-semibold" style={{ color:tc.textMuted }}>או GPT-4o / Gemini</span>
                      <div className="flex-1 h-px" style={{ background:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)' }}/>
                    </div>

                    {/* AI gen panel (existing, accordion) */}
                    <div className="rounded-2xl overflow-hidden" style={{ border:`1.5px solid ${isDark?'rgba(124,58,237,0.2)':'rgba(124,58,237,0.15)'}`, background:isDark?'rgba(124,58,237,0.05)':'rgba(124,58,237,0.03)' }}>
                      <button onClick={()=>setAiPresShowPanel(v=>!v)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-right">
                        <span className="text-base">🤖</span>
                        <div className="flex-1 text-right">
                          <p className="text-xs font-black" style={{ color:'#7c3aed' }}>GPT-4o / Gemini + תמונות AI</p>
                          <p className="text-[9px]" style={{ color:tc.textMuted }}>דורש OpenAI / Google API Key</p>
                        </div>
                        <ChevronDown size={14} className="transition-transform flex-shrink-0" style={{ color:'#7c3aed', transform:aiPresShowPanel?'rotate(180deg)':'none' }}/>
                      </button>
                      {aiPresShowPanel && (
                        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t" style={{ borderColor:isDark?'rgba(124,58,237,0.2)':'rgba(124,58,237,0.15)' }}>
                          <textarea rows={2} value={aiPresPrompt} onChange={e=>setAiPresPrompt(e.target.value)}
                            placeholder="לדוגמה: מצגת על שיווק דיגיטלי עם דגש על סושיאל מדיה..."
                            dir="rtl" disabled={aiPresGenerating}
                            className="w-full rounded-xl border px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                            style={{ background:isDark?'rgba(255,255,255,0.05)':'#fff', borderColor:isDark?'rgba(124,58,237,0.3)':'rgba(124,58,237,0.25)', color:tc.text }}
                          />
                          <div className="flex gap-2 flex-wrap">
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-semibold" style={{ color:tc.textMuted }}>שקופיות</span>
                              <div className="flex gap-1">
                                {[3,5,7,10].map(n=>(
                                  <button key={n} onClick={()=>setAiPresSlideCount(n)}
                                    className="w-8 h-7 rounded-lg text-[10px] font-black"
                                    style={{ background:aiPresSlideCount===n?'#7c3aed':(isDark?'rgba(255,255,255,0.08)':'#f1f5f9'), color:aiPresSlideCount===n?'#fff':tc.text }}>
                                    {n}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[9px] font-semibold" style={{ color:tc.textMuted }}>מנוע</span>
                              <div className="flex gap-1">
                                {([['openai','GPT-4o'],['google','Gemini']] as const).map(([eng,lbl])=>(
                                  <button key={eng} onClick={()=>setAiPresEngine(eng)}
                                    className="px-2 h-7 rounded-lg text-[10px] font-bold"
                                    style={{ background:aiPresEngine===eng?'#7c3aed':(isDark?'rgba(255,255,255,0.08)':'#f1f5f9'), color:aiPresEngine===eng?'#fff':tc.text }}>
                                    {lbl}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <button onClick={handleGeneratePresWithAI} disabled={aiPresGenerating||!aiPresPrompt.trim()}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-black text-white disabled:opacity-50"
                            style={{ background:'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                            {aiPresGenerating
                              ?<><div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span className="truncate">{aiPresProgress||'יוצר...'}</span></>
                              :<><Sparkles size={12}/>צור מצגת</>}
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                )}

              </div>
            </div>

            {mediaContentType !== 'presentation' && (<>
            {/* Campaign Text section */}
            <div className="space-y-2 rounded-2xl p-4" style={{ background: isDark?'rgba(79,70,229,0.06)':'rgba(79,70,229,0.04)', border:`1px solid ${isDark?'rgba(124,58,237,0.15)':'rgba(99,102,241,0.15)'}` }}>
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold" style={{ color: tc.text }}>✍️ טקסט הקמפיין / פוסט</label>
                <div className="flex gap-2">
                  <select value={campaignTextTone} onChange={e=>setCampaignTextTone(e.target.value as typeof campaignTextTone)}
                    className="text-xs rounded-xl border border-slate-200 dark:border-slate-600 px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:outline-none">
                    <option value="friendly">ידידותי</option>
                    <option value="professional">מקצועי</option>
                    <option value="formal">פורמלי</option>
                  </select>
                  <button onClick={handleGenerateCampaignText} disabled={campaignTextGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background:'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                    {campaignTextGenerating?<><Loader2 size={11} className="animate-spin"/>יוצר...</>:<><Sparkles size={11}/>צור עם AI</>}
                  </button>
                  <button onClick={handleGenerateCaptionForText} disabled={captionGenerating||mediaGallery.filter(i=>i.type==='image').length===0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background:'linear-gradient(135deg,#10b981,#059669)' }}
                    title="כיתוב AI מהתמונה הראשונה בגלריה">
                    {captionGenerating?<><Loader2 size={11} className="animate-spin"/>יוצר...</>:<>✍️ כיתוב מתמונה</>}
                  </button>
                  {campaignText && <button onClick={handleGenerateCampaignText} disabled={campaignTextGenerating}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-indigo-500 disabled:opacity-40" title="צור גרסה חדשה"><RefreshCw size={13}/></button>}
                </div>
              </div>
              {/* AI Prompt input */}
              <div className="relative">
                <textarea rows={2} value={campaignTextPrompt} onChange={e=>setCampaignTextPrompt(e.target.value)}
                  className="w-full text-xs rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  style={{ background:isDark?'rgba(79,70,229,0.08)':'rgba(79,70,229,0.05)', border:`1px solid ${isDark?'rgba(124,58,237,0.3)':'rgba(99,102,241,0.25)'}`, color:isDark?'#c4b5fd':'#4338ca', paddingRight:'2.5rem' }}
                  placeholder="פרומפט לAI: תאר מה תרצה שהפוסט יכיל... (ריק = שימוש בשם ומטרת הקמפיין)"
                  dir="rtl" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))handleGenerateCampaignText();}}/>
                <span className="absolute top-2 left-2.5 text-base" style={{ pointerEvents:'none' }}>✍️</span>
              </div>
              <textarea rows={5} value={campaignText} onChange={e=>setCampaignText(e.target.value)}
                className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="כתוב את הטקסט לקמפיין, או הזן פרומפט למעלה ולחץ 'צור עם AI'..." dir="rtl"/>
              {campaignText && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400">{campaignText.length} תווים</p>
                  <button onClick={() => setTab('campaigns')}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl text-white"
                    style={{ background:'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                    <Send size={11}/> עבור לפרסום
                  </button>
                </div>
              )}
            </div>
            </>)}

            {/* Gallery — unified (media + presentations), shown in ALL modes incl. presentation */}
            {galleryLoaded && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black" style={{ color: isDark?'#e5e7eb':'#111827' }}>🗃️ גלריה</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold text-white" style={{ background:'#7c3aed' }}>{mediaGallery.length + savedPresentations.length}</span>
                  </div>
                  <div className="flex gap-1.5 flex-1 flex-wrap">
                    {([['all','הכל'],['image','🖼️ תמונות'],['video','🎬 וידאו'],['upload','📤 העלאות'],['presentation','🖥️ מצגות']] as const).map(([f,label]) => {
                      const count = f==='all'?(mediaGallery.length+savedPresentations.length):f==='upload'?mediaGallery.filter(i=>i.engine==='upload').length:f==='presentation'?savedPresentations.length:mediaGallery.filter(i=>i.type===f).length;
                      if(f!=='all'&&count===0) return null;
                      return (
                        <button key={f} onClick={()=>setGalleryFilter(f)}
                          className="px-2.5 py-1 rounded-xl text-xs font-semibold transition-all"
                          style={{ background:galleryFilter===f?'#7c3aed':(isDark?'rgba(255,255,255,0.06)':'#f1f5f9'), color:galleryFilter===f?'#fff':(isDark?'#9ca3af':'#6b7280') }}>
                          {label}{count>0?` (${count})`:''}
                        </button>
                      );
                    })}
                  </div>
                  {mediaGallery.length > 0 && (
                    <button onClick={()=>{if(window.confirm('למחוק את כל הגלריה?'))mediaGallery.forEach(i=>handleDeleteGalleryItem(i.id));}}
                      className="text-xs px-2.5 py-1 rounded-xl"
                      style={{ color:'#ef4444',background:isDark?'rgba(239,68,68,0.1)':'rgba(239,68,68,0.06)',border:'1px solid rgba(239,68,68,0.2)' }}>
                      🗑️ נקה הכל
                    </button>
                  )}
                </div>
                {(() => {
                  const showPres = galleryFilter==='all' || galleryFilter==='presentation';
                  const presList = showPres ? savedPresentations : [];
                  const filtered = galleryFilter==='presentation' ? [] : mediaGallery.filter(item => galleryFilter==='all'?true:galleryFilter==='upload'?item.engine==='upload':item.type===galleryFilter);
                  if(!filtered.length && !presList.length) return (
                    <div className="py-10 text-center rounded-2xl"
                      style={{ color:isDark?'#6b7280':'#9ca3af',background:isDark?'rgba(255,255,255,0.02)':'#f8fafc',border:`1px dashed ${isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}` }}>
                      <span className="text-3xl">🔍</span>
                      <p className="text-sm mt-2">אין פריטים בסינון זה</p>
                    </div>
                  );
                  return (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(165px, 1fr))', gap:10 }}>
                      {/* Presentation cards — unified into the media gallery */}
                      {presList.map(pres => {
                        const slides = pres.slides ?? [];
                        const firstSlide = slides[0];
                        const firstImg = firstSlide?.imageId ? mediaGallery.find(i=>i.id===firstSlide.imageId) : null;
                        const isActive = activePresId === pres.id;
                        return (
                          <div key={pres.id} className="group relative rounded-2xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] duration-200"
                            style={{ background:isDark?'#111827':'#f8fafc', border:`1.5px solid ${isActive?'#7c3aed':isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.07)'}`, boxShadow:isActive?'0 0 0 2px rgba(124,58,237,0.25)':'none' }}>
                            <div className="relative w-full overflow-hidden" style={{ paddingBottom:'68%', background:firstSlide?.bgColor??'#1e1b4b' }}
                              onClick={()=>{
                                if(!presentations.some(p=>p.id===pres.id)) setPresentations(ps=>[...ps,pres]);
                                setMediaContentType('presentation'); // switch canvas into presentation editor
                                setActivePresId(pres.id); setActiveSlideIdx(0); setPresPreview(false);
                                setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                              }}>
                              {firstImg && <img src={firstImg.thumbnailUrl??firstImg.url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40"/>}
                              <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background:'rgba(0,0,0,0.55)',color:'#fff',backdropFilter:'blur(4px)' }}>
                                🖥️ {slides.length}
                              </div>
                              <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                                <p className="text-xs font-black line-clamp-2 leading-tight drop-shadow" style={{ color:firstSlide?.textColor??'#fff' }}>{firstSlide?.title||pres.name}</p>
                              </div>
                              {slides.length > 1 && (
                                <div className="absolute bottom-1.5 left-1.5 flex gap-0.5">
                                  {slides.slice(0,4).map((s,i) => <div key={i} className="rounded-sm flex-shrink-0" style={{ width:14,height:9,background:s.bgColor??'#1e1b4b',border:'1px solid rgba(255,255,255,0.35)',opacity:i===0?1:0.55 }}/>)}
                                  {slides.length>4 && <span className="text-[7px] font-bold self-center" style={{ color:'rgba(255,255,255,0.7)' }}>+{slides.length-4}</span>}
                                </div>
                              )}
                              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{ background:'rgba(0,0,0,0.45)' }}>
                                <span className="px-3 py-1.5 rounded-lg text-white text-[10px] font-bold shadow-lg" style={{ background:'rgba(124,58,237,0.9)' }}>✏️ ערוך מצגת</span>
                              </div>
                            </div>
                            <div className="px-2 py-1.5 flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold truncate" style={{ color:tc.text }}>{pres.name}</p>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white inline-block mt-0.5" style={{ background:'#7c3aed', fontSize:8 }}>מצגת</span>
                              </div>
                              <button onClick={e=>{e.stopPropagation();if(window.confirm('למחוק מצגת זו מהגלריה?'))handleDeleteSavedPresentation(pres.id);}}
                                className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color:'#ef4444' }} title="מחק">
                                <Trash2 size={11}/>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {filtered.map(item => (
                        <div key={item.id} className="group relative rounded-2xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] duration-200"
                          style={{ background:isDark?'#111827':'#f8fafc', border:`1.5px solid ${isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.07)'}` }}
                          onClick={()=>setGalleryPreview(item)}>
                          <div className="relative w-full overflow-hidden" style={{ paddingBottom:'68%' }}>
                            {item.type==='image'?(
                              <img src={item.thumbnailUrl||item.url} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"/>
                            ):(
                              <div className="absolute inset-0 flex items-center justify-center" style={{ background:'#0f172a' }}>
                                <video src={item.url} className="w-full h-full object-cover" style={{ opacity:0.65 }} muted playsInline/>
                                <span className="absolute text-white text-3xl drop-shadow-lg" style={{ pointerEvents:'none' }}>▶</span>
                              </div>
                            )}
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                              style={{ background:'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' }}>
                              <div className="absolute bottom-2 inset-x-2 flex flex-col gap-1">
                                <button onClick={e=>{e.stopPropagation();setCampaignMedia({url:item.url,type:item.type==='video'?'video':'image',engine:item.engine as GeneratedMedia['engine'],thumbnailUrl:item.thumbnailUrl??'',prompt:item.prompt,generatedAt:item.createdAt});focusInStudio(item.id);onToast?.('✅ מדיה נבחרה לקמפיין','success');}}
                                  className="w-full py-1 rounded-lg text-[10px] font-bold text-white text-center"
                                  style={{ background:'rgba(16,185,129,0.92)' }}>✅ קמפיין</button>
                                <div className="flex gap-1">
                                  <button onClick={e=>{e.stopPropagation();
                                    // switch the canvas to the matching media mode so the item is shown (not stuck in presentation mode)
                                    setMediaContentType(item.type==='video'?'video':'image');
                                    focusInStudio(item.id);
                                    setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                  }}
                                    className="flex-1 py-1 rounded-lg text-[10px] font-bold text-white text-center"
                                    style={{ background:'rgba(124,58,237,0.92)' }}>✏️ סטודיו</button>
                                  <button onClick={e=>{e.stopPropagation();const a=document.createElement('a');a.href=item.url;a.download=`media-${item.id}.${item.type==='video'?'mp4':'jpg'}`;a.click();}}
                                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-white text-center"
                                    style={{ background:'rgba(59,130,246,0.92)' }}>⬇️</button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="px-2 py-1.5 space-y-0.5">
                            <p className="text-[10px] font-semibold truncate" style={{ color:tc.text }}>{item.prompt||'ללא כיתוב'}</p>
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white"
                                style={{ background:item.type==='video'?'#7c3aed':'#4285f4',fontSize:8 }}>
                                {item.engine==='upload'?'📤':item.type==='video'?'🎬':item.engine==='dalle'?'DALL-E':'Imagen'}
                              </span>
                              <span className="text-[9px]" style={{ color:tc.textMuted }}>{new Date(item.createdAt).toLocaleDateString('he-IL')}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: CAMPAIGNS — social media platforms picker + campaign creator
       * ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'campaigns' && campaignsSubTab === 'create' && (
        <div className="space-y-4" dir="rtl">

          {/* ── Platform picker (shown when no platform selected) ─────────── */}
          {!campaignPlatform && (
            <div className="space-y-5">
              <div className="text-center py-2">
                <p className="font-black text-xl" style={{ color: tc.text }}>פרסום ברשתות החברתיות</p>
                <p className="text-sm mt-1" style={{ color: tc.textMuted }}>בחר את הפלטפורמה שבה תרצה לפרסם</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Meta (Facebook + Instagram) */}
                <button
                  onClick={() => setCampaignPlatform('meta')}
                  className="p-6 rounded-2xl border-2 text-right transition-all hover:scale-[1.02] relative"
                  style={{ borderColor: '#1877f2', background: 'rgba(24,119,242,0.06)' }}
                >
                  {isConnected && (
                    <span className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full font-bold"
                      style={{ background:'rgba(16,185,129,0.15)', color:'#10b981', border:'1px solid rgba(16,185,129,0.3)' }}>
                      מחובר ✓
                    </span>
                  )}
                  <div className="text-4xl mb-3">📘</div>
                  <div className="font-black text-base mb-1" style={{ color: tc.text }}>Meta</div>
                  <div className="text-xs font-medium" style={{ color: '#1877f2' }}>Facebook & Instagram</div>
                  <div className="text-[11px] mt-1" style={{ color: tc.textMuted }}>פוסטים אורגניים · קמפיינים ממומנים</div>
                </button>

                {/* Instagram shortcut — also goes to Meta */}
                <button
                  onClick={() => setCampaignPlatform('meta')}
                  className="p-6 rounded-2xl border-2 text-right transition-all hover:scale-[1.02] relative"
                  style={{ borderColor: '#e1306c', background: 'rgba(225,48,108,0.06)' }}
                >
                  {isConnected && (
                    <span className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full font-bold"
                      style={{ background:'rgba(16,185,129,0.15)', color:'#10b981', border:'1px solid rgba(16,185,129,0.3)' }}>
                      מחובר ✓
                    </span>
                  )}
                  <div className="text-4xl mb-3">📸</div>
                  <div className="font-black text-base mb-1" style={{ color: tc.text }}>Instagram</div>
                  <div className="text-xs font-medium" style={{ color: '#e1306c' }}>Reels · Stories · פוסטים</div>
                  <div className="text-[11px] mt-1" style={{ color: tc.textMuted }}>דרך Meta Business</div>
                </button>

                {/* TikTok — coming soon */}
                <button
                  disabled
                  className="p-6 rounded-2xl border-2 text-right opacity-50 cursor-not-allowed"
                  style={{ borderColor: '#ff0050', background: 'rgba(255,0,80,0.04)' }}
                >
                  <div className="text-4xl mb-3">🎵</div>
                  <div className="font-black text-base mb-1" style={{ color: tc.text }}>TikTok</div>
                  <div className="text-xs font-medium" style={{ color: '#ff0050' }}>Short Videos</div>
                  <div className="text-[11px] mt-1" style={{ color: tc.textMuted }}>בקרוב...</div>
                </button>

                {/* LinkedIn — coming soon */}
                <button
                  disabled
                  className="p-6 rounded-2xl border-2 text-right opacity-50 cursor-not-allowed"
                  style={{ borderColor: '#0a66c2', background: 'rgba(10,102,194,0.04)' }}
                >
                  <div className="text-4xl mb-3">💼</div>
                  <div className="font-black text-base mb-1" style={{ color: tc.text }}>LinkedIn</div>
                  <div className="text-xs font-medium" style={{ color: '#0a66c2' }}>B2B · מקצועי</div>
                  <div className="text-[11px] mt-1" style={{ color: tc.textMuted }}>בקרוב...</div>
                </button>
              </div>
            </div>
          )}

          {/* ── Meta campaign section (shown after Meta/Instagram selected) ── */}
          {campaignPlatform === 'meta' && (
            <div className="space-y-4">
              {/* Back button */}
              <button
                onClick={() => { setCampaignPlatform(null); setShowCampaignForm(false); }}
                className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                style={{ color: tc.textMuted }}
              >
                ← חזרה לבחירת פלטפורמה
              </button>

          {/* ── Product learning banner ──────────────────────────────────── */}
          {productProfile && productProfile.productName && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <Star size={14} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  הסוכן מכיר את המוצר שלך — {productProfile.productName}
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500">
                  {productProfile.approvedMedia.length} מדיות מאושרות · הסוכן לומד ומשתפר בכל קמפיין
                </p>
              </div>
              <button
                onClick={() => setEditingProfile(true)}
                className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex-shrink-0"
              >
                עדכן
              </button>
            </div>
          )}

          {/* ── New campaign button ──────────────────────────────────────── */}
          {!showCampaignForm && (
            <button
              onClick={() => { setShowCampaignForm(true); setWizardStep(0); setCampaignType('organic'); }}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Plus size={16} />
              קמפיין חדש
            </button>
          )}

          {/* ── Campaign creation form (multi-step wizard) ───────────────── */}
          {showCampaignForm && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setShowCampaignForm(false); resetCampaignForm(); }}
                  className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <X size={16} className="text-slate-400" />
                </button>
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Target size={15} className="text-indigo-500" />
                  {wizardStep === 0 ? '📘 Meta — בחר סוג' : campaignType === 'paid' ? `📘 Meta ממומן — שלב ${wizardStep}/4` : '📘 Meta — פוסט אורגני'}
                </h3>
              </div>

              {/* ── STEP 0c: Meta type selection ────────────────────────────── */}
              {wizardStep === 0 && campaignPlatform === 'meta' && (
                <div className="space-y-4" dir="rtl">
                  <div className="text-center">
                    <div className="text-base font-bold mb-1" style={{ color: tc.textPrimary }}>איזה סוג קמפיין Meta?</div>
                    <div className="text-xs" style={{ color: tc.textMuted }}>בחר את סוג הפרסום המתאים לך</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={() => { setCampaignType('organic'); setWizardStep(1); }}
                      className="p-4 rounded-2xl border-2 text-right transition-all hover:scale-[1.02]"
                      style={{ borderColor: '#6366f1', background: '#6366f110' }}
                    >
                      <div className="text-2xl mb-2">📢</div>
                      <div className="font-bold text-sm mb-1" style={{ color: tc.textPrimary }}>פוסט אורגני</div>
                      <div className="text-xs" style={{ color: tc.textMuted }}>חינם · מגיע לעוקבים הנוכחיים שלך</div>
                    </button>
                    <button
                      onClick={() => { setCampaignType('paid'); setWizardStep(1); }}
                      className="p-4 rounded-2xl border-2 text-right transition-all hover:scale-[1.02]"
                      style={{ borderColor: '#f59e0b', background: '#f59e0b10' }}
                    >
                      <div className="text-2xl mb-2">💰</div>
                      <div className="font-bold text-sm mb-1" style={{ color: tc.textPrimary }}>קמפיין ממומן</div>
                      <div className="text-xs" style={{ color: tc.textMuted }}>תקציב · קהל יעד · טרגוט מדויק</div>
                      {(effectiveMeta?.adAccounts?.filter(a => a.status === 'ACTIVE') ?? []).length === 0 && !effectiveMeta?.adAccountId && (
                        <div className="text-[10px] mt-1 text-amber-500">⚠️ צריך חשבון פרסום</div>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Step indicator for paid campaigns ───────────────────────── */}
              {campaignType === 'paid' && wizardStep >= 1 && (
                <div className="flex items-center gap-1 mb-2">
                  {['יעד', 'תקציב', 'קהל', 'מודעה'].map((label, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div
                        className="w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center"
                        style={{
                          background: wizardStep > i + 1 ? '#10b981' : wizardStep === i + 1 ? '#6366f1' : tc.subtleBg,
                          color: wizardStep > i + 1 ? 'white' : wizardStep === i + 1 ? 'white' : tc.textMuted,
                        }}
                      >
                        {wizardStep > i + 1 ? '✓' : i + 1}
                      </div>
                      <span className="text-[10px]" style={{ color: wizardStep === i + 1 ? tc.textPrimary : tc.textMuted }}>{label}</span>
                      {i < 3 && <div className="w-4 h-px" style={{ background: tc.border }} />}
                    </div>
                  ))}
                </div>
              )}

              {/* ── PAID STEP 1: Objective + Name + Page ────────────────────── */}
              {campaignType === 'paid' && wizardStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>שם הקמפיין *</label>
                    <input
                      value={campaignName}
                      onChange={e => setCampaignName(e.target.value)}
                      placeholder="קמפיין קיץ 2024"
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>יעד הקמפיין</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { id: 'OUTCOME_AWARENESS',  label: 'מודעות למותג', emoji: '📣' },
                        { id: 'OUTCOME_TRAFFIC',    label: 'תנועה לאתר',   emoji: '🌐' },
                        { id: 'OUTCOME_ENGAGEMENT', label: 'מעורבות',      emoji: '❤️' },
                        { id: 'OUTCOME_LEADS',      label: 'לידים',        emoji: '📋' },
                        { id: 'OUTCOME_SALES',      label: 'מכירות',       emoji: '🛒' },
                      ].map(obj => (
                        <button
                          key={obj.id}
                          onClick={() => setCampaignObjective(obj.id)}
                          className="p-2 rounded-xl border text-right text-xs transition-all"
                          style={{
                            borderColor: campaignObjective === obj.id ? '#6366f1' : tc.border,
                            background: campaignObjective === obj.id ? '#6366f115' : tc.subtleBg,
                            color: tc.textPrimary,
                          }}
                        >
                          <span className="mr-1">{obj.emoji}</span>{obj.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(effectiveMeta?.pages?.length ?? 0) > 0 && (
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>דף Facebook</label>
                      <select
                        value={campaignSelectedPageId || effectiveMeta?.pages?.[0]?.id || ''}
                        onChange={e => setCampaignSelectedPageId(e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      >
                        {effectiveMeta?.pages?.map(p => (
                          <option key={p.id} value={p.id}>{p.name}{p.subscribed ? ' ★' : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Ad Account Selection */}
                  {(effectiveMeta?.adAccounts?.filter(a => a.status === 'ACTIVE') ?? []).length > 0 ? (
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>חשבון פרסום</label>
                      <select
                        value={campaignSelectedAdAccountId || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE' && a.hasPaymentMethod)?.id || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE')?.id || ''}
                        onChange={e => setCampaignSelectedAdAccountId(e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      >
                        {effectiveMeta?.adAccounts?.filter(a => a.status === 'ACTIVE').map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name || `חשבון ${acc.id}`} ({acc.currency}){acc.hasPaymentMethod ? ' ✓' : ' ⚠ אין תשלום'}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl text-xs" style={{ background: '#f59e0b15', border: '1px solid #f59e0b40' }}>
                      <strong className="text-amber-500">⚠️ אין חשבונות פרסום</strong>
                      <div className="mt-1" style={{ color: tc.textMuted }}>
                        חבר מחדש את Facebook בהגדרות → אינטגרציות כדי לטעון חשבונות פרסום אוטומטית.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PAID STEP 2: Budget & Schedule ──────────────────────────── */}
              {campaignType === 'paid' && wizardStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>סוג תקציב</label>
                    <div className="flex gap-2">
                      {[{id:'daily',label:'יומי'},{id:'lifetime',label:'כולל'}].map(bt => (
                        <button
                          key={bt.id}
                          onClick={() => setCampaignBudgetType(bt.id as 'daily' | 'lifetime')}
                          className="flex-1 py-2 rounded-xl text-sm font-semibold border transition-all"
                          style={{
                            borderColor: campaignBudgetType === bt.id ? '#6366f1' : tc.border,
                            background: campaignBudgetType === bt.id ? '#6366f115' : tc.subtleBg,
                            color: tc.textPrimary,
                          }}
                        >
                          {bt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>
                      תקציב {campaignBudgetType === 'daily' ? 'יומי' : 'כולל'} (₪)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={campaignBudgetAmount}
                      onChange={e => setCampaignBudgetAmount(e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      placeholder="50"
                    />
                    <div className="text-[10px] mt-1" style={{ color: tc.textMuted }}>
                      מינימום: ₪7 ליום ב-Facebook Ads
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>תאריך התחלה</label>
                      <input
                        type="date"
                        value={campaignStartDate}
                        onChange={e => setCampaignStartDate(e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>
                        תאריך סיום {campaignBudgetType === 'lifetime' ? '*' : '(אופציונלי)'}
                      </label>
                      <input
                        type="date"
                        value={campaignEndDate}
                        onChange={e => setCampaignEndDate(e.target.value)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── PAID STEP 3: Audience Targeting ─────────────────────────── */}
              {campaignType === 'paid' && wizardStep === 3 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>מדינה</label>
                    <select
                      value={campaignCountry}
                      onChange={e => setCampaignCountry(e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                    >
                      <option value="IL">ישראל</option>
                      <option value="US">ארצות הברית</option>
                      <option value="GB">בריטניה</option>
                      <option value="DE">גרמניה</option>
                      <option value="FR">צרפת</option>
                      <option value="CA">קנדה</option>
                      <option value="AU">אוסטרליה</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>
                      טווח גילאים: {campaignAgeMin} — {campaignAgeMax}
                    </label>
                    <div className="flex gap-2 items-center">
                      <input type="number" min="13" max="65" value={campaignAgeMin}
                        onChange={e => setCampaignAgeMin(Number(e.target.value))}
                        className="w-20 rounded-xl px-3 py-2 text-sm border outline-none text-center"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }} />
                      <span style={{ color: tc.textMuted }}>—</span>
                      <input type="number" min="13" max="65" value={campaignAgeMax}
                        onChange={e => setCampaignAgeMax(Number(e.target.value))}
                        className="w-20 rounded-xl px-3 py-2 text-sm border outline-none text-center"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }} />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>מגדר</label>
                    <div className="flex gap-2">
                      {[{id:0,label:'הכל'},{id:1,label:'גברים'},{id:2,label:'נשים'}].map(g => (
                        <button
                          key={g.id}
                          onClick={() => {
                            if (g.id === 0) { setCampaignGenders([]); return; }
                            setCampaignGenders(prev =>
                              prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id]
                            );
                          }}
                          className="flex-1 py-2 rounded-xl text-sm border transition-all"
                          style={{
                            borderColor: (g.id === 0 ? campaignGenders.length === 0 : campaignGenders.includes(g.id)) ? '#6366f1' : tc.border,
                            background: (g.id === 0 ? campaignGenders.length === 0 : campaignGenders.includes(g.id)) ? '#6366f115' : tc.subtleBg,
                            color: tc.textPrimary,
                          }}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>
                      תחומי עניין (הפרד בפסיקים)
                    </label>
                    <input
                      value={campaignInterestTags}
                      onChange={e => setCampaignInterestTags(e.target.value)}
                      placeholder={'נדל"ן, ביוטי, כושר, טכנולוגיה...'}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['נדל"ן','ביוטי','כושר','מסעדות','אופנה','טכנולוגיה','חינוך','נסיעות','ספורט','פיננסים'].map(tag => (
                        <button
                          key={tag}
                          onClick={() => {
                            const current = campaignInterestTags.split(',').map(t => t.trim()).filter(Boolean);
                            if (!current.includes(tag)) {
                              setCampaignInterestTags(prev => prev ? `${prev}, ${tag}` : tag);
                            }
                          }}
                          className="px-2 py-0.5 rounded-full text-[10px] border"
                          style={{ borderColor: tc.border, background: tc.subtleBg, color: tc.textMuted }}
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── PAID STEP 4: Ad Creative + Review ───────────────────────── */}
              {campaignType === 'paid' && wizardStep === 4 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>כותרת המודעה</label>
                    <input
                      value={campaignHeadline}
                      onChange={e => setCampaignHeadline(e.target.value)}
                      placeholder="הצטרפו לקמפיין שלנו!"
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      maxLength={40}
                    />
                    <div className="text-[10px] text-end mt-0.5" style={{ color: tc.textMuted }}>{campaignHeadline.length}/40</div>
                  </div>

                  <div>
                    <label className="text-xs font-bold mb-1 flex items-center justify-between" style={{ color: tc.textSecondary }}>
                      <span>טקסט ראשי</span>
                      <button onClick={handleGenerateCampaignText} className="text-indigo-400 hover:text-indigo-300 text-[10px] flex items-center gap-0.5" disabled={campaignTextGenerating}>
                        <Zap size={10}/> {campaignTextGenerating ? 'יוצר...' : 'AI'}
                      </button>
                    </label>
                    <textarea
                      value={campaignText}
                      onChange={e => setCampaignText(e.target.value)}
                      placeholder="תוכן הפוסט/מודעה..."
                      rows={4}
                      className="w-full rounded-xl px-3 py-2.5 text-sm border outline-none resize-none"
                      style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>כפתור CTA</label>
                      <select
                        value={campaignCta}
                        onChange={e => setCampaignCta(e.target.value)}
                        className="w-full rounded-xl px-3 py-2 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      >
                        <option value="LEARN_MORE">למד עוד</option>
                        <option value="SHOP_NOW">קנה עכשיו</option>
                        <option value="CONTACT_US">צור קשר</option>
                        <option value="SIGN_UP">הרשם</option>
                        <option value="GET_OFFER">קבל הצעה</option>
                        <option value="WATCH_VIDEO">צפה בסרטון</option>
                        <option value="BOOK_TRAVEL">הזמן</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold mb-1 block" style={{ color: tc.textSecondary }}>כתובת אתר</label>
                      <input
                        value={campaignWebsiteUrl}
                        onChange={e => setCampaignWebsiteUrl(e.target.value)}
                        placeholder="https://www.example.com"
                        type="url"
                        className="w-full rounded-xl px-3 py-2 text-sm border outline-none"
                        style={{ background: tc.cardBg, borderColor: tc.border, color: tc.textPrimary }}
                      />
                    </div>
                  </div>

                  {/* Summary card */}
                  <div className="p-3 rounded-xl text-xs space-y-1" style={{ background: tc.subtleBg, border: `1px solid ${tc.border}` }}>
                    <div className="font-bold mb-2" style={{ color: tc.textPrimary }}>📋 סיכום הקמפיין</div>
                    <div style={{ color: tc.textSecondary }}>📢 <strong>{campaignName}</strong></div>
                    <div style={{ color: tc.textSecondary }}>
                      🎯 {campaignObjective === 'OUTCOME_AWARENESS' ? 'מודעות' : campaignObjective === 'OUTCOME_TRAFFIC' ? 'תנועה' : campaignObjective === 'OUTCOME_ENGAGEMENT' ? 'מעורבות' : campaignObjective === 'OUTCOME_LEADS' ? 'לידים' : 'מכירות'}
                    </div>
                    <div style={{ color: tc.textSecondary }}>
                      💰 ₪{campaignBudgetAmount} {campaignBudgetType === 'daily' ? 'ליום' : 'סה"כ'}
                      {campaignStartDate && ` · מ-${campaignStartDate}`}
                      {campaignEndDate && ` עד ${campaignEndDate}`}
                    </div>
                    <div style={{ color: tc.textSecondary }}>
                      👥 גיל {campaignAgeMin}-{campaignAgeMax}
                      {campaignGenders.length > 0 ? ` · ${campaignGenders.includes(1) && campaignGenders.includes(2) ? 'כולם' : campaignGenders.includes(1) ? 'גברים' : 'נשים'}` : ' · כולם'}
                      {campaignCountry === 'IL' ? ' · ישראל' : ` · ${campaignCountry}`}
                    </div>
                    {!(campaignSelectedAdAccountId || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE')?.id || effectiveMeta?.adAccountId) && (
                      <div className="text-amber-500 font-bold">⚠️ אין חשבון פרסום — חבר מחדש את Facebook</div>
                    )}
                  </div>
                </div>
              )}

              {/* ── ORGANIC STEP 1: Original form content ────────────────────── */}
              {campaignType === 'organic' && wizardStep === 1 && (
                <div className="space-y-4">
                  {/* Campaign name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שם הקמפיין</label>
                    <input
                      type="text"
                      value={campaignName}
                      onChange={e => setCampaignName(e.target.value)}
                      className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      placeholder="קמפיין קיץ 2025..."
                      dir="rtl"
                    />
                  </div>

                  {/* Goal */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מטרת הקמפיין</label>
                    <div className="flex gap-2 flex-wrap">
                      {['מכירות', 'מודעות', 'לידים', 'אפליקציה', 'חיזוק מותג'].map(g => (
                        <button
                          key={g}
                          onClick={() => setCampaignGoal(g)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                            campaignGoal === g
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Platforms */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">פלטפורמות</label>
                    <div className="flex gap-2 flex-wrap">
                      {(['facebook', 'instagram', 'linkedin', 'tiktok'] as const).map(p => {
                        const isSelected = campaignPlatforms.includes(p);
                        return (
                          <button
                            key={p}
                            onClick={() => setCampaignPlatforms(prev =>
                              isSelected ? prev.filter(x => x !== p) : [...prev, p]
                            )}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        );
                      })}
                    </div>
                    {/* Facebook page picker — shown when facebook is selected */}
                    {campaignPlatforms.includes('facebook') && (effectiveMeta?.pages?.length ?? 0) > 0 && (
                      <div className="mt-2 rounded-xl border p-3 space-y-2" style={{ borderColor: 'rgba(24,119,242,0.25)', background: 'rgba(24,119,242,0.04)' }}>
                        <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#1877f2' }}>
                          <span>📘</span> בחר דף Facebook לפרסום
                        </label>
                        <select
                          value={campaignSelectedPageId || effectiveMeta?.pages?.find(p => p.subscribed)?.id || effectiveMeta?.pages?.[0]?.id || ''}
                          onChange={e => setCampaignSelectedPageId(e.target.value)}
                          className="w-full rounded-xl px-3 py-2 text-sm border outline-none font-semibold"
                          style={{ background: isDark ? 'rgba(24,119,242,0.12)' : '#f0f7ff', borderColor: 'rgba(24,119,242,0.3)', color: isDark ? '#93c5fd' : '#1877f2' }}
                        >
                          {effectiveMeta?.pages?.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.subscribed ? ' ★' : ''}
                              {p.instagramBusinessAccountId ? ' · Instagram ✓' : ''}
                            </option>
                          ))}
                        </select>
                        {/* Show Instagram status for selected page */}
                        {(() => {
                          const selPage = effectiveMeta?.pages?.find(
                            p => p.id === (campaignSelectedPageId || effectiveMeta?.pages?.find(q => q.subscribed)?.id || effectiveMeta?.pages?.[0]?.id)
                          );
                          return (
                            <div className="flex items-center gap-3 text-[11px]">
                              <span className="flex items-center gap-1" style={{ color: selPage ? '#10b981' : '#ef4444' }}>
                                {selPage ? '✓ מחובר' : '✗ לא מחובר'}
                              </span>
                              {campaignPlatforms.includes('instagram') && (
                                <span className="flex items-center gap-1" style={{ color: selPage?.instagramBusinessAccountId ? '#10b981' : '#f59e0b' }}>
                                  📷 {selPage?.instagramBusinessAccountId ? 'Instagram מקושר ✓' : 'אין Instagram לדף זה'}
                                </span>
                              )}
                              {!effectiveMeta?.hasPostingPermission && (
                                <span className="flex items-center gap-1 text-amber-500"><AlertTriangle size={10}/> נדרש חיבור מחדש</span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {campaignPlatforms.includes('facebook') && (effectiveMeta?.pages?.length ?? 0) === 0 && (
                      <div className="mt-2 rounded-xl p-2.5 text-xs text-red-500 flex items-center gap-1.5" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <AlertTriangle size={12}/> לא מחובר — חבר Meta בהגדרות → אינטגרציות
                      </div>
                    )}

                    {/* Platform destination info for non-FB platforms */}
                    {(['linkedin','twitter','tiktok'] as const).filter(p => campaignPlatforms.includes(p)).length > 0 && (
                      <div className="rounded-lg p-2 text-xs space-y-1 mt-2" style={{ background: tc.subtleBg }}>
                        {(['linkedin','twitter','tiktok'] as const).filter(p => campaignPlatforms.includes(p)).map(p => {
                          const conn = socialConns.find(c => c.platform === p && c.connected);
                          return (
                            <div key={p} className="flex items-center gap-1.5">
                              <span>{p === 'linkedin' ? '💼' : p === 'twitter' ? '🐦' : '🎵'}</span>
                              {conn
                                ? <span style={{ color: tc.textSecondary }}>{conn.accountName ?? p}</span>
                                : <span className="text-red-500 flex items-center gap-1"><AlertTriangle size={11}/> לא מחובר</span>
                              }
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Media from Studio ──────────────────────────────────────── */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">מדיה לקמפיין</label>
                      <button
                        onClick={() => setTab('studio')}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
                        style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff' }}>
                        <Monitor size={11}/> פתח סטודיו
                      </button>
                    </div>
                    {campaignMedia ? (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                        style={{ background: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)' }}>
                        {campaignMedia.type === 'image' && <img src={campaignMedia.url} alt="" className="w-14 h-14 object-cover rounded-lg flex-shrink-0"/>}
                        {campaignMedia.type === 'video' && <span className="text-2xl">🎬</span>}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold" style={{ color: '#059669' }}>✓ מדיה נבחרה</p>
                          <p className="text-[10px] truncate" style={{ color: tc.textMuted }}>{campaignMedia.engine ?? campaignMedia.type}</p>
                        </div>
                        <button onClick={() => { setCampaignMedia(null); }} className="p-1 rounded-lg hover:opacity-75" style={{ color: '#dc2626' }}><X size={13}/></button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mediaGallery.length > 0 && (
                          <button
                            onClick={() => setShowGalleryPicker('campaign')}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all hover:opacity-80"
                            style={{ border: `2px dashed ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.3)'}`, background: isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)' }}>
                            <div className="flex -space-x-1">
                              {mediaGallery.filter(i=>i.type==='image').slice(0,4).map(i=>(
                                <img key={i.id} src={i.url} alt="" className="w-6 h-6 rounded-md object-cover border-2 border-white dark:border-slate-700"/>
                              ))}
                            </div>
                            <span className="text-xs font-bold" style={{ color:'#7c3aed' }}>בחר מגלריית הסטודיו ({mediaGallery.length})</span>
                          </button>
                        )}
                        <div
                          onClick={() => setTab('studio')}
                          className="flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-all hover:opacity-80"
                          style={{ border: `1px solid ${isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.18)'}`, background: isDark ? 'rgba(124,58,237,0.03)' : 'rgba(124,58,237,0.02)' }}>
                          <Monitor size={14} style={{ color: '#7c3aed', opacity: 0.7 }}/>
                          <p className="text-xs font-medium" style={{ color: '#7c3aed', opacity: 0.85 }}>פתח סטודיו המדיה ליצירה חדשה</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Campaign text — compact */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">טקסט הקמפיין / פוסט</label>
                      <button
                        onClick={() => setTab('studio')}
                        className="text-[10px] font-semibold" style={{ color: '#6366f1' }}>✨ ערוך בסטודיו</button>
                    </div>
                    <textarea
                      rows={4}
                      value={campaignText}
                      onChange={e => setCampaignText(e.target.value)}
                      className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                      placeholder="טקסט הפוסט... ניתן ליצור בסטודיו עם AI"
                      dir="rtl"
                    />
                    {campaignText && <p className="text-[10px] text-slate-400 text-left">{campaignText.length} תווים</p>}
                  </div>

                  {/* Organic save buttons */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setWizardStep(0)}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                      ← חזור
                    </button>
                    <button onClick={() => handleSaveCampaign('draft')} disabled={campaignSaving}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center gap-2">
                      {campaignSaving ? <Loader2 size={13} className="animate-spin"/> : <Clock size={13}/>} שמור טיוטה
                    </button>
                    <button onClick={() => handleSaveCampaign('published')} disabled={campaignSaving}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                      {campaignSaving ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>} פרסם קמפיין
                    </button>
                  </div>
                </div>
              )}


              {/* ── Paid campaign navigation buttons ─────────────────────────── */}
              {campaignType === 'paid' && wizardStep >= 1 && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => { if (wizardStep === 1) setWizardStep(0); else setWizardStep(w => w - 1); }}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border"
                    style={{ borderColor: tc.border, color: tc.textSecondary }}
                  >
                    ← חזור
                  </button>
                  {wizardStep < 4 ? (
                    <button
                      onClick={() => {
                        if (wizardStep === 1 && !campaignName.trim()) { onToast?.('הזן שם לקמפיין', 'error'); return; }
                        setWizardStep(w => w + 1);
                      }}
                      className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                    >
                      הבא →
                    </button>
                  ) : (
                    <button
                      onClick={handleCreatePaidCampaign}
                      disabled={paidCampaignPublishing || !(campaignSelectedAdAccountId || effectiveMeta?.adAccounts?.find(a => a.status === 'ACTIVE')?.id || effectiveMeta?.adAccountId)}
                      className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
                    >
                      {paidCampaignPublishing ? <><Loader2 size={14} className="animate-spin"/> מפרסם...</> : '🚀 פרסם קמפיין ממומן'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Setup product profile prompt (if missing) ─────────────────── */}
          {(!productProfile || !productProfile.productName) && !editingProfile && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">הכר את הסוכן עם המוצר שלך</p>
                  <p className="text-xs text-indigo-600 dark:text-indigo-500 mt-0.5">
                    הסוכן ילמד את המוצר, צבעי המותג, קהל היעד — ויצור מדיה מדויקת יותר בכל קמפיין.
                  </p>
                  <button
                    onClick={() => setEditingProfile(true)}
                    className="mt-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
                    style={{ background: '#4f46e5' }}
                  >
                    הגדר פרופיל מוצר
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Edit product profile inline form ──────────────────────────── */}
          {editingProfile && (
            <ProductProfileForm
              profile={productProfile}
              onSave={async p => {
                if (!wid) return;
                await saveProductProfile(wid, p);
                setProductProfile(p);
                setEditingProfile(false);
                onToast?.('פרופיל מוצר עודכן! הסוכן כבר לומד 🤖', 'success');
              }}
              onClose={() => setEditingProfile(false)}
            />
          )}

          {/* ── Existing campaigns list ───────────────────────────────────── */}
          {myCampaigns.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">קמפיינים קיימים</h3>
              {myCampaigns.map(camp => (
                <div key={camp.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                  {/* Header row */}
                  <div className="flex gap-3">
                    {camp.mediaUrl && (
                      <div className="w-20 h-20 flex-shrink-0 bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        {camp.mediaType === 'image'
                          ? <img src={camp.mediaUrl} alt="" className="w-full h-full object-cover" />
                          : <video src={camp.mediaUrl} poster={camp.mediaThumbnailUrl} className="w-full h-full object-cover" />
                        }
                      </div>
                    )}
                    <div className="flex-1 p-3 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{camp.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{camp.goal} · {camp.platforms.join(', ')}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            camp.status === 'published'
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                          }`}>
                            {camp.status === 'published' ? 'פורסם' : 'טיוטה'}
                          </span>
                          <button
                            onClick={() => handleDeleteCampaign(camp.id)}
                            className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      {camp.text && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{camp.text}</p>
                      )}
                    </div>
                  </div>

                  {/* Publish results */}
                  {camp.publishResults && camp.publishResults.length > 0 && (
                    <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1">
                      {camp.publishResults.map((res, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {res.error ? (
                            <>
                              <X size={12} className="text-red-500 flex-shrink-0" />
                              <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{res.platform}</span>
                              <span className="text-red-500 truncate">{res.error}</span>
                            </>
                          ) : (
                            <>
                              <Check size={12} className="text-emerald-500 flex-shrink-0" />
                              <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{res.platform}</span>
                              {res.postUrl && (
                                <a
                                  href={res.postUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-indigo-500 hover:underline flex items-center gap-0.5 mr-auto"
                                >
                                  צפה בפוסט <ExternalLink size={10} />
                                </a>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Metrics row */}
                  {(camp.metrics || camp.publishResults?.some(r => r.platform === 'facebook' && r.postId && !r.error)) && (
                    <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 flex items-center gap-4">
                      {camp.metrics ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Heart size={11} className="text-red-400" /> {camp.metrics.likes}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <MessageCircle size={11} className="text-blue-400" /> {camp.metrics.comments}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Share2 size={11} className="text-purple-400" /> {camp.metrics.shares}
                          </span>
                          <span className="text-[10px] text-slate-400 mr-1">
                            עודכן {Math.floor((Date.now() - camp.metrics.updatedAt) / 60000)} דקות
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">טעון נתונים...</span>
                      )}
                      <button
                        onClick={() => handleRefreshMetrics(camp)}
                        className="mr-auto flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                      >
                        <RefreshCw size={11} /> רענן
                      </button>
                    </div>
                  )}

                  {/* Draft: publish now button */}
                  {camp.status === 'draft' && (
                    <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2">
                      <button
                        onClick={() => handlePublishDraft(camp)}
                        disabled={campaignSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-all"
                        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                      >
                        {campaignSaving ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
                        פרסם עכשיו
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {myCampaigns.length === 0 && campaignsLoadedMA && !showCampaignForm && (
            <div className="text-center py-8 text-slate-400">
              <Target size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">עדיין אין קמפיינים. לחץ "קמפיין חדש" למעלה.</p>
            </div>
          )}

            </div>
          )}

          {/* ── Gallery moved to Studio tab ──────────────────────────── */}
          {mediaGallery.length > 0 && (
            <div className="flex items-center justify-between px-1 py-2 rounded-xl"
              style={{ background:isDark?'rgba(124,58,237,0.08)':'rgba(124,58,237,0.05)', border:`1px solid ${isDark?'rgba(124,58,237,0.2)':'rgba(124,58,237,0.15)'}` }}>
              <span className="text-xs font-semibold" style={{ color:'#7c3aed' }}>🗃️ {mediaGallery.length} פריטים בגלריה</span>
              <button onClick={()=>setTab('studio')} className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background:'#7c3aed' }}>
                פתח סטודיו →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Lightbox ──────────────────────────────────────────────────────────── */}
      {galleryPreview && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.93)' }}
          onClick={() => setGalleryPreview(null)}>
          <div className="relative w-full flex flex-col gap-3" style={{ maxWidth: 860, maxHeight: '92vh' }}
            onClick={e => e.stopPropagation()}>
            {/* Close */}
            <button onClick={() => setGalleryPreview(null)}
              className="absolute -top-10 left-0 text-white text-xl font-bold w-8 h-8 flex items-center justify-center rounded-full transition-all hover:bg-white/20"
              style={{ background: 'rgba(255,255,255,0.12)' }}>✕</button>
            {/* Media */}
            <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ background: '#000', maxHeight: '72vh' }}>
              {galleryPreview.type === 'image' ? (
                <img src={galleryPreview.url} alt="" style={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain' }} />
              ) : (
                <video src={galleryPreview.url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain' }} />
              )}
            </div>
            {/* Engine + prompt */}
            {galleryPreview.prompt && (
              <p className="text-xs text-center text-slate-400 px-4 truncate">{galleryPreview.prompt}</p>
            )}
            {/* Actions */}
            <div className="flex items-center gap-2 justify-center flex-wrap">
              <button
                onClick={() => { setCampaignMedia({ url: galleryPreview.url, type: galleryPreview.type === 'video' ? 'video' : 'image', engine: galleryPreview.engine as GeneratedMedia['engine'], thumbnailUrl: galleryPreview.thumbnailUrl ?? '', prompt: galleryPreview.prompt, generatedAt: galleryPreview.createdAt }); focusInStudio(galleryPreview.id); setGalleryPreview(null); onToast?.('✅ מדיה נבחרה לקמפיין', 'success'); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>✅ השתמש בקמפיין</button>
              <button
                onClick={() => { setMediaContentType(galleryPreview.type === 'video' ? 'video' : 'image'); focusInStudio(galleryPreview.id); setGalleryPreview(null); setTimeout(() => mediaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>✏️ ערוך בסטודיו</button>
              <button
                onClick={() => { const a = document.createElement('a'); a.href = galleryPreview.url; a.download = `media-${galleryPreview.id}.${galleryPreview.type === 'video' ? 'mp4' : 'jpg'}`; a.click(); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}>⬇️ הורד</button>
              <button
                onClick={() => { if (window.confirm('למחוק את הפריט?')) { handleDeleteGalleryItem(galleryPreview.id); setGalleryPreview(null); } }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}>🗑️ מחק</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: GOOGLE ADS
       * ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'google' && (
        <div className="space-y-4" dir="rtl">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl" style={{ background: 'rgba(66,133,244,0.1)' }}>🔴</div>
            <div>
              <p className="font-black text-base" style={{ color: tc.text }}>פרסום בגוגל</p>
              <p className="text-xs" style={{ color: tc.textMuted }}>Search Ads · Lead Form · Smart Campaigns</p>
            </div>
          </div>
          <GoogleAdsCampaigns
            workspace={workspace!}
            webhookUrl={workspace?.leadsWebhookUrl ?? ''}
            onToast={onToast ?? (() => {})}
          />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: CONTENT AI — full ContentHub content generation
       * ══════════════════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: CONTENT AI — prompt-based content creation + publish
       * ══════════════════════════════════════════════════════════════════════ */}
      {/* ══ CREATIVE TAB (Content AI + Copy Library + Campaign Brief) ════ */}
      {tab === 'creative' && (
        <div className="space-y-4" dir="rtl">
          {/* Sub-tab switcher */}
          <div className="flex gap-2 p-1 rounded-2xl" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9' }}>
            {([
              { id: 'ai',      label: '✨ תוכן AI'       },
              { id: 'library', label: '📚 ספריית קופי'   },
              { id: 'brief',   label: '📋 בריף קמפיין'  },
            ] as const).map(st => (
              <button key={st.id} onClick={() => setCreativeSubTab(st.id)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={creativeSubTab === st.id
                  ? { background: isDark ? '#4f46e5' : 'white', color: isDark ? 'white' : '#4f46e5', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }
                  : { color: tc.textMuted }}>
                {st.label}
              </button>
            ))}
          </div>

          {/* ── Sub-tab: תוכן AI ──────────────────────────────────────────── */}
          {creativeSubTab === 'ai' && (
            <div className="space-y-5 w-full">

              {/* ── Header card ──────────────────────────────────────────────── */}
              <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-5 text-white">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                    <Sparkles size={18} className="text-white" />
                  </div>
                  <div>
                    <h2 className="font-black text-base">תוכן AI</h2>
                    <p className="text-xs text-violet-200">כתוב פרומפט — AI יצור תוכן מותאם לעסק שלך</p>
                  </div>
                </div>
                {productProfile?.productName && (
                  <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-1.5 mt-2 w-fit">
                    <Star size={11} className="text-yellow-300" />
                    <span className="text-xs text-white/90">מותאם ל{productProfile.productName}</span>
                  </div>
                )}
              </div>

              {/* ── Content type selector ────────────────────────────────────── */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">סוג תוכן</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {([
                    { v: 'post',          l: 'פוסט',         emoji: '📱' },
                    { v: 'blog',          l: 'מאמר בלוג',    emoji: '📝' },
                    { v: 'newsletter',    l: 'ניוזלטר',       emoji: '📧' },
                    { v: 'video-script',  l: 'תסריט',         emoji: '🎬' },
                    { v: 'google-ad',     l: 'מודעת גוגל',   emoji: '🔍' },
                    { v: 'other',         l: 'אחר',           emoji: '✨' },
                  ] as const).map(({ v, l, emoji }) => (
                    <button
                      key={v}
                      onClick={() => setContentType(v)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                        contentType === v
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="text-base">{emoji}</span>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Prompt area ──────────────────────────────────────────────── */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">הפרומפט שלך</p>
                  <span className="text-[10px] text-slate-400">{contentPrompt.length} תווים</span>
                </div>
                <textarea
                  rows={4}
                  value={contentPrompt}
                  onChange={e => setContentPrompt(e.target.value)}
                  className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder={
                    contentType === 'post'         ? 'למשל: כתוב פוסט על השקת המוצר החדש שלנו, קולקציית קיץ 2025...'
                    : contentType === 'blog'       ? 'למשל: מאמר על 5 טיפים לבחירת נעליים לאירועים...'
                    : contentType === 'newsletter' ? 'למשל: ניוזלטר חודשי ללקוחות על מבצעי יולי...'
                    : contentType === 'video-script' ? 'למשל: תסריט לסרטון 60 שניות על השירות שלנו...'
                    : contentType === 'google-ad'  ? 'למשל: מודעה לחיפוש "מסעדה ים תיכונית תל אביב"...'
                    : 'תאר את התוכן שאתה רוצה שה-AI ייצור...'
                  }
                  dir="rtl"
                />

                {/* ── Options row ──────────────────────────────────────────── */}
                <div className="flex gap-2 flex-wrap">
                  {/* Tone */}
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] font-semibold text-slate-400 mb-1">טון</label>
                    <select
                      value={contentTone}
                      onChange={e => setContentTone(e.target.value as typeof contentTone)}
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-600 px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:outline-none"
                    >
                      <option value="friendly">😊 ידידותי</option>
                      <option value="professional">💼 מקצועי</option>
                      <option value="formal">📋 פורמלי</option>
                    </select>
                  </div>
                  {/* Length */}
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] font-semibold text-slate-400 mb-1">אורך</label>
                    <select
                      value={contentLength}
                      onChange={e => setContentLength(e.target.value as typeof contentLength)}
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-600 px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:outline-none"
                    >
                      <option value="short">קצר</option>
                      <option value="medium">בינוני</option>
                      <option value="long">ארוך</option>
                    </select>
                  </div>
                  {/* Language */}
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] font-semibold text-slate-400 mb-1">שפה</label>
                    <select
                      value={cfg.language}
                      onChange={e => setCfg(c => ({ ...c, language: e.target.value as typeof cfg.language }))}
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-600 px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:outline-none"
                    >
                      <option value="he">🇮🇱 עברית</option>
                      <option value="en">🇺🇸 אנגלית</option>
                      <option value="auto">🌍 זיהוי אוטומטי</option>
                    </select>
                  </div>
                </div>

                {/* ── Generate button ─────────────────────────────────────── */}
                <button
                  onClick={handleGenerateContent}
                  disabled={contentGenerating || !contentPrompt.trim()}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                >
                  {contentGenerating
                    ? <><Loader2 size={16} className="animate-spin" /> יוצר תוכן...</>
                    : <><Sparkles size={16} /> צור תוכן AI</>
                  }
                </button>
              </div>

              {/* ── Result ───────────────────────────────────────────────────── */}
              {contentResult && (
                <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 overflow-hidden">

                  {/* Result header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-100 dark:border-indigo-800">
                    <div className="flex items-center gap-2">
                      <Check size={14} className="text-indigo-500" />
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">תוכן נוצר בהצלחה</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { navigator.clipboard.writeText(contentResult); onToast?.('הועתק ✓', 'success'); }}
                        className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 px-2 py-1 rounded-lg hover:bg-white/50 transition-colors"
                      >
                        <Download size={11} />
                        העתק
                      </button>
                      <button
                        onClick={handleGenerateContent}
                        disabled={contentGenerating}
                        className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 px-2 py-1 rounded-lg hover:bg-white/50 transition-colors"
                      >
                        <RefreshCw size={11} />
                        נסה שוב
                      </button>
                    </div>
                  </div>

                  {/* Editable content */}
                  <div className="p-4">
                    <textarea
                      rows={8}
                      value={contentResult}
                      onChange={e => setContentResult(e.target.value)}
                      className="w-full text-sm text-slate-700 dark:text-slate-200 bg-transparent resize-none focus:outline-none leading-relaxed"
                      dir="rtl"
                    />
                    <p className="text-[10px] text-slate-400 text-left">{contentResult.length} תווים</p>
                  </div>

                  {/* ── Publish question ───────────────────────────────────── */}
                  {showContentPublish && (
                    <div className="border-t border-indigo-100 dark:border-indigo-800 p-4 space-y-3 bg-gradient-to-br from-indigo-50/50 to-violet-50/50 dark:from-indigo-900/20 dark:to-violet-900/20">
                      <div className="flex items-center gap-2">
                        <Send size={14} className="text-indigo-500" />
                        <p className="text-sm font-bold text-slate-800 dark:text-white">לפרסם את התוכן?</p>
                      </div>

                      {/* Platform toggles */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">רשתות חברתיות</p>
                        <div className="flex flex-wrap gap-2">
                          {isConnected && (
                            <button
                              onClick={() => setContentPlatforms(p => p.includes('facebook') ? p.filter(x => x !== 'facebook') : [...p, 'facebook'])}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                contentPlatforms.includes('facebook')
                                  ? 'bg-[#1877f2] text-white border-[#1877f2]'
                                  : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-[#1877f2]'
                              }`}
                            >
                              📘 Facebook
                              {contentPlatforms.includes('facebook') && <Check size={10} />}
                            </button>
                          )}
                          {socialConns.filter(c => c.connected && c.accessToken && c.platform !== 'facebook').map(c => {
                            const pm = PLATFORMS.find(p => p.id === c.platform);
                            const on = contentPlatforms.includes(c.platform);
                            return (
                              <button
                                key={c.platform}
                                onClick={() => setContentPlatforms(p => on ? p.filter(x => x !== c.platform) : [...p, c.platform])}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                  on ? 'text-white border-transparent' : 'border-slate-200 dark:border-slate-600 text-slate-500 hover:border-indigo-400'
                                }`}
                                style={on ? { background: pm?.color } : {}}
                              >
                                {pm?.emoji} {pm?.label}
                                {on && <Check size={10} />}
                              </button>
                            );
                          })}
                          {!isConnected && socialConns.filter(c => c.connected).length === 0 && (
                            <button
                              onClick={() => setTab('settings')}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-500"
                            >
                              <Plus size={10} /> חבר רשת חברתית
                            </button>
                          )}
                        </div>

                        {/* Google option */}
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mt-2">גוגל</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setContentPlatforms(p => p.includes('google') ? p.filter(x => x !== 'google') : [...p, 'google'])}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                              contentPlatforms.includes('google')
                                ? 'bg-[#ea4335] text-white border-[#ea4335]'
                                : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-[#ea4335]'
                            }`}
                          >
                            🔍 Google Business
                            {contentPlatforms.includes('google') && <Check size={10} />}
                          </button>
                          <button
                            onClick={() => { navigator.clipboard.writeText(contentResult); onToast?.('תוכן המודעה הועתק — הדבק ב-Google Ads ✓', 'success'); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-500 hover:border-[#fbbc04] hover:text-amber-600 transition-all"
                          >
                            📋 העתק ל-Google Ads
                          </button>
                        </div>
                      </div>

                      {/* Publish action row */}
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={handlePublishContent}
                          disabled={publishingContent || contentPlatforms.filter(p => p !== 'google').length === 0}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all"
                          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
                        >
                          {publishingContent
                            ? <><Loader2 size={14} className="animate-spin" /> מפרסם...</>
                            : <><Send size={14} /> פרסם עכשיו</>
                          }
                        </button>
                        <button
                          onClick={() => setShowContentPublish(false)}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-3 py-2"
                        >
                          לא עכשיו
                        </button>
                        {contentPlatforms.filter(p => p !== 'google').length === 0 && (
                          <p className="text-[10px] text-amber-500">⚠️ בחר לפחות פלטפורמה אחת</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Show publish button if hidden */}
                  {!showContentPublish && (
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => setShowContentPublish(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
                      >
                        <Send size={12} />
                        פרסם לרשתות החברתיות / גוגל
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Empty state ───────────────────────────────────────────────── */}
              {!contentResult && !contentGenerating && (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center space-y-3">
                  <div className="text-3xl">✨</div>
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    כתוב פרומפט למעלה וה-AI יצור לך תוכן שיווקי
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {[
                      'פוסט על מבצע סוף עונה',
                      'מאמר על היתרונות שלנו',
                      'ניוזלטר ברכות לחגים',
                      'תסריט לסרטון הכרות',
                    ].map(ex => (
                      <button
                        key={ex}
                        onClick={() => setContentPrompt(ex)}
                        className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 transition-all"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── Sub-tab: ספריית קופי ──────────────────────────────────────── */}
          {creativeSubTab === 'library' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-lg" style={{ color: tc.text }}>ספריית קופי</h3>
                  <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>טקסטים שעבדו — שמור, ארגן, ייצר חדשים עם AI</p>
                </div>
                <button onClick={() => setShowCopyGen(v => !v)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                  <Sparkles size={14}/> ייצר עם AI
                </button>
              </div>

              {showCopyGen && (
                <div className="rounded-2xl p-5 space-y-3" style={{ background: tc.cardBg, border: '1px solid rgba(99,102,241,0.3)' }}>
                  <p className="font-bold text-sm" style={{ color: tc.text }}>🤖 מחולל קופי AI</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select value={copyGenType} onChange={e => setCopyGenType(e.target.value as CopyItem['type'])}
                      className="rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}>
                      <option value="headline">כותרת</option>
                      <option value="hook">Hook פותח</option>
                      <option value="body">גוף טקסט</option>
                      <option value="cta">CTA</option>
                      <option value="caption">כיתוב תמונה</option>
                    </select>
                    <input value={copyGenGoal} onChange={e => setCopyGenGoal(e.target.value)}
                      placeholder="מטרה / מה אתה מוכר?" className="rounded-xl px-3 py-2 text-sm border"
                      style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
                  </div>
                  <button onClick={handleGenerateCopy} disabled={copyGenLoading || !copyGenGoal}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                    {copyGenLoading ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>מייצר 5 וריאציות...</span></> : <><Sparkles size={14}/><span>ייצר 5 וריאציות</span></>}
                  </button>
                  {copyGenResults.length > 0 && (
                    <div className="space-y-2 pt-2 border-t" style={{ borderColor: tc.cardBorder }}>
                      <p className="text-xs font-bold" style={{ color: tc.textMuted }}>בחר וריאציות לשמירה:</p>
                      {copyGenResults.map((text, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-xl p-3" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}` }}>
                          <p className="flex-1 text-sm" style={{ color: tc.text }}>{text}</p>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button onClick={() => navigator.clipboard.writeText(text)} className="p-1.5 rounded-lg" style={{ color: tc.textMuted }} title="העתק"><Download size={13}/></button>
                            <button onClick={() => handleSaveCopyItem(text)} className="p-1.5 rounded-lg text-indigo-600" title="שמור"><Check size={13}/></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {(['all','headline','hook','body','cta','caption'] as const).map(f => (
                  <button key={f} onClick={() => setCopyFilter(f)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                    style={copyFilter === f ? { background: '#4f46e5', color: 'white' } : { background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', color: tc.textMuted }}>
                    {f === 'all' ? 'הכל' : f === 'headline' ? 'כותרות' : f === 'hook' ? 'Hooks' : f === 'body' ? 'גוף' : f === 'cta' ? 'CTA' : 'כיתוב'}
                  </button>
                ))}
              </div>

              <input value={copySearch} onChange={e => setCopySearch(e.target.value)}
                placeholder="חפש בספרייה..." className="w-full rounded-xl px-4 py-2.5 text-sm border"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>

              <div className="space-y-2">
                {copyItems
                  .filter(c => (copyFilter === 'all' || c.type === copyFilter) && (!copySearch || c.text.includes(copySearch)))
                  .map(item => {
                    const perfColors: Record<string, string> = { great: '#10b981', good: '#6366f1', average: '#f59e0b', poor: '#ef4444' };
                    const perfLabels: Record<string, string> = { great: '🔥 מצוין', good: '👍 טוב', average: '😐 ממוצע', poor: '👎 חלש' };
                    return (
                      <div key={item.id} className="rounded-2xl p-4 space-y-2" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mr-1" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                              {item.type === 'headline' ? 'כותרת' : item.type === 'hook' ? 'Hook' : item.type === 'body' ? 'גוף' : item.type === 'cta' ? 'CTA' : 'כיתוב'}
                            </span>
                            {item.performance && <span className="text-[10px]" style={{ color: perfColors[item.performance] }}>{perfLabels[item.performance]}</span>}
                            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: tc.text }}>{item.text}</p>
                          </div>
                          <div className="flex flex-col gap-1">
                            <button onClick={() => navigator.clipboard.writeText(item.text)} className="p-1.5 rounded-lg" style={{ color: tc.textMuted }}><Download size={12}/></button>
                            <button onClick={async () => { if (!wid) return; await deleteCopyItem(wid, item.id); setCopyItems(await loadCopyLibrary(wid)); }} className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}><Trash2 size={12}/></button>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          {(['great','good','average','poor'] as const).map(p => (
                            <button key={p} onClick={async () => { if (!wid) return; await updateCopyItem(wid, item.id, { performance: p }); setCopyItems(await loadCopyLibrary(wid)); }}
                              className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                              style={{ background: item.performance === p ? `${perfColors[p]}22` : isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', color: item.performance === p ? perfColors[p] : tc.textMuted }}>
                              {perfLabels[p]}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {copyItems.length === 0 && (
                  <div className="text-center py-12 rounded-2xl" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                    <p className="text-4xl mb-2">✍️</p>
                    <p className="font-bold text-sm" style={{ color: tc.text }}>הספרייה ריקה</p>
                    <p className="text-xs mt-1" style={{ color: tc.textMuted }}>ייצר קופי עם AI או שמור ידנית</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Sub-tab: בריף קמפיין ──────────────────────────────────────── */}
          {creativeSubTab === 'brief' && (
            <div className="space-y-4">
              {/* Brief generator */}
              <div className="rounded-2xl p-5 space-y-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                <div>
                  <p className="font-black text-sm" style={{ color: tc.text }}>📋 מחולל בריף קמפיין</p>
                  <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>ענה על 4 שאלות → AI יצור בריף מקצועי מלא</p>
                </div>
                <input value={briefProduct} onChange={e => setBriefProduct(e.target.value)} placeholder="מה אתה מוכר?"
                  className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
                <input value={briefGoal} onChange={e => setBriefGoal(e.target.value)} placeholder="מטרת הקמפיין (לידים / מכירות / מודעות)"
                  className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
                <input value={briefAudience} onChange={e => setBriefAudience(e.target.value)} placeholder="קהל יעד"
                  className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
                <input value={briefBudget} onChange={e => setBriefBudget(e.target.value)} placeholder="תקציב כולל ב-₪" type="number"
                  className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
                <button onClick={handleGenerateBrief} disabled={briefLoading || !briefProduct || !briefGoal}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                  {briefLoading ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>יוצר בריף...</span></> : <><Sparkles size={14}/><span>ייצר בריף</span></>}
                </button>
                {generatedBrief && (
                  <div className="rounded-xl p-4 space-y-2" style={{ background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <p className="font-black text-sm" style={{ color: '#6366f1' }}>{generatedBrief.name}</p>
                    <p className="text-xs" style={{ color: tc.textMuted }}><strong>מסר:</strong> {generatedBrief.keyMessage}</p>
                    <p className="text-xs" style={{ color: tc.textMuted }}><strong>קהל:</strong> {generatedBrief.targetAudience}</p>
                    <p className="text-xs whitespace-pre-wrap" style={{ color: tc.text }}><strong>טקסט פרסומת:</strong><br/>{generatedBrief.adCopy}</p>
                    <p className="text-xs" style={{ color: tc.textMuted }}><strong>ויזואל:</strong> {generatedBrief.visualConcept}</p>
                    <div className="flex gap-2">
                      <button onClick={handleSaveBrief} className="flex-1 py-2 rounded-xl text-xs font-bold text-white" style={{ background: '#10b981' }}>שמור בריף</button>
                      <button onClick={() => { navigator.clipboard.writeText(generatedBrief.adCopy || ''); onToast?.('הועתק', 'success'); }}
                        className="px-4 py-2 rounded-xl text-xs font-bold" style={{ background: isDark ? 'rgba(255,255,255,0.1)' : '#f1f5f9', color: tc.textMuted }}>
                        העתק
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Saved briefs list */}
              {briefs.length > 0 && (
                <div className="space-y-2">
                  <p className="font-black text-sm" style={{ color: tc.text }}>📋 בריפים שמורים ({briefs.length})</p>
                  {briefs.map(brief => (
                    <div key={brief.id} className="rounded-2xl p-4 space-y-2" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm truncate" style={{ color: '#6366f1' }}>{brief.name}</p>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            <span className="text-[10px]" style={{ color: tc.textMuted }}>🎯 {brief.goal}</span>
                            <span className="text-[10px]" style={{ color: tc.textMuted }}>💰 {brief.budget.toLocaleString()}₪</span>
                          </div>
                        </div>
                        <button onClick={async () => { const { deleteBrief } = await import('../lib/marketingEnhancements'); await deleteBrief(wid!, brief.id); setBriefs(await loadBriefs(wid!)); }}
                          className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}><Trash2 size={13}/></button>
                      </div>
                      <p className="text-xs" style={{ color: tc.textMuted }}><strong style={{ color: tc.text }}>מסר:</strong> {brief.keyMessage}</p>
                      {brief.adCopy && (
                        <div className="rounded-xl p-2.5 text-xs" style={{ background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)', color: tc.text }}>
                          {brief.adCopy.slice(0, 200)}{brief.adCopy.length > 200 ? '...' : ''}
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <button onClick={() => { navigator.clipboard.writeText(brief.adCopy || ''); onToast?.('הועתק', 'success'); }}
                          className="text-[10px] px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                          📋 העתק טקסט
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {briefs.length === 0 && !briefLoading && !generatedBrief && (
                <div className="text-center py-8 rounded-2xl" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                  <p className="text-3xl mb-2">📋</p>
                  <p className="text-sm font-bold" style={{ color: tc.text }}>אין בריפים שמורים עדיין</p>
                  <p className="text-xs mt-1" style={{ color: tc.textMuted }}>מלא את הטופס למעלה ולחץ "ייצר בריף"</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ AUTOPILOT TAB ════════════════════════════════════════════════ */}
      {tab === 'autopilot' && (
        <MarketingAutopilot wid={wid} workspace={workspace} onToast={onToast} />
      )}

      {/* ══ CONTENT PLANNER SUB-TAB ══════════════════════════════════════ */}
      {tab === 'campaigns' && campaignsSubTab === 'plan' && (
        <ContentPlanner
          wid={wid}
          workspace={workspace}
          productProfile={productProfile}
          onToast={onToast}
          language={cfg.language === 'auto' ? 'he' : (cfg.language as 'he' | 'en')}
        />
      )}

      {/* ══ ANALYTICS TAB ════════════════════════════════════════════════ */}
      {tab === 'campaigns' && campaignsSubTab === 'analytics' && (
        <div className="space-y-4" dir="rtl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-lg" style={{ color: tc.text }}>אנליטיקס קמפיינים</h3>
              <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>נתוני ביצועים, לידים ותובנות AI</p>
            </div>
            <button onClick={handleGetInsights} disabled={insightsLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              {insightsLoading ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>מנתח...</span></> : <><Sparkles size={14}/><span>נתח עם AI</span></>}
            </button>
          </div>

          {/* ── KPI Summary Row ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'קמפיינים פורסמו', value: myCampaigns.filter(c => c.status === 'published').length, icon: '🚀', color: '#6366f1' },
              { label: 'סה"כ לידים', value: totalLeads, icon: '👥', color: '#10b981' },
              { label: 'לייקים', value: fmtNum(myCampaigns.reduce((s,c) => s + (c.metrics?.likes || 0), 0)), icon: '❤️', color: '#ef4444' },
              { label: 'חשיפה', value: fmtNum(myCampaigns.reduce((s,c) => s + (c.metrics?.reach || 0), 0)), icon: '👁️', color: '#f59e0b' },
              { label: 'תגובות', value: fmtNum(myCampaigns.reduce((s,c) => s + (c.metrics?.comments || 0), 0)), icon: '💬', color: '#8b5cf6' },
              { label: 'תקציב כולל', value: `${myCampaigns.reduce((s,c) => s + (c.budgetAmount || 0), 0).toLocaleString()}₪`, icon: '💰', color: '#0ea5e9' },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl p-3 flex items-center gap-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                <span className="text-2xl">{stat.icon}</span>
                <div>
                  <div className="text-lg font-black leading-tight" style={{ color: stat.color }}>{stat.value}</div>
                  <div className="text-[10px]" style={{ color: tc.textMuted }}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── AI Insights ───────────────────────────────────────────────── */}
          {analyticsInsights.length > 0 && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="font-black text-sm flex items-center gap-2" style={{ color: '#6366f1' }}><Sparkles size={14}/> תובנות AI</p>
              <ul className="space-y-2">
                {analyticsInsights.map((insight, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: tc.text }}>
                    <span className="text-indigo-500 font-black flex-shrink-0 mt-0.5">•</span>{insight}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analyticsInsights.length === 0 && (
            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(99,102,241,0.04)', border: '1px dashed rgba(99,102,241,0.2)' }}>
              <p className="text-xs" style={{ color: tc.textMuted }}>לחץ "נתח עם AI" לקבלת תובנות חכמות על הקמפיינים שלך</p>
            </div>
          )}

          {/* ── Campaign Results Table ────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${tc.cardBorder}` }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', borderBottom: `1px solid ${tc.cardBorder}` }}>
              <p className="font-black text-sm" style={{ color: tc.text }}>📊 תוצאות קמפיינים</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>{myCampaigns.length} קמפיינים</span>
            </div>
            {myCampaigns.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-3xl mb-2">📭</p>
                <p className="text-sm font-bold" style={{ color: tc.text }}>אין קמפיינים עדיין</p>
                <p className="text-xs mt-1" style={{ color: tc.textMuted }}>צור קמפיין בטאב "פרסום ברשתות"</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: tc.cardBorder }}>
                {myCampaigns.map(camp => {
                  const statusColor = camp.status === 'published' ? '#10b981' : camp.status === 'scheduled' ? '#f59e0b' : '#94a3b8';
                  const statusLabel = camp.status === 'published' ? 'פורסם' : camp.status === 'scheduled' ? 'מתוזמן' : 'טיוטה';
                  return (
                    <div key={camp.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm truncate" style={{ color: tc.text }}>{camp.name || camp.goal}</p>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0" style={{ background: `${statusColor}20`, color: statusColor }}>{statusLabel}</span>
                          </div>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            {camp.platforms?.map(p => (
                              <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: tc.textMuted }}>{p}</span>
                            ))}
                            {camp.budgetAmount ? <span className="text-[10px]" style={{ color: tc.textMuted }}>💰 {camp.budgetAmount.toLocaleString()}₪</span> : null}
                          </div>
                        </div>
                        {camp.mediaUrl && (
                          <img src={camp.mediaUrl} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0"/>
                        )}
                      </div>
                      {camp.metrics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { l: '❤️ לייקים', v: fmtNum(camp.metrics.likes || 0) },
                            { l: '💬 תגובות', v: fmtNum(camp.metrics.comments || 0) },
                            { l: '🔁 שיתופים', v: fmtNum(camp.metrics.shares || 0) },
                            { l: '👁️ חשיפה', v: fmtNum(camp.metrics.reach || 0) },
                          ].map(m => (
                            <div key={m.l} className="rounded-xl p-2 text-center" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc' }}>
                              <div className="text-sm font-black" style={{ color: tc.text }}>{m.v}</div>
                              <div className="text-[9px]" style={{ color: tc.textMuted }}>{m.l}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!camp.metrics && camp.status === 'published' && (
                        <div className="text-[10px]" style={{ color: tc.textMuted }}>אין נתוני ביצועים עדיין — לחץ "רענן מדדים" בטאב הקמפיינים</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Leads by source ───────────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${tc.cardBorder}` }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', borderBottom: `1px solid ${tc.cardBorder}` }}>
              <p className="font-black text-sm" style={{ color: tc.text }}>👥 לידים לפי מקור</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>סה"כ {totalLeads}</span>
            </div>
            {leadsData.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs" style={{ color: tc.textMuted }}>אין נתוני לידים עדיין</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {leadsData.map(src => {
                  const pct = totalLeads > 0 ? Math.round((src.count / totalLeads) * 100) : 0;
                  const barColor = SOURCE_COLORS[src.source] ?? '#6366f1';
                  return (
                    <div key={src.source} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: barColor }}/>
                          <span className="text-xs font-bold" style={{ color: tc.text }}>{src.source}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black" style={{ color: barColor }}>{src.count}</span>
                          <span className="text-[10px]" style={{ color: tc.textMuted }}>{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Leads source detail cards ─────────────────────────────────── */}
          {leadsData.length > 0 && (
            <div className="space-y-3">
              <p className="font-black text-sm" style={{ color: tc.text }}>📊 פירוט מקורות לידים</p>
              {leadsData.map(row => {
                const color = SOURCE_COLORS[row.source] ?? '#94a3b8';
                const pct = totalLeads > 0 ? Math.round((row.count / totalLeads) * 100) : 0;
                return (
                  <div key={row.source} className="rounded-2xl border p-4" style={{ borderColor: tc.cardBorder, background: tc.cardBg }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                        <span className="font-semibold text-sm" style={{ color: tc.text }}>{row.source}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs" style={{ color: tc.textMuted }}>{row.count} לידים</span>
                        <span className="text-sm font-black" style={{ color }}>{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[11px]" style={{ color: tc.textMuted }}>
                        תקציב ממוצע: ₪{row.count > 0 ? Math.round(row.budget / row.count).toLocaleString('he-IL') : 0}
                      </span>
                      <span className="text-[11px]" style={{ color: tc.textMuted }}>
                        סה״כ: ₪{row.budget.toLocaleString('he-IL')}
                      </span>
                    </div>
                  </div>
                );
              })}
              {/* UTM info panel */}
              <div className="rounded-2xl border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-4">
                <div className="flex items-start gap-2">
                  <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">מעקב UTM אוטומטי</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
                      כדי לעקוב אחר מקור לידים מקמפיינים, הוסף פרמטרי UTM לקישורים שלך:
                    </p>
                    <code className="block mt-2 text-[11px] bg-blue-100 dark:bg-blue-800/50 rounded-lg p-2 text-blue-800 dark:text-blue-300 font-mono break-all">
                      ?utm_source=facebook&utm_medium=ad&utm_campaign=campaign_name
                    </code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Budget Recommendations ────────────────────────────────────── */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
            <p className="font-black text-sm" style={{ color: tc.text }}>💡 המלצות תקציב</p>
            <div className="flex gap-2">
              <input value={totalBudgetInput} onChange={e => setTotalBudgetInput(e.target.value)} type="number" placeholder="תקציב כולל ₪"
                className="flex-1 rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <button onClick={handleGetBudgetRec} disabled={budgetLoading}
                className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {budgetLoading ? '...' : 'המלץ'}
              </button>
            </div>
            {budgetRec && (
              <div className="space-y-2">
                <p className="text-xs rounded-xl p-2" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', color: tc.text }}>{budgetRec.summary}</p>
                {budgetRec.recommendations.map((r, i) => (
                  <div key={i} className="rounded-xl p-3 flex items-center gap-3" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}` }}>
                    <div className="flex-1">
                      <p className="text-xs font-bold" style={{ color: tc.text }}>{r.platform}</p>
                      <p className="text-[10px]" style={{ color: tc.textMuted }}>{r.reason}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] line-through" style={{ color: tc.textMuted }}>{r.currentSpend}₪</p>
                      <p className="text-sm font-black" style={{ color: '#10b981' }}>{r.recommendedSpend}₪</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Retargeting Helper ────────────────────────────────────────── */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-sm" style={{ color: tc.text }}>🎯 עוזר Retargeting</p>
                <p className="text-xs" style={{ color: tc.textMuted }}>AI מייצר רעיון לקמפיין רטארגטינג</p>
              </div>
              <button onClick={handleGenerateRetarget} disabled={retargetLoading}
                className="text-xs px-3 py-1.5 rounded-xl font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {retargetLoading ? '...' : 'ייצר'}
              </button>
            </div>
            {retargetIdea && (
              <div className="space-y-2 pt-2 border-t" style={{ borderColor: tc.cardBorder }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="rounded-xl p-3" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}` }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: tc.textMuted }}>כותרת</p>
                    <p className="text-sm font-bold" style={{ color: tc.text }}>{retargetIdea.headline}</p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}` }}>
                    <p className="text-[10px] font-bold mb-1" style={{ color: tc.textMuted }}>CTA</p>
                    <p className="text-sm font-bold" style={{ color: '#6366f1' }}>{retargetIdea.cta}</p>
                  </div>
                </div>
                <div className="rounded-xl p-3" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}` }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: tc.textMuted }}>טקסט</p>
                  <p className="text-xs" style={{ color: tc.text }}>{retargetIdea.body}</p>
                </div>
                <div className="rounded-xl p-2.5 flex items-center gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <Target size={12} style={{ color: '#f59e0b' }}/>
                  <p className="text-[11px]" style={{ color: '#f59e0b' }}><strong>מי לטרגט:</strong> {retargetIdea.targetSegment}</p>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(`${retargetIdea.headline}\n\n${retargetIdea.body}\n\n${retargetIdea.cta}`); onToast?.('הועתק', 'success'); }}
                  className="w-full py-2 rounded-xl text-xs font-bold"
                  style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: tc.textMuted }}>
                  📋 העתק פרסומת
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ AUDIENCES TAB ════════════════════════════════════════════════ */}
      {tab === 'campaigns' && campaignsSubTab === 'audiences' && (
        <div className="space-y-4" dir="rtl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-lg" style={{ color: tc.text }}>בנאי קהלים</h3>
              <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>בנה ונהל קהלי יעד לפרסומות</p>
            </div>
            <button onClick={() => setShowAudienceForm(v => !v)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              <Plus size={14}/> קהל חדש עם AI
            </button>
          </div>

          {showAudienceForm && (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: tc.cardBg, border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="font-bold text-sm" style={{ color: tc.text }}>🤖 AI יבנה קהל יעד אידיאלי</p>
              <input value={audienceProduct} onChange={e => setAudienceProduct(e.target.value)} placeholder="מה אתה מוכר?"
                className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <input value={audienceGoal} onChange={e => setAudienceGoal(e.target.value)} placeholder="מטרת הפרסום"
                className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <textarea value={audienceCustomers} onChange={e => setAudienceCustomers(e.target.value)}
                placeholder="תאר את הלקוחות הקיימים שלך (גיל, תחביבים, מקצוע...)"
                rows={2} className="w-full rounded-xl px-3 py-2 text-sm border resize-none"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <div className="flex gap-2">
                <button onClick={handleBuildAudience} disabled={audienceLoading || !audienceProduct}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                  {audienceLoading ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>בונה...</span></> : <><Users size={14}/><span>בנה קהל</span></>}
                </button>
                <button onClick={() => setShowAudienceForm(false)} className="px-5 py-2.5 rounded-xl text-sm" style={{ color: tc.textMuted }}>ביטול</button>
              </div>
            </div>
          )}

          {audiences.length === 0 ? (
            <div className="text-center py-12 rounded-2xl" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
              <p className="text-5xl mb-3">👥</p>
              <p className="font-bold" style={{ color: tc.text }}>אין קהלים שמורים</p>
              <p className="text-xs mt-1" style={{ color: tc.textMuted }}>בנה קהל יעד אידיאלי עם AI</p>
            </div>
          ) : (
            <div className="space-y-3">
              {audiences.map(aud => {
                const typeColors: Record<string, string> = { custom: '#6366f1', lookalike: '#10b981', interest: '#f59e0b', retargeting: '#ef4444' };
                const typeLabels: Record<string, string> = { custom: 'מותאם', lookalike: 'דמוי קהל', interest: 'עניין', retargeting: 'רטארגט' };
                return (
                  <div key={aud.id} className="rounded-2xl p-4 space-y-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: `${typeColors[aud.type]}22`, color: typeColors[aud.type] }}>
                            {typeLabels[aud.type]}
                          </span>
                          <span className="text-[10px]" style={{ color: tc.textMuted }}>{aud.estimatedSize}</span>
                        </div>
                        <p className="font-bold text-sm" style={{ color: tc.text }}>{aud.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>{aud.description}</p>
                      </div>
                      <button onClick={async () => { if (!wid) return; await deleteAudience(wid, aud.id); setAudiences(await loadAudiences(wid)); }}
                        className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}><Trash2 size={13}/></button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div style={{ color: tc.textMuted }}><strong style={{ color: tc.text }}>גיל:</strong> {aud.ageRange}</div>
                      <div style={{ color: tc.textMuted }}><strong style={{ color: tc.text }}>מגדר:</strong> {aud.gender}</div>
                      <div style={{ color: tc.textMuted }}><strong style={{ color: tc.text }}>מיקום:</strong> {aud.locations.join(', ')}</div>
                      <div style={{ color: tc.textMuted }}><strong style={{ color: tc.text }}>פלטפורמה:</strong> {aud.platform}</div>
                    </div>
                    {aud.interests.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {aud.interests.map(interest => (
                          <span key={interest} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: tc.textMuted }}>{interest}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ COMPETITOR TAB — REMOVED ═════════════════════════════════════ */}
      {false && (
        <div className="space-y-4" dir="rtl">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-black text-lg" style={{ color: tc.text }}>מחקר מתחרים</h3>
              <p className="text-xs mt-0.5" style={{ color: tc.textMuted }}>עקוב אחר פרסומות מתחרים + ניתוח AI</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a href="https://www.facebook.com/ads/library" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold"
                style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', color: tc.text }}>
                <ExternalLink size={13}/> Meta Ad Library
              </a>
              <button onClick={() => setShowAddCompetitor(v => !v)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                <Plus size={14}/> שמור פרסומת
              </button>
            </div>
          </div>

          <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <Info size={15} style={{ color: '#3b82f6' }} className="flex-shrink-0 mt-0.5"/>
            <div className="text-xs" style={{ color: tc.text }}>
              <strong>איך להשתמש:</strong> כנס ל-Meta Ad Library, חפש את שם המתחרה, העתק את טקסט הפרסומת ושמור כאן. AI ינתח ויספר לך מה ללמוד.
            </div>
          </div>

          {showAddCompetitor && (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: tc.cardBg, border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="font-bold text-sm" style={{ color: tc.text }}>שמור פרסומת מתחרה</p>
              <input value={compName} onChange={e => setCompName(e.target.value)} placeholder="שם המתחרה / החברה"
                className="w-full rounded-xl px-3 py-2 text-sm border" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <textarea value={compAdText} onChange={e => setCompAdText(e.target.value)}
                placeholder="העתק את טקסט הפרסומת כאן..." rows={4}
                className="w-full rounded-xl px-3 py-2 text-sm border resize-none"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: tc.cardBorder, color: tc.text }}/>
              <div className="flex gap-2">
                <button onClick={handleSaveCompetitor} disabled={!compName || !compAdText}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>שמור</button>
                <button onClick={() => setShowAddCompetitor(false)} className="px-5 py-2.5 rounded-xl text-sm" style={{ color: tc.textMuted }}>ביטול</button>
              </div>
            </div>
          )}

          {competitors.length === 0 ? (
            <div className="text-center py-12 rounded-2xl" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
              <p className="text-5xl mb-3">🕵️</p>
              <p className="font-bold" style={{ color: tc.text }}>אין פרסומות מתחרים שמורות</p>
              <p className="text-xs mt-1" style={{ color: tc.textMuted }}>שמור פרסומות מהMeta Ad Library ונתח אותן</p>
            </div>
          ) : (
            <div className="space-y-3">
              {competitors.map(ad => (
                <div key={ad.id} className="rounded-2xl p-4 space-y-3" style={{ background: tc.cardBg, border: `1px solid ${tc.cardBorder}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-sm" style={{ color: tc.text }}>{ad.competitorName}</p>
                      <p className="text-[10px]" style={{ color: tc.textMuted }}>{ad.startDate}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          setCompAnalyzing(ad.id);
                          try {
                            const analysis = await analyzeCompetitorAd(ad.adText, productProfile?.productName || 'המוצר שלנו');
                            setCompAnalysis(prev => ({ ...prev, [ad.id]: analysis }));
                          } finally { setCompAnalyzing(null); }
                        }}
                        disabled={compAnalyzing === ad.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg font-bold disabled:opacity-50"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                        {compAnalyzing === ad.id ? '...' : '🧠 נתח'}
                      </button>
                      <button onClick={async () => { if (!wid) return; await deleteCompetitorAd(wid, ad.id); setCompetitors(await loadCompetitorAds(wid)); }}
                        className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}><Trash2 size={13}/></button>
                    </div>
                  </div>
                  <div className="rounded-xl p-3 text-xs" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${tc.cardBorder}`, color: tc.text }}>
                    {ad.adText}
                  </div>
                  {compAnalysis[ad.id] && (
                    <div className="rounded-xl p-3 text-xs whitespace-pre-wrap" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', color: tc.text }}>
                      <p className="font-black mb-1" style={{ color: '#6366f1' }}>🧠 ניתוח AI:</p>
                      {compAnalysis[ad.id]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: CONNECTIONS — redirect to Integrations page
       * ══════════════════════════════════════════════════════════════════════ */}
      {false && tab === 'connections_removed' && (
        <div className="space-y-4" dir="rtl">

          {/* Hero redirect banner */}
          <div className="rounded-2xl overflow-hidden border border-indigo-200 dark:border-indigo-700"
            style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.06))' }}>
            <div className="p-6 flex flex-col md:flex-row items-center gap-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 4px 20px rgba(99,102,241,0.35)' }}>
                <Globe size={26} className="text-white" />
              </div>
              <div className="flex-1 text-center md:text-right">
                <h3 className="font-black text-slate-800 dark:text-white text-lg">ניהול חיבורים לרשתות חברתיות</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  חיבור הפלטפורמות, מדריכי הגדרה מקצועיים וסיוע AI זמינים בדף האינטגרציות
                </p>
              </div>
              <button
                onClick={() => onNavigate?.('integrations')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white flex-shrink-0 transition-all hover:scale-105 shadow-lg"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                <ExternalLink size={14} /> עבור לאינטגרציות
              </button>
            </div>
          </div>

          {/* ── Main platforms: Facebook & Google ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Facebook / Meta card */}
            {(() => {
              const active = !!effectiveMeta?.connected;
              const page = effectiveMeta?.pages?.find(p => p.subscribed) ?? effectiveMeta?.pages?.[0];
              return (
                <div className="rounded-2xl border p-4"
                  style={{ borderColor: active ? 'rgba(24,119,242,0.35)' : 'rgba(148,163,184,0.2)', background: active ? 'rgba(24,119,242,0.05)' : 'transparent' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">📘</span>
                      <div>
                        <p className="text-sm font-black" style={{ color: tc.textPrimary }}>Meta</p>
                        <p className="text-[10px]" style={{ color: tc.textMuted }}>Facebook & Instagram</p>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}
                      style={{ background: active ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.1)', border: `1px solid ${active ? 'rgba(16,185,129,0.25)' : 'rgba(148,163,184,0.2)'}` }}>
                      {active ? '● מחובר' : '○ לא מחובר'}
                    </span>
                  </div>
                  {active && page && (
                    <div className="rounded-xl p-2.5 mb-2" style={{ background: 'rgba(24,119,242,0.08)', border: '1px solid rgba(24,119,242,0.15)' }}>
                      <p className="text-[11px] font-semibold" style={{ color: tc.textPrimary }}>📄 {page.name}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: tc.textMuted }}>
                        {effectiveMeta?.adAccounts?.length ? `${effectiveMeta.adAccounts.length} חשבונות פרסום` : 'ללא חשבון פרסום'}
                      </p>
                    </div>
                  )}
                  <button onClick={() => onNavigate?.('integrations')}
                    className="w-full text-center text-[11px] font-semibold py-1.5 rounded-xl transition-all"
                    style={{ background: 'rgba(24,119,242,0.1)', color: '#1877f2', border: '1px solid rgba(24,119,242,0.2)' }}>
                    {active ? 'נהל חיבור' : 'חבר עכשיו'} →
                  </button>
                </div>
              );
            })()}

            {/* Google Ads card */}
            {(() => {
              const conn = getSocialConn('google');
              const active = conn.connected && !!conn.accessToken;
              return (
                <div className="rounded-2xl border p-4"
                  style={{ borderColor: active ? 'rgba(66,133,244,0.35)' : 'rgba(148,163,184,0.2)', background: active ? 'rgba(66,133,244,0.05)' : 'transparent' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🔴</span>
                      <div>
                        <p className="text-sm font-black" style={{ color: tc.textPrimary }}>Google Ads</p>
                        <p className="text-[10px]" style={{ color: tc.textMuted }}>Search · Lead Form</p>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}
                      style={{ background: active ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.1)', border: `1px solid ${active ? 'rgba(16,185,129,0.25)' : 'rgba(148,163,184,0.2)'}` }}>
                      {active ? '● מחובר' : '○ לא מחובר'}
                    </span>
                  </div>
                  {active && (
                    <div className="rounded-xl p-2.5 mb-2" style={{ background: 'rgba(66,133,244,0.08)', border: '1px solid rgba(66,133,244,0.15)' }}>
                      <p className="text-[11px] font-semibold" style={{ color: tc.textPrimary }}>✅ OAuth מחובר</p>
                      <p className="text-[10px] mt-0.5" style={{ color: tc.textMuted }}>לידים מ-Google Ads מגיעים אוטומטית</p>
                    </div>
                  )}
                  <button onClick={() => onNavigate?.('integrations')}
                    className="w-full text-center text-[11px] font-semibold py-1.5 rounded-xl transition-all"
                    style={{ background: 'rgba(66,133,244,0.1)', color: '#4285f4', border: '1px solid rgba(66,133,244,0.2)' }}>
                    {active ? 'נהל קמפיינים' : 'חבר עכשיו'} →
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Platform status overview — all others */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
            <h4 className="text-sm font-black text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
              <Activity size={14} className="text-indigo-500" /> שאר הפלטפורמות
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PLATFORMS.filter(pm => pm.id !== 'google' && pm.id !== 'facebook' && pm.id !== 'instagram').map(pm => {
                const conn = getSocialConn(pm.id);
                const active = conn.connected && !!conn.accessToken;
                return (
                  <div key={pm.id}
                    className="flex items-center gap-2 p-2.5 rounded-xl border transition-all"
                    style={{
                      borderColor: active ? `${pm.color}40` : 'rgba(148,163,184,0.2)',
                      background: active ? `${pm.bgColor}` : 'transparent',
                    }}>
                    <span className="text-base">{pm.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{pm.label}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                        <span className={`text-[10px] font-medium ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                          {active ? 'מחובר' : 'לא מחובר'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { emoji: '📖', title: 'מדריכי הגדרה', desc: 'הוראות צעד-אחר-צעד לכל פלטפורמה', color: '#6366f1' },
              { emoji: '🤖', title: 'שאל את ריי AI', desc: 'קבל עזרה מותאמת אישית לחיבור', color: '#8b5cf6' },
              { emoji: '🔗', title: 'חיבור מהיר', desc: 'חבר ונתק פלטפורמות בקליק', color: '#10b981' },
            ].map(({ emoji, title, desc, color }) => (
              <button key={title}
                onClick={() => onNavigate?.('integrations')}
                className="flex items-center gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600 transition-all text-right group">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: `${color}18`, border: `1px solid ${color}35` }}>
                  {emoji}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Credentials modal — keep for backward compat but redirect instead */}
          {showCredModal && (() => {
            const pm = PLATFORMS.find(p => p.id === showCredModal)!
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{pm.emoji}</span>
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white">חיבור {pm.label}</h3>
                      <p className="text-xs text-slate-500">הזן את פרטי אפליקציית ה-OAuth שלך</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Client ID / App Key</label>
                      <input
                        type="text"
                        value={credClientId}
                        onChange={e => setCredClientId(e.target.value)}
                        className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="1234567890"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Client Secret</label>
                      <input
                        type="password"
                        value={credClientSecret}
                        onChange={e => setCredClientSecret(e.target.value)}
                        className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="••••••••••••"
                        dir="ltr"
                      />
                    </div>
                    <a
                      href={pm.tokenHelpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-500 hover:underline flex items-center gap-1"
                    >
                      <ChevronRight size={11} />
                      כיצד להשיג Client ID ו-Secret עבור {pm.label}?
                    </a>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => { setShowCredModal(null); setCredClientId(''); setCredClientSecret(''); }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      ביטול
                    </button>
                    <button
                      disabled={!credClientId.trim() || !credClientSecret.trim() || connectingPlatform === showCredModal}
                      onClick={handleCredModalSubmit}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: pm.color }}
                    >
                      {connectingPlatform === showCredModal
                        ? <><Loader2 size={13} className="animate-spin" /> מחבר...</>
                        : <>חבר {pm.label}</>
                      }
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * TAB: SETTINGS
       * ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'settings' && (
        <div className="space-y-4 w-full" dir="rtl">

          {/* ══ 0. חיבורים לרשתות חברתיות ═══════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-indigo-50 dark:from-indigo-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <Globe size={13} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">חיבורים לרשתות חברתיות</h3>
                <p className="text-[10px] text-slate-400">נהל את החיבורים לפלטפורמות הפרסום</p>
              </div>
              <button onClick={() => onNavigate?.('integrations')}
                className="mr-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                <ExternalLink size={12}/> כל האינטגרציות
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Facebook / Meta */}
              {(() => {
                const active = !!effectiveMeta?.connected;
                const page = effectiveMeta?.pages?.find(p => p.subscribed) ?? effectiveMeta?.pages?.[0];
                return (
                  <div className="rounded-xl border p-4" style={{ borderColor: active ? 'rgba(24,119,242,0.3)' : 'rgba(148,163,184,0.2)', background: active ? 'rgba(24,119,242,0.04)' : 'transparent' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">📘</span>
                        <span className="font-bold text-sm" style={{ color: active ? '#1877f2' : tc.textMuted }}>Meta (Facebook)</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {active ? 'מחובר ✓' : 'לא מחובר'}
                      </span>
                    </div>
                    {active && page && <p className="text-xs" style={{ color: tc.textMuted }}>📄 {page.name}</p>}
                    {!active && (
                      <button onClick={() => onNavigate?.('integrations')}
                        className="mt-2 w-full py-1.5 rounded-xl text-xs font-bold"
                        style={{ background: 'rgba(24,119,242,0.1)', color: '#1877f2' }}>
                        חבר עכשיו
                      </button>
                    )}
                  </div>
                );
              })()}
              {/* Google Ads */}
              {(() => {
                const conn = getSocialConn('google');
                return (
                  <div className="rounded-xl border p-4" style={{ borderColor: conn.connected ? 'rgba(66,133,244,0.3)' : 'rgba(148,163,184,0.2)', background: conn.connected ? 'rgba(66,133,244,0.04)' : 'transparent' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🔴</span>
                        <span className="font-bold text-sm" style={{ color: conn.connected ? '#4285f4' : tc.textMuted }}>Google Ads</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${conn.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {conn.connected ? 'מחובר ✓' : 'לא מחובר'}
                      </span>
                    </div>
                    {!conn.connected && (
                      <button onClick={() => onNavigate?.('integrations')}
                        className="mt-2 w-full py-1.5 rounded-xl text-xs font-bold"
                        style={{ background: 'rgba(66,133,244,0.1)', color: '#4285f4' }}>
                        חבר עכשיו
                      </button>
                    )}
                  </div>
                );
              })()}
              {/* Instagram */}
              {(() => {
                const igConn = effectiveMeta?.pages?.find(p => p.instagramBusinessAccountId);
                return (
                  <div className="rounded-xl border p-4" style={{ borderColor: igConn ? 'rgba(225,48,108,0.3)' : 'rgba(148,163,184,0.2)', background: igConn ? 'rgba(225,48,108,0.04)' : 'transparent' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">📸</span>
                        <span className="font-bold text-sm" style={{ color: igConn ? '#e1306c' : tc.textMuted }}>Instagram</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${igConn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {igConn ? 'מחובר ✓' : 'דרך Meta'}
                      </span>
                    </div>
                    {igConn && <p className="text-xs mt-1" style={{ color: tc.textMuted }}>מחובר דרך Facebook Business</p>}
                  </div>
                );
              })()}
              {/* WhatsApp */}
              {(() => {
                const waConn = getSocialConn('whatsapp');
                return (
                  <div className="rounded-xl border p-4" style={{ borderColor: waConn.connected ? 'rgba(37,211,102,0.3)' : 'rgba(148,163,184,0.2)', background: waConn.connected ? 'rgba(37,211,102,0.04)' : 'transparent' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">💬</span>
                        <span className="font-bold text-sm" style={{ color: waConn.connected ? '#25d366' : tc.textMuted }}>WhatsApp</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${waConn.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {waConn.connected ? 'מחובר ✓' : 'לא מחובר'}
                      </span>
                    </div>
                    {!waConn.connected && (
                      <button onClick={() => onNavigate?.('integrations')}
                        className="mt-2 w-full py-1.5 rounded-xl text-xs font-bold"
                        style={{ background: 'rgba(37,211,102,0.1)', color: '#25d366' }}>
                        חבר עכשיו
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* API keys moved to the Admin Console → Integrations (admin-only, global). */}

          {/* ══ 1. זהות הסוכן ══════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-indigo-50 dark:from-indigo-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <Zap size={13} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">זהות הסוכן</h3>
                <p className="text-[10px] text-slate-400">שם, חתימה ושפת ברירת מחדל</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שם הסוכן / העסק</label>
                  <input type="text"
                    className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={cfg.agentName}
                    onChange={e => setCfg(c => ({ ...c, agentName: e.target.value }))}
                    placeholder="שם שיוצג בתגובות" dir="rtl" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">חתימה בתגובות</label>
                  <input type="text"
                    className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={cfg.signature}
                    onChange={e => setCfg(c => ({ ...c, signature: e.target.value }))}
                    placeholder="צוות X, נשמח לעזור!" dir="rtl" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שפת תוכן</label>
                <div className="flex gap-2">
                  {[{ v:'he', l:'🇮🇱 עברית' }, { v:'en', l:'🇺🇸 English' }, { v:'auto', l:'🌍 אוטומטי' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, language: v as typeof cfg.language }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.language === v
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ══ 2. תיאור העסק ══════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-emerald-50 dark:from-emerald-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <Globe size={13} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-slate-800 dark:text-white">תיאור העסק</h3>
                <p className="text-[10px] text-slate-400">הקשר שה-AI משתמש בו לכל יצירת תוכן</p>
              </div>
              {workspace?.prompt && cfg.businessDescription !== workspace.prompt && (
                <button
                  onClick={() => setCfg(c => ({ ...c, businessDescription: workspace.prompt ?? '' }))}
                  className="text-[10px] font-semibold text-emerald-600 hover:underline flex-shrink-0"
                >
                  ← ייבא מהגדרות המערכת
                </button>
              )}
            </div>
            <div className="p-5 space-y-3">
              {workspace?.prompt && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
                  <Info size={12} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">מהגדרות המערכת:</span> {workspace.prompt.slice(0, 120)}{workspace.prompt.length > 120 ? '...' : ''}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">תיאור מפורט לסוכן השיווק</label>
                <textarea rows={4}
                  className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={cfg.businessDescription}
                  onChange={e => setCfg(c => ({ ...c, businessDescription: e.target.value }))}
                  placeholder="תאר את העסק: מה אתם מוכרים? מה הייחוד שלכם? מי הקהל שלכם? מה ערכי המותג?"
                  dir="rtl" />
                <p className="text-[10px] text-slate-400 mt-1">{cfg.businessDescription.length} תווים</p>
              </div>
              {/* Content Pillars */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">עמודי תוכן (Content Pillars)</label>
                <p className="text-[10px] text-slate-400 mb-2">הסוכן יתמקד בנושאים אלו בעת יצירת תוכן</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {['מוצרים / שירותים', 'טיפים מקצועיים', 'מבצעים', 'תוכן ויראלי', 'סיפורי לקוחות', 'חדשות תעשייה', 'Behind the scenes', 'שאלות ותשובות'].map(p => {
                    const on = cfg.contentPillars.includes(p);
                    return (
                      <button key={p}
                        onClick={() => setCfg(c => ({ ...c, contentPillars: on ? c.contentPillars.filter(x => x !== p) : [...c.contentPillars, p] }))}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all ${
                          on ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400'
                        }`}
                      >{p}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ══ 3. הנחיות אישיות לסוכן ════════════════════════════════════ */}
          <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-violet-50 dark:from-violet-900/20 border-b border-violet-100 dark:border-violet-800">
              <div className="w-7 h-7 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Sparkles size={13} className="text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">הנחיות אישיות לסוכן</h3>
                <p className="text-[10px] text-slate-400">פרומפט ישיר שהסוכן יקרא לפני כל פעולה</p>
              </div>
            </div>
            <div className="p-5 space-y-3">
              {workspace?.aiInstructions && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800">
                  <Info size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-violet-700 dark:text-violet-400">
                    <span className="font-bold">הנחיות מהגדרות המערכת:</span> {workspace.aiInstructions.slice(0, 100)}{workspace.aiInstructions.length > 100 ? '...' : ''}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  פרומפט הנחיות לסוכן השיווק
                  <span className="font-normal text-slate-400 mr-1">— יוסף לכל בקשה של הסוכן</span>
                </label>
                <textarea rows={5}
                  className="w-full text-sm rounded-xl border border-violet-200 dark:border-violet-700 px-3 py-2 bg-violet-50/30 dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                  value={cfg.agentInstructions}
                  onChange={e => setCfg(c => ({ ...c, agentInstructions: e.target.value }))}
                  placeholder={`לדוגמה:\n- תמיד לכתוב בגוף ראשון רבים ("אנחנו")\n- לסיים כל פוסט עם קריאה לפעולה\n- לא להזכיר מחירים או מתחרים\n- להשתמש בטון חם ומזמין\n- לכלול תמיד אימוג'י רלוונטי`}
                  dir="rtl" />
                <div className="flex justify-between mt-1">
                  <p className="text-[10px] text-slate-400">{cfg.agentInstructions.length} תווים</p>
                  {workspace?.aiInstructions && cfg.agentInstructions !== workspace.aiInstructions && (
                    <button onClick={() => setCfg(c => ({ ...c, agentInstructions: workspace.aiInstructions ?? '' }))}
                      className="text-[10px] text-violet-500 hover:underline">
                      ייבא מהגדרות המערכת
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ══ 4. הגדרות תגובות ══════════════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-blue-50 dark:from-blue-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <MessageSquare size={13} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">ניהול תגובות</h3>
                <p className="text-[10px] text-slate-400">איך הסוכן מגיב להערות ברשתות</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Auto reply */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">מענה אוטומטי לתגובות</p>
                  <p className="text-xs text-slate-400">AI יענה ישירות ללא אישורך</p>
                </div>
                <button onClick={() => setCfg(c => ({ ...c, autoReplyComments: !c.autoReplyComments }))}
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${cfg.autoReplyComments ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${cfg.autoReplyComments ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {/* Require approval */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">אישור אנושי לפני פרסום</p>
                  <p className="text-xs text-slate-400">כל תוכן שנוצר ידרוש אישורך לפני שיפורסם</p>
                </div>
                <button onClick={() => setCfg(c => ({ ...c, requireApproval: !c.requireApproval }))}
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${cfg.requireApproval ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${cfg.requireApproval ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {/* Reply tone */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">טון תגובות</label>
                <div className="flex gap-2">
                  {[{ v:'friendly', l:'😊 ידידותי' }, { v:'professional', l:'💼 מקצועי' }, { v:'formal', l:'📋 פורמלי' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, replyTone: v as typeof cfg.replyTone }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.replyTone === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
              {/* Response time */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  זמן תגובה יעד — {cfg.targetResponseTime === 0 ? 'ללא הגבלה' : `${cfg.targetResponseTime} דקות`}
                </label>
                <input type="range" min={0} max={480} step={30}
                  value={cfg.targetResponseTime}
                  onChange={e => setCfg(c => ({ ...c, targetResponseTime: Number(e.target.value) }))}
                  className="w-full accent-indigo-600" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>מיידי</span><span>1 שעה</span><span>4 שעות</span><span>ללא הגבלה</span>
                </div>
              </div>
              {/* Blacklisted words */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מילים אסורות (מופרדות בפסיק)</label>
                <input type="text"
                  className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={cfg.blacklistedWords}
                  onChange={e => setCfg(c => ({ ...c, blacklistedWords: e.target.value }))}
                  placeholder="למשל: חינם, מתחרה, הנחה, גרוע"
                  dir="rtl" />
              </div>
              {/* Sensitive topics */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">נושאים רגישים — הסוכן לא יגע בהם</label>
                <input type="text"
                  className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={cfg.sensitiveTopics}
                  onChange={e => setCfg(c => ({ ...c, sensitiveTopics: e.target.value }))}
                  placeholder="למשל: פוליטיקה, דת, תחרות, מחירים"
                  dir="rtl" />
              </div>
            </div>
          </div>

          {/* ══ 5. אסטרטגיית פרסום ════════════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-amber-50 dark:from-amber-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <TrendingUp size={13} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">אסטרטגיית פרסום</h3>
                <p className="text-[10px] text-slate-400">סגנון, תדירות ושעות פרסום אופטימליות</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Posting frequency */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">תדירות פרסום</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[{ v:'daily', l:'כל יום', emoji:'📅' }, { v:'3x-week', l:'3× שבוע', emoji:'📆' }, { v:'weekly', l:'שבועי', emoji:'🗓' }, { v:'manual', l:'ידני', emoji:'✋' }].map(({ v, l, emoji }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, postFrequency: v as typeof cfg.postFrequency }))}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.postFrequency === v ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>
                      <span>{emoji}</span>{l}
                    </button>
                  ))}
                </div>
              </div>
              {/* Best posting times */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">שעות פרסום מועדפות</label>
                <div className="flex flex-wrap gap-2">
                  {['07:00','09:00','12:00','13:00','17:00','19:00','20:00','21:00'].map(t => {
                    const on = cfg.bestPostingTimes.includes(t);
                    return (
                      <button key={t}
                        onClick={() => setCfg(c => ({ ...c, bestPostingTimes: on ? c.bestPostingTimes.filter(x => x !== t) : [...c.bestPostingTimes, t] }))}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                          on ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-amber-400'
                        }`}>{t}</button>
                    );
                  })}
                </div>
              </div>
              {/* Max daily posts */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  מקסימום פוסטים ביום — <span className="text-indigo-500">{cfg.maxDailyPosts}</span>
                </label>
                <input type="range" min={1} max={10} step={1}
                  value={cfg.maxDailyPosts}
                  onChange={e => setCfg(c => ({ ...c, maxDailyPosts: Number(e.target.value) }))}
                  className="w-full accent-amber-500" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                </div>
              </div>
              {/* Auto schedule */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">תזמון אוטומטי</p>
                  <p className="text-xs text-slate-400">פרסם בשעות המועדפות אוטומטית</p>
                </div>
                <button onClick={() => setCfg(c => ({ ...c, autoSchedule: !c.autoSchedule }))}
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${cfg.autoSchedule ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${cfg.autoSchedule ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* ══ 6. סגנון כתיבה ════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-pink-50 dark:from-pink-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center">
                <Edit3 size={13} className="text-pink-600 dark:text-pink-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">סגנון כתיבה</h3>
                <p className="text-[10px] text-slate-400">אימוג'י, האשטגים וסגנון קריאה לפעולה</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Emoji usage */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">שימוש באימוג'י</label>
                <div className="flex gap-2">
                  {[{ v:'none', l:'🚫 ללא' }, { v:'minimal', l:'😊 מינימלי' }, { v:'frequent', l:'🎉 תכוף' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, emojiUsage: v as typeof cfg.emojiUsage }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.emojiUsage === v ? 'bg-pink-500 text-white border-pink-500' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
              {/* CTA style */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">סגנון קריאה לפעולה (CTA)</label>
                <div className="flex gap-2">
                  {[{ v:'soft', l:'🤝 עדין', sub:'בואו נדבר' }, { v:'direct', l:'🎯 ישיר', sub:'לחצו כאן!' }, { v:'question', l:'❓ שאלה', sub:'רוצים לדעת?' }].map(({ v, l, sub }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, ctaStyle: v as typeof cfg.ctaStyle }))}
                      className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.ctaStyle === v ? 'bg-pink-500 text-white border-pink-500' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>
                      <span>{l}</span>
                      <span className={`text-[9px] font-normal ${cfg.ctaStyle === v ? 'text-pink-100' : 'text-slate-400'}`}>{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Hashtag strategy */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">אסטרטגיית האשטגים</label>
                <div className="flex gap-2 mb-2">
                  {[{ v:'none', l:'🚫 ללא' }, { v:'auto', l:'🤖 אוטומטי' }, { v:'fixed', l:'📌 קבועים' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setCfg(c => ({ ...c, hashtagStrategy: v as typeof cfg.hashtagStrategy }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        cfg.hashtagStrategy === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
                {cfg.hashtagStrategy === 'fixed' && (
                  <input type="text"
                    className="w-full text-sm rounded-xl border border-indigo-200 dark:border-indigo-700 px-3 py-2 bg-indigo-50/50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={cfg.fixedHashtags}
                    onChange={e => setCfg(c => ({ ...c, fixedHashtags: e.target.value }))}
                    placeholder="#ישראל #עסקים #שיווק"
                    dir="ltr" />
                )}
              </div>
              {/* Max post length */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  אורך מקסימלי לפוסט —{' '}
                  <span className="text-indigo-500">{cfg.maxPostLength === 0 ? 'ללא הגבלה' : `${cfg.maxPostLength} תווים`}</span>
                </label>
                <input type="range" min={0} max={2000} step={100}
                  value={cfg.maxPostLength}
                  onChange={e => setCfg(c => ({ ...c, maxPostLength: Number(e.target.value) }))}
                  className="w-full accent-pink-500" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>ללא הגבלה</span><span>500</span><span>1000</span><span>2000</span>
                </div>
              </div>
              {/* Free posting guidelines */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">הנחיות נוספות לסגנון</label>
                <textarea rows={2}
                  className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={cfg.postingGuidelines}
                  onChange={e => setCfg(c => ({ ...c, postingGuidelines: e.target.value }))}
                  placeholder="למשל: להתחיל תמיד עם שאלה, לשמור על משפטים קצרים..."
                  dir="rtl" />
              </div>
            </div>
          </div>

          {/* ══ Save button ════════════════════════════════════════════════ */}
          <button
            onClick={handleSaveCfg}
            disabled={savingCfg}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
          >
            {savingCfg ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            שמור את כל ההגדרות
          </button>

          {/* Connection guide */}
          {!isConnected && (
            <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-5">
              <h3 className="font-bold text-slate-800 dark:text-white mb-3 flex items-center gap-2 text-sm">
                <Globe size={15} className="text-blue-500" />
                חיבור דף פייסבוק נדרש
              </h3>
              <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-400" dir="rtl">
                {['עבור להגדרות → אינטגרציות', 'לחץ "חבר Meta / Facebook"', 'בחר את הדף שלך והתחבר', 'חזור לכאן — הדף יופיע אוטומטית'].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: '#1877f2' }}>{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* ── Campaign Media Creator — for campaigns ───────────────────────────── */}
      <CampaignMediaCreator
        open={showMediaCreator}
        onClose={() => setShowMediaCreator(false)}
        onApproved={media => {
          setCampaignMedia(media);
          setShowMediaCreator(false);
        }}
        campaignGoal={campaignGoalForMedia}
        workspace={workspace}
        workspaceId={wid ?? undefined}
        profile={productProfile}
        onToast={onToast}
        title="יצירת מדיה לקמפיין"
      />

      {/* ── Campaign Media Creator — for posts ───────────────────────────────── */}
      <CampaignMediaCreator
        open={showPostMediaCreator}
        onClose={() => setShowPostMediaCreator(false)}
        onApproved={media => {
          setPostMedia(media);
          setShowPostMediaCreator(false);
          onToast?.('מדיה נוספה לפוסט ✅', 'success');
        }}
        campaignGoal={postTopic || 'פוסט שיווקי'}
        workspace={workspace}
        workspaceId={wid ?? undefined}
        profile={productProfile}
        onToast={onToast}
        title="יצירת מדיה לפוסט"
      />

      {/* ── Studio Gallery Picker Modal ──────────────────────────────────────── */}
      {showGalleryPicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" dir="rtl"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setShowGalleryPicker(null)}>
          <div className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl overflow-hidden flex flex-col"
            style={{ background: isDark ? '#1e1b4b' : '#ffffff', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
              <div>
                <h2 className="font-bold text-base" style={{ color: isDark ? '#f1f5f9' : '#1e1b4b' }}>🗃️ גלריית הסטודיו</h2>
                <p className="text-xs mt-0.5" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>
                  בחר {showGalleryPicker === 'post' ? 'מדיה לפוסט' : 'מדיה לקמפיין'} מהגלריה שלך
                </p>
              </div>
              <button onClick={() => setShowGalleryPicker(null)}
                className="p-2 rounded-xl hover:opacity-75 transition-opacity"
                style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: isDark ? '#94a3b8' : '#64748b' }}>
                <X size={16}/>
              </button>
            </div>
            {/* Grid */}
            <div className="overflow-y-auto p-4 flex-1">
              {mediaGallery.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-4xl mb-3">🖼️</p>
                  <p className="font-semibold text-sm" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>הגלריה ריקה</p>
                  <p className="text-xs mt-1" style={{ color: isDark ? '#64748b' : '#9ca3af' }}>צור תמונות בסטודיו המדיה תחילה</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {mediaGallery.map(item => (
                    <button key={item.id}
                      onClick={() => {
                        const media: GeneratedMedia = {
                          url: item.url,
                          type: item.type === 'video' ? 'video' : 'image',
                          engine: item.engine as GeneratedMedia['engine'],
                          thumbnailUrl: item.thumbnailUrl ?? item.url,
                          prompt: item.prompt,
                          generatedAt: item.createdAt,
                        };
                        if (showGalleryPicker === 'post') {
                          setPostMedia(media);
                          onToast?.('מדיה נוספה לפוסט ✅', 'success');
                        } else {
                          setCampaignMedia(media);
                          onToast?.('מדיה נבחרה לקמפיין ✅', 'success');
                        }
                        setShowGalleryPicker(null);
                      }}
                      className="relative group aspect-square rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02]"
                      style={{ borderColor: 'transparent', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}>
                      {item.type === 'image' ? (
                        <img src={item.url} alt={item.prompt} className="w-full h-full object-cover"/>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2"
                          style={{ background: isDark ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.08)' }}>
                          {item.thumbnailUrl
                            ? <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover absolute inset-0"/>
                            : <span className="text-3xl relative z-10">🎬</span>
                          }
                          <span className="text-[10px] font-bold relative z-10 px-2 py-1 rounded-full"
                            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>וידאו</span>
                        </div>
                      )}
                      {/* Hover overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'rgba(124,58,237,0.75)' }}>
                        <span className="text-white font-bold text-sm">✓ בחר</span>
                      </div>
                      {/* Engine badge */}
                      <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                        {item.engine}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ProductProfileForm — inline product profile editor ─────────────────────── */
interface ProfileFormProps {
  profile:  ProductProfile | null;
  onSave:   (p: ProductProfile) => Promise<void>;
  onClose:  () => void;
}

function ProductProfileForm({ profile, onSave, onClose }: ProfileFormProps) {
  const [name,        setName]        = useState(profile?.productName        ?? '');
  const [desc,        setDesc]        = useState(profile?.productDescription ?? '');
  const [audience,    setAudience]    = useState(profile?.targetAudience     ?? '');
  const [colors,      setColors]      = useState((profile?.brandColors        ?? []).join(', '));
  const [styleKws,    setStyleKws]    = useState((profile?.styleKeywords      ?? []).join(', '));
  const [avoidKws,    setAvoidKws]    = useState((profile?.avoidKeywords      ?? []).join(', '));
  const [saving,      setSaving]      = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      productName:        name.trim(),
      productDescription: desc.trim(),
      targetAudience:     audience.trim(),
      brandColors:        colors.split(',').map(s => s.trim()).filter(Boolean),
      styleKeywords:      styleKws.split(',').map(s => s.trim()).filter(Boolean),
      avoidKeywords:      avoidKws.split(',').map(s => s.trim()).filter(Boolean),
      approvedMedia:      profile?.approvedMedia      ?? [],
      rejectedPrompts:    profile?.rejectedPrompts    ?? [],
      publishedPosts:     profile?.publishedPosts     ?? [],
      lastUpdated:        Date.now(),
    });
    setSaving(false);
  };

  return (
    <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-800 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <X size={15} className="text-slate-400" />
        </button>
        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm">
          <Star size={14} className="text-indigo-500" />
          פרופיל מוצר — הסוכן לומד מכאן
        </h3>
      </div>

      {[
        { label: 'שם המוצר / העסק',        val: name,     set: setName,     placeholder: 'למשל: CoolSocks ישראל' },
        { label: 'תיאור קצר של המוצר',     val: desc,     set: setDesc,     placeholder: 'גרביים ייחודיות לכל אירוע...' },
        { label: 'קהל יעד',               val: audience, set: setAudience, placeholder: 'נשים 25-45, אוהבות אופנה' },
        { label: 'צבעי מותג (מופרדים בפסיק)', val: colors,   set: setColors,   placeholder: 'כחול נייבי, זהב, לבן' },
        { label: 'מילות סגנון (מופרדות בפסיק)', val: styleKws, set: setStyleKws, placeholder: 'minimalist, luxury, playful' },
        { label: 'מה להימנע (מופרד בפסיק)', val: avoidKws, set: setAvoidKws, placeholder: 'כלבים, ילדים, אוכל' },
      ].map(({ label, val, set, placeholder }) => (
        <div key={label}>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{label}</label>
          <input
            type="text"
            value={val}
            onChange={e => set(e.target.value)}
            className="w-full text-sm rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder={placeholder}
            dir="rtl"
          />
        </div>
      ))}

      {profile?.approvedMedia?.length ? (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3">
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
            ✓ {profile.approvedMedia.length} מדיות מאושרות — הסוכן לומד מהן
          </p>
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
            {profile.approvedMedia.slice(-6).map((m, i) => (
              <div key={i} className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-slate-200 dark:bg-slate-700">
                {m.type === 'image'
                  ? <img src={m.url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-lg">🎬</div>
                }
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <button
        onClick={handleSave}
        disabled={saving || !name.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        שמור פרופיל מוצר
      </button>
    </div>
  );
}
