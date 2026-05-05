import { useState, useRef } from 'react';
import {
  X, MessageCircle, Mail, Phone, Save, Plus, Trash2, Brain,
  Clock, Building2, CheckCircle2, Activity, Star, Zap,
  FileText, ListChecks, Loader2, Globe, ChevronDown, AlertCircle,
  Mic, MicOff,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, LeadStatus, TaskPriority } from '../types';
import { SOLUTIONS } from '../data/mockData';
import StatusBadge from './StatusBadge';
import EmailModal from './EmailModal';
import { getApiKey } from '../lib/apiKey';

const PRIORITY_OPTS: { value: TaskPriority; label: string; active: string; idle: string }[] = [
  { value: 'high',   label: '🔴 דחוף',   active: 'bg-red-500 text-white ring-2 ring-red-300',    idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
  { value: 'medium', label: '🟠 בינוני', active: 'bg-amber-500 text-white ring-2 ring-amber-300', idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
  { value: 'low',    label: '🔵 נמוך',   active: 'bg-blue-500 text-white ring-2 ring-blue-300',   idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
];

function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0') && digits.length >= 9) return '+972' + digits.slice(1);
  if (digits.length === 9) return '+972' + digits;
  return '+' + digits;
}

const ALL_STATUSES: LeadStatus[] = [
  'חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש':        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'בתהליך':    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'לקוח פעיל': 'bg-green-500/20 text-green-300 border-green-500/30',
  'רימרקטינג': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'לא רלוונטי': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

type Tab = 'details' | 'tasks' | 'notes' | 'activity';

interface CompanyInsight {
  summary: string;
  industry?: string;
  size?: string;
  salesAngle?: string;
  sources?: string[];
}

interface LeadModalProps {
  lead: Lead;
  onClose: () => void;
  onSave: (updated: Lead) => void;
  onUpdate: (updated: Lead) => void;
  onDelete?: (id: string) => void;
}

export default function LeadModal({ lead, onClose, onSave, onUpdate, onDelete }: LeadModalProps) {
  const [data, setData] = useState<Lead>({ ...lead });
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [newNote, setNewNote] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('09:00');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [aiScoring, setAiScoring] = useState(false);
  const [aiInsight, setAiInsight] = useState<CompanyInsight | null>(null);
  const [aiInsightText, setAiInsightText] = useState('');
  const [aiInsightError, setAiInsightError] = useState('');
  const [showInsight, setShowInsight] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [noteRecording, setNoteRecording] = useState(false);
  const noteRecogRef = useRef<unknown>(null);

  const toggleNoteVoice = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('הדפדפן שלך אינו תומך בהקלטה קולית'); return; }
    if (noteRecording) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (noteRecogRef.current as any)?.stop();
      setNoteRecording(false);
      return;
    }
    const recog = new SR();
    recog.lang = 'he-IL';
    recog.continuous = false;
    recog.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recog.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript;
      setNewNote(prev => (prev ? prev + ' ' + text : text));
    };
    recog.onend = () => setNoteRecording(false);
    recog.onerror = () => setNoteRecording(false);
    recog.start();
    noteRecogRef.current = recog;
    setNoteRecording(true);
  };

  const toggleSolution = (name: string) => {
    setData(d => {
      const existing = d.solutions.find(s => s.name === name);
      if (existing) return { ...d, solutions: d.solutions.filter(s => s.name !== name) };
      return { ...d, solutions: [...d.solutions, { name, inProgress: false, delivered: false }] };
    });
  };


  const addNote = () => {
    if (!newNote.trim()) return;
    const updated = {
      ...data,
      notes: [...data.notes, {
        id: Date.now().toString(),
        text: newNote.trim(),
        author: 'Almog Avraham',
        timestamp: new Date().toLocaleString('he-IL'),
      }]
    };
    setData(updated);
    onUpdate(updated);
    setNewNote('');
  };

  const addTask = () => {
    if (!newTaskDesc.trim() || !newTaskDate) return;
    const updated = {
      ...data,
      tasks: [...data.tasks, {
        id: Date.now().toString(),
        description: newTaskDesc.trim(),
        date: newTaskDate,
        time: newTaskTime,
        completed: false,
        priority: newTaskPriority,
      }]
    };
    setData(updated);
    onUpdate(updated);
    setNewTaskDesc('');
    setNewTaskDate('');
  };

  const toggleTask = (id: string) => {
    const updated = { ...data, tasks: data.tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t) };
    setData(updated);
    onUpdate(updated);
  };

  const deleteTask = (id: string) => {
    const updated = { ...data, tasks: data.tasks.filter(t => t.id !== id) };
    setData(updated);
    onUpdate(updated);
  };

  /* ── AI Company Research ─────────────────────────────────────────────────── */
  const runAiResearch = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setAiInsightError('מפתח API חסר. פתח .env והחלף את VITE_ANTHROPIC_API_KEY במפתח שלך (sk-ant-...).');
      setShowInsight(true);
      return;
    }

    setAiScoring(true);
    setShowInsight(true);
    setAiInsight(null);
    setAiInsightText('');
    setAiInsightError('');

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqPayload: any = {
        model: 'claude-opus-4-6',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `אתה אנליסט מכירות של RAY Digital — סוכנות שיווק דיגיטלית AI לנדל"ן.
חפש מידע על החברה הבאה ותן תמצית מכירות שתעזור לצוות.
ענה בעברית, בצורה קצרה וממוקדת.
פורמט:
🏢 **סקירה**: [2-3 משפטים על החברה/פרויקט]
🏗️ **תחום**: [סוג הנדל"ן / פרויקטים]
📊 **גודל**: [עובדים/פרויקטים אם ידוע]
💡 **זווית מכירה**: [למה שיווק דיגיטלי AI של RAY מתאים לחברה זו]`,
        messages: [{
          role: 'user',
          content: `חפש מידע עדכני על החברה: "${data.company}".
מידע שיש לי: סטטוס=${data.status}, תקציב שיווק=₪${data.budget}/חודש, שירותים=${data.solutions.map(s => s.name).join(', ') || 'לא ידוע'}.
תן לי מידע שיעזור לי למכור להם שירותי שיווק דיגיטלי AI של RAY Digital.`,
        }],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let finalText = '';
      const searchedFor: string[] = [];

      // Agentic loop for web search
      for (let turn = 0; turn < 4; turn++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await (client.messages as any).create(reqPayload);
        const content: unknown[] = response.content || [];

        const textParts = content
          .filter((b: unknown) => (b as { type: string }).type === 'text')
          .map((b: unknown) => (b as { text: string }).text)
          .join('');

        const toolUses = content.filter(
          (b: unknown) => (b as { type: string }).type === 'tool_use'
        ) as { id: string; name: string; input: { query?: string } }[];

        // Stream text to UI as it builds up
        if (textParts) {
          finalText = textParts;
          setAiInsightText(finalText);
        }

        // Track search queries
        for (const tu of toolUses) {
          if (tu.name === 'web_search' && tu.input?.query) {
            searchedFor.push(tu.input.query);
          }
        }

        if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
          // Also update AI score based on status
          const scoreMap: Record<string, number> = {
            'לקוח פעיל': 85, 'בתהליך': 65,
            'חדש': 40, 'רימרקטינג': 30, 'לא רלוונטי': 10,
          };
          const baseScore = scoreMap[data.status] ?? 35;
          const budgetBonus = Math.min(20, Math.floor((data.budget ?? 0) / 2000));
          const solutionsBonus = Math.min(10, data.solutions.length * 3);
          const score = Math.min(99, baseScore + budgetBonus + solutionsBonus);
          setData(d => ({ ...d, aiScore: score }));
          setAiInsight({ summary: finalText, sources: searchedFor });
          break;
        }

        if (response.stop_reason === 'tool_use') {
          reqPayload.messages = [
            ...reqPayload.messages,
            {
              role: 'assistant',
              content: content.filter(
                (b: unknown) => ['text', 'tool_use'].includes((b as { type: string }).type)
              ),
            },
            {
              role: 'user',
              content: toolUses.map(tu => ({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: [{ type: 'text', text: 'Search results will be provided.' }],
              })),
            },
          ];
        }
      }
    } catch (err) {
      console.error('AI research failed:', err);
      setAiInsightError('לא הצלחתי לחפש מידע על החברה. נסה שוב.');
      // Fallback: just update score
      const scoreMap: Record<string, number> = {
        'לקוח פעיל': 85, 'בתהליך': 65,
        'חדש': 40, 'רימרקטינג': 30, 'לא רלוונטי': 10,
      };
      const budgetBonus = Math.min(20, Math.floor((data.budget ?? 0) / 2000));
      const score = Math.min(99, (scoreMap[data.status] ?? 35) + budgetBonus);
      setData(d => ({ ...d, aiScore: score }));
    } finally {
      setAiScoring(false);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => { onSave(data); }, 500);
  };

  const completedTasks = data.tasks.filter(t => t.completed).length;
  const scoreColor = data.aiScore >= 75 ? '#22c55e' : data.aiScore >= 50 ? '#f97316' : '#818cf8';

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'details',  label: 'פרטים',  icon: <Building2 size={13} /> },
    { key: 'tasks',    label: 'משימות', icon: <ListChecks size={13} />, badge: data.tasks.filter(t => !t.completed).length },
    { key: 'notes',    label: 'הערות',  icon: <FileText size={13} />,  badge: data.notes.length },
    { key: 'activity', label: 'פעילות', icon: <Activity size={13} /> },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm md:p-4 overflow-y-auto">
        <div className="bg-slate-900 text-white md:rounded-2xl w-full md:max-w-2xl md:my-4 shadow-2xl border-0 md:border border-slate-700/50 overflow-hidden min-h-screen md:min-h-0">

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="relative bg-gradient-to-l from-slate-800 to-slate-900 border-b border-slate-700/60">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors p-1.5 hover:bg-slate-700 rounded-lg flex-shrink-0"
              >
                <X size={16} />
              </button>

              <div className="flex-1 text-right mx-4">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[data.status]}`}>
                    {data.status}
                  </span>
                  <h2 className="text-xl font-bold text-white leading-none">{data.company}</h2>
                </div>
                <p className="text-slate-400 text-sm">{data.contactName}</p>
                <div className="flex items-center gap-3 mt-1.5 justify-end flex-wrap">
                  {data.email && (
                    <a href={`mailto:${data.email}`}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                      <Mail size={11} />{data.email}
                    </a>
                  )}
                  {data.phone && (
                    <a href={`tel:${data.phone}`}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                      <Phone size={11} />{data.phone}
                    </a>
                  )}
                </div>
              </div>

              {/* AI Score */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <div
                  className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center border-2 shadow-lg"
                  style={{ borderColor: scoreColor + '60', background: scoreColor + '15' }}
                >
                  <div className="text-2xl font-black leading-none" style={{ color: scoreColor }}>
                    {data.aiScore}
                  </div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">AI</div>
                </div>
                <div className="w-16 bg-slate-700/60 rounded-full h-1">
                  <div className="h-1 rounded-full transition-all duration-700"
                    style={{ width: `${data.aiScore}%`, background: `linear-gradient(to right, #404040, #f97316)` }} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 px-4 md:px-5 pb-4 flex-wrap">
              {data.phone && (
                <button
                  onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(data.phone)}`, '_blank')}
                  className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg hover:shadow-green-500/20"
                >
                  <MessageCircle size={13} />WhatsApp
                </button>
              )}

              {/* SMART EMAIL BUTTON */}
              {data.email && (
                <button
                  onClick={() => setShowEmail(true)}
                  className="flex items-center gap-1.5 bg-neutral-800 hover:bg-black text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg"
                >
                  <Mail size={13} />מייל חכם ✨
                </button>
              )}

              {data.phone && (
                <button
                  onClick={() => window.open(`tel:${data.phone}`, '_blank')}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Phone size={13} />התקשר
                </button>
              )}

              {/* AI RESEARCH BUTTON */}
              <button
                onClick={runAiResearch}
                disabled={aiScoring}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all mr-auto"
              >
                {aiScoring ? (
                  <><Loader2 size={13} className="animate-spin" />חוקר...</>
                ) : (
                  <><Brain size={13} />ניתוח AI</>
                )}
              </button>
            </div>

            {/* AI Research Panel */}
            {showInsight && (
              <div className="mx-5 mb-4 bg-slate-800/80 border border-white/20 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50">
                  <button
                    onClick={() => setShowInsight(false)}
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <X size={14} />
                  </button>
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                    {aiScoring ? (
                      <><Loader2 size={12} className="animate-spin" /><Globe size={12} />חוקר את {data.company}...</>
                    ) : (
                      <><Globe size={12} />מחקר AI — {data.company}</>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {aiInsightError ? (
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle size={13} />{aiInsightError}
                    </div>
                  ) : aiInsightText ? (
                    <>
                      {aiInsightText}
                      {aiScoring && <span className="inline-block w-1 h-3.5 bg-neutral-400 animate-pulse ml-0.5 rounded-sm" />}
                      {aiInsight?.sources && aiInsight.sources.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-wrap gap-1">
                          {aiInsight.sources.map((s, i) => (
                            <span key={i} className="flex items-center gap-1 bg-indigo-900/40 text-indigo-400 px-1.5 py-0.5 rounded text-[10px]">
                              <Globe size={8} />{s}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 size={12} className="animate-spin" />מחפש מידע באינטרנט...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <div className="flex border-b border-slate-700/60 bg-slate-800/50">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-all ${
                  activeTab === tab.key
                    ? 'text-white border-b-2 border-white bg-slate-800'
                    : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center ${
                    activeTab === tab.key ? 'bg-white text-black' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab Content ────────────────────────────────────────────────── */}
          <div className="p-4 md:p-5 space-y-4 max-h-[calc(100vh-280px)] md:max-h-[55vh] overflow-y-auto">

            {/* DETAILS TAB */}
            {activeTab === 'details' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {/* Solutions */}
                  <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                    <h3 className="text-xs font-bold text-slate-400 mb-3 text-right uppercase tracking-wider flex items-center gap-1.5 justify-end">
                      פתרונות <Zap size={11} className="text-orange-400" />
                    </h3>
                    <div className="space-y-2">
                      {SOLUTIONS.map(sol => {
                        const active = data.solutions.find(s => s.name === sol);
                        return (
                          <div key={sol} className="space-y-1">
                            <button
                              onClick={() => toggleSolution(sol)}
                              className={`w-full text-right px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                active
                                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/20'
                                  : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {sol}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Budget */}
                  <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                    <h3 className="text-xs font-bold text-slate-400 mb-3 text-right uppercase tracking-wider flex items-center gap-1.5 justify-end">
                      תקציב שיווק <Star size={11} className="text-amber-400" />
                    </h3>
                    <div className="space-y-2">
                      <input
                        type="number"
                        placeholder="תקציב חודשי (₪)"
                        value={data.budget || ''}
                        onChange={e => setData(d => ({ ...d, budget: parseInt(e.target.value) || 0 }))}
                        className="w-full bg-slate-700/80 text-white placeholder-slate-500 px-3 py-2 rounded-lg text-xs text-right focus:outline-none focus:ring-2 focus:ring-orange-500 border border-slate-600/50"
                      />
                      {(data.budget ?? 0) > 0 && (
                        <div className={`text-center py-2 rounded-lg text-sm font-bold ${
                          (data.budget ?? 0) >= 15000
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-700/60 text-slate-300'
                        }`}>
                          ₪{(data.budget ?? 0).toLocaleString()}/חודש
                          {(data.budget ?? 0) >= 15000 && ' 🌟 VIP'}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-1 mt-1">
                        {[5000, 10000, 20000].map(val => (
                          <button
                            key={val}
                            onClick={() => setData(d => ({ ...d, budget: val }))}
                            className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              data.budget === val
                                ? 'bg-orange-500 text-white'
                                : 'bg-slate-700/80 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            ₪{(val / 1000)}K
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status selector */}
                <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <StatusBadge status={data.status} />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">שינוי סטטוס</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {ALL_STATUSES.map(s => (
                      <button
                        key={s}
                        onClick={() => setData(d => ({ ...d, status: s }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          data.status === s
                            ? 'bg-white text-black ring-2 ring-white/30 shadow-sm'
                            : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700 border border-slate-600/30'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Waiting Content toggle */}
                <div
                  onClick={() => setData(d => ({ ...d, waitingContent: !d.waitingContent }))}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                    data.waitingContent
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'bg-slate-800/80 border-slate-700/50 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    data.waitingContent ? 'border-amber-400 bg-amber-400' : 'border-slate-600'
                  }`}>
                    {data.waitingContent && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <span className="text-xs font-semibold">ממתין לתוכן מהלקוח</span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                    <div className="text-lg font-bold text-white">
                      {data.budget > 0 ? `₪${(data.budget / 1000).toFixed(0)}K` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">תקציב/חודש</div>
                  </div>
                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                    <div className="text-xl font-bold text-white">{data.solutions.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">שירותים</div>
                  </div>
                  <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                    <div className="text-xl font-bold text-white">{data.tasks.filter(t => !t.completed).length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">משימות פתוחות</div>
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSave}
                  className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                    saved
                      ? 'bg-green-600 text-white shadow-sm shadow-green-500/20'
                      : 'bg-white hover:bg-neutral-100 text-black shadow-sm hover:shadow-md'
                  }`}
                >
                  {saved ? <><CheckCircle2 size={16} />נשמר!</> : <><Save size={16} />שמור שינויים</>}
                </button>

                {/* Delete button */}
                {onDelete && (
                  <button
                    onClick={() => {
                      if (deleteConfirm) {
                        onDelete(data.id);
                        onClose();
                      } else {
                        setDeleteConfirm(true);
                        setTimeout(() => setDeleteConfirm(false), 3000);
                      }
                    }}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all border ${
                      deleteConfirm
                        ? 'bg-red-600 text-white border-red-500 shadow-sm shadow-red-500/30'
                        : 'bg-transparent text-slate-500 border-slate-700 hover:border-red-500 hover:text-red-400'
                    }`}
                  >
                    <Trash2 size={14} />
                    {deleteConfirm ? 'לחץ שוב לאישור מחיקה' : 'מחק ליד'}
                  </button>
                )}
              </>
            )}

            {/* TASKS TAB */}
            {activeTab === 'tasks' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded-lg">
                    {completedTasks}/{data.tasks.length} הושלמו
                  </span>
                  <h3 className="text-sm font-bold text-slate-200">משימות הליד</h3>
                </div>

                {/* Add task form */}
                <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50 space-y-3">
                  <input
                    type="text"
                    placeholder="תיאור המשימה..."
                    value={newTaskDesc}
                    onChange={e => setNewTaskDesc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTask()}
                    className="w-full bg-slate-700/80 text-white placeholder-slate-500 px-3 py-2.5 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-slate-600/50"
                  />
                  <div className="flex gap-1.5 justify-end">
                    {PRIORITY_OPTS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setNewTaskPriority(opt.value)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          newTaskPriority === opt.value ? opt.active : opt.idle
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={addTask}
                      disabled={!newTaskDesc.trim() || !newTaskDate}
                      className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
                    >
                      <Plus size={13} />הוסף
                    </button>
                    <input type="time" value={newTaskTime} onChange={e => setNewTaskTime(e.target.value)}
                      className="bg-slate-700/80 border border-slate-600/50 text-white px-2 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 w-24" />
                    <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)}
                      className="flex-1 bg-slate-700/80 border border-slate-600/50 text-white px-2 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                </div>

                {/* Tasks list */}
                {data.tasks.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-10 bg-slate-800/40 rounded-xl border border-slate-700/30">
                    <div className="text-3xl mb-2">📋</div>
                    אין משימות — הוסף משימה למעלה
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.tasks.map(task => (
                      <div key={task.id} className={`group flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${
                        task.completed ? 'bg-slate-800/40 border-slate-700/30 opacity-60' : 'bg-slate-800/80 border-slate-700/50 hover:border-slate-600'
                      }`}>
                        <button onClick={() => deleteTask(task.id)}
                          className="text-slate-700 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100">
                          <Trash2 size={12} />
                        </button>
                        <div className="flex-1 text-right">
                          <div className={`text-sm font-medium ${task.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                            {task.description}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 justify-end mt-1">
                            {task.priority && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                task.priority === 'high' ? 'bg-red-900/60 text-red-400' :
                                task.priority === 'low'  ? 'bg-blue-900/60 text-blue-400' :
                                'bg-amber-900/60 text-amber-400'
                              }`}>
                                {task.priority === 'high' ? 'דחוף' : task.priority === 'low' ? 'נמוך' : 'בינוני'}
                              </span>
                            )}
                            <span>{task.time}</span>
                            <Clock size={10} />
                            <span>{task.date}</span>
                          </div>
                        </div>
                        <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)}
                          className="rounded accent-indigo-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* NOTES TAB */}
            {activeTab === 'notes' && (
              <div className="space-y-3">
                <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                  <div className="flex gap-2">
                    <button onClick={addNote} disabled={!newNote.trim()}
                      className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors">
                      הוסף
                    </button>
                    <div className="flex-1 relative">
                      <input type="text" placeholder="כתוב הערה..." value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addNote()}
                        className="w-full bg-slate-700/80 border border-slate-600/50 text-white placeholder-slate-500 pr-3 pl-10 py-2.5 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button
                        onClick={toggleNoteVoice}
                        title={noteRecording ? 'עצור הקלטה' : 'הקלט הערה קולית'}
                        className={`absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${
                          noteRecording
                            ? 'bg-red-500 text-white animate-pulse'
                            : 'text-slate-400 hover:text-white hover:bg-slate-600'
                        }`}
                      >
                        {noteRecording ? <MicOff size={14} /> : <Mic size={14} />}
                      </button>
                    </div>
                  </div>
                  {noteRecording && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      מקליט... דבר עכשיו בעברית
                    </div>
                  )}
                </div>
                {data.notes.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-10 bg-slate-800/40 rounded-xl border border-slate-700/30">
                    <div className="text-3xl mb-2">💬</div>
                    אין הערות עדיין
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...data.notes].reverse().map(note => (
                      <div key={note.id} className="bg-slate-800/80 rounded-xl px-4 py-3.5 border border-slate-700/50">
                        <p className="text-sm text-slate-200 text-right leading-relaxed">{note.text}</p>
                        <div className="flex justify-end gap-2 mt-2 text-xs text-slate-500">
                          <span>{note.timestamp}</span>
                          <span>·</span>
                          <span className="text-slate-400">{note.author}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ACTIVITY TAB */}
            {activeTab === 'activity' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-sm font-bold text-slate-200">היסטוריית פעילות</span>
                  <Activity size={15} className="text-indigo-400" />
                </div>
                {data.notes.length === 0 && data.tasks.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-10 bg-slate-800/40 rounded-xl border border-slate-700/30">
                    <div className="text-3xl mb-2">📊</div>
                    אין פעילות עדיין
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[
                      ...data.notes.map(n => ({ type: 'note', text: n.text, time: n.timestamp, author: n.author, completed: undefined })),
                      ...data.tasks.map(t => ({ type: 'task', text: t.description, time: `${t.date} ${t.time}`, author: 'Almog Avraham', completed: t.completed })),
                      { type: 'update', text: `עדכון אחרון: ${data.lastUpdate}`, time: data.lastUpdate, author: 'מערכת', completed: undefined },
                    ]
                      .sort((a, b) => b.time.localeCompare(a.time))
                      .map((item, i) => (
                        <div key={i} className="flex items-start gap-3 bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/30">
                          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5 ${
                            item.type === 'note' ? 'bg-blue-500/20 text-blue-400' :
                            item.type === 'task' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-slate-700 text-slate-400'
                          }`}>
                            {item.type === 'note' ? '💬' : item.type === 'task' ? '✓' : '📋'}
                          </div>
                          <div className="flex-1 text-right">
                            <div className={`text-sm ${item.completed ? 'line-through text-slate-500' : 'text-slate-300'}`}>
                              {item.text}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{item.time} · {item.author}</div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-slate-700/60 bg-slate-800/30 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Star size={10} className="text-amber-400" />{data.source}
              </span>
              <span>{data.assignedTo}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ChevronDown size={11} />
              עודכן {data.lastUpdate}
            </div>
          </div>
        </div>
      </div>

      {/* Smart Email Modal */}
      {showEmail && (
        <EmailModal lead={data} onClose={() => setShowEmail(false)} />
      )}
    </>
  );
}
