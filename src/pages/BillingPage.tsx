import { useState } from 'react';
import {
  CreditCard, Check, Zap, Building2, Crown, X, Lock,
  RefreshCw, CheckCircle2, Star, AlertCircle,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile, WorkspacePlan } from '../types';

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
    name: 'ניסיון חינם',
    price: 0,
    period: '14 יום',
    desc: 'כל התכונות, ללא הגבלה',
    highlight: false,
    icon: Zap,
    features: ['כל התכונות', 'עד 3 משתמשים', 'תמיכה בסיסית', 'אחסון 1GB'],
    cta: 'תוכנית נוכחית',
  },
  {
    key: 'pro' as WorkspacePlan,
    name: 'Pro',
    price: 89,
    period: 'חודש',
    desc: 'לעסקים שרוצים לצמוח',
    highlight: true,
    icon: Star,
    features: ['כל התכונות', 'עד 10 משתמשים', 'תמיכה מועדפת', 'אחסון 10GB', 'דוחות מתקדמים', 'אינטגרציות API'],
    cta: 'שדרג ל-Pro',
  },
  {
    key: 'enterprise' as WorkspacePlan,
    name: 'Enterprise',
    price: 199,
    period: 'חודש',
    desc: 'לחברות וצוותים גדולים',
    highlight: false,
    icon: Building2,
    features: ['כל התכונות', 'משתמשים ללא הגבלה', 'SLA מובטח', 'אחסון 100GB', 'מנהל חשבון ייעודי', 'התאמה מלאה'],
    cta: 'שדרג ל-Enterprise',
  },
];

