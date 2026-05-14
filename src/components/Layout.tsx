import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Users, GitBranch, Briefcase, CheckSquare,
  Layers, BarChart3, Sparkles, Settings,
  Plus, Menu, X, ChevronLeft, Bell, Zap, LogOut, Bot, Shield,
  Clock, AlertTriangle, Search,
} from 'lucide-react';
import type { Page } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onNewLead: () => void;
  onRefresh?: () => void;
  overdueBadge?: number;
  userInitials?: string;
  userName?: string;
  allowedPages?: Page[];
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  onSignOut?: () => void;
  logoUrl?: string;
  workspaceName?: string;
}

const NAV_GROUPS = [
  {
    label: 'ניהול לקוחות',
    items: [
      { page: 'home'      as Page, label: 'לוח בקרה',     icon: LayoutDashboard },
      { page: 'dashboard' as Page, label: 'לידים',         icon: Users           },
      { page: 'kanban'    as Page, label: 'פייפליין',      icon: GitBranch       },
      { page: 'deals'     as Page, label: 'לקוחות פעילים', icon: Briefcase       },
      { page: 'tasks'     as Page, label: 'משימות',        icon: CheckSquare, badge: true },
    ],
  },
  {
    label: 'שיווק',
    items: [
      { page: 'content'  as Page, label: 'קריאייטיב', icon: Layers    },
      { page: 'overview' as Page, label: 'דוחות',     icon: BarChart3 },
    ],
  },
  {
    label: 'כלים חכמים',
    items: [
      { page: 'agents'   as Page, label: 'סוכנים AI',  icon: Bot      },
      { page: 'ai'       as Page, label: 'עוזר AI',    icon: Sparkles },
      { page: 'settings' as Page, label: 'הגדרות',     icon: Settings },
    ],
  },
];

const SUPER_ADMIN_GROUP = {
  label: 'מערכת',
  items: [{ page: 'admin' as Page, label: 'לוח אדמין', icon: Shield }],
};

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
}

