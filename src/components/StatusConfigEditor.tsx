import { useState } from 'react';
import { X, Plus, Trash2, Save, Settings2, GripVertical } from 'lucide-react';
import type { StatusConfig, StatusAutomation } from '../lib/statusConfig';
import type { TaskPriority } from '../types';

interface StatusConfigEditorProps {
  configs: StatusConfig[];
  onSave: (configs: StatusConfig[]) => Promise<void>;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#6366f1', '#f97316', '#0ea5e9', '#d97706', '#10b981',
  '#8b5cf6', '#64748b', '#ec4899', '#14b8a6', '#ef4444',
  '#84cc16', '#f59e0b', '#06b6d4', '#a855f7', '#78716c',
];

const PRESET_EMOJIS = [
  '🆕', '⚡', '📅', '📄', '✅', '🔄', '❌', '🔥', '💬', '📞',
  '🎯', '💡', '🚀', '⭐', '🏆', '📌', '🔔', '💰', '🤝', '📊',
];

const SECTION_OPTIONS = [
  { value: '', label: 'ללא' },
  { value: 'meetings', label: 'פגישות' },
  { value: 'proposals', label: 'הצעות מחיר' },
  { value: 'active', label: 'לקוחות פעילים' },
  { value: 'demos', label: 'דמואים' },
  { value: 'follow-up', label: 'מעקב' },
];

const PRIORITY_OPTS: { value: TaskPriority; label: string }[] = [
  { value: 'high', label: 'גבוה 🔴' },
  { value: 'medium', label: 'בינוני 🟠' },
  { value: 'low', label: 'נמוך 🔵' },
];

function newBlankConfig(order: number): StatusConfig {
  return {
    id: `status-${Date.now()}`,
    label: '',
    color: '#6366f1',
    emoji: '📌',
    order,
    isDefault: false,
    pipeline: true,
    description: '',
  };
}