export default function BillingPage({ workspace, onPlanUpdate }: BillingPageProps) {
  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'enterprise' | null>(null);
  const [paymentStep, setPaymentStep] = useState<'form' | 'processing' | 'success'>('form');

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

    if (!cardName.trim()) { setFormError('נא להזין שם בעל הכרטיס'); return; }
    if (!email.trim()) { setFormError('נא להזין כתובת אימייל'); return; }
    const rawDigits = cardNumber.replace(/\D/g, '');
    if (rawDigits.length < 13) { setFormError('מספר כרטיס אינו תקין'); return; }
    if (!luhn(rawDigits)) { setFormError('מספר כרטיס אינו תקין (Luhn)'); return; }
    const [mm, yy] = expiry.split('/');
    if (!mm || !yy || mm.length !== 2 || yy.length !== 2) { setFormError('תאריך תפוגה אינו תקין'); return; }
    if (cvv.length < 3) { setFormError('CVV אינו תקין'); return; }

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
    <div className="min-h-screen bg-slate-900 text-white" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white mb-1">מנוי ותשלום</h1>
          <p className="text-slate-400 text-sm">נהל את התוכנית ואמצעי התשלום שלך</p>
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
              <p className="font-semibold text-white">{currentPlanObj.name}</p>
              {workspace.plan === 'trial' ? (
                <p className="text-sm text-amber-400">
                  {trialDays > 0 ? `נותרו ${trialDays} ימי ניסיון` : 'תקופת הניסיון הסתיימה'}
                </p>
              ) : (
                <p className="text-sm text-slate-400">תוכנית פעילה</p>
              )}
            </div>
          </div>
          {workspace.plan === 'trial' && (
            <div className="text-amber-400 text-sm font-medium">
              שדרג כדי לשמר את הנתונים שלך
            </div>
          )}
        </div>

        {/* ── Plan cards ───────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">בחר תוכנית</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map(plan => {
              const Icon = plan.icon;
              const isCurrent = workspace.plan === plan.key;
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
                        הכי פופולרי
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      plan.highlight ? 'bg-indigo-500/30' : 'bg-slate-700'
                    }`}>
                      <Icon size={16} className={plan.highlight ? 'text-indigo-400' : 'text-slate-400'} />
                    </div>
                    <span className="font-bold text-white">{plan.name}</span>
                    {isCurrent && (
                      <span className="mr-auto text-[11px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-medium">
                        פעיל
                      </span>
                    )}
                  </div>

                  <p className="text-slate-400 text-xs mb-4">{plan.desc}</p>

                  <div className="flex items-baseline gap-1 mb-5">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-black text-white">חינם</span>
                    ) : (
                      <>
                        <span className="text-slate-400 text-sm">₪</span>
                        <span className="text-3xl font-black text-white">{plan.price}</span>
                        <span className="text-slate-400 text-sm">/{plan.period}</span>
                      </>
                    )}
                  </div>

                  <ul className="space-y-2 flex-1 mb-5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                        <Check size={13} className={plan.highlight ? 'text-indigo-400' : 'text-green-400'} />
                        {f}
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
                    {isCurrent ? 'תוכנית נוכחית' : plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Billing history placeholder ──────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CreditCard size={18} className="text-slate-400" />
            היסטוריית חיובים
          </h2>
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-700 flex items-center justify-center">
              <CreditCard size={22} className="text-slate-500" />
            </div>
            <p className="text-slate-400 text-sm">אין חיובים להצגה</p>
            <p className="text-slate-600 text-xs">החיובים שלך יופיעו כאן לאחר הרכישה הראשונה</p>
          </div>
        </div>
      </div>

      {/* ── Payment modal ─────────────────────────────────────────────────── */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
          <div className="bg-slate-800 rounded-t-2xl sm:rounded-2xl border border-slate-700 w-full sm:max-w-md shadow-2xl overflow-hidden max-h-[95vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700">
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <Lock size={14} className="text-green-400" />
                <span className="font-semibold text-white">תשלום מאובטח</span>
              </div>
            </div>

            {/* Success state */}
            {paymentStep === 'success' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 size={36} className="text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white">התשלום התקבל!</h3>
                <p className="text-slate-400 text-sm">
                  הצטרפת בהצלחה לתוכנית {chosenPlanObj?.name}. תהנה מכל התכונות!
                </p>
                <button
                  onClick={closeModal}
                  className="mt-2 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 px-8 rounded-xl transition-all"
                >
                  סגור
                </button>
              </div>
            )}

            {/* Processing state */}
            {paymentStep === 'processing' && (
              <div className="p-8 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center">
                  <RefreshCw size={30} className="text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-white">מעבד תשלום...</h3>
                <p className="text-slate-400 text-sm">אנא המתן, מאמת את פרטי הכרטיס</p>
              </div>
            )}

            {/* Form state */}
            {paymentStep === 'form' && chosenPlanObj && (
              <div className="p-5 space-y-5">
                {/* Plan summary */}
                <div className="bg-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">{chosenPlanObj.name}</p>
                    <p className="text-slate-400 text-xs">{chosenPlanObj.desc}</p>
                  </div>
                  <div className="text-left">
                    <span className="text-xl font-black text-white">₪{chosenPlanObj.price}</span>
                    <span className="text-slate-400 text-xs">/{chosenPlanObj.period}</span>
                  </div>
                </div>

                {/* Card number */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">
                    מספר כרטיס
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
                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">תוקף (MM/YY)</label>
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
                    <label className="block text-sm text-slate-300 mb-1.5 font-medium">CVV</label>
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
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">שם בעל הכרטיס</label>
                  <input
                    type="text"
                    placeholder="ישראל ישראלי"
                    value={cardName}
                    onChange={e => setCardName(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1.5 font-medium">אימייל לקבלה</label>
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
                    <span>מחיר בסיס</span>
                    <span>₪{chosenPlanObj.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>מע"מ (17%)</span>
                    <span>₪{vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-2 border-t border-slate-600">
                    <span>סה"כ לתשלום</span>
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
                  שלם עכשיו — ₪{totalAmount.toFixed(2)}
                </button>

                <p className="text-center text-xs text-slate-500">
                  התשלום מאובטח ומוצפן. ניתן לבטל בכל עת.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
