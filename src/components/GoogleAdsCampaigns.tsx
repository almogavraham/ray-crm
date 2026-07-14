/**
 * GoogleAdsCampaigns.tsx
 * Full Google Ads campaign management UI:
 *  - Connect / select Google Ads account
 *  - List campaigns with 30-day stats
 *  - Create new campaign wizard (5 steps)
 *  - Enable / pause campaigns
 */

import { useState, useEffect, useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Plus, RefreshCw, Loader2, TrendingUp, MousePointer,
  Eye, DollarSign, Zap, CheckCircle2, ChevronRight,
  ChevronLeft, Play, Pause, Info, AlertTriangle, X,
  Target, FileText, Megaphone, Settings2,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { WorkspaceProfile } from '../types';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface AdsAccount  { id: string; name: string; currency: string; isTest: boolean; }
interface AdsCampaign {
  id: string; name: string; status: 'ENABLED' | 'PAUSED' | 'REMOVED' | string;
  startDate: string; budgetMicros: number;
  impressions: number; clicks: number; ctr: number;
  avgCpc: number; conversions: number; costMicros: number;
}

interface WizardData {
  campaignName:  string;
  dailyBudget:   string;
  businessName:  string;
  finalUrl:      string;
  keywords:      string;        // newline-separated
  headlines:     string;        // newline-separated, max 30 chars each
  descriptions:  string;        // newline-separated, max 90 chars each
  addLeadForm:   boolean;
}

const INIT_WIZARD: WizardData = {
  campaignName: '',
  dailyBudget:  '50',
  businessName: '',
  finalUrl:     '',
  keywords:     '',
  headlines:    '',
  descriptions: '',
  addLeadForm:  true,
};

const fns = getFunctions(undefined, 'us-central1');

/* ── Helpers ────────────────────────────────────────────────────────────── */
const micros  = (m: number) => (m / 1_000_000).toFixed(2);
const pct     = (n: number) => (n * 100).toFixed(2) + '%';
const statusHe = (s: string) => s === 'ENABLED' ? 'פעיל' : s === 'PAUSED' ? 'מושהה' : s;

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  const { c } = useTheme();
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
      style={{
        background: done ? '#10b981' : active ? '#4285f4' : c.subtleBg,
        border: `2px solid ${done ? '#10b981' : active ? '#4285f4' : 'rgba(255,255,255,0.1)'}`,
        color: done || active ? 'white' : c.textMuted,
      }}>
      {done ? <CheckCircle2 size={13}/> : n}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
export default function GoogleAdsCampaigns({
  workspace, webhookUrl, onToast,
}: {
  workspace:  WorkspaceProfile;
  webhookUrl: string;
  onToast:    (msg: string, type?: 'success'|'error'|'info') => void;
}) {
  const { c } = useTheme();

  /* ── State ────────────────────────────────────────────────────────────── */
  const [accounts,    setAccounts]    = useState<AdsAccount[]>([]);
  const [selectedAcc, setSelectedAcc] = useState<string>('');
  const [campaigns,   setCampaigns]   = useState<AdsCampaign[]>([]);
  const [loadingAcc,  setLoadingAcc]  = useState(false);
  const [loadingCamp, setLoadingCamp] = useState(false);
  const [toggling,    setToggling]    = useState<string | null>(null);
  const [showWizard,  setShowWizard]  = useState(false);
  const [step,        setStep]        = useState(1);
  const [wizard,      setWizard]      = useState<WizardData>(INIT_WIZARD);
  const [creating,    setCreating]    = useState(false);
  const [created,     setCreated]     = useState<string | null>(null);
  const [error,       setError]       = useState('');

  const wid = workspace.id;

  /* ── Load accounts ────────────────────────────────────────────────────── */
  const loadAccounts = useCallback(async () => {
    setLoadingAcc(true); setError('');
    try {
      const fn  = httpsCallable<{workspaceId:string},{accounts:AdsAccount[]}>(fns, 'googleAdsListAccounts');
      const res = await fn({ workspaceId: wid });
      setAccounts(res.data.accounts);
      if (res.data.accounts.length === 1) setSelectedAcc(res.data.accounts[0].id);
    } catch (e: any) {
      const msg = (e.message ?? '') as string;
      if (msg.includes('developer token') || msg.includes('DEVELOPER_TOKEN') || msg.includes('not approved') || msg.includes('permission')) {
        setError('Developer Token עדיין ב-Test Access — הבקשה ל-Basic Access הוגשה ומחכה לאישור Google (1-3 ימי עסקים). נסה שוב לאחר קבלת האישור.');
      } else if (msg.includes('not connected') || msg.includes('access token')) {
        setError('חשבון Google לא מחובר — חבר חשבון Google בסקשן למעלה ואז נסה שוב.');
      } else {
        setError(msg || 'שגיאה בטעינת חשבונות');
      }
    }
    finally { setLoadingAcc(false); }
  }, [wid]);

  /* ── Load campaigns ───────────────────────────────────────────────────── */
  const loadCampaigns = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoadingCamp(true);
    try {
      const fn  = httpsCallable<{workspaceId:string;customerId:string},{campaigns:AdsCampaign[]}>(fns, 'googleAdsListCampaigns');
      const res = await fn({ workspaceId: wid, customerId: cid });
      setCampaigns(res.data.campaigns);
    } catch (e: any) { onToast(e.message ?? 'שגיאה בטעינת קמפיינים', 'error'); }
    finally { setLoadingCamp(false); }
  }, [wid, onToast]);

  useEffect(() => { if (selectedAcc) loadCampaigns(selectedAcc); }, [selectedAcc, loadCampaigns]);

  /* ── Toggle campaign ──────────────────────────────────────────────────── */
  const handleToggle = async (camp: AdsCampaign) => {
    const newStatus = camp.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    setToggling(camp.id);
    try {
      const fn = httpsCallable(fns, 'googleAdsToggleCampaign');
      await fn({ workspaceId: wid, customerId: selectedAcc, campaignId: camp.id, status: newStatus });
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status: newStatus } : c));
      onToast(`הקמפיין ${newStatus === 'ENABLED' ? 'הופעל' : 'הושהה'} ✓`, 'success');
    } catch (e: any) { onToast(e.message ?? 'שגיאה', 'error'); }
    finally { setToggling(null); }
  };

  /* ── Create campaign ──────────────────────────────────────────────────── */
  const handleCreate = async () => {
    setCreating(true); setError('');
    try {
      const kw = wizard.keywords.split('\n').filter(Boolean).map(k => ({
        text: k.trim().replace(/^\[|\]$/g,'').replace(/^"|"$/g,''),
        matchType: k.trim().startsWith('[') ? 'EXACT' : k.trim().startsWith('"') ? 'PHRASE' : 'BROAD',
      }));
      const heads = wizard.headlines.split('\n').filter(Boolean).map(h => h.slice(0, 30));
      const descs = wizard.descriptions.split('\n').filter(Boolean).map(d => d.slice(0, 90));

      const fn  = httpsCallable<any,{success:boolean;campaignId:string;campaignName:string;message:string}>(fns, 'googleAdsCreateCampaign');
      const res = await fn({
        workspaceId:  wid,
        customerId:   selectedAcc,
        campaignName: wizard.campaignName,
        dailyBudget:  Number(wizard.dailyBudget) || 50,
        businessName: wizard.businessName || wizard.campaignName,
        finalUrl:     wizard.finalUrl || 'https://admin.ray-crm.com',
        keywords:     kw,
        headlines:    heads,
        descriptions: descs,
        webhookUrl:   wizard.addLeadForm ? webhookUrl : '',
      });
      setCreated(res.data.campaignName);
      await loadCampaigns(selectedAcc);
    } catch (e: any) { setError(e.message ?? 'שגיאה ביצירת הקמפיין'); }
    finally { setCreating(false); }
  };

  const resetWizard = () => { setShowWizard(false); setStep(1); setWizard(INIT_WIZARD); setCreated(null); setError(''); };

  const wiz = (field: keyof WizardData, val: string | boolean) =>
    setWizard(w => ({ ...w, [field]: val }));

  const STEPS = ['חשבון', 'קמפיין', 'מילות מפתח', 'מודעה', 'סיכום'];

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>📊 קמפיינים ב-Google Ads</p>
          <p className="text-[11px]" style={{ color: c.textMuted }}>צור וניהל קמפיינים — לידים מגיעים אוטומטית למערכת</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && selectedAcc && (
            <button onClick={() => { setShowWizard(true); setStep(1); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold transition-all"
              style={{ background:'rgba(66,133,244,0.15)', border:'1px solid rgba(66,133,244,0.35)', color:'#60a5fa' }}>
              <Plus size={13}/> קמפיין חדש
            </button>
          )}
          <button onClick={loadAccounts} disabled={loadingAcc}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all"
            style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}`, color: c.textMuted }}>
            {loadingAcc ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>}
            {accounts.length === 0 ? 'טען חשבונות' : 'רענן'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-[12px]"
          style={{ background: error.includes('Test Access') || error.includes('1-3') ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                   border: `1px solid ${error.includes('Test Access') || error.includes('1-3') ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.2)'}`,
                   color: error.includes('Test Access') || error.includes('1-3') ? '#fbbf24' : '#f87171' }}>
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
          <div>
            {error}
            {(error.includes('Test Access') || error.includes('1-3')) && (
              <p className="mt-1.5 text-[11px] opacity-75">
                ⏳ בינתיים תוכל ליצור קמפיינים ידנית ב-Google Ads ולקבל לידים דרך ה-Webhook.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── No accounts yet ── */}
      {accounts.length === 0 && !loadingAcc && (
        <div className="rounded-xl p-5 text-center" style={{ background: c.subtleBg, border:`1px dashed ${c.cardBorder}` }}>
          <p className="text-[13px] font-semibold mb-1" style={{ color: c.textSecondary }}>לא נטענו חשבונות Google Ads</p>
          <p className="text-[11px] mb-3" style={{ color: c.textMuted }}>ודא שחשבון Google מחובר בסקשן למעלה, ואז לחץ "טען חשבונות"</p>
          <button onClick={loadAccounts}
            className="px-4 py-2 rounded-xl text-[12px] font-bold"
            style={{ background:'rgba(66,133,244,0.15)', border:'1px solid rgba(66,133,244,0.3)', color:'#60a5fa' }}>
            טען חשבונות
          </button>
        </div>
      )}

      {/* ── Account selector ── */}
      {accounts.length > 1 && (
        <div>
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: c.textMuted }}>בחר חשבון פרסום:</p>
          <div className="flex flex-wrap gap-2">
            {accounts.map(acc => (
              <button key={acc.id} onClick={() => setSelectedAcc(acc.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold transition-all"
                style={selectedAcc === acc.id
                  ? { background:'rgba(66,133,244,0.15)', border:'1px solid rgba(66,133,244,0.4)', color:'#60a5fa' }
                  : { background: c.subtleBg, border:`1px solid ${c.cardBorder}`, color: c.textSecondary }}>
                {acc.isTest && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">בדיקה</span>}
                {acc.name}
                <span className="text-[10px]" style={{ color: c.textMuted }}>({acc.id})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Campaigns list ── */}
      {selectedAcc && (
        <div>
          {loadingCamp ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin" style={{ color:'#4285f4' }}/>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-xl p-5 text-center" style={{ background: c.subtleBg, border:`1px dashed ${c.cardBorder}` }}>
              <p className="text-[13px]" style={{ color: c.textMuted }}>אין קמפיינים עדיין — לחץ "קמפיין חדש"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map(camp => (
                <div key={camp.id} className="rounded-xl p-4"
                  style={{ background: camp.status==='ENABLED' ? 'rgba(16,185,129,0.04)' : c.subtleBg,
                    border:`1px solid ${camp.status==='ENABLED' ? 'rgba(16,185,129,0.2)' : c.cardBorder}` }}>

                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-bold truncate" style={{ color: c.textPrimary }}>{camp.name}</p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={camp.status==='ENABLED'
                            ? { background:'rgba(16,185,129,0.12)', color:'#10b981', border:'1px solid rgba(16,185,129,0.25)' }
                            : { background:'rgba(100,116,139,0.12)', color:'#94a3b8', border:'1px solid rgba(100,116,139,0.2)' }}>
                          {statusHe(camp.status)}
                        </span>
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>
                        תקציב יומי: ₪{micros(camp.budgetMicros)}
                        {camp.startDate && ` · התחלה: ${camp.startDate}`}
                      </p>
                    </div>
                    <button onClick={() => handleToggle(camp)} disabled={!!toggling}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0 transition-all"
                      style={camp.status==='ENABLED'
                        ? { background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }
                        : { background:'rgba(16,185,129,0.1)', border:'1px solid rgba(16,185,129,0.25)', color:'#10b981' }}>
                      {toggling===camp.id ? <Loader2 size={11} className="animate-spin"/>
                        : camp.status==='ENABLED' ? <Pause size={11}/> : <Play size={11}/>}
                      {camp.status==='ENABLED' ? 'השהה' : 'הפעל'}
                    </button>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {[
                      { icon: Eye,           label:'חשיפות',    val: camp.impressions.toLocaleString('he-IL'), color:'#818cf8' },
                      { icon: MousePointer,  label:'קליקים',    val: camp.clicks.toLocaleString('he-IL'),      color:'#60a5fa' },
                      { icon: TrendingUp,    label:'CTR',       val: pct(camp.ctr),                            color:'#34d399' },
                      { icon: DollarSign,    label:'עלות ממוצ', val:`₪${micros(camp.avgCpc)}`,                 color:'#f59e0b' },
                      { icon: Zap,           label:'המרות',     val: camp.conversions.toFixed(1),              color:'#a78bfa' },
                      { icon: DollarSign,    label:'הוצאה',     val:`₪${micros(camp.costMicros)}`,             color:'#fb923c' },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-2 text-center"
                        style={{ background:'rgba(0,0,0,0.2)', border:`1px solid rgba(255,255,255,0.05)` }}>
                        <s.icon size={11} className="mx-auto mb-1" style={{ color: s.color }}/>
                        <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{s.val}</p>
                        <p className="text-[9px]" style={{ color: c.textMuted }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
           WIZARD MODAL
         ════════════════════════════════════════════════════════════════════ */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)' }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
            style={{ background: c.cardBg, border:`1px solid ${c.cardBorder}`, maxHeight:'90vh' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom:`1px solid ${c.cardBorder}` }}>
              <div>
                <p className="font-bold text-[14px]" style={{ color: c.textPrimary }}>🎯 יצירת קמפיין Google Ads</p>
                <p className="text-[11px]" style={{ color: c.textMuted }}>שלב {step} מתוך {STEPS.length}</p>
              </div>
              <button onClick={resetWizard} style={{ color: c.textMuted }}><X size={18}/></button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 px-5 py-3 overflow-x-auto flex-shrink-0"
              style={{ borderBottom:`1px solid ${c.cardBorder}` }}>
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-1.5 flex-shrink-0">
                  <StepDot n={i+1} active={step===i+1} done={step>i+1}/>
                  <span className="text-[11px] font-semibold hidden sm:block"
                    style={{ color: step===i+1 ? '#4285f4' : step>i+1 ? '#10b981' : c.textMuted }}>{s}</span>
                  {i < STEPS.length-1 && <ChevronLeft size={12} style={{ color: c.textMuted }}/>}
                </div>
              ))}
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* ── SUCCESS ── */}
              {created && (
                <div className="text-center py-6">
                  <CheckCircle2 size={48} className="mx-auto mb-3 text-emerald-400"/>
                  <p className="text-[15px] font-bold mb-2" style={{ color: c.textPrimary }}>הקמפיין נוצר! 🎉</p>
                  <p className="text-[12px] mb-4" style={{ color: c.textSecondary }}>
                    "{created}" נוצר בהצלחה במצב מושהה.<br/>
                    כנס ל-Google Ads כדי לבדוק ולהפעיל אותו.
                  </p>
                  {webhookUrl && (
                    <div className="rounded-xl p-3 text-right"
                      style={{ background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)' }}>
                      <p className="text-[11px] font-semibold" style={{ color:'#34d399' }}>
                        ✅ טופס ליד מחובר — לידים יגיעו אוטומטית למערכת
                      </p>
                    </div>
                  )}
                  <button onClick={resetWizard}
                    className="mt-4 px-5 py-2 rounded-xl text-[13px] font-bold"
                    style={{ background:'rgba(66,133,244,0.15)', border:'1px solid rgba(66,133,244,0.3)', color:'#60a5fa' }}>
                    סגור
                  </button>
                </div>
              )}

              {/* ── STEP 1: Account ── */}
              {!created && step === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings2 size={16} style={{ color:'#4285f4' }}/>
                    <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>בחר חשבון Google Ads</p>
                  </div>
                  {accounts.map(acc => (
                    <button key={acc.id} onClick={() => setSelectedAcc(acc.id)}
                      className="w-full flex items-center justify-between p-3 rounded-xl transition-all"
                      style={selectedAcc===acc.id
                        ? { background:'rgba(66,133,244,0.12)', border:'1px solid rgba(66,133,244,0.4)' }
                        : { background: c.subtleBg, border:`1px solid ${c.cardBorder}` }}>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold" style={{ color: c.textPrimary }}>{acc.name}</p>
                        <p className="text-[10px]" style={{ color: c.textMuted }}>ID: {acc.id} · {acc.currency}</p>
                      </div>
                      {acc.isTest && (
                        <span className="text-[10px] px-2 py-1 rounded-full"
                          style={{ background:'rgba(245,158,11,0.1)', color:'#fbbf24', border:'1px solid rgba(245,158,11,0.2)' }}>
                          חשבון בדיקה
                        </span>
                      )}
                    </button>
                  ))}
                  {!webhookUrl && (
                    <div className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                      style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', color:'#fbbf24' }}>
                      <Info size={12} className="flex-shrink-0 mt-0.5"/>
                      אין Webhook URL — צור אחד בסקשן הראשון כדי שלידים יגיעו אוטומטית.
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 2: Campaign basics ── */}
              {!created && step === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={16} style={{ color:'#4285f4' }}/>
                    <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>פרטי הקמפיין</p>
                  </div>
                  {[
                    { label:'שם הקמפיין *', field:'campaignName' as const, placeholder:'למשל: שיפוץ בתים — חיפוש', required:true },
                    { label:'שם העסק *', field:'businessName' as const, placeholder:'למשל: אדם שיפוצים בע"מ', required:true },
                    { label:'כתובת דף הנחיתה *', field:'finalUrl' as const, placeholder:'https://yoursite.co.il/landing', required:true },
                  ].map(f => (
                    <div key={f.field}>
                      <label className="block text-[11px] font-semibold mb-1.5" style={{ color: c.textMuted }}>{f.label}</label>
                      <input value={wizard[f.field] as string} onChange={e => wiz(f.field, e.target.value)}
                        placeholder={f.placeholder} dir="auto"
                        className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none"
                        style={{ background:'rgba(0,0,0,0.2)', border:`1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                    </div>
                  ))}
                  <div>
                    <label className="block text-[11px] font-semibold mb-1.5" style={{ color: c.textMuted }}>
                      תקציב יומי (₪) *
                    </label>
                    <div className="flex gap-2">
                      {['30','50','100','200','500'].map(b => (
                        <button key={b} onClick={() => wiz('dailyBudget', b)}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all"
                          style={wizard.dailyBudget===b
                            ? { background:'rgba(66,133,244,0.2)', border:'1px solid rgba(66,133,244,0.4)', color:'#60a5fa' }
                            : { background: c.subtleBg, border:`1px solid ${c.cardBorder}`, color: c.textSecondary }}>
                          ₪{b}
                        </button>
                      ))}
                    </div>
                    <input value={wizard.dailyBudget} onChange={e => wiz('dailyBudget', e.target.value)}
                      type="number" min="10" dir="ltr"
                      className="w-full mt-2 rounded-xl px-3 py-2 text-[13px] focus:outline-none"
                      style={{ background:'rgba(0,0,0,0.2)', border:`1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                  </div>
                </div>
              )}

              {/* ── STEP 3: Keywords ── */}
              {!created && step === 3 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText size={16} style={{ color:'#4285f4' }}/>
                    <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>מילות מפתח</p>
                  </div>
                  <div className="p-3 rounded-xl text-[11px] space-y-1"
                    style={{ background:'rgba(66,133,244,0.06)', border:'1px solid rgba(66,133,244,0.15)', color: c.textSecondary }}>
                    <p className="font-semibold" style={{ color: c.textPrimary }}>פורמט:</p>
                    <p>• מילה רגילה = התאמה רחבה (Broad)</p>
                    <p>• "מילה במרכאות" = התאמת ביטוי (Phrase)</p>
                    <p>• [מילה בסוגריים] = התאמה מדויקת (Exact)</p>
                  </div>
                  <textarea value={wizard.keywords} onChange={e => wiz('keywords', e.target.value)}
                    rows={8} dir="auto"
                    placeholder={'שיפוץ דירה\n"שיפוץ מטבח"\n[שיפוץ בית תל אביב]\nקבלן שיפוצים'}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none resize-none font-mono"
                    style={{ background:'rgba(0,0,0,0.2)', border:`1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                  <p className="text-[10px]" style={{ color: c.textMuted }}>מילה בכל שורה · מקסימום 20 מילות מפתח</p>
                </div>
              )}

              {/* ── STEP 4: Ad creative ── */}
              {!created && step === 4 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Megaphone size={16} style={{ color:'#4285f4' }}/>
                    <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>טקסט המודעה</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1" style={{ color: c.textMuted }}>
                      כותרות (3–15) — מקסימום 30 תווים כל אחת *
                    </label>
                    <textarea value={wizard.headlines} onChange={e => wiz('headlines', e.target.value)}
                      rows={6} dir="auto"
                      placeholder={'שיפוץ מקצועי ואמין\nצור קשר עכשיו\nמחירים תחרותיים\nניסיון של 15 שנה\nשירות מהיר ואיכותי'}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none resize-none"
                      style={{ background:'rgba(0,0,0,0.2)', border:`1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                    <p className="text-[10px] mt-1" style={{ color: c.textMuted }}>כותרת בכל שורה · Google יבחר את הכי טובות</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1" style={{ color: c.textMuted }}>
                      תיאורים (2–4) — מקסימום 90 תווים כל אחד *
                    </label>
                    <textarea value={wizard.descriptions} onChange={e => wiz('descriptions', e.target.value)}
                      rows={4} dir="auto"
                      placeholder={'אנחנו מספקים שירות שיפוצים מקצועי לבתים ומשרדים. פנה עכשיו לקבלת הצעת מחיר.\nיותר מ-500 פרויקטים הושלמו בהצלחה. ליווי מלא מהתכנון ועד הביצוע.'}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none resize-none"
                      style={{ background:'rgba(0,0,0,0.2)', border:`1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl"
                    style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)' }}>
                    <div>
                      <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>הוסף טופס ליד (Lead Form)</p>
                      <p className="text-[10px]" style={{ color: c.textMuted }}>לידים יגיעו ישירות למערכת דרך Webhook</p>
                    </div>
                    <button onClick={() => wiz('addLeadForm', !wizard.addLeadForm)}
                      className="w-10 h-5 rounded-full transition-all"
                      style={{ background: wizard.addLeadForm ? '#10b981' : 'rgba(255,255,255,0.1)' }}>
                      <div className="w-4 h-4 rounded-full bg-white transition-all"
                        style={{ transform: wizard.addLeadForm ? 'translateX(1.25rem)' : 'translateX(0.125rem)' }}/>
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 5: Review ── */}
              {!created && step === 5 && (
                <div className="space-y-3">
                  <p className="text-[13px] font-bold mb-3" style={{ color: c.textPrimary }}>✅ סיכום הקמפיין</p>
                  {[
                    { label:'חשבון', val: accounts.find(a=>a.id===selectedAcc)?.name ?? selectedAcc },
                    { label:'שם קמפיין', val: wizard.campaignName },
                    { label:'שם עסק', val: wizard.businessName },
                    { label:'תקציב יומי', val: `₪${wizard.dailyBudget}` },
                    { label:'דף נחיתה', val: wizard.finalUrl },
                    { label:'מילות מפתח', val: `${wizard.keywords.split('\n').filter(Boolean).length} מילות מפתח` },
                    { label:'כותרות', val: `${wizard.headlines.split('\n').filter(Boolean).length} כותרות` },
                    { label:'תיאורים', val: `${wizard.descriptions.split('\n').filter(Boolean).length} תיאורים` },
                    { label:'טופס ליד', val: wizard.addLeadForm ? (webhookUrl ? '✅ מחובר לWehbook' : '⚠️ אין Webhook URL') : 'לא' },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center justify-between py-2"
                      style={{ borderBottom:`1px solid ${c.cardBorder}` }}>
                      <span className="text-[12px]" style={{ color: c.textMuted }}>{label}</span>
                      <span className="text-[12px] font-semibold text-right max-w-[60%] truncate" style={{ color: c.textPrimary }}>{val}</span>
                    </div>
                  ))}

                  {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                      style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }}>
                      <AlertTriangle size={12} className="flex-shrink-0 mt-0.5"/> {error}
                    </div>
                  )}

                  <div className="p-3 rounded-xl text-[11px]"
                    style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.15)', color:'#fbbf24' }}>
                    ⚠️ הקמפיין ייווצר במצב <strong>מושהה</strong> — הפעל אותו ב-Google Ads לאחר בדיקה.
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            {!created && (
              <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                style={{ borderTop:`1px solid ${c.cardBorder}` }}>
                <button onClick={() => step > 1 ? setStep(s => s-1) : resetWizard()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all"
                  style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}`, color: c.textMuted }}>
                  <ChevronRight size={13}/>
                  {step === 1 ? 'ביטול' : 'חזרה'}
                </button>

                {step < STEPS.length ? (
                  <button
                    disabled={
                      (step===1 && !selectedAcc) ||
                      (step===2 && (!wizard.campaignName || !wizard.finalUrl || !wizard.businessName)) ||
                      (step===3 && !wizard.keywords.trim()) ||
                      (step===4 && (!wizard.headlines.trim() || !wizard.descriptions.trim()))
                    }
                    onClick={() => setStep(s => s+1)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40"
                    style={{ background:'rgba(66,133,244,0.15)', border:'1px solid rgba(66,133,244,0.35)', color:'#60a5fa' }}>
                    המשך <ChevronLeft size={13}/>
                  </button>
                ) : (
                  <button onClick={handleCreate} disabled={creating}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-bold transition-all disabled:opacity-60"
                    style={{ background:'linear-gradient(135deg,#4285f4,#34a853)', color:'white', boxShadow:'0 4px 16px rgba(66,133,244,0.35)' }}>
                    {creating ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14}/>}
                    {creating ? 'יוצר קמפיין...' : 'צור קמפיין!'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
