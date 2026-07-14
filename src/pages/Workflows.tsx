import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Network, Zap, Sparkles, GitBranch, Plus, Trash2, MessageCircle, Phone, Mail, Clock, X, Play } from 'lucide-react';
import { WorkflowBuilder } from './Agents';
import type { Lead, StandaloneTask } from '../types';

interface WorkflowsProps {
  leads: Lead[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  workspaceId?: string;
}

/* ─── Types ─────────────────────────────────────────────────────────────── */

interface SequenceStep {
  id: string;
  type: 'whatsapp' | 'call' | 'email' | 'wait';
  day: number;
  message?: string;
  note?: string;
}

interface SavedSequence {
  id: string;
  name: string;
  steps: SequenceStep[];
  createdAt: string;
  activatedFor?: string[];
}

/* ─── Step-type config ───────────────────────────────────────────────────── */

const STEP_CONFIG: Record<SequenceStep['type'], {
  label: string; icon: React.ElementType;
  color: string; bg: string; border: string; emoji: string;
}> = {
  whatsapp: { label: 'WA',    icon: MessageCircle, color: '#25d366', bg: 'rgba(37,211,102,0.12)',  border: 'rgba(37,211,102,0.25)',   emoji: '📱' },
  call:     { label: 'שיחה', icon: Phone,          color: '#6366f1', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.25)',   emoji: '📞' },
  email:    { label: 'מייל', icon: Mail,           color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.25)',   emoji: '📧' },
  wait:     { label: 'המתן', icon: Clock,          color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.1)', emoji: '⏳' },
};

/* ─── Initial sequences ──────────────────────────────────────────────────── */

const INITIAL_SEQUENCES: SavedSequence[] = [
  {
    id: 'seq-1',
    name: 'מעקב ליד חדש',
    createdAt: '2026-05-20',
    activatedFor: ['lead-1', 'lead-2', 'lead-3'],
    steps: [
      { id: 's1-1', type: 'whatsapp', day: 1,  message: 'שלום, קיבלתי את פרטיך ואשמח לעזור!' },
      { id: 's1-2', type: 'call',     day: 3,  note: 'התקשר לליד' },
      { id: 's1-3', type: 'whatsapp', day: 7,  message: 'מעקב שני — האם יש שאלות?' },
      { id: 's1-4', type: 'email',    day: 14, message: 'הצעת ערך + קישור' },
      { id: 's1-5', type: 'whatsapp', day: 21, message: 'הודעה אחרונה' },
    ],
  },
  {
    id: 'seq-2',
    name: 'רימרקטינג לקוח ישן',
    createdAt: '2026-05-22',
    activatedFor: ['lead-4'],
    steps: [
      { id: 's2-1', type: 'whatsapp', day: 1,  message: 'היי [שם], מזמן לא דברנו...' },
      { id: 's2-2', type: 'call',     day: 5,  note: 'שיחת רימרקטינג' },
      { id: 's2-3', type: 'whatsapp', day: 12, message: 'עדכון על שירות חדש' },
    ],
  },
];

/* ─── SequenceBuilder ────────────────────────────────────────────────────── */

function SequenceBuilder({ workspaceId }: { workspaceId?: string }) {
  // Persist sequences per-workspace in localStorage so deletions survive page refresh.
  // We do NOT fall back to INITIAL_SEQUENCES — those are demo data the user can delete.
  const storageKey = `crm-sequences-${workspaceId ?? 'default'}`;

  const [sequences, setSequences] = useState<SavedSequence[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as SavedSequence[];
    } catch { /* ignore parse errors */ }
    // First time only: show the sample sequences so the UI isn't empty
    return INITIAL_SEQUENCES;
  });

  const [activeSeq, setActiveSeq]       = useState<string | null>(null);
  const [editingSteps, setEditingSteps] = useState<SequenceStep[]>([]);
  const [newSeqName, setNewSeqName]     = useState('');
  const [building, setBuilding]         = useState(false);

  // Persist to localStorage every time sequences change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sequences));
    } catch { /* storage full or disabled — ignore */ }
  }, [sequences, storageKey]);

  /* helpers */
  const uid = () => Math.random().toString(36).slice(2, 9);

  const openBuilder = (seq?: SavedSequence) => {
    if (seq) {
      setActiveSeq(seq.id);
      setNewSeqName(seq.name);
      setEditingSteps(seq.steps.map(s => ({ ...s })));
    } else {
      setActiveSeq(null);
      setNewSeqName('');
      setEditingSteps([{ id: uid(), type: 'whatsapp', day: 1, message: '' }]);
    }
    setBuilding(true);
  };

  const closeBuilder = () => { setBuilding(false); setActiveSeq(null); };

  const addStep = () => {
    const maxDay = editingSteps.reduce((m, s) => Math.max(m, s.day), 0);
    setEditingSteps(prev => [...prev, { id: uid(), type: 'whatsapp', day: maxDay + 1, message: '' }]);
  };

  const removeStep = (id: string) => setEditingSteps(prev => prev.filter(s => s.id !== id));

  const updateStep = (id: string, patch: Partial<SequenceStep>) =>
    setEditingSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const saveSequence = () => {
    if (!newSeqName.trim() || editingSteps.length === 0) return;
    const sorted = [...editingSteps].sort((a, b) => a.day - b.day);
    if (activeSeq) {
      setSequences(prev => prev.map(s => s.id === activeSeq
        ? { ...s, name: newSeqName, steps: sorted }
        : s));
    } else {
      const newSeq: SavedSequence = {
        id: uid(), name: newSeqName, steps: sorted,
        createdAt: new Date().toISOString().slice(0, 10),
        activatedFor: [],
      };
      setSequences(prev => [...prev, newSeq]);
    }
    closeBuilder();
  };

  const deleteSequence = (id: string) =>
    setSequences(prev => prev.filter(s => s.id !== id));

  /* stats */
  const totalSteps = sequences.reduce((sum, s) => sum + s.steps.length, 0);
  const typeCounts = sequences.flatMap(s => s.steps).reduce<Record<string, number>>((acc, step) => {
    acc[step.type] = (acc[step.type] ?? 0) + 1;
    return acc;
  }, {});
  const topType = (Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'whatsapp') as SequenceStep['type'];

  /* ── render ── */
  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      backdropFilter: 'blur(8px)',
    }}>
      {/* accent bar */}
      <div className="h-1" style={{ background: 'linear-gradient(90deg,#10b981,#6366f1,#f97316)' }}/>

      <div className="p-4 md:p-6 space-y-5">

        {/* Section header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black" style={{ color: 'rgba(255,255,255,0.92)' }}>
              ⚡ רצפי מעקב אוטומטיים
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
              בנה רצפי outreach חכמים — WA, שיחות, מיילים
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs rounded-full px-2.5 py-1 font-bold"
              style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
              {sequences.length} רצפים קיימים
            </span>
            <button onClick={() => openBuilder()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-all"
              style={{ background: 'rgba(99,102,241,0.2)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.35)' }}>
              <Plus size={15}/> צור רצף חדש
            </button>
          </div>
        </div>

        {/* Sequences list */}
        {sequences.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {sequences.map(seq => (
              <div key={seq.id} className="rounded-xl p-4 space-y-3 transition-all"
                style={{
                  background: activeSeq === seq.id ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${activeSeq === seq.id ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}>

                {/* name + badge */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold leading-tight" style={{ color: 'rgba(255,255,255,0.88)' }}>
                    {seq.name}
                  </span>
                  <span className="shrink-0 text-[10px] rounded-full px-2 py-0.5 font-bold"
                    style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}>
                    {seq.steps.length} שלבים
                  </span>
                </div>

                {/* step type icons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {seq.steps.map(step => {
                    const cfg = STEP_CONFIG[step.type];
                    const Icon = cfg.icon;
                    return (
                      <div key={step.id} title={`יום ${step.day} — ${cfg.label}`}
                        className="flex items-center gap-1 rounded-lg px-2 py-1"
                        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                        <Icon size={11} style={{ color: cfg.color }}/>
                        <span className="text-[10px] font-bold" style={{ color: cfg.color }}>{step.day}d</span>
                      </div>
                    );
                  })}
                </div>

                {/* stats */}
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  הופעל {(seq.activatedFor ?? []).length} פעמים · נוצר {seq.createdAt}
                </p>

                {/* actions */}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => openBuilder(seq)}
                    className="flex-1 rounded-lg py-1.5 text-xs font-bold transition-all"
                    style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                    ערוך
                  </button>
                  <button
                    className="flex-1 rounded-lg py-1.5 text-xs font-bold flex items-center justify-center gap-1 transition-all"
                    style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <Play size={11}/> הפעל על ליד
                  </button>
                  <button onClick={() => deleteSequence(seq.id)}
                    className="rounded-lg px-2.5 py-1.5 transition-all"
                    style={{ background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.7)', border: '1px solid rgba(239,68,68,0.15)' }}>
                    <Trash2 size={13}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Builder ── */}
        {building && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>

            {/* builder header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
              <span className="text-sm font-bold" style={{ color: '#a78bfa' }}>
                {activeSeq ? 'עריכת רצף' : 'בונה רצף חדש'}
              </span>
              <button onClick={closeBuilder} style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={16}/>
              </button>
            </div>

            <div className="p-4 space-y-4">

              {/* name input */}
              <input
                value={newSeqName}
                onChange={e => setNewSeqName(e.target.value)}
                placeholder="שם הרצף..."
                className="w-full rounded-xl px-4 py-2.5 text-sm font-bold outline-none"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(99,102,241,0.25)',
                  color: 'rgba(255,255,255,0.9)',
                }}
              />

              {/* Step cards */}
              <div className="space-y-2">
                {editingSteps
                  .slice()
                  .sort((a, b) => a.day - b.day)
                  .map((step, idx) => {
                    const cfg = STEP_CONFIG[step.type];
                    const Icon = cfg.icon;
                    const needsText = step.type === 'whatsapp' || step.type === 'email';

                    return (
                      <div key={step.id}>
                        {/* connector */}
                        {idx > 0 && (
                          <div className="flex items-center gap-2 py-1 px-2">
                            <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.2)' }}/>
                            <span className="text-[10px] rounded-full px-2 py-0.5"
                              style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.15)' }}>
                              יום {step.day}
                            </span>
                            <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.2)' }}/>
                          </div>
                        )}

                        <div className="rounded-xl p-3 space-y-3"
                          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>

                          <div className="flex items-center gap-2">
                            {/* day input */}
                            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
                              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>יום</span>
                              <input
                                type="number" min={1} value={step.day}
                                onChange={e => updateStep(step.id, { day: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="w-10 bg-transparent outline-none text-center text-sm font-bold"
                                style={{ color: cfg.color }}
                              />
                            </div>

                            {/* type selector */}
                            <div className="flex gap-1">
                              {(['whatsapp', 'call', 'email', 'wait'] as SequenceStep['type'][]).map(t => {
                                const tc = STEP_CONFIG[t];
                                const TIcon = tc.icon;
                                const active = step.type === t;
                                return (
                                  <button key={t} onClick={() => updateStep(step.id, { type: t })}
                                    className="rounded-lg px-2.5 py-1.5 flex items-center gap-1 text-[11px] font-bold transition-all"
                                    style={{
                                      background: active ? tc.bg : 'rgba(255,255,255,0.04)',
                                      border: `1px solid ${active ? tc.border : 'rgba(255,255,255,0.06)'}`,
                                      color: active ? tc.color : 'rgba(255,255,255,0.3)',
                                    }}>
                                    <TIcon size={11}/>
                                    <span className="hidden sm:inline">{tc.label}</span>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="flex items-center gap-1 mr-auto">
                              <Icon size={14} style={{ color: cfg.color }}/>
                              <button onClick={() => removeStep(step.id)}
                                className="rounded-lg p-1 ml-1 transition-all"
                                style={{ color: 'rgba(239,68,68,0.6)', background: 'rgba(239,68,68,0.08)' }}>
                                <X size={13}/>
                              </button>
                            </div>
                          </div>

                          {/* message / note */}
                          {needsText ? (
                            <textarea rows={2}
                              value={step.message ?? ''}
                              onChange={e => updateStep(step.id, { message: e.target.value })}
                              placeholder="טקסט ההודעה..."
                              className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                              style={{
                                background: 'rgba(0,0,0,0.2)',
                                border: `1px solid ${cfg.border}`,
                                color: 'rgba(255,255,255,0.8)',
                              }}
                            />
                          ) : (
                            <input
                              value={step.note ?? ''}
                              onChange={e => updateStep(step.id, { note: e.target.value })}
                              placeholder={step.type === 'call' ? 'תזכורת לשיחה...' : 'זמן המתנה / הערה...'}
                              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                              style={{
                                background: 'rgba(0,0,0,0.2)',
                                border: `1px solid ${cfg.border}`,
                                color: 'rgba(255,255,255,0.8)',
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Add step */}
              <button onClick={addStep}
                className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8', border: '1px dashed rgba(99,102,241,0.3)' }}>
                <Plus size={15}/> הוסף שלב
              </button>

              {/* Save */}
              <button onClick={saveSequence}
                disabled={!newSeqName.trim() || editingSteps.length === 0}
                className="w-full rounded-xl py-3 text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                שמור רצף
              </button>

            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              val: sequences.length,
              label: 'רצפים פעילים',
              icon: GitBranch,
              color: '#6366f1',
              bg: 'rgba(99,102,241,0.1)',
              border: 'rgba(99,102,241,0.2)',
            },
            {
              val: totalSteps,
              label: 'סה"כ שלבים',
              icon: Zap,
              color: '#f97316',
              bg: 'rgba(249,115,22,0.1)',
              border: 'rgba(249,115,22,0.2)',
            },
            {
              val: STEP_CONFIG[topType].emoji,
              label: `נפוץ: ${STEP_CONFIG[topType].label}`,
              icon: STEP_CONFIG[topType].icon,
              color: STEP_CONFIG[topType].color,
              bg: STEP_CONFIG[topType].bg,
              border: STEP_CONFIG[topType].border,
            },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-xl p-3 text-center"
                style={{ background: stat.bg, border: `1px solid ${stat.border}` }}>
                <Icon size={15} className="mx-auto mb-1" style={{ color: stat.color }}/>
                <div className="text-lg font-black" style={{ color: stat.color }}>{stat.val}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{stat.label}</div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function Workflows({
  leads, currentUser, onCreateTask, onUpdateLead, onToast, workspaceId,
}: WorkflowsProps) {
  const { isDark, c } = useTheme();
  const activeLeads = leads.filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status)).length;

  return (
    <div className="space-y-5" dir="rtl"
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
        margin: '-1rem -1.5rem',
        padding: '1rem 1.5rem',
      }}>

      {/* ══ HERO ═══════════════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden rounded-2xl px-5 pt-6 pb-5"
        style={{
          background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.15))',
          border: '1px solid rgba(99,102,241,0.3)',
          boxShadow: '0 4px 32px rgba(99,102,241,0.15)',
        }}>

        {/* dot grid */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle,rgba(99,102,241,0.15) 1px,transparent 1px)',
          backgroundSize: '22px 22px',
        }}/>
        {/* glow orbs */}
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle,#6366f140,transparent 70%)' }}/>
        <div className="absolute -bottom-8 left-8 w-28 h-28 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle,#6366f140,transparent 70%)' }}/>
        {/* shimmer top */}
        <div className="absolute top-0 inset-x-0 h-px"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(99,102,241,0.5),transparent)' }}/>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* icon */}
            <div className="relative">
              <div className="w-13 h-13 rounded-2xl flex items-center justify-center shadow-xl"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 8px 28px #8b5cf640', width: 52, height: 52 }}>
                <Network size={24} className="text-white"/>
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-transparent animate-pulse"
                style={{ borderColor: '#0a0f1e' }}/>
            </div>

            {/* title */}
            <div>
              <h1 className="font-black text-xl md:text-2xl leading-none tracking-tight"
                style={{ background: 'linear-gradient(135deg,#a78bfa,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                בונה אוטומציות
              </h1>
              <p className="text-sm font-medium mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                צור אוטומציות חכמות עם AI — WhatsApp, מייל, משימות ועוד
              </p>
            </div>
          </div>

          {/* live badge */}
          <div className="hidden sm:flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)' }}>
              <Zap size={10} style={{ color: '#818cf8' }}/>
              <span className="text-[10px] font-black tracking-widest" style={{ color: '#818cf8' }}>AUTOMATION ENGINE</span>
            </div>
            <span className="text-[10px] flex items-center gap-1.5 font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block"/>
              מוכן לפעולה
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="relative grid grid-cols-3 gap-3 mt-5">
          {[
            { icon: GitBranch, label: 'לידים פעילים',    val: activeLeads,    color:'#818cf8', bg:'rgba(99,102,241,0.12)', border:'rgba(99,102,241,0.25)' },
            { icon: Sparkles,  label: 'אוטומציות זמינות', val: '∞',            color:'#a78bfa', bg:'rgba(139,92,246,0.12)', border:'rgba(139,92,246,0.25)' },
            { icon: Zap,       label: 'פעיל 24/7',        val: '✓',            color:'#10b981', bg:'rgba(16,185,129,0.1)',  border:'rgba(16,185,129,0.25)' },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center backdrop-blur-sm"
              style={{ background: s.bg, border: `1px solid ${s.border}` }}>
              <s.icon size={16} className="mx-auto mb-1.5" style={{ color: s.color }}/>
              <div className="text-lg font-black" style={{ color: s.color }}>{s.val}</div>
              <div className="text-[10px] leading-tight mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ WORKFLOW BUILDER CARD ═══════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(8px)',
        }}>
        {/* top accent */}
        <div className="h-1" style={{ background: 'linear-gradient(90deg,#8b5cf6,#6366f1,#06b6d4)' }}/>
        <div className="p-4 md:p-6">
          <WorkflowBuilder
            leads={leads}
            currentUser={currentUser}
            onCreateTask={onCreateTask}
            onUpdateLead={onUpdateLead}
            onToast={onToast}
            workspaceId={workspaceId}
          />
        </div>
      </div>

      {/* ══ SEQUENCE BUILDER SECTION ════════════════════════════════════════ */}
      <SequenceBuilder workspaceId={workspaceId} />

    </div>
  );
}
