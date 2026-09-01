import { useState, useEffect } from 'react';
import { VAT_PERCENT, vatOn, withVat } from '../lib/vat';
import {
  CreditCard, Check, Zap, Building2, Crown, X, Lock,
  RefreshCw, CheckCircle2, Star, AlertCircle, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { WorkspaceProfile, WorkspacePlan } from '../types';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  TOPUP_PACKAGES, formatBalance, balancePercent,
  dollarsToTokens, formatTokenDisplay, formatTokenCount,
} from '../lib/tokenTracker';

interface BillingPageProps {
  workspace: WorkspaceProfile;
  onPlanUpdate?: (plan: WorkspacePlan) => void;
}

// ─── Days remaining helper ────────────────────────────────────────────────────
function daysRemaining(isoDate?: string): number {
  if (!isoDate) return 0;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

// Only used for the on-screen estimate. The amount actually charged is
// computed by Morning when it issues the invoice, so this number cannot
// cause an incorrect charge — the previous code billed with it directly.


const PLANS = [
  {
    key: 'basic' as WorkspacePlan,
    nameKey: 'billing.plan.basic.name',
    price: 89,          // ₪89 + מע"מ
    tokenDollars: 10,   // $10 טוקנים אמיתיים (~3M טוקנים)
    periodKey: 'billing.perMonth',
    descKey: 'billing.plan.basic.desc',
    highlight: false,
    icon: Zap,
    featureKeys: ['billing.feat.allFeatures', 'billing.feat.users5', 'billing.feat.basicSupport', 'billing.feat.storage5'],
    ctaKey: 'billing.plan.basic.cta',
  },
  {
    key: 'pro' as WorkspacePlan,
    nameKey: null,
    name: 'Pro',
    price: 179,         // ₪179 + מע"מ
    tokenDollars: 20,   // $20 טוקנים אמיתיים (~6M טוקנים)
    periodKey: 'billing.perMonth',
    descKey: 'billing.plan.pro.desc',
    highlight: true,
    icon: Star,
    featureKeys: ['billing.feat.allFeatures', 'billing.feat.users10', 'billing.feat.prioritySupport', 'billing.feat.storage10', 'billing.feat.advancedReports', 'billing.feat.apiIntegrations'],
    ctaKey: 'billing.plan.pro.cta',
  },
  {
    key: 'enterprise' as WorkspacePlan,
    nameKey: null,
    name: 'Enterprise',
    price: 329,         // ₪329 + מע"מ
    tokenDollars: 40,   // $40 טוקנים אמיתיים (~12M טוקנים)
    periodKey: 'billing.perMonth',
    descKey: 'billing.plan.enterprise.desc',
    highlight: false,
    icon: Building2,
    featureKeys: ['billing.feat.allFeatures', 'billing.feat.usersUnlimited', 'billing.feat.sla', 'billing.feat.storage100', 'billing.feat.accountManager', 'billing.feat.customization'],
    ctaKey: 'billing.plan.enterprise.cta',
  },
];

export default function BillingPage({ workspace, onPlanUpdate }: BillingPageProps) {
  const { t, dir } = useLang();
  const { c } = useTheme();

  // ── Plan modal ──────────────────────────────────────────────────────────
  const [selectedPlan,    setSelectedPlan]    = useState<'basic' | 'pro' | 'enterprise' | null>(null);
  const [planLoading,     setPlanLoading]     = useState(false);
  const [planError,       setPlanError]       = useState('');

  // ── Token top-up modal ──────────────────────────────────────────────────
  const [topupPkg,        setTopupPkg]        = useState<typeof TOPUP_PACKAGES[number] | null>(null);
  const [topupLoading,    setTopupLoading]    = useState(false);
  const [topupError,      setTopupError]      = useState('');

  // ── Global payment-success banner (return from the payment page) ────────
  const [paymentSuccess,  setPaymentSuccess]  = useState(false);

  // Detect ?payment=success in URL (redirect back from the payment page)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setPaymentSuccess(true);
      // Clean URL without reload
      params.delete('payment');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
    }
  }, []);

  // ── Token balance helpers ───────────────────────────────────────────────
  const tokenBalance    = workspace?.tokenBalance    ?? 0;
  const tokenAllocation = workspace?.tokenPlanAllocation ?? 0;
  const tokenUsed       = workspace?.tokenUsed       ?? 0;
  const tokenPct        = balancePercent(tokenBalance, tokenAllocation);
  const tokenBarColor   = tokenPct > 50 ? 'bg-emerald-500' : tokenPct > 20 ? 'bg-amber-400' : 'bg-red-500';

  const trialDays      = daysRemaining(workspace.trialEndsAt);
  const currentPlanObj = PLANS.find(p => p.key === workspace.plan) ?? PLANS[0];
  const chosenPlanObj  = selectedPlan ? PLANS.find(p => p.key === selectedPlan) : null;

  // ── Build success/cancel URLs ──────────────────────────────────────────
  function buildSuccessUrl() {
    const u = new URL(window.location.href);
    u.searchParams.set('payment', 'success');
    return u.toString();
  }
  function buildCancelUrl() {
    return window.location.href;
  }

  // ── Token top-up ───────────────────────────────────────────────────────
  // Charged in dollars, which Morning supports directly — the AI credit is
  // bought in dollars, so converting it here would only add an exchange rate
  // to drift out of date.
  const handleTopup = async () => {
    if (!topupPkg) return;
    setTopupError('');
    setTopupLoading(true);
    try {
      const fn = httpsCallable<unknown, { url: string }>(functions, 'createMorningPayment');
      const result = await fn({
        type:       'topup',
        workspaceId: workspace.id,
        amount:     topupPkg.dollars,
        currency:   'USD',
        label:      `RAY CRM — ${topupPkg.label} טוקני AI`,
        successUrl: buildSuccessUrl(),
        failureUrl: buildCancelUrl(),
      });
      window.location.href = result.data.url;
    } catch (err: unknown) {
      console.error('[handleTopup]', err);
      // Show what actually went wrong. "Try again" is useless advice when the
      // cause is a payment terminal that is not connected yet.
      setTopupError((err as Error)?.message || 'שגיאה ביצירת דף תשלום. נסה שוב.');
      setTopupLoading(false);
    }
  };

  // ── Plan upgrade ───────────────────────────────────────────────────────
  const handlePlan = async () => {
    if (!chosenPlanObj) return;
    setPlanError('');
    setPlanLoading(true);

    try {
      const fn = httpsCallable<unknown, { url: string }>(functions, 'createMorningPayment');
      const result = await fn({
        type:       'plan',
        workspaceId: workspace.id,
        planKey:    selectedPlan,
        // Sent as the price this page displayed; the server holds the real one
        // and refuses a mismatch rather than charging either number.
        amount:     totalAmount,
        label:      `RAY CRM — ${chosenPlanObj.name ?? selectedPlan}`,
        successUrl: buildSuccessUrl(),
        failureUrl: buildCancelUrl(),
      });
      // The plan is NOT updated here. It used to be set optimistically before
      // the customer had even reached the payment page, so an abandoned
      // checkout still showed them upgraded. The webhook applies it, after
      // Morning confirms the money arrived.
      window.location.href = result.data.url;
    } catch (err: unknown) {
      console.error('[handlePlan]', err);
      setPlanError((err as Error)?.message || 'שגיאה ביצירת דף תשלום. נסה שוב.');
      setPlanLoading(false);
    }
  };

  // ── Close modals ────────────────────────────────────────────────────────
  // The table above is the price. It used to be overridden at runtime by a
  // fetch from Stripe, which is no longer the processor — leaving it would mean
  // the page showing a price from a system that no longer takes the money.
  // Drift is caught instead of hidden: the payment call sends the displayed
  // price, and the server refuses it if it disagrees with its own.
  const closePlanModal  = () => { setSelectedPlan(null); setPlanError(''); setPlanLoading(false); };
  const closeTopupModal = () => { setTopupPkg(null);     setTopupError(''); setTopupLoading(false); };

  // VAT shown for the summary. Morning computes the authoritative split when
  // it issues the invoice, from the business's own tax settings.
  const chosenPrice = chosenPlanObj?.price ?? 0;
  const vatAmount   = vatOn(chosenPrice);
  const totalAmount = withVat(chosenPrice);

  return (
    <div
      dir={dir}
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6"
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
      }}
    >
      <div className="max-w-5xl mx-auto space-y-8">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold mb-1" style={{ color: 'white' }}>{t('billing.title')}</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{t('billing.subtitle')}</p>
        </div>

        {/* ── Payment success banner ────────────────────────────────────── */}
        {paymentSuccess && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-4"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)' }}
          >
            <CheckCircle2 size={22} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="font-bold text-sm" style={{ color: '#34d399' }}>התשלום התקבל בהצלחה!</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(52,211,153,0.7)' }}>
                הטוקנים יתווספו לחשבונך תוך מספר שניות.
              </p>
            </div>
            <button
              onClick={() => setPaymentSuccess(false)}
              className="mr-auto p-1 rounded-lg transition-colors"
              style={{ color: 'rgba(52,211,153,0.5)' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Token Balance Card ───────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', backdropFilter: 'blur(8px)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg select-none" style={{ background: 'rgba(16,185,129,0.15)' }}>💎</div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('tokens.balance')}</p>
                <p className="text-xs" style={{ color: 'rgba(52,211,153,0.8)' }}>{t('tokens.planAllocation')}: {formatTokenDisplay(tokenAllocation)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black" style={{ color: '#34d399', textShadow: '0 0 20px rgba(52,211,153,0.5)' }}>{formatTokenDisplay(tokenBalance)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(52,211,153,0.65)' }}>טוקני AI</p>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(52,211,153,0.65)' }}>
              <span>{t('tokens.used')}: {formatTokenDisplay(tokenUsed)}</span>
              <span>{tokenPct}% {t('tokens.remaining')}</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className={`h-full rounded-full transition-all ${tokenBarColor}`}
                style={{ width: `${tokenPct}%`, boxShadow: tokenPct > 50 ? '0 0 8px rgba(52,211,153,0.5)' : tokenPct > 20 ? '0 0 8px rgba(251,191,36,0.5)' : '0 0 8px rgba(239,68,68,0.5)' }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {t('tokens.used')}: {formatTokenDisplay(tokenUsed)} {t('tokens.of')} {formatTokenDisplay(tokenAllocation)}
            </p>
          </div>

          {tokenBalance <= 0 && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
              <AlertCircle size={15} className="flex-shrink-0" />
              {t('tokens.emptyWarning')}
            </div>
          )}
          {tokenBalance > 0 && tokenPct < 20 && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#fcd34d' }}>
              <AlertTriangle size={15} className="flex-shrink-0" />
              {t('tokens.lowWarning')}
            </div>
          )}
        </div>

        {/* ── Current plan banner ───────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap"
          style={{
            background: workspace.plan === 'trial'
              ? 'rgba(245,158,11,0.08)'
              : workspace.plan === 'basic'
                ? 'rgba(99,102,241,0.08)'
                : workspace.plan === 'pro'
                  ? 'rgba(99,102,241,0.10)'
                  : 'rgba(139,92,246,0.08)',
            border: workspace.plan === 'trial'
              ? '1px solid rgba(245,158,11,0.3)'
              : workspace.plan === 'basic'
                ? '1px solid rgba(99,102,241,0.3)'
                : workspace.plan === 'pro'
                  ? '1px solid rgba(99,102,241,0.4)'
                  : '1px solid rgba(139,92,246,0.3)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: workspace.plan === 'trial' ? 'rgba(245,158,11,0.15)'
                  : workspace.plan === 'basic' ? 'rgba(99,102,241,0.15)'
                  : workspace.plan === 'pro' ? 'rgba(99,102,241,0.15)' : 'rgba(139,92,246,0.15)',
              }}
            >
              {workspace.plan === 'trial'      && <AlertCircle size={20} className="text-amber-400" />}
              {workspace.plan === 'basic'      && <Zap         size={20} className="text-indigo-400" />}
              {workspace.plan === 'pro'        && <Star        size={20} className="text-indigo-400" />}
              {workspace.plan === 'enterprise' && <Crown       size={20} className="text-purple-400" />}
            </div>
            <div>
              <p className="font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
                {currentPlanObj.nameKey ? t(currentPlanObj.nameKey) : currentPlanObj.name}
              </p>
              {workspace.plan === 'trial' ? (
                <p className="text-sm text-amber-400">
                  {trialDays > 0 ? `${trialDays} ${t('billing.trialLeft')}` : t('billing.trialEnded')}
                </p>
              ) : (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('billing.activePlan')}</p>
              )}
            </div>
          </div>
          {(workspace.plan === 'trial') && (
            <div className="text-amber-400 text-sm font-medium">{t('billing.upgradeData')}</div>
          )}
        </div>

        {/* ── Plan cards ───────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('billing.choosePlan')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(plan => {
              const Icon      = plan.icon;
              const isCurrent = workspace.plan === plan.key;
              const planName  = plan.nameKey ? t(plan.nameKey) : plan.name ?? '';
              const cardStyle = plan.key === 'basic'
                ? { background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', backdropFilter: 'blur(8px)' }
                : plan.key === 'pro'
                  ? { background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.4)', backdropFilter: 'blur(8px)', boxShadow: '0 0 32px rgba(139,92,246,0.15)' }
                  : { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', backdropFilter: 'blur(8px)' };

              return (
                <div
                  key={plan.key}
                  className={`relative rounded-2xl p-6 flex flex-col transition-all duration-200 ${isCurrent ? 'opacity-70' : 'cursor-pointer'}`}
                  style={cardStyle}
                  onClick={() => {
                    if (!isCurrent) {
                      setSelectedPlan(plan.key as 'basic' | 'pro' | 'enterprise');
                    }
                  }}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 right-1/2 translate-x-1/2">
                      <span className="text-white text-[11px] font-bold px-3 py-1 rounded-full" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                        {t('billing.mostPopular')}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: plan.key === 'pro' ? 'rgba(139,92,246,0.25)' : plan.key === 'enterprise' ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.15)' }}
                    >
                      <Icon size={16} className={plan.key === 'pro' ? 'text-violet-400' : plan.key === 'enterprise' ? 'text-amber-400' : 'text-indigo-400'} />

                    </div>
                    <span className="font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>{planName}</span>
                    {isCurrent && (
                      <span className="mr-auto text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>
                        {t('billing.current')}
                      </span>
                    )}
                  </div>

                  <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.45)' }}>{t(plan.descKey)}</p>

                  <div className="flex items-baseline gap-1 mb-3">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-black" style={{ color: 'rgba(255,255,255,0.9)' }}>{t('billing.free')}</span>
                    ) : (
                      <>
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>₪</span>
                        <span className="text-3xl font-black" style={{ color: 'rgba(255,255,255,0.9)' }}>{plan.price}</span>
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>/{t(plan.periodKey)}</span>
                      </>
                    )}
                  </div>

                  <div
                    className="flex items-center gap-2 rounded-xl px-3 py-2 mb-4"
                    style={
                      plan.key === 'pro'
                        ? { background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }
                        : { background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }
                    }
                  >
                    <span className="text-base">💎</span>
                    <div>
                      <span className="font-black text-base" style={{ color: plan.key === 'pro' ? '#c4b5fd' : plan.key === 'enterprise' ? '#fbbf24' : '#34d399' }}>
                        {formatTokenDisplay(plan.tokenDollars)}
                      </span>
                      <span className="text-xs mr-1" style={{ color: plan.key === 'pro' ? 'rgba(196,181,253,0.7)' : 'rgba(52,211,153,0.7)' }}>
                        טוקני AI
                      </span>
                      <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>כלולים בתוכנית · מתחדש חודשי</p>
                    </div>
                  </div>

                  <ul className="space-y-2 flex-1 mb-5">
                    {plan.featureKeys.map(fk => (
                      <li key={fk} className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
                        <Check size={13} className={plan.key === 'pro' ? 'text-violet-400' : 'text-emerald-400'} />
                        {t(fk)}
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={isCurrent}
                    onClick={e => {
                      e.stopPropagation();
                      if (!isCurrent) setSelectedPlan(plan.key as 'basic' | 'pro' | 'enterprise');
                    }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={
                      isCurrent
                        ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)', cursor: 'not-allowed' }
                        : { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: 'white', boxShadow: '0 0 16px rgba(99,102,241,0.35)' }
                    }
                  >
                    {isCurrent ? t('billing.currentPlanLabel') : t(plan.ctaKey)}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Token Top-up Section ─────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <span className="text-xl">💎</span>
            {t('tokens.topup')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TOPUP_PACKAGES.map(pkg => (
              <div
                key={pkg.id}
                className="rounded-2xl p-5 flex flex-col items-center text-center gap-3 transition-all"
                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', backdropFilter: 'blur(8px)' }}
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(52,211,153,0.12)' }}>
                  <span className="text-2xl font-black" style={{ color: '#34d399' }}>{pkg.label}</span>
                </div>
                <div>
                  <p className="font-bold text-lg" style={{ color: 'rgba(255,255,255,0.9)' }}>{pkg.label}</p>
                  <p className="text-xs" style={{ color: 'rgba(52,211,153,0.75)' }}>{formatTokenCount(dollarsToTokens(pkg.dollars))} טוקני AI</p>
                </div>
                <button
                  onClick={() => { setTopupPkg(pkg); setTopupError(''); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', boxShadow: '0 0 14px rgba(16,185,129,0.3)' }}
                >
                  <CreditCard size={14} /> רכוש עכשיו
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
            * התשלום מאובטח ומוצפן. הטוקנים יתווספו מיד לאחר אישור התשלום.
          </p>
        </div>

        {/* ── Billing history placeholder ──────────────────────────────────── */}
        <div
          className="rounded-2xl p-6"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)' }}
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <CreditCard size={18} className="text-violet-400" />
            {t('billing.history')}
          </h2>
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <CreditCard size={22} style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{t('billing.noHistory')}</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{t('billing.noHistoryDesc')}</p>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
       * Plan upgrade modal
       * ══════════════════════════════════════════════════════════════════════ */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm" dir={dir}>
          <div
            className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl overflow-hidden"
            style={{ background: '#0d1526', border: '1px solid rgba(99,102,241,0.25)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5" style={{ background: 'rgba(99,102,241,0.1)', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
              <button onClick={closePlanModal} className="p-1 rounded-lg" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-emerald-400" />
                <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{t('billing.payment.title')}</span>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Plan summary */}
              {chosenPlanObj && (
                <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                  <div>
                    <p className="font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
                      {chosenPlanObj.nameKey ? t(chosenPlanObj.nameKey) : chosenPlanObj.name}
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{t(chosenPlanObj.descKey)}</p>
                  </div>
                  <div className="text-left">
                    <span className="text-xl font-black" style={{ color: '#a5b4fc' }}>₪{chosenPrice}</span>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>/{t(chosenPlanObj.periodKey)}</span>
                  </div>
                </div>
              )}

              {/* Price breakdown */}
              {chosenPlanObj && (
                <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex justify-between" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <span>{t('billing.payment.subtotal')}</span>
                    <span>₪{chosenPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <span>{t('billing.payment.vat')} ({VAT_PERCENT}%)</span>
                    <span>₪{vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-2" style={{ color: 'rgba(255,255,255,0.9)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span>{t('billing.payment.total')}</span>
                    <span>₪{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* How payment works — without naming the processor. */}
              <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <Lock size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  התשלום מבוצע בצורה מאובטחת בעמוד תשלום חיצוני. פרטי האשראי אינם נשמרים אצלנו, ותוחזר לכאן לאחר אישור. חשבונית מס תישלח אליך בדוא״ל.
                </p>
              </div>

              {planError && (
                <div className="flex items-center gap-2 text-sm rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  <AlertCircle size={15} /> {planError}
                </div>
              )}

              <button
                onClick={handlePlan}
                disabled={planLoading}
                className="w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 20px rgba(99,102,241,0.3)' }}
              >
                {planLoading
                  ? <><RefreshCw size={16} className="animate-spin" /> מעביר לדף תשלום...</>
                  : <><ExternalLink size={15} /> {t('billing.payment.pay')} ₪{totalAmount.toFixed(2)}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
       * Token top-up modal
       * ══════════════════════════════════════════════════════════════════════ */}
      {topupPkg && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm" dir={dir}>
          <div
            className="rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl overflow-hidden"
            style={{ background: '#0d1526', border: '1px solid rgba(52,211,153,0.25)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5" style={{ background: 'rgba(52,211,153,0.07)', borderBottom: '1px solid rgba(52,211,153,0.15)' }}>
              <button onClick={closeTopupModal} className="p-1 rounded-lg" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-base">💎</span>
                <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>רכישת טוקנים</span>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Package summary */}
              <div className="rounded-xl p-5 flex items-center justify-between" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
                <div>
                  <p className="text-xs font-bold mb-1" style={{ color: 'rgba(52,211,153,0.8)' }}>תקבל</p>
                  <p className="font-black text-2xl" style={{ color: 'rgba(255,255,255,0.95)' }}>{formatTokenCount(dollarsToTokens(topupPkg.dollars))}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>טוקני AI</p>
                </div>
                <div className="text-right">
                  <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>לתשלום</p>
                  <p className="font-black text-3xl" style={{ color: '#34d399' }}>{topupPkg.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    + מע"מ ${vatOn(topupPkg.dollars).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* How payment works — without naming the processor. */}
              <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <Lock size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  התשלום מבוצע בעמוד תשלום מאובטח. פרטי האשראי אינם נשמרים אצלנו, ותוחזר לכאן לאחר אישור. חשבונית מס תישלח אליך בדוא״ל.
                </p>
              </div>

              {topupError && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                  <AlertCircle size={14} /> {topupError}
                </div>
              )}

              <button
                onClick={handleTopup}
                disabled={topupLoading}
                className="w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white', boxShadow: '0 0 14px rgba(16,185,129,0.3)' }}
              >
                {topupLoading
                  ? <><RefreshCw size={16} className="animate-spin" /> מעביר לדף תשלום...</>
                  : <><ExternalLink size={15} /> שלם {topupPkg.label}</>
                }
              </button>

              <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                🔒 256-bit SSL · תשלום מאובטח ומוצפן
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
