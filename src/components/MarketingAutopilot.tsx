/**
 * MarketingAutopilot.tsx
 *
 * The autonomous Marketing Agent UI — the "אוטופיילוט" tab.
 *
 * Flow: guided business-info setup → controls → "generate plan now" runs the
 * client pipeline (strategy + posts + media) → Approval Center → approve &
 * schedule (queued for the scheduled Cloud Function to publish).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Rocket, Sparkles, Loader2, Calendar, Users, Hash, Clock, Check, X,
  RefreshCw, Image as ImageIcon, Send, Wand2, Settings2,
  CheckCircle2, AlertTriangle, Trash2, PlayCircle, Info,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { WorkspaceProfile } from '../types';
import type { MarketingAgentConfig } from '../lib/facebookMarketing';
import { loadMarketingConfig, saveMarketingConfig } from '../lib/facebookMarketing';
import { loadProductProfile, saveProductProfile } from '../lib/mediaGeneration';
import type { ProductProfile } from '../lib/mediaGeneration';
import {
  contextCompleteness,
  generateAutopilotPlan, generatePlanMedia, regeneratePostMedia,
  saveAutopilotPlan, loadAutopilotPlans, updateAutopilotPlan, deleteAutopilotPlan,
  approveAndSchedule, notifyOwnerForApproval, setWorkspaceAutopilotFlag,
} from '../lib/marketingAutopilot';
import type { AutopilotPlan, AutopilotPost, AutopilotCadence } from '../lib/marketingAutopilot';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface Props {
  wid?: string;
  workspace?: WorkspaceProfile;
  onToast?: ToastFn;
}

const PLATFORM_META: Record<string, { label: string; emoji: string; color: string }> = {
  facebook:  { label: 'פייסבוק',  emoji: '📘', color: '#1877f2' },
  instagram: { label: 'אינסטגרם', emoji: '📸', color: '#e1306c' },
};

const DEFAULT_CFG: Partial<MarketingAgentConfig> = {
  bestPostingTimes: ['09:00', '13:00', '19:00'],
  contentPillars: [],
  requireApproval: true,
  autopilotEnabled: false,
  autopilotPlatforms: ['facebook', 'instagram'],
  autopilotPostsPerRun: 8,
  autopilotCadence: 'daily',
  autopilotAutoGenerate: false,
};

export default function MarketingAutopilot({ wid, workspace, onToast }: Props) {
  const { c: tc, isDark } = useTheme();

  const [cfg, setCfg]           = useState<Partial<MarketingAgentConfig>>(DEFAULT_CFG);
  const [profile, setProfile]   = useState<ProductProfile | null>(null);
  const [plans, setPlans]       = useState<AutopilotPlan[]>([]);
  const [loaded, setLoaded]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  // Guided-setup form fields
  const [bName, setBName]     = useState('');
  const [bDesc, setBDesc]     = useState('');
  const [bAud, setBAud]       = useState('');
  const [bStyle, setBStyle]   = useState('');

  /* ── Load ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!wid || loaded) return;
    (async () => {
      const [c, p, pl] = await Promise.all([
        loadMarketingConfig(wid),
        loadProductProfile(wid).catch(() => null),
        loadAutopilotPlans(wid),
      ]);
      const merged = { ...DEFAULT_CFG, ...(c ?? {}) };
      // Backfill autopilot defaults if config existed without them
      merged.autopilotPlatforms   ??= DEFAULT_CFG.autopilotPlatforms;
      merged.autopilotPostsPerRun ??= DEFAULT_CFG.autopilotPostsPerRun;
      merged.autopilotCadence     ??= DEFAULT_CFG.autopilotCadence;
      setCfg(merged);
      setProfile(p);
      setPlans(pl);
      if (p) { setBName(p.productName || ''); setBDesc(p.productDescription || ''); setBAud(p.targetAudience || ''); setBStyle((p.styleKeywords || []).join(', ')); }
      const comp = contextCompleteness(workspace, p);
      setShowSetup(comp.score < 100);
      setLoaded(true);
    })();
  }, [wid, loaded, workspace]);

  const completeness = contextCompleteness(workspace, profile);
  const pendingPlan = plans.find(p => p.status === 'pending_approval') ?? null;

  /* ── Persist config ─────────────────────────────────────────────────────── */
  const persistCfg = useCallback(async (patch: Partial<MarketingAgentConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (!wid) return;
    const existing = (await loadMarketingConfig(wid)) ?? ({} as MarketingAgentConfig);
    await saveMarketingConfig(wid, { ...existing, ...next } as MarketingAgentConfig);
    if (patch.autopilotEnabled !== undefined) await setWorkspaceAutopilotFlag(wid, patch.autopilotEnabled);
  }, [cfg, wid]);

  /* ── Save guided setup ──────────────────────────────────────────────────── */
  const handleSaveSetup = async () => {
    if (!wid) { onToast?.('אין workspace מחובר', 'error'); return; }
    if (!bName.trim()) { onToast?.('הכנס לפחות שם עסק', 'error'); return; }
    setBusy(true);
    try {
      const existing = await loadProductProfile(wid).catch(() => null);
      const next: ProductProfile = {
        productName: bName.trim(),
        productDescription: bDesc.trim(),
        targetAudience: bAud.trim(),
        brandColors: existing?.brandColors ?? [],
        styleKeywords: bStyle.split(',').map(s => s.trim()).filter(Boolean),
        avoidKeywords: existing?.avoidKeywords ?? [],
        approvedMedia: existing?.approvedMedia ?? [],
        rejectedPrompts: existing?.rejectedPrompts ?? [],
        publishedPosts: existing?.publishedPosts ?? [],
        lastUpdated: Date.now(),
      };
      await saveProductProfile(wid, next);
      setProfile(next);
      setShowSetup(false);
      onToast?.('✅ המידע נשמר — הסוכן מכיר עכשיו את העסק', 'success');
    } catch {
      onToast?.('שגיאה בשמירה', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ── Generate a plan ────────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (!wid) { onToast?.('אין workspace מחובר', 'error'); return; }
    if (completeness.score < 100) { onToast?.(`השלם קודם: ${completeness.missing.join(', ')}`, 'error'); setShowSetup(true); return; }
    const platforms = (cfg.autopilotPlatforms?.length ? cfg.autopilotPlatforms : ['facebook', 'instagram']) as Array<'facebook' | 'instagram'>;
    setBusy(true);
    try {
      setProgress('🧠 בונה אסטרטגיה ותוכנית פוסטים...');
      const plan = await generateAutopilotPlan({
        wid, workspace, config: cfg as MarketingAgentConfig,
        postsCount: cfg.autopilotPostsPerRun ?? 8,
        platforms,
        cadence: (cfg.autopilotCadence ?? 'daily') as AutopilotCadence,
      });
      // Persist skeleton first (so nothing is lost if media is slow)
      await saveAutopilotPlan(wid, plan);
      setPlans(prev => [plan, ...prev]);

      setProgress(`🎨 מייצר תמונות לפוסטים (0/${plan.posts.filter(p => p.mediaType !== 'none').length})...`);
      await generatePlanMedia(wid, plan, (d, t) => setProgress(`🎨 מייצר תמונות (${d}/${t})...`));
      await saveAutopilotPlan(wid, plan);
      setPlans(prev => prev.map(p => (p.id === plan.id ? { ...plan } : p)));

      setProgress('📨 שולח התראת אישור...');
      await notifyOwnerForApproval(wid, workspace, plan);

      onToast?.('🚀 התוכנית מוכנה לאישור!', 'success');
    } catch (err) {
      console.error('[autopilot generate]', err);
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  /* ── Post actions ───────────────────────────────────────────────────────── */
  const mutatePlan = async (planId: string, mutate: (p: AutopilotPlan) => void) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan || !wid) return;
    mutate(plan);
    setPlans(prev => prev.map(p => (p.id === planId ? { ...plan } : p)));
    await saveAutopilotPlan(wid, plan);
  };

  const togglePostReject = (planId: string, postId: string) =>
    mutatePlan(planId, plan => {
      const post = plan.posts.find(p => p.id === postId);
      if (post) post.status = post.status === 'rejected' ? 'pending_approval' : 'rejected';
    });

  const regenMedia = async (planId: string, post: AutopilotPost) => {
    if (!wid) return;
    setProgress(`🎨 מחדש תמונה...`);
    await regeneratePostMedia(wid, post);
    await mutatePlan(planId, () => {});
    setProgress('');
    onToast?.(post.mediaStatus === 'ready' ? 'תמונה חודשה ✅' : 'יצירת התמונה נכשלה', post.mediaStatus === 'ready' ? 'success' : 'error');
  };

  const editCaption = (planId: string, postId: string, caption: string) =>
    setPlans(prev => prev.map(p => p.id === planId
      ? { ...p, posts: p.posts.map(x => x.id === postId ? { ...x, caption } : x) } : p));

  const saveCaption = (planId: string) => mutatePlan(planId, () => {});

  /* ── Approve ────────────────────────────────────────────────────────────── */
  const handleApprove = async (plan: AutopilotPlan) => {
    if (!wid) return;
    const active = plan.posts.filter(p => p.status !== 'rejected');
    if (!active.length) { onToast?.('אין פוסטים לאישור (כולם נדחו)', 'error'); return; }
    setBusy(true);
    setProgress('📅 מתזמן את הפוסטים...');
    try {
      const { scheduled } = await approveAndSchedule(wid, workspace, plan);
      setPlans(prev => prev.map(p => (p.id === plan.id ? { ...plan } : p)));
      onToast?.(`✅ ${scheduled} פוסטים אושרו — יפורסמו אוטומטית בזמנים שנקבעו`, 'success');
    } catch (err) {
      onToast?.(`שגיאה באישור: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const handleReject = async (plan: AutopilotPlan) => {
    if (!wid) return;
    await updateAutopilotPlan(wid, plan.id, { status: 'rejected' });
    setPlans(prev => prev.map(p => (p.id === plan.id ? { ...p, status: 'rejected' } : p)));
    onToast?.('התוכנית נדחתה', 'info');
  };

  const handleDelete = async (id: string) => {
    if (!wid) return;
    await deleteAutopilotPlan(wid, id);
    setPlans(prev => prev.filter(p => p.id !== id));
  };

  /* ── Styles ─────────────────────────────────────────────────────────────── */
  const card = { background: isDark ? 'rgba(255,255,255,0.03)' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}` };
  const inputStyle = { background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary };

  const fmtTime = (ms: number) => new Date(ms).toLocaleString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /* ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Rocket size={22} className="text-white" />
            <h2 className="font-black text-xl text-white">סוכן שיווק אוטונומי</h2>
          </div>
          <p className="text-sm text-indigo-100 max-w-xl">
            הזן מידע על העסק פעם אחת — הסוכן יתכנן אסטרטגיה, יכתוב פוסטים, ייצר תמונות, וישלח לך התראה לאישור. ברגע שתאשר, הוא מפרסם לבד בזמנים שנקבעו.
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => persistCfg({ autopilotEnabled: !cfg.autopilotEnabled })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold transition-all"
              style={{ background: cfg.autopilotEnabled ? '#10b981' : 'rgba(255,255,255,0.2)', color: '#fff' }}>
              {cfg.autopilotEnabled ? <><CheckCircle2 size={15} /> אוטופיילוט פעיל</> : <><PlayCircle size={15} /> אוטופיילוט כבוי</>}
            </button>
            <span className="text-xs text-indigo-100">השלמת פרופיל: {completeness.score}%</span>
          </div>
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4" style={card}>
        <div className="flex items-center gap-2 mb-3">
          <Info size={16} className="text-indigo-500" />
          <h3 className="font-black text-sm" style={{ color: tc.textPrimary }}>איך זה עובד</h3>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          {[
            { n: 1, t: 'הזן מידע על העסק', d: 'שם, קהל, סגנון — פעם אחת' },
            { n: 2, t: 'הסוכן מתכנן', d: 'אסטרטגיה, תוכן ותמונות' },
            { n: 3, t: 'אתה מאשר', d: 'התראה + מרכז אישורים' },
            { n: 4, t: 'פרסום אוטומטי', d: 'בזמנים שנקבעו, גם סגור' },
          ].map(s => (
            <div key={s.n} className="flex gap-2.5 items-start">
              <div className="w-7 h-7 rounded-lg flex-none flex items-center justify-center font-black text-xs text-white" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>{s.n}</div>
              <div>
                <p className="text-xs font-bold" style={{ color: tc.textPrimary }}>{s.t}</p>
                <p className="text-[11px]" style={{ color: tc.textMuted }}>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Guided setup ──────────────────────────────────────────────────── */}
      {(showSetup || completeness.score < 100) && (
        <div className="rounded-2xl p-4 sm:p-5 space-y-3" style={{ ...card, borderColor: '#818cf8' }}>
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-indigo-500" />
            <h3 className="font-black text-sm" style={{ color: tc.textPrimary }}>הגדרת הסוכן — מידע על העסק</h3>
          </div>
          {completeness.missing.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
              <AlertTriangle size={13} /> חסר: {completeness.missing.join(', ')}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>שם העסק / המוצר *</label>
              <input value={bName} onChange={e => setBName(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>קהל יעד</label>
              <input value={bAud} onChange={e => setBAud(e.target.value)} placeholder="בעלי עסקים 25-45..." className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>תיאור העסק — מה אתם מוכרים ולמי</label>
            <textarea value={bDesc} onChange={e => setBDesc(e.target.value)} rows={3} className="w-full rounded-xl px-3 py-2 text-sm resize-none outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>סגנון ויזואלי (מילות מפתח, מופרד בפסיקים)</label>
            <input value={bStyle} onChange={e => setBStyle(e.target.value)} placeholder="מודרני, נקי, יוקרתי" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
          </div>
          <button onClick={handleSaveSetup} disabled={busy} className="px-4 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            שמור מידע
          </button>
        </div>
      )}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={card}>
        <h3 className="font-black text-sm" style={{ color: tc.textPrimary }}>הגדרות אוטופיילוט</h3>

        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: tc.textMuted }}>פלטפורמות</label>
          <div className="flex gap-2">
            {(['facebook', 'instagram'] as const).map(p => {
              const active = cfg.autopilotPlatforms?.includes(p);
              return (
                <button key={p} onClick={() => persistCfg({ autopilotPlatforms: active ? cfg.autopilotPlatforms!.filter(x => x !== p) : [...(cfg.autopilotPlatforms ?? []), p] })}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all"
                  style={active ? { background: `${PLATFORM_META[p].color}1f`, color: PLATFORM_META[p].color, borderColor: PLATFORM_META[p].color } : { background: 'transparent', color: tc.textMuted, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  {active && <Check size={12} />} {PLATFORM_META[p].emoji} {PLATFORM_META[p].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>פוסטים בתוכנית</label>
            <input type="number" min={1} max={16} value={cfg.autopilotPostsPerRun ?? 8}
              onChange={e => persistCfg({ autopilotPostsPerRun: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: tc.textMuted }}>קצב פרסום</label>
            <select value={cfg.autopilotCadence ?? 'daily'} onChange={e => persistCfg({ autopilotCadence: e.target.value as AutopilotCadence })}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle}>
              <option value="daily">יומי</option>
              <option value="3x-week">3 בשבוע</option>
              <option value="weekly">שבועי</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: tc.textMuted }}>שעות פרסום מועדפות</label>
          <div className="flex gap-2 flex-wrap">
            {['08:00', '09:00', '12:00', '13:00', '17:00', '19:00', '21:00'].map(t => {
              const active = cfg.bestPostingTimes?.includes(t);
              return (
                <button key={t} onClick={() => persistCfg({ bestPostingTimes: active ? cfg.bestPostingTimes!.filter(x => x !== t) : [...(cfg.bestPostingTimes ?? []), t].sort() })}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all"
                  style={active ? { background: 'rgba(99,102,241,0.15)', color: '#6366f1', borderColor: '#6366f1' } : { background: 'transparent', color: tc.textMuted, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={handleGenerate} disabled={busy}
          className="w-full py-3 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)' }}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> {progress || 'עובד...'}</> : <><Wand2 size={16} /> צור תוכנית עכשיו</>}
        </button>
      </div>

      {/* ── Approval Center ───────────────────────────────────────────────── */}
      {pendingPlan && (
        <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ ...card, borderColor: '#f59e0b', borderWidth: 2 }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}>
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-black text-base" style={{ color: tc.textPrimary }}>{pendingPlan.title}</h3>
                <p className="text-[11px]" style={{ color: tc.textMuted }}>ממתין לאישור · {pendingPlan.posts.length} פוסטים</p>
              </div>
            </div>
          </div>

          {/* Strategy */}
          {pendingPlan.strategy.summary && (
            <div className="rounded-xl p-3" style={{ background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)' }}>
              <p className="text-sm" style={{ color: tc.textPrimary }}>{pendingPlan.strategy.summary}</p>
              <div className="flex flex-wrap gap-3 mt-2">
                {pendingPlan.strategy.audiences.length > 0 && (
                  <span className="text-[11px] flex items-center gap-1" style={{ color: tc.textMuted }}><Users size={11} /> {pendingPlan.strategy.audiences.join(' · ')}</span>
                )}
                {pendingPlan.strategy.pillars.length > 0 && (
                  <span className="text-[11px] flex items-center gap-1" style={{ color: tc.textMuted }}><Hash size={11} /> {pendingPlan.strategy.pillars.join(' · ')}</span>
                )}
              </div>
            </div>
          )}

          {/* Posts */}
          <div className="space-y-3">
            {pendingPlan.posts.map(post => (
              <div key={post.id} className="rounded-xl p-3 flex gap-3" style={{ background: isDark ? 'rgba(0,0,0,0.2)' : '#f8fafc', opacity: post.status === 'rejected' ? 0.5 : 1 }}>
                {/* Media */}
                <div className="w-24 h-24 rounded-xl overflow-hidden flex-none flex items-center justify-center relative" style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                  {post.mediaStatus === 'ready' && post.mediaUrl ? (
                    <img src={post.mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : post.mediaStatus === 'failed' ? (
                    <AlertTriangle size={20} className="text-amber-500" />
                  ) : (
                    <ImageIcon size={20} style={{ color: tc.textMuted }} />
                  )}
                  <button onClick={() => regenMedia(pendingPlan.id, post)} title="חדש תמונה"
                    className="absolute bottom-1 left-1 bg-black/60 rounded-lg p-1"><RefreshCw size={11} className="text-white" /></button>
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${PLATFORM_META[post.platform]?.color}1f`, color: PLATFORM_META[post.platform]?.color }}>
                      {PLATFORM_META[post.platform]?.emoji} {PLATFORM_META[post.platform]?.label}
                    </span>
                    <span className="text-[10px] flex items-center gap-0.5" style={{ color: tc.textMuted }}><Clock size={10} /> {fmtTime(post.scheduledTime)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: tc.textMuted }}>{post.format}</span>
                  </div>
                  <textarea value={post.caption} onChange={e => editCaption(pendingPlan.id, post.id, e.target.value)} onBlur={() => saveCaption(pendingPlan.id)}
                    rows={3} className="w-full rounded-lg px-2 py-1.5 text-xs resize-none outline-none" style={inputStyle} />
                  {post.hashtags.length > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: '#6366f1' }}>{post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <button onClick={() => togglePostReject(pendingPlan.id, post.id)}
                      className="text-[11px] font-semibold flex items-center gap-1" style={{ color: post.status === 'rejected' ? '#10b981' : '#ef4444' }}>
                      {post.status === 'rejected' ? <><RefreshCw size={11} /> החזר</> : <><X size={11} /> דחה פוסט</>}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={() => handleApprove(pendingPlan)} disabled={busy}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} אשר הכל ותזמן לפרסום
            </button>
            <button onClick={() => handleReject(pendingPlan)} disabled={busy}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border" style={{ color: '#ef4444', borderColor: '#ef4444' }}>
              דחה תוכנית
            </button>
          </div>
        </div>
      )}

      {/* ── Plan history ──────────────────────────────────────────────────── */}
      {plans.filter(p => p.status !== 'pending_approval').length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold px-1" style={{ color: tc.textMuted }}>תוכניות קודמות</p>
          {plans.filter(p => p.status !== 'pending_approval').map(p => (
            <div key={p.id} className="rounded-2xl p-3 flex items-center gap-3" style={card}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ background: p.status === 'approved' ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}>
                <Calendar size={16} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color: tc.textPrimary }}>{p.title}</p>
                <p className="text-[11px]" style={{ color: tc.textMuted }}>
                  {p.status === 'approved' ? '✅ אושר ותוזמן' : p.status === 'rejected' ? 'נדחה' : p.status} · {p.posts.length} פוסטים · {new Date(p.createdAt).toLocaleDateString('he-IL')}
                </p>
              </div>
              <button onClick={() => handleDelete(p.id)} className="p-2 rounded-xl hover:bg-red-500/10 text-red-500"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
