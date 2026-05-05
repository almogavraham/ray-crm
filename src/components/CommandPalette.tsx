import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, LayoutDashboard, BarChart2, Kanban, CheckSquare, Users,
  Sparkles, Settings, X, ArrowLeft, Building2, Plus, Hash,
} from 'lucide-react';
import type { Lead, Page } from '../types';

interface CommandPaletteProps {
  leads: Lead[];
  onClose: () => void;
  onLeadClick: (lead: Lead) => void;
  onPageChange: (page: Page) => void;
  onNewLead: () => void;
}

const PAGES = [
  { id: 'dashboard', label: 'לידים',       desc: 'רשימת כל הלידים',    Icon: LayoutDashboard, page: 'dashboard' as Page },
  { id: 'overview',  label: 'דאשבורד',     desc: 'סקירה וגרפים',       Icon: BarChart2,        page: 'overview'  as Page },
  { id: 'kanban',    label: 'פייפליין',     desc: 'תצוגת קנבן',         Icon: Kanban,           page: 'kanban'    as Page },
  { id: 'tasks',     label: 'משימות',       desc: 'ניהול כל המשימות',   Icon: CheckSquare,      page: 'tasks'     as Page },
  { id: 'team',      label: 'ניהול צוות',   desc: 'חברי הצוות',         Icon: Users,            page: 'team'      as Page },
  { id: 'ai',        label: 'עוזר AI',      desc: 'שאל שאלות על הלידים',Icon: Sparkles,         page: 'ai'        as Page },
  { id: 'settings',  label: 'הגדרות',       desc: 'הגדרות המערכת',      Icon: Settings,         page: 'settings'  as Page },
];

type ResultItem =
  | { kind: 'lead';   lead: Lead }
  | { kind: 'page';   page: typeof PAGES[number] }
  | { kind: 'action'; label: string; desc: string; Icon: React.ElementType; action: () => void };

export default function CommandPalette({ leads, onClose, onLeadClick, onPageChange, onNewLead }: CommandPaletteProps) {
  const [query, setQuery]     = useState('');
  const [cursor, setCursor]   = useState(0);
  const inputRef              = useRef<HTMLInputElement>(null);
  const listRef               = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  /* build results */
  const results: ResultItem[] = [];

  const q = query.toLowerCase();

  // Leads
  const matchedLeads = q.length >= 1
    ? leads.filter(l =>
        [l.company, l.contactName, l.email, l.phone, l.status]
          .some(v => v.toLowerCase().includes(q))
      ).slice(0, 5)
    : leads.slice(0, 3);
  matchedLeads.forEach(lead => results.push({ kind: 'lead', lead }));

  // Pages
  PAGES.filter(p =>
    !q || [p.label, p.desc].some(v => v.toLowerCase().includes(q))
  ).forEach(page => results.push({ kind: 'page', page }));

  // Actions
  if (!q || 'ליד חדש'.includes(q)) {
    results.push({
      kind: 'action',
      label: 'ליד חדש',
      desc: 'הוסף ליד חדש למערכת',
      Icon: Plus,
      action: () => { onNewLead(); onClose(); },
    });
  }

  const total = results.length;

  /* selection */
  useEffect(() => { setCursor(0); }, [query]);

  const scrollItemIntoView = (idx: number) => {
    const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  };

  const select = useCallback((idx: number) => {
    const item = results[idx];
    if (!item) return;
    if (item.kind === 'lead')   { onLeadClick(item.lead); onClose(); }
    if (item.kind === 'page')   { onPageChange(item.page.page); onClose(); }
    if (item.kind === 'action') { item.action(); }
  }, [results, onLeadClick, onPageChange, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => { const n = Math.min(c + 1, total - 1); scrollItemIntoView(n); return n; });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => { const n = Math.max(c - 1, 0); scrollItemIntoView(n); return n; });
    }
    if (e.key === 'Enter')  select(cursor);
    if (e.key === 'Escape') onClose();
  };

  /* group boundaries */
  const leadEnd  = matchedLeads.length;
  const pageEnd  = leadEnd + PAGES.filter(p => !q || [p.label, p.desc].some(v => v.toLowerCase().includes(q))).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <Search size={17} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="חפש לידים, דפים, פעולות..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 focus:outline-none bg-transparent text-right"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <div className="text-center py-10">
              <Hash size={28} className="mx-auto mb-2 text-slate-200" />
              <div className="text-sm text-slate-400">לא נמצאו תוצאות</div>
            </div>
          )}

          {/* Leads section */}
          {matchedLeads.length > 0 && (
            <SectionLabel label={q ? 'לידים תואמים' : 'לידים אחרונים'} />
          )}
          {results.slice(0, leadEnd).map((item, i) => {
            if (item.kind !== 'lead') return null;
            return (
              <ResultRow
                key={item.lead.id}
                idx={i}
                active={cursor === i}
                onHover={setCursor}
                onClick={() => select(i)}
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Building2 size={14} className="text-indigo-500" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-sm font-semibold text-slate-800">{item.lead.company}</div>
                  <div className="text-xs text-slate-400">{item.lead.contactName} · {item.lead.status}</div>
                </div>
                <ArrowLeft size={13} className={cursor === i ? 'text-indigo-400' : 'text-slate-200'} />
              </ResultRow>
            );
          })}

          {/* Pages section */}
          {results.slice(leadEnd, pageEnd).length > 0 && (
            <SectionLabel label="ניווט" />
          )}
          {results.slice(leadEnd, pageEnd).map((item, i) => {
            if (item.kind !== 'page') return null;
            const idx = leadEnd + i;
            const Icon = item.page.Icon;
            return (
              <ResultRow
                key={item.page.id}
                idx={idx}
                active={cursor === idx}
                onHover={setCursor}
                onClick={() => select(idx)}
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-slate-500" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-sm font-medium text-slate-700">{item.page.label}</div>
                  <div className="text-xs text-slate-400">{item.page.desc}</div>
                </div>
                <ArrowLeft size={13} className={cursor === idx ? 'text-indigo-400' : 'text-slate-200'} />
              </ResultRow>
            );
          })}

          {/* Actions section */}
          {results.slice(pageEnd).length > 0 && (
            <SectionLabel label="פעולות" />
          )}
          {results.slice(pageEnd).map((item, i) => {
            if (item.kind !== 'action') return null;
            const idx = pageEnd + i;
            const Icon = item.Icon;
            return (
              <ResultRow
                key={item.label}
                idx={idx}
                active={cursor === idx}
                onHover={setCursor}
                onClick={() => select(idx)}
              >
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-green-600" />
                </div>
                <div className="flex-1 text-right">
                  <div className="text-sm font-medium text-slate-700">{item.label}</div>
                  <div className="text-xs text-slate-400">{item.desc}</div>
                </div>
                <ArrowLeft size={13} className={cursor === idx ? 'text-indigo-400' : 'text-slate-200'} />
              </ResultRow>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2 flex items-center gap-4 text-[10px] text-slate-400 justify-end">
          <span><Kbd>↑↓</Kbd> ניווט</span>
          <span><Kbd>↵</Kbd> בחר</span>
          <span><Kbd>Esc</Kbd> סגור</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
      {label}
    </div>
  );
}

function ResultRow({ idx, active, onHover, onClick, children }: {
  idx: number; active: boolean; onHover: (i: number) => void;
  onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      data-idx={idx}
      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
        active ? 'bg-indigo-50' : 'hover:bg-slate-50'
      }`}
      onMouseEnter={() => onHover(idx)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-mono shadow-sm">
      {children}
    </kbd>
  );
}
