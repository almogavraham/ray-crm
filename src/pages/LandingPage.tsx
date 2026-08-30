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
import { useScrollParallax } from '../hooks/useScrollParallax';
import { useScrollReveal } from '../hooks/useScrollReveal';

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
  isLoggedIn?: boolean;
  isSuperAdmin?: boolean;
  workspaceSlug?: string;
}

/* ─── Parallax background orbs — drop into any section marked data-parallax ──── */
const ORB_PALETTES: Record<string, [string, string]> = {
  indigo:  ['rgba(99,102,241,0.20)',  'rgba(139,92,246,0.12)'],
  violet:  ['rgba(168,85,247,0.18)',  'rgba(99,102,241,0.10)'],
  emerald: ['rgba(16,185,129,0.16)',  'rgba(6,182,212,0.10)'],
  amber:   ['rgba(245,158,11,0.16)',  'rgba(249,115,22,0.09)'],
  cyan:    ['rgba(6,182,212,0.16)',   'rgba(99,102,241,0.09)'],
};
import ContactSection from '../components/ContactSection';
import CookieBanner from '../components/CookieBanner';
import AccessibilityWidget from '../components/AccessibilityWidget';

function ParallaxOrbs({ variant = 'indigo' }: { variant?: keyof typeof ORB_PALETTES }) {
  const [c1, c2] = ORB_PALETTES[variant];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div data-depth="-90" data-scale="0.35" className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full"
        style={{ background: `radial-gradient(circle, ${c1} 0%, transparent 70%)` }} />
      <div data-depth="66" data-scale="-0.2" className="absolute -bottom-20 -left-20 w-[360px] h-[360px] rounded-full"
        style={{ background: `radial-gradient(circle, ${c2} 0%, transparent 70%)` }} />
      <div data-depth="-48" className="absolute top-1/2 left-1/3 w-[220px] h-[220px] rounded-full opacity-60"
        style={{ background: `radial-gradient(circle, ${c1} 0%, transparent 65%)` }} />
    </div>
  );
}

/* ─── Reveal — bidirectional "arrives on scroll" wrapper ───────────────────────
 * Drop-in replacement for the old one-shot useInView+className pattern: plays
 * its entrance every time it crosses into view, scrolling down OR back up
 * (unlike a fade-once-and-stay reveal). `from` picks which edge it flies in
 * from — use 'left'/'right' to make two things arrive from opposite sides.
 * ──────────────────────────────────────────────────────────────────────────── */
