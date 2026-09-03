import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Users, GitBranch, Briefcase, CheckSquare,
  Layers, BarChart3, Sparkles, Settings, CreditCard, Clapperboard,
  Plus, Menu, X, ChevronLeft, ChevronRight, Bell, Zap, LogOut, Bot, Shield,
  Clock, AlertTriangle, Search, Globe, Gem, Network, PlugZap, Mail, Megaphone,
  PanelRightClose, PanelRightOpen, CheckCircle2, Info, HelpCircle, Target, Workflow,
} from 'lucide-react';
import type { Page, WorkspaceProfile } from '../types';
import type { AppNotification } from '../lib/notifications';
import { useLang } from '../contexts/LangContext';
import { formatBalance, balancePercent, formatTokenDisplay } from '../lib/tokenTracker';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

/* ── Announcement type (mirrors AdminPanel's Announcement interface) ──────── */
interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning';
  target: 'all' | 'trial' | 'active';
  active: boolean;
}

interface LayoutProps {
  children: React.ReactNode;
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onNewLead: () => void;
  onRefresh?: () => void;
  overdueBadge?: number;
  tokenLowAlert?: boolean;
  userInitials?: string;
  userName?: string;
  allowedPages?: Page[];
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  onSignOut?: () => void;
  logoUrl?: string;
  workspaceName?: string;
  workspace?: WorkspaceProfile;
  theme?: 'dark' | 'light';
  onAiClick?: () => void;
  showAiPanel?: boolean;
  aiInsightBadge?: number;
  wakeWordEnabled?: boolean;
  onToggleWakeWord?: () => void;
  onStartTour?: () => void;
  notifications?: AppNotification[];
  onNotificationClick?: (n: AppNotification) => void;
}

/* ── NAV GROUPS (reorganized logically) ──────────────────────────────────── */
const NAV_GROUPS = [
  {
    label: 'ניהול לידים',
    labelKey: 'nav.groupClients',
    items: [
      { page: 'home'      as Page, label: 'לוח בקרה',      labelKey: 'nav.home',      icon: LayoutDashboard },
      { page: 'dashboard' as Page, label: 'לידים',          labelKey: 'nav.dashboard', icon: Users           },
      // Only present when the workspace split its pipeline in two; it is
      // gated through allowedPages like every other optional screen.
      { page: 'opportunities' as Page, label: 'הזדמנויות מכירה', labelKey: 'nav.opportunities', icon: Target },
      { page: 'kanban'    as Page, label: 'פייפליין',       labelKey: 'nav.kanban',    icon: GitBranch       },
      { page: 'deals'     as Page, label: 'לקוחות פעילים',  labelKey: 'nav.deals',     icon: Briefcase       },
      { page: 'tasks'     as Page, label: 'משימות',         labelKey: 'nav.tasks',     icon: CheckSquare, badge: true },
    ],
  },
  {
    label: 'שיווק',
    labelKey: 'nav.groupMarketing',
    items: [
      { page: 'marketing-agent'  as Page, label: 'RAY MARKETING',    labelKey: 'nav.marketingAgent', icon: Megaphone },
      { page: 'analytics'        as Page, label: 'אנליטיקס',      labelKey: 'nav.analytics',      icon: BarChart3 },
      { page: 'overview'         as Page, label: 'דוחות',          labelKey: 'nav.overview',       icon: BarChart3 },
    ],
  },
  {
    label: 'כלים AI',
    labelKey: 'nav.groupTools',
    items: [
      { page: 'ai'           as Page, label: 'עוזר AI',           labelKey: 'nav.ai',           icon: Sparkles     },
      { page: 'ai-studio'    as Page, label: 'AI Studio',         labelKey: 'nav.aiStudio',     icon: Clapperboard },
      { page: 'email-agent'  as Page, label: 'RAY SALES',   labelKey: 'nav.emailAgent',   icon: Mail         },
      { page: 'agents'       as Page, label: 'סוכנים AI',         labelKey: 'nav.agents',       icon: Bot          },
      // The automation studio had no nav entry at all — the page existed but
      // only ever redirected, so nothing could reach it.
      { page: 'workflows'    as Page, label: 'בונה אוטומציות',   labelKey: 'nav.workflows',    icon: Workflow     },
    ],
  },
  {
    label: 'הגדרות',
    labelKey: 'nav.groupSettings',
    items: [
      { page: 'settings'     as Page, label: 'הגדרות',      labelKey: 'nav.settings',     icon: Settings   },
      { page: 'billing'      as Page, label: 'מנוי ותשלום', labelKey: 'nav.billing',     icon: CreditCard },
    ],
  },
];

const SUPER_ADMIN_GROUP = {
  label: 'מערכת',
  labelKey: 'nav.groupSystem',
  items: [{ page: 'admin' as Page, label: 'לוח אדמין', labelKey: 'nav.admin', icon: Shield }],
};

