import { Sparkles, Users, BarChart2, LayoutDashboard, Plus, Kanban, RefreshCw } from 'lucide-react';
import type { Page } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onNewLead: () => void;
  onRefresh?: () => void;
}

export default function Layout({ children, currentPage, onPageChange, onNewLead, onRefresh }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-slate-200 px-6 py-0 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        {/* Left side: New lead + nav items */}
        <div className="flex items-center">
          <button
            onClick={onNewLead}
            className="flex items-center gap-1.5 bg-indigo-900 hover:bg-indigo-800 text-white px-4 py-2.5 text-sm font-medium transition-colors ml-4"
            style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Plus size={15} />
            ליד חדש
          </button>

          <div className="flex items-center">
            <NavItem icon={<Users size={15} />} label="ניהול צוות" active={currentPage === 'team'} onClick={() => onPageChange('team')} />
            <NavItem icon={<Sparkles size={15} />} label="עוזר AI" active={currentPage === 'ai'} onClick={() => onPageChange('ai')} highlight />
            <NavItem icon={<Kanban size={15} />} label="פייפליין" active={currentPage === 'kanban'} onClick={() => onPageChange('kanban')} />
            <NavItem icon={<BarChart2 size={15} />} label="דאשבורד" active={currentPage === 'overview'} onClick={() => onPageChange('overview')} />
            <NavItem icon={<LayoutDashboard size={15} />} label="לידים" active={currentPage === 'dashboard'} onClick={() => onPageChange('dashboard')} />
          </div>

          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-5 text-slate-400 hover:text-slate-600 text-sm transition-colors border-r border-slate-100 ml-1"
            title="רענן"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Right side: Logo */}
        <div className="flex items-center gap-3 py-2">
          <div className="text-right">
            <div className="font-black text-slate-900 text-lg tracking-tight leading-none">
              che<span className="text-indigo-600">X</span>
            </div>
            <div className="text-[10px] text-slate-400 tracking-wide uppercase">Lead Manager</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-900 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            A
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-5">
        {children}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, highlight }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-3 py-5 text-sm font-medium transition-colors border-b-2 ${
        active
          ? 'text-indigo-700 border-indigo-600'
          : highlight
          ? 'text-indigo-500 hover:text-indigo-700 border-transparent hover:border-indigo-200'
          : 'text-slate-500 hover:text-slate-700 border-transparent hover:border-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
