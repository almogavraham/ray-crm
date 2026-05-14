import { useState, useEffect, useRef } from 'react';
import {
  Zap, Check, BarChart3,
  Users, Brain, CheckSquare, Megaphone, Target,
  Shield, Rocket, Globe, Menu, X, TrendingUp,
  ChevronRight, Sparkles, Building2,
  Mail, ArrowLeft, Activity, Layers, GitBranch,
  Lock, Cpu, Database, Star,
} from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
  isLoggedIn?: boolean;
  isSuperAdmin?: boolean;
}

/* ─── Animated counter ───────────────────────────────────────────────────────── */
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        let start = 0;
        const duration = 1400;
        const step = 16;
        const increment = target / (duration / step);
        const timer = setInterval(() => {
          start += increment;
          if (start >= target) { setCount(target); clearInterval(timer); }
          else setCount(Math.floor(start));
        }, step);
      }
    }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{count}{suffix}</span>;
}

/* ─── Navbar ─────────────────────────────────────────────────────────────────── */
function Navbar({ onSignIn, onSignUp, isLoggedIn, isSuperAdmin }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const navLinks = [
    { label: 'תכונות', href: '#features' },
    { label: 'פתרון', href: '#how' },
    { label: 'תמחור', href: '#pricing' },
  ];

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'border-b border-[#1a2540]/80 bg-[#05070f]/95 backdrop-blur-2xl shadow-[0_1px_0_rgba(99,102,241,0.06)]'
          : 'bg-transparent'
      }`}
      dir="rtl"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[64px] flex items-center justify-between">

        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-lg bg-indigo-600 blur-[6px] opacity-50 group-hover:opacity-75 transition-opacity" />
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
              <Zap size={15} className="text-white fill-white" />
            </div>
          </div>
          <span className="text-white font-bold text-[17px] tracking-[-0.02em]">RAY</span>
          <span className="text-[#3d5080] font-medium text-[15px] tracking-tight">CRM</span>
        </a>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(l => (
            <a key={l.href} href={l.href}
              className="px-4 py-2 text-[#8899bb] hover:text-white text-sm font-medium transition-colors rounded-lg hover:bg-white/[0.04]">
              {l.label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-2.5">
          {isLoggedIn && isSuperAdmin ? (
            <a href="https://admin.ray-crm.com"
              className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors">
              פאנל אדמין
              <ArrowLeft size={13} />
            </a>
          ) : (
            <>
              <button onClick={onSignIn}
                className="px-4 py-2 text-sm font-medium text-[#8899bb] hover:text-white transition-colors rounded-lg hover:bg-white/[0.04]">
                כניסה
              </button>
              <button onClick={onSignUp}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all shadow-[0_0_20px_rgba(79,70,229,0.35)] hover:shadow-[0_0_28px_rgba(79,70,229,0.5)]">
                התחל חינם
                <ArrowLeft size={13} />
              </button>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button className="md:hidden p-2 text-[#8899bb] hover:text-white transition-colors" onClick={() => setMenuOpen(p => !p)}>
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-[#05070f]/98 border-t border-[#1a2540] px-5 py-4 space-y-1 backdrop-blur-2xl">
          {navLinks.map(l => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
              className="block px-3 py-2.5 text-[#8899bb] hover:text-white text-sm font-medium rounded-lg hover:bg-white/[0.04] transition-colors">
              {l.label}
            </a>
          ))}
          <div className="pt-3 flex flex-col gap-2 border-t border-[#1a2540] mt-3">
            <button onClick={onSignIn} className="w-full border border-[#1a2540] text-[#8899bb] text-sm font-medium py-2.5 rounded-lg">כניסה</button>
            <button onClick={onSignUp} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">התחל חינם</button>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────────── */
function Hero({ onSignUp, onSignIn }: { onSignUp: () => void; onSignIn: () => void }) {
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden" dir="rtl">

      {/* Background radial */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-indigo-950/40 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] w-64 h-64 bg-blue-900/20 rounded-full blur-[80px]" />
        <div className="absolute top-[30%] left-[5%] w-48 h-48 bg-violet-900/15 rounded-full blur-[60px]" />
      </div>

      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(99,102,241,0.12) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 py-24 lg:py-32">
        <div className="max-w-4xl mx-auto text-center">

          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full border border-indigo-500/25 bg-indigo-500/[0.07] text-indigo-400 text-xs font-semibold tracking-wide">
            <Sparkles size={11} />
            מערכת CRM חכמה מבוססת AI לסוכנויות שיווק
          </div>

          {/* Headline */}
          <h1 className="text-[clamp(2.8rem,7vw,5.2rem)] font-black text-white leading-[1.08] tracking-[-0.03em] mb-6">
            נהל לידים.
            <br />
            <span
              className="text-transparent"
              style={{ backgroundImage: 'linear-gradient(90deg, #818cf8 0%, #a5b4fc 40%, #6366f1 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}
            >
              סגור עסקאות.
            </span>
            <br />
            <span className="text-[#3d5080]">צור גדול.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-[#6b7fa3] text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            RAY CRM — פלטפורמת ניהול לידים עם בינה מלאכותית שמותאמת לעסק שלך.
            מפייפליין ועד אנליטיקה, הכל במקום אחד.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-14">
            <button onClick={onSignUp}
              className="group w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_40px_rgba(79,70,229,0.6)]">
              <Rocket size={15} />
              התחל 14 יום חינם
              <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            </button>
            <button onClick={onSignIn}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl border border-[#1e2d4a] bg-white/[0.02] hover:bg-white/[0.05] text-[#8899bb] hover:text-white text-sm font-medium transition-all">
              כניסה לחשבון קיים
            </button>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[#3d5080] text-xs font-medium">
            {[
              { icon: Shield, label: 'ללא כרטיס אשראי' },
              { icon: Lock, label: 'אבטחה ברמה ארגונית' },
              { icon: Cpu, label: 'AI מותאם לעסק שלך' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <Icon size={12} className="text-indigo-500/60" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard preview */}
        <div className="mt-20 relative max-w-5xl mx-auto">
          {/* Fade to bottom */}
          <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-[#05070f] to-transparent z-10 pointer-events-none" />

          {/* Outer glow ring */}
          <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-indigo-500/20 via-indigo-500/5 to-transparent" />

          {/* Browser chrome */}
          <div className="relative bg-[#08101e] border border-[#1a2540]/80 rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
            {/* Title bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a2540]/80 bg-[#060d1a]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70" />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="bg-[#0d1629] border border-[#1a2540]/60 rounded-md px-4 py-1 text-[#3d5080] text-[11px] font-mono flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  app.ray-crm.com/my-agency
                </div>
              </div>
            </div>

            {/* Mock app UI */}
            <div className="p-5 sm:p-6" dir="rtl">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-indigo-600/30 border border-indigo-500/20 flex items-center justify-center">
                    <Activity size={12} className="text-indigo-400" />
                  </div>
                  <span className="text-[#8899bb] text-xs font-medium">עדכון אחרון: לפני 3 דקות</span>
                </div>
                <div className="text-white text-sm font-bold">לוח בקרה</div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                {[
                  { label: 'לידים חודש', value: '47', change: '+12%', color: 'text-indigo-400', dot: 'bg-indigo-500' },
                  { label: 'שווי פייפליין', value: '₪284K', change: '+8%', color: 'text-emerald-400', dot: 'bg-emerald-500' },
                  { label: 'ציון AI', value: '73%', change: '+5%', color: 'text-violet-400', dot: 'bg-violet-500' },
                  { label: 'משימות', value: '9', change: '-3', color: 'text-amber-400', dot: 'bg-amber-500' },
                ].map(s => (
                  <div key={s.label} className="bg-[#0d1629] border border-[#1a2540]/70 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className={`text-[10px] font-bold ${s.color} bg-current/10 px-1.5 py-0.5 rounded-full`}
                        style={{ backgroundColor: `${s.color.includes('indigo') ? '#3730a310' : s.color.includes('emerald') ? '#05966910' : s.color.includes('violet') ? '#7c3aed10' : '#d9770610'}` }}>
                        {s.change}
                      </div>
                      <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    </div>
                    <div className={`text-base font-black ${s.color}`}>{s.value}</div>
                    <div className="text-[#3d5080] text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Pipeline */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { status: 'חדש', color: '#6366f1', leads: ['Acme Corp', 'MediaFlow', 'StartupX'] },
                  { status: 'בתהליך', color: '#f59e0b', leads: ['BrandHouse', 'ClickMedia'] },
                  { status: 'לקוח פעיל', color: '#10b981', leads: ['TopAgency', 'GrowthCo'] },
                ].map(col => (
                  <div key={col.status} className="bg-[#0d1629] border border-[#1a2540]/50 rounded-xl p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col.color }} />
                      <span className="text-[#6b7fa3] text-[10px] font-semibold">{col.status}</span>
                      <span className="text-[#2a3a55] text-[9px] mr-auto font-mono">{col.leads.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {col.leads.map(name => (
                        <div key={name} className="bg-[#0a1525] border border-[#1a2540]/40 rounded-lg p-2">
                          <div className="text-[#8899bb] text-[10px] font-medium">{name}</div>
                          <div className="h-[2px] bg-[#1a2540] rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ backgroundColor: col.color, width: `${55 + Math.random() * 35}%`, opacity: 0.7 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Logos / Social Proof ───────────────────────────────────────────────────── */
function SocialProof() {
  const stats = [
    { value: 500, suffix: '+', label: 'לידים מנוהלים' },
    { value: 98,  suffix: '%', label: 'שביעות רצון לקוחות' },
    { value: 3,   suffix: '×', label: 'שיפור בהמרות' },
    { value: 14,  suffix: '',  label: 'יום ניסיון חינם' },
  ];

  return (
    <section className="border-y border-[#1a2540]/60 bg-[#060d1a]/50" dir="rtl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          {stats.map(s => (
            <div key={s.label} className="text-center">
              <div className="text-3xl sm:text-4xl font-black text-white mb-1 tabular-nums">
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <div className="text-[#3d5080] text-xs font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Features ───────────────────────────────────────────────────────────────── */
function Features() {
  const features = [
    {
      icon: GitBranch,
      accent: '#6366f1',
      title: 'פייפליין Kanban',
      desc: 'ניהול ויזואלי של תהליך המכירה. גרור לידים בין שלבים, ראה ציון AI ועקוב אחר פוטנציאל הכנסה.',
      tag: 'Pipeline',
    },
    {
      icon: Brain,
      accent: '#8b5cf6',
      title: 'עוזר AI מותאם אישית',
      desc: 'ה-AI לומד את העסק שלך — תחום, לקוחות, תהליך מכירה — ונותן המלצות מדויקות לכל ליד.',
      tag: 'AI',
    },
    {
      icon: BarChart3,
      accent: '#10b981',
      title: 'אנליטיקה בזמן אמת',
      desc: 'דוחות חיים על ביצועי הצוות, מקורות לידים, שיעורי המרה ופוטנציאל הכנסה.',
      tag: 'Analytics',
    },
    {
      icon: CheckSquare,
      accent: '#3b82f6',
      title: 'ניהול משימות חכם',
      desc: 'צור ועקוב אחר משימות מקושרות לכל ליד. קבל התראות ותעדף עבודה בצורה אוטומטית.',
      tag: 'Tasks',
    },
    {
      icon: Users,
      accent: '#ec4899',
      title: 'ניהול צוות',
      desc: 'הקצה לידים, עקוב אחר ביצועים אישיים וניהל הרשאות גישה בגמישות מלאה.',
      tag: 'Team',
    },
    {
      icon: Megaphone,
      accent: '#f59e0b',
      title: 'ניהול קריאייטיב',
      desc: 'עקוב אחר תוכן, קמפיינים ומסירות לכל לקוח. ראה מה ממתין ומה נמסר.',
      tag: 'Content',
    },
  ];

  return (
    <section id="features" className="py-28" dir="rtl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        {/* Section head */}
        <div className="max-w-2xl mb-16">
          <div className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full border border-indigo-500/20 bg-indigo-500/[0.06] text-indigo-400 text-[11px] font-semibold tracking-widest uppercase">
            <Layers size={10} />
            הפלטפורמה
          </div>
          <h2 className="text-[clamp(1.9rem,4vw,3rem)] font-black text-white leading-[1.12] tracking-[-0.025em] mb-4">
            כלים ארגוניים.<br />
            <span className="text-[#3d5080]">פשטות של רגע.</span>
          </h2>
          <p className="text-[#6b7fa3] text-base leading-relaxed">
            מלידים ועד עסקאות סגורות — כל הכלים שסוכנות שיווק צריכה, במקום אחד.
          </p>
        </div>

        {/* Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1a2540]/40 rounded-2xl overflow-hidden border border-[#1a2540]/60">
          {features.map((f, i) => (
            <div key={f.title}
              className={`group relative bg-[#05070f] hover:bg-[#080e1c] p-7 transition-all duration-300 ${
                i === 0 ? 'rounded-tr-2xl' : i === 2 ? 'rounded-tl-2xl' : i === 3 ? 'rounded-br-2xl' : i === 5 ? 'rounded-bl-2xl' : ''
              }`}
            >
              {/* Accent line on hover */}
              <div className="absolute top-0 right-0 left-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, transparent, ${f.accent}50, transparent)` }} />

              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border"
                  style={{ backgroundColor: `${f.accent}12`, borderColor: `${f.accent}25` }}>
                  <f.icon size={16} style={{ color: f.accent }} />
                </div>
                <div className="flex-1 pt-0.5">
                  <span className="text-[10px] font-bold tracking-widest uppercase font-mono"
                    style={{ color: `${f.accent}90` }}>
                    {f.tag}
                  </span>
                </div>
              </div>

              <h3 className="text-white font-bold text-[15px] mb-2 leading-snug">{f.title}</h3>
              <p className="text-[#4d6080] text-sm leading-relaxed">{f.desc}</p>

              <div className="mt-5 flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ color: f.accent }}>
                למד עוד
                <ChevronRight size={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How It Works ───────────────────────────────────────────────────────────── */
function HowItWorks({ onSignUp }: { onSignUp: () => void }) {
  const steps = [
    {
      num: '01',
      icon: Building2,
      title: 'צור סביבת עבודה',
      desc: 'הרשם תוך 2 דקות, הגדר את סביבת העבודה שלך ועדכן את ה-AI כדי שיכיר את העסק שלך.',
      accent: '#6366f1',
    },
    {
      num: '02',
      icon: Target,
      title: 'הוסף לידים ונהל אותם',
      desc: 'ייבא לידים קיימים או הוסף חדשים. ה-AI מנתח ומדרג כל ליד לפי פוטנציאל המרה.',
      accent: '#8b5cf6',
    },
    {
      num: '03',
      icon: TrendingUp,
      title: 'צמח ותסגור יותר עסקאות',
      desc: 'עקוב אחר כל שלב בפייפליין, קבל המלצות AI ועדכן סטטוסים עד לסגירת העסקה.',
      accent: '#10b981',
    },
  ];

  return (
    <section id="how" className="py-28 relative overflow-hidden" dir="rtl">
      {/* Background */}
      <div className="absolute inset-0 bg-[#060d1a]/70" />
      <div className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400 text-[11px] font-semibold tracking-widest uppercase">
            <Rocket size={10} />
            מתחילים
          </div>
          <h2 className="text-[clamp(1.9rem,4vw,3rem)] font-black text-white leading-[1.12] tracking-[-0.025em] mb-4">
            שלושה שלבים פשוטים
          </h2>
          <p className="text-[#6b7fa3] text-base max-w-xl mx-auto">
            הגדרה מהירה. ללא ידע טכני. ללא כרטיס אשראי.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {steps.map((s) => (
            <div key={s.num} className="relative group">
              <div className="h-full bg-[#05070f] border border-[#1a2540]/60 hover:border-[#2a3a55] rounded-2xl p-7 transition-all duration-300">
                {/* Number */}
                <div className="text-[4.5rem] font-black leading-none mb-5 select-none"
                  style={{ color: `${s.accent}15` }}>
                  {s.num}
                </div>

                <div className="w-10 h-10 rounded-xl mb-5 flex items-center justify-center border"
                  style={{ backgroundColor: `${s.accent}10`, borderColor: `${s.accent}20` }}>
                  <s.icon size={18} style={{ color: s.accent }} />
                </div>

                <h3 className="text-white font-bold text-lg mb-3 leading-snug">{s.title}</h3>
                <p className="text-[#4d6080] text-sm leading-relaxed">{s.desc}</p>

                {/* Bottom accent */}
                <div className="absolute bottom-0 right-0 left-0 h-px opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: `linear-gradient(90deg, transparent, ${s.accent}40, transparent)` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button onClick={onSignUp}
            className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-[0_0_30px_rgba(79,70,229,0.35)] hover:shadow-[0_0_40px_rgba(79,70,229,0.55)]">
            <Rocket size={15} />
            התחל עכשיו — 14 יום חינם
            <ArrowLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ────────────────────────────────────────────────────────────────── */
function Pricing({ onSignUp }: { onSignUp: () => void }) {
  const plans = [
    {
      name: 'Starter',
      price: '0',
      period: '14 יום',
      desc: 'כל התכונות, ללא הגבלה',
      highlight: false,
      features: [
        'עד 50 לידים',
        'פייפליין Kanban',
        'עוזר AI',
        'ניהול משימות',
        '2 משתמשים',
        'דוחות בסיסיים',
      ],
      cta: 'התחל ניסיון חינם',
      ctaClass: 'border border-[#1e2d4a] bg-white/[0.03] hover:bg-white/[0.06] text-white',
    },
    {
      name: 'Pro',
      price: '299',
      period: 'חודש',
      desc: 'לסוכנויות שרוצות לגדול',
      highlight: true,
      features: [
        'לידים ללא הגבלה',
        'פייפליין Kanban מלא',
        'עוזר AI מתקדם + אישיות',
        'ניהול משימות מלא',
        '10 משתמשים',
        'דוחות מתקדמים',
        'ניהול קריאייטיב',
        'אינטגרציות',
        'תמיכה עדיפה',
      ],
      cta: 'התחל ב-Pro',
      ctaClass: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_24px_rgba(79,70,229,0.4)]',
    },
    {
      name: 'Enterprise',
      price: 'בהתאמה',
      period: '',
      desc: 'לסוכנויות גדולות',
      highlight: false,
      features: [
        'הכל ב-Pro',
        'משתמשים ללא הגבלה',
        'White-label מלא',
        'API גישה מלאה',
        'Dedicated support',
        'SLA מובטח',
        'הגדרה מותאמת',
      ],
      cta: 'צור קשר',
      ctaClass: 'border border-[#1e2d4a] bg-white/[0.03] hover:bg-white/[0.06] text-white',
    },
  ];

  return (
    <section id="pricing" className="py-28" dir="rtl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full border border-violet-500/20 bg-violet-500/[0.06] text-violet-400 text-[11px] font-semibold tracking-widest uppercase">
            <Database size={10} />
            תמחור
          </div>
          <h2 className="text-[clamp(1.9rem,4vw,3rem)] font-black text-white leading-[1.12] tracking-[-0.025em] mb-4">
            שקוף. פשוט. הוגן.
          </h2>
          <p className="text-[#6b7fa3] text-base">
            ללא הפתעות, ללא חוזים, ניתן לבטל בכל עת
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 items-stretch">
          {plans.map(plan => (
            <div key={plan.name}
              className={`relative flex flex-col rounded-2xl p-7 transition-all ${
                plan.highlight
                  ? 'bg-[#0d1629] border border-indigo-500/40 shadow-[0_0_60px_rgba(79,70,229,0.12)]'
                  : 'bg-[#05070f] border border-[#1a2540]/60 hover:border-[#2a3a55]'
              }`}>

              {plan.highlight && (
                <div className="absolute -top-px right-6 px-3 py-1 rounded-b-lg bg-indigo-600 text-white text-[10px] font-bold tracking-widest uppercase">
                  הפופולרי
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-white font-bold text-base mb-1">{plan.name}</h3>
                <p className="text-[#3d5080] text-xs mb-5">{plan.desc}</p>
                <div className="flex items-baseline gap-1">
                  {plan.price !== 'בהתאמה' && <span className="text-[#3d5080] text-sm">₪</span>}
                  <span className="text-4xl font-black text-white tracking-tight">{plan.price}</span>
                  {plan.period && <span className="text-[#3d5080] text-sm">/{plan.period}</span>}
                </div>
              </div>

              <button
                onClick={plan.name !== 'Enterprise' ? onSignUp : undefined}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all mb-6 ${plan.ctaClass}`}>
                {plan.cta}
              </button>

              <div className="space-y-3 flex-1">
                {plan.features.map(f => (
                  <div key={f} className="flex items-center gap-2.5 text-right">
                    <Check size={13} className={plan.highlight ? 'text-indigo-400 flex-shrink-0 ml-auto' : 'text-[#3d5080] flex-shrink-0 ml-auto'} style={{ order: 1 }} />
                    <span className="text-[#6b7fa3] text-sm">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA ────────────────────────────────────────────────────────────────────── */
function CTABanner({ onSignUp }: { onSignUp: () => void }) {
  return (
    <section className="py-20" dir="rtl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-[#080e1c]">
          {/* Background elements */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-indigo-600/10 rounded-full blur-[80px]" />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(rgba(99,102,241,0.08) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
          </div>

          <div className="relative py-16 px-8 sm:px-16 text-center">
            {/* Stars */}
            <div className="flex items-center justify-center gap-0.5 mb-5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
              ))}
              <span className="mr-2 text-[#4d6080] text-xs font-medium">4.9/5 מדירוג משתמשים</span>
            </div>

            <h2 className="text-[clamp(1.9rem,4vw,3rem)] font-black text-white leading-[1.1] tracking-[-0.025em] mb-4">
              מוכן להתחיל?
            </h2>
            <p className="text-[#6b7fa3] text-base mb-8 max-w-lg mx-auto">
              הצטרף לסוכנויות שמנהלות לידים עם RAY. 14 יום חינם, ללא כרטיס אשראי.
            </p>

            <button onClick={onSignUp}
              className="group inline-flex items-center gap-2.5 px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_40px_rgba(79,70,229,0.6)]">
              <Rocket size={15} />
              התחל 14 יום חינם
              <ArrowLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
            </button>

            <p className="mt-4 text-[#2a3a55] text-xs">ללא התחייבות · ביטול בכל עת · אין כרטיס אשראי</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────────────────────── */
function Footer({ onSignIn, onSignUp }: LandingPageProps) {
  return (
    <footer className="border-t border-[#1a2540]/60 py-14" dir="rtl">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                <Zap size={13} className="text-white fill-white" />
              </div>
              <span className="text-white font-bold text-base tracking-tight">RAY CRM</span>
            </div>
            <p className="text-[#3d5080] text-sm leading-relaxed">
              פלטפורמת CRM חכמה לסוכנויות שיווק. ניהול לידים, AI מותאם, אנליטיקה בזמן אמת.
            </p>
          </div>

          {/* Links */}
          {[
            { title: 'מוצר', links: ['תכונות', 'תמחור', 'אבטחה', 'API'] },
            { title: 'חברה',  links: ['אודות', 'בלוג', 'קריירה', 'יצירת קשר'] },
          ].map(col => (
            <div key={col.title}>
              <h4 className="text-[#8899bb] text-xs font-semibold mb-4 tracking-widest uppercase">{col.title}</h4>
              <div className="space-y-2.5">
                {col.links.map(l => (
                  <a key={l} href="#" className="block text-[#3d5080] hover:text-[#8899bb] text-sm transition-colors">{l}</a>
                ))}
              </div>
            </div>
          ))}

          {/* Contact */}
          <div>
            <h4 className="text-[#8899bb] text-xs font-semibold mb-4 tracking-widest uppercase">צור קשר</h4>
            <div className="space-y-2.5 mb-5">
              <a href="mailto:hello@ray-crm.com" className="flex items-center gap-2 text-[#3d5080] hover:text-[#8899bb] text-sm transition-colors">
                <Mail size={12} />
                hello@ray-crm.com
              </a>
              <a href="#" className="flex items-center gap-2 text-[#3d5080] hover:text-[#8899bb] text-sm transition-colors">
                <Globe size={12} />
                ray-crm.com
              </a>
            </div>
            <div className="flex gap-2">
              <button onClick={onSignIn}
                className="text-xs text-[#4d6080] hover:text-white border border-[#1a2540] hover:border-[#2a3a55] px-3 py-1.5 rounded-lg transition-colors">
                כניסה
              </button>
              <button onClick={onSignUp}
                className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg transition-colors font-semibold">
                הרשמה
              </button>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-[#1a2540]/50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[#2a3a55] text-xs">© 2025 RAY CRM. כל הזכויות שמורות.</p>
          <div className="flex items-center gap-2 text-[#2a3a55] text-[10px] font-mono">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */
export default function LandingPage({ onSignIn, onSignUp, isLoggedIn, isSuperAdmin }: LandingPageProps) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#05070f', color: '#e2e8f0' }}>
      <Navbar onSignIn={onSignIn} onSignUp={onSignUp} isLoggedIn={isLoggedIn} isSuperAdmin={isSuperAdmin} />
      <Hero onSignUp={onSignUp} onSignIn={onSignIn} />
      <SocialProof />
      <Features />
      <HowItWorks onSignUp={onSignUp} />
      <Pricing onSignUp={onSignUp} />
      <CTABanner onSignUp={onSignUp} />
      <Footer onSignIn={onSignIn} onSignUp={onSignUp} />
    </div>
  );
}
