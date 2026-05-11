import { useState, useEffect, useCallback } from 'react';
import {
  Bot, TrendingUp, AlertTriangle, BarChart3,
  MessageCircle, CheckCircle2, Clock, Loader2, Copy,
  Phone, DollarSign, Activity,
  Sparkles, RefreshCw, Brain, Star,
  Users, Calendar, Target, Zap,
  FileText, Search, Plus, Trash2, Globe, Award,
  ExternalLink, Play, Settings, ToggleLeft, ChevronRight,
  Link,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, TeamMember, StandaloneTask, TaskPriority } from '../types';
import { getApiKey } from '../lib/apiKey';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ─── Types ────────────────────────────────────────────────────────────────── */
type AgentTab = 'followup' | 'forecast' | 'alerts' | 'roi' | 'proposal' | 'enrich' | 'workflow' | 'performance' | 'brief' | 'portal' | 'marketing' | 'campaign' | 'churn' | 'templates' | 'coach';

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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
            <Clock size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">סוכן מעקב חכם</p>
            <p className="text-zinc-500 text-xs">מזהה לידים שנשכחו ומייצר הודעה מותאמת</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-zinc-500 text-xs">סף ימים:</span>
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
          <div key={s.label} className="bg-zinc-900/80 border border-white/[0.07] rounded-xl p-3 text-center">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-slate-500 text-[10px] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lead cards */}
      {staleLeads.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-white font-bold">כל הלידים מעודכנים! 🎉</p>
          <p className="text-zinc-400 text-sm mt-1">אין לידים ללא עדכון מעל {threshold} ימים</p>
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
                  <div className="border-t border-white/[0.07] bg-slate-900/60 p-4 space-y-2">
                    <textarea value={msg} onChange={e => setMessages(p => ({ ...p, [lead.id]: e.target.value }))}
                      rows={3} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-white/30 text-right"/>
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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
            <TrendingUp size={18} className="text-white"/>
          </div>
          <div>
            <p className="text-white font-bold text-sm">תחזית הכנסות</p>
            <p className="text-zinc-500 text-xs">חישוב ממשקל הסתברויות פייפליין</p>
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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-5 space-y-4">
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
        <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-5 space-y-3">
          <h3 className="text-white font-bold text-sm flex items-center gap-2">
            <Star size={14} className="text-amber-400"/> הזדמנויות עם הכי הרבה פוטנציאל
          </h3>
          {top5.map(({ lead, exp }) => (
            <div key={lead.id} className="flex items-center justify-between bg-zinc-800/60 rounded-xl px-4 py-3">
              <span className="text-emerald-400 font-black">₪{Math.round(exp).toLocaleString()}</span>
              <div className="text-right">
                <p className="text-white text-sm font-bold">{lead.company}</p>
                <p className="text-zinc-500 text-xs">{lead.contactName} · {lead.status}</p>
              </div>
              <span className="text-zinc-500 text-xs flex items-center gap-1">
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
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
          <Target size={18} className="text-white"/>
        </div>
        <div>
          <p className="text-white font-bold text-sm">מחולל הצעות מחיר AI</p>
          <p className="text-zinc-500 text-xs">הצעת מחיר שיווקית מקצועית תוך שניות</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left: form */}
        <div className="space-y-4">
          {/* Lead selector */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">ליד (אופציונלי)</label>
            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">— ללא ליד ספציפי —</option>
              {leads.filter(l => ['חדש','בתהליך'].includes(l.status)).map(l => (
                <option key={l.id} value={l.id}>{l.company} — {l.contactName}</option>
              ))}
            </select>
          </div>

          {/* Services */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">שירותים לכלול</label>
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
            <label className="block text-zinc-500 text-xs font-medium mb-2">תקציב חודשי מוצע (₪)</label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="5000"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">הערות נוספות</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="פרטים מיוחדים, דרישות, נקודות שיש להדגיש..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-white/30 text-right"/>
          </div>

          <button onClick={generate} disabled={loading || services.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> מייצר הצעה...</> : <><Zap size={15}/> צור הצעת מחיר</>}
          </button>
        </div>

        {/* Right: result */}
        <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 min-h-[300px] relative">
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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
            <AlertTriangle size={18} className="text-white"/>
          </div>
          <div>
            <p className="text-white font-bold text-sm">התראות חכמות</p>
            <p className="text-zinc-500 text-xs">סריקת מערכת חיה — {alerts.length} נקודות לטיפול</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {criticals.length > 0 && <span className="bg-red-700/40 text-red-300 px-2 py-0.5 rounded-full font-bold border border-red-600/40">{criticals.length} קריטי</span>}
          {warnings.length > 0  && <span className="bg-amber-700/30 text-amber-300 px-2 py-0.5 rounded-full font-bold border border-amber-600/30">{warnings.length} אזהרה</span>}
          {infos.length > 0     && <span className="bg-blue-700/30 text-blue-300 px-2 py-0.5 rounded-full font-bold border border-blue-600/30">{infos.length} מידע</span>}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
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
                    {alert.body && <p className="text-zinc-500 text-xs mt-1 whitespace-pre-line leading-relaxed">{alert.body}</p>}
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
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
          <BarChart3 size={18} className="text-white"/>
        </div>
        <div>
          <p className="text-white font-bold text-sm">ROI מקורות</p>
          <p className="text-zinc-500 text-xs">מהיכן מגיעים הלקוחות הרווחיים ביותר</p>
        </div>
      </div>

      {best && best.active > 0 && (
        <div className="bg-gradient-to-l from-emerald-900/30 to-slate-800/60 border border-emerald-700/40 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-4xl">{EMOJI[best.src]}</span>
          <div>
            <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">המקור הכי רווחי</p>
            <p className="text-white font-black text-lg">{best.src}</p>
            <p className="text-zinc-500 text-xs">₪{best.rev.toLocaleString()}/חודש · {Math.round(best.conv)}% אחוז סגירה · {best.all} לידים</p>
          </div>
        </div>
      )}

      {/* Revenue bars */}
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-5 space-y-4">
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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-5">
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
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl overflow-hidden">
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
              <tr key={d.src} className={`border-b border-white/[0.06] ${i === 0 ? 'bg-emerald-900/10' : ''}`}>
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
   FEATURE 6 — LEAD ENRICHMENT AI
══════════════════════════════════════════════════════════════════════════════ */
function LeadEnrichment({ leads, onUpdateLead, onToast }: {
  leads: Lead[];
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
}) {
  const [selectedId, setSelectedId] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<{
    website?: string; employees?: string; industry?: string; founded?: string;
    description?: string; recentNews?: string; digitalPresence?: string;
    readinessScore?: number; insights?: string[]; suggestedBudget?: number;
  } | null>(null);

  const lead = leads.find(l => l.id === selectedId);

  const enrich = async () => {
    if (!lead) return;
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setResult(null);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `חפש מידע על החברה "${lead.company}" ${lead.contactName ? `(איש קשר: ${lead.contactName})` : ''} בישראל.

ספק:
1. אתר אינטרנט רשמי
2. גודל / מספר עובדים
3. תחום פעילות
4. שנת הקמה
5. תיאור קצר
6. חדשות אחרונות
7. נוכחות ברשתות (אינסטגרם, פייסבוק, לינקדאין)
8. ציון מוכנות דיגיטלית 0-100 (עד כמה הם צריכים שיווק דיגיטלי)
9. תקציב שיווק מוצע לחודש (בשקלים)

ענה **רק** ב-JSON תקני:
{"website":"","employees":"","industry":"","founded":"","description":"","recentNews":"","digitalPresence":"","readinessScore":70,"insights":["insight1","insight2","insight3"],"suggestedBudget":5000}`,
        }],
      });
      // Extract text blocks after web search turns
      let finalText = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const block of (res.content || [])) { if (block.type === 'text') finalText += block.text; }
      const jsonMatch = finalText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) { setResult(JSON.parse(jsonMatch[0])); }
      else {
        // Fallback: ask without web search for generic insight
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r2: any = await (client.messages as any).create({
          model: 'claude-opus-4-5', max_tokens: 600,
          messages: [{ role: 'user', content: `ספק הערכה כללית לחברה בשם "${lead.company}" בתחום הנדל"ן בישראל בפורמט JSON:\n{"industry":"נדל\\"ן","description":"","readinessScore":65,"insights":["insight1","insight2","insight3"],"suggestedBudget":4500}` }],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t2 = r2.content?.find((b: any) => b.type === 'text')?.text ?? '';
        const m2 = t2.match(/\{[\s\S]*?\}/);
        if (m2) setResult(JSON.parse(m2[0]));
      }
    } catch { onToast?.('שגיאה בהעשרת הליד', 'error'); }
    finally { setLoading(false); }
  };

  const applyBudget = () => {
    if (!lead || !result?.suggestedBudget) return;
    onUpdateLead({ ...lead, budget: result.suggestedBudget! });
    onToast?.('תקציב עודכן ✓', 'success');
  };

  const sc = (s: number) => s >= 75 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-red-400';
  const sb = (s: number) => s >= 75 ? 'bg-emerald-500' : s >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center"><Search size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">סוכן העשרת לידים</p><p className="text-zinc-500 text-xs">AI מחפש ברשת מידע על החברה ומוסיף לכרטיס</p></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">בחר ליד להעשרה</label>
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setResult(null); }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">— בחר ליד —</option>
              {leads.filter(l => l.status !== 'לא רלוונטי').map(l => (
                <option key={l.id} value={l.id}>{l.company} ({l.status})</option>
              ))}
            </select>
          </div>
          {lead && (
            <div className="bg-slate-800/60 border border-white/[0.07] rounded-xl p-3 text-xs space-y-1">
              <p className="text-white font-bold">{lead.company}</p>
              <p className="text-slate-400">{lead.contactName} · {lead.phone}</p>
              <p className="text-slate-400">₪{lead.budget.toLocaleString()}/חודש · ציון {lead.aiScore}%</p>
            </div>
          )}
          <button onClick={enrich} disabled={!selectedId || loading}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> מחפש ברשת...</> : <><Globe size={15}/> העשר עם AI</>}
          </button>
        </div>
        <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 min-h-[260px]">
          {result ? (
            <div className="space-y-3">
              {result.readinessScore !== undefined && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-500 text-xs">מוכנות דיגיטלית</span>
                    <span className={`font-black text-lg ${sc(result.readinessScore)}`}>{result.readinessScore}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full"><div className={`h-2 rounded-full ${sb(result.readinessScore)}`} style={{ width: `${result.readinessScore}%` }}/></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {result.industry   && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">תחום</p><p className="text-white font-medium">{result.industry}</p></div>}
                {result.employees  && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">גודל</p><p className="text-white font-medium">{result.employees}</p></div>}
                {result.founded    && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">הוקמה</p><p className="text-white font-medium">{result.founded}</p></div>}
                {result.website    && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">אתר</p><a href={result.website} target="_blank" rel="noreferrer" className="text-cyan-400 flex items-center gap-1 hover:underline"><ExternalLink size={10}/> פתח</a></div>}
              </div>
              {result.description && <p className="text-xs text-slate-300 bg-slate-700/30 rounded-xl p-3 leading-relaxed">{result.description}</p>}
              {result.insights && result.insights.length > 0 && (
                <div className="space-y-1">
                  <p className="text-slate-500 text-xs font-bold">תובנות מכירה:</p>
                  {result.insights.map((ins, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs"><span className="text-cyan-400 flex-shrink-0">→</span><span className="text-slate-300">{ins}</span></div>
                  ))}
                </div>
              )}
              {result.suggestedBudget && (
                <div className="flex items-center justify-between bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3">
                  <div><p className="text-emerald-400 text-xs font-bold">תקציב מוצע</p><p className="text-white font-black">₪{result.suggestedBudget.toLocaleString()}/חודש</p></div>
                  <button onClick={applyBudget} className="text-xs bg-emerald-700/50 hover:bg-emerald-600/60 text-emerald-300 border border-emerald-600/40 px-3 py-1.5 rounded-lg transition-colors font-medium">החל על הליד</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Globe size={32} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm">בחר ליד ולחץ "העשר"</p>
              <p className="text-slate-600 text-xs mt-1">AI יחפש ברשת ויביא מידע</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 7 — WORKFLOW BUILDER
══════════════════════════════════════════════════════════════════════════════ */
interface Workflow {
  id: string; name: string; active: boolean;
  triggerType: 'days_inactive' | 'status_is' | 'score_above';
  triggerValue: string;
  actionType: 'create_task' | 'change_status';
  actionValue: string;
  createdAt: string; runCount: number; lastRunAt?: string;
}

function WorkflowBuilder({ leads, currentUser, onCreateTask, onUpdateLead, onToast }: {
  leads: Lead[]; currentUser: string;
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
}) {
  const [workflows,  setWorkflows]  = useState<Workflow[]>([]);
  const [loadingWf,  setLoadingWf]  = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [running,    setRunning]    = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', triggerType: 'days_inactive' as Workflow['triggerType'],
    triggerValue: '7', actionType: 'create_task' as Workflow['actionType'], actionValue: '',
  });

  useEffect(() => {
    getDocs(collection(db, 'workflows'))
      .then(snap => setWorkflows(snap.docs.map(d => d.data() as Workflow)))
      .catch(() => {}).finally(() => setLoadingWf(false));
  }, []);

  const saveWorkflow = async () => {
    if (!form.name.trim() || !form.actionValue.trim()) { onToast?.('מלא שם ופעולה', 'error'); return; }
    const wf: Workflow = {
      id: Date.now().toString(), name: form.name, active: true,
      triggerType: form.triggerType, triggerValue: form.triggerValue,
      actionType: form.actionType, actionValue: form.actionValue,
      createdAt: new Date().toISOString(), runCount: 0,
    };
    await setDoc(doc(db, 'workflows', wf.id), wf).catch(() => {});
    setWorkflows(prev => [...prev, wf]);
    setShowForm(false);
    setForm({ name: '', triggerType: 'days_inactive', triggerValue: '7', actionType: 'create_task', actionValue: '' });
    onToast?.('אוטומציה נוצרה ✓', 'success');
  };

  const toggleWf = async (wf: Workflow) => {
    const updated = { ...wf, active: !wf.active };
    await setDoc(doc(db, 'workflows', wf.id), updated).catch(() => {});
    setWorkflows(prev => prev.map(w => w.id === wf.id ? updated : w));
  };

  const deleteWf = async (id: string) => {
    await deleteDoc(doc(db, 'workflows', id)).catch(() => {});
    setWorkflows(prev => prev.filter(w => w.id !== id));
    onToast?.('אוטומציה נמחקה', 'info');
  };

  const runWf = async (wf: Workflow) => {
    setRunning(wf.id);
    const matching = leads.filter(l => {
      if (wf.triggerType === 'days_inactive') return daysSinceUpdate(l) >= parseInt(wf.triggerValue);
      if (wf.triggerType === 'status_is')    return l.status === wf.triggerValue;
      if (wf.triggerType === 'score_above')  return l.aiScore >= parseInt(wf.triggerValue);
      return false;
    });
    let count = 0;
    for (const lead of matching) {
      if (wf.actionType === 'create_task') {
        onCreateTask({ id: `${Date.now()}-${lead.id}`, description: wf.actionValue.replace('{company}', lead.company), date: new Date().toISOString().split('T')[0], time: '09:00', priority: 'medium' as TaskPriority, completed: false, assignedTo: currentUser, assignedBy: 'אוטומציה', createdAt: new Date().toISOString(), leadId: lead.id });
      } else if (wf.actionType === 'change_status') {
        onUpdateLead({ ...lead, status: wf.actionValue as Lead['status'], lastUpdate: new Date().toLocaleDateString('he-IL') });
      }
      count++;
    }
    const updated = { ...wf, runCount: wf.runCount + 1, lastRunAt: new Date().toISOString() };
    await setDoc(doc(db, 'workflows', wf.id), updated).catch(() => {});
    setWorkflows(prev => prev.map(w => w.id === wf.id ? updated : w));
    setRunning(null);
    onToast?.(`הופעל על ${count} לידים ✓`, 'success');
  };

  const TLABELS: Record<string, string> = { days_inactive: 'ימים ללא עדכון ≥', status_is: 'סטטוס =', score_above: 'ציון AI ≥' };
  const ALABELS: Record<string, string> = { create_task: 'צור משימה:', change_status: 'שנה סטטוס ל:' };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Settings size={18} className="text-black"/></div>
          <div><p className="text-white font-bold text-sm">בונה אוטומציות</p><p className="text-zinc-500 text-xs">כללים שפועלים אוטומטית על הלידים</p></div>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
          <Plus size={14}/> אוטומציה חדשה
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800/60 border border-amber-700/40 rounded-2xl p-5 space-y-4">
          <h3 className="text-white font-bold text-sm">✨ אוטומציה חדשה</h3>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="שם האוטומציה"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30 text-right"/>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-amber-400 text-xs font-bold">⚡ טריגר — מתי</p>
              <select value={form.triggerType} onChange={e => setForm(p => ({ ...p, triggerType: e.target.value as Workflow['triggerType'] }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                <option value="days_inactive">ימים ללא עדכון</option>
                <option value="status_is">סטטוס ליד</option>
                <option value="score_above">ציון AI מעל</option>
              </select>
              {form.triggerType === 'status_is' ? (
                <select value={form.triggerValue} onChange={e => setForm(p => ({ ...p, triggerValue: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                  {['חדש','בתהליך','לקוח פעיל','רימרקטינג','לא רלוונטי'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input type="number" value={form.triggerValue} onChange={e => setForm(p => ({ ...p, triggerValue: e.target.value }))} placeholder="ערך"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none"/>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-blue-400 text-xs font-bold">🎯 פעולה — מה לעשות</p>
              <select value={form.actionType} onChange={e => setForm(p => ({ ...p, actionType: e.target.value as Workflow['actionType'], actionValue: '' }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                <option value="create_task">צור משימה</option>
                <option value="change_status">שנה סטטוס</option>
              </select>
              {form.actionType === 'create_task' ? (
                <input value={form.actionValue} onChange={e => setForm(p => ({ ...p, actionValue: e.target.value }))}
                  placeholder="תיאור משימה (השתמש {company})"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none text-right"/>
              ) : (
                <select value={form.actionValue} onChange={e => setForm(p => ({ ...p, actionValue: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                  <option value="">— בחר סטטוס —</option>
                  {['חדש','בתהליך','לקוח פעיל','רימרקטינג','לא רלוונטי'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowForm(false)} className="text-zinc-400 hover:text-white text-sm px-4 py-2 rounded-xl hover:bg-slate-700 transition-colors">ביטול</button>
            <button onClick={saveWorkflow} className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm px-6 py-2 rounded-xl transition-colors flex items-center gap-2"><CheckCircle2 size={14}/> שמור</button>
          </div>
        </div>
      )}

      {loadingWf ? (
        <div className="text-center py-8"><Loader2 size={20} className="animate-spin text-slate-500 mx-auto"/></div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Settings size={36} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">אין אוטומציות עדיין</p>
          <p className="text-zinc-400 text-sm mt-1">צור את האוטומציה הראשונה שלך למעלה</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map(wf => {
            const matchCount = leads.filter(l => {
              if (wf.triggerType === 'days_inactive') return daysSinceUpdate(l) >= parseInt(wf.triggerValue);
              if (wf.triggerType === 'status_is')    return l.status === wf.triggerValue;
              if (wf.triggerType === 'score_above')  return l.aiScore >= parseInt(wf.triggerValue);
              return false;
            }).length;
            return (
              <div key={wf.id} className={`border rounded-2xl p-4 transition-all ${wf.active ? 'bg-slate-800/60 border-slate-700/50' : 'bg-black/40 border-slate-800/50 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-sm">{wf.name}</span>
                      {wf.active && matchCount > 0 && <span className="text-[10px] bg-amber-600/30 text-amber-300 border border-amber-600/40 px-2 py-0.5 rounded-full font-bold">{matchCount} לידים</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                      <span className="bg-slate-700/60 text-slate-300 px-2 py-0.5 rounded-full">אם: {TLABELS[wf.triggerType]} {wf.triggerValue}</span>
                      <ChevronRight size={10} className="text-slate-600"/>
                      <span className="bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-700/30">אז: {ALABELS[wf.actionType]} "{wf.actionValue}"</span>
                    </div>
                    {wf.runCount > 0 && <p className="text-slate-600 text-[10px] mt-1">הופעלה {wf.runCount} פעמים</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => runWf(wf)} disabled={running === wf.id || !wf.active || matchCount === 0} title="הפעל עכשיו"
                      className="w-8 h-8 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 border border-amber-600/40 flex items-center justify-center text-amber-400 transition-colors disabled:opacity-30">
                      {running === wf.id ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}
                    </button>
                    <button onClick={() => toggleWf(wf)} title={wf.active ? 'כבה' : 'הפעל'}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${wf.active ? 'bg-emerald-900/40 border-emerald-700/40 text-emerald-400' : 'bg-slate-700/40 border-slate-600/40 text-slate-500'}`}>
                      <ToggleLeft size={14}/>
                    </button>
                    <button onClick={() => deleteWf(wf.id)} title="מחק"
                      className="w-8 h-8 rounded-lg bg-red-900/30 hover:bg-red-800/40 border border-red-800/40 flex items-center justify-center text-red-400 transition-colors">
                      <Trash2 size={12}/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 8 — CLIENT PORTAL MANAGER
══════════════════════════════════════════════════════════════════════════════ */
function PortalManager({ leads, onToast }: { leads: Lead[]; onToast?: AgentsProps['onToast'] }) {
  const [portals,  setPortals]  = useState<Record<string, string>>({}); // leadId → token
  const [loading,  setLoading]  = useState(true);
  const [genFor,   setGenFor]   = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeClients = leads.filter(l => l.status === 'לקוח פעיל');

  useEffect(() => {
    getDocs(collection(db, 'portals'))
      .then(snap => {
        const map: Record<string, string> = {};
        snap.docs.forEach(d => { const data = d.data() as { leadId: string }; map[data.leadId] = d.id; });
        setPortals(map);
      }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const generatePortal = async (lead: Lead) => {
    setGenFor(lead.id);
    const token = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8);
    await setDoc(doc(db, 'portals', token), {
      leadId: lead.id, company: lead.company, contactName: lead.contactName,
      createdAt: new Date().toISOString(), views: 0,
    }).catch(() => {});
    setPortals(prev => ({ ...prev, [lead.id]: token }));
    setGenFor(null);
    onToast?.(`פורטל נוצר עבור ${lead.company} ✓`, 'success');
  };

  const copyLink = (leadId: string) => {
    const token = portals[leadId];
    const url = `${window.location.origin}?portal=${token}`;
    navigator.clipboard.writeText(url).then(() => { setCopiedId(leadId); setTimeout(() => setCopiedId(null), 2000); });
  };

  const openPortal = (leadId: string) => {
    const token = portals[leadId];
    window.open(`${window.location.origin}?portal=${token}`, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Link size={18} className="text-black"/></div>
        <div>
          <p className="text-white font-bold text-sm">פורטל לקוחות</p>
          <p className="text-zinc-500 text-xs">שלח ללקוח קישור לצפייה בסטטוס הפרויקט שלו</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 size={20} className="animate-spin text-slate-500 mx-auto"/></div>
      ) : activeClients.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Link size={32} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">אין לקוחות פעילים עדיין</p>
          <p className="text-zinc-400 text-sm mt-1">הפורטל זמין ללקוחות בסטטוס "לקוח פעיל"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeClients.map(lead => {
            const token = portals[lead.id];
            const hasPortal = !!token;
            return (
              <div key={lead.id} className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">{lead.company}</p>
                  <p className="text-zinc-500 text-xs">{lead.contactName} · ₪{lead.budget.toLocaleString()}/חודש</p>
                  {hasPortal && (
                    <p className="text-teal-400 text-[10px] mt-1 font-mono truncate">
                      {window.location.origin}?portal={token.slice(0, 8)}...
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {hasPortal ? (
                    <>
                      <button onClick={() => copyLink(lead.id)}
                        className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
                        <Copy size={10}/> {copiedId === lead.id ? '✓' : 'העתק'}
                      </button>
                      <button onClick={() => openPortal(lead.id)}
                        className="flex items-center gap-1.5 text-xs bg-teal-800/50 hover:bg-teal-700/60 text-teal-300 border border-teal-700/40 px-3 py-1.5 rounded-lg transition-colors font-medium">
                        <ExternalLink size={10}/> פתח
                      </button>
                    </>
                  ) : (
                    <button onClick={() => generatePortal(lead)} disabled={genFor === lead.id}
                      className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors font-bold">
                      {genFor === lead.id ? <Loader2 size={10} className="animate-spin"/> : <Link size={10}/>} צור פורטל
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 text-xs text-slate-500 space-y-1">
        <p className="font-bold text-slate-400">📌 מה הלקוח רואה בפורטל:</p>
        <p>• פרטי הפרויקט וסטטוס עדכני</p>
        <p>• היסטוריית הערות ועדכונים</p>
        <p>• פריסת שירותים ותקציב</p>
        <p>• ציון בריאות הפרויקט</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 9 — AGENT PERFORMANCE
══════════════════════════════════════════════════════════════════════════════ */
function AgentPerformance({ leads, team, standaloneTask }: {
  leads: Lead[]; team: TeamMember[]; standaloneTask: StandaloneTask[];
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const stats = team.map(member => {
    const myLeads  = leads.filter(l => l.assignedTo === member.name || l.assignedTo === member.id);
    const active   = myLeads.filter(l => l.status === 'לקוח פעיל');
    const revenue  = active.reduce((s, l) => s + l.budget, 0);
    const closeRate = myLeads.length > 0 ? (active.length / myLeads.length) * 100 : 0;
    const avgScore  = myLeads.length > 0 ? myLeads.reduce((s, l) => s + l.aiScore, 0) / myLeads.length : 0;
    const myTasks   = standaloneTask.filter(t => t.assignedTo === member.name);
    const overdue   = myTasks.filter(t => !t.completed && (() => { try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; } })()).length;
    const done      = myTasks.filter(t => t.completed).length;
    const perf = Math.min(100, Math.round(closeRate * 0.4 + (revenue > 0 ? Math.min(40, revenue / 500) : 0) + (overdue === 0 ? 20 : Math.max(0, 20 - overdue * 5))));
    return { member, total: myLeads.length, active: active.length, revenue, closeRate, avgScore, overdue, done, perf };
  }).filter(s => s.total > 0).sort((a, b) => b.revenue - a.revenue);

  const sc = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-red-400';
  const sr = (s: number) => s >= 70 ? 'border-emerald-500' : s >= 40 ? 'border-amber-500' : 'border-red-500';
  const sb = (s: number) => s >= 70 ? 'bg-emerald-500' : s >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Award size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">ביצועי סוכנים</p><p className="text-zinc-500 text-xs">{team.length} חברי צוות · ליידרבורד לפי הכנסה</p></div>
      </div>

      {stats.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Users size={36} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">שייך לידים לחברי הצוות</p>
          <p className="text-zinc-400 text-sm mt-1">בשדה "מוקצה ל" בכרטיסי הלידים</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {stats.map((s, idx) => (
              <div key={s.member.id} className={`border rounded-2xl p-4 ${idx === 0 ? 'bg-amber-900/15 border-amber-700/40' : 'bg-slate-800/60 border-slate-700/50'}`}>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <span className="text-xl">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}</span>
                    <div className={`w-10 h-10 rounded-xl border-2 ${sr(s.perf)} bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white text-xs font-black`}>
                      {s.member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold">{s.member.name}</span>
                      <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">{s.member.role}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-center">
                      {[
                        { label: 'הכנסה',   val: `₪${Math.round(s.revenue/1000)}K`, color: 'text-emerald-400' },
                        { label: 'סגירה',   val: `${Math.round(s.closeRate)}%`,      color: 'text-blue-400' },
                        { label: 'לידים',   val: s.total,                            color: 'text-slate-300' },
                        { label: 'איחור',   val: s.overdue,                          color: s.overdue > 0 ? 'text-red-400' : 'text-slate-500' },
                      ].map(({ label, val, color }) => (
                        <div key={label}><div className={`text-sm font-black ${color}`}>{val}</div><div className="text-[10px] text-slate-600">{label}</div></div>
                      ))}
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-[10px] text-slate-600">ציון ביצועים</span>
                        <span className={`text-[10px] font-bold ${sc(s.perf)}`}>{s.perf}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full"><div className={`h-1.5 rounded-full ${sb(s.perf)}`} style={{ width: `${s.perf}%` }}/></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4">
            <h3 className="text-white font-bold text-sm mb-3">סיכום צוות</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              {[
                { label: 'סה"כ הכנסה',    val: `₪${stats.reduce((s,a)=>s+a.revenue,0).toLocaleString()}`, color: 'text-emerald-400' },
                { label: 'ממוצע סגירה',   val: `${Math.round(stats.reduce((s,a)=>s+a.closeRate,0)/stats.length)}%`, color: 'text-blue-400' },
                { label: 'סה"כ לידים',    val: stats.reduce((s,a)=>s+a.total,0), color: 'text-slate-300' },
                { label: 'משימות באיחור', val: stats.reduce((s,a)=>s+a.overdue,0), color: 'text-red-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-zinc-800/60 rounded-xl p-3">
                  <div className={`text-xl font-black ${color}`}>{val}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 10 — MEETING BRIEF AGENT
══════════════════════════════════════════════════════════════════════════════ */
function MeetingBrief({ leads, currentUser, onToast }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast'];
}) {
  const [selectedId,   setSelectedId]   = useState('');
  const [meetingDate,  setMeetingDate]  = useState(new Date().toISOString().split('T')[0]);
  const [loading,      setLoading]      = useState(false);
  const [brief,        setBrief]        = useState('');
  const [copied,       setCopied]       = useState(false);

  const lead = leads.find(l => l.id === selectedId);

  const generate = async () => {
    if (!lead) return;
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setBrief('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const services  = lead.solutions.map(s => s.name).join(', ') || 'טרם הוגדרו';
      const notes     = lead.notes.slice(-5).map(n => `• ${n.text}`).join('\n') || 'אין הערות';
      const openTasks = lead.tasks.filter(t => !t.completed).slice(0, 3).map(t => `• ${t.description}`).join('\n') || 'אין';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 2000,
        messages: [{ role: 'user', content: `אתה מנהל מכירות מנוסה. הכן תדריך פגישה מקצועי ב**עברית**.

**פרטי לקוח:**
חברה: ${lead.company} | איש קשר: ${lead.contactName}
סטטוס: ${lead.status} | תקציב: ₪${lead.budget.toLocaleString()}/חודש | ציון: ${lead.aiScore}%
שירותים: ${services}

**הערות אחרונות:**
${notes}

**משימות פתוחות:**
${openTasks}

**תאריך פגישה:** ${meetingDate} | **מנהל:** ${currentUser}

כתוב תדריך פגישה הכולל:

## 👤 פרופיל הלקוח
[מה ידוע, האתגרים שלו, מה מניע אותו]

## 📋 מצב הליד
[היכן אנחנו בתהליך, מה קרה עד כה]

## ❓ 3 שאלות פתיחה חכמות
1.
2.
3.

## ⚠️ 3 התנגדויות צפויות + תשובות
1. התנגדות: ... → תשובה: ...
2. התנגדות: ... → תשובה: ...
3. התנגדות: ... → תשובה: ...

## 💰 אסטרטגיית תמחור
[מה להציע, באיזה מחיר להתחיל, גמישות]

## 🎯 מטרת הפגישה
[מה רוצים להשיג]

## ✅ צעד הבא אחרי הפגישה` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setBrief(text);
    } catch { onToast?.('שגיאה ביצירת התדריך', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><FileText size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">סוכן הכנת פגישה</p><p className="text-zinc-500 text-xs">תדריך פגישה מלא עם שאלות, התנגדויות ואסטרטגיה</p></div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-3">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">לקוח לפגישה</label>
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setBrief(''); }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">— בחר ליד —</option>
              {leads.filter(l => ['חדש','בתהליך','לקוח פעיל'].includes(l.status)).map(l => (
                <option key={l.id} value={l.id}>{l.company} ({l.status})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">תאריך הפגישה</label>
            <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          </div>
          {lead && (
            <div className="bg-slate-800/60 border border-white/[0.07] rounded-xl p-3 text-xs space-y-1">
              <p className="text-white font-bold">{lead.company}</p>
              <p className="text-slate-400">{lead.contactName} · {lead.phone}</p>
              <p className="text-slate-400">₪{lead.budget.toLocaleString()}/חודש · ציון {lead.aiScore}%</p>
              <p className="text-slate-400">{lead.notes.length} הערות · {lead.tasks.filter(t=>!t.completed).length} משימות</p>
            </div>
          )}
          <button onClick={generate} disabled={!selectedId || loading}
            className="w-full bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> מכין תדריך...</> : <><FileText size={15}/> הכן תדריך</>}
          </button>
        </div>
        <div className="md:col-span-2 bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-5 min-h-[360px]">
          {brief ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] text-slate-600 flex items-center gap-1"><Sparkles size={9} className="text-slate-400"/> נוצר על ידי AI</span>
                <button onClick={() => { navigator.clipboard.writeText(brief).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
                  <Copy size={10}/> {copied ? '✓ הועתק' : 'העתק'}
                </button>
              </div>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[550px]">{brief}</div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <FileText size={40} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm font-medium">בחר לקוח ולחץ "הכן תדריך"</p>
              <p className="text-slate-600 text-xs mt-1">שאלות, התנגדויות, אסטרטגיית מחיר ועוד</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 11 — MARKETING AI CONTENT GENERATOR
══════════════════════════════════════════════════════════════════════════════ */
function MarketingAI({ leads, currentUser, onToast }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast'];
}) {
  const platforms = [
    { key: 'instagram', label: 'אינסטגרם', emoji: '📸' },
    { key: 'facebook',  label: 'פייסבוק',  emoji: '👤' },
    { key: 'google',    label: 'גוגל',     emoji: '🔍' },
    { key: 'whatsapp',  label: 'וואטסאפ',  emoji: '💬' },
    { key: 'email',     label: 'אימייל',   emoji: '📧' },
    { key: 'linkedin',  label: 'לינקדאין', emoji: '💼' },
  ];
  const goals = [
    { key: 'leads',       label: 'יצירת לידים' },
    { key: 'awareness',   label: 'מודעות למותג' },
    { key: 'offer',       label: 'מבצע / הנחה' },
    { key: 'testimonial', label: 'המלצת לקוח' },
    { key: 'educational', label: 'תוכן מקצועי' },
  ];
  const [platform,    setPlatform]    = useState('instagram');
  const [goal,        setGoal]        = useState('leads');
  const [tone,        setTone]        = useState('professional');
  const [selectedId,  setSelectedId]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [content,     setContent]     = useState('');
  const [copied,      setCopied]      = useState(false);

  const lead = leads.find(l => l.id === selectedId);

  const generate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setContent('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const pl = platforms.find(p => p.key === platform)?.label ?? platform;
      const gl = goals.find(g => g.key === goal)?.label ?? goal;
      const toneMap: Record<string, string> = { professional: 'מקצועי ורציני', casual: 'קל ונגיש', urgent: 'דחוף ומניע לפעולה', friendly: 'חברותי ואישי' };
      const clientCtx = lead
        ? `עבור לקוח: ${lead.company} (${lead.status}, תקציב ₪${lead.budget.toLocaleString()}/חודש, שירותים: ${lead.solutions.map(s => s.name).join(', ')})`
        : 'תוכן כללי לעסק שיווק דיגיטלי';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 1200,
        messages: [{ role: 'user', content: `אתה מומחה שיווק דיגיטלי ישראלי. צור תוכן שיווקי בעברית.

פלטפורמה: ${pl}
מטרה: ${gl}
טון: ${toneMap[tone]}
${clientCtx}
מנהל: ${currentUser}

צור תוכן מקצועי ומותאם לפלטפורמה הכולל:
- כותרת / פתיחה חזקה
- גוף התוכן
- קריאה לפעולה (CTA)
- 5 האשטאגים רלוונטיים (אם מתאים לפלטפורמה)

כתוב ישירות את התוכן, ללא הסברים נוספים.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setContent(text);
    } catch { onToast?.('שגיאה ביצירת תוכן', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Sparkles size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">מנוע תוכן שיווקי AI</p><p className="text-zinc-500 text-xs">יוצר תוכן מקצועי לכל הפלטפורמות תוך שניות</p></div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-4">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">פלטפורמה</label>
            <div className="grid grid-cols-3 gap-1.5">
              {platforms.map(p => (
                <button key={p.key} onClick={() => setPlatform(p.key)}
                  className={`text-xs py-2 rounded-xl border transition-all font-medium flex flex-col items-center gap-0.5 ${platform === p.key ? 'bg-pink-600/30 border-pink-500/60 text-white' : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-white'}`}>
                  <span>{p.emoji}</span><span className="text-[10px]">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">מטרת התוכן</label>
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              {goals.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">טון</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="professional">מקצועי</option>
              <option value="casual">קל ונגיש</option>
              <option value="urgent">דחוף ומניע</option>
              <option value="friendly">חברותי ואישי</option>
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">התאמה ללקוח (אופציונלי)</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">— כללי —</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.company}</option>)}
            </select>
          </div>
          <button onClick={generate} disabled={loading}
            className="w-full bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> יוצר תוכן...</> : <><Sparkles size={15}/> צור תוכן</>}
          </button>
        </div>
        <div className="md:col-span-2 bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-5 min-h-[360px]">
          {content ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-slate-500 flex items-center gap-1"><Sparkles size={9}/> נוצר על ידי AI</span>
                <button onClick={() => { navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
                  <Copy size={10}/> {copied ? '✓ הועתק' : 'העתק'}
                </button>
              </div>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[500px]">{content}</div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <Sparkles size={40} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm font-medium">בחר פלטפורמה ומטרה</p>
              <p className="text-slate-600 text-xs mt-1">AI יכתוב תוכן מקצועי בשבילך</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 12 — CAMPAIGN OPTIMIZER
══════════════════════════════════════════════════════════════════════════════ */
function CampaignOptimizer({ leads, onToast }: {
  leads: Lead[]; onToast?: AgentsProps['onToast'];
}) {
  const [loading,  setLoading]  = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [budget,   setBudget]   = useState('10000');
  const [goal,     setGoal]     = useState('לידים');

  const sourceStats = leads.reduce((acc, l) => {
    if (!acc[l.source]) acc[l.source] = { leads: 0, clients: 0, revenue: 0 };
    acc[l.source].leads++;
    if (l.status === 'לקוח פעיל') { acc[l.source].clients++; acc[l.source].revenue += l.budget; }
    return acc;
  }, {} as Record<string, { leads: number; clients: number; revenue: number }>);

  const best = Object.entries(sourceStats).sort((a, b) => {
    const roiA = a[1].leads > 0 ? a[1].revenue / a[1].leads : 0;
    const roiB = b[1].leads > 0 ? b[1].revenue / b[1].leads : 0;
    return roiB - roiA;
  })[0];

  const analyze = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setAnalysis('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const statsText = Object.entries(sourceStats).map(([src, s]) =>
        `${src}: ${s.leads} לידים → ${s.clients} לקוחות (${s.leads > 0 ? Math.round(s.clients / s.leads * 100) : 0}% המרה) → ₪${s.revenue.toLocaleString()}/חודש הכנסה`
      ).join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 1500,
        messages: [{ role: 'user', content: `אתה מומחה פרפורמנס מרקטינג ישראלי. נתח את נתוני הקמפיינים ותן המלצות.

**נתוני ביצועים לפי מקור:**
${statsText}

**תקציב חודשי זמין:** ₪${Number(budget).toLocaleString()}
**מטרה עיקרית:** ${goal}

ספק ניתוח מקצועי הכולל:

## 📊 ניתוח ביצועים
[איזה ערוץ הכי משתלם ולמה]

## 💰 המלצת הקצאת תקציב
[פירוט מדויק כמה להשקיע בכל ערוץ]

## 🚀 3 פעולות מיידיות
1.
2.
3.

## ⚠️ מה להפסיק
[מה לא כדאי להמשיך]

## 📈 יעדים ריאליים לחודש הבא
[לידים, לקוחות, הכנסה צפויה]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setAnalysis(text);
    } catch { onToast?.('שגיאה בניתוח', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><TrendingUp size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">אופטימייזר קמפיינים AI</p><p className="text-zinc-500 text-xs">ניתוח ביצועים + המלצות הקצאת תקציב חכמות</p></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Object.entries(sourceStats).map(([src, s]) => {
          const roi = s.leads > 0 ? Math.round(s.clients / s.leads * 100) : 0;
          return (
            <div key={src} className={`bg-slate-800/60 border rounded-xl p-3 ${src === best?.[0] ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-700/50'}`}>
              {src === best?.[0] && <p className="text-[10px] text-amber-400 font-bold mb-1">🏆 הטוב ביותר</p>}
              <p className="text-white font-bold text-sm">{src}</p>
              <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                <div><div className="text-blue-400 font-black text-sm">{s.leads}</div><div className="text-[10px] text-slate-600">לידים</div></div>
                <div><div className="text-emerald-400 font-black text-sm">{roi}%</div><div className="text-[10px] text-slate-600">המרה</div></div>
                <div><div className="text-slate-300 font-black text-xs">₪{Math.round(s.revenue / 1000)}K</div><div className="text-[10px] text-slate-600">הכנסה</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-3">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">תקציב חודשי (₪)</label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">מטרת הקמפיין</label>
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option>לידים</option>
              <option>מכירות</option>
              <option>מודעות</option>
              <option>שימור לקוחות</option>
            </select>
          </div>
          <button onClick={analyze} disabled={loading || Object.keys(sourceStats).length === 0}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> מנתח...</> : <><Brain size={15}/> נתח ויעץ</>}
          </button>
          {Object.keys(sourceStats).length === 0 && <p className="text-slate-500 text-xs text-center">הוסף לידים עם מקורות כדי לנתח</p>}
        </div>
        <div className="md:col-span-2 bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-5 min-h-[300px]">
          {analysis ? (
            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[500px]">{analysis}</div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <BarChart3 size={40} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm font-medium">הזן תקציב ולחץ "נתח"</p>
              <p className="text-slate-600 text-xs mt-1">AI ימליץ על הקצאת תקציב אופטימלית</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 13 — CHURN SHIELD
══════════════════════════════════════════════════════════════════════════════ */
function ChurnShield({ leads, onToast }: {
  leads: Lead[]; onToast?: AgentsProps['onToast'];
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [plans,     setPlans]     = useState<Record<string, string>>({});

  const activeClients = leads.filter(l => l.status === 'לקוח פעיל');

  const churnScore = (lead: Lead): number => {
    let risk = 0;
    const days = daysSinceUpdate(lead);
    if (days > 30) risk += 30; else if (days > 14) risk += 15;
    const openTasks = lead.tasks.filter(t => !t.completed).length;
    risk += Math.min(openTasks * 10, 30);
    if (lead.notes.length === 0) risk += 20;
    else {
      const lastNote = new Date(lead.notes[lead.notes.length - 1]?.timestamp ?? 0);
      const daysSinceNote = Math.floor((Date.now() - lastNote.getTime()) / 86_400_000);
      if (daysSinceNote > 21) risk += 20;
    }
    if (lead.aiScore < 50) risk += 10;
    if (lead.waitingContent) risk += 10;
    return Math.min(100, risk);
  };

  const clients = activeClients.map(l => ({ lead: l, risk: churnScore(l) }))
    .sort((a, b) => b.risk - a.risk);

  const riskLevel = (score: number) =>
    score >= 60 ? { label: 'סיכון גבוה',   color: 'text-red-400',     bg: 'bg-red-900/20 border-red-700/40' }
    : score >= 30 ? { label: 'סיכון בינוני', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-700/40' }
    :               { label: 'יציב',          color: 'text-emerald-400', bg: 'bg-emerald-900/10 border-emerald-700/30' };

  const generatePlan = async (lead: Lead) => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoadingId(lead.id);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const days = daysSinceUpdate(lead);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 800,
        messages: [{ role: 'user', content: `אתה יועץ שימור לקוחות. צור תוכנית שימור קצרה ומעשית בעברית.

לקוח: ${lead.company} | ${lead.contactName} | ₪${lead.budget.toLocaleString()}/חודש
ימים ללא עדכון: ${days}
משימות פתוחות: ${lead.tasks.filter(t => !t.completed).length}
ציון AI: ${lead.aiScore}%
הערה אחרונה: ${lead.notes[lead.notes.length - 1]?.text ?? 'אין'}

כתוב:
## 🚨 סיבות הסיכון
[2-3 נקודות ספציפיות]

## 📞 פעולה מיידית (היום)
[מה לעשות עכשיו]

## 📝 הודעת WhatsApp לשלוח
[הודעה אישית ומוכנה לשליחה]

## 📅 תוכנית 30 יום
[3 פעולות עם תאריכים]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setPlans(prev => ({ ...prev, [lead.id]: text }));
    } catch { onToast?.('שגיאה', 'error'); }
    finally { setLoadingId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><AlertTriangle size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">מגן נטישה — Churn Shield</p><p className="text-zinc-500 text-xs">זיהוי לקוחות בסיכון + תוכנית שימור AI</p></div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'סיכון גבוה',   count: clients.filter(c => c.risk >= 60).length, color: 'text-red-400',     icon: '🔴' },
          { label: 'סיכון בינוני', count: clients.filter(c => c.risk >= 30 && c.risk < 60).length, color: 'text-amber-400', icon: '🟡' },
          { label: 'יציב',          count: clients.filter(c => c.risk < 30).length,  color: 'text-emerald-400', icon: '🟢' },
        ].map(s => (
          <div key={s.label} className="bg-zinc-900/80 border border-white/[0.07] rounded-xl p-3 text-center">
            <div className="text-xl">{s.icon}</div>
            <div className={`text-xl font-black ${s.color}`}>{s.count}</div>
            <div className="text-[10px] text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {activeClients.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <AlertTriangle size={32} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">אין לקוחות פעילים</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map(({ lead, risk }) => {
            const rl = riskLevel(risk);
            return (
              <div key={lead.id} className={`border rounded-2xl p-4 ${rl.bg}`}>
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold">{lead.company}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/40 ${rl.color}`}>{rl.label}</span>
                    </div>
                    <p className="text-zinc-500 text-xs mt-0.5">{lead.contactName} · ₪{lead.budget.toLocaleString()}/חודש · עדכון לפני {daysSinceUpdate(lead)} ימים</p>
                    <div className="mt-2 h-1.5 bg-slate-700/60 rounded-full">
                      <div className={`h-1.5 rounded-full ${risk >= 60 ? 'bg-red-500' : risk >= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${risk}%` }}/>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-0.5">ציון סיכון: {risk}%</p>
                  </div>
                  <button onClick={() => generatePlan(lead)} disabled={loadingId === lead.id}
                    className="flex-shrink-0 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-300 px-3 py-2 rounded-xl transition-colors font-medium flex items-center gap-1.5">
                    {loadingId === lead.id ? <Loader2 size={12} className="animate-spin"/> : <Brain size={12}/>}
                    {plans[lead.id] ? 'עדכן' : 'תוכנית AI'}
                  </button>
                </div>
                {plans[lead.id] && (
                  <div className="mt-3 bg-black/40 rounded-xl p-3 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap text-right border border-white/[0.06]">
                    {plans[lead.id]}
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
   FEATURE 14 — SMART TEMPLATES LIBRARY
══════════════════════════════════════════════════════════════════════════════ */
interface SmartTemplate {
  id: string; name: string; category: string; emoji: string; content: string; isCustom?: boolean;
}

const DEFAULT_TEMPLATES: SmartTemplate[] = [
  { id: 'onboarding',     name: 'קבלת לקוח חדש',     category: 'עסקי',   emoji: '🎉', content: 'שלום {שם},\n\nנשמח לברך אותך כלקוח חדש של {עסק}! 🎊\n\nאנחנו כבר מתחילים לעבוד על הפרויקט שלך ונעדכן אותך בכל שלב.\n\nאיש הקשר שלך: {מנהל}\n\nתודה על האמון! 🙏' },
  { id: 'monthly_report', name: 'דוח חודשי',           category: 'דוחות', emoji: '📊', content: 'שלום {שם},\n\nמצ"ב סיכום חודש {חודש}:\n\n✅ מה עשינו:\n•\n\n📈 תוצאות:\n•\n\n🎯 תוכנית חודש הבא:\n•\n\nנשמח לשיחה! {מנהל}' },
  { id: 'renewal',        name: 'חידוש חוזה',          category: 'מכירות',emoji: '🔄', content: 'שלום {שם},\n\nהחוזה שלנו מסתיים בקרוב 📅\n\nאנחנו ממליצים לחדש ונשמח להציע:\n• המשך השירותים הנוכחיים\n• שדרוג לחבילה המתאימה\n\nניתן לתאם שיחה? {מנהל}' },
  { id: 'followup_warm',  name: 'מעקב — ליד חם',      category: 'מכירות',emoji: '🔥', content: 'שלום {שם}!\n\nדיברנו לאחרונה על {נושא}.\n\nרציתי לעדכן שיש לנו מקום לעוד לקוח חדש החודש 🚀\n\nנשמח לקדם יחד — מתי נוח לדבר?' },
  { id: 'feedback',       name: 'בקשת פידבק',          category: 'שירות', emoji: '⭐', content: 'שלום {שם},\n\nעברנו {תקופה} ביחד!\n\nנשמח לשמוע — מה הכי עזר לך? מה אפשר לשפר?\n\nהמשוב שלך חשוב לנו 🙏\n\nתודה, {מנהל}' },
  { id: 'upsell',         name: 'הצעת שדרוג',          category: 'מכירות',emoji: '⬆️', content: 'שלום {שם},\n\nראינו תוצאות מדהימות ביחד 📈\n\nחשבנו שכדאי לשקול גם {שירות נוסף} — זה יכול לעזור ל:\n•\n\nאפשר להציג בשיחה קצרה? {מנהל}' },
  { id: 're_engage',      name: 'הפעלה מחדש',          category: 'שיווק', emoji: '💡', content: 'שלום {שם},\n\nזמן מה שלא דיברנו!\n\nהרגשנו שאולי הגיע הזמן לבדוק יחד איפה אתם עומדים ואיך אנחנו יכולים לעזור.\n\nנשמח לשיחה קצרה של 15 דקות — מתי מתאים? 📞' },
];

function SmartTemplates({ leads, currentUser, onToast }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast'];
}) {
  const [templates,         setTemplates]         = useState<SmartTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedTemplate,  setSelectedTemplate]  = useState<SmartTemplate | null>(null);
  const [selectedLeadId,    setSelectedLeadId]    = useState('');
  const [loading,           setLoading]           = useState(false);
  const [personalized,      setPersonalized]      = useState('');
  const [copied,            setCopied]            = useState(false);
  const [showSave,          setShowSave]          = useState(false);
  const [newName,           setNewName]           = useState('');
  const [newContent,        setNewContent]        = useState('');

  useEffect(() => {
    getDocs(collection(db, 'templates'))
      .then(snap => {
        const custom = snap.docs.map(d => d.data() as SmartTemplate);
        setTemplates([...DEFAULT_TEMPLATES, ...custom]);
      }).catch(() => {});
  }, []);

  const lead = leads.find(l => l.id === selectedLeadId);

  const personalize = async () => {
    if (!selectedTemplate) return;
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setPersonalized('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const leadCtx = lead
        ? `לקוח: ${lead.company} | ${lead.contactName} | שירותים: ${lead.solutions.map(s => s.name).join(', ')} | תקציב: ₪${lead.budget.toLocaleString()}/חודש | הערה אחרונה: ${lead.notes[lead.notes.length - 1]?.text ?? 'אין'}`
        : 'ללא לקוח ספציפי';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 600,
        messages: [{ role: 'user', content: `התאם אישית את התבנית הזו בעברית. שמור על הטון המקורי.

**תבנית:**
${selectedTemplate.content}

**מנהל:** ${currentUser}
**${leadCtx}**

החלף את {שם}, {עסק}, {מנהל} וכד' בפרטים האמיתיים. כתוב ישירות את ההודעה הסופית.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setPersonalized(text);
    } catch { onToast?.('שגיאה', 'error'); }
    finally { setLoading(false); }
  };

  const saveCustom = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    const t: SmartTemplate = { id: Date.now().toString(), name: newName, category: 'מותאם אישית', emoji: '⚡', content: newContent, isCustom: true };
    await setDoc(doc(db, 'templates', t.id), t).catch(() => {});
    setTemplates(prev => [...prev, t]);
    setNewName(''); setNewContent(''); setShowSave(false);
    onToast?.('תבנית נשמרה ✓', 'success');
  };

  const deleteCustomTemplate = async (id: string) => {
    await deleteDoc(doc(db, 'templates', id)).catch(() => {});
    setTemplates(prev => prev.filter(t => t.id !== id));
    if (selectedTemplate?.id === id) setSelectedTemplate(null);
  };

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><FileText size={18} className="text-black"/></div>
          <div><p className="text-white font-bold text-sm">ספריית תבניות חכמות</p><p className="text-zinc-500 text-xs">{templates.length} תבניות · AI מתאים אישית לכל לקוח</p></div>
        </div>
        <button onClick={() => setShowSave(s => !s)}
          className="text-xs bg-violet-700/50 hover:bg-violet-600/60 text-violet-300 border border-violet-600/40 px-3 py-1.5 rounded-xl font-medium flex items-center gap-1">
          <Plus size={12}/> תבנית חדשה
        </button>
      </div>

      {showSave && (
        <div className="bg-slate-800/60 border border-violet-700/30 rounded-2xl p-4 space-y-3">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="שם התבנית..."
            className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
            placeholder="תוכן התבנית... (השתמש ב-{שם}, {עסק}, {מנהל} כמשתנים)"
            rows={4} className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30 resize-none"/>
          <div className="flex gap-2">
            <button onClick={saveCustom} className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors">שמור</button>
            <button onClick={() => setShowSave(false)} className="bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded-xl">ביטול</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-4">
        <div className="md:col-span-2 space-y-1 overflow-y-auto max-h-[500px]">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1 py-1.5">{cat}</p>
              {templates.filter(t => t.category === cat).map(t => (
                <button key={t.id} onClick={() => { setSelectedTemplate(t); setPersonalized(''); }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2 group ${selectedTemplate?.id === t.id ? 'bg-violet-600/30 border border-violet-500/50 text-white' : 'text-zinc-400 hover:text-white hover:bg-slate-800'}`}>
                  <span className="flex-shrink-0">{t.emoji}</span>
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.isCustom && (
                    <button onClick={e => { e.stopPropagation(); deleteCustomTemplate(t.id); }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all flex-shrink-0">
                      <Trash2 size={11}/>
                    </button>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="md:col-span-3 space-y-3">
          {selectedTemplate ? (
            <>
              <div className="bg-zinc-900/80 border border-white/[0.07] rounded-xl p-3">
                <p className="text-slate-500 text-xs mb-2 font-medium">תוכן מקורי:</p>
                <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{selectedTemplate.content}</p>
              </div>
              <select value={selectedLeadId} onChange={e => { setSelectedLeadId(e.target.value); setPersonalized(''); }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
                <option value="">— התאמה אישית (בחר לקוח) —</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.company}</option>)}
              </select>
              <button onClick={personalize} disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={14} className="animate-spin"/> מתאים...</> : <><Sparkles size={14}/> התאם אישית עם AI</>}
              </button>
              {personalized && (
                <div className="bg-slate-800/60 border border-violet-700/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-violet-400 text-xs font-bold">✨ גרסה מותאמת אישית</span>
                    <button onClick={() => { navigator.clipboard.writeText(personalized).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1">
                      <Copy size={10}/> {copied ? '✓' : 'העתק'}
                    </button>
                  </div>
                  <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{personalized}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
              <FileText size={36} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm">בחר תבנית מהרשימה</p>
              <p className="text-slate-600 text-xs mt-1">AI יתאים אישית עבור הלקוח שלך</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 15 — SALES COACH AI
══════════════════════════════════════════════════════════════════════════════ */
function SalesCoach({ leads, team, standaloneTask, currentUser, onToast }: {
  leads: Lead[]; team: TeamMember[]; standaloneTask: StandaloneTask[]; currentUser: string; onToast?: AgentsProps['onToast'];
}) {
  const [loading,  setLoading]  = useState(false);
  const [coaching, setCoaching] = useState('');
  const [period,   setPeriod]   = useState<'week' | 'month' | 'quarter'>('month');

  const total      = leads.length;
  const active     = leads.filter(l => l.status === 'לקוח פעיל').length;
  const revenue    = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
  const avgScore   = total > 0 ? Math.round(leads.reduce((s, l) => s + l.aiScore, 0) / total) : 0;
  const closeRate  = total > 0 ? Math.round((active / total) * 100) : 0;
  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const overdueTasks = standaloneTask.filter(t => !t.completed && (() => { try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; } })()).length;
  const stale      = leads.filter(l => ['חדש', 'בתהליך'].includes(l.status) && daysSinceUpdate(l) >= 14).length;

  const sourceConversion = leads.reduce((acc, l) => {
    if (!acc[l.source]) acc[l.source] = { total: 0, active: 0 };
    acc[l.source].total++;
    if (l.status === 'לקוח פעיל') acc[l.source].active++;
    return acc;
  }, {} as Record<string, { total: number; active: number }>);
  const bestSource = Object.entries(sourceConversion).sort((a, b) => {
    const rA = a[1].total > 0 ? a[1].active / a[1].total : 0;
    const rB = b[1].total > 0 ? b[1].active / b[1].total : 0;
    return rB - rA;
  })[0];

  const analyze = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setCoaching('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const periodLabel = period === 'week' ? 'שבועי' : period === 'month' ? 'חודשי' : 'רבעוני';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 2000,
        messages: [{ role: 'user', content: `אתה מאמן מכירות מוביל. נתח את הנתונים ותן אימון אישי ל${currentUser} בעברית.

**נתוני ביצועים:**
• סה"כ לידים: ${total} | לקוחות פעילים: ${active} | שיעור סגירה: ${closeRate}%
• הכנסה חודשית: ₪${revenue.toLocaleString()} | ממוצע ציון AI: ${avgScore}%
• לידים ישנים (14+ ימים): ${stale} | משימות באיחור: ${overdueTasks}
• מקור המרה הטוב ביותר: ${bestSource?.[0] ?? 'לא ידוע'} (${bestSource ? Math.round(bestSource[1].active / bestSource[1].total * 100) : 0}%)
• גודל צוות: ${team.length} אנשים
**תקופת ניתוח:** ${periodLabel}

כתוב אימון מכירות אישי ומעשי הכולל:

## 🏆 הישגים לחגוג
[מה עשית טוב — חגוג את זה!]

## 📊 ניתוח מצב אמת
[איפה אתה עומד ביחס לפוטנציאל]

## 🎯 3 אזורי שיפור קריטיים
1. [בעיה + פתרון ספציפי]
2. [בעיה + פתרון ספציפי]
3. [בעיה + פתרון ספציפי]

## 💡 5 טקטיקות מכירה לשבוע הקרוב
1.
2.
3.
4.
5.

## 📅 משימות ל-7 ימים הקרובים
[רשימה ספציפית עם מה לעשות ומתי]

## 💪 מסר מעורר מהמאמן
[אישי ומעצים]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setCoaching(text);
    } catch { onToast?.('שגיאה', 'error'); }
    finally { setLoading(false); }
  };

  const stats = [
    { label: 'לידים',       val: total,                                          color: 'text-blue-400' },
    { label: 'לקוחות',      val: active,                                         color: 'text-emerald-400' },
    { label: 'שיעור סגירה', val: `${closeRate}%`,                                color: 'text-violet-400' },
    { label: 'הכנסה',       val: `₪${Math.round(revenue / 1000)}K`,             color: 'text-amber-400' },
    { label: 'ציון ממוצע',  val: `${avgScore}%`,                                 color: 'text-cyan-400' },
    { label: 'באיחור',      val: overdueTasks, color: overdueTasks > 0 ? 'text-red-400' : 'text-slate-500' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Brain size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">מאמן מכירות AI</p><p className="text-zinc-500 text-xs">ניתוח ביצועים אישי + תוכנית פעולה מותאמת</p></div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {stats.map(s => (
          <div key={s.label} className="bg-zinc-900/80 border border-white/[0.07] rounded-xl p-3 text-center">
            <div className={`text-lg font-black ${s.color}`}>{s.val}</div>
            <div className="text-[10px] text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        {([['week', 'שבועי'], ['month', 'חודשי'], ['quarter', 'רבעוני']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setPeriod(key)}
            className={`text-xs px-4 py-2 rounded-xl border font-bold transition-all ${period === key ? 'bg-emerald-600/30 border-emerald-500/50 text-white' : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
        <button onClick={analyze} disabled={loading}
          className="mr-auto bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-2 px-5 rounded-xl transition-colors flex items-center gap-2 text-sm">
          {loading ? <><Loader2 size={14} className="animate-spin"/> מנתח...</> : <><Brain size={14}/> קבל אימון</>}
        </button>
      </div>

      {coaching ? (
        <div className="bg-slate-800/40 border border-emerald-700/30 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><Brain size={10}/> מאמן מכירות AI</span>
            <button onClick={() => { navigator.clipboard.writeText(coaching); onToast?.('הועתק ✓', 'success'); }}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1">
              <Copy size={10}/> העתק
            </button>
          </div>
          <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[600px]">{coaching}</div>
        </div>
      ) : (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Brain size={40} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-zinc-400 font-bold">בחר תקופה ולחץ "קבל אימון"</p>
          <p className="text-slate-600 text-sm mt-1">AI ינתח את הביצועים שלך ויכין תוכנית אישית</p>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN — AGENTS HUB
══════════════════════════════════════════════════════════════════════════════ */
export default function Agents({
  leads, team, currentUser, standaloneTask,
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

  // Churn risk count for badge
  const clients_at_risk = leads.filter(l => {
    if (l.status !== 'לקוח פעיל') return false;
    let risk = 0;
    const days = daysSinceUpdate(l);
    if (days > 30) risk += 30; else if (days > 14) risk += 15;
    risk += Math.min(l.tasks.filter(t => !t.completed).length * 10, 30);
    if (l.notes.length === 0) risk += 20;
    if (l.aiScore < 50) risk += 10;
    return Math.min(100, risk) >= 60;
  }).length;

  const tabs: { key: AgentTab; emoji: string; label: string; badge?: string | number }[] = [
    { key: 'followup',    emoji: '🎯', label: 'סוכן מעקב',     badge: staleCount > 0 ? staleCount : undefined },
    { key: 'forecast',    emoji: '📈', label: 'תחזית הכנסות',  badge: `₪${Math.round(confirmed/1000)}K` },
    { key: 'proposal',    emoji: '✍️', label: 'מחולל הצעות',   badge: undefined },
    { key: 'alerts',      emoji: '🚨', label: 'התראות',        badge: alertCount > 0 ? alertCount : undefined },
    { key: 'roi',         emoji: '📊', label: 'ROI מקורות',    badge: undefined },
    { key: 'enrich',      emoji: '🔍', label: 'העשרת לידים',   badge: undefined },
    { key: 'workflow',    emoji: '⚡', label: 'אוטומציות',     badge: undefined },
    { key: 'portal',      emoji: '🔗', label: 'פורטל לקוחות',  badge: undefined },
    { key: 'performance', emoji: '🏆', label: 'ביצועי סוכנים', badge: undefined },
    { key: 'brief',       emoji: '📋', label: 'הכנת פגישה',    badge: undefined },
    { key: 'marketing',   emoji: '🎨', label: 'תוכן שיווקי',   badge: undefined },
    { key: 'campaign',    emoji: '📡', label: 'קמפיינים',      badge: undefined },
    { key: 'churn',       emoji: '🛡️', label: 'מגן נטישה',    badge: clients_at_risk > 0 ? clients_at_risk : undefined },
    { key: 'templates',   emoji: '📄', label: 'תבניות',        badge: undefined },
    { key: 'coach',       emoji: '🧠', label: 'מאמן מכירות',  badge: undefined },
  ];

  const activeClients = leads.filter(l => l.status === 'לקוח פעיל').length;

  const tabGroups: { label: string; desc: string; keys: AgentTab[] }[] = [
    { label: 'מכירות',  desc: '5 סוכנים', keys: ['followup','forecast','proposal','alerts','roi'] },
    { label: 'לידים',   desc: '4 סוכנים', keys: ['enrich','workflow','brief','performance'] },
    { label: 'לקוחות',  desc: '3 סוכנים', keys: ['portal','churn','templates'] },
    { label: 'שיווק',   desc: '3 סוכנים', keys: ['marketing','campaign','coach'] },
  ];

  const currentTab = tabs.find(t => t.key === tab)!;
  const currentGroup = tabGroups.find(g => g.keys.includes(tab))!;

  return (
    <div className="-mx-4 md:mx-0 flex flex-col gap-0">

      {/* ── HERO — BLACK & WHITE ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-black px-4 md:px-6 pt-5 pb-5 md:rounded-2xl md:mb-4">
        {/* Fine grid */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)', backgroundSize: '28px 28px' }}/>
        {/* Top shimmer line */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"/>

        <div className="relative flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shadow-xl">
                <Bot size={20} className="text-black"/>
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white border-2 border-black animate-pulse"/>
            </div>
            <div>
              <h1 className="text-white font-black text-xl md:text-2xl leading-none tracking-tight">סוכנים חכמים</h1>
              <p className="text-white/30 text-[10px] font-semibold tracking-widest uppercase mt-0.5">AI Agents · 24 / 7</p>
            </div>
          </div>
          <div className="text-left flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 border border-white/15 rounded-full px-2.5 py-1">
              <Zap size={8} className="text-white/60"/>
              <span className="text-white/60 text-[10px] font-black tracking-widest">15 AGENTS</span>
            </div>
            <span className="text-white/40 text-[10px] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse inline-block"/>online
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'לידים',        val: leads.length },
            { label: 'לקוחות פעילים',val: activeClients },
            { label: 'הכנסה חודשית', val: `₪${Math.round(confirmed/1000)}K` },
            { label: 'התראות',       val: alertCount },
          ].map((s, i) => (
            <div key={s.label} className="bg-white/[0.05] border border-white/[0.08] rounded-xl p-2.5 text-center">
              <div className={`text-base md:text-lg font-black ${i === 3 && alertCount > 0 ? 'text-white' : 'text-white'}`}>{s.val}</div>
              <div className="text-[9px] md:text-[10px] text-white/30 leading-tight mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── BODY: NAV SIDEBAR + CONTENT ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-3 px-4 md:px-0 pb-6 md:items-start">

        {/* ── LEFT: Category nav ───────────────────────────────────────────── */}
        <div className="md:w-52 md:flex-shrink-0 md:sticky md:top-[65px]">
          <div className="bg-black border border-white/[0.08] rounded-2xl overflow-hidden">
            {tabGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'border-t border-white/[0.06]' : ''}>
                {/* Group header */}
                <div className="px-4 py-2.5 flex items-center justify-between bg-white/[0.02]">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">{group.label}</span>
                  <span className="text-[9px] text-white/20 font-medium">{group.desc}</span>
                </div>
                {/* Agent buttons */}
                <div className="py-1">
                  {tabs.filter(t => group.keys.includes(t.key)).map(t => {
                    const isActive = tab === t.key;
                    return (
                      <button key={t.key} onClick={() => setTab(t.key)}
                        className={`w-full text-right px-3 py-2.5 flex items-center gap-2.5 transition-all text-sm ${
                          isActive
                            ? 'bg-white text-black font-bold'
                            : 'text-white/40 hover:text-white hover:bg-white/[0.06]'
                        }`}>
                        <span className="text-base leading-none flex-shrink-0">{t.emoji}</span>
                        <span className="flex-1 leading-none">{t.label}</span>
                        {t.badge !== undefined && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black leading-none flex-shrink-0 ${
                            isActive
                              ? 'bg-black/15 text-black'
                              : typeof t.badge === 'number'
                                ? 'bg-white text-black'
                                : 'bg-white/10 text-white/50'
                          }`}>{t.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Content ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Active agent header */}
          <div className="bg-black border border-white/[0.08] rounded-2xl px-4 py-3 mb-3 flex items-center gap-3">
            <span className="text-xl leading-none">{currentTab.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-sm leading-none">{currentTab.label}</p>
              <p className="text-white/30 text-[10px] mt-0.5">{currentGroup.label}</p>
            </div>
            {currentTab.badge !== undefined && (
              <span className={`text-[10px] px-2 py-1 rounded-full font-black ${
                typeof currentTab.badge === 'number' ? 'bg-white text-black' : 'bg-white/10 text-white/60'
              }`}>{currentTab.badge}</span>
            )}
          </div>

          {/* Content card */}
          <div className="bg-zinc-950 border border-white/[0.07] rounded-2xl overflow-hidden">
            <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"/>
            <div className="p-4 md:p-5">
              {tab === 'followup' && (
                <FollowupAgent leads={leads} currentUser={currentUser}
                  onCreateTask={onCreateTask} onUpdateLead={onUpdateLead} onToast={onToast}/>
              )}
              {tab === 'forecast'    && <RevenueForecast leads={leads}/>}
              {tab === 'proposal'    && <ProposalGenerator leads={leads} currentUser={currentUser} onToast={onToast}/>}
              {tab === 'alerts'      && <SmartAlerts leads={leads} standaloneTask={standaloneTask}/>}
              {tab === 'roi'         && <SourceROI leads={leads}/>}
              {tab === 'enrich'      && <LeadEnrichment leads={leads} onUpdateLead={onUpdateLead} onToast={onToast}/>}
              {tab === 'workflow'    && (
                <WorkflowBuilder leads={leads} currentUser={currentUser}
                  onCreateTask={onCreateTask} onUpdateLead={onUpdateLead} onToast={onToast}/>
              )}
              {tab === 'portal'      && <PortalManager leads={leads} onToast={onToast}/>}
              {tab === 'performance' && (
                <AgentPerformance leads={leads} team={team} standaloneTask={standaloneTask}/>
              )}
              {tab === 'brief'       && <MeetingBrief leads={leads} currentUser={currentUser} onToast={onToast}/>}
              {tab === 'marketing'   && <MarketingAI leads={leads} currentUser={currentUser} onToast={onToast}/>}
              {tab === 'campaign'    && <CampaignOptimizer leads={leads} onToast={onToast}/>}
              {tab === 'churn'       && <ChurnShield leads={leads} onToast={onToast}/>}
              {tab === 'templates'   && <SmartTemplates leads={leads} currentUser={currentUser} onToast={onToast}/>}
              {tab === 'coach'       && <SalesCoach leads={leads} team={team} standaloneTask={standaloneTask} currentUser={currentUser} onToast={onToast}/>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
