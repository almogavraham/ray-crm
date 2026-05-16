import { useState, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Search, Phone, Mail, Star, AlertCircle, CheckSquare,
  Calendar, Zap, Share2, Megaphone, Globe, Users,
  Sparkles, SlidersHorizontal, TrendingUp, ArrowUpRight,
  MessageCircle, ChevronDown, X, Filter,
} from 'lucide-react';
import type { Lead, LeadStatus, LeadSource } from '../types';
import { STATUS_CONFIG } from '../data/mockData';

/* ─── constants ─────────────────────────────────────────────────────────── */
const COLUMNS: LeadStatus[] = ['חדש','בתהליך','לקוח פעיל','רימרקטינג','לא רלוונטי'];

const COL_THEME: Record<LeadStatus, {
  bg: string; border: string; header: string; dot: string;
  accent: string; dropBg: string; badge: string;
}> = {
  'חדש':         { bg:'bg-slate-50',   border:'border-indigo-200', header:'bg-indigo-600',    dot:'bg-indigo-400',  accent:'#6366f1', dropBg:'bg-indigo-50/80',  badge:'bg-indigo-100 text-indigo-700' },
  'בתהליך':     { bg:'bg-slate-50',   border:'border-orange-200', header:'bg-orange-500',    dot:'bg-orange-400',  accent:'#f97316', dropBg:'bg-orange-50/80',  badge:'bg-orange-100 text-orange-700' },
  'לקוח פעיל':  { bg:'bg-slate-50',   border:'border-emerald-200',header:'bg-emerald-600',   dot:'bg-emerald-400', accent:'#22c55e', dropBg:'bg-emerald-50/80', badge:'bg-emerald-100 text-emerald-700' },
  'רימרקטינג':  { bg:'bg-slate-50',   border:'border-violet-200', header:'bg-violet-600',    dot:'bg-violet-400',  accent:'#8b5cf6', dropBg:'bg-violet-50/80',  badge:'bg-violet-100 text-violet-700' },
  'לא רלוונטי': { bg:'bg-slate-50/60',border:'border-slate-200',  header:'bg-slate-500',     dot:'bg-slate-400',   accent:'#94a3b8', dropBg:'bg-slate-100/80',  badge:'bg-slate-200 text-slate-600' },
};

const SOURCE_ICON: Record<LeadSource, ReactNode> = {
  'אורגני':      <Globe size={9}/>,
  'פרסום ממומן': <Megaphone size={9}/>,
  'הפניה':       <Users size={9}/>,
  'אינסטגרם':    <Share2 size={9}/>,
  'פייסבוק':     <Share2 size={9}/>,
  'גוגל':        <Zap size={9}/>,
};

type SortKey = 'aiScore'|'budget'|'company'|'lastUpdate';

function formatPhone(p: string) {
  const d = p.replace(/\D/g,'');
  return d.startsWith('0') ? '+972'+d.slice(1) : '+'+d;
}

