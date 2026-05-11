import { useState } from 'react';
import {
  LayoutDashboard, Users, GitBranch, Briefcase, CheckSquare,
  Layers, BarChart3, Sparkles, UserCheck, Settings,
  Plus, Menu, X, ChevronLeft, Bell, Zap, LogOut, Bot, Shield,
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
  logoUrl?: string;         // workspace logo for branding
  workspaceName?: string;   // workspace name
}

const NAV_GROUPS = [
  {
    label: 'ניהול לקוחות',
    items: [
      { page: 'home'     as Page, label: 'לוח בקרה',  icon: LayoutDashboard },
      { page: 'dashboard'as Page, label: 'לידים',     icon: Users },
      { page: 'kanban'   as Page, label: 'פייפליין',  icon: GitBranch },
      { page: 'deals'    as Page, label: 'ניהול לקוחות', icon: Briefcase },
      { page: 'tasks'    as Page, label: 'משימות',    icon: CheckSquare, badge: true },
    ],
  },
  {
    label: 'שיווק',
    items: [
      { page: 'content'  as Page, label: 'קריאייטיב', icon: Layers },
      { page: 'overview' as Page, label: 'דוחות',     icon: BarChart3 },
    ],
  },
  {
    label: 'כלים',
    items: [
      { page: 'agents'   as Page, label: 'סוכנים חכמים', icon: Bot },
      { page: 'ai'       as Page, label: 'עוזר AI',       icon: Sparkles },
      { page: 'team'     as Page, label: 'צוות',          icon: UserCheck },
      { page: 'settings' as Page, label: 'הגדרות',        icon: Settings },
    ],
  },
];

// Super-admin only nav group (not shown to regular admins)
const SUPER_ADMIN_GROUP = {
  label: 'מערכת',
  items: [
    { page: 'admin' as Page, label: 'לוח אדמין', icon: Shield },
  ],
};

export default function Layout({
  children, currentPage, onPageChange, onNewLead,
  overdueBadge = 0, userInitials = 'A', userName = 'משתמש',
  allowedPages = [], isAdmin = false, isSuperAdmin = false,
  onSignOut, logoUrl, workspaceName,
}: LayoutProps) {
  const [open, setOpen] = useState(false);

  const go = (p: Page) => { onPageChange(p); setOpen(false); };

  // Show all pages when isAdmin or no allowedPages restriction; otherwise filter
  const baseGroups = isAdmin || allowedPages.length === 0
    ? NAV_GROUPS
    : NAV_GROUPS.map(group => ({
        ...group,
        items: group.items.filter(({ page }) =>
          page !== 'settings' && allowedPages.includes(page)
        ),
      })).filter(g => g.items.length > 0);

  const filteredGroups = isSuperAdmin ? [...baseGroups, SUPER_ADMIN_GROUP] : baseGroups;

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="logo"
              className="w-9 h-9 rounded-xl object-contain bg-white p-0.5 flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 flex-shrink-0">
              <Zap size={18} className="text-white" />
            </div>
          )}
          <div>
            <p className="text-white font-black text-lg leading-tight tracking-tight">
              {workspaceName ?? 'RAY'}
            </p>
            <p className="text-slate-500 text-[10px] font-medium -mt-0.5">Lead Manager</p>
          </div>
        </div>
        {/* New Lead Button */}
        <button
          onClick={() => { onNewLead(); setOpen(false); }}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm shadow-indigo-500/20"
        >
          <Plus size={14} /> ליד חדש
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5 scrollbar-hide">
        {filteredGroups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-3 pt-4 pb-1.5 select-none">
              {group.label}
            </p>
            {group.items.map(({ page, label, icon: Icon, badge }) => {
              const active = currentPage === page;
              return (
                <button
                  key={page}
                  onClick={() => go(page)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-white' : 'text-slate-500 group-hover:text-white transition-colors'} />
                  <span>{label}</span>
                  {badge && overdueBadge > 0 && (
                    <span className="mr-auto bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                      {overdueBadge > 9 ? '9+' : overdueBadge}
                    </span>
                  )}
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-300 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-slate-800/60 p-3">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-800 transition-colors cursor-default">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{userName}</p>
            <p className="text-slate-500 text-[10px]">{isAdmin ? 'מנהל' : 'סוכן'}</p>
          </div>
          <button
            onClick={onSignOut}
            className="text-slate-500 hover:text-red-400 transition-colors"
            title="התנתק"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex" dir="rtl">

      {/* ── Desktop Sidebar (right side in RTL) ─────────────────────────── */}
      <aside className="hidden md:flex w-60 bg-slate-950 flex-col fixed right-0 top-0 h-full z-30 border-l border-slate-800/40">
        <SidebarContent />
      </aside>

      {/* ── Mobile Overlay ──────────────────────────────────────────────── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex" dir="rtl">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-slate-950 h-full mr-auto border-l border-slate-800/40 z-50 animate-slide-in-right flex flex-col">
            <button onClick={() => setOpen(false)} className="absolute top-4 left-4 w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white">
              <X size={14} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Mobile Top Bar ──────────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-slate-950 border-b border-slate-800/40 h-12 flex items-center px-4 justify-between">
        <button onClick={() => setOpen(true)} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
          <Menu size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Zap size={11} className="text-white" />
          </div>
          <span className="text-white font-black text-sm">RAY</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onNewLead} className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Plus size={15} />
          </button>
          <button onClick={onSignOut} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-red-400 transition-colors">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="flex-1 md:mr-60 min-h-screen">
        <div className="pt-12 md:pt-0">
          {/* Desktop page header */}
          <div className="hidden md:flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 sticky top-0 z-20">
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <ChevronLeft size={14} />
              <span className="text-slate-800 font-semibold capitalize">
                {NAV_GROUPS.flatMap(g => g.items).find(i => i.page === currentPage)?.label ?? currentPage}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="relative w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                <Bell size={15} className="text-slate-500" />
              </button>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
                {userInitials}
              </div>
            </div>
          </div>
          <div className="p-4 md:p-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
