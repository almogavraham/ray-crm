import { useState } from 'react';
import {
  CreditCard, Check, Zap, Building2, Crown, X, Lock,
  RefreshCw, CheckCircle2, Star, AlertCircle, AlertTriangle,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile, WorkspacePlan } from '../types';
import { useLang } from '../contexts/LangContext';
import {
  TOPUP_PACKAGES, formatBalance, balancePercent, addTokens,
  dollarsToTokens, formatTokenDisplay, formatTokenCount, adminQuotaHasRoom, deductFromAdminQuota,
} from '../lib/tokenTracker';

interface BillingPageProps {
  workspace: WorkspaceProfile;
  onPlanUpdate?: (plan: WorkspacePlan) => void;
}

// ─── Luhn check ─────────────────────────────────────────────────────────────
function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0 && digits.length >= 13;
}

// ─── Card brand detection ─────────────────────────────────────────────────────
function detectBrand(num: string): string {
  const d = num.replace(/\D/g, '');
  if (d.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return 'Mastercard';
  return '';
}

// ─── Days remaining helper ────────────────────────────────────────────────────
function daysRemaining(isoDate?: string): number {
  if (!isoDate) return 0;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

const VAT_RATE = 0.17;

const PLANS = [
  {
    key: 'trial' as WorkspacePlan,
    nameKey: 'billing.plan.trial.name',
    price: 0,
    periodKey: 'billing.trialLeft',
    descKey: 'billing.plan.trial.desc',
    highlight: false,
    icon: Zap,
    featureKeys: ['billing.feat.allFeatures', 'billing.feat.users3', 'billing.feat.basicSupport', 'billing.feat.storage1'],
    ctaKey: 'billing.plan.trial.cta',
  },
  {
    key: 'pro' as WorkspacePlan,
    nameKey: null,
    name: 'Pro',
    price: 89,
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
    price: 199,
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
  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'enterprise' | null>(null);
  const [paymentStep, setPaymentStep] = useState<'form' | 'processing' | 'success'>('form');

  // Token topup state
  const [topupPkg,    setTopupPkg]    = useState<typeof TOPUP_PACKAGES[number] | null>(null);
  const [topupStep,   setTopupStep]   = useState<'form' | 'processing' | 'success'>('form');
  const [topupError,  setTopupError]  = useState('');
  const [tokensGranted, setTokensGranted] = useState(0);

  const closeTopup = () => {
    setTopupPkg(null);
    setTopupStep('form');
    setTopupError('');
    setCardNumber('');
    setExpiry('');
    setCvv('');
    setCardName('');
  };

  const handleTopupPay = async () => {
    if (!topupPkg) return;
    setTopupError('');
    if (!cardName.trim()) { setTopupError(t('billing.err.cardName')); return; }
    const rawDigits = cardNumber.replace(/\D/g, '');
    if (rawDigits.length < 13 || !luhn(rawDigits)) { setTopupError(t('billing.err.cardInvalid')); return; }
    const [mm, yy] = expiry.split('/');
    if (!mm || !yy || mm.length !== 2 || yy.length !== 2) { setTopupError(t('billing.err.expiry')); return; }
    if (cvv.length < 3) { setTopupError(t('billing.err.cvv')); return; }

    setTopupStep('processing');
    await new Promise(r => setTimeout(r, 2000));

    try {
      const hasRoom = await adminQuotaHasRoom(topupPkg.dollars);
      if (!hasRoom) {
        setTopupStep('form');
        setTopupError('אין מספיק קרדיטים זמינים כרגע. אנא פנה לתמיכה.');
        return;
      }
      await addTokens(workspace.id, topupPkg.dollars, 'topup', `רכישת טוקנים: ${topupPkg.label}`);
      await deductFromAdminQuota(topupPkg.dollars);
      setTokensGranted(dollarsToTokens(topupPkg.dollars));
      setTopupStep('success');
    } catch {
      setTopupStep('form');
      setTopupError('שגיאה בעיבוד התשלום. נסה שוב.');
    }
  };

  // Token balance helpers
  const tokenBalance    = workspace?.tokenBalance ?? 0;
  const tokenAllocation = workspace?.tokenPlanAllocation ?? 0;
  const tokenUsed       = workspace?.tokenUsed ?? 0;
  const tokenPct        = balancePercent(tokenBalance, tokenAllocation);
  const tokenBarColor   = tokenPct > 50 ? 'bg-emerald-500' : tokenPct > 20 ? 'bg-amber-400' : 'bg-red-500';

  // Card form state
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardName, setCardName] = useState('');
  const [email, setEmail] = useState(workspace.email ?? '');
  const [formError, setFormError] = useState('');

  const trialDays = daysRemaining(workspace.trialEndsAt);
  const currentPlanObj = PLANS.find(p => p.key === workspace.plan) ?? PLANS[0];
  const chosenPlanObj = selectedPlan ? PLANS.find(p => p.key === selectedPlan) : null;

  // ─── Card number formatter ────────────────────────────────────────────────
  const handleCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    const formatted = digits.replace(/(.{4})/g, '$1 ').trim();
    setCardNumber(formatted);
  };

  // ─── Expiry formatter ─────────────────────────────────────────────────────
  const handleExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) { setExpiry(digits); return; }
    setExpiry(digits.slice(0, 2) + '/' + digits.slice(2));
  };

  // ─── Pay handler ──────────────────────────────────────────────────────────
  const handlePay = async () => {
    setFormError('');

    if (!cardName.trim()) { setFormError(t('billing.err.cardName')); return; }
    if (!email.trim()) { setFormError(t('billing.err.email')); return; }
    const rawDigits = cardNumber.replace(/\D/g, '');
    if (rawDigits.length < 13) { setFormError(t('billing.err.cardInvalid')); return; }
    if (!luhn(rawDigits)) { setFormError(t('billing.err.cardLuhn')); return; }
    const [mm, yy] = expiry.split('/');
    if (!mm || !yy || mm.length !== 2 || yy.length !== 2) { setFormError(t('billing.err.expiry')); return; }
    if (cvv.length < 3) { setFormError(t('billing.err.cvv')); return; }

    setPaymentStep('processing');

    // Simulate 2s processing
    await new Promise(r => setTimeout(r, 2000));

    try {
      const plan = selectedPlan as WorkspacePlan;
      await updateDoc(doc(db, 'workspaces', workspace.id), { plan, status: 'active' });
      onPlanUpdate?.(plan);
    } catch (err) {
      console.error('Firestore update error:', err);
    }

    setPaymentStep('success');
  };

  const closeModal = () => {
    setSelectedPlan(null);
    setPaymentStep('form');
    setFormError('');
    setCardNumber('');
    setExpiry('');
    setCvv('');
    setCardName('');
  };

  const vatAmount = chosenPlanObj ? chosenPlanObj.price * VAT_RATE : 0;
  const totalAmount = chosenPlanObj ? chosenPlanObj.price + vatAmount : 0;
  const brand = detectBrand(cardNumber);

  return (
    <div className="min-h-screen bg-slate-900 text-white" dir={dir}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white mb-1">{t('billing.title')}</h1>
          <p className="text-slate-400 text-sm">{t('billing.subtitle')}</p>
        </div>

        {/* ── Token Balance Card ───────────────────────────────────────────── */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-lg select-none">💎</div>
              <div>
                <p className="font-semibold text-white text-sm">{t('tokens.balance')}</p>
                <p className="text-emerald-400 text-xs">{t('tokens.planAllocation')}: {formatTokenDisplay(tokenAllocation)} ({formatBalance(tokenAllocation)})</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black text-white">{formatTokenDisplay(tokenBalance)}</p>
              <p className="text-xs text-emerald-400 mt-0.5">{formatBalance(tokenBalance)} · טוקני AI</p>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-emerald-300 mb-1.5">
              <span>{t('tokens.used')}: {formatBalance(tokenUsed)}</span>
              <span>{tokenPct}% {t('tokens.remaining')}</span>
            </div>
            <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${tokenBarColor}`} style={{ width: `${tokenPct}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              {t('tokens.used')}: {formatBalance(tokenUsed)} {t('tokens.of')} {formatBalance(tokenAllocation)}
            </p>
          </div>

          {/* Warnings */}
          {tokenBalance <= 0 && (
            <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-3 text-red-300 text-sm">
              <AlertCircle size={15} className="flex-shrink-0" />
              {t('tokens.emptyWarning')}
            </div>
          )}
          {tokenBalance > 0 && tokenPct < 20 && (
            <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 rounded-xl px-4 py-3 text-amber-300 text-sm">
              <AlertTriangle size={15} className="flex-shrink-0" />
              {t('tokens.lowWarning')}
            </div>
          )}
        </div>

        {/* ── Current plan banner ───────────────────────────────────────────── */}
        <div className={`rounded-2xl p-5 border flex items-center justify-between gap-4 flex-wrap ${
          workspace.plan === 'trial'
            ? 'bg-amber-500/10 border-amber-500/30'
            : workspace.plan === 'pro'
              ? 'bg-indigo-500/10 border-indigo-500/30'
              : 'bg-purple-500/10 border-purple-500/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              workspace.plan === 'trial' ? 'bg-amber-500/20' :
              workspace.plan === 'pro' ? 'bg-indigo-500/20' : 'bg-purple-500/20'
            }`}>
              {workspace.plan === 'trial' && <AlertCircle size={20} className="text-amber-400" />}
              {workspace.plan === 'pro' && <Star size={20} className="text-indigo-400" />}
              {workspace.plan === 'enterprise' && <Crown size={20} className="text-purple-400" />}
              {(workspace.plan === 'basic') && <Zap size={20} className="text-slate-400" />}
            </div>
            <div>
              <p className="font-semibold text-white">
                {currentPlanObj.nameKey ? t(currentPlanObj.nameKey) : currentPlanObj.name}
              </p>
              {workspace.plan === 'trial' ? (
                <p className="text-sm text-amber-400">
                  {trialDays > 0 ? `${trialDays} ${t('billing.trialLeft')}` : t('billing.trialEnded')}
                </p>
              ) : (
                <p className="text-sm text-slate-400">{t('billing.activePlan')}</p>
              )}
            </div>
          </div>
          {workspace.plan === 'trial' && (
            <div className="text-amber-400 text-sm font-medium">
              {t('billing.upgradeData')}
            </div>
          )}
        </div>

        {/* ── Plan cards ───────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">{t('billing.choosePlan')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(plan => {
              const Icon = plan.icon;
              const isCurrent = workspace.plan === plan.key;
              const planName = plan.nameKey ? t(plan.nameKey) : plan.name ?? '';
              const planDesc = t(plan.descKey);
              const planCta = t(plan.ctaKey);
              const planPeriod = t(plan.periodKey);
              return (
                <div
                  key={plan.key}
                  className={`relative rounded-2xl p-6 border flex flex-col transition-all duration-200 ${
                    plan.highlight
                      ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_30px_rgba(99,102,241,0.15)]'
                      : 'border-slate-700 bg-slate-800'
                  } ${isCurrent ? 'opacity-70' : 'hover:border-slate-500 cursor-pointer'}`}
                  onClick={() => {
                    if (!isCurrent && plan.key !== 'trial') {
                      setSelectedPlan(plan.key as 'pro' | 'enterprise');
                      setPaymentStep('form');
                    }
                  }}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 right-1/2 translate-x-1/2">
                      <span className="bg-indigo-600 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                        {t('billing.mostPopular')}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      plan.highlight ? 'bg-indigo-500/30' : 'bg-slate-700'
                    }`}>
                      <Icon size={16} className={plan.highlight ? 'text-indigo-400' : 'text-slate-400'} />
                    </div>
                    <span className="font-bold text-white">{planName}</span>
                    {isCurrent && (
                      <span className="mr-auto text-[11px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-medium">
                        {t('billing.current')}
                      </span>
                    )}
                  </div>

                  <p className="text-slate-400 text-xs mb-4">{planDesc}</p>

                  <div className="flex items-baseline gap-1 mb-5">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-black text-white">{t('billing.free')}</span>
                    ) : (
                      <>
                        <span className="text-slate-400 text-sm">₪</span>
                        <span className="text-3xl font-black text-white">{plan.price}</span>
                        <span className="text-slate-400 text-sm">/{planPeriod}</span>
                      </>
                    )}
                  </div>

                  <ul className="space-y-2 flex-1 mb-5">
                    {plan.featureKeys.map(fk => (
                      <li key={fk} className="flex items-center gap-2 text-sm text-slate-300">
                        <Check size={13} className={plan.highlight ? 'text-indigo-400' : 'text-green-400'} />
                        {t(fk)}
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={isCurrent || plan.key === 'trial'}
                    onClick={e => {
                      e.stopPropagation();
                      if (!isCurrent && plan.key !== 'trial') {
                        setSelectedPlan(plan.key as 'pro' | 'enterprise');
                        setPaymentStep('form');
                      }
                    }}
                    className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      isCurrent || plan.key === 'trial'
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : plan.highlight
                          ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.4)]'
                          : 'bg-slate-700 hover:bg-slate-600 text-white'
                    }`}
                  >
                    {isCurrent ? t('billing.currentPlanLabel') : planCta}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Token Top-up Section ─────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-xl">💎</span>
            {t('tokens.topup')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TOPUP_PACKAGES.map(pkg => {
              return (
                <div key={pkg.id} className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 flex flex-col items-center text-center gap-3 hover:border-emerald-500/60 transition-all">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-2xl font-black text-emerald-400">{pkg.label}</span>
                  </div>
                  <div>
                    <p className="text-white font-bold text-lg">{pkg.label}</p>
                    <p className="text-emerald-400 text-xs">{formatTokenCount(dollarsToTokens(pkg.dollars))} טוקני AI</p>
                  </div>
                  <button
                    onClick={() => { setTopupPkg(pkg); setTopupStep('form'); setCardNumber(''); setExpiry(''); setCvv(''); setCardName(''); setTopupError(''); }}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <CreditCard size={14} /> רכוש עכשיו
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-slate-500 text-xs mt-3 text-center">
            * התשלום מאובטח ומוצפן. הטוקנים יתווספו מיד לאחר אישור התשלום.
          </p>
        </div>

        {/* ── Billing history placeholder ──────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CreditCard size={18} className="text-slate-400" />
            {t('billing.history')}
          </h2>
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-700 flex items-center justify-center">
              <CreditCard size={22} className="text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm">{t('billing.noHistory')}</p>
            <p className="text-slate-600 text-xs">{t('billing.noHistoryDesc')}</p>
          </div>
        </div>
      </div>

      {/* ── Payment modal ─────────────────────────────────────────────────── */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
          <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 w-full sm:max-w-md shadow-2xl overflow-hidden max-h-[95vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700">
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-green-400" />
                <span className="font-semibold text-white">{t('billing.payment.title')}</span>
              </div>
            </div>

            {/* Success state */}
            {paymentStep === 'success' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 size={36} className="text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white">{t('billing.payment.success')}</h3>
                <p className="text-slate-400 text-sm">
                  {t('billing.payment.successDesc')} {chosenPlanObj?.nameKey ? t(chosenPlanObj.nameKey) : chosenPlanObj?.name}
                </p>
                <button
                  onClick={closeModal}
                  className="mt-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-8 rounded-xl transition-all"
                >
                  {t('billing.payment.close')}
                </button>
              </div>
            )}

            {/* Processing state */}
            {paymentStep === 'processing' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center">
                  <RefreshCw size={30} className="text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-white">{t('billing.payment.processing')}</h3>
                <p className="text-slate-400 text-sm">{t('billing.payment.processingDesc')}</p>
              </div>
            )}

            {/* Form state */}
            {paymentStep === 'form' && chosenPlanObj && (
              <div className="p-5 space-y-5">
                {/* Plan summary */}
                <div className="bg-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">
                      {chosenPlanObj.nameKey ? t(chosenPlanObj.nameKey) : chosenPlanObj.name}
                    </p>
                    <p className="text-slate-400 text-xs">{t(chosenPlanObj.descKey)}</p>
                  </div>
                  <div className="text-left">
                    <span className="text-xl font-black text-white">₪{chosenPlanObj.price}</span>
                    <span className="text-slate-400 text-xs">/{t(chosenPlanObj.periodKey)}</span>
                  </div>
                </div>

                {/* Card number */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                    {t('billing.payment.cardNumber')}
                    {brand && <span className="mr-2 text-xs text-indigo-400 font-normal">{brand}</span>}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0000 0000 0000 0000"
                      value={cardNumber}
                      onChange={e => handleCardNumber(e.target.value)}
                      maxLength={19}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                      dir="ltr"
                    />
                    <CreditCard size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  </div>
                </div>

                {/* Expiry + CVV */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">{t('billing.payment.expiry')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="MM/YY"
                      value={expiry}
                      onChange={e => handleExpiry(e.target.value)}
                      maxLength={5}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">{t('billing.payment.cvv')}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="123"
                      value={cvv}
                      onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      maxLength={4}
                      className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Cardholder name */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">{t('billing.payment.cardName')}</label>
                  <input
                    type="text"
                    placeholder="John Smith"
                    value={cardName}
                    onChange={e => setCardName(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">{t('billing.payment.email')}</label>
                  <input
                    type="email"
                    placeholder="example@domain.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                    dir="ltr"
                  />
                </div>

                {/* Price breakdown */}
                <div className="bg-slate-700/40 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-400">
                    <span>{t('billing.payment.subtotal')}</span>
                    <span>₪{chosenPlanObj.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>{t('billing.payment.vat')}</span>
                    <span>₪{vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-2 border-t border-slate-600">
                    <span>{t('billing.payment.total')}</span>
                    <span>₪{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                {/* Error */}
                {formError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                    <AlertCircle size={15} />
                    {formError}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handlePay}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3.5 rounded-xl transition-all text-base shadow-[0_0_20px_rgba(34,197,94,0.3)] flex items-center justify-center gap-2"
                >
                  <Lock size={15} />
                  {t('billing.payment.pay')} — ₪{totalAmount.toFixed(2)}
                </button>

                <p className="text-center text-xs text-slate-500">
                  {t('billing.payment.secureNote')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Token Purchase Modal ─────────────────────────────────────────── */}
      {topupPkg && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
          <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 w-full sm:max-w-md shadow-2xl overflow-hidden max-h-[95vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <button onClick={closeTopup} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700">
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-green-400" />
                <span className="font-semibold text-white">רכישת טוקנים</span>
              </div>
            </div>

            {/* Success */}
            {topupStep === 'success' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-4xl">💎</span>
                </div>
                <h3 className="text-xl font-bold text-white">הטוקנים נוספו בהצלחה!</h3>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-8 py-4">
                  <p className="text-5xl font-black text-emerald-400">{formatTokenCount(tokensGranted)}</p>
                  <p className="text-emerald-300 text-sm mt-1">טוקני AI נוספו לחשבונך</p>
                </div>
                <p className="text-slate-400 text-xs">הטוקנים זמינים לשימוש מיידי בכל כלי ה-AI</p>
                <button onClick={closeTopup}
                  className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 px-8 rounded-xl transition-all">
                  מצוין!
                </button>
              </div>
            )}

            {/* Processing */}
            {topupStep === 'processing' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center">
                  <RefreshCw size={28} className="text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-white">מעבד תשלום...</h3>
                <p className="text-slate-400 text-sm">אנא המתן, אל תסגור את החלון</p>
              </div>
            )}

            {/* Form */}
            {topupStep === 'form' && (
              <div className="p-5 space-y-4">
                {/* Package summary */}
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-emerald-400 text-xs font-bold">תקבל</p>
                    <p className="text-white font-black text-2xl">{formatTokenCount(dollarsToTokens(topupPkg.dollars))}</p>
                    <p className="text-slate-400 text-xs">טוקני AI</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 text-xs">לתשלום</p>
                    <p className="text-white font-black text-2xl">{topupPkg.label}</p>
                    <p className="text-slate-400 text-xs">+ מע"מ {Math.round(topupPkg.dollars * 0.17 * 100) / 100}$</p>
                  </div>
                </div>

                {/* Card form */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-400 text-xs mb-1.5">{t('billing.payment.cardName')}</label>
                    <input value={cardName} onChange={e => setCardName(e.target.value)} placeholder="Almog Avraham"
                      className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs mb-1.5">{t('billing.payment.cardNumber')}</label>
                    <div className="relative">
                      <input value={cardNumber} onChange={e => handleCardNumber(e.target.value)} placeholder="0000 0000 0000 0000" maxLength={19}
                        className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"/>
                      {brand && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">{brand}</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1.5">{t('billing.payment.expiry')}</label>
                      <input value={expiry} onChange={e => handleExpiry(e.target.value)} placeholder="MM/YY"
                        className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"/>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1.5">CVV</label>
                      <input value={cvv} onChange={e => setCvv(e.target.value.slice(0,4))} placeholder="123" type="password"
                        className="w-full bg-slate-700 border border-slate-600 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"/>
                    </div>
                  </div>
                </div>

                {topupError && (
                  <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-3 text-red-300 text-sm">
                    <AlertCircle size={14}/> {topupError}
                  </div>
                )}

                <button onClick={handleTopupPay}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2">
                  <Lock size={14}/> שלם {topupPkg.label} + מע"מ
                </button>
                <div className="flex items-center justify-center gap-2 text-slate-600 text-xs">
                  <Lock size={10}/> תשלום מאובטח ומוצפן 256-bit SSL
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
