import { useState } from 'react';
import { X, MessageCircle, Mail, Phone, Save, Plus, Trash2, Brain, TrendingUp, Clock, Building2, CheckCircle2, Activity } from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, LeadStatus, Bank } from '../types';
import { BANKS, SOLUTIONS } from '../data/mockData';
import StatusBadge from './StatusBadge';

/** ממיר מספר טלפון ישראלי לפורמט וואטסאפ בינלאומי */
function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0') && digits.length >= 9) return '+972' + digits.slice(1);
  if (digits.length === 9) return '+972' + digits;
  return '+' + digits;
}

const ALL_STATUSES: LeadStatus[] = [
  'חדש', 'הקמת כספת בבנק', 'הטמעה', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

type Tab = 'details' | 'tasks' | 'notes' | 'activity';

interface LeadModalProps {
  lead: Lead;
  onClose: () => void;
  onSave: (updated: Lead) => void;
  onUpdate: (updated: Lead) => void;
}

export default function LeadModal({ lead, onClose, onSave, onUpdate }: LeadModalProps) {
  const [data, setData] = useState<Lead>({ ...lead });
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [newNote, setNewNote] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('09:00');
  const [aiScoring, setAiScoring] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleBank = (bank: Bank) => {
    setData(d => ({
      ...d,
      banks: d.banks.includes(bank) ? d.banks.filter(b => b !== bank) : [...d.banks, bank]
    }));
  };

  const toggleSolution = (name: string) => {
    setData(d => {
      const existing = d.solutions.find(s => s.name === name);
      if (existing) return { ...d, solutions: d.solutions.filter(s => s.name !== name) };
      return { ...d, solutions: [...d.solutions, { name, hasInstallation: false, hasTraining: false }] };
    });
  };

  const toggleSolutionFlag = (name: string, flag: 'hasInstallation' | 'hasTraining') => {
    setData(d => ({
      ...d,
      solutions: d.solutions.map(s => s.name === name ? { ...s, [flag]: !s[flag] } : s)
    }));
  };

  const addNote = () => {
    if (!newNote.trim()) return;
    setData(d => ({
      ...d,
      notes: [...d.notes, {
        id: Date.now().toString(),
        text: newNote.trim(),
        author: 'Almog Avraham',
        timestamp: new Date().toLocaleString('he-IL'),
      }]
    }));
    setNewNote('');
  };

  const addTask = () => {
    if (!newTaskDesc.trim() || !newTaskDate) return;
    const newTask = {
      id: Date.now().toString(),
      description: newTaskDesc.trim(),
      date: newTaskDate,
      time: newTaskTime,
      completed: false,
    };
    const updated = { ...data, tasks: [...data.tasks, newTask] };
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

  const simulateAI = async () => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
    if (!apiKey) return;
    setAiScoring(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 5,
        messages: [{
          role: 'user',
          content: `Score this sales lead 0-100 for conversion potential. Reply with ONLY a number, nothing else.

Company: ${data.company}
Status: ${data.status}
Monthly checks: ${data.checkCount}
Banks: ${data.banks.join(', ') || 'none'}
Solutions: ${data.solutions.map(s => s.name).join(', ') || 'none'}
Waiting G3 approval: ${data.waitingG3 ? 'yes' : 'no'}
Open tasks: ${data.tasks.filter(t => !t.completed).length}
Notes: ${data.notes.length}

Scoring: active client=80-100, implementation=55-80, vault setup=40-60, new with 100+ checks=60-80, remarketing=20-45, irrelevant=0-20. More checks and banks = higher score.`,
        }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const score = parseInt(text);
      if (!isNaN(score) && score >= 0 && score <= 100) {
        setData(d => ({ ...d, aiScore: score }));
      }
    } catch (err) {
      console.error('AI scoring failed:', err);
    } finally {
      setAiScoring(false);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      onSave(data);
    }, 500);
  };

  const completedTasks = data.tasks.filter(t => t.completed).length;
  const scoreColor = data.aiScore >= 75 ? '#22c55e' : data.aiScore >= 50 ? '#f97316' : '#6366f1';

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'details', label: 'פרטים' },
    { key: 'tasks', label: 'משימות', badge: data.tasks.filter(t => !t.completed).length },
    { key: 'notes', label: 'הערות', badge: data.notes.length },
    { key: 'activity', label: 'פעילות' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 text-white rounded-2xl w-full max-w-2xl my-4 shadow-2xl border border-slate-700/50">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700/60">
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors mt-0.5 p-1 hover:bg-slate-700 rounded-lg">
            <X size={18} />
          </button>
          <div className="flex-1 text-right mr-3">
            <h2 className="text-lg font-bold text-white">{data.company}</h2>
            <p className="text-slate-400 text-sm">{data.contactName}</p>
            <div className="flex items-center gap-3 mt-1.5 justify-end">
              {data.email && (
                <a href={`mailto:${data.email}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors">
                  <Mail size={11} />{data.email}
                </a>
              )}
              {data.phone && (
                <a href={`tel:${data.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors">
                  <Phone size={11} />{data.phone}
                </a>
              )}
            </div>
          </div>
          {/* AI Score */}
          <div className="text-left min-w-[80px]">
            <div className="text-xs text-slate-500 mb-1 uppercase tracking-wide">AI Score</div>
            <div className="text-3xl font-bold" style={{ color: scoreColor }}>{data.aiScore}</div>
            <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1.5">
              <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${data.aiScore}%`, background: `linear-gradient(to right, #6366f1, #f97316)` }} />
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(data.phone)}`, '_blank')}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <MessageCircle size={14} />WhatsApp
          </button>
          <button
            onClick={() => window.open(`mailto:${data.email}`, '_blank')}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Mail size={14} />מייל
          </button>
          <button
            onClick={() => window.open(`tel:${data.phone}`, '_blank')}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Phone size={14} />התקשר
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-4 border-b border-slate-700/60">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-5 space-y-4">
          {/* DETAILS TAB */}
          {activeTab === 'details' && (
            <>
              {/* Solutions + Banks */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-slate-400 mb-3 text-right uppercase tracking-wide">פתרונות</h3>
                  <div className="space-y-2">
                    {SOLUTIONS.map(sol => {
                      const active = data.solutions.find(s => s.name === sol);
                      return (
                        <div key={sol} className="space-y-1">
                          <button
                            onClick={() => toggleSolution(sol)}
                            className={`w-full text-right px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              active ? 'bg-orange-500/90 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                          >
                            {sol}
                          </button>
                          {active && (
                            <div className="flex gap-3 px-2">
                              {[['hasInstallation', 'התקנה'], ['hasTraining', 'הדרכה']].map(([flag, label]) => (
                                <label key={flag} className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={active[flag as 'hasInstallation' | 'hasTraining']}
                                    onChange={() => toggleSolutionFlag(sol, flag as 'hasInstallation' | 'hasTraining')}
                                    className="rounded accent-orange-500"
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-slate-400 mb-3 text-right uppercase tracking-wide">בנקים</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {BANKS.map(bank => (
                      <button
                        key={bank}
                        onClick={() => toggleBank(bank)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          data.banks.includes(bank) ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {bank}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3">
                    <input
                      type="number"
                      placeholder="כמות צ'קים בחודש"
                      value={data.checkCount || ''}
                      onChange={e => setData(d => ({ ...d, checkCount: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-700 text-white placeholder-slate-500 px-3 py-2 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 mt-2.5 text-sm text-slate-400 cursor-pointer justify-end">
                    ממתין לאישור G3
                    <input
                      type="checkbox"
                      checked={data.waitingG3}
                      onChange={e => setData(d => ({ ...d, waitingG3: e.target.checked }))}
                      className="rounded accent-blue-500"
                    />
                  </label>
                </div>
              </div>

              {/* Status Update */}
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={data.status} />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">עדכון סטטוס</span>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  {ALL_STATUSES.map(s => (
                    <button
                      key={s}
                      onClick={() => setData(d => ({ ...d, status: s }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        data.status === s ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-1 ring-offset-slate-800' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Section */}
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-2">
                    <button className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
                      <TrendingUp size={12} />דירוג מכירות
                    </button>
                    <button
                      onClick={simulateAI}
                      disabled={aiScoring}
                      className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                    >
                      <Brain size={12} />
                      {aiScoring ? 'מנתח...' : 'ניתוח AI'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">ניתוח שוק</span>
                    <Building2 size={15} className="text-slate-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs font-bold" style={{ color: scoreColor }}>{data.aiScore}%</div>
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${data.aiScore}%`, background: 'linear-gradient(to right, #6366f1, #f97316)' }} />
                  </div>
                  <div className="text-xs text-slate-500">פוטנציאל</div>
                </div>
              </div>

              {/* Save Button */}
              <button
                onClick={handleSave}
                className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                  saved ? 'bg-green-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
              >
                {saved ? <><CheckCircle2 size={16} />נשמר!</> : <><Save size={16} />שמור הכל</>}
              </button>
            </>
          )}

          {/* TASKS TAB */}
          {activeTab === 'tasks' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{completedTasks}/{data.tasks.length} הושלמו</span>
                <h3 className="text-sm font-semibold text-slate-200">משימות</h3>
              </div>

              {/* Add task */}
              <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                <input
                  type="text"
                  placeholder="תיאור משימה..."
                  value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  className="w-full bg-slate-700 text-white placeholder-slate-500 px-3 py-2 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addTask}
                    disabled={!newTaskDesc.trim() || !newTaskDate}
                    className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Plus size={12} />הוסף
                  </button>
                  <input type="time" value={newTaskTime} onChange={e => setNewTaskTime(e.target.value)}
                    className="bg-slate-700 text-white px-2 py-2 rounded-lg text-xs focus:outline-none w-24" />
                  <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)}
                    className="flex-1 bg-slate-700 text-white px-2 py-2 rounded-lg text-xs focus:outline-none" />
                </div>
              </div>

              {/* Tasks list */}
              {data.tasks.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">אין משימות — הוסף משימה למעלה</div>
              ) : (
                <div className="space-y-2">
                  {data.tasks.map(task => (
                    <div key={task.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${
                      task.completed ? 'bg-slate-800/50 border-slate-700/50' : 'bg-slate-800 border-slate-700'
                    }`}>
                      <button onClick={() => deleteTask(task.id)} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
                        <Trash2 size={12} />
                      </button>
                      <div className="flex-1 text-right">
                        <div className={`text-sm ${task.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                          {task.description}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500 justify-end mt-0.5">
                          <span>{task.time}</span>
                          <Clock size={10} />
                          <span>{task.date}</span>
                        </div>
                      </div>
                      <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)}
                        className="rounded accent-indigo-500 w-4 h-4 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* NOTES TAB */}
          {activeTab === 'notes' && (
            <div className="space-y-3">
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="flex gap-2">
                  <button
                    onClick={addNote}
                    disabled={!newNote.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                  >
                    הוסף
                  </button>
                  <input
                    type="text"
                    placeholder="כתוב הערה..."
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addNote()}
                    className="flex-1 bg-slate-700 text-white placeholder-slate-500 px-3 py-2 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {data.notes.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">אין הערות עדיין</div>
              ) : (
                <div className="space-y-2">
                  {[...data.notes].reverse().map(note => (
                    <div key={note.id} className="bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50">
                      <p className="text-sm text-slate-200 text-right leading-relaxed">{note.text}</p>
                      <div className="flex justify-end gap-2 mt-2 text-xs text-slate-500">
                        <span>{note.timestamp}</span>
                        <span>·</span>
                        <span>{note.author}</span>
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
              <div className="flex items-center gap-2 justify-end mb-2">
                <span className="text-sm font-semibold text-slate-300">היסטוריית פעילות</span>
                <Activity size={15} className="text-indigo-400" />
              </div>
              <div className="space-y-2">
                {[
                  ...data.notes.map(n => ({ type: 'note', text: n.text, time: n.timestamp, author: n.author })),
                  ...data.tasks.map(t => ({ type: 'task', text: t.description, time: `${t.date} ${t.time}`, author: 'Almog Avraham', completed: t.completed })),
                  { type: 'update', text: `עדכון אחרון: ${data.lastUpdate}`, time: data.lastUpdate, author: 'מערכת' },
                ]
                  .sort((a, b) => b.time.localeCompare(a.time))
                  .map((item, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs mt-0.5 ${
                        item.type === 'note' ? 'bg-blue-500/20 text-blue-400' :
                        item.type === 'task' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {item.type === 'note' ? '💬' : item.type === 'task' ? '✓' : '📋'}
                      </div>
                      <div className="flex-1 text-right">
                        <div className={`text-sm ${'completed' in item && item.completed ? 'line-through text-slate-500' : 'text-slate-300'}`}>
                          {item.text}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.time} · {item.author}</div>
                      </div>
                    </div>
                  ))}
              </div>
              {data.notes.length === 0 && data.tasks.length === 0 && (
                <div className="text-center text-slate-500 text-sm py-8">אין פעילות עדיין</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