function SidebarInner({
  filteredGroups, currentPage, onGo, onNewLead,
  overdueBadge, logoUrl, workspaceName, userInitials, userName, isAdmin, onSignOut,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full">

      {/* Logo area */}
      <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid #e5e9f0' }}>
        <div className="flex items-center gap-2.5 mb-4">
          {logoUrl ? (
            <img src={logoUrl} alt="logo"
              className="w-8 h-8 rounded-lg object-contain bg-slate-100 p-0.5 flex-shrink-0 ring-1 ring-slate-200" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-[0_2px_8px_rgba(99,102,241,0.35)]">
              <Zap size={15} className="text-white fill-white" />
            </div>
          )}
          <div>
            <p className="font-bold text-[15px] leading-tight tracking-[-0.02em]" style={{ color: '#0f172a' }}>
              {workspaceName ?? 'RAY'}
            </p>
            <p className="text-[10px] font-medium tracking-widest uppercase" style={{ color: '#94a3b8' }}>
              CRM Platform
            </p>
          </div>
        </div>

        {/* New Lead */}
        <button
          onClick={onNewLead}
          className="w-full flex items-center justify-center gap-2 text-white text-xs font-semibold py-2.5 rounded-lg transition-all group"
          style={{ backgroundColor: '#4f46e5', boxShadow: '0 2px 8px rgba(79,70,229,0.3)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#4338ca')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#4f46e5')}
        >
          <Plus size={13} className="group-hover:rotate-90 transition-transform duration-200" />
          ליד חדש
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 scrollbar-hide">
        {filteredGroups.map(group => (
          <div key={group.label} className="mb-1">
            <p className="text-[9px] font-bold uppercase tracking-widest px-3 pt-4 pb-1.5 select-none"
              style={{ color: '#cbd5e1' }}>
              {group.label}
            </p>
            {group.items.map(({ page, label, icon: Icon, badge }) => {
              const active = currentPage === page;
              return (
                <button
                  key={page}
                  onClick={() => onGo(page)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative mb-0.5"
                  style={active ? {
                    backgroundColor: '#eef2ff',
                    color: '#4f46e5',
                    borderLeft: '2px solid #6366f1',
                  } : {
                    color: '#64748b',
                    borderLeft: '2px solid transparent',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = '#f1f5f9';
                      e.currentTarget.style.color = '#334155';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#64748b';
                    }
                  }}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  <span className="flex-1 text-right text-[13px]">{label}</span>
                  {badge && overdueBadge > 0 && (
                    <span className="mr-auto bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                      {overdueBadge > 9 ? '9+' : overdueBadge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="p-3" style={{ borderTop: '1px solid #e5e9f0' }}>
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-default"
          style={{ backgroundColor: '#f8fafc' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}>
            {userInitials}
          </div>
          <div className="flex-1 min-w-0 text-right">
            <p className="text-[13px] font-semibold truncate" style={{ color: '#1e293b' }}>{userName}</p>
            <p className="text-[10px]" style={{ color: '#94a3b8' }}>{isAdmin ? 'מנהל' : 'סוכן'}</p>
          </div>
          <button
            onClick={() => onSignOut?.()}
            className="p-1 rounded-lg transition-colors"
            style={{ color: '#94a3b8' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = '#fef2f2'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.backgroundColor = 'transparent'; }}
            title="התנתק"
          >
            <LogOut size={13} />
          </button>
        </div>

        <div className="mt-2 flex justify-center">
          <span className="text-[9px] tracking-widest font-mono" style={{ color: '#cbd5e1' }}>
            RAY v2.0 · POWERED BY AI
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Bell Dropdown ───────────────────────────────────────────────────────── */
function BellDropdown({ overdueBadge, onNavigateTasks }: { overdueBadge: number; onNavigateTasks: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          ? { backgroundColor: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe' }
          : { backgroundColor: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }
        }
        title="התראות"
      >
        <Bell size={14} className={overdueBadge > 0 ? 'text-red-500' : ''} />
        {overdueBadge > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-0.5 ring-1 ring-white">
            {overdueBadge > 9 ? '9+' : overdueBadge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] z-50 overflow-hidden" dir="rtl"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e5e9f0' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <button onClick={() => setOpen(false)} style={{ color: '#94a3b8' }} className="transition-colors hover:text-slate-600">
              <X size={13} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: '#1e293b' }}>התראות</span>
              <Bell size={12} style={{ color: '#94a3b8' }} />
            </div>
          </div>

          {overdueBadge === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-3"
                style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <Bell size={16} className="text-emerald-500" />
              </div>
              <p className="text-sm font-semibold" style={{ color: '#334155' }}>אין התראות פעילות</p>
              <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>כל המשימות מעודכנות ✓</p>
            </div>
          ) : (
            <div>
              <div className="px-4 py-3 flex items-start gap-3 text-right"
                style={{ backgroundColor: '#fff5f5', borderBottom: '1px solid #fecaca' }}>
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-600">
                    {overdueBadge} משימ{overdueBadge === 1 ? 'ה' : 'ות'} באיחור
                  </p>
                  <p className="text-xs text-red-400 mt-0.5">מועד הסיום עבר</p>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center gap-2 text-right" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <Clock size={12} style={{ color: '#94a3b8' }} className="flex-shrink-0" />
                <p className="text-xs" style={{ color: '#64748b' }}>
                  עבור ל<span className="font-semibold mx-1" style={{ color: '#334155' }}>משימות</span>לסגירה
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
  );
}

/* ── Layout ──────────────────────────────────────────────────────────────── */
export default function Layout({
  children, currentPage, onPageChange, onNewLead,
  overdueBadge = 0, userInitials = 'A', userName = 'משתמש',
  allowedPages = [], isAdmin = false, isSuperAdmin = false,
  onSignOut, logoUrl, workspaceName,
}: LayoutProps) {
  const [open, setOpen] = useState(false);

  const go = (p: Page) => { onPageChange(p); setOpen(false); };

  const baseGroups = isAdmin || allowedPages.length === 0
    ? NAV_GROUPS
    : NAV_GROUPS.map(group => ({
        ...group,
        items: group.items.filter(({ page }) =>
          page !== 'settings' && allowedPages.includes(page)
        ),
      })).filter(g => g.items.length > 0);

  const filteredGroups = isSuperAdmin ? [...baseGroups, SUPER_ADMIN_GROUP] : baseGroups;

  const currentLabel = [...NAV_GROUPS, SUPER_ADMIN_GROUP]
    .flatMap(g => g.items)
    .find(i => i.page === currentPage)?.label ?? currentPage;

  const sidebarProps: SidebarProps = {
    filteredGroups, currentPage, onGo: go,
    onNewLead: () => { onNewLead(); setOpen(false); },
    overdueBadge, logoUrl, workspaceName,
    userInitials, userName, isAdmin, onSignOut,
  };

  return (
    <div className="min-h-screen flex" dir="rtl" style={{ backgroundColor: '#f5f7fa' }}>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex w-[220px] flex-col fixed right-0 top-0 h-full z-30"
        style={{ backgroundColor: '#ffffff', borderLeft: '1px solid #e5e9f0', boxShadow: '0 0 0 1px rgba(0,0,0,0.03)' }}
      >
        <div className="relative z-10 flex flex-col h-full">
          <SidebarInner {...sidebarProps} />
        </div>
      </aside>

      {/* ── Mobile Overlay ──────────────────────────────────────────────── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex" dir="rtl">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside
            className="relative w-[220px] h-full mr-auto z-50 flex flex-col"
            style={{ backgroundColor: '#ffffff', borderLeft: '1px solid #e5e9f0' }}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 left-4 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b' }}
            >
              <X size={13} />
            </button>
            <SidebarInner {...sidebarProps} />
          </aside>
        </div>
      )}

      {/* ── Mobile Top Bar ──────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 flex items-center px-4 justify-between"
        style={{ backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid #e5e9f0' }}
      >
        <button
          onClick={() => setOpen(true)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b' }}
        >
          <Menu size={15} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
            <Zap size={11} className="text-white fill-white" />
          </div>
          <span className="font-bold text-sm tracking-tight" style={{ color: '#0f172a' }}>RAY</span>
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
            style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', color: '#94a3b8' }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="flex-1 md:mr-[220px] min-h-screen relative z-10">
        <div className="pt-12 md:pt-0">

          {/* Desktop Header */}
          <div
            className="hidden md:flex items-center justify-between px-6 py-3 sticky top-0 z-20"
            style={{
              backgroundColor: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(16px)',
              borderBottom: '1px solid #e5e9f0',
            }}
          >
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5">
              <ChevronLeft size={12} style={{ color: '#cbd5e1' }} />
              <span className="text-[11px] font-medium" style={{ color: '#94a3b8' }}>RAY</span>
              <ChevronLeft size={10} style={{ color: '#cbd5e1' }} />
              <span className="text-[13px] font-semibold" style={{ color: '#1e293b' }}>{currentLabel}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Search hint */}
              <div
                className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors"
                style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', color: '#94a3b8' }}
              >
                <Search size={11} />
                <span>חיפוש</span>
                <kbd className="rounded px-1 text-[10px] font-mono" style={{ backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b' }}>⌘K</kbd>
              </div>

              <BellDropdown overdueBadge={overdueBadge} onNavigateTasks={() => onPageChange('tasks')} />

              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold cursor-default"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}
              >
                {userInitials}
              </div>
            </div>
          </div>

          {/* Page content */}
          <div className="p-4 md:p-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