interface EditPanelProps {
  config: StatusConfig;
  onChange: (c: StatusConfig) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function EditPanel({ config, onChange, onCancel, onConfirm }: EditPanelProps) {
  const hasAutomation = !!config.automation?.createTask;

  const setAuto = (auto: StatusAutomation | undefined) => onChange({ ...config, automation: auto });

  return (
    <div className="rounded-2xl p-4 space-y-4" style={{ background: 'rgba(15,20,40,0.98)', border: '1px solid rgba(99,102,241,0.35)' }}>
      {/* Label */}
      <div>
        <label className="block text-xs text-slate-400 mb-1 text-right">שם סטטוס</label>
        <input
          type="text"
          value={config.label}
          onChange={e => onChange({ ...config, label: e.target.value, id: config.isDefault ? config.id : e.target.value || config.id })}
          placeholder="שם הסטטוס..."
          className="w-full px-3 py-2 rounded-xl text-sm text-right focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.3)', color: 'white' }}
          dir="rtl"
        />
      </div>

      {/* Color & Emoji */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1 text-right">אמוג'י</label>
          <div className="flex flex-wrap gap-1">
            {PRESET_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => onChange({ ...config, emoji: e })}
                className={`w-8 h-8 rounded-lg text-sm transition-all ${config.emoji === e ? 'ring-2 ring-indigo-400 bg-indigo-500/30' : 'hover:bg-slate-700/60'}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1 text-right">צבע</label>
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => onChange({ ...config, color: c })}
                className={`w-6 h-6 rounded-lg transition-all ${config.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs text-slate-400 mb-1 text-right">תיאור (לאסיסטנט ה-AI)</label>
        <input
          type="text"
          value={config.description ?? ''}
          onChange={e => onChange({ ...config, description: e.target.value })}
          placeholder="תיאור קצר של הסטטוס..."
          className="w-full px-3 py-2 rounded-xl text-xs text-right focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.2)', color: 'rgba(255,255,255,0.8)' }}
          dir="rtl"
        />
      </div>

      {/* Pipeline toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onChange({ ...config, pipeline: !config.pipeline })}
          className={`relative w-10 h-5 rounded-full transition-colors ${config.pipeline ? 'bg-indigo-500' : 'bg-slate-600'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${config.pipeline ? 'right-0.5' : 'left-0.5'}`} />
        </button>
        <span className="text-xs text-slate-400">הצג בקנבן / פייפליין</span>
      </div>

      {/* Automation */}
      <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              if (hasAutomation) {
                setAuto(config.automation?.dashboardSection ? { dashboardSection: config.automation.dashboardSection } : undefined);
              } else {
                setAuto({ ...config.automation, createTask: { description: 'מעקב עם {{contact}} מ-{{company}}', priority: 'medium', daysOffset: 1 } });
              }
            }}
            className={`relative w-10 h-5 rounded-full transition-colors ${hasAutomation ? 'bg-indigo-500' : 'bg-slate-600'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hasAutomation ? 'right-0.5' : 'left-0.5'}`} />
          </button>
          <span className="text-xs font-semibold text-indigo-300">אוטומציה: יצירת משימה</span>
        </div>

        {hasAutomation && config.automation?.createTask && (
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-slate-500 mb-1 text-right">תיאור משימה (תומך ב-&#123;&#123;company&#125;&#125;, &#123;&#123;contact&#125;&#125;)</label>
              <input
                type="text"
                value={config.automation.createTask.description}
                onChange={e => setAuto({ ...config.automation, createTask: { ...config.automation!.createTask!, description: e.target.value } })}
                className="w-full px-3 py-1.5 rounded-lg text-xs text-right focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.2)', color: 'white' }}
                dir="rtl"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1 text-right">עדיפות</label>
                <select
                  value={config.automation.createTask.priority}
                  onChange={e => setAuto({ ...config.automation, createTask: { ...config.automation!.createTask!, priority: e.target.value as TaskPriority } })}
                  className="w-full px-2 py-1.5 rounded-lg text-xs focus:outline-none"
                  style={{ background: 'rgba(15,20,40,0.9)', border: '1px solid rgba(99,102,241,0.2)', color: 'white' }}
                >
                  {PRIORITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1 text-right">ימים מהיום</label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={config.automation.createTask.daysOffset}
                  onChange={e => setAuto({ ...config.automation, createTask: { ...config.automation!.createTask!, daysOffset: parseInt(e.target.value) || 0 } })}
                  className="w-full px-2 py-1.5 rounded-lg text-xs focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.2)', color: 'white' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Dashboard section */}
        <div className="flex items-center justify-between gap-2">
          <select
            value={config.automation?.dashboardSection ?? ''}
            onChange={e => {
              const val = e.target.value;
              setAuto(val ? { ...config.automation, dashboardSection: val } : config.automation?.createTask ? { createTask: config.automation.createTask } : undefined);
            }}
            className="flex-1 px-2 py-1.5 rounded-lg text-xs focus:outline-none"
            style={{ background: 'rgba(15,20,40,0.9)', border: '1px solid rgba(99,102,241,0.2)', color: 'white' }}
          >
            {SECTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-xs text-slate-400">סקציה בדשבורד</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'rgba(99,102,241,0.9)', color: 'white' }}
        >
          <Save size={14} className="inline ml-1" />
          שמור
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

export default function StatusConfigEditor({ configs: initialConfigs, onSave, onClose }: StatusConfigEditorProps) {
  const [configs, setConfigs] = useState<StatusConfig[]>([...initialConfigs].sort((a, b) => a.order - b.order));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<StatusConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ── Drag-and-drop state ──────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId]   = useState<string | null>(null);

  const handleDragStart = (id: string) => {
    setDraggingId(id);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (id !== draggingId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) { handleDragEnd(); return; }
    setConfigs(prev => {
      const arr = [...prev].sort((a, b) => a.order - b.order);
      const fromIdx = arr.findIndex(c => c.id === draggingId);
      const toIdx   = arr.findIndex(c => c.id === targetId);
      const result  = [...arr];
      const [moved] = result.splice(fromIdx, 1);
      result.splice(toIdx, 0, moved);
      return result.map((c, i) => ({ ...c, order: i }));
    });
    handleDragEnd();
  };
  // ────────────────────────────────────────────────────────────────

  const startEdit = (c: StatusConfig) => {
    setEditingId(c.id);
    setEditDraft({ ...c });
  };

  const confirmEdit = () => {
    if (!editDraft) return;
    setConfigs(prev => prev.map(c => c.id === editingId ? { ...editDraft, order: c.order } : c));
    setEditingId(null);
    setEditDraft(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const addNew = () => {
    const maxOrder = Math.max(...configs.map(c => c.order), -1);
    const blank = newBlankConfig(maxOrder + 1);
    setConfigs(prev => [...prev, blank]);
    startEdit(blank);
  };

  const remove = (id: string) => {
    setConfigs(prev => prev.filter(c => c.id !== id));
    setDeleteConfirm(null);
  };

  const handleSave = async () => {
    setSaving(true);
    const reordered = [...configs].sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }));
    await onSave(reordered);
    setSaving(false);
    onClose();
  };

  const sorted = [...configs].sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
        style={{ background: 'rgba(10,15,30,0.97)', border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 20px 80px rgba(0,0,0,0.6)', maxHeight: '90vh' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <X size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Settings2 size={18} className="text-indigo-400" />
            <h2 className="text-base font-bold text-white">ניהול סטטוסים</h2>
          </div>
        </div>

        {/* Drag hint */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-[11px] text-center" style={{ color: 'rgba(165,180,252,0.45)' }}>
            ✦ גרור את הסטטוסים לשינוי הסדר
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sorted.map(c => (
            <div
              key={c.id}
              draggable={editingId !== c.id}
              onDragStart={() => handleDragStart(c.id)}
              onDragEnd={handleDragEnd}
              onDragOver={e => handleDragOver(e, c.id)}
              onDrop={e => handleDrop(e, c.id)}
              style={{
                opacity: draggingId === c.id ? 0.35 : 1,
                transition: 'opacity 0.15s, transform 0.1s',
              }}
            >
              {editingId === c.id && editDraft ? (
                <EditPanel config={editDraft} onChange={setEditDraft} onCancel={cancelEdit} onConfirm={confirmEdit} />
              ) : (
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    background: dragOverId === c.id
                      ? 'rgba(99,102,241,0.12)'
                      : 'rgba(255,255,255,0.04)',
                    border: dragOverId === c.id
                      ? '1.5px solid rgba(99,102,241,0.6)'
                      : '1px solid rgba(255,255,255,0.08)',
                    boxShadow: dragOverId === c.id ? '0 0 0 3px rgba(99,102,241,0.15)' : 'none',
                  }}
                >
                  {/* Drag handle */}
                  <div
                    className="flex items-center justify-center cursor-grab active:cursor-grabbing flex-shrink-0 rounded-lg transition-colors hover:bg-white/10 p-1"
                    title="גרור לשינוי סדר"
                    style={{ color: 'rgba(255,255,255,0.22)', touchAction: 'none' }}
                  >
                    <GripVertical size={16} />
                  </div>

                  {/* Badge */}
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 flex-shrink-0"
                      style={{ background: c.color + '22', color: c.color, border: `1px solid ${c.color}44` }}
                    >
                      <span>{c.emoji}</span>
                      <span>{c.label || '(ללא שם)'}</span>
                    </span>
                    {c.automation?.createTask && (
                      <span className="text-xs text-slate-500" title={c.automation.createTask.description}>⚙️ אוטו</span>
                    )}
                    {c.automation?.dashboardSection && (
                      <span className="text-xs text-sky-500">📌 {c.automation.dashboardSection}</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(c)}
                      className="px-2.5 py-1 rounded-lg text-xs transition-all hover:bg-indigo-500/20"
                      style={{ color: 'rgba(165,180,252,0.8)' }}
                    >
                      עריכה
                    </button>
                    {!c.isDefault && (
                      deleteConfirm === c.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => remove(c.id)} className="px-2 py-1 rounded text-xs bg-red-500/80 text-white">מחק</button>
                          <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 rounded text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>ביטול</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(c.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                          <Trash2 size={13} style={{ color: 'rgba(248,113,113,0.7)' }} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add new */}
          <button
            onClick={addNew}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all hover:bg-indigo-500/10"
            style={{ border: '1px dashed rgba(99,102,241,0.4)', color: 'rgba(165,180,252,0.7)' }}
          >
            <Plus size={14} />
            הוסף סטטוס
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t flex items-center gap-2" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white' }}
          >
            {saving ? '...' : '💾 שמור הגדרות'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