/* ── Theme tokens ────────────────────────────────────────────────────────── */
function useThemeTokens(isDark: boolean) {
  return {
    sidebarBg:       isDark ? '#0a0f1e'                    : '#ffffff',
    sidebarBorder:   isDark ? 'rgba(255,255,255,0.07)'     : '#e5e9f0',
    logoTitle:       isDark ? 'rgba(255,255,255,0.92)'     : '#0f172a',
    logoSub:         isDark ? 'rgba(255,255,255,0.35)'     : '#94a3b8',
    groupLabel:      isDark ? 'rgba(255,255,255,0.22)'     : '#cbd5e1',
    navText:         isDark ? 'rgba(255,255,255,0.55)'     : '#64748b',
    navHoverBg:      isDark ? 'rgba(255,255,255,0.06)'     : '#f1f5f9',
    navHoverText:    isDark ? 'rgba(255,255,255,0.9)'      : '#334155',
    navActiveBg:     isDark ? 'rgba(99,102,241,0.18)'      : '#eef2ff',
    navActiveText:   isDark ? '#a5b4fc'                    : '#4f46e5',
    navActiveBorder: isDark ? '#6366f1'                    : '#6366f1',
    footerBg:        isDark ? 'rgba(255,255,255,0.04)'     : '#f8fafc',
    footerBorder:    isDark ? 'rgba(255,255,255,0.07)'     : '#e5e9f0',
    footerName:      isDark ? 'rgba(255,255,255,0.85)'     : '#1e293b',
    footerRole:      isDark ? 'rgba(255,255,255,0.35)'     : '#94a3b8',
    tokenBg:         isDark ? 'rgba(16,185,129,0.1)'       : '#f0fdf4',
    tokenBorder:     isDark ? 'rgba(16,185,129,0.25)'      : '#bbf7d0',
    tokenHoverBg:    isDark ? 'rgba(16,185,129,0.15)'      : '#dcfce7',
    tokenTrackBg:    isDark ? 'rgba(16,185,129,0.15)'      : '#d1fae5',
    versionText:     isDark ? 'rgba(255,255,255,0.18)'     : '#cbd5e1',
    // header
    headerBg:        isDark ? 'rgba(10,15,30,0.92)'        : 'rgba(255,255,255,0.92)',
    headerBorder:    isDark ? 'rgba(255,255,255,0.07)'     : '#e5e9f0',
    breadcrumbMain:  isDark ? 'rgba(255,255,255,0.85)'     : '#1e293b',
    breadcrumbSub:   isDark ? 'rgba(255,255,255,0.35)'     : '#94a3b8',
    searchBg:        isDark ? 'rgba(255,255,255,0.06)'     : '#f8fafc',
    searchBorder:    isDark ? 'rgba(255,255,255,0.1)'      : '#e2e8f0',
    searchText:      isDark ? 'rgba(255,255,255,0.35)'     : '#94a3b8',
    kbdBg:           isDark ? 'rgba(255,255,255,0.08)'     : '#f1f5f9',
    kbdBorder:       isDark ? 'rgba(255,255,255,0.12)'     : '#e2e8f0',
    kbdText:         isDark ? 'rgba(255,255,255,0.4)'      : '#64748b',
    collapseBtn:     isDark ? 'rgba(255,255,255,0.07)'     : '#f1f5f9',
    collapseBtnBorder: isDark ? 'rgba(255,255,255,0.12)'   : '#e2e8f0',
    collapseBtnText: isDark ? 'rgba(255,255,255,0.45)'     : '#64748b',
    pageContentBg:   isDark ? '#0a0f1e'                    : '#f5f7fa',
  };
}

