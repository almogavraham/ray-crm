import { useState, useRef } from 'react';
import {
  X, Eye, EyeOff, GripVertical, RotateCcw, Save,
  LayoutGrid, Layout, Columns, Square,
} from 'lucide-react';
import type { CardLayoutSettings, CardSectionItem } from '../types';
import { DEFAULT_CARD_LAYOUT } from '../types';

interface Props {
  layout: CardLayoutSettings;
  statuses: string[];
  onSave: (layout: CardLayoutSettings) => void;
  onClose: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  prices:       'שירותים ותמחור',
  status:       'סטטוס',
  source:       'מקור',
  assignee:     'אחראי',
  customFields: 'שדות מותאמים',
  stats:        'סטטיסטיקות',
};

const KANBAN_FIELD_LABELS: Record<string, string> = {
  aiScore:     'ציון AI',
  budget:      'תקציב',
  source:      'מקור',
  solutions:   'שירותים',
  tasks:       'משימות',
  conversion:  'פוטנציאל',
  temperature: 'טמפרטורה',
  nextTask:    'משימה הבאה',
  assignedTo:  'אחראי',
};

const ALL_KANBAN_FIELDS = Object.keys(KANBAN_FIELD_LABELS);

type TabKey = 'sections' | 'colors' | 'highlights' | 'layout' | 'kanban';

const HIGHLIGHT_FIELD_LABELS: Record<string, string> = {
  budget:    'תקציב',
  status:    'סטטוס',
  source:    'מקור',
  aiScore:   'ציון AI',
  solutions: 'שירותים',
  assignedTo: 'אחראי',
};

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
  '#10b981', '#06b6d4', '#eab308', '#ef4444',
  '#64748b', '#14b8a6', '#f43f5e', '#84cc16',
];