type RevealDir = 'up' | 'down' | 'left' | 'right' | 'scale';
const REVEAL_HIDDEN: Record<RevealDir, string> = {
  up:    'translateY(64px) scale(0.96)',
  down:  'translateY(-64px) scale(0.96)',
  left:  'translateX(-84px) scale(0.97)',
  right: 'translateX(84px) scale(0.97)',
  scale: 'scale(0.82)',
};
function Reveal({ children, from = 'up', delay = 0, duration = 750, className = '', style, revealedTransform = 'translate(0,0) scale(1)' }: {
  children: React.ReactNode; from?: RevealDir; delay?: number; duration?: number;
  className?: string; style?: React.CSSProperties; revealedTransform?: string;
}) {
  const [ref, inView] = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={className}
      style={{
        ...style,
        opacity: inView ? 1 : 0,
        transform: inView ? revealedTransform : REVEAL_HIDDEN[from],
        transition: `opacity ${duration}ms cubic-bezier(.16,1,.3,1) ${delay}ms, transform ${duration}ms cubic-bezier(.16,1,.3,1) ${delay}ms`,
        willChange: 'transform, opacity',
      }}>
      {children}
    </div>
  );
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
    { label: 'יצירת קשר', href: '#contact' },
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

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden lp-aurora-bg" dir={dir} data-parallax="on">

      {/* Animated background mesh */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">

        {/* Large gradient orbs — ambient drift (inner) + scroll parallax (outer) */}
        <div data-depth="-70" data-scale="0.3" className="absolute -top-48 -right-48 w-[700px] h-[700px]">
          <div className="w-full h-full rounded-full lp-orb-drift"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, rgba(139,92,246,0.10) 45%, transparent 70%)', animationDelay: '0s' }} />
        </div>
        <div data-depth="56" className="absolute top-1/3 -left-56 w-[600px] h-[600px]">
          <div className="w-full h-full rounded-full lp-orb-drift-2"
            style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(6,182,212,0.08) 45%, transparent 70%)', animationDelay: '-4s' }} />
        </div>
        <div data-depth="-48" data-scale="-0.25" className="absolute -bottom-32 right-1/4 w-[500px] h-[500px]">
          <div className="w-full h-full rounded-full lp-orb-drift"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.16) 0%, rgba(99,102,241,0.08) 45%, transparent 70%)', animationDelay: '-8s' }} />
        </div>
        <div data-depth="38" className="absolute top-2/3 right-1/3 w-[350px] h-[350px]">
          <div className="w-full h-full rounded-full lp-orb-drift-2"
            style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)', animationDelay: '-2s' }} />
        </div>

        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.28]"
          style={{
            backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 90% 70% at 50% 30%, black 40%, transparent 100%)',
          }} />

        {/* Animated tech line-grid */}
        <div className="lp-tech-grid absolute inset-0 opacity-[0.5]"
          style={{ maskImage: 'radial-gradient(ellipse 80% 60% at 50% 35%, black 30%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 35%, black 30%, transparent 100%)' }} />

        {/* Sweeping light beams */}
        <div className="lp-beam-sweep absolute top-[22%] -left-1/3 w-2/3 h-24 rounded-full" style={{ animationDelay: '0s' }} />
        <div className="lp-beam-sweep absolute top-[58%] -left-1/3 w-2/3 h-16 rounded-full" style={{ animationDelay: '3.5s' }} />

        {/* Horizontal scanline */}
        <div className="lp-scanline absolute left-0 right-0 h-px" style={{ top: '0%' }} />

        {/* Floating tech cards — glassmorphism. Outer div = scroll parallax depth,
            inner div = ambient idle float — nested transforms compose cleanly. */}
        <div data-depth="-115" data-rotate="-3" className="absolute top-[18%] right-[6%] hidden lg:block">
          <div className="lp-float" style={{ animationDelay: '0s', animationDuration: '6s' }}>
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
        </div>

        <div data-depth="90" data-rotate="4" className="absolute top-[38%] left-[4%] hidden lg:block">
          <div className="lp-float" style={{ animationDelay: '1.5s', animationDuration: '7s' }}>
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
        </div>

        <div data-depth="-80" data-rotate="-3.5" className="absolute bottom-[20%] right-[8%] hidden lg:block">
          <div className="lp-float" style={{ animationDelay: '0.8s', animationDuration: '5.5s' }}>
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
        </div>

        {/* Extra floating card — bottom left */}
        <div data-depth="100" data-rotate="5" className="absolute bottom-[32%] left-[7%] hidden xl:block">
          <div className="lp-float" style={{ animationDelay: '2.2s', animationDuration: '8s' }}>
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
      </div>

      <div className="relative w-full max-w-7xl mx-auto px-5 sm:px-8 py-20 lg:py-28">
        <div className="max-w-4xl mx-auto text-center">

          {/* Badge */}
          <div className="lp-fade-up inline-flex items-center gap-2 mb-7 px-4 py-2 rounded-full border border-indigo-200/60 bg-white/60 backdrop-blur-sm text-indigo-700 text-xs font-bold tracking-wide shadow-sm"
            style={{ boxShadow: '0 2px 12px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.8)' }}>
            <Sparkles size={12} />
            סוכן מכירות ושיווק AI — ניהול לידים חכם לעסקים של ישראל
          </div>

          {/* H1 — Poppins + gradient, static (no rotating words) */}
          <h1 className="lp-fade-up lp-delay-100 text-[clamp(2.6rem,7vw,5rem)] font-black leading-[1.07] tracking-[-0.04em] mb-6"
            style={{ fontFamily: "'Poppins', sans-serif" }}>
            <span className="lp-gradient-heading" style={{ textShadow: '0 0 30px rgba(99,102,241,0.25)' }}>
              סוכן מכירות ושיווק AI
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

  const stats = [
    { value: 3, suffix: 'x', label: 'יותר עסקאות נסגרות', icon: TrendingUp, color: '#6366f1' },
    { value: 70, suffix: '%', label: 'חיסכון בזמן יצירת תוכן', icon: Zap, color: '#10b981' },
    { value: 98, suffix: '%', label: 'שביעות רצון משתמשים', icon: HeartHandshake, color: '#8b5cf6' },
    { value: 14, suffix: '', label: 'יום ניסיון חינמי', icon: Award, color: '#f59e0b' },
  ];

  return (
    <section className="relative py-16 border-y" dir={dir} data-parallax="on"
      style={{ background: 'linear-gradient(135deg, #f8faff 0%, #faf5ff 50%, #f0fdf8 100%)' }}>
      <ParallaxOrbs variant="violet" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <Reveal key={s.label} from={i % 2 === 0 ? 'left' : 'right'} delay={i * 90}
              className="lp-shimmer-hover relative text-center rounded-2xl p-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.9)', boxShadow: `0 4px 24px ${s.color}18` }}>
              <div className="relative inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 mx-auto"
                style={{ backgroundColor: `${s.color}15` }}>
                <s.icon size={22} style={{ color: s.color }} />
                <span className="absolute inset-0 rounded-2xl" style={{ animation: 'lp-ping 2s ease-out infinite', background: `${s.color}20`, animationDelay: `${i * 0.5}s` }} />
              </div>
              <div className="text-[2.6rem] font-black mb-1 tabular-nums" style={{ color: s.color, fontFamily: "'Poppins', sans-serif", lineHeight: 1 }}>
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <div className="text-sm font-semibold" style={{ color: '#475569' }}>{s.label}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── AI Section ────────────────────────────────────────────────────────────── */
function AISection({ onSignUp }: { onSignUp: () => void }) {
  const { dir } = useLang();

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
    <section className="relative py-28 overflow-hidden" dir={dir} data-parallax="on"
      style={{ background: 'linear-gradient(160deg, #faf5ff 0%, #f0f4ff 50%, #f5fffb 100%)' }}>
      <ParallaxOrbs variant="violet" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">

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

        {/* Two agent panels — converge toward each other from opposite sides */}
        <div className="grid lg:grid-cols-2 gap-8 mb-16">

          {/* Sales Agent panel */}
          <Reveal from="right" duration={700}
            className="lp-agent-card"
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
                <Reveal key={f.title} from="up" delay={i * 80} duration={500}
                  className="lp-shimmer-hover bg-white rounded-xl p-4"
                  style={{ border: `1px solid ${f.color}18`, boxShadow: `0 2px 12px ${f.color}10` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${f.color}14` }}>
                    <f.icon size={14} style={{ color: f.color }} />
                  </div>
                  <div className="font-bold text-[11px] mb-1" style={{ color: '#1e1b4b' }}>{f.title}</div>
                  <div className="text-[10px] leading-relaxed" style={{ color: '#64748b' }}>{f.desc}</div>
                </Reveal>
              ))}
            </div>
          </Reveal>

          {/* Marketing Agent panel */}
          <Reveal from="left" duration={700} delay={100}
            className="lp-agent-card"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.03) 100%)', border: '1px solid rgba(139,92,246,0.2)', padding: '2rem' }}>
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
                <Reveal key={f.title} from="up" delay={i * 80} duration={500}
                  className="lp-shimmer-hover bg-white rounded-xl p-4"
                  style={{ border: `1px solid ${f.color}18`, boxShadow: `0 2px 12px ${f.color}10` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${f.color}14` }}>
                    <f.icon size={14} style={{ color: f.color }} />
                  </div>
                  <div className="font-bold text-[11px] mb-1" style={{ color: '#1e1b4b' }}>{f.title}</div>
                  <div className="text-[10px] leading-relaxed" style={{ color: '#64748b' }}>{f.desc}</div>
                </Reveal>
              ))}
            </div>
          </Reveal>
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
    <section className="relative py-28 bg-white overflow-hidden" dir={dir} data-parallax="on">
      <ParallaxOrbs variant="emerald" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">

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

        <div className="grid md:grid-cols-3 gap-6">
          {points.map((p, i) => (
            <Reveal key={p.num} from={i === 0 ? 'right' : i === 2 ? 'left' : 'up'} delay={i * 130} duration={650}
              className="relative overflow-hidden rounded-3xl p-8"
              style={{ background: `linear-gradient(135deg, ${p.color}08 0%, ${p.color}04 100%)`, border: `1px solid ${p.color}20` }}>
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
            </Reveal>
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
    <section id="how" className="relative py-28 overflow-hidden" dir={dir} data-parallax="on"
      style={{ background: 'linear-gradient(160deg, #f8faff 0%, #f5f7fa 100%)' }}>
      <ParallaxOrbs variant="amber" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">

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

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s, i) => (
            <Reveal key={s.num} from="up" delay={i * 140} duration={600}
              className="relative bg-white border border-slate-200 rounded-3xl p-8 transition-shadow hover:shadow-xl hover:border-slate-300">

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
            </Reveal>
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
    <section id="pricing" className="relative py-28 bg-white overflow-hidden" dir={dir} data-parallax="on">
      <ParallaxOrbs variant="indigo" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">

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

        <div className="grid md:grid-cols-3 gap-5 items-stretch max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} from={i === 0 ? 'right' : i === 2 ? 'left' : 'up'} delay={i * 120} duration={600}
              revealedTransform={plan.highlight ? 'translate(0,0) scale(1.02)' : 'translate(0,0) scale(1)'}
              className={`relative flex flex-col rounded-3xl p-7 transition-shadow ${
                plan.highlight
                  ? 'bg-indigo-600 shadow-2xl shadow-indigo-300/40'
                  : 'bg-white border border-slate-200 hover:shadow-lg hover:border-indigo-100'
              }`}>

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
            </Reveal>
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

  const reviews = [
    { name: 'רן כהן', role: 'מנכ"ל סוכנות שיווק', text: 'מאז שעברנו ל-RAY, אנחנו סוגרים 40% יותר עסקאות. סוכן השיווק מביא לידים וסוכן המכירות סוגר — הכל אוטומטי.', stars: 5, tag: 'מכירות + שיווק', color: '#6366f1' },
    { name: 'מיכל לוי', role: 'יועצת עסקית', text: 'יצרתי קמפיין שלם — תמונה, טקסט ופרסום — תוך 3 דקות עם ה-AI. חסכתי שעות של עבודה ואלפי שקלים לאיש שיווק.', stars: 5, tag: 'סוכן השיווק', color: '#8b5cf6' },
    { name: 'אייל ברק', role: 'מנהל מכירות, SaaS', text: 'הדוחות של RAY גרמו לנו להבין שמפספסים את המקור הכי טוב. שינינו כיוון ועלינו 60% תוך חודש — בלי לגייס עובד חדש.', stars: 5, tag: 'אנליטיקה', color: '#10b981' },
  ];

  return (
    <section className="relative py-24 overflow-hidden" dir={dir} data-parallax="on" style={{ background: 'linear-gradient(180deg, #f8faff 0%, #fff 100%)' }}>
      <ParallaxOrbs variant="cyan" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-0.5 mb-4">
            {[...Array(5)].map((_, i) => <Star key={i} size={20} className="text-amber-400 fill-amber-400" />)}
          </div>
          <h2 className="text-2xl font-black mb-2" style={{ color: '#1e1b4b', fontFamily: "'Poppins', sans-serif" }}>4.9/5 מ-200+ עסקים</h2>
          <p className="text-sm" style={{ color: '#64748b' }}>עסקים אמיתיים, תוצאות אמיתיות</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {reviews.map((r, i) => (
            <Reveal key={r.name} from={i === 0 ? 'right' : i === 2 ? 'left' : 'up'} delay={i * 120} duration={600}
              className="lp-shimmer-hover relative bg-white rounded-2xl p-7 hover:shadow-xl transition-shadow"
              style={{ border: `1px solid ${r.color}18`, boxShadow: `0 4px 20px ${r.color}10` }}>
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
            </Reveal>
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
    <section className="relative py-24" dir={dir} data-parallax="on">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-3xl"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #6d28d9 50%, #4338ca 100%)' }}>

          {/* Background elements */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div data-depth="-72" data-scale="0.3" className="absolute -top-20 -right-20 w-96 h-96 rounded-full opacity-20"
              style={{ background: 'radial-gradient(circle, #a5b4fc, transparent)' }} />
            <div data-depth="56" className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full opacity-15"
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
          <p className="text-slate-600 text-xs">© 2026 RAY CRM. כל הזכויות שמורות.</p>
          <div className="flex items-center gap-5 text-slate-600 text-xs">
            <a href="/privacy" className="hover:text-slate-400 transition-colors">מדיניות פרטיות</a>
            <a href="/terms" className="hover:text-slate-400 transition-colors">תנאי שימוש</a>
            <a href="/accessibility" className="hover:text-slate-400 transition-colors">הצהרת נגישות</a>
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
  useScrollParallax();
  const { dir } = useLang();
  const t = useLandingT();

  return (
    <div className="min-h-screen bg-white" dir={dir}>
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-[80]
                   focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold">
        דלג לתוכן הראשי
      </a>
      <Navbar onSignIn={onSignIn} onSignUp={onSignUp} isLoggedIn={isLoggedIn} isSuperAdmin={isSuperAdmin} workspaceSlug={workspaceSlug} />
      <main id="main-content">
      <Hero onSignUp={onSignUp} onSignIn={onSignIn} />
      <StatsStrip />
      <AISection onSignUp={onSignUp} />
      <GameChanger />
      <HowItWorks onSignUp={onSignUp} />
      <Testimonials />
      <Pricing onSignUp={onSignUp} />
      <CTABanner onSignUp={onSignUp} />
      <ContactSection />
      </main>
      <Footer onSignIn={onSignIn} onSignUp={onSignUp} />
      <CookieBanner />
      <AccessibilityWidget />
    </div>
  );
}