/* ── Sidebar inner ───────────────────────────────────────────────────────── */
interface SidebarProps {
  filteredGroups: typeof NAV_GROUPS;
  currentPage: Page;
  onGo: (p: Page) => void;
  onNewLead: () => void;
  overdueBadge: number;
  logoUrl?: string;
  workspaceName?: string;
  userInitials: string;
  userName: string;
  isAdmin: boolean;
  onSignOut?: () => void;
  workspace?: WorkspaceProfile;
  isDark: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function SidebarInner({
  filteredGroups, currentPage, onGo, onNewLead,
  overdueBadge, logoUrl, workspaceName, userInitials, userName, isAdmin, onSignOut,
  workspace, isDark, collapsed, onToggleCollapse,
}: SidebarProps) {
  const { t, lang, setLang } = useLang();
  const tk = useThemeTokens(isDark);

  return (
    <div className="flex flex-col h-full">

      {/* Logo area */}
      <div
        className="px-3 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${tk.sidebarBorder}` }}
      >
        {/* Logo row + collapse toggle */}
        <div className={`flex items-center mb-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {/* Logo */}
          <div className={`flex items-center gap-2 min-w-0 ${collapsed ? '' : 'flex-1'}`}>
            {logoUrl ? (
              <img
                src={logoUrl} alt="logo"
                className="w-7 h-7 rounded-lg object-contain flex-shrink-0"
                style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', padding: '2px' }}
              />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-[0_2px_8px_rgba(99,102,241,0.35)]">
                <Zap size={13} className="text-white fill-white" />
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-bold text-[14px] leading-tight tracking-[-0.02em] truncate"
                  style={{ color: tk.logoTitle }}>
                  {workspaceName ?? 'RAY'}
                </p>
                <p className="text-[9px] font-medium tracking-widest uppercase"
                  style={{ color: tk.logoSub }}>
                  CRM Platform
                </p>
              </div>
            )}
          </div>

          {/* Collapse toggle button */}
          <button
            onClick={onToggleCollapse}
            className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
            style={{ background: tk.collapseBtn, border: `1px solid ${tk.collapseBtnBorder}`, color: tk.collapseBtnText }}
            title={collapsed ? 'הרחב תפריט' : 'כווץ תפריט'}
            onMouseEnter={e => {
              e.currentTarget.style.color = tk.navActiveText;
              e.currentTarget.style.background = tk.navActiveBg;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = tk.collapseBtnText;
              e.currentTarget.style.background = tk.collapseBtn;
            }}
          >
            {collapsed
              ? <PanelRightOpen size={12} />
              : <PanelRightClose size={12} />
            }
          </button>
        </div>

        {/* New Lead button */}
        {collapsed ? (
          <button
            onClick={onNewLead}
            className="w-full flex items-center justify-center text-white py-2 rounded-lg transition-all"
            style={{ backgroundColor: '#4f46e5', boxShadow: '0 2px 8px rgba(79,70,229,0.3)' }}
            title="ליד חדש"
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#4338ca')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#4f46e5')}
          >
            <Plus size={14} />
          </button>
        ) : (
          <button
            onClick={onNewLead}
            data-tour="new-lead"
            className="w-full flex items-center justify-center gap-2 text-white text-xs font-semibold py-2.5 rounded-lg transition-all group"
            style={{ backgroundColor: '#4f46e5', boxShadow: '0 2px 8px rgba(79,70,229,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#4338ca')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#4f46e5')}
          >
            <Plus size={13} className="group-hover:rotate-90 transition-transform duration-200" />
            {t('nav.newLead')}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto py-2 scrollbar-hide ${collapsed ? 'px-1.5' : 'px-2'}`}>
        {filteredGroups.map(group => (
          <div key={group.label} className="mb-1">
            {!collapsed && (
              <p
                className="text-[9px] font-bold uppercase tracking-widest px-3 pt-3 pb-1 select-none"
                style={{ color: tk.groupLabel }}
              >
                {t((group as typeof NAV_GROUPS[0]).labelKey ?? group.label)}
              </p>
            )}
            {collapsed && <div className="pt-2 pb-0.5 px-1"><div style={{ borderTop: `1px solid ${tk.sidebarBorder}` }} /></div>}
            {group.items.map(({ page, label, icon: Icon, badge, ...rest }) => {
              const labelKey = (rest as { labelKey?: string }).labelKey;
              const active = currentPage === page;
              return (
                <button
                  key={page}
                  data-tour={`nav-${page}`}
                  onClick={() => onGo(page)}
                  className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 relative mb-0.5 ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2'
                  }`}
                  style={active ? {
                    backgroundColor: tk.navActiveBg,
                    color: tk.navActiveText,
                    borderLeft: collapsed ? 'none' : `2px solid ${tk.navActiveBorder}`,
                    borderBottom: collapsed ? `2px solid ${tk.navActiveBorder}` : 'none',
                    boxShadow: collapsed && isDark ? `0 0 8px rgba(99,102,241,0.3)` : 'none',
                  } : {
                    color: tk.navText,
                    borderLeft: collapsed ? 'none' : '2px solid transparent',
                  }}
                  title={collapsed ? (labelKey ? t(labelKey) : label) : undefined}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = tk.navHoverBg;
                      e.currentTarget.style.color = tk.navHoverText;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = tk.navText;
                    }
                  }}
                >
                  <div className="relative flex-shrink-0">
                    <Icon size={collapsed ? 16 : 14} />
                    {badge && overdueBadge > 0 && collapsed && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5">
                        {overdueBadge > 9 ? '9+' : overdueBadge}
                      </span>
                    )}
                  </div>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-right text-[13px]">{labelKey ? t(labelKey) : label}</span>
                      {badge && overdueBadge > 0 && (
                        <span className="bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                          {overdueBadge > 9 ? '9+' : overdueBadge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Token balance mini-bar */}
      {!collapsed && workspace && workspace.tokenBalance !== undefined && (
        <div className="px-3 pb-2">
          <button
            onClick={() => onGo('billing')}
            className="w-full rounded-xl p-2.5 text-right transition-all hover:scale-[1.01]"
            style={{ backgroundColor: tk.tokenBg, border: `1px solid ${tk.tokenBorder}` }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = tk.tokenHoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = tk.tokenBg; }}
          >
            {(() => {
              const bal  = workspace.tokenBalance ?? 0;
              const alloc = workspace.tokenPlanAllocation ?? 0;
              const pct  = balancePercent(bal, alloc);
              const isEmpty = bal <= 0.000001;
              const isLow   = !isEmpty && pct < 20;
              const barColor = isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#10b981';
              return (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold" style={{ color: barColor }}>
                      {isEmpty ? '⚠️' : isLow ? '⚡' : '💎'}
                    </span>
                    <div className="flex items-center gap-1">
                      <Gem size={9} style={{ color: barColor }} />
                      <div className="text-right">
                        <span className="text-[11px] font-black block" style={{ color: barColor }}>
                          {formatTokenDisplay(bal)}
                        </span>
                        <span className="text-[9px] font-medium block" style={{ color: barColor, opacity: 0.7 }}>
                          {formatBalance(bal)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: tk.tokenTrackBg }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${alloc > 0 ? pct : 100}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <p className="text-[9px] mt-1 text-right" style={{ color: tk.footerRole }}>
                    {isEmpty ? 'טוקנים נגמרו — לחץ לרכישה' : isLow ? 'טוקנים עומדים להיגמר' : 'יתרת טוקנים AI'}
                  </p>
                </>
              );
            })()}
          </button>
        </div>
      )}

      {/* Collapsed: token dot indicator */}
      {collapsed && workspace && workspace.tokenBalance !== undefined && (() => {
        const bal  = workspace.tokenBalance ?? 0;
        const alloc = workspace.tokenPlanAllocation ?? 0;
        const pct  = balancePercent(bal, alloc);
        const isEmpty = bal <= 0.000001;
        const isLow   = !isEmpty && pct < 20;
        const barColor = isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#10b981';
        return (
          <div className="px-1.5 pb-2">
            <button
              onClick={() => onGo('billing')}
              className="w-full flex items-center justify-center py-2 rounded-lg transition-all"
              style={{ background: `${barColor}18`, border: `1px solid ${barColor}33` }}
              title={isEmpty ? 'טוקנים נגמרו' : isLow ? 'טוקנים עומדים להיגמר' : 'יתרת טוקנים AI'}
            >
              <Gem size={13} style={{ color: barColor }} />
            </button>
          </div>
        );
      })()}

      {/* User footer */}
      <div className="p-2 flex-shrink-0" style={{ borderTop: `1px solid ${tk.footerBorder}` }}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}
              title={userName}
            >
              {userInitials}
            </div>
            <button
              onClick={() => onSignOut?.()}
              className="p-1 rounded-lg transition-colors"
              style={{ color: tk.footerRole }}
              title="התנתק"
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2'; }}
              onMouseLeave={e => { e.currentTarget.style.color = tk.footerRole; e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <LogOut size={12} />
            </button>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-default"
              style={{ backgroundColor: tk.footerBg }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}
              >
                {userInitials}
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[13px] font-semibold truncate" style={{ color: tk.footerName }}>{userName}</p>
                <p className="text-[10px]" style={{ color: tk.footerRole }}>{isAdmin ? t('nav.manager') : t('nav.agent')}</p>
              </div>
              {/* Language toggle */}
              <button
                onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
                className="p-1 rounded-lg transition-colors flex items-center gap-0.5 text-[10px] font-bold"
                style={{ color: tk.footerRole }}
                onMouseEnter={e => { e.currentTarget.style.color = tk.navActiveText; e.currentTarget.style.backgroundColor = tk.navActiveBg; }}
                onMouseLeave={e => { e.currentTarget.style.color = tk.footerRole; e.currentTarget.style.backgroundColor = 'transparent'; }}
                title={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
              >
                <Globe size={11} />
                {lang === 'he' ? 'EN' : 'עב'}
              </button>
              <button
                onClick={() => onSignOut?.()}
                className="p-1 rounded-lg transition-colors"
                style={{ color: tk.footerRole }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2'; }}
                onMouseLeave={e => { e.currentTarget.style.color = tk.footerRole; e.currentTarget.style.backgroundColor = 'transparent'; }}
                title="התנתק"
              >
                <LogOut size={13} />
              </button>
            </div>

            <div className="mt-1.5 flex justify-center">
              <span className="text-[9px] tracking-widest font-mono" style={{ color: tk.versionText }}>
                RAY v2.0 · POWERED BY AI
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Bell Dropdown ───────────────────────────────────────────────────────── */
function BellDropdown({ overdueBadge, tokenLowAlert, notifications = [], onNotificationClick, onNavigateTasks, onNavigateBilling, isDark }: {
  overdueBadge: number;
  tokenLowAlert?: boolean;
  notifications?: AppNotification[];
  onNotificationClick?: (n: AppNotification) => void;
  onNavigateTasks: () => void;
  onNavigateBilling: () => void;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tk = useThemeTokens(isDark);

  // Pure task count (excluding token alert which is counted in overdueBadge total)
  const taskCount  = tokenLowAlert ? Math.max(0, overdueBadge - 1) : overdueBadge;
  const unreadNotifs = notifications.filter(n => !n.read).length;
  const totalCount = overdueBadge + unreadNotifs; // overdueBadge already includes tokenLowAlert +1

  // Bell color: red for tasks, amber for token only
  const bellColor = taskCount > 0 ? '#ef4444' : tokenLowAlert ? '#f59e0b' : undefined;
  const badgeBg   = taskCount > 0 ? '#ef4444' : '#f59e0b';

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-all"
        style={open
          ? { backgroundColor: tk.navActiveBg, color: tk.navActiveText, border: `1px solid ${tk.navActiveBorder}33` }
          : { backgroundColor: tk.searchBg, color: tk.searchText, border: `1px solid ${tk.searchBorder}` }
        }
        title="התראות"
      >
        <Bell size={14} style={bellColor ? { color: bellColor } : undefined} />
        {totalCount > 0 && (
          <span
            className="absolute -top-1 -right-1 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-0.5 ring-1 ring-white"
            style={{ backgroundColor: badgeBg }}
          >
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-76 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.2)] z-50 overflow-hidden"
          dir="rtl"
          style={{ backgroundColor: isDark ? '#111827' : '#ffffff', border: `1px solid ${tk.sidebarBorder}`, width: '300px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${tk.sidebarBorder}` }}>
            <button onClick={() => setOpen(false)} style={{ color: tk.footerRole }} className="transition-colors hover:opacity-80">
              <X size={13} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: tk.footerName }}>התראות</span>
              <Bell size={12} style={{ color: tk.footerRole }} />
            </div>
          </div>

          {totalCount === 0 ? (
            /* Empty state */
            <div className="px-4 py-8 text-center">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#f0fdf4', border: '1px solid rgba(16,185,129,0.3)' }}>
                <Bell size={16} className="text-emerald-500" />
              </div>
              <p className="text-sm font-semibold" style={{ color: tk.footerName }}>אין התראות פעילות</p>
              <p className="text-xs mt-1" style={{ color: tk.footerRole }}>הכל תקין ✓</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {/* Notifications (autopilot approvals, publishes, digests, …) */}
              {notifications.map(n => (
                <button key={n.id}
                  onClick={() => { setOpen(false); onNotificationClick?.(n); }}
                  className="w-full px-4 py-3 flex items-start gap-2.5 text-right transition-colors hover:opacity-90"
                  style={{ borderBottom: `1px solid ${tk.sidebarBorder}`, background: n.read ? 'transparent' : (isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)') }}>
                  {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: '#6366f1' }} />}
                  <div className={`flex-1 min-w-0 ${n.read ? 'pr-4' : ''}`}>
                    <p className="text-sm font-semibold truncate" style={{ color: tk.footerName }}>{n.title}</p>
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: tk.footerRole }}>{n.body}</p>
                    <p className="text-[10px] mt-1" style={{ color: tk.footerRole }}>
                      {(() => { const m = Math.floor((Date.now() - n.createdAt) / 60000); if (m < 1) return 'עכשיו'; if (m < 60) return `לפני ${m} דק'`; const h = Math.floor(m / 60); if (h < 24) return `לפני ${h} שע'`; return `לפני ${Math.floor(h / 24)} ימים`; })()}
                    </p>
                  </div>
                </button>
              ))}

              {/* Token low alert */}
              {tokenLowAlert && (
                <div>
                  <div className="px-4 py-3 flex items-start gap-3 text-right"
                    style={{ backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : '#fffbeb', borderBottom: `1px solid ${isDark ? 'rgba(245,158,11,0.2)' : '#fde68a'}` }}>
                    <Zap size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-500">טוקני AI עומדים להיגמר</p>
                      <p className="text-xs text-amber-400 mt-0.5">היתרה שלך נמוכה — רכוש טוקנים לפני שייגמרו</p>
                    </div>
                  </div>
                  <div className="px-4 py-2.5" style={{ borderBottom: taskCount > 0 ? `1px solid ${tk.sidebarBorder}` : undefined }}>
                    <button
                      onClick={() => { setOpen(false); onNavigateBilling(); }}
                      className="w-full text-sm font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                      style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white' }}
                    >
                      <Zap size={13} />
                      רכוש טוקנים עכשיו
                    </button>
                  </div>
                </div>
              )}

              {/* Overdue tasks alert */}
              {taskCount > 0 && (
                <div>
                  <div className="px-4 py-3 flex items-start gap-3 text-right"
                    style={{ backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : '#fff5f5', borderBottom: `1px solid ${isDark ? 'rgba(239,68,68,0.2)' : '#fecaca'}` }}>
                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-500">
                        {taskCount} משימ{taskCount === 1 ? 'ה' : 'ות'} באיחור
                      </p>
                      <p className="text-xs text-red-400 mt-0.5">מועד הסיום עבר</p>
                    </div>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-2 text-right" style={{ borderBottom: `1px solid ${tk.sidebarBorder}` }}>
                    <Clock size={12} style={{ color: tk.footerRole }} className="flex-shrink-0" />
                    <p className="text-xs" style={{ color: tk.navText }}>
                      עבור ל<span className="font-semibold mx-1" style={{ color: tk.footerName }}>משימות</span>לסגירה
                    </p>
                  </div>
                  <div className="px-4 py-3">
                    <button
                      onClick={() => { setOpen(false); onNavigateTasks(); }}
                      className="w-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckSquare size={13} />
                      פתח רשימת משימות
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Mobile Bottom Nav ───────────────────────────────────────────────────── */
// All candidate items in priority order — filtered by allowedPages
const MOBILE_NAV_CANDIDATES: { page: Page; labelKey: string; icon: React.ElementType; badge?: boolean }[] = [
  { page: 'home'      as Page, labelKey: 'nav.home',      icon: LayoutDashboard },
  { page: 'dashboard' as Page, labelKey: 'nav.dashboard', icon: Users           },
  { page: 'kanban'    as Page, labelKey: 'nav.kanban',    icon: GitBranch       },
  { page: 'tasks'     as Page, labelKey: 'nav.tasks',     icon: CheckSquare, badge: true },
  { page: 'deals'     as Page, labelKey: 'nav.deals',     icon: Briefcase       },
  { page: 'analytics' as Page, labelKey: 'nav.analytics', icon: BarChart3       },
  { page: 'agents'    as Page, labelKey: 'nav.agents',    icon: Bot             },
  { page: 'settings'  as Page, labelKey: 'nav.settings',  icon: Settings        },
];

function MobileBottomNav({ currentPage, go, overdueBadge, isDark, allowedPages, onAiClick, showAiPanel }: {
  currentPage: Page;
  go: (p: Page) => void;
  overdueBadge: number;
  isDark: boolean;
  allowedPages: Page[];
  onAiClick?: () => void;
  showAiPanel?: boolean;
}) {
  const { t } = useLang();
  const tk = useThemeTokens(isDark);

  // Filter candidates by allowedPages (if allowedPages is empty, show all)
  const filtered = allowedPages.length === 0
    ? MOBILE_NAV_CANDIDATES
    : MOBILE_NAV_CANDIDATES.filter(i => allowedPages.includes(i.page));

  // Show up to 4 page items + 1 AI button = 5 total
  const pageItems = filtered.slice(0, onAiClick ? 4 : 5);

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around px-1 py-1"
      style={{
        backgroundColor: tk.sidebarBg,
        borderTop: `1px solid ${tk.sidebarBorder}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {pageItems.map(item => {
        const active = currentPage === item.page;
        return (
          <button
            key={item.page}
            onClick={() => go(item.page)}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all"
            style={{ color: active ? tk.navActiveText : tk.navText }}
          >
            <div className="relative">
              <item.icon size={20} />
              {item.badge && overdueBadge > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold min-w-[14px] h-3.5 rounded-full flex items-center justify-center px-0.5">
                  {overdueBadge > 9 ? '9+' : overdueBadge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{t(item.labelKey)}</span>
          </button>
        );
      })}

      {/* AI button — always shown as last item */}
      {onAiClick && (
        <button
          onClick={onAiClick}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all"
          style={{ color: showAiPanel ? tk.navActiveText : tk.navText }}
        >
          <Sparkles size={20} />
          <span className="text-[10px] font-medium">{t('nav.ai')}</span>
        </button>
      )}
    </div>
  );
}

/* ── Layout ──────────────────────────────────────────────────────────────── */
export default function Layout({
  children, currentPage, onPageChange, onNewLead,
  overdueBadge = 0, tokenLowAlert = false, userInitials = 'A', userName = 'משתמש',
  allowedPages = [], isAdmin = false, isSuperAdmin = false,
  onSignOut, logoUrl, workspaceName, workspace, theme = 'dark',
  onAiClick, showAiPanel = false, aiInsightBadge = 0, wakeWordEnabled = false, onToggleWakeWord,
  onStartTour, notifications = [], onNotificationClick,
}: LayoutProps) {
  const { t, dir } = useLang();
  const [open, setOpen]           = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');

  /* ── Active announcements from Firestore ──────────────────────────────── */
  const [announcements,        setAnnouncements]        = useState<AnnouncementItem[]>([]);
  const [dismissedAnnIds,      setDismissedAnnIds]      = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ray-dismissed-anns') ?? '[]') as string[]; }
    catch { return []; }
  });

  useEffect(() => {
    if (!workspace) return;
    getDocs(query(collection(db, 'announcements'), where('active', '==', true)))
      .then(snap => {
        const all = snap.docs.map(d => d.data() as AnnouncementItem);
        const filtered = all.filter(a => {
          if (a.target === 'all')    return true;
          if (a.target === 'trial')  return workspace.status === 'trial';
          if (a.target === 'active') return workspace.status === 'active';
          return false;
        });
        setAnnouncements(filtered);
      })
      .catch(() => {});
  }, [workspace?.id, workspace?.status]); // eslint-disable-line

  const dismissAnn = (id: string) => {
    const next = [...dismissedAnnIds, id];
    setDismissedAnnIds(next);
    try { localStorage.setItem('ray-dismissed-anns', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const visibleAnns = announcements.filter(a => !dismissedAnnIds.includes(a.id));

  const isDark = theme !== 'light';
  const tk     = useThemeTokens(isDark);

  const toggleCollapse = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const go = (p: Page) => { onPageChange(p); setOpen(false); };

  const baseGroups = allowedPages.length === 0
    ? NAV_GROUPS
    : NAV_GROUPS.map(group => ({
        ...group,
        items: group.items.filter(({ page }) => allowedPages.includes(page)),
      })).filter(g => g.items.length > 0);

  const filteredGroups = isSuperAdmin ? [...baseGroups, SUPER_ADMIN_GROUP] : baseGroups;

  const currentLabel = [...NAV_GROUPS, SUPER_ADMIN_GROUP]
    .flatMap(g => g.items)
    .find(i => i.page === currentPage)?.label ?? currentPage;

  const sidebarProps: SidebarProps = {
    filteredGroups, currentPage, onGo: go,
    onNewLead: () => { onNewLead(); setOpen(false); },
    overdueBadge, logoUrl, workspaceName,
    userInitials, userName, isAdmin, onSignOut, workspace,
    isDark, collapsed, onToggleCollapse: toggleCollapse,
  };

  const sidebarW = collapsed ? 'w-14' : 'w-[220px]';
  const mainMr   = collapsed ? 'md:mr-14' : 'md:mr-[220px]';

  return (
    <div className="min-h-screen flex" dir={dir} style={{ backgroundColor: tk.pageContentBg }}>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <aside
        className={`hidden md:flex ${sidebarW} flex-col fixed right-0 top-0 h-full z-30 transition-all duration-200`}
        style={{ backgroundColor: tk.sidebarBg, borderLeft: `1px solid ${tk.sidebarBorder}` }}
      >
        <div className="relative z-10 flex flex-col h-full">
          <SidebarInner {...sidebarProps} />
        </div>
      </aside>

      {/* ── Mobile Overlay ──────────────────────────────────────────────── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex" dir="rtl">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside
            className="relative w-[220px] h-full mr-auto z-50 flex flex-col"
            style={{ backgroundColor: tk.sidebarBg, borderLeft: `1px solid ${tk.sidebarBorder}` }}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 left-4 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: tk.collapseBtn, border: `1px solid ${tk.collapseBtnBorder}`, color: tk.collapseBtnText }}
            >
              <X size={13} />
            </button>
            <SidebarInner {...sidebarProps} collapsed={false} />
          </aside>
        </div>
      )}

      {/* ── Mobile Top Bar ──────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 flex items-center px-4 justify-between"
        style={{
          backgroundColor: isDark ? 'rgba(10,15,30,0.95)' : 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${tk.sidebarBorder}`,
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ backgroundColor: tk.collapseBtn, border: `1px solid ${tk.collapseBtnBorder}`, color: tk.collapseBtnText }}
        >
          <Menu size={15} />
        </button>
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="w-6 h-6 rounded-lg object-contain" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9', padding: '1px' }} />
          ) : (
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
              <Zap size={11} className="text-white fill-white" />
            </div>
          )}
          <span className="font-bold text-sm tracking-tight" style={{ color: tk.logoTitle }}>{workspaceName ?? 'RAY'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onNewLead}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
            style={{ backgroundColor: '#4f46e5' }}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => onSignOut?.()}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ backgroundColor: tk.collapseBtn, border: `1px solid ${tk.collapseBtnBorder}`, color: tk.footerRole }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* ── Mobile Bottom Navigation ────────────────────────────────────── */}
      <MobileBottomNav
        currentPage={currentPage}
        go={go}
        overdueBadge={overdueBadge}
        isDark={isDark}
        allowedPages={allowedPages}
        onAiClick={onAiClick}
        showAiPanel={showAiPanel}
      />

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className={`flex-1 min-w-0 ${mainMr} min-h-screen relative z-10 transition-all duration-200`}>
        <div className="pt-12 md:pt-0">

          {/* Desktop Header */}
          <div
            className="hidden md:flex items-center justify-between px-6 py-3 sticky top-0 z-20"
            style={{
              backgroundColor: tk.headerBg,
              backdropFilter: 'blur(16px)',
              borderBottom: `1px solid ${tk.headerBorder}`,
            }}
          >
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5">
              <ChevronLeft size={12} style={{ color: tk.breadcrumbSub }} />
              <span className="text-[11px] font-medium" style={{ color: tk.breadcrumbSub }}>RAY</span>
              <ChevronLeft size={10} style={{ color: tk.breadcrumbSub }} />
              <span className="text-[13px] font-semibold" style={{ color: tk.breadcrumbMain }}>{currentLabel}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">

              {/* Product tour trigger */}
              {onStartTour && (
                <button
                  onClick={onStartTour}
                  data-tour="help-button"
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ backgroundColor: tk.collapseBtn, border: `1px solid ${tk.collapseBtnBorder}`, color: tk.collapseBtnText }}
                  title="סיור במערכת"
                  onMouseEnter={e => { e.currentTarget.style.color = tk.navActiveText; e.currentTarget.style.background = tk.navActiveBg; }}
                  onMouseLeave={e => { e.currentTarget.style.color = tk.collapseBtnText; e.currentTarget.style.background = tk.collapseBtn; }}
                >
                  <HelpCircle size={15} />
                </button>
              )}

