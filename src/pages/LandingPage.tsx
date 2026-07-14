import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, Check, BarChart3, Users, Brain, CheckSquare, Target,
  Shield, Rocket, Globe, Menu, X, TrendingUp, ChevronRight,
  Sparkles, Building2, Mail, ArrowLeft, Activity, Layers,
  GitBranch, Lock, Star, MessageSquare, Bell, Calendar,
  PieChart, Workflow, Settings2, UserCheck, PhoneCall,
  AlertTriangle, Clock, Filter, Repeat, BarChart2, Cpu,
  Database, ArrowRight, Play, ChevronDown, Award, HeartHandshake,
} from 'lucide-react';
import { useLang } from '../contexts/LangContext';

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
  isLoggedIn?: boolean;
  isSuperAdmin?: boolean;
  workspaceSlug?: string;
}

/* ─── useInView hook ────────────────────────────────────────────────────────── */
function useInView(threshold = 0.12) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/* ─── Animated counter ──────────────────────────────────────────────────────── */
function Counter({ target, suffix = '', prefix = '' }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let v = 0;
        const duration = 1600;
        const step = 16;
        const inc = target / (duration / step);
        const t = setInterval(() => {
          v += inc;
          if (v >= target) { setCount(target); clearInterval(t); }
          else setCount(Math.floor(v));
        }, step);
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

/* ─── Navbar ────────────────────────────────────────────────────────────────── */
function Navbar({ onSignIn, onSignUp, isLoggedIn, isSuperAdmin, workspaceSlug }: LandingPageProps) {
  const { t, lang, setLang, dir } = useLang();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const navLinks = [
    { label: 'תכונות', href: '#features' },
    { label: 'איך זה עובד', href: '#how' },
    { label: 'תמחור', href: '#pricing' },
  ];

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-xl shadow-sm border-b border-slate-200/80'
          : 'bg-transparent'
      }`}
      dir={dir}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[64px] flex items-center justify-between">

        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-xl bg-indigo-500 blur-[6px] opacity-40 group-hover:opacity-60 transition-opacity" />
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg">
              <Zap size={15} className="text-white fill-white" />
            </div>
          </div>
          <div>
            <span className="font-black text-[17px] tracking-[-0.02em] text-slate-900">RAY</span>
            <span className="text-indigo-500 font-bold text-[15px] ms-1">CRM</span>
          </div>
        </a>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(l => (
            <a key={l.href} href={l.href}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm font-medium transition-colors rounded-lg hover:bg-slate-100">
              {l.label}
            </a>
          ))}
        </nav>

        {/* CTAs */}
        <div className="hidden md:flex items-center gap-2.5">
          <button onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 text-xs font-semibold transition-colors">
            <Globe size={13} />
            {lang === 'he' ? 'EN' : 'עב'}
          </button>

          {isLoggedIn && isSuperAdmin ? (
            <a href="https://admin.ray-crm.com"
              className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-colors shadow-md shadow-indigo-200">
              לוח ניהול <ArrowLeft size={13} />
            </a>
          ) : isLoggedIn && workspaceSlug ? (
            <a href={`/${workspaceSlug}`}
              className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-colors shadow-md shadow-indigo-200">
              כניסה לאפליקציה <ArrowLeft size={13} />
            </a>
          ) : (
            <>
              <button onClick={onSignIn}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors rounded-lg hover:bg-slate-100">
                {t('landing.nav.signIn')}
              </button>
              <button onClick={onSignUp}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-md shadow-indigo-200 hover:shadow-indigo-300">
                {t('landing.nav.signUp')} <ArrowLeft size={13} />
              </button>
            </>
          )}
        </div>

        {/* Mobile menu btn */}
        <button className="md:hidden p-2 text-slate-600 hover:text-slate-900 transition-colors" onClick={() => setMenuOpen(p => !p)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-white/98 backdrop-blur-xl border-t border-slate-200 px-5 py-4 space-y-1 shadow-lg">
          {navLinks.map(l => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
              className="block px-3 py-2.5 text-slate-600 hover:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
              {l.label}
            </a>
          ))}
          <div className="pt-3 flex flex-col gap-2 border-t border-slate-200 mt-3">
            <button onClick={onSignIn}
              className="w-full border border-slate-200 text-slate-600 text-sm font-medium py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
              {t('landing.nav.signIn')}
            </button>
            <button onClick={onSignUp}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors shadow-md shadow-indigo-200">
              {t('landing.nav.signUp')}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────────────── */
function Hero({ onSignUp, onSignIn }: { onSignUp: () => void; onSignIn: () => void }) {
  const { t, dir } = useLang();
  const [displayed, setDisplayed] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const scrambleWords = ['לידים', 'קמפיינים', 'עסקאות', 'לקוחות'];
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*<>/\\|~=+?';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let wIdx = 0;

    const rnd = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

    const reveal = (word: string, onDone: () => void) => {
      let iter = 0;
      const total = word.length * 6;
      const step = () => {
        const locked = Math.floor(iter / 6);
        let out = '';
        for (let i = 0; i < word.length; i++) out += i < locked ? word[i] : rnd();
        setDisplayed(out);
        setIsLocked(false);
        iter++;
        if (iter <= total) { timer = setTimeout(step, 38); }
        else { setDisplayed(word); setIsLocked(true); timer = setTimeout(onDone, 2400); }
      };
      step();
    };

    const hide = (word: string, onDone: () => void) => {
      let iter = 0;
      const step = () => {
        let out = '';
        for (let i = 0; i < word.length; i++) out += rnd();
        setDisplayed(out);
        setIsLocked(false);
        iter++;
        if (iter < word.length * 3) { timer = setTimeout(step, 28); }
        else { setDisplayed(''); timer = setTimeout(onDone, 180); }
      };
      step();
    };

    const cycle = () => {
      const word = scrambleWords[wIdx];
      reveal(word, () => hide(word, () => { wIdx = (wIdx + 1) % scrambleWords.length; cycle(); }));
    };

    timer = setTimeout(cycle, 600);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden lp-aurora-bg" dir={dir}>

      {/* Animated background mesh */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">

        {/* Large gradient orbs — drifting animation */}
        <div className="absolute -top-48 -right-48 w-[700px] h-[700px] rounded-full lp-orb-drift"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, rgba(139,92,246,0.10) 45%, transparent 70%)', animationDelay: '0s' }} />
        <div className="absolute top-1/3 -left-56 w-[600px] h-[600px] rounded-full lp-orb-drift-2"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(6,182,212,0.08) 45%, transparent 70%)', animationDelay: '-4s' }} />
        <div className="absolute -bottom-32 right-1/4 w-[500px] h-[500px] rounded-full lp-orb-drift"
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.16) 0%, rgba(99,102,241,0.08) 45%, transparent 70%)', animationDelay: '-8s' }} />
        <div className="absolute top-2/3 right-1/3 w-[350px] h-[350px] rounded-full lp-orb-drift-2"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)', animationDelay: '-2s' }} />

        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.28]"
          style={{
            backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 90% 70% at 50% 30%, black 40%, transparent 100%)',
          }} />

        {/* Floating tech cards — glassmorphism */}
        <div className="absolute top-[18%] right-[6%] hidden lg:block lp-float"
          style={{ animationDelay: '0s', animationDuration: '6s' }}>
          <div className="lp-glass rounded-2xl p-3.5 flex items-center gap-3 w-52 cursor-default">
            <div className="w-9 h-9 rounded-xl bg-emerald-100/80 flex items-center justify-center flex-shrink-0 shadow-sm">
              <TrendingUp size={16} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-medium">המרה חודשית</div>
              <div className="text-slate-900 font-black text-sm">+34% ↑</div>
            </div>
          </div>
        </div>

        <div className="absolute top-[38%] left-[4%] hidden lg:block lp-float"
          style={{ animationDelay: '1.5s', animationDuration: '7s' }}>
          <div className="lp-glass rounded-2xl p-3.5 flex items-center gap-3 w-56 cursor-default">
            <div className="w-9 h-9 rounded-xl bg-indigo-100/80 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Brain size={16} className="text-indigo-600" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-medium">AI ניתח ליד</div>
              <div className="text-slate-900 font-bold text-xs">פוטנציאל: <span className="text-indigo-600">גבוה מאוד</span></div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-[20%] right-[8%] hidden lg:block lp-float"
          style={{ animationDelay: '0.8s', animationDuration: '5.5s' }}>
          <div className="lp-glass rounded-2xl p-3.5 flex items-center gap-3 w-48 cursor-default">
            <div className="w-9 h-9 rounded-xl bg-amber-100/80 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Bell size={16} className="text-amber-600" />
            </div>
            <div>
              <div className="text-[11px] text-slate-400 font-medium">תזכורת חכמה</div>
              <div className="text-slate-800 font-bold text-xs">פולו-אפ ל-Acme</div>
            </div>
          </div>
        </div>

        {/* Extra floating card — bottom left */}
        <div className="absolute bottom-[32%] left-[7%] hidden xl:block lp-float"
          style={{ animationDelay: '2.2s', animationDuration: '8s' }}>
          <div className="lp-glass rounded-2xl p-3 flex items-center gap-2.5 w-44 cursor-default">
            <div className="w-8 h-8 rounded-xl bg-violet-100/80 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Zap size={13} className="text-violet-600 fill-violet-400" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-medium">פעולה אוטומטית</div>
              <div className="text-slate-800 font-bold text-[11px]">מייל נשלח ✓</div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative w-full max-w-7xl mx-auto px-5 sm:px-8 py-20 lg:py-28">
        <div className="max-w-4xl mx-auto text-center">

          {/* Badge */}
          <div className="lp-fade-up inline-flex items-center gap-2 mb-7 px-4 py-2 rounded-full border border-indigo-200/60 bg-white/60 backdrop-blur-sm text-indigo-700 text-xs font-bold tracking-wide shadow-sm"
            style={{ boxShadow: '0 2px 12px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.8)' }}>
            <Sparkles size={12} />
            סוכן מכירות ושיווק AI — ניהול לידים חכם לעסקים של ישראל
          </div>

          {/* H1 — Poppins + gradient */}
          <h1 className="lp-fade-up lp-delay-100 text-[clamp(2.6rem,7vw,5rem)] font-black leading-[1.07] tracking-[-0.04em] mb-6"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">סוכן מכירות ושיווק AI</span>
            <br />
            <span className="text-slate-500 font-black">שמנהל את ה</span><span
              className={isLocked ? 'lp-aurora-text' : ''}
              style={isLocked ? {} : { color: '#818cf8', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
              {displayed}
              <span className="inline-block align-middle ms-1"
                style={{ width: '3px', height: '0.85em', background: isLocked ? '#6366f1' : '#34d399', borderRadius: '2px', display: 'inline-block', animation: 'lp-blink 0.7s step-end infinite', boxShadow: isLocked ? '0 0 8px rgba(99,102,241,0.6)' : '0 0 8px rgba(52,211,153,0.8)' }} />
            </span>
            <br className="sm:hidden" />
            <span className="relative inline-block">
              <span className="relative z-10 lp-gradient-heading"> שלך.</span>
              <span className="absolute bottom-1 right-0 left-0 h-3 bg-indigo-100/70 rounded-full -z-0" />
            </span>
          </h1>

          {/* Subtitle */}
          <p className="lp-fade-up lp-delay-200 text-slate-500 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ fontFamily: "'Open Sans', sans-serif" }}>
            RAY הוא המערכת המלאה לניהול מכירות ושיווק — יוצר קמפיינים, מנהל לידים, שולח פולו-אפ אוטומטי ומדרג לפי AI. הכל ממקום אחד, 24/7.
          </p>

          {/* CTA */}
          <div className="lp-fade-up lp-delay-300 flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <button onClick={onSignUp}
              className="group lp-glow-btn w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base transition-all hover:-translate-y-1"
              style={{ fontFamily: "'Poppins', sans-serif" }}>
              <Rocket size={17} />
              התחל בחינם — 14 יום
              <ArrowLeft size={15} className="group-hover:-translate-x-1 transition-transform duration-200" />
            </button>
            <button onClick={onSignIn}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl border-2 border-slate-200/80 bg-white/70 backdrop-blur-sm hover:bg-white hover:border-indigo-200 text-slate-700 font-semibold text-base transition-all shadow-sm hover:-translate-y-0.5">
              <Play size={14} className="text-indigo-500" />
              {t('landing.nav.signIn')}
            </button>
          </div>

          {/* Trust badges */}
          <div className="lp-fade-up lp-delay-400 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-slate-400 text-xs font-medium">
            {[
              { icon: Shield, label: 'ללא כרטיס אשראי' },
              { icon: Lock, label: 'אבטחה ברמה ארגונית' },
              { icon: Cpu, label: 'AI מובנה' },
              { icon: Zap, label: 'התחלה תוך 2 דקות' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <Icon size={12} className="text-indigo-400" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard mockup */}
        <div className="lp-fade-up lp-delay-500 mt-20 relative max-w-5xl mx-auto">
          <div className="absolute -inset-6 rounded-3xl opacity-70 blur-2xl"
            style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.25) 0%, rgba(139,92,246,0.15) 40%, transparent 70%)' }} />
          <div className="relative rounded-2xl overflow-hidden"
            style={{ boxShadow: '0 32px 80px rgba(99,102,241,0.18), 0 8px 24px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.85)' }}>
            {/* Browser bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400/70" />
                <div className="w-3 h-3 rounded-full bg-amber-400/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-400/70" />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="bg-white border border-slate-200 rounded-lg px-4 py-1 text-slate-500 text-[11px] font-mono flex items-center gap-2 shadow-sm">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  app.ray-crm.com/my-agency
                </div>
              </div>
            </div>

            {/* App UI */}
            <div className="p-5 sm:p-6 bg-slate-50" dir="rtl">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-200">
                    <Zap size={14} className="text-white fill-white" />
                  </div>
                  <div>
                    <div className="text-slate-900 text-sm font-bold">לוח בקרה</div>
                    <div className="text-slate-400 text-[10px]">עדכון אחרון: לפני 3 דקות</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                    <Bell size={12} className="text-slate-500" />
                  </div>
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
                    <span className="text-indigo-700 text-[10px] font-black">RA</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'לידים חודש', value: '47', change: '+12%', color: '#6366f1', bg: '#eef2ff', changeBg: '#e0e7ff' },
                  { label: 'שווי פייפליין', value: '₪284K', change: '+8%', color: '#10b981', bg: '#ecfdf5', changeBg: '#d1fae5' },
                  { label: 'ציון AI', value: '73%', change: '+5%', color: '#8b5cf6', bg: '#f5f3ff', changeBg: '#ede9fe' },
                  { label: 'משימות פתוחות', value: '9', change: '-3', color: '#f59e0b', bg: '#fffbeb', changeBg: '#fef3c7' },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-bold px-1.5 py-0.5 rounded-lg" style={{ color: s.color, backgroundColor: s.changeBg }}>
                        {s.change}
                      </div>
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    </div>
                    <div className="text-lg font-black" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-slate-400 text-[10px] mt-0.5 font-medium">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Pipeline */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { status: 'ליד חדש', color: '#6366f1', leads: ['Acme Corp', 'MediaFlow', 'StartupX'] },
                  { status: 'בתהליך', color: '#f59e0b', leads: ['BrandHouse', 'ClickMedia'] },
                  { status: 'לקוח פעיל', color: '#10b981', leads: ['TopAgency', 'GrowthCo'] },
                ].map(col => (
                  <div key={col.status} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                      <span className="text-slate-600 text-[10px] font-bold">{col.status}</span>
                      <span className="text-slate-300 text-[9px] me-auto font-mono">{col.leads.length}</span>
                    </div>
                    <div className="space-y-2">
                      {col.leads.map(name => (
                        <div key={name} className="border border-slate-100 rounded-lg p-2 bg-slate-50">
                          <div className="text-slate-700 text-[10px] font-semibold">{name}</div>
                          <div className="h-[2px] bg-slate-200 rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ backgroundColor: col.color, width: `${55 + Math.floor(Math.random() * 35)}%`, opacity: 0.8 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Bottom fade */}
          <div className="absolute bottom-0 inset-x-0 h-24 pointer-events-none rounded-b-2xl"
            style={{ background: 'linear-gradient(to top, rgba(248,250,255,0.9), transparent)' }} />
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-300">
        <span className="text-[10px] font-medium tracking-widest uppercase">גלול</span>
        <ChevronDown size={16} className="animate-bounce" />
      </div>
    </section>
  );
}

/* ─── Stats Strip ───────────────────────────────────────────────────────────── */
function StatsStrip() {
  const { dir } = useLang();
  const [ref, inView] = useInView();

  const stats = [
    { value: 3, suffix: 'x', label: 'יותר עסקאות נסגרות', icon: TrendingUp, color: '#6366f1' },
    { value: 70, suffix: '%', label: 'חיסכון בזמן יצירת תוכן', icon: Zap, color: '#10b981' },
    { value: 98, suffix: '%', label: 'שביעות רצון משתמשים', icon: HeartHandshake, color: '#8b5cf6' },
    { value: 14, suffix: '', label: 'יום ניסיון חינמי', icon: Award, color: '#f59e0b' },
  ];

  return (
    <section ref={ref as React.RefObject<HTMLElement>} className="py-16 border-y" dir={dir}
      style={{ background: 'linear-gradient(135deg, #f8faff 0%, #faf5ff 50%, #f0fdf8 100%)' }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <div key={s.label}
              className={`lp-shimmer-hover relative text-center rounded-2xl p-6 transition-all duration-600 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 120}ms`, background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.9)', boxShadow: `0 4px 24px ${s.color}18` }}>
              <div className="relative inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 mx-auto"
                style={{ backgroundColor: `${s.color}15` }}>
                <s.icon size={22} style={{ color: s.color }} />
                <span className="absolute inset-0 rounded-2xl" style={{ animation: 'lp-ping 2s ease-out infinite', background: `${s.color}20`, animationDelay: `${i * 0.5}s` }} />
              </div>
              <div className="text-[2.6rem] font-black mb-1 tabular-nums" style={{ color: s.color, fontFamily: "'Poppins', sans-serif", lineHeight: 1 }}>
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <div className="text-sm font-semibold" style={{ color: '#475569' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Problem Section ───────────────────────────────────────────────────────── */
function ProblemSection() {
  const { dir } = useLang();
  const [ref, inView] = useInView();
  const [ref2, inView2] = useInView();

  const oldWayPains = [
    { icon: Clock, color: '#ef4444', title: 'Excel ו-Sheets — עדיין?', desc: 'מנהלים לידים בגיליונות, קמפיינים בקבצים, לקוחות בווטסאפ — ומאבדים את הראש.' },
    { icon: Repeat, color: '#f59e0b', title: 'שיווק בלי מדידה = בזבוז', desc: 'מוציאים תקציב על מודעות בלי לדעת מה מביא לקוחות. כל קמפיין הרגשה, לא נתונים.' },
    { icon: AlertTriangle, color: '#8b5cf6', title: 'לידים שנופלים בין הכסאות', desc: 'כשאין אוטומציה, לידים לא מקבלים מענה בזמן — ונסגרים אצל המתחרה.' },
  ];

  const aiRoles = [
    { icon: Brain, color: '#6366f1', title: 'אנליסט לידים AI', desc: 'מדרג כל ליד 0–100 ומזהה בדיוק היכן להשקיע זמן.', tag: 'Sales AI' },
    { icon: Sparkles, color: '#10b981', title: 'יוצר קמפיינים', desc: 'יוצר קמפיינים שלמים — תמונות, טקסט ופרסום — בדקות.', tag: 'Marketing AI' },
    { icon: MessageSquare, color: '#f59e0b', title: 'כותב תוכן שיווקי', desc: 'פוסטים, מיילים, הודעות WhatsApp ותסריטי וידאו מותאמים.', tag: 'Content AI' },
    { icon: BarChart2, color: '#ec4899', title: 'מנהל דוחות חי', desc: 'ROI, שיעור סגירה, ביצועי קמפיינים — הכל בזמן אמת.', tag: 'Analytics' },
    { icon: Target, color: '#06b6d4', title: 'יועץ אסטרטגי', desc: 'מזהה הזדמנויות ומציע פעולות ספציפיות לשיפור ביצועים.', tag: 'Strategy' },
    { icon: Zap, color: '#8b5cf6', title: 'מנהל אוטומציות', desc: 'ליד נכנס? מיד שולח ברכה, מקצה נציג ומתזמן פולו-אפ.', tag: 'Automation' },
  ];

  return (
    <section className="py-24" dir={dir} style={{ background: 'linear-gradient(180deg, #f8faff 0%, #f5f0ff 100%)' }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        {/* ── Header ── */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold tracking-wide">
            <AlertTriangle size={12} />
            הדרך הישנה כבר לא מספיקה
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">מכירות + שיווק בכלים נפרדים</span>
            <br />
            <span style={{ color: '#475569' }}>= כסף שנשפך לפח</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: '#475569', fontFamily: "'Open Sans', sans-serif" }}>
            כשהשיווק לא מדבר עם המכירות, לידים אובדים, תקציפ מתבזבז ולקוחות נסגרים אצל המתחרה.
          </p>
        </div>

        {/* ── Old Way Pains ── */}
        <div ref={ref as React.RefObject<HTMLElement>} className="grid md:grid-cols-3 gap-4 mb-12">
          {oldWayPains.map((p, i) => (
            <div key={p.title}
              className={`lp-shimmer-hover relative bg-white rounded-2xl p-6 transition-all duration-500 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 120}ms`, border: '1px solid rgba(239,68,68,0.15)', boxShadow: '0 4px 20px rgba(239,68,68,0.06)' }}>
              <div className="absolute top-4 left-4 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-400 border border-red-100">הדרך הישנה ✗</div>
              <div className="mt-6 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${p.color}12` }}>
                  <p.icon size={18} style={{ color: p.color }} />
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-1.5" style={{ color: '#1e1b4b' }}>{p.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>{p.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Transition badge ── */}
        <div className="relative text-center my-12">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-dashed border-indigo-200" />
          </div>
          <div className="relative inline-flex items-center gap-3 bg-white border-2 border-indigo-300 rounded-2xl px-6 py-3.5 shadow-xl shadow-indigo-100">
            <div className="relative w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Brain size={17} className="text-white" />
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" style={{ animation: 'lp-pulse-dot 1.5s ease-in-out infinite' }} />
            </div>
            <div className="text-right">
              <div className="text-xs font-black text-indigo-700 leading-none">RAY — פלטפורם המכירות והשיווק שלך</div>
              <div className="text-[10px] text-indigo-400 mt-0.5">עובד 24/7 · מכירות + שיווק · ממקום אחד</div>
            </div>
            <Sparkles size={14} className="text-indigo-400" />
          </div>
        </div>

        {/* ── AI Roles ── */}
        <div ref={ref2 as React.RefObject<HTMLElement>} className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-14">
          {aiRoles.map((r, i) => (
            <div key={r.title}
              className={`group lp-shimmer-hover bg-white rounded-2xl p-5 transition-all duration-500 cursor-default ${inView2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 80}ms`, border: '1px solid rgba(99,102,241,0.12)', boxShadow: '0 2px 12px rgba(99,102,241,0.06)' }}>
              <div className="flex items-start gap-3">
                <div className="relative w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: `${r.color}14`, border: `1px solid ${r.color}28` }}>
                  <r.icon size={19} style={{ color: r.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full tracking-wide"
                      style={{ background: `${r.color}12`, color: r.color }}>
                      {r.tag}
                    </span>
                    <h3 className="font-bold text-sm" style={{ color: '#1e1b4b' }}>{r.title}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-right" style={{ color: '#64748b' }}>{r.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <div className="inline-flex flex-col items-center gap-2" style={{ color: '#94a3b8' }}>
            <p className="text-sm font-medium">ראה את כל הפיצ׳רים</p>
            <div className="w-px h-10 bg-gradient-to-b from-indigo-300 to-transparent" />
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" style={{ animation: 'lp-pulse-dot 1.5s ease-in-out infinite' }} />
          </div>
        </div>

      </div>
    </section>
  );
}

/* ─── Features ──────────────────────────────────────────────────────────────── */
function Features() {
  const { dir } = useLang();
  const [ref, inView] = useInView();
  const [activeTab, setActiveTab] = useState<'sales' | 'marketing'>('sales');

  const salesFeatures = [
    { icon: GitBranch, color: '#6366f1', title: 'פייפליין Kanban חכם', desc: 'ראה כל ליד, כל שלב, בזמן אמת. גרור בין עמודות, עקוב אחר שווי, ותקבל תמונה מלאה של המכירות.', badge: 'Pipeline', highlight: ['Drag & Drop', 'שווי עסקאות', 'Kanban + List'] },
    { icon: Brain, color: '#8b5cf6', title: 'דירוג לידים AI', desc: 'הבינה המלאכותית מדרגת כל ליד 0–100 לפי פוטנציאל סגירה ומציעה בדיוק מה לעשות ומתי.', badge: 'AI Scoring', highlight: ['ציון 0–100', 'המלצות פעולה', 'תחזית סגירה'] },
    { icon: MessageSquare, color: '#10b981', title: 'פולו-אפ אוטומטי', desc: 'ה-AI כותב הודעות WhatsApp ומיילים מותאמים אישית לכל ליד — ושולח בזמן הנכון אוטומטית.', badge: 'Outreach', highlight: ['WhatsApp AI', 'Email Auto', 'מעקב פתיחות'] },
    { icon: Bell, color: '#f59e0b', title: 'משימות והתראות', desc: 'אף ליד לא יישכח. תזכורות חכמות, Overdue alerts, ומשימות אוטומטיות לכל שלב בפייפליין.', badge: 'Tasks', highlight: ['תזכורות', 'Overdue', 'אוטומציות'] },
    { icon: BarChart3, color: '#ec4899', title: 'אנליטיקת מכירות', desc: 'ROI לפי מקור ליד, Funnel analysis, שיעורי המרה — נתונים שמניעים החלטות, לא טבלאות.', badge: 'Analytics', highlight: ['ROI לפי מקור', 'Funnel', 'תחזית הכנסה'] },
    { icon: Users, color: '#3b82f6', title: 'ניהול צוות', desc: 'הקצה לידים לנציגים, עקוב אחר ביצועי כל אחד, נהל הרשאות — כולם מסונכרנים בזמן אמת.', badge: 'Team', highlight: ['הקצאה חכמה', 'ביצועים', 'הרשאות'] },
  ];

  const marketingFeatures = [
    { icon: Sparkles, color: '#6366f1', title: 'יוצר קמפיינים AI', desc: 'בנה קמפיין שלם — קהל יעד, תקציב, קריאייטיב ומסרים — בעזרת AI, בדקות ספורות.', badge: 'Campaigns', highlight: ['קמפיין AI', 'פייסבוק', 'Instagram'] },
    { icon: Brain, color: '#8b5cf6', title: 'סטודיו מדיה AI', desc: 'צור תמונות עם Dall-E ו-Imagen, סרטוני וידאו עם Veo, ואווטארים AI עם HeyGen — ישירות מהמערכת.', badge: 'Media Studio', highlight: ['Dall-E', 'Google Veo', 'HeyGen AI'] },
    { icon: MessageSquare, color: '#10b981', title: 'כתיבת תוכן שיווקי', desc: 'AI כותב פוסטים, מיילים, תסריטי וידאו, מודעות ופרסומות — מותאמים לקהל ולפלטפורמה.', badge: 'Content AI', highlight: ['פוסטים', 'מודעות', 'סקריפטים'] },
    { icon: Mail, color: '#f59e0b', title: 'Email ו-WhatsApp Marketing', desc: 'שלח קמפיינים ישירים לרשימת הלקוחות שלך — עם segmentation, אוטומציה ומעקב תוצאות.', badge: 'Direct', highlight: ['Segmentation', 'אוטומציה', 'מעקב קליקים'] },
    { icon: Target, color: '#ec4899', title: 'ניהול קהלים', desc: 'בנה קהלי יעד מדויקים, צור Lookalike Audiences והפעל retargeting מתוך המערכת.', badge: 'Audiences', highlight: ['Lookalike', 'Retargeting', 'Segmentation'] },
    { icon: BarChart2, color: '#06b6d4', title: 'מדדי שיווק ו-ROI', desc: 'ראה כמה כל קמפיין הביא, מאיזה מקור הגיעו הלידים הטובים ביותר — ומה הרוויח על כל ₪ שהוצאת.', badge: 'Marketing ROI', highlight: ['Cost per Lead', 'A/B Testing', 'Attribution'] },
  ];

  const features = activeTab === 'sales' ? salesFeatures : marketingFeatures;
  const tabColor = activeTab === 'sales' ? '#6366f1' : '#8b5cf6';

  return (
    <section id="features" className="py-28 lp-aurora-bg" dir={dir}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full border text-xs font-bold tracking-wide"
            style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)', color: '#6366f1' }}>
            <Layers size={12} />
            שני סוכנים · פלטפורמה אחת
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">כל מה שהעסק שלך צריך</span>
            <br />
            <span style={{ color: '#94a3b8' }}>במקום אחד.</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto leading-relaxed mb-10" style={{ color: '#475569', fontFamily: "'Open Sans', sans-serif" }}>
            סוכן המכירות וסוכן השיווק עובדים יחד — מכניסים לידים, מטפחים ומסגרים עסקאות, הכל אוטומטית.
          </p>

          {/* Tab switcher */}
          <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(99,102,241,0.15)', backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(99,102,241,0.1)' }}>
            {([
              { id: 'sales', label: 'סוכן המכירות', icon: Target, color: '#6366f1', bg: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
              { id: 'marketing', label: 'סוכן השיווק', icon: Sparkles, color: '#8b5cf6', bg: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-300"
                style={activeTab === tab.id
                  ? { background: tab.bg, color: '#fff', boxShadow: `0 6px 24px ${tab.color}40` }
                  : { color: '#64748b' }}>
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={ref as React.RefObject<HTMLElement>} className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 lp-tab-content" key={activeTab}>
          {features.map((f, i) => (
            <div key={f.title}
              className={`lp-feature-card lp-shimmer-hover rounded-2xl p-7 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transition: `opacity 0.5s ease ${i * 70}ms, transform 0.5s ease ${i * 70}ms` }}>
              <div className="flex items-start justify-between mb-5">
                <div className="lp-icon-wrap w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${f.color}14`, border: `1px solid ${f.color}25` }}>
                  <f.icon size={21} style={{ color: f.color }} />
                </div>
                <span className="text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-lg font-mono"
                  style={{ color: tabColor, backgroundColor: `${tabColor}10` }}>
                  {f.badge}
                </span>
              </div>
              <h3 className="font-bold text-[15px] mb-2.5 leading-snug" style={{ color: '#1e1b4b' }}>{f.title}</h3>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#475569' }}>{f.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {f.highlight.map(h => (
                  <span key={h} className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border"
                    style={{ background: `${tabColor}09`, color: tabColor, borderColor: `${tabColor}22` }}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── AI Section ────────────────────────────────────────────────────────────── */
function AISection({ onSignUp }: { onSignUp: () => void }) {
  const { dir } = useLang();
  const [ref, inView] = useInView();
  const [ref2, inView2] = useInView();

  const salesAI = [
    { icon: UserCheck, color: '#6366f1', title: 'דירוג לידים 0–100', desc: 'כל ליד מקבל ציון AI לפי נתונים, מקור ותגובות.' },
    { icon: PhoneCall, color: '#10b981', title: 'הכנה לשיחת מכירה', desc: 'RAY מסכם את הלקוח ומציע נקודות מפתח לפני כל שיחה.' },
    { icon: AlertTriangle, color: '#f59e0b', title: 'Smart Alerts', desc: 'התראה כשליד לא ענה יותר מדי זמן או כשיש פעולה קריטית.' },
    { icon: PieChart, color: '#ec4899', title: 'תחזית מכירות AI', desc: 'תחזית הכנסה לחודש הבא עם רמת ביטחון מבוססת נתונים.' },
  ];

  const marketingAI = [
    { icon: Sparkles, color: '#8b5cf6', title: 'יצירת קמפיינים AI', desc: 'בנה קמפיין שלם עם קהל, מסרים ותקציב — בדקות.' },
    { icon: Brain, color: '#06b6d4', title: 'סטודיו מדיה AI', desc: 'תמונות עם Dall-E, סרטונים עם Veo, אווטארים עם HeyGen.' },
    { icon: MessageSquare, color: '#10b981', title: 'כתיבת תוכן שיווקי', desc: 'פוסטים, מודעות, מיילים — AI כותב מותאם לקהל ולפלטפורמה.' },
    { icon: Workflow, color: '#6366f1', title: 'אוטומציות שיווק', desc: 'ליד נכנס? אוטומטית שולח ברכה, מייל ומקצה לנציג.' },
  ];

  return (
    <section className="py-28 overflow-hidden" dir={dir}
      style={{ background: 'linear-gradient(160deg, #faf5ff 0%, #f0f4ff 50%, #f5fffb 100%)' }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full border text-xs font-bold tracking-wide"
            style={{ background: 'rgba(139,92,246,0.08)', borderColor: 'rgba(139,92,246,0.25)', color: '#8b5cf6' }}>
            <Brain size={12} />
            AI מובנה בכל פעולה
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">שני סוכני AI</span>
            <br />
            <span style={{ color: '#475569' }}>שעובדים 24/7 בשבילך</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: '#475569', fontFamily: "'Open Sans', sans-serif" }}>
            RAY לא רק מנהל נתונים — הוא <strong>חושב</strong>. מנתח לידים, יוצר קמפיינים, כותב תוכן ומבצע פעולות — הכל אוטומטי.
          </p>
        </div>

        {/* Two agent panels */}
        <div ref={ref as React.RefObject<HTMLElement>} className="grid lg:grid-cols-2 gap-8 mb-16">

          {/* Sales Agent panel */}
          <div className={`lp-agent-card transition-all duration-700 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10'}`}
            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(99,102,241,0.03) 100%)', border: '1px solid rgba(99,102,241,0.2)', padding: '2rem' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}>
                <Target size={22} className="text-white" />
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" style={{ animation: 'lp-pulse-dot 1.5s ease-in-out infinite' }} />
              </div>
              <div>
                <div className="font-black text-base" style={{ color: '#1e1b4b' }}>סוכן המכירות</div>
                <div className="text-[11px] font-medium" style={{ color: '#6366f1' }}>Sales Agent · עובד 24/7</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {salesAI.map((f, i) => (
                <div key={f.title}
                  className={`lp-shimmer-hover bg-white rounded-xl p-4 transition-all duration-500 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                  style={{ transitionDelay: `${i * 80}ms`, border: `1px solid ${f.color}18`, boxShadow: `0 2px 12px ${f.color}10` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${f.color}14` }}>
                    <f.icon size={14} style={{ color: f.color }} />
                  </div>
                  <div className="font-bold text-[11px] mb-1" style={{ color: '#1e1b4b' }}>{f.title}</div>
                  <div className="text-[10px] leading-relaxed" style={{ color: '#64748b' }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Marketing Agent panel */}
          <div className={`lp-agent-card transition-all duration-700 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.03) 100%)', border: '1px solid rgba(139,92,246,0.2)', padding: '2rem', transitionDelay: '150ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', boxShadow: '0 8px 24px rgba(139,92,246,0.35)' }}>
                <Sparkles size={22} className="text-white" />
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" style={{ animation: 'lp-pulse-dot 1.5s ease-in-out infinite', animationDelay: '0.5s' }} />
              </div>
              <div>
                <div className="font-black text-base" style={{ color: '#1e1b4b' }}>סוכן השיווק</div>
                <div className="text-[11px] font-medium" style={{ color: '#8b5cf6' }}>Marketing Agent · AI Studio</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {marketingAI.map((f, i) => (
                <div key={f.title}
                  className={`lp-shimmer-hover bg-white rounded-xl p-4 transition-all duration-500 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                  style={{ transitionDelay: `${(i + 4) * 80}ms`, border: `1px solid ${f.color}18`, boxShadow: `0 2px 12px ${f.color}10` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${f.color}14` }}>
                    <f.icon size={14} style={{ color: f.color }} />
                  </div>
                  <div className="font-bold text-[11px] mb-1" style={{ color: '#1e1b4b' }}>{f.title}</div>
                  <div className="text-[10px] leading-relaxed" style={{ color: '#64748b' }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button onClick={onSignUp}
            className="group lp-glow-btn inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl text-white font-bold text-base transition-all hover:-translate-y-1"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 8px 32px rgba(99,102,241,0.4)', fontFamily: "'Poppins', sans-serif" }}>
            <Sparkles size={17} />
            נסה את שני הסוכנים בחינם
            <ArrowLeft size={15} className="group-hover:-translate-x-1 transition-transform duration-200" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Game Changer Section ──────────────────────────────────────────────────── */
function GameChanger() {
  const { dir } = useLang();
  const [ref, inView] = useInView();

  const points = [
    {
      num: '01',
      color: '#6366f1',
      title: 'לא מאחסן נתונים — פועל לפיהם',
      desc: 'כל CRM מאחסן מידע. RAY עושה איתו משהו. ציון ליד ירד? קיבלת הצעה למה לכתוב. ליד שקט 5 ימים? פולו-אפ אוטומטי. RAY מתרגם נתונים לפעולה — לפני שתספיק לשכוח.',
      icon: Zap,
      stat: '5 שניות',
      statLabel: 'מנתון לפעולה',
    },
    {
      num: '02',
      color: '#10b981',
      title: 'סוכן שלא ישן, לא שוכח, לא מפספס',
      desc: 'RAY עובד 24/7 בשבילך — עוקב אחרי לידים, שולח פולו-אפ בזמן הנכון, מזהה לידים חמים שמוכנים לסגירה. הצוות שלך מתמקד בשיחות. RAY מטפל בשאר.',
      icon: Brain,
      stat: '24/7',
      statLabel: 'עובד בשבילך',
    },
    {
      num: '03',
      color: '#8b5cf6',
      title: 'גדל בלי לגייס',
      desc: 'RAY מחליף עבודה ידנית של 2-3 עובדים: מיילים מותאמים אישית, תזכורות חכמות, דוחות אוטומטיים, ניהול פייפליין — הכל קורה לבד. 30% יותר תוצאות. אותו צוות.',
      icon: Rocket,
      stat: '+30%',
      statLabel: 'תוצאות בלי לגדול',
    },
  ];

  return (
    <section className="py-28 bg-white" dir={dir}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold tracking-wide">
            <Award size={12} />
            המהפכה
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">למה RAY משנה</span>
            <br />
            <span style={{ color: '#475569' }}>את חוקי המשחק</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: '#475569', fontFamily: "'Open Sans', sans-serif" }}>
            רוב המערכות מציגות נתונים ומחכות שתחליט מה לעשות. RAY מנתח, מציע ומבצע — הן במכירות, הן בשיווק.
          </p>
        </div>

        <div ref={ref as React.RefObject<HTMLElement>} className="grid md:grid-cols-3 gap-6">
          {points.map((p, i) => (
            <div key={p.num}
              className={`relative overflow-hidden rounded-3xl p-8 transition-all duration-600 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
              style={{
                background: `linear-gradient(135deg, ${p.color}08 0%, ${p.color}04 100%)`,
                border: `1px solid ${p.color}20`,
                transitionDelay: `${i * 150}ms`,
              }}>
              {/* Big number bg */}
              <div className="absolute top-4 start-4 text-[7rem] font-black leading-none select-none pointer-events-none"
                style={{ color: `${p.color}08` }}>
                {p.num}
              </div>

              <div className="relative">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
                    style={{ backgroundColor: p.color }}>
                    <p.icon size={22} className="text-white" />
                  </div>
                  <div className="text-end">
                    <div className="text-2xl font-black" style={{ color: p.color }}>{p.stat}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{p.statLabel}</div>
                  </div>
                </div>
                <h3 className="text-slate-900 font-black text-xl mb-3 leading-snug">{p.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="mt-16 overflow-hidden rounded-3xl shadow-xl" style={{ border: '1px solid rgba(99,102,241,0.15)' }}>
          <div className="grid grid-cols-3 text-center text-xs font-black uppercase tracking-widest"
            style={{ background: 'linear-gradient(135deg, #f8faff, #f5f0ff)' }}>
            <div className="p-5 border-b border-slate-200 text-slate-400">כלי מהדור הישן ✗</div>
            <div className="p-5 border-b border-x border-slate-200 text-slate-500">תחום</div>
            <div className="p-5 border-b border-slate-200 font-black" style={{ color: '#6366f1', background: 'rgba(99,102,241,0.06)' }}>⚡ RAY — שני סוכני AI</div>
          </div>
          {[
            ['Excel / גיליון', 'ניהול לידים', 'פייפליין Kanban + ציון AI לכל ליד'],
            ['פוסטים ידניים בפייסבוק', 'שיווק דיגיטלי', 'קמפיינים AI עם תמונות וסרטונים ב-2 דקות'],
            ['זיכרון / Post-it', 'פולו-אפ', 'פולו-אפ אוטומטי בזמן הנכון, בכל ערוץ'],
            ['ניחוש', 'תעדוף לידים', 'ציון 0–100 AI — מי קרוב לסגירה עכשיו'],
            ['Canva + קופירייטר', 'יצירת תוכן', 'AI כותב, מעצב ויוצר וידאו — הכל מהמערכת'],
            ['דוח ידני שאיש לא קורא', 'אנליטיקה', 'דשבורד חי: מכירות + ROI שיווק בזמן אמת'],
          ].map(([old, cat, ray], idx) => (
            <div key={cat} className={`lp-compare-row grid grid-cols-3 text-sm ${idx < 5 ? 'border-b border-slate-100' : ''}`}>
              <div className="p-4 text-center flex items-center justify-center gap-1.5" style={{ color: '#94a3b8' }}>
                <X size={11} className="text-red-400 flex-shrink-0" />
                <span>{old}</span>
              </div>
              <div className="p-4 text-center font-semibold border-x border-slate-100" style={{ color: '#64748b' }}>{cat}</div>
              <div className="p-4 text-center font-semibold flex items-center justify-center gap-1.5" style={{ color: '#4f46e5', background: 'rgba(99,102,241,0.04)' }}>
                <Check size={11} className="text-emerald-500 flex-shrink-0" />
                <span>{ray}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How It Works ──────────────────────────────────────────────────────────── */
function HowItWorks({ onSignUp }: { onSignUp: () => void }) {
  const { dir } = useLang();
  const [ref, inView] = useInView();

  const steps = [
    {
      num: '01',
      icon: Building2,
      color: '#6366f1',
      title: 'הגדרה תוך 5 דקות',
      desc: 'מגדירים את שלבי הפייפליין, מייבאים לידים קיימים ומחברים את הצוות. ה-AI מתחיל ללמוד מהרגע הראשון.',
      items: ['ייבוא Excel חכם', 'הגדרת Pipeline', 'חיבור הצוות'],
    },
    {
      num: '02',
      icon: Sparkles,
      color: '#8b5cf6',
      title: 'סוכן השיווק מניע לידים',
      desc: 'AI יוצר קמפיינים, תמונות וסרטונים — ומפרסם לקהל הנכון. לידים נכנסים אוטומטית לפייפליין שלך.',
      items: ['קמפיינים AI', 'מדיה ב-2 דקות', 'לידים אוטומטיים'],
    },
    {
      num: '03',
      icon: Target,
      color: '#10b981',
      title: 'סוכן המכירות סוגר',
      desc: 'כל ליד מדורג, מקבל פולו-אפ אוטומטי, ו-RAY מציע בדיוק מה לכתוב ומתי להתקשר — כדי שכל הזדמנות תיסגר.',
      items: ['דירוג AI', 'פולו-אפ אוטומטי', 'הצעות פעולה'],
    },
    {
      num: '04',
      icon: TrendingUp,
      color: '#f59e0b',
      title: 'גדלים בחכמה',
      desc: 'דשבורד אחד מראה ROI של שיווק + ביצועי מכירות. ראה מה עובד ותכפל.',
      items: ['ROI שיווק + מכירות', 'A/B Testing', 'תחזית הכנסה'],
    },
  ];

  return (
    <section id="how" className="py-28" dir={dir}
      style={{ background: 'linear-gradient(160deg, #f8faff 0%, #f5f7fa 100%)' }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold tracking-wide">
            <Rocket size={12} />
            מתחילים תוך דקות
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading">4 צעדים</span>
            <span style={{ color: '#475569' }}> — ואתה בתוך המערכת</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: '#475569', fontFamily: "'Open Sans', sans-serif" }}>
            ללא ידע טכני · ללא הגדרות מורכבות · ללא כרטיס אשראי
          </p>
        </div>

        <div ref={ref as React.RefObject<HTMLElement>} className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s, i) => (
            <div key={s.num}
              className={`relative bg-white border border-slate-200 rounded-3xl p-8 transition-all duration-500 hover:shadow-xl hover:border-slate-300 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 150}ms` }}>

              {/* Connector line between cards */}
              {i < 3 && (
                <div className="absolute top-14 -end-3 hidden lg:block z-10">
                  <div className="w-6 h-px" style={{ background: `linear-gradient(90deg, ${s.color}40, ${steps[i + 1].color}40)` }} />
                  <ChevronRight size={12} className="absolute -top-1.5 -end-2" style={{ color: s.color }} />
                </div>
              )}

              <div className="text-[5rem] font-black leading-none mb-4 select-none"
                style={{ color: `${s.color}15` }}>
                {s.num}
              </div>

              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 shadow-lg"
                style={{ backgroundColor: s.color }}>
                <s.icon size={22} className="text-white" />
              </div>

              <h3 className="text-slate-900 font-black text-xl mb-3 leading-snug">{s.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed mb-5">{s.desc}</p>

              <div className="space-y-2">
                {s.items.map(item => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${s.color}15` }}>
                      <Check size={9} style={{ color: s.color }} />
                    </div>
                    <span className="text-slate-600 text-xs font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button onClick={onSignUp}
            className="group inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base transition-all shadow-xl shadow-indigo-300/40 hover:shadow-2xl hover:-translate-y-0.5">
            <Rocket size={17} />
            התחל עכשיו — בחינם
            <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ───────────────────────────────────────────────────────────────── */
function Pricing({ onSignUp }: { onSignUp: () => void }) {
  const { dir } = useLang();
  const [ref, inView] = useInView();

  const plans = [
    {
      name: 'Basic',
      price: '89',
      period: 'חודש',
      desc: 'לעסקים קטנים שמתחילים לצמוח',
      highlight: false,
      badge: null,
      features: ['כל התכונות', 'עד 5 משתמשים', 'AI מלא לניהול לידים', 'משימות ותזכורות', 'תמיכה בסיסית', 'אחסון 5GB'],
    },
    {
      name: 'Pro',
      price: '179',
      period: 'חודש',
      desc: 'לעסקים שרוצים לצמוח',
      highlight: true,
      badge: 'הפופולרי ביותר',
      features: ['כל התכונות', 'עד 10 משתמשים', 'AI מלא + דירוג לידים', 'דוחות מתקדמים', 'אינטגרציות API', 'אחסון 10GB', 'תמיכה מועדפת'],
    },
    {
      name: 'Enterprise',
      price: '329',
      period: 'חודש',
      desc: 'לחברות וצוותים גדולים',
      highlight: false,
      badge: null,
      features: ['הכל ב-Pro', 'משתמשים ללא הגבלה', 'SLA מובטח', 'אחסון 100GB', 'מנהל חשבון ייעודי', 'התאמה מלאה'],
    },
  ];

  return (
    <section id="pricing" className="py-28 bg-white" dir={dir}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5 px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold tracking-wide">
            <Database size={12} />
            תמחור שקוף
          </div>
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-black text-slate-900 leading-tight tracking-tight mb-4">
            השקעה שמחזירה את עצמה
          </h2>
          <p className="text-slate-500 text-lg">עסק שסוגר עסקה אחת נוספת בחודש משלם את התוכנית שלו פי 10.</p>
        </div>

        <div ref={ref as React.RefObject<HTMLElement>}
          className="grid md:grid-cols-3 gap-5 items-stretch max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <div key={plan.name}
              className={`relative flex flex-col rounded-3xl p-7 transition-all duration-500 ${
                plan.highlight
                  ? 'bg-indigo-600 shadow-2xl shadow-indigo-300/40 scale-[1.02]'
                  : 'bg-white border border-slate-200 hover:shadow-lg hover:border-indigo-100'
              } ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 120}ms` }}>

              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-white text-indigo-700 text-[10px] font-black tracking-wide shadow-md border border-indigo-100 whitespace-nowrap">
                  ⭐ {plan.badge}
                </div>
              )}

              <div className="mb-6">
                <h3 className={`font-black text-lg mb-1 ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>{plan.name}</h3>
                <p className={`text-xs mb-5 ${plan.highlight ? 'text-indigo-200' : 'text-slate-400'}`}>{plan.desc}</p>
                <div className="flex items-baseline gap-1">
                  {plan.price !== 'חינם' && (
                    <span className={`text-base ${plan.highlight ? 'text-indigo-200' : 'text-slate-400'}`}>₪</span>
                  )}
                  <span className={`text-4xl font-black tracking-tight ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={`text-sm ${plan.highlight ? 'text-indigo-200' : 'text-slate-400'}`}>/{plan.period}</span>
                  )}
                </div>
              </div>

              <button onClick={onSignUp}
                className={`w-full py-3 rounded-2xl text-sm font-bold transition-all mb-7 ${
                  plan.highlight
                    ? 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-lg'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200'
                }`}>
                {plan.name === 'Enterprise' ? 'צור קשר' : 'התחל ניסיון חינם'}
              </button>

              <div className="space-y-3 flex-1">
                {plan.features.map(f => (
                  <div key={f} className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${plan.highlight ? 'bg-white/20' : 'bg-indigo-50'}`}>
                      <Check size={9} className={plan.highlight ? 'text-white' : 'text-indigo-600'} />
                    </div>
                    <span className={`text-sm ${plan.highlight ? 'text-indigo-100' : 'text-slate-600'}`}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-slate-400 text-sm mt-8">
          ✓ ניסיון חינם 14 יום · ✓ ללא כרטיס אשראי · ✓ ביטול בכל עת · ✓ מעבר בין תוכניות בקלות
        </p>
      </div>
    </section>
  );
}

/* ─── Testimonials / social proof ───────────────────────────────────────────── */
function Testimonials() {
  const { dir } = useLang();
  const [ref, inView] = useInView();

  const reviews = [
    { name: 'רן כהן', role: 'מנכ"ל סוכנות שיווק', text: 'מאז שעברנו ל-RAY, אנחנו סוגרים 40% יותר עסקאות. סוכן השיווק מביא לידים וסוכן המכירות סוגר — הכל אוטומטי.', stars: 5, tag: 'מכירות + שיווק', color: '#6366f1' },
    { name: 'מיכל לוי', role: 'יועצת עסקית', text: 'יצרתי קמפיין שלם — תמונה, טקסט ופרסום — תוך 3 דקות עם ה-AI. חסכתי שעות של עבודה ואלפי שקלים לאיש שיווק.', stars: 5, tag: 'סוכן השיווק', color: '#8b5cf6' },
    { name: 'אייל ברק', role: 'מנהל מכירות, SaaS', text: 'הדוחות של RAY גרמו לנו להבין שמפספסים את המקור הכי טוב. שינינו כיוון ועלינו 60% תוך חודש — בלי לגייס עובד חדש.', stars: 5, tag: 'אנליטיקה', color: '#10b981' },
  ];

  return (
    <section className="py-24" dir={dir} style={{ background: 'linear-gradient(180deg, #f8faff 0%, #fff 100%)' }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-0.5 mb-4">
            {[...Array(5)].map((_, i) => <Star key={i} size={20} className="text-amber-400 fill-amber-400" />)}
          </div>
          <h2 className="text-2xl font-black mb-2" style={{ color: '#1e1b4b', fontFamily: "'Poppins', sans-serif" }}>4.9/5 מ-200+ עסקים</h2>
          <p className="text-sm" style={{ color: '#64748b' }}>עסקים אמיתיים, תוצאות אמיתיות</p>
        </div>

        <div ref={ref as React.RefObject<HTMLElement>} className="grid md:grid-cols-3 gap-5">
          {reviews.map((r, i) => (
            <div key={r.name}
              className={`lp-shimmer-hover relative bg-white rounded-2xl p-7 transition-all duration-500 hover:-translate-y-2 hover:shadow-xl ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 120}ms`, border: `1px solid ${r.color}18`, boxShadow: `0 4px 20px ${r.color}10` }}>
              <span className="absolute top-5 start-5 text-[9px] font-black px-2.5 py-1 rounded-full"
                style={{ background: `${r.color}12`, color: r.color }}>
                {r.tag}
              </span>
              <div className="flex gap-0.5 mb-4 mt-6">
                {[...Array(r.stars)].map((_, j) => <Star key={j} size={13} className="text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#334155' }}>"{r.text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: `${r.color}15` }}>
                  <span className="text-xs font-black" style={{ color: r.color }}>{r.name[0]}</span>
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: '#1e1b4b' }}>{r.name}</div>
                  <div className="text-xs" style={{ color: '#94a3b8' }}>{r.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA Banner ────────────────────────────────────────────────────────────── */
function CTABanner({ onSignUp }: { onSignUp: () => void }) {
  const { dir } = useLang();
  return (
    <section className="py-24" dir={dir}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-3xl"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #6d28d9 50%, #4338ca 100%)' }}>

          {/* Background elements */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full opacity-20"
              style={{ background: 'radial-gradient(circle, #a5b4fc, transparent)' }} />
            <div className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full opacity-15"
              style={{ background: 'radial-gradient(circle, #c4b5fd, transparent)' }} />
            <div className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }} />
          </div>

          <div className="relative py-20 px-8 sm:px-20 text-center">
            <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-white/15 border border-white/20 text-white text-xs font-bold tracking-wide backdrop-blur-sm">
              <Sparkles size={12} />
              שיווק + מכירות · AI · במקום אחד
            </div>

            <h2 className="text-[clamp(2rem,5vw,3.5rem)] font-black text-white leading-tight tracking-tight mb-5"
              style={{ fontFamily: "'Poppins', sans-serif" }}>
              שיווק שמביא לידים.
              <br />מכירות שסוגרות.
              <br />
              <span className="text-indigo-200">כבר השבוע.</span>
            </h2>
            <p className="text-indigo-200 text-lg mb-10 max-w-lg mx-auto leading-relaxed">
              14 יום חינם. ללא כרטיס אשראי. ללא התחייבות. מתחילים תוך 2 דקות.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button onClick={onSignUp}
                className="group w-full sm:w-auto flex items-center justify-center gap-2.5 px-10 py-4 rounded-2xl bg-white hover:bg-indigo-50 text-indigo-700 font-black text-base transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5">
                <Rocket size={18} />
                התחל בחינם
                <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              </button>
              <div className="text-indigo-200 text-sm flex items-center gap-2">
                <Shield size={14} />
                אבטחה ברמה ארגונית · GDPR
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ────────────────────────────────────────────────────────────────── */
function Footer({ onSignIn, onSignUp }: LandingPageProps) {
  const { t, dir } = useLang();
  return (
    <footer className="bg-slate-900 py-16" dir={dir}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-900/50">
                <Zap size={14} className="text-white fill-white" />
              </div>
              <span className="text-white font-black text-lg tracking-tight">RAY CRM</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed mb-5">
              מערכת CRM חכמה לעסקים — מבוססת AI. ניהול לידים, פולו-אפ אוטומטי, סגירת עסקאות מהירה יותר.
            </p>
            <div className="flex gap-2">
              <button onClick={onSignIn}
                className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 px-3 py-1.5 rounded-lg transition-colors">
                התחברות
              </button>
              <button onClick={onSignUp}
                className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg transition-colors font-semibold">
                ניסיון חינמי
              </button>
            </div>
          </div>

          {[
            { title: 'מוצר', links: ['תכונות', 'תמחור', 'אבטחה', 'API'] },
            { title: 'חברה', links: ['אודות', 'בלוג', 'קריירה', 'יצירת קשר'] },
          ].map(col => (
            <div key={col.title}>
              <h4 className="text-slate-300 text-xs font-bold mb-4 tracking-widest uppercase">{col.title}</h4>
              <div className="space-y-2.5">
                {col.links.map(l => (
                  <a key={l} href="#" className="block text-slate-500 hover:text-slate-300 text-sm transition-colors">{l}</a>
                ))}
              </div>
            </div>
          ))}

          <div>
            <h4 className="text-slate-300 text-xs font-bold mb-4 tracking-widest uppercase">יצירת קשר</h4>
            <div className="space-y-2.5 mb-5">
              <a href="mailto:hello@ray-crm.com" className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm transition-colors">
                <Mail size={12} /> hello@ray-crm.com
              </a>
              <a href="#" className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm transition-colors">
                <Globe size={12} /> ray-crm.com
              </a>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-slate-600 text-xs">© 2025 RAY CRM. כל הזכויות שמורות.</p>
          <div className="flex items-center gap-5 text-slate-600 text-xs">
            <a href="#" className="hover:text-slate-400 transition-colors">פרטיות</a>
            <a href="#" className="hover:text-slate-400 transition-colors">תנאי שימוש</a>
            <div className="flex items-center gap-1.5 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              All systems operational
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── t helper shim (unused in landing but keep for compilation) ────────────── */
function useLandingT() {
  const ctx = useLang();
  return ctx.t;
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function LandingPage({ onSignIn, onSignUp, isLoggedIn, isSuperAdmin, workspaceSlug }: LandingPageProps) {
  const { dir } = useLang();
  const t = useLandingT();

  return (
    <div className="min-h-screen bg-white" dir={dir}>
      <Navbar onSignIn={onSignIn} onSignUp={onSignUp} isLoggedIn={isLoggedIn} isSuperAdmin={isSuperAdmin} workspaceSlug={workspaceSlug} />
      <Hero onSignUp={onSignUp} onSignIn={onSignIn} />
      <StatsStrip />
      <ProblemSection />
      <Features />
      <AISection onSignUp={onSignUp} />
      <GameChanger />
      <HowItWorks onSignUp={onSignUp} />
      <Testimonials />
      <Pricing onSignUp={onSignUp} />
      <CTABanner onSignUp={onSignUp} />
      <Footer onSignIn={onSignIn} onSignUp={onSignUp} />
    </div>
  );
}
