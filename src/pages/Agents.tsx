import { useState, useEffect, useCallback } from 'react';
import {
  Bot, TrendingUp, AlertTriangle, BarChart3,
  MessageCircle, CheckCircle2, Clock, Loader2, Copy,
  Phone, DollarSign, Activity,
  Sparkles, RefreshCw, Brain, Star,
  Users, Calendar, Target, Zap,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, TeamMember, StandaloneTask, TaskPriority } from '../types';
import { getApiKey } from '../lib/apiKey';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ─── Types ────────────────────────────────────────────────────────────────── */
type AgentTab = 'followup' | 'forecast' | 'alerts' | 'roi' | 'proposal';

interface AgentsProps {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function parseDateHE(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

function daysSinceUpdate(lead: Lead): number {
  const date = parseDateHE(lead.lastUpdate);
  if (!date) return 999;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
}

function closeProbability(lead: Lead): number {
  const base: Record<Lead['status'], number> = {
    'חדש': 0.08, 'בתהליך': 0.38, 'לקוח פעיל': 1.0,
    'רימרקטינג': 0.12, 'לא רלוונטי': 0,
  };
  const b = base[lead.status] ?? 0;
  const scoreMod   = (lead.aiScore / 100) * 0.25;
  const stalePenalty = Math.min(daysSinceUpdate(lead) / 60, 0.25);
  return Math.max(0, Math.min(1, b + scoreMod - stalePenalty));
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 1 — FOLLOW-UP AGENT
══════════════════════════════════════════════════════════════════════════════ */
function FollowupAgent({ leads, currentUser, onCreateTask, onUpdateLead, onToast }: {
  leads: Lead[];
  currentUser: string;
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
}) {
  const [threshold,    setThreshold]    = useState(7);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [messages,     setMessages]     = useState<Record<string, string>>({});
  const [copiedId,     setCopiedId]     = useState<string | null>(null);
  const [mirrorStyles, setMirrorStyles] = useState<string[]>([]);

  useEffect(() => {
    getDoc(doc(db, 'mirror-mode', 'styles')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as { examples?: string[] };
        setMirrorStyles(d.examples ?? []);
      }
    }).catch(() => {});
  }, []);

  const staleLeads = leads
    .filter(l =>
      ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) &&
      daysSinceUpdate(l) >= threshold
    )
    .sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a));

  const generateMessage = useCallback(async (lead: Lead) => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setGeneratingFor(lead.id);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const lastNote = lead.notes[lead.notes.length - 1]?.text ?? 'אין הערות';
      const services = lead.solutions.map(s => s.name).join(', ') || 'טרם הוגדרו';
      const styleSection = mirrorStyles.length > 0
        ? `\nסגנון כתיבה של ${currentUser} (חקה בדיוק):\n${mirrorStyles.map((s, i) => `דוגמה ${i + 1}: ${s}`).join('\n')}\n`
        : '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `כתוב הודעת ווטסאפ קצרה למעקב אחרי ליד שלא ענה זמן רב.

לקוח: ${lead.company} | ${lead.contactName}
סטטוס: ${lead.status} | תקציב: ₪${lead.budget.toLocaleString()}/חודש
שירותים: ${services}
הערה אחרונה: ${lastNote}
ימים ללא עדכון: ${daysSinceUpdate(lead)}
${styleSection}
כללים:
- עברית בלבד
- 2-3 משפטים קצרים ואישיים
- חמים ולא מכירתי מדי
- ללא חתימה (יצורפת ידנית)
- כתוב רק את הטקסט של ההודעה`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setMessages(prev => ({ ...prev, [lead.id]: text }));
    } catch { onToast?.('שגיאה ביצירת הודעה', 'error'); }
    finally { setGeneratingFor(null); }
  }, [mirrorStyles, currentUser, onToast]);

  const markContacted = (lead: Lead) => {
    onUpdateLead({ ...lead, lastUpdate: new Date().toLocaleDateString('he-IL') });
    onToast?.(`${lead.company} סומן כ"פוסקתי" ✓`, 'success');
  };

  const createTask = (lead: Lead) => {
    const task: StandaloneTask = {
      id: Date.now().toString(),
      description: `מעקב — ${lead.company} (${lead.contactName})`,
      date: new Date().toISOString().split('T')[0],
      time: '10:00',
      priority: 'high' as TaskPriority,
      completed: false,
      assignedTo: currentUser,
      assignedBy: currentUser,
      createdAt: new Date().toISOString(),
      leadId: lead.id,
    };
    onCreateTask(task);
    onToast?.('משימת מעקב נוצרה ✓', 'success');
  };

  const copyMsg = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const urgency = (days: number) => {
    if (days >= 21) return { border: 'border-red-700/50',    bg: 'bg-red-900/20',    dot: 'bg-red-400',    label: '🔴 דחוף מאוד', color: 'text-red-400' };
    if (days >= 14) return { border: 'border-orange-700/40', bg: 'bg-orange-900/15', dot: 'bg-orange-400', label: '🟠 דחוף',        color: 'text-orange-400' };
    return              { border: 'border-amber-700/30',  bg: 'bg-amber-900/10',  dot: 'bg-amber-400',  label: '🟡 מעקב נדרש', color: 'text-amber-400' };
  };

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg">
            <Clock size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">סוכן מעקב חכם</p>
            <p className="text-slate-400 text-xs">מזהה לידים שנשכחו ומייצר הודעה מותאמת</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 text-xs">סף ימים:</span>
          {[3, 7, 14, 21].map(d => (
            <button key={d} onClick={() => setThreshold(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${threshold === d ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              {d}י׳
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'לטיפול',         value: staleLeads.length,                                          color: 'text-red-400' },
          { label: 'דחוף (21+ ימים)', value: staleLeads.filter(l => daysSinceUpdate(l) >= 21).length,  color: 'text-orange-400' },
          { label: 'Mirror Style',   value: mirrorStyles.length,                                        color: 'text-violet-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-slate-500 text-[10px] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lead cards */}
      {staleLeads.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/40 border border-slate-700/40 rounded-2xl">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-white font-bold">כל הלידים מעודכנים! 🎉</p>
          <p className="text-slate-400 text-sm mt-1">אין לידים ללא עדכון מעל {threshold} ימים</p>
        </div>
      ) : (
        <div className="space-y-3">
          {staleLeads.map(lead => {
            const days = daysSinceUpdate(lead);
            const u   = urgency(days);
            const msg = messages[lead.id];
            const isGen = generatingFor === lead.id;
            const waNumber = lead.phone ? `972${lead.phone.replace(/^0/, '').replace(/\D/g, '')}` : '';
            return (
              <div key={lead.id} className={`border rounded-2xl overflow-hidden ${u.border} ${u.bg}`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Days badge */}
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${u.dot}`} />
                      <span className={`text-[10px] font-black ${u.color}`}>{days}י׳</span>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-bold">{lead.company}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${u.color} border-current`}>{u.label}</span>
                        <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">{lead.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-slate-400">
                        <span className="flex items-center gap-1"><Users size={10}/> {lead.contactName}</span>
                        {lead.phone && <span className="flex items-center gap-1"><Phone size={10}/> {lead.phone}</span>}
                        {lead.budget > 0 && <span className="flex items-center gap-1"><DollarSign size={10}/> ₪{lead.budget.toLocaleString()}/חודש</span>}
                      </div>
                      {lead.notes.length > 0 && (
                        <p className="text-slate-500 text-xs mt-1.5 line-clamp-1 italic">
                          "{lead.notes[lead.notes.length - 1].text}"
                        </p>
                      )}
                    </div>
                    {/* Quick actions */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => markContacted(lead)} title="סמן כטיפלתי"
                        className="w-8 h-8 rounded-lg bg-emerald-900/50 hover:bg-emerald-700/60 border border-emerald-700/40 flex items-center justify-center text-emerald-400 transition-colors">
                        <CheckCircle2 size={13}/>
                      </button>
                      <button onClick={() => createTask(lead)} title="צור משימה"
                        className="w-8 h-8 rounded-lg bg-blue-900/50 hover:bg-blue-700/60 border border-blue-700/40 flex items-center justify-center text-blue-400 transition-colors">
                        <Calendar size={13}/>
                      </button>
                      {waNumber && (
                        <a href={`https://wa.me/${waNumber}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`}
                          target="_blank" rel="noreferrer" title="פתח ווטסאפ"
                          className="w-8 h-8 rounded-lg bg-green-900/50 hover:bg-green-700/60 border border-green-700/40 flex items-center justify-center text-green-400 transition-colors">
                          <MessageCircle size={13}/>
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Generate button */}
                  {!msg && (
                    <button onClick={() => generateMessage(lead)} disabled={isGen}
                      className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-bold py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-600/40 text-indigo-300 transition-all disabled:opacity-50">
                      {isGen ? <><Loader2 size={12} className="animate-spin"/> מייצר...</> : <><Brain size={12}/> צור הודעת מעקב AI</>}
                    </button>
                  )}
                </div>
                {/* Generated message */}
                {msg && (
                  <div className="border-t border-slate-700/40 bg-slate-900/60 p-4 space-y-2">
                    <textarea value={msg} onChange={e => setMessages(p => ({ ...p, [lead.id]: e.target.value }))}
                      rows={3} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right"/>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => copyMsg(lead.id, msg)}
                        className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
                        <Copy size={10}/> {copiedId === lead.id ? '✓ הועתק' : 'העתק'}
                      </button>
                      {waNumber && (
                        <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`}
                          target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs bg-green-800/60 hover:bg-green-700/60 text-green-300 border border-green-700/40 px-3 py-1.5 rounded-lg transition-colors font-medium">
                          <MessageCircle size={10}/> שלח ווטסאפ
                        </a>
                      )}
                      <button onClick={() => generateMessage(lead)} disabled={isGen}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg hover:bg-slate-700 transition-colors">
                        <RefreshCw size={10}/> שנה
                      </button>
                      <span className="mr-auto text-[10px] text-slate-600 flex items-center gap-1">
                        <Sparkles size={9} className="text-violet-500"/> {mirrorStyles.length > 0 ? 'Mirror Style' : 'ברירת מחדל'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 2 — REVENUE FORECAST
══════════════════════════════════════════════════════════════════════════════ */
function RevenueForecast({ leads }: { leads: Lead[] }) {
  const [scenario, setScenario] = useState<'base' | 'optimistic' | 'pessimistic'>('base');
  const mod = { base: 1, optimistic: 1.4, pessimistic: 0.6 }[scenario];

  const activeLeads   = leads.filter(l => l.status === 'לקוח פעיל' && l.budget > 0);
  const pipelineLeads = leads.filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) && l.budget > 0);

  const confirmed      = activeLeads.reduce((s, l) => s + l.budget, 0);
  const fromPipeline   = pipelineLeads.reduce((s, l) => s + l.budget * closeProbability(l) * mod, 0);
  const total          = confirmed + fromPipeline;
  const pipelineTotal  = pipelineLeads.reduce((s, l) => s + l.budget, 0);

  const groups = [
    { status: 'לקוח פעיל',  leads: activeLeads,                                          prob: 1,    color: 'bg-emerald-500', text: 'text-emerald-400' },
    { status: 'בתהליך',     leads: pipelineLeads.filter(l => l.status === 'בתהליך'),    prob: 0.38, color: 'bg-blue-500',    text: 'text-blue-400' },
    { status: 'חדש',        leads: pipelineLeads.filter(l => l.status === 'חדש'),       prob: 0.08, color: 'bg-indigo-500',  text: 'text-indigo-400' },
    { status: 'רימרקטינג',  leads: pipelineLeads.filter(l => l.status === 'רימרקטינג'),prob: 0.12, color: 'bg-amber-500',  text: 'text-amber-400' },
  ].filter(g => g.leads.length > 0);

  const maxBar = Math.max(...groups.map(g => g.leads.reduce((s, l) => s + l.budget, 0)), 1);

  const top5 = pipelineLeads
    .map(l => ({ lead: l, exp: l.budget * closeProbability(l) * mod }))
    .filter(o => o.exp > 0)
    .sort((a, b) => b.exp - a.exp)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <TrendingUp size={18} className="text-white"/>
          </div>
          <div>
            <p className="text-white font-bold text-sm">תחזית הכנסות</p>
            <p className="text-slate-400 text-xs">חישוב ממשקל הסתברויות פייפליין</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['pessimistic','base','optimistic'] as const).map(s => (
            <button key={s} onClick={() => setScenario(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${scenario === s
                ? s === 'optimistic' ? 'bg-emerald-600 text-white' : s === 'pessimistic' ? 'bg-red-700 text-white' : 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              {s === 'pessimistic' ? '📉 פסימי' : s === 'optimistic' ? '📈 אופטימי' : '📊 בסיס'}
            </button>
          ))}
        </div>
      </div>

      {/* Big 3 numbers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'מאושר', sub: `${activeLeads.length} לקוחות פעילים`, val: confirmed, color: 'emerald' },
          { label: 'צפוי מפייפליין', sub: `${pipelineLeads.length} לידים | סה"כ ₪${pipelineTotal.toLocaleString()}`, val: fromPipeline, color: 'blue' },
          { label: 'סה"כ תחזית', sub: `תרחיש ${scenario === 'base' ? 'בסיס' : scenario === 'optimistic' ? 'אופטימי' : 'פסימי'}`, val: total, color: 'indigo' },
        ].map(({ label, sub, val, color }) => (
          <div key={label} className={`bg-${color}-900/30 border border-${color}-700/40 rounded-2xl p-4 text-center`}>
            <p className={`text-${color}-400 text-[10px] font-bold uppercase tracking-widest mb-1`}>{label}</p>
            <p className="text-white text-xl font-black">₪{Math.round(val).toLocaleString()}</p>
            <p className={`text-${color}-400/60 text-[10px] mt-0.5`}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Breakdown bars */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 space-y-4">
        <h3 className="text-white font-bold text-sm">פירוט לפי סטטוס</h3>
        {groups.map(g => {
          const raw = g.leads.reduce((s, l) => s + l.budget, 0);
          const exp = raw * (g.status === 'לקוח פעיל' ? 1 : g.prob * mod);
          return (
            <div key={g.status} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${g.text}`}>{g.status}</span>
                  <span className="text-slate-500">({g.leads.length})</span>
                  {g.status !== 'לקוח פעיל' && <span className="text-slate-600 text-[10px]">{Math.round(g.prob * 100)}%</span>}
                </div>
                <div className="flex gap-3">
                  <span className="text-slate-400">₪{raw.toLocaleString()}</span>
                  <span className={`font-bold ${g.text}`}>→ ₪{Math.round(exp).toLocaleString()}</span>
                </div>
              </div>
              <div className="h-2 bg-slate-700 rounded-full">
                <div className={`h-2 rounded-full ${g.color} transition-all duration-500`}
                  style={{ width: `${Math.max(3, (raw / maxBar) * 100)}%` }}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top opportunities */}
      {top5.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 space-y-3">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            <Star size={14} className="text-amber-400"/> הזדמנויות עם הכי הרבה פוטנציאל
          </h3>
          {top5.map(({ lead, exp }) => (
            <div key={lead.id} className="flex items-center justify-between bg-slate-700/40 rounded-xl px-4 py-3">
              <span className="text-emerald-400 font-black">₪{Math.round(exp).toLocaleString()}</span>
              <div className="text-right">
                <p className="text-white text-sm font-bold">{lead.company}</p>
                <p className="text-slate-400 text-xs">{lead.contactName} · {lead.status}</p>
              </div>
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <Activity size={10}/> {lead.aiScore}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 3 — PROPOSAL GENERATOR AI
══════════════════════════════════════════════════════════════════════════════ */
function ProposalGenerator({ leads, currentUser, onToast }: {
  leads: Lead[];
  currentUser: string;
  onToast?: AgentsProps['onToast'];
}) {
  const [selectedLead, setSelectedLead] = useState('');
  const [services,     setServices]     = useState<string[]>([]);
  const [budget,       setBudget]       = useState('');
  const [notes,        setNotes]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState('');
  const [copied,       setCopied]       = useState(false);

  const SERVICE_LIST = [
    'דמיות ויזואליות (Renders)', 'אתר פרימיום', 'קמפיין פרסום ממומן',
    'ניהול מדיה חברתית', 'קריאייטיב (UGC/ריל)', 'SEO', 'ברנדינג', 'וידאו שיווקי',
  ];

  const toggleService = (s: string) =>
    setServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const lead = leads.find(l => l.id === selectedLead);

  const generate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    if (!services.length) { onToast?.('בחר שירות אחד לפחות', 'error'); return; }
    setLoading(true); setResult('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const leadCtx = lead
        ? `לקוח: ${lead.company} | ${lead.contactName} | תקציב מוכר: ₪${lead.budget.toLocaleString()}/חודש`
        : 'לקוח חדש ללא פרטים מוגדרים';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `אתה מומחה מכירות ב-RAY Digital Agency, סוכנות שיווק דיגיטלי AI-First לנדל"ן.

כתוב הצעת מחיר שיווקית מקצועית ומשכנעת בעברית.

${leadCtx}
שירותים מבוקשים: ${services.join(', ')}
${budget ? `תקציב מוצע: ₪${budget}/חודש` : ''}
${notes ? `הערות נוספות: ${notes}` : ''}
שם המציע: ${currentUser}

מבנה ההצעה (כתוב בעברית, מובנה עם כותרות):
1. פתיחה אישית וחזון (2-3 משפטים)
2. האתגר שאנחנו פותרים
3. הפתרון שלנו — פירוט כל שירות עם תועלות
4. תוצאות צפויות ו-ROI משוער
5. למה RAY Digital? (3 יתרונות ייחודיים)
6. מחיר + חלוקה לשלבים
7. קריאה לפעולה

כתוב בשפה שיווקית חזקה, ישירה ומשכנעת. אל תכתוב "הצעת מחיר" — כתוב "תכנית שיווק".`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setResult(text);
    } catch { onToast?.('שגיאה ביצירת הצעה', 'error'); }
    finally { setLoading(false); }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(result).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
          <Target size={18} className="text-white"/>
        </div>
        <div>
          <p className="text-white font-bold text-sm">מחולל הצעות מחיר AI</p>
          <p className="text-slate-400 text-xs">הצעת מחיר שיווקית מקצועית תוך שניות</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left: form */}
        <div className="space-y-4">
          {/* Lead selector */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2">ליד (אופציונלי)</label>
            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="">— ללא ליד ספציפי —</option>
              {leads.filter(l => ['חדש','בתהליך'].includes(l.status)).map(l => (
                <option key={l.id} value={l.id}>{l.company} — {l.contactName}</option>
              ))}
            </select>
          </div>

          {/* Services */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2">שירותים לכלול</label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_LIST.map(s => (
                <button key={s} onClick={() => toggleService(s)}
                  className={`text-xs px-3 py-1.5 rounded-xl border transition-all font-medium ${
                    services.includes(s)
                      ? 'bg-indigo-600/40 border-indigo-500/60 text-indigo-200'
                      : 'bg-slate-700/50 border-slate-600/50 text-slate-400 hover:text-white'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2">תקציב חודשי מוצע (₪)</label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="5000"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2">הערות נוספות</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="פרטים מיוחדים, דרישות, נקודות שיש להדגיש..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right"/>
          </div>

          <button onClick={generate} disabled={loading || services.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> מייצר הצעה...</> : <><Zap size={15}/> צור הצעת מחיר</>}
          </button>
        </div>

        {/* Right: result */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 min-h-[300px] relative">
          {result ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={copyResult}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                  <Copy size={10}/> {copied ? '✓ הועתק' : 'העתק הכל'}
                </button>
                <span className="text-[10px] text-slate-600 flex items-center gap-1"><Sparkles size={9} className="text-violet-400"/> נוצר על ידי AI</span>
              </div>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[500px]">
                {result}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Target size={32} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm">בחר שירותים ולחץ "צור הצעת מחיר"</p>
              <p className="text-slate-600 text-xs mt-1">ה-AI יכתוב הצעה מקצועית ומשכנעת</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 4 — SMART ALERTS
══════════════════════════════════════════════════════════════════════════════ */
type AlertSeverity = 'critical' | 'warning' | 'info';
interface SmartAlert {
  id: string; severity: AlertSeverity; icon: string;
  title: string; body: string;
}

function SmartAlerts({ leads, standaloneTask }: { leads: Lead[]; standaloneTask: StandaloneTask[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const alerts: SmartAlert[] = [];

  // Overdue tasks per lead
  leads.forEach(lead => {
    const overdue = lead.tasks.filter(t => {
      if (t.completed) return false;
      try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; }
    });
    if (overdue.length > 0) alerts.push({
      id: `overdue-${lead.id}`, severity: 'critical', icon: '🚨',
      title: `${overdue.length} משימות באיחור — ${lead.company}`,
      body: overdue.slice(0, 3).map(t => `• ${t.description}`).join('\n'),
    });
  });

  // Standalone overdue
  const stOverdue = standaloneTask.filter(t => {
    if (t.completed) return false;
    try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; }
  });
  if (stOverdue.length > 0) alerts.push({
    id: 'st-overdue', severity: 'critical', icon: '🚨',
    title: `${stOverdue.length} משימות עצמאיות באיחור`,
    body: stOverdue.slice(0, 3).map(t => `• ${t.description}`).join('\n'),
  });

  // Very stale
  const veryStale = leads.filter(l => ['חדש','בתהליך'].includes(l.status) && daysSinceUpdate(l) >= 21);
  if (veryStale.length) alerts.push({
    id: 'very-stale', severity: 'warning', icon: '⚠️',
    title: `${veryStale.length} לידים ללא מגע 21+ ימים`,
    body: veryStale.slice(0, 3).map(l => `• ${l.company} — ${daysSinceUpdate(l)} ימים`).join('\n'),
  });

  // Hot leads untouched
  const hotUntouched = leads.filter(l => l.aiScore >= 75 && l.status === 'חדש' && daysSinceUpdate(l) >= 3);
  if (hotUntouched.length) alerts.push({
    id: 'hot', severity: 'warning', icon: '🔥',
    title: `${hotUntouched.length} לידים חמים ממתינים לטיפול`,
    body: hotUntouched.slice(0, 3).map(l => `• ${l.company} — ציון ${l.aiScore}%`).join('\n'),
  });

  // In progress without open tasks
  const noTask = leads.filter(l => l.status === 'בתהליך' && l.tasks.filter(t => !t.completed).length === 0);
  if (noTask.length) alerts.push({
    id: 'no-task', severity: 'warning', icon: '📋',
    title: `${noTask.length} לידים בתהליך ללא משימה פתוחה`,
    body: noTask.slice(0, 3).map(l => `• ${l.company}`).join('\n'),
  });

  // Leads with waiting content
  const waiting = leads.filter(l => l.waitingContent);
  if (waiting.length) alerts.push({
    id: 'waiting', severity: 'info', icon: '⏳',
    title: `${waiting.length} לידים ממתינים לתוכן`,
    body: waiting.slice(0, 3).map(l => `• ${l.company}`).join('\n'),
  });

  // Revenue status
  const activeRevenue = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
  const activeCount   = leads.filter(l => l.status === 'לקוח פעיל').length;
  if (activeCount > 0) alerts.push({
    id: 'revenue', severity: 'info', icon: '💰',
    title: `₪${activeRevenue.toLocaleString()}/חודש מ-${activeCount} לקוחות פעילים`,
    body: `ממוצע ₪${Math.round(activeRevenue / activeCount).toLocaleString()} ללקוח`,
  });

  const cfg: Record<AlertSeverity, { bg: string; border: string }> = {
    critical: { bg: 'bg-red-900/25',   border: 'border-red-700/50' },
    warning:  { bg: 'bg-amber-900/15', border: 'border-amber-700/40' },
    info:     { bg: 'bg-blue-900/15',  border: 'border-blue-700/30' },
  };

  const criticals = alerts.filter(a => a.severity === 'critical');
  const warnings  = alerts.filter(a => a.severity === 'warning');
  const infos     = alerts.filter(a => a.severity === 'info');

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg">
            <AlertTriangle size={18} className="text-white"/>
          </div>
          <div>
            <p className="text-white font-bold text-sm">התראות חכמות</p>
            <p className="text-slate-400 text-xs">סריקת מערכת חיה — {alerts.length} נקודות לטיפול</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {criticals.length > 0 && <span className="bg-red-700/40 text-red-300 px-2 py-0.5 rounded-full font-bold border border-red-600/40">{criticals.length} קריטי</span>}
          {warnings.length > 0  && <span className="bg-amber-700/30 text-amber-300 px-2 py-0.5 rounded-full font-bold border border-amber-600/30">{warnings.length} אזהרה</span>}
          {infos.length > 0     && <span className="bg-blue-700/30 text-blue-300 px-2 py-0.5 rounded-full font-bold border border-blue-600/30">{infos.length} מידע</span>}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/40 border border-slate-700/40 rounded-2xl">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3"/>
          <p className="text-white font-bold">הכל תקין! אין התראות 🎉</p>
        </div>
      ) : (
        [['קריטי', criticals], ['אזהרה', warnings], ['מידע', infos]].map(([label, group]) =>
          (group as SmartAlert[]).length > 0 ? (
            <div key={label as string} className="space-y-2">
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1">{label as string}</p>
              {(group as SmartAlert[]).map(alert => (
                <div key={alert.id} className={`border rounded-2xl p-4 flex items-start gap-3 ${cfg[alert.severity].bg} ${cfg[alert.severity].border}`}>
                  <span className="text-xl flex-shrink-0">{alert.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm">{alert.title}</p>
                    {alert.body && <p className="text-slate-400 text-xs mt-1 whitespace-pre-line leading-relaxed">{alert.body}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : null
        )
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 5 — SOURCE ROI
══════════════════════════════════════════════════════════════════════════════ */
function SourceROI({ leads }: { leads: Lead[] }) {
  const SOURCES = ['אורגני','פרסום ממומן','הפניה','אינסטגרם','פייסבוק','גוגל'] as const;
  const EMOJI: Record<string, string>  = { 'אורגני':'🌱','פרסום ממומן':'💰','הפניה':'🤝','אינסטגרם':'📸','פייסבוק':'👤','גוגל':'🔍' };
  const COLOR: Record<string, string>  = { 'אורגני':'bg-emerald-500','פרסום ממומן':'bg-blue-500','הפניה':'bg-violet-500','אינסטגרם':'bg-pink-500','פייסבוק':'bg-indigo-500','גוגל':'bg-amber-500' };

  const data = SOURCES.map(src => {
    const all    = leads.filter(l => l.source === src);
    const active = all.filter(l => l.status === 'לקוח פעיל');
    const rev    = active.reduce((s, l) => s + l.budget, 0);
    const conv   = all.length ? (active.length / all.length) * 100 : 0;
    const avg    = all.length ? all.reduce((s, l) => s + l.aiScore, 0) / all.length : 0;
    return { src, all: all.length, active: active.length, rev, conv, avg };
  }).filter(d => d.all > 0).sort((a, b) => b.rev - a.rev);

  const maxRev   = Math.max(...data.map(d => d.rev), 1);
  const maxLeads = Math.max(...data.map(d => d.all), 1);
  const best     = data[0];

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
          <BarChart3 size={18} className="text-white"/>
        </div>
        <div>
          <p className="text-white font-bold text-sm">ROI מקורות</p>
          <p className="text-slate-400 text-xs">מהיכן מגיעים הלקוחות הרווחיים ביותר</p>
        </div>
      </div>

      {best && best.active > 0 && (
        <div className="bg-gradient-to-l from-emerald-900/30 to-slate-800/60 border border-emerald-700/40 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-4xl">{EMOJI[best.src]}</span>
          <div>
            <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">המקור הכי רווחי</p>
            <p className="text-white font-black text-lg">{best.src}</p>
            <p className="text-slate-400 text-xs">₪{best.rev.toLocaleString()}/חודש · {Math.round(best.conv)}% אחוז סגירה · {best.all} לידים</p>
          </div>
        </div>
      )}

      {/* Revenue bars */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 space-y-4">
        <h3 className="text-white font-bold text-sm">הכנסה חודשית לפי מקור</h3>
        {data.map(d => (
          <div key={d.src} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span>{EMOJI[d.src]}</span>
                <span className="text-white font-semibold">{d.src}</span>
                <span className="text-slate-500">({d.all} לידים, {d.active} סגורים)</span>
              </div>
              <div className="flex gap-3">
                <span className="text-slate-400">סגירה: {Math.round(d.conv)}%</span>
                <span className="text-white font-bold">₪{d.rev.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-2 bg-slate-700 rounded-full">
              <div className={`h-2 rounded-full ${COLOR[d.src]} transition-all duration-700`}
                style={{ width: `${Math.max(3, (d.rev / maxRev) * 100)}%` }}/>
            </div>
          </div>
        ))}
      </div>

      {/* Volume columns */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
        <h3 className="text-white font-bold text-sm mb-4">נפח לידים לפי מקור</h3>
        <div className="flex items-end gap-3" style={{ height: 120 }}>
          {data.map(d => (
            <div key={d.src} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <span className="text-white text-xs font-bold">{d.all}</span>
              <div className="w-full rounded-t-lg overflow-hidden flex flex-col-reverse"
                style={{ height: `${Math.max(8, (d.all / maxLeads) * 100)}px` }}>
                <div className={`w-full ${COLOR[d.src]} opacity-90`}
                  style={{ height: d.all > 0 ? `${(d.active / d.all) * 100}%` : '0%' }}/>
                <div className="w-full flex-1 bg-slate-600/50"/>
              </div>
              <span className="text-[11px]">{EMOJI[d.src]}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-[10px] mt-3">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500/80"/> לקוח פעיל</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-slate-600/50"/> בפייפליין</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-right text-slate-500 font-semibold px-4 py-3">מקור</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">לידים</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">פעילים</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">סגירה</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">ציון AI</th>
              <th className="text-left text-slate-500 font-semibold px-4 py-3">הכנסה</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.src} className={`border-b border-slate-700/30 ${i === 0 ? 'bg-emerald-900/10' : ''}`}>
                <td className="px-4 py-3 text-right font-semibold text-white">{EMOJI[d.src]} {d.src}</td>
                <td className="px-3 py-3 text-center text-slate-300">{d.all}</td>
                <td className="px-3 py-3 text-center text-emerald-400 font-bold">{d.active}</td>
                <td className="px-3 py-3 text-center text-slate-300">{Math.round(d.conv)}%</td>
                <td className="px-3 py-3 text-center text-slate-300">{Math.round(d.avg)}%</td>
                <td className="px-4 py-3 text-left font-bold text-white">₪{d.rev.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN — AGENTS HUB
══════════════════════════════════════════════════════════════════════════════ */
export default function Agents({
  leads, team: _team, currentUser, standaloneTask,
  onCreateTask, onUpdateLead, onToast,
}: AgentsProps) {
  const [tab, setTab] = useState<AgentTab>('followup');

  const staleCount   = leads.filter(l => ['חדש','בתהליך','רימרקטינג'].includes(l.status) && daysSinceUpdate(l) >= 7).length;
  const confirmed    = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);

  const today = new Date(); today.setHours(0,0,0,0);
  const alertCount = [
    leads.some(l => l.tasks.some(t => !t.completed && (() => { try { return new Date(t.date+'T00:00:00') < today; } catch { return false; } })())),
    standaloneTask.some(t => !t.completed && (() => { try { return new Date(t.date+'T00:00:00') < today; } catch { return false; } })()),
    leads.some(l => ['חדש','בתהליך'].includes(l.status) && daysSinceUpdate(l) >= 21),
    leads.some(l => l.aiScore >= 75 && l.status === 'חדש'),
  ].filter(Boolean).length;

  const tabs: { key: AgentTab; emoji: string; label: string; badge?: string | number }[] = [
    { key: 'followup', emoji: '🎯', label: 'סוכן מעקב',    badge: staleCount > 0 ? staleCount : undefined },
    { key: 'forecast', emoji: '📈', label: 'תחזית הכנסות', badge: `₪${Math.round(confirmed/1000)}K` },
    { key: 'proposal', emoji: '✍️', label: 'מחולל הצעות',  badge: undefined },
    { key: 'alerts',   emoji: '🚨', label: 'התראות',       badge: alertCount > 0 ? alertCount : undefined },
    { key: 'roi',      emoji: '📊', label: 'ROI מקורות',   badge: undefined },
  ];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Bot size={20} className="text-white"/>
        </div>
        <div>
          <h1 className="text-white font-black text-xl leading-tight">סוכנים חכמים</h1>
          <p className="text-slate-400 text-sm">AI שעובד בשבילך 24/7</p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/>
          <span className="text-green-400 text-xs font-medium">פעיל</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border flex-shrink-0 relative ${
              tab === t.key
                ? 'bg-indigo-600/30 border-indigo-500/60 text-white shadow-sm shadow-indigo-500/10'
                : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600/50'
            }`}>
            <span>{t.emoji}</span>
            <span>{t.label}</span>
            {t.badge !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                typeof t.badge === 'number'
                  ? 'bg-red-500 text-white'
                  : 'bg-slate-700 text-slate-300'
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'followup' && (
          <FollowupAgent leads={leads} currentUser={currentUser}
            onCreateTask={onCreateTask} onUpdateLead={onUpdateLead} onToast={onToast}/>
        )}
        {tab === 'forecast' && <RevenueForecast leads={leads}/>}
        {tab === 'proposal' && <ProposalGenerator leads={leads} currentUser={currentUser} onToast={onToast}/>}
        {tab === 'alerts'   && <SmartAlerts leads={leads} standaloneTask={standaloneTask}/>}
        {tab === 'roi'      && <SourceROI leads={leads}/>}
      </div>
    </div>
  );
}