              <BellDropdown
                overdueBadge={overdueBadge}
                tokenLowAlert={tokenLowAlert}
                notifications={notifications}
                onNotificationClick={onNotificationClick}
                onNavigateTasks={() => onPageChange('tasks')}
                onNavigateBilling={() => onPageChange('billing')}
                isDark={isDark}
              />

              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold cursor-default"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}
              >
                {userInitials}
              </div>
            </div>
          </div>

          {/* System message banner */}
          {workspace?.systemMessage && (
            <div
              className="flex items-center gap-2 px-4 md:px-6 py-2.5 text-sm font-medium"
              style={{
                backgroundColor: isDark ? 'rgba(99,102,241,0.18)' : '#eef2ff',
                borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.35)' : '#c7d2fe'}`,
                color: isDark ? '#a5b4fc' : '#4338ca',
              }}
            >
              <Bell size={13} className="flex-shrink-0" />
              <span>{workspace.systemMessage}</span>
            </div>
          )}

          {/* Announcement banners (from AdminPanel → Firestore 'announcements' collection) */}
          {visibleAnns.map(ann => {
            const styles = {
              info:    { bg: isDark ? 'rgba(59,130,246,0.15)'  : '#eff6ff',  border: isDark ? 'rgba(59,130,246,0.35)'  : '#bfdbfe', color: isDark ? '#93c5fd' : '#1d4ed8' },
              success: { bg: isDark ? 'rgba(16,185,129,0.15)'  : '#f0fdf4',  border: isDark ? 'rgba(16,185,129,0.35)'  : '#bbf7d0', color: isDark ? '#6ee7b7' : '#15803d' },
              warning: { bg: isDark ? 'rgba(245,158,11,0.15)'  : '#fffbeb',  border: isDark ? 'rgba(245,158,11,0.35)'  : '#fcd34d', color: isDark ? '#fcd34d' : '#b45309' },
            }[ann.type];
            const AnnIcon = ann.type === 'info' ? Info : ann.type === 'success' ? CheckCircle2 : AlertTriangle;
            return (
              <div key={ann.id}
                className="flex items-start gap-3 px-4 md:px-6 py-2.5 text-sm"
                style={{ backgroundColor: styles.bg, borderBottom: `1px solid ${styles.border}`, color: styles.color }}>
                <AnnIcon size={14} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold">{ann.title}</span>
                  {ann.body && <span className="mr-1.5 font-medium opacity-80"> — {ann.body}</span>}
                </div>
                <button onClick={() => dismissAnn(ann.id)} className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                  <X size={13} />
                </button>
              </div>
            );
          })}

          {/* Page content */}
          <div className={`p-4 md:p-6 pb-24 md:pb-6 crm-page`}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