export default function CardCustomizePanel({ layout, statuses, onSave, onClose }: Props) {
  const [local, setLocal] = useState<CardLayoutSettings>({ ...layout });
  const [activeTab, setActiveTab] = useState<TabKey>('sections');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOverId = useRef<string | null>(null);

  // ── Section drag & drop ────────────────────────────────────────────────────
  const handleDragStart = (id: string) => setDraggingId(id);

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    dragOverId.current = id;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggingId || !dragOverId.current || draggingId === dragOverId.current) {
      setDraggingId(null);
      return;
    }
    const sections = [...local.sections];
    const fromIdx = sections.findIndex(s => s.id === draggingId);
    const toIdx = sections.findIndex(s => s.id === dragOverId.current);
    if (fromIdx === -1 || toIdx === -1) { setDraggingId(null); return; }
    const [moved] = sections.splice(fromIdx, 1);
    sections.splice(toIdx, 0, moved);
    setLocal(l => ({ ...l, sections }));
    setDraggingId(null);
    dragOverId.current = null;
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    dragOverId.current = null;
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const sections = [...local.sections];
    const idx = sections.findIndex(s => s.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sections.length) return;
    [sections[idx], sections[newIdx]] = [sections[newIdx], sections[idx]];
    setLocal(l => ({ ...l, sections }));
  };

  const toggleSection = (id: string) => {
    setLocal(l => ({
      ...l,
      sections: l.sections.map(s => s.id === id ? { ...s, visible: !s.visible } : s),
    }));
  };

  // ── Status colors ──────────────────────────────────────────────────────────
  const setStatusColor = (status: string, color: string) => {
    setLocal(l => ({ ...l, statusColors: { ...l.statusColors, [status]: color } }));
  };

  // ── Highlight fields ───────────────────────────────────────────────────────
  const toggleHighlight = (field: string) => {
    setLocal(l => {
      const cur = l.highlightFields;
      if (cur.includes(field)) return { ...l, highlightFields: cur.filter(f => f !== field) };
      if (cur.length >= 3) return l; // max 3
      return { ...l, highlightFields: [...cur, field] };
    });
  };

  // ── Kanban fields ──────────────────────────────────────────────────────────
  const toggleKanbanField = (field: string) => {
    setLocal(l => {
      const cur = l.kanbanFields;
      return {
        ...l,
        kanbanFields: cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field],
      };
    });
  };

  const handleReset = () => setLocal({ ...DEFAULT_CARD_LAYOUT });
  const handleSave = () => onSave(local);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'sections',   label: 'סקציות' },
    { key: 'colors',     label: 'צבעים' },
    { key: 'highlights', label: 'פינצ\'ול' },
    { key: 'layout',     label: 'תצוגה' },
    { key: 'kanban',     label: 'קנבן' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end" dir="rtl">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative h-full w-80 bg-slate-900 border-r border-slate-700/60 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700/60 bg-slate-800/60">
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700 transition-colors">
            <X size={16} />
          </button>
          <h2 className="text-sm font-bold text-white">🎨 עיצוב כרטיס ליד</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/60 bg-slate-800/40 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-3 py-2.5 text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-white border-b-2 border-indigo-400 bg-slate-800'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* ── SECTIONS TAB ─────────────────────────────────────────── */}
          {activeTab === 'sections' && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 text-right mb-3">
                גרור כדי לסדר מחדש · לחץ על העין להסתרה
              </p>
              {local.sections.map((section, idx) => (
                <div
                  key={section.id}
                  draggable
                  onDragStart={() => handleDragStart(section.id)}
                  onDragOver={e => handleDragOver(e, section.id)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none ${
                    draggingId === section.id
                      ? 'opacity-40 border-indigo-500/50 bg-indigo-900/20'
                      : 'border-slate-700/50 bg-slate-800/60 hover:border-slate-600/60'
                  }`}
                >
                  <GripVertical size={14} className="text-slate-600 flex-shrink-0" />

                  <span className={`flex-1 text-xs font-medium text-right ${section.visible ? 'text-slate-200' : 'text-slate-600 line-through'}`}>
                    {SECTION_LABELS[section.id] ?? section.id}
                  </span>

                  {/* Up/Down arrows */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveSection(section.id, -1)}
                      disabled={idx === 0}
                      className="text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors leading-none text-[10px] px-0.5"
                    >▲</button>
                    <button
                      onClick={() => moveSection(section.id, 1)}
                      disabled={idx === local.sections.length - 1}
                      className="text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors leading-none text-[10px] px-0.5"
                    >▼</button>
                  </div>

                  {/* Visibility toggle */}
                  <button
                    onClick={() => toggleSection(section.id)}
                    className={`p-1 rounded-lg transition-colors ${section.visible ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/30' : 'text-slate-600 hover:text-slate-400 hover:bg-slate-700'}`}
                  >
                    {section.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── COLORS TAB ────────────────────────────────────────────── */}
          {activeTab === 'colors' && (
            <div className="space-y-4">
              <p className="text-[11px] text-slate-400 text-right mb-1">
                בחר צבע לכל סטטוס — יוצג כפס צבעוני בצד שמאל של כרטיס הליד
              </p>
              {statuses.map(status => {
                const currentColor = local.statusColors[status] ?? '';
                return (
                  <div key={status} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div
                        className="w-4 h-4 rounded-full border border-slate-600 flex-shrink-0"
                        style={{ background: currentColor || 'transparent' }}
                      />
                      <span className="text-xs font-semibold text-slate-300">{status}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {/* "None" option */}
                      <button
                        onClick={() => {
                          const next = { ...local.statusColors };
                          delete next[status];
                          setLocal(l => ({ ...l, statusColors: next }));
                        }}
                        className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center text-[10px] ${
                          !currentColor ? 'border-white bg-slate-600' : 'border-slate-600 bg-slate-700 hover:border-slate-400'
                        }`}
                      >✕</button>
                      {COLOR_PRESETS.map(color => (
                        <button
                          key={color}
                          onClick={() => setStatusColor(status, color)}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${
                            currentColor === color ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                          }`}
                          style={{ background: color }}
                          title={color}
                        />
                      ))}
                      {/* Custom color input */}
                      <label className="w-6 h-6 rounded-full border border-dashed border-slate-500 flex items-center justify-center cursor-pointer hover:border-slate-400 overflow-hidden" title="צבע מותאם">
                        <input
                          type="color"
                          value={currentColor || '#6366f1'}
                          onChange={e => setStatusColor(status, e.target.value)}
                          className="opacity-0 w-0 h-0 absolute"
                        />
                        <span className="text-[10px] text-slate-500">+</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── HIGHLIGHTS TAB ────────────────────────────────────────── */}
          {activeTab === 'highlights' && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-400 text-right mb-2">
                עד 3 שדות שיוצגו בחלק העליון של הכרטיס (פינצ'ול)
              </p>
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(HIGHLIGHT_FIELD_LABELS).map(([key, label]) => {
                  const isActive = local.highlightFields.includes(key);
                  const isDisabled = !isActive && local.highlightFields.length >= 3;
                  return (
                    <button
                      key={key}
                      onClick={() => !isDisabled && toggleHighlight(key)}
                      disabled={isDisabled}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                          : isDisabled
                          ? 'border-slate-700/30 text-slate-600 cursor-not-allowed'
                          : 'border-slate-700/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-indigo-500/30 text-indigo-400' : 'bg-slate-700 text-slate-500'}`}>
                        {isActive ? `#${local.highlightFields.indexOf(key) + 1}` : '—'}
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              {local.highlightFields.length >= 3 && (
                <p className="text-[10px] text-amber-400/70 text-center">הגעת למקסימום 3 שדות. הסר כדי להוסיף אחר.</p>
              )}
            </div>
          )}

          {/* ── LAYOUT TAB ────────────────────────────────────────────── */}
          {activeTab === 'layout' && (
            <div className="space-y-6">
              {/* View mode */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-300 text-right mb-2">מצב תצוגה</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setLocal(l => ({ ...l, viewMode: 'full' }))}
                    className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border text-xs font-semibold transition-all ${
                      local.viewMode === 'full'
                        ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                        : 'border-slate-700/50 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <Layout size={20} />
                    מלא
                  </button>
                  <button
                    onClick={() => setLocal(l => ({ ...l, viewMode: 'compact' }))}
                    className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border text-xs font-semibold transition-all ${
                      local.viewMode === 'compact'
                        ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                        : 'border-slate-700/50 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <Square size={20} />
                    קומפקטי
                  </button>
                </div>
              </div>

              {/* Column layout */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-300 text-right mb-2">פריסת עמודות (שירותים + תמחור)</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setLocal(l => ({ ...l, columnLayout: '2col' }))}
                    className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border text-xs font-semibold transition-all ${
                      local.columnLayout === '2col'
                        ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                        : 'border-slate-700/50 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <Columns size={20} />
                    2 עמודות
                  </button>
                  <button
                    onClick={() => setLocal(l => ({ ...l, columnLayout: '1col' }))}
                    className={`flex flex-col items-center gap-2 px-3 py-4 rounded-xl border text-xs font-semibold transition-all ${
                      local.columnLayout === '1col'
                        ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                        : 'border-slate-700/50 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <LayoutGrid size={20} />
                    עמודה אחת
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── KANBAN TAB ────────────────────────────────────────────── */}
          {activeTab === 'kanban' && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 text-right mb-3">
                בחר אילו שדות יוצגו בכרטיסי הקנבן
              </p>
              {ALL_KANBAN_FIELDS.map(field => {
                const isActive = local.kanbanFields.includes(field);
                return (
                  <button
                    key={field}
                    onClick={() => toggleKanbanField(field)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                        : 'border-slate-700/50 text-slate-400 hover:border-slate-600 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className={isActive ? 'text-indigo-400' : 'text-slate-500'}>
                      {isActive ? <Eye size={14} /> : <EyeOff size={14} />}
                    </span>
                    <span>{KANBAN_FIELD_LABELS[field] ?? field}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-700/60 px-4 py-3 bg-slate-800/50 flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-700/60 hover:bg-slate-700 transition-all"
          >
            <RotateCcw size={13} />
            איפוס
          </button>
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
          >
            <Save size={13} />
            שמור שינויים
          </button>
        </div>
      </div>
    </div>
  );
}