function daysSince(s: string) {
  try {
    const p = s.split('/');
    const d = p.length===3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`) : new Date(s);
    return Math.floor((Date.now()-d.getTime())/86400000);
  } catch { return 0; }
}

/* ─── interfaces ─────────────────────────────────────────────────────────── */
interface KanbanProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadSave: (lead: Lead) => void;
  onPageChange?: (page: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function Kanban({ leads, onLeadClick, onLeadSave, onPageChange }: KanbanProps) {
  const [search,     setSearch]     = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('aiScore');
  const [filterSrc,  setFilterSrc]  = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus|null>(null);
  const dragLeadId = useRef<string|null>(null);

  /* filtered + sorted leads per column */
  const getCol = (status: LeadStatus) => {
    let arr = leads.filter(l => l.status === status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter(l =>
        l.company.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
      );
    }
    if (filterSrc) arr = arr.filter(l => l.source === filterSrc);
    return arr.sort((a,b) => {
      if (sortKey==='aiScore')    return b.aiScore - a.aiScore;
      if (sortKey==='budget')     return (b.budget??0)-(a.budget??0);
      if (sortKey==='company')    return a.company.localeCompare(b.company);
      if (sortKey==='lastUpdate') return b.lastUpdate.localeCompare(a.lastUpdate);
      return 0;
    });
  };

  /* drag handlers */
  const onDragStart = (leadId: string) => { dragLeadId.current = leadId; };
  const onDragOver  = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault(); setDragOverCol(status);
  };
  const onDragLeave = () => setDragOverCol(null);
  const onDrop      = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault(); setDragOverCol(null);
    const id = dragLeadId.current; dragLeadId.current = null;
    if (!id) return;
    const lead = leads.find(l=>l.id===id);
    if (lead && lead.status !== status) {
      onLeadSave({ ...lead, status, lastUpdate: new Date().toLocaleDateString('he-IL') });
    }
  };

  /* totals */
  const totalPipeline = leads
    .filter(l=>['חדש','בתהליך','רימרקטינג'].includes(l.status))
    .reduce((s,l)=>s+(l.budget??0),0);
  const totalRevenue = leads
    .filter(l=>l.status==='לקוח פעיל')
    .reduce((s,l)=>s+(l.budget??0),0);
  const allSources = [...new Set(leads.map(l=>l.source).filter(Boolean))];

  const hasFilter = !!search || !!filterSrc;

  /* ── render ────────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-0" dir="rtl">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 flex-wrap">

        {/* Title + stats */}
        <div className="flex items-center gap-3">
          <h1 className="text-base font-black text-slate-900">פייפליין מכירות</h1>
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold">
              {leads.length} לידים
            </span>
            {totalRevenue>0 && (
              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
                ₪{(totalRevenue/1000).toFixed(0)}K/חודש
              </span>
            )}
            {totalPipeline>0 && (
              <span className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full font-semibold">
                ₪{(totalPipeline/1000).toFixed(0)}K פייפליין
              </span>
            )}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1"/>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="חיפוש לידים..."
            className="bg-slate-50 border border-slate-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 w-44 transition-all"
          />
          {search && (
            <button onClick={()=>setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={12}/>
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          <ChevronDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
          <select value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}
            className="bg-slate-50 border border-slate-200 rounded-xl pr-3 pl-7 py-2 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 appearance-none cursor-pointer">
            <option value="aiScore">מיון: ציון AI</option>
            <option value="budget">מיון: תקציב</option>
            <option value="company">מיון: שם</option>
            <option value="lastUpdate">מיון: עדכון</option>
          </select>
        </div>

        {/* Filter */}
        <button onClick={()=>setShowFilter(f=>!f)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
            hasFilter||showFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
          }`}>
          <Filter size={12}/> סינון {hasFilter && `(${[search?1:0,filterSrc?1:0].reduce((a,b)=>a+b,0)})`}
        </button>

        {/* Agents shortcut */}
        {onPageChange && (
          <button onClick={()=>onPageChange('agents')}
            className="hidden sm:flex items-center gap-1.5 bg-gradient-to-l from-indigo-600 to-violet-600 hover:opacity-90 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-sm">
            <Sparkles size={12}/> Workflow AI
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="px-4 sm:px-6 py-3 bg-indigo-50/50 border-b border-indigo-100 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-slate-500">מקור:</span>
          <button onClick={()=>setFilterSrc('')}
            className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${!filterSrc?'bg-indigo-600 text-white':'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
            הכל
          </button>
          {allSources.map(s=>(
            <button key={s} onClick={()=>setFilterSrc(filterSrc===s?'':s)}
              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${filterSrc===s?'bg-indigo-600 text-white':'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
              {s}
            </button>
          ))}
          {hasFilter && (
            <button onClick={()=>{setSearch('');setFilterSrc('');}}
              className="mr-auto text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1">
              <X size={11}/> נקה סינון
            </button>
          )}
        </div>
      )}

      {/* ── Board ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-0 h-full min-w-max">
          {COLUMNS.map((status, colIdx) => {
            const col     = getCol(status);
            const theme   = COL_THEME[status];
            const cfg     = STATUS_CONFIG[status];
            const budget  = col.reduce((s,l)=>s+(l.budget??0),0);
            const avgAI   = col.length ? Math.round(col.reduce((s,l)=>s+l.aiScore,0)/col.length) : 0;
            const isDrop  = dragOverCol===status;

            return (
              <div key={status}
                className={`flex flex-col border-l border-slate-200 first:border-l-0 transition-colors duration-150 ${isDrop?theme.dropBg:'bg-white'}`}
                style={{width: 240, minWidth: 240, flexShrink: 0}}
                onDragOver={e=>onDragOver(e,status)}
                onDragLeave={onDragLeave}
                onDrop={e=>onDrop(e,status)}
              >
                {/* Column header */}
                <div className={`${theme.header} px-3 py-2.5 flex items-center justify-between select-none`}>
                  <div className="flex items-center gap-2">
                    <span className="bg-white/25 text-white text-[11px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                      {col.length}
                    </span>
                    {budget>0 && (
                      <span className="text-white/80 text-[10px] font-semibold">
                        ₪{(budget/1000).toFixed(0)}K
                      </span>
                    )}
                  </div>
                  <span className="text-white font-bold text-xs">{status}</span>
                </div>

                {/* Column sub-stats */}
                <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                  <div className="flex items-center gap-1">
                    {col.filter(l=>l.tasks.some(t=>!t.completed && new Date(t.date+'T00:00:00')<new Date())).length > 0 && (
                      <span className="text-[10px] text-red-500 font-bold flex items-center gap-0.5">
                        <AlertCircle size={9}/>
                        {col.filter(l=>l.tasks.some(t=>!t.completed && new Date(t.date+'T00:00:00')<new Date())).length} איחור
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {avgAI>0 ? `AI: ${avgAI}%` : ''}
                  </span>
                </div>

                {/* Drop zone indicator */}
                {isDrop && (
                  <div className="mx-3 mt-2 h-1 rounded-full animate-pulse" style={{backgroundColor: theme.accent+'60'}}/>
                )}

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2"
                  style={{scrollbarWidth:'thin', scrollbarColor:'#e2e8f0 transparent'}}>
                  {col.length===0 ? (
                    <div className={`flex flex-col items-center justify-center py-10 text-center rounded-2xl border-2 border-dashed transition-colors ${
                      isDrop ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-transparent'
                    }`}>
                      <ArrowUpRight size={20} className={isDrop?'text-indigo-400':'text-slate-300'}/>
                      <p className="text-xs text-slate-400 mt-2">{isDrop?'שחרר כאן':'אין לידים'}</p>
                    </div>
                  ) : (
                    col.map(lead => (
                      <KanbanCard
                        key={lead.id}
                        lead={lead}
                        theme={theme}
                        onClick={()=>onLeadClick(lead)}
                        onDragStart={()=>onDragStart(lead.id)}
                      />
                    ))
                  )}
                  {/* Bottom drop zone when column has cards */}
                  {isDrop && col.length>0 && (
                    <div className="h-16 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 flex items-center justify-center">
                      <p className="text-xs text-indigo-400 font-semibold">שחרר כאן</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom funnel bar ────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 py-2.5 bg-white border-t border-slate-200 flex items-center gap-0 overflow-x-auto">
        {COLUMNS.map((status,i) => {
          const col = leads.filter(l=>l.status===status);
          const pct = leads.length ? Math.round((col.length/leads.length)*100) : 0;
          const theme = COL_THEME[status];
          const rev   = col.reduce((s,l)=>s+(l.budget??0),0);
          return (
            <div key={status} className="flex-1 min-w-[80px] flex flex-col items-center gap-1 px-1">
              <div className="flex items-baseline gap-1 justify-center">
                <span className="text-base font-black text-slate-800">{col.length}</span>
                <span className="text-[10px] text-slate-400">{pct}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{width:`${pct}%`,backgroundColor:theme.accent}}/>
              </div>
              <span className="text-[10px] text-slate-500 font-medium text-center leading-tight truncate w-full text-center">{status}</span>
              {rev>0 && <span className="text-[10px] font-bold" style={{color:theme.accent}}>₪{(rev/1000).toFixed(0)}K</span>}
              {i<COLUMNS.length-1 && (
                <TrendingUp size={10} className="text-slate-300 hidden sm:block absolute" style={{marginTop:2}}/>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   KANBAN CARD
═══════════════════════════════════════════════════════════════════════════ */
function KanbanCard({ lead, theme, onClick, onDragStart }: {
  lead: Lead;
  theme: typeof COL_THEME[LeadStatus];
  onClick: () => void;
  onDragStart: () => void;
}) {
  const isVIP     = (lead.budget??0)>=15000;
  const openTasks = lead.tasks.filter(t=>!t.completed);
  const overdue   = openTasks.filter(t=>{
    try { return new Date(t.date+'T00:00:00') < new Date(new Date().toDateString()); }
    catch { return false; }
  });
  const nextTask = openTasks.sort((a,b)=>a.date.localeCompare(b.date))[0];
  const stale    = daysSince(lead.lastUpdate);
  const initials = (lead.assignedTo??'').split(' ').map(w=>w[0]??'').join('').slice(0,2).toUpperCase();

  const scoreColor = lead.aiScore>=75?'#22c55e':lead.aiScore>=50?'#f97316':'#94a3b8';

  return (
    <div
      draggable
      onDragStart={e=>{ e.dataTransfer.effectAllowed='move'; onDragStart(); }}
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg transition-all duration-150 cursor-grab active:cursor-grabbing group relative overflow-hidden select-none"
      style={{boxShadow: '0 1px 3px rgba(0,0,0,0.06)'}}
    >
      {/* Left accent bar */}
      <div className="absolute top-0 right-0 w-0.5 h-full rounded-r" style={{backgroundColor: theme.accent+'80'}}/>

      {/* VIP top ribbon */}
      {isVIP && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400"/>
      )}

      <div className="p-3">
        {/* Row 1: company + score */}
        <div className="flex items-start justify-between gap-1 mb-2">
          <div className="flex items-center gap-1 flex-shrink-0">
            {lead.aiScore>0 && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                style={{color:scoreColor, backgroundColor:scoreColor+'18'}}>
                {lead.aiScore}%
              </span>
            )}
            {isVIP && <Star size={11} className="text-amber-400 fill-amber-400"/>}
          </div>
          <p className="font-bold text-slate-800 text-xs leading-snug text-right truncate">{lead.company}</p>
        </div>

        {/* AI bar */}
        {lead.aiScore>0 && (
          <div className="h-0.5 bg-slate-100 rounded-full mb-2.5 overflow-hidden">
            <div className="h-full rounded-full" style={{width:`${lead.aiScore}%`,backgroundColor:scoreColor,transition:'width 0.5s'}}/>
          </div>
        )}

        {/* Row 2: contact name */}
        <p className="text-[11px] text-slate-500 text-right mb-2 truncate">{lead.contactName}</p>

        {/* Row 3: budget + source */}
        <div className="flex items-center justify-between mb-2">
          {lead.source && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium">
              {SOURCE_ICON[lead.source as LeadSource]}
              <span className="hidden sm:inline">{lead.source}</span>
            </span>
          )}
          {(lead.budget??0)>0 && (
            <span className="text-xs font-black text-slate-700">
              ₪{((lead.budget??0)/1000).toFixed(0)}K
            </span>
          )}
        </div>

        {/* Solutions chips */}
        {lead.solutions.length>0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {lead.solutions.slice(0,2).map(s=>(
              <span key={s.name} className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${
                s.delivered?'bg-emerald-50 text-emerald-600 line-through opacity-60':
                s.inProgress?'bg-indigo-50 text-indigo-600':'bg-slate-100 text-slate-500'
              }`}>{s.name}</span>
            ))}
            {lead.solutions.length>2 && (
              <span className="text-[9px] text-slate-400 font-medium">+{lead.solutions.length-2}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1">
            {/* Quick actions — visible on hover */}
            {lead.phone && (
              <a href={`https://wa.me/${formatPhone(lead.phone)}`} target="_blank" rel="noreferrer"
                onClick={e=>e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 flex items-center justify-center transition-all">
                <MessageCircle size={11}/>
              </a>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} onClick={e=>e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-all">
                <Phone size={11}/>
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} onClick={e=>e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-all">
                <Mail size={11}/>
              </a>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Stale indicator */}
            {stale>=14 && (
              <span className="text-[9px] text-amber-500 font-bold bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                {stale}י
              </span>
            )}
            {/* Overdue */}
            {overdue.length>0 && (
              <span className="text-[9px] text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200 flex items-center gap-0.5">
                <AlertCircle size={8}/>{overdue.length}
              </span>
            )}
            {/* Open tasks (no overdue) */}
            {openTasks.length>0 && overdue.length===0 && (
              <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-full border border-slate-200 flex items-center gap-0.5">
                <CheckSquare size={8}/>{openTasks.length}
              </span>
            )}
            {/* Waiting for content */}
            {lead.waitingContent && (
              <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">⏳</span>
            )}
            {/* Assignee avatar */}
            {initials && (
              <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-black flex items-center justify-center">
                {initials}
              </div>
            )}
          </div>
        </div>

        {/* Next task */}
        {nextTask && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400 border-t border-slate-50 pt-1.5">
            <Calendar size={9} className="flex-shrink-0"/>
            <span className="truncate">{nextTask.date} — {nextTask.description}</span>
          </div>
        )}
      </div>
    </div>
  );
}
