import { useState } from 'react';
import {
  Sparkles, Users, BarChart2, LayoutDashboard, Plus, Kanban,
  RefreshCw, CheckSquare, Settings, Menu, X, Layers,
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
}

const NAV_ITEMS: { page: Page; label: string; icon: React.ElementType; highlight?: boolean }[] = [
  { page: 'dashboard', label: 'לידים',    icon: LayoutDashboard },
  { page: 'overview',  label: 'דאשבורד',  icon: BarChart2 },
  { page: 'kanban',    label: 'פייפליין', icon: Kanban },
  { page: 'tasks',     label: 'משימות',   icon: CheckSquare },
  { page: 'content',   label: 'קריאייטיב', icon: Layers, highlight: true },
  { page: 'ai',        label: 'עוזר AI',  icon: Sparkles, highlight: true },
  { page: 'team',      label: 'צוות',     icon: Users },
];

export default function Layout({
  children, currentPage, onPageChange, onNewLead,
  onRefresh, overdueBadge = 0, userInitials = 'A',
}: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (p: Page) => { onPageChange(p); setMenuOpen(false); };

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center justify-between px-3 md:px-4 h-12 md:h-auto">

          {/* Desktop left: New Lead + nav items + refresh */}
          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={onNewLead}
              className="flex items-center gap-1.5 bg-black hover:bg-neutral-800 text-white px-4 py-2.5 text-sm font-medium transition-colors"
              style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}
            >
              <Plus size={15} />ליד חדש
            </button>
            <div className="flex items-center">
              {NAV_ITEMS.map(({ page, label, icon: Icon, highlight }) => (
                <button
                  key={page}
                  onClick={() => go(page)}
                  className={`relative flex items-center gap-1.5 px-3 py-5 text-sm font-medium transition-colors border-b-2 ${
                    currentPage === page
                      ? 'text-black border-black'
                      : highlight
                      ? 'text-neutral-600 hover:text-black border-transparent hover:border-neutral-300'
                      : 'text-slate-500 hover:text-slate-700 border-transparent hover:border-slate-200'
                  }`}
                >
                  {page === 'tasks' ? (
                    <div className="relative">
                      <Icon size={15} />
                      {overdueBadge > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] font-bold flex items-center justify-center leading-none">
                          {overdueBadge > 9 ? '9+' : overdueBadge}
                        </span>
                      )}
                    </div>
                  ) : (
                    <Icon size={15} />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-5 text-slate-400 hover:text-slate-600 text-sm transition-colors border-r border-slate-100 mr-1"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Mobile left: hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              onClick={onNewLead}
              className="flex items-center gap-1 bg-black text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              <Plus size={13} />ליד חדש
            </button>
          </div>

          {/* Right: logo + avatar (always visible) */}
          <div className="flex items-center gap-2 md:gap-3 py-2">
            <button
              onClick={() => go('settings')}
              className={`p-1.5 md:p-2 rounded-lg transition-colors ${
                currentPage === 'settings'
                  ? 'bg-neutral-100 text-black'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Settings size={16} />
            </button>
            {/* RAY Logo */}
            <div className="flex items-center gap-2 select-none">
              <div className="text-right hidden sm:block">
                <div className="text-[10px] text-slate-400 tracking-widest uppercase leading-none mb-0.5">Lead Manager</div>
                <div className="font-black text-black text-xl tracking-tighter leading-none">RAY</div>
              </div>
              <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                <rect width="100" height="100" rx="12" fill="black"/>
                <rect x="22" y="62" width="56" height="8" rx="4" fill="white"/>
                <rect x="22" y="48" width="40" height="7" rx="3.5" fill="white"/>
                <rect x="22" y="30" width="56" height="12" rx="6" fill="white"/>
                <rect x="52" y="48" width="26" height="22" rx="4" fill="white"/>
              </svg>
              <div className="font-black text-black text-lg sm:hidden tracking-tighter leading-none">RAY</div>
            </div>
            <div
              onClick={() => go('settings')}
              className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-black flex items-center justify-center text-white font-bold text-sm shadow-sm cursor-pointer hover:opacity-80 transition-opacity select-none flex-shrink-0"
            >
              {userInitials}
            </div>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-3 pb-3 pt-2 space-y-1">
            {NAV_ITEMS.map(({ page, label, icon: Icon, highlight }) => (
              <button
                key={page}
                onClick={() => go(page)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors text-right ${
                  currentPage === page
                    ? 'bg-black text-white'
                    : highlight
                    ? 'text-neutral-700 hover:bg-neutral-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex-1 text-right">{label}</span>
                {page === 'tasks' && overdueBadge > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {overdueBadge > 9 ? '9+' : overdueBadge}
                  </span>
                )}
                <Icon size={16} />
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* ── Page content ───────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-5 pb-20 md:pb-5">
        {children}
      </main>

      {/* ── Mobile bottom nav ──────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40 safe-area-pb">
        <div className="flex items-center justify-around px-1 py-1">
          {[
            { page: 'dashboard' as Page, label: 'לידים',    icon: LayoutDashboard },
            { page: 'kanban'    as Page, label: 'פייפליין', icon: Kanban },
            { page: 'tasks'     as Page, label: 'משימות',   icon: CheckSquare },
            { page: 'ai'        as Page, label: 'AI',       icon: Sparkles },
            { page: 'overview'  as Page, label: 'דאשבורד',  icon: BarChart2 },
          ].map(({ page, label, icon: Icon }) => (
            <button
              key={page}
              onClick={() => go(page)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[52px] transition-colors ${
                currentPage === page
                  ? 'text-black bg-neutral-100'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <div className="relative">
                <Icon size={20} />
                {page === 'tasks' && overdueBadge > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full text-[7px] font-bold flex items-center justify-center">
                    {overdueBadge > 9 ? '9+' : overdueBadge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </button>
          ))}
        </div>
      </nav>

    </div>
  );
}
