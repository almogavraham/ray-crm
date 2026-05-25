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
import { useLang } from '../contexts/LangContext';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';

/* ─── Types ────────────────────────────────────────────────────────────────── */
type AgentTab = 'followup' | 'forecast' | 'alerts' | 'roi' | 'proposal' | 'enrich' | 'workflow' | 'brief' | 'marketing' | 'campaign' | 'churn' | 'templates' | 'coach';

interface AgentsProps {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  workspaceId?: string;
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
function FollowupAgent({ leads, currentUser, onCreateTask, onUpdateLead, onToast, workspaceId }: {
  leads: Lead[];
  currentUser: string;
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
  workspaceId?: string;
}) {
  const { t } = useLang();
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
    // Check token balance before calling AI
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      // Deduct tokens after successful call
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Follow-up agent');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
    } catch { onToast?.('שגיאה ביצירת הודעה', 'error'); }
    finally { setGeneratingFor(null); }
  }, [mirrorStyles, currentUser, onToast, workspaceId]);

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
    if (days >= 21) return { border: 'border-red-700/50',    bg: 'bg-red-900/20',    dot: 'bg-red-400',    label: '🔴 ' + t('agents.urgent'),        color: 'text-red-400' };
    if (days >= 14) return { border: 'border-orange-700/40', bg: 'bg-orange-900/15', dot: 'bg-orange-400', label: '🟠 ' + t('agents.needsAttention'), color: 'text-orange-400' };
    return              { border: 'border-amber-700/30',  bg: 'bg-amber-900/10',  dot: 'bg-amber-400',  label: '🟡 ' + t('agents.needsAttention'), color: 'text-amber-400' };
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
            <p className="text-white font-bold text-sm">{t('agents.tab.followup')}</p>
            <p className="text-zinc-500 text-xs">{t('agents.followupDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-zinc-500 text-xs">{t('agents.daysThreshold')}</span>
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
          { label: t('agents.needsAttention'),  value: staleLeads.length,                                         color: 'text-red-400' },
          { label: t('agents.urgent'),          value: staleLeads.filter(l => daysSinceUpdate(l) >= 21).length,  color: 'text-orange-400' },
          { label: t('agents.mirrorStyle'),     value: mirrorStyles.length,                                       color: 'text-violet-400' },
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
          <p className="text-white font-bold">{t('agents.allUpdated')}</p>
          <p className="text-zinc-400 text-sm mt-1">{t('agents.noLeadsThreshold')} {threshold} {t('agents.daysLabel')}</p>
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
                      {isGen ? <><Loader2 size={12} className="animate-spin"/> {t('agents.generating')}</> : <><Brain size={12}/> {t('agents.generateFollowup')}</>}
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
                        <Copy size={10}/> {copiedId === lead.id ? '✓ ' + t('agents.copied') : t('agents.copyMessage')}
                      </button>
                      {waNumber && (
                        <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`}
                          target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs bg-green-800/60 hover:bg-green-700/60 text-green-300 border border-green-700/40 px-3 py-1.5 rounded-lg transition-colors font-medium">
                          <MessageCircle size={10}/> {t('agents.sendWhatsapp')}
                        </a>
                      )}
                      <button onClick={() => generateMessage(lead)} disabled={isGen}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg hover:bg-slate-700 transition-colors">
                        <RefreshCw size={10}/> {t('agents.change')}
                      </button>
                      <span className="mr-auto text-[10px] text-slate-600 flex items-center gap-1">
                        <Sparkles size={9} className="text-violet-500"/> {mirrorStyles.length > 0 ? t('agents.mirrorStyle') : 'Default'}
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
export function RevenueForecast({ leads }: { leads: Lead[] }) {
  const { t } = useLang();
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
            <p className="text-white font-bold text-sm">{t('agents.forecastTitle')}</p>
            <p className="text-zinc-500 text-xs">{t('agents.forecastDesc')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['pessimistic','base','optimistic'] as const).map(s => (
            <button key={s} onClick={() => setScenario(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${scenario === s
                ? s === 'optimistic' ? 'bg-emerald-600 text-white' : s === 'pessimistic' ? 'bg-red-700 text-white' : 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              {s === 'pessimistic' ? t('agents.pessimistic') : s === 'optimistic' ? t('agents.optimistic') : t('agents.base')}
            </button>
          ))}
        </div>
      </div>

      {/* Big 3 numbers */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('agents.confirmed'), sub: `${activeLeads.length} ${t('agents.stat.activeClients')}`, val: confirmed, color: 'emerald' },
          { label: t('agents.fromPipeline'), sub: `${pipelineLeads.length} ${t('agents.stat.leads')} | ₪${pipelineTotal.toLocaleString()}`, val: fromPipeline, color: 'blue' },
          { label: t('agents.forecastTotal'), sub: scenario === 'base' ? t('agents.base') : scenario === 'optimistic' ? t('agents.optimistic') : t('agents.pessimistic'), val: total, color: 'indigo' },
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
        <h3 className="text-white font-bold text-sm">{t('agents.byStatus')}</h3>
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
            <Star size={14} className="text-amber-400"/> {t('agents.topOpportunities')}
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
function ProposalGenerator({ leads, currentUser, onToast, workspaceId }: {
  leads: Lead[];
  currentUser: string;
  onToast?: AgentsProps['onToast'];
  workspaceId?: string;
}) {
  const { t } = useLang();
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Proposal generator');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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
          <p className="text-white font-bold text-sm">{t('agents.proposalTitle')}</p>
          <p className="text-zinc-500 text-xs">{t('agents.proposalDesc')}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Left: form */}
        <div className="space-y-4">
          {/* Lead selector */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">{t('agents.leadOptional')}</label>
            <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">{t('agents.noSpecificLead')}</option>
              {leads.filter(l => ['חדש','בתהליך'].includes(l.status)).map(l => (
                <option key={l.id} value={l.id}>{l.company} — {l.contactName}</option>
              ))}
            </select>
          </div>

          {/* Services */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">{t('agents.servicesToInclude')}</label>
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
            <label className="block text-zinc-500 text-xs font-medium mb-2">{t('agents.monthlyBudget')}</label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="5000"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">{t('agents.additionalNotes')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="פרטים מיוחדים, דרישות, נקודות שיש להדגיש..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-white/30 text-right"/>
          </div>

          <button onClick={generate} disabled={loading || services.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> {t('agents.generatingProposal')}</> : <><Zap size={15}/> {t('agents.generateProposal')}</>}
          </button>
        </div>

        {/* Right: result */}
        <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 min-h-[300px] relative">
          {result ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={copyResult}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                  <Copy size={10}/> {copied ? '✓ ' + t('agents.copied') : t('agents.copyAll')}
                </button>
                <span className="text-[10px] text-slate-600 flex items-center gap-1"><Sparkles size={9} className="text-violet-400"/> {t('agents.aiGenerated')}</span>
              </div>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[500px]">
                {result}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Target size={32} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm">{t('agents.selectAndGenerate')}</p>
              <p className="text-slate-600 text-xs mt-1">{t('agents.aiGenerated')}</p>
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

export function SmartAlerts({ leads, standaloneTask }: { leads: Lead[]; standaloneTask: StandaloneTask[] }) {
  const { t } = useLang();
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
            <p className="text-white font-bold text-sm">{t('agents.smartAlerts')}</p>
            <p className="text-zinc-500 text-xs">{t('agents.alertsLive')} — {alerts.length} {t('agents.alertsPoints')}</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {criticals.length > 0 && <span className="bg-red-700/40 text-red-300 px-2 py-0.5 rounded-full font-bold border border-red-600/40">{criticals.length} {t('agents.critical')}</span>}
          {warnings.length > 0  && <span className="bg-amber-700/30 text-amber-300 px-2 py-0.5 rounded-full font-bold border border-amber-600/30">{warnings.length} {t('agents.warning')}</span>}
          {infos.length > 0     && <span className="bg-blue-700/30 text-blue-300 px-2 py-0.5 rounded-full font-bold border border-blue-600/30">{infos.length} {t('agents.info')}</span>}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3"/>
          <p className="text-white font-bold">{t('agents.allOk')}</p>
        </div>
      ) : (
        [[t('agents.critical'), criticals], [t('agents.warning'), warnings], [t('agents.info'), infos]].map(([label, group]) =>
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
export function SourceROI({ leads }: { leads: Lead[] }) {
  const { t } = useLang();
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
          <p className="text-white font-bold text-sm">{t('agents.roiTitle')}</p>
          <p className="text-zinc-500 text-xs">{t('agents.roiDesc')}</p>
        </div>
      </div>

      {best && best.active > 0 && (
        <div className="bg-gradient-to-l from-emerald-900/30 to-slate-800/60 border border-emerald-700/40 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-4xl">{EMOJI[best.src]}</span>
          <div>
            <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">{t('agents.bestSource')}</p>
            <p className="text-white font-black text-lg">{best.src}</p>
            <p className="text-zinc-500 text-xs">₪{best.rev.toLocaleString()}/חודש · {Math.round(best.conv)}% אחוז סגירה · {best.all} לידים</p>
          </div>
        </div>
      )}

      {/* Revenue bars */}
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-5 space-y-4">
        <h3 className="text-white font-bold text-sm">{t('agents.revenueBySource')}</h3>
        {data.map(d => (
          <div key={d.src} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span>{EMOJI[d.src]}</span>
                <span className="text-white font-semibold">{d.src}</span>
                <span className="text-slate-500">({d.all} לידים, {d.active} סגורים)</span>
              </div>
              <div className="flex gap-3">
                <span className="text-slate-400">{t('agents.close')}: {Math.round(d.conv)}%</span>
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
        <h3 className="text-white font-bold text-sm mb-4">{t('agents.volumeBySource')}</h3>
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
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500/80"/> {t('agents.stat.activeClients')}</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-slate-600/50"/> Pipeline</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-right text-slate-500 font-semibold px-4 py-3">{t('agents.colSource')}</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">{t('agents.colLeads')}</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">{t('agents.colActive')}</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">{t('agents.colClose')}</th>
              <th className="text-center text-slate-500 font-semibold px-3 py-3">{t('agents.colAiScore')}</th>
              <th className="text-left text-slate-500 font-semibold px-4 py-3">{t('agents.colRevenue')}</th>
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
function LeadEnrichment({ leads, onUpdateLead, onToast, workspaceId }: {
  leads: Lead[];
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
  workspaceId?: string;
}) {
  const { t } = useLang();
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      let totalInputTokens = res.usage?.input_tokens ?? 0;
      let totalOutputTokens = res.usage?.output_tokens ?? 0;
      if (jsonMatch) { setResult(JSON.parse(jsonMatch[0])); }
      else {
        // Fallback: ask without web search for generic insight
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r2: any = await (client.messages as any).create({
          model: 'claude-opus-4-5', max_tokens: 600,
          messages: [{ role: 'user', content: `ספק הערכה כללית לחברה בשם "${lead.company}" בתחום הנדל"ן בישראל בפורמט JSON:\n{"industry":"נדל\\"ן","description":"","readinessScore":65,"insights":["insight1","insight2","insight3"],"suggestedBudget":4500}` }],
        });
        totalInputTokens += r2.usage?.input_tokens ?? 0;
        totalOutputTokens += r2.usage?.output_tokens ?? 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t2 = r2.content?.find((b: any) => b.type === 'text')?.text ?? '';
        const m2 = t2.match(/\{[\s\S]*?\}/);
        if (m2) setResult(JSON.parse(m2[0]));
      }
      try {
        const cost = calculateCost('claude-opus-4-5', totalInputTokens, totalOutputTokens);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Lead enrichment');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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
        <div><p className="text-white font-bold text-sm">{t('agents.enrichTitle')}</p><p className="text-zinc-500 text-xs">{t('agents.enrichDesc')}</p></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.selectLeadEnrich')}</label>
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setResult(null); }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">{t('agents.selectLead')}</option>
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
            {loading ? <><Loader2 size={15} className="animate-spin"/> {t('agents.searching')}</> : <><Globe size={15}/> {t('agents.enrichWithAI')}</>}
          </button>
        </div>
        <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 min-h-[260px]">
          {result ? (
            <div className="space-y-3">
              {result.readinessScore !== undefined && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-500 text-xs">{t('agents.digitalReadiness')}</span>
                    <span className={`font-black text-lg ${sc(result.readinessScore)}`}>{result.readinessScore}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full"><div className={`h-2 rounded-full ${sb(result.readinessScore)}`} style={{ width: `${result.readinessScore}%` }}/></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {result.industry   && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">{t('agents.industry')}</p><p className="text-white font-medium">{result.industry}</p></div>}
                {result.employees  && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">{t('agents.size')}</p><p className="text-white font-medium">{result.employees}</p></div>}
                {result.founded    && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">{t('agents.founded')}</p><p className="text-white font-medium">{result.founded}</p></div>}
                {result.website    && <div className="bg-zinc-800/60 rounded-lg p-2"><p className="text-slate-500">{t('agents.website')}</p><a href={result.website} target="_blank" rel="noreferrer" className="text-cyan-400 flex items-center gap-1 hover:underline"><ExternalLink size={10}/> {t('agents.open')}</a></div>}
              </div>
              {result.description && <p className="text-xs text-slate-300 bg-slate-700/30 rounded-xl p-3 leading-relaxed">{result.description}</p>}
              {result.insights && result.insights.length > 0 && (
                <div className="space-y-1">
                  <p className="text-slate-500 text-xs font-bold">{t('agents.salesInsights')}</p>
                  {result.insights.map((ins, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs"><span className="text-cyan-400 flex-shrink-0">→</span><span className="text-slate-300">{ins}</span></div>
                  ))}
                </div>
              )}
              {result.suggestedBudget && (
                <div className="flex items-center justify-between bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3">
                  <div><p className="text-emerald-400 text-xs font-bold">{t('agents.suggestedBudget')}</p><p className="text-white font-black">₪{result.suggestedBudget.toLocaleString()}/חודש</p></div>
                  <button onClick={applyBudget} className="text-xs bg-emerald-700/50 hover:bg-emerald-600/60 text-emerald-300 border border-emerald-600/40 px-3 py-1.5 rounded-lg transition-colors font-medium">{t('agents.applyToLead')}</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Globe size={32} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm">{t('agents.selectLeadFirst')}</p>
              <p className="text-slate-600 text-xs mt-1">{t('agents.aiWillSearch')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 7 — WORKFLOW BUILDER (Advanced)
══════════════════════════════════════════════════════════════════════════════ */
type TriggerType = 'days_inactive' | 'status_is' | 'score_above' | 'score_below' | 'budget_above' | 'source_is' | 'has_overdue_task';
type WFActionType = 'create_task' | 'change_status' | 'send_whatsapp_ai' | 'send_email_ai' | 'add_note' | 'assign_to' | 'send_webhook';

interface WorkflowCondition { id: string; type: TriggerType; value: string; }
interface WorkflowAction    { id: string; type: WFActionType; config: Record<string, string>; }
interface Workflow {
  id: string; name: string; description?: string; active: boolean;
  conditionLogic: 'and' | 'or';
  conditions: WorkflowCondition[];
  actions:    WorkflowAction[];
  createdAt: string; runCount: number; lastRunAt?: string;
}
interface RunResult {
  lead: Lead;
  actionResults: { actionId: string; type: WFActionType; message?: string; subject?: string; success: boolean }[];
}

const WF_STATUSES = ['חדש','בתהליך','לקוח פעיל','רימרקטינג','לא רלוונטי'];
const WF_SOURCES  = ['אורגני','פרסום ממומן','הפניה','אינסטגרם','פייסבוק','גוגל'];

const TRIGGER_LABELS: Record<TriggerType, string> = {
  days_inactive:    'ימים ללא עדכון ≥',
  status_is:        'סטטוס הוא',
  score_above:      'ציון AI מעל',
  score_below:      'ציון AI מתחת ל-',
  budget_above:     'תקציב מעל ₪',
  source_is:        'מקור הוא',
  has_overdue_task: 'יש משימה באיחור',
};
const ACTION_LABELS: Record<WFActionType, string> = {
  create_task:      '📋 צור משימה',
  change_status:    '🔄 שנה סטטוס',
  send_whatsapp_ai: '💬 שלח WhatsApp (AI)',
  send_email_ai:    '📧 שלח מייל (AI)',
  add_note:         '📝 הוסף הערה',
  assign_to:        '👤 שייך לאיש צוות',
  send_webhook:     '🔗 שלח Webhook',
};
const ACTION_ICON: Record<WFActionType, string> = {
  create_task: '📋', change_status: '🔄', send_whatsapp_ai: '💬',
  send_email_ai: '📧', add_note: '📝', assign_to: '👤', send_webhook: '🔗',
};

const mkCond = (): WorkflowCondition => ({ id: `${Date.now()}${Math.random()}`, type: 'days_inactive', value: '7' });
const mkAct  = (): WorkflowAction    => ({ id: `${Date.now()}${Math.random()}`, type: 'create_task',   config: {} });

export function WorkflowBuilder({ leads, currentUser, onCreateTask, onUpdateLead, onToast, workspaceId }: {
  leads: Lead[]; currentUser: string;
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: AgentsProps['onToast'];
  workspaceId?: string;
}) {
  const [workflows,   setWorkflows]   = useState<Workflow[]>([]);
  const [loadingWf,   setLoadingWf]   = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [running,     setRunning]     = useState<string | null>(null);
  const [runResults,  setRunResults]  = useState<RunResult[] | null>(null);
  const [previewWf,   setPreviewWf]   = useState<string | null>(null);

  /* form state */
  const [fName,    setFName]    = useState('');
  const [fDesc,    setFDesc]    = useState('');
  const [fLogic,   setFLogic]   = useState<'and'|'or'>('and');
  const [fConds,   setFConds]   = useState<WorkflowCondition[]>([mkCond()]);
  const [fActions, setFActions] = useState<WorkflowAction[]>([mkAct()]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [genAi,    setGenAi]    = useState(false);

  useEffect(() => {
    getDocs(collection(db, 'workflows'))
      .then(s => setWorkflows(s.docs.map(d => d.data() as Workflow)))
      .catch(() => {}).finally(() => setLoadingWf(false));
  }, []);

  const resetForm = () => {
    setFName(''); setFDesc(''); setFLogic('and');
    setFConds([mkCond()]); setFActions([mkAct()]); setAiPrompt('');
  };

  /* match a lead against workflow conditions */
  const matches = (lead: Lead, wf: Workflow) => {
    const conditions = wf.conditions ?? [];
    if (conditions.length === 0) return false;
    const results = conditions.map(c => {
      switch (c.type) {
        case 'days_inactive':    return daysSinceUpdate(lead) >= parseInt(c.value);
        case 'status_is':        return lead.status === c.value;
        case 'score_above':      return lead.aiScore > parseInt(c.value);
        case 'score_below':      return lead.aiScore < parseInt(c.value);
        case 'budget_above':     return lead.budget > parseInt(c.value);
        case 'source_is':        return lead.source === c.value;
        case 'has_overdue_task': {
          const t = new Date(); t.setHours(0,0,0,0);
          return (lead.tasks ?? []).some(tk => !tk.completed && (() => { try { return new Date(tk.date+'T00:00:00') < t; } catch { return false; } })());
        }
        default: return false;
      }
    });
    return wf.conditionLogic === 'and' ? results.every(Boolean) : results.some(Boolean);
  };

  const matchLeads = (wf: Workflow) => leads.filter(l => matches(l, wf));

  /* AI: build workflow from natural language */
  const buildWithAi = async () => {
    if (!aiPrompt.trim()) return;
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setGenAi(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 800,
        messages: [{ role: 'user', content:
          `בנה אוטומציה CRM מהתיאור: "${aiPrompt}"\n\nטריגרים: ${Object.keys(TRIGGER_LABELS).join(', ')}\nפעולות: ${Object.keys(ACTION_LABELS).join(', ')}\nסטטוסים: ${WF_STATUSES.join(', ')}\nמקורות: ${WF_SOURCES.join(', ')}\n\nהחזר JSON בלבד ללא markdown:\n{"name":"","description":"","conditionLogic":"and","conditions":[{"id":"1","type":"","value":""}],"actions":[{"id":"1","type":"","config":{}}]}\n\nעבור send_whatsapp_ai/send_email_ai שים config: {"tone":"ידידותי","prompt":""}`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = res.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
      const p   = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,''));
      if (p.name)             setFName(p.name);
      if (p.description)      setFDesc(p.description);
      if (p.conditionLogic)   setFLogic(p.conditionLogic);
      if (p.conditions?.length) setFConds(p.conditions.map((c: WorkflowCondition) => ({ ...c, id: `${Date.now()}${Math.random()}` })));
      if (p.actions?.length)    setFActions(p.actions.map((a: WorkflowAction) => ({ ...a, id: `${Date.now()}${Math.random()}` })));
      onToast?.('אוטומציה נבנתה על ידי AI ✓', 'success');
    } catch { onToast?.('שגיאה בבניית האוטומציה', 'error'); }
    finally  { setGenAi(false); }
  };

  const saveWorkflow = async () => {
    if (!fName.trim()) { onToast?.('חסר שם לאוטומציה', 'error'); return; }
    const wf: Workflow = {
      id: Date.now().toString(), name: fName, description: fDesc, active: true,
      conditionLogic: fLogic, conditions: fConds, actions: fActions,
      createdAt: new Date().toISOString(), runCount: 0,
    };
    await setDoc(doc(db, 'workflows', wf.id), wf).catch(() => {});
    setWorkflows(p => [...p, wf]);
    setShowForm(false); resetForm();
    onToast?.('אוטומציה נוצרה ✓', 'success');
  };

  const toggleWf = async (wf: Workflow) => {
    const u = { ...wf, active: !wf.active };
    await setDoc(doc(db, 'workflows', wf.id), u).catch(() => {});
    setWorkflows(p => p.map(w => w.id === wf.id ? u : w));
  };

  const deleteWf = async (id: string) => {
    await deleteDoc(doc(db, 'workflows', id)).catch(() => {});
    setWorkflows(p => p.filter(w => w.id !== id));
    onToast?.('אוטומציה נמחקה', 'info');
  };

  const runWf = async (wf: Workflow) => {
    const matching = matchLeads(wf);
    if (!matching.length) { onToast?.('אין לידים תואמים', 'info'); return; }
    const hasAiAction = (wf.actions ?? []).some(a => ['send_whatsapp_ai','send_email_ai'].includes(a.type));
    if (hasAiAction && workspaceId) {
      const ok = await hasBalance(workspaceId);
      if (!ok) { onToast?.('⚠️ אין מספיק טוקנים לפעולות AI.', 'error'); return; }
    }
    setRunning(wf.id);
    const results: RunResult[] = [];
    for (const lead of matching) {
      const actionResults: RunResult['actionResults'] = [];
      for (const action of (wf.actions ?? [])) {
        try {
          if (action.type === 'create_task') {
            const desc = (action.config.description || 'מעקב — {company}')
              .replace('{company}', lead.company).replace('{name}', lead.contactName);
            onCreateTask({ id: `${Date.now()}-${lead.id}`, description: desc,
              date: new Date().toISOString().split('T')[0], time: '09:00',
              priority: (action.config.priority || 'medium') as TaskPriority,
              completed: false, assignedTo: currentUser, assignedBy: 'אוטומציה',
              createdAt: new Date().toISOString(), leadId: lead.id });
            actionResults.push({ actionId: action.id, type: action.type, success: true });

          } else if (action.type === 'change_status') {
            onUpdateLead({ ...lead, status: action.config.status as Lead['status'],
              lastUpdate: new Date().toLocaleDateString('he-IL') });
            actionResults.push({ actionId: action.id, type: action.type, success: true });

          } else if (action.type === 'add_note') {
            const noteText = (action.config.noteText || '')
              .replace('{company}', lead.company).replace('{name}', lead.contactName);
            onUpdateLead({ ...lead, notes: [...lead.notes,
              { id: Date.now().toString(), text: noteText, author: 'אוטומציה', timestamp: new Date().toISOString() }] });
            actionResults.push({ actionId: action.id, type: action.type, success: true });

          } else if (action.type === 'assign_to') {
            onUpdateLead({ ...lead, assignedTo: action.config.assignee || currentUser });
            actionResults.push({ actionId: action.id, type: action.type, success: true });

          } else if (action.type === 'send_webhook') {
            if (action.config.url) {
              await fetch(action.config.url, {
                method: action.config.method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead, triggeredBy: wf.name, at: new Date().toISOString() }),
              });
            }
            actionResults.push({ actionId: action.id, type: action.type, success: true });

          } else if (action.type === 'send_whatsapp_ai' || action.type === 'send_email_ai') {
            const apiKey = getApiKey();
            if (!apiKey) { actionResults.push({ actionId: action.id, type: action.type, success: false }); continue; }
            const client   = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
            const tone     = action.config.tone || 'ידידותי';
            const hint     = action.config.prompt || '';
            const lastNote = lead.notes[lead.notes.length - 1]?.text ?? '';
            const isWA     = action.type === 'send_whatsapp_ai';

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res: any = await (client.messages as any).create({
              model: 'claude-opus-4-5', max_tokens: 600,
              messages: [{ role: 'user', content: isWA
                ? `כתוב הודעת ווטסאפ ב${tone} ל${lead.company} (${lead.contactName}), סטטוס: ${lead.status}, תקציב: ₪${lead.budget}/חודש.${lastNote ? ` הערה: ${lastNote}` : ''}${hint ? ` הנחיה: ${hint}` : ''}\nכללים: עברית, 2-3 משפטים, ללא חתימה, טקסט בלבד.`
                : `כתוב מייל ${tone} ל${lead.company} (${lead.contactName}), סטטוס: ${lead.status}.${hint ? ` הנחיה: ${hint}` : ''}\nהחזר JSON בלבד: {"subject":"","body":""}`,
              }],
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawText = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
            const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
            if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', `Workflow: ${wf.name}`).catch(() => {});

            if (isWA) {
              actionResults.push({ actionId: action.id, type: action.type, message: rawText, success: true });
            } else {
              const parsed = (() => { try { return JSON.parse(rawText.replace(/^```json\s*/,'').replace(/\s*```$/,'')); } catch { return { subject: '', body: rawText }; } })();
              actionResults.push({ actionId: action.id, type: action.type, message: parsed.body || rawText, subject: parsed.subject || '', success: true });
            }
          }
        } catch { actionResults.push({ actionId: action.id, type: action.type, success: false }); }
      }
      results.push({ lead, actionResults });
    }

    const updated = { ...wf, runCount: wf.runCount + 1, lastRunAt: new Date().toISOString() };
    await setDoc(doc(db, 'workflows', wf.id), updated).catch(() => {});
    setWorkflows(p => p.map(w => w.id === wf.id ? updated : w));
    setRunning(null);

    if (results.some(r => (r.actionResults ?? []).some(a => a.message))) {
      setRunResults(results);
    } else {
      onToast?.(`הופעל על ${results.length} לידים ✓`, 'success');
    }
  };

  /* ── Condition row ── */
  const CondRow = ({ c, idx }: { c: WorkflowCondition; idx: number }) => (
    <div className="flex items-center gap-2 flex-wrap bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2.5">
      {idx > 0 && (
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${fLogic === 'and' ? 'bg-blue-900/50 text-blue-300' : 'bg-violet-900/50 text-violet-300'}`}>
          {fLogic === 'and' ? 'AND' : 'OR'}
        </span>
      )}
      <select value={c.type} onChange={e => setFConds(cs => cs.map(x => x.id === c.id ? { ...x, type: e.target.value as TriggerType, value: '' } : x))}
        className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none flex-1 min-w-32">
        {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map(k => <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>)}
      </select>
      {c.type === 'status_is' ? (
        <select value={c.value} onChange={e => setFConds(cs => cs.map(x => x.id === c.id ? { ...x, value: e.target.value } : x))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
          {WF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : c.type === 'source_is' ? (
        <select value={c.value} onChange={e => setFConds(cs => cs.map(x => x.id === c.id ? { ...x, value: e.target.value } : x))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
          {WF_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : c.type !== 'has_overdue_task' ? (
        <input type="number" value={c.value} onChange={e => setFConds(cs => cs.map(x => x.id === c.id ? { ...x, value: e.target.value } : x))}
          placeholder="ערך" className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none w-20"/>
      ) : <span className="text-slate-500 text-xs">(כל ליד עם משימה באיחור)</span>}
      {fConds.length > 1 && (
        <button onClick={() => setFConds(cs => cs.filter(x => x.id !== c.id))} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={12}/></button>
      )}
    </div>
  );

  /* ── Action row ── */
  const ActionRow = ({ a, idx }: { a: WorkflowAction; idx: number }) => (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] bg-indigo-900/50 text-indigo-300 border border-indigo-700/40 px-2 py-0.5 rounded-full font-bold flex-shrink-0">#{idx+1}</span>
        <select value={a.type} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, type: e.target.value as WFActionType, config: {} } : x))}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none flex-1">
          {(Object.keys(ACTION_LABELS) as WFActionType[]).map(k => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
        </select>
        {fActions.length > 1 && (
          <button onClick={() => setFActions(as => as.filter(x => x.id !== a.id))} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={12}/></button>
        )}
      </div>
      {a.type === 'create_task' && (
        <div className="space-y-1.5">
          <input value={a.config.description || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, description: e.target.value } } : x))}
            placeholder="תיאור משימה — {company} {name}" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none text-right"/>
          <select value={a.config.priority || 'medium'} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, priority: e.target.value } } : x))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
            <option value="high">🔴 דחוף</option><option value="medium">🟡 בינוני</option><option value="low">🟢 נמוך</option>
          </select>
        </div>
      )}
      {a.type === 'change_status' && (
        <select value={a.config.status || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, status: e.target.value } } : x))}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
          <option value="">— בחר סטטוס —</option>
          {WF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {(a.type === 'send_whatsapp_ai' || a.type === 'send_email_ai') && (
        <div className="space-y-1.5">
          <select value={a.config.tone || 'ידידותי'} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, tone: e.target.value } } : x))}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
            <option value="ידידותי">ידידותי</option><option value="מקצועי">מקצועי</option>
            <option value="חמים">חמים</option><option value="תכליתי">תכליתי</option>
          </select>
          <input value={a.config.prompt || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, prompt: e.target.value } } : x))}
            placeholder={a.type === 'send_whatsapp_ai' ? 'הנחיה (אופציונלי) — "הזכר את הפגישה"' : 'נושא / הנחיה (אופציונלי)'}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none text-right"/>
        </div>
      )}
      {a.type === 'add_note' && (
        <textarea value={a.config.noteText || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, noteText: e.target.value } } : x))}
          placeholder="טקסט ההערה — {company} {name}" rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none text-right resize-none"/>
      )}
      {a.type === 'assign_to' && (
        <input value={a.config.assignee || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, assignee: e.target.value } } : x))}
          placeholder="שם איש צוות" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none text-right"/>
      )}
      {a.type === 'send_webhook' && (
        <div className="space-y-1.5">
          <input value={a.config.url || ''} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, url: e.target.value } } : x))}
            placeholder="https://hooks.zapier.com/..." type="url"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"/>
          <select value={a.config.method || 'POST'} onChange={e => setFActions(as => as.map(x => x.id === a.id ? { ...x, config: { ...x.config, method: e.target.value } } : x))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none">
            <option>POST</option><option>GET</option>
          </select>
        </div>
      )}
    </div>
  );

  /* ══ RENDER ══ */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-zinc-900/80 border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Zap size={18} className="text-black"/></div>
          <div>
            <p className="text-white font-bold text-sm">בונה אוטומציות מתקדם</p>
            <p className="text-zinc-500 text-xs">AI WhatsApp · מייל · Webhook · תנאים מרובים · AND/OR</p>
          </div>
        </div>
        <button onClick={() => { setShowForm(v => !v); if (showForm) resetForm(); }}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
          <Plus size={14}/> אוטומציה חדשה
        </button>
      </div>

      {/* ── FORM ── */}
      {showForm && (
        <div className="bg-slate-800/60 border border-amber-700/40 rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-500 hover:text-white text-xs transition-colors">✕ ביטול</button>
            <h3 className="text-white font-bold text-sm">⚡ בנה אוטומציה חדשה</h3>
          </div>

          {/* AI builder from natural language */}
          <div className="bg-violet-900/20 border border-violet-700/40 rounded-xl p-3 space-y-2">
            <p className="text-violet-300 text-xs font-bold text-right">✨ תאר מה אתה רוצה — AI יבנה בשבילך</p>
            <div className="flex gap-2">
              <button onClick={buildWithAi} disabled={genAi || !aiPrompt.trim()}
                className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex-shrink-0">
                {genAi ? <><Loader2 size={11} className="animate-spin"/> בונה...</> : <><Brain size={11}/> בנה</>}
              </button>
              <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                placeholder='למשל: "שלח וואטסאפ ידידותי לכל ליד שלא עדכנתי 10 ימים"'
                className="flex-1 bg-slate-900 border border-violet-700/40 rounded-lg px-3 py-2 text-xs text-white focus:outline-none text-right"/>
            </div>
          </div>

          <input value={fName} onChange={e => setFName(e.target.value)} placeholder="שם האוטומציה *"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none text-right"/>
          <input value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="תיאור (אופציונלי)"
            className="w-full bg-slate-900 border border-slate-600/60 rounded-xl px-3 py-2 text-xs text-slate-400 focus:outline-none text-right"/>

          {/* Conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={() => setFConds(cs => [...cs, mkCond()])}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-900/20 transition-colors">
                  <Plus size={11}/> הוסף תנאי
                </button>
                {fConds.length > 1 && (
                  <button onClick={() => setFLogic(l => l === 'and' ? 'or' : 'and')}
                    className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-colors ${fLogic === 'and' ? 'bg-blue-900/50 text-blue-300 border-blue-700/40' : 'bg-violet-900/50 text-violet-300 border-violet-700/40'}`}>
                    {fLogic === 'and' ? '🔗 AND — כל התנאים' : '⚡ OR — אחד מהתנאים'}
                  </button>
                )}
              </div>
              <p className="text-amber-400 text-xs font-bold">🔀 תנאים</p>
            </div>
            {fConds.map((c, i) => <CondRow key={c.id} c={c} idx={i}/>)}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setFActions(as => [...as, mkAct()])}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-blue-900/20 transition-colors">
                <Plus size={11}/> הוסף פעולה
              </button>
              <p className="text-blue-400 text-xs font-bold">⚡ פעולות</p>
            </div>
            {fActions.map((a, i) => <ActionRow key={a.id} a={a} idx={i}/>)}
          </div>

          <div className="flex justify-start">
            <button onClick={saveWorkflow}
              className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm px-6 py-2 rounded-xl transition-colors flex items-center gap-2">
              <CheckCircle2 size={14}/> שמור אוטומציה
            </button>
          </div>
        </div>
      )}

      {/* Workflows list */}
      {loadingWf ? (
        <div className="text-center py-8"><Loader2 size={20} className="animate-spin text-slate-500 mx-auto"/></div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Zap size={36} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">אין אוטומציות עדיין</p>
          <p className="text-zinc-400 text-sm mt-1">צור את האוטומציה הראשונה שלך ↑</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map(wf => {
            const mc     = matchLeads(wf).length;
            const hasAi  = (wf.actions ?? []).some(a => ['send_whatsapp_ai','send_email_ai'].includes(a.type));
            const isPrev = previewWf === wf.id;
            return (
              <div key={wf.id} className={`border rounded-2xl p-4 transition-all ${wf.active ? 'bg-slate-800/60 border-slate-700/50' : 'bg-black/40 border-slate-800/50 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 text-right">
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {hasAi && <span className="text-[9px] bg-violet-900/40 text-violet-300 border border-violet-700/30 px-1.5 py-0.5 rounded-full font-bold">AI</span>}
                      {mc > 0 && wf.active && <span className="text-[10px] bg-amber-600/30 text-amber-300 border border-amber-600/40 px-2 py-0.5 rounded-full font-bold">{mc} לידים</span>}
                      <span className="text-white font-bold text-sm">{wf.name}</span>
                    </div>
                    {wf.description && <p className="text-slate-500 text-xs mt-0.5">{wf.description}</p>}
                    {/* Conditions + actions summary */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-end">
                      {(wf.conditions ?? []).map((c, i) => (
                        <span key={c.id} className="flex items-center gap-1">
                          {i > 0 && <span className={`text-[9px] font-black px-1 rounded ${wf.conditionLogic === 'and' ? 'text-blue-400' : 'text-violet-400'}`}>{wf.conditionLogic.toUpperCase()}</span>}
                          <span className="bg-slate-700/60 text-slate-300 px-2 py-0.5 rounded-full text-[10px]">{TRIGGER_LABELS[c.type]} {c.value}</span>
                        </span>
                      ))}
                      <span className="text-slate-600 text-[10px]">→</span>
                      {(wf.actions ?? []).map(a => (
                        <span key={a.id} className="bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-700/30 text-[10px]">
                          {ACTION_ICON[a.type]} {ACTION_LABELS[a.type].replace(/^.\s/,'')}
                        </span>
                      ))}
                    </div>
                    {wf.runCount > 0 && (
                      <p className="text-slate-600 text-[10px] mt-1">
                        הופעל {wf.runCount} פעמים{wf.lastRunAt ? ` · אחרון: ${new Date(wf.lastRunAt).toLocaleDateString('he-IL')}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => setPreviewWf(isPrev ? null : wf.id)} title="תצוגה מקדימה"
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${isPrev ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-700/40 border-slate-600/40 text-slate-400 hover:text-white'}`}>
                      <Search size={12}/>
                    </button>
                    <button onClick={() => runWf(wf)} disabled={running === wf.id || !wf.active || mc === 0} title="הפעל עכשיו"
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
                {/* Preview panel */}
                {isPrev && (
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                    <p className="text-slate-400 text-xs text-right font-bold mb-2">לידים שיושפעו ({mc}):</p>
                    {mc === 0 ? (
                      <p className="text-slate-600 text-xs text-center py-2">אין לידים תואמים כרגע</p>
                    ) : matchLeads(wf).map(l => (
                      <div key={l.id} className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-1.5">
                        <span className="text-slate-500 text-[10px]">{l.status} · {daysSinceUpdate(l)}י׳</span>
                        <span className="text-white text-xs font-medium">{l.company}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── RUN RESULTS MODAL ── */}
      {runResults && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setRunResults(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <button onClick={() => setRunResults(null)} className="text-slate-400 hover:text-white text-sm transition-colors">✕ סגור</button>
              <h3 className="text-white font-bold">✅ תוצאות — {runResults.length} לידים</h3>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-4 space-y-4">
              {runResults.map(({ lead, actionResults }) => (
                <div key={lead.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3">
                  <p className="text-white font-bold text-sm text-right">
                    {lead.company} <span className="text-slate-400 font-normal text-xs">· {lead.contactName}</span>
                  </p>
                  {actionResults.map(ar => {
                    if (!ar.message) return null;
                    const waNum = lead.phone ? `972${lead.phone.replace(/^0/,'').replace(/\D/g,'')}` : '';
                    return (
                      <div key={ar.actionId} className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold text-right">{ACTION_LABELS[ar.type]}</p>
                        {ar.subject && <p className="text-slate-300 text-xs font-semibold text-right">נושא: {ar.subject}</p>}
                        <div className="bg-slate-900 rounded-lg px-3 py-2.5 text-sm text-slate-200 text-right whitespace-pre-wrap leading-relaxed">{ar.message}</div>
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => { navigator.clipboard.writeText(ar.message!); onToast?.('הועתק ✓','success'); }}
                            className="flex items-center gap-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2.5 py-1 rounded-lg transition-colors">
                            <Copy size={9}/> העתק
                          </button>
                          {ar.type === 'send_whatsapp_ai' && waNum && (
                            <a href={`https://wa.me/${waNum}?text=${encodeURIComponent(ar.message!)}`} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-xs bg-green-800/60 hover:bg-green-700/60 text-green-300 border border-green-700/40 px-2.5 py-1 rounded-lg transition-colors">
                              <MessageCircle size={9}/> שלח WhatsApp
                            </a>
                          )}
                          {ar.type === 'send_email_ai' && lead.email && (
                            <a href={`mailto:${lead.email}?subject=${encodeURIComponent(ar.subject||'')}&body=${encodeURIComponent(ar.message!)}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-xs bg-blue-900/50 hover:bg-blue-800/50 text-blue-300 border border-blue-700/40 px-2.5 py-1 rounded-lg transition-colors">
                              📧 פתח מייל
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 8 — CLIENT PORTAL MANAGER
══════════════════════════════════════════════════════════════════════════════ */
function PortalManager({ leads, onToast }: { leads: Lead[]; onToast?: AgentsProps['onToast'] }) {
  const { t } = useLang();
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
          <p className="text-white font-bold text-sm">{t('agents.portalTitle')}</p>
          <p className="text-zinc-500 text-xs">{t('agents.portalDesc')}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 size={20} className="animate-spin text-slate-500 mx-auto"/></div>
      ) : activeClients.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Link size={32} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">{t('agents.noActiveClients')}</p>
          <p className="text-zinc-400 text-sm mt-1">{t('agents.portalAvailableFor')}</p>
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
                        <Copy size={10}/> {copiedId === lead.id ? '✓' : t('agents.copyMessage')}
                      </button>
                      <button onClick={() => openPortal(lead.id)}
                        className="flex items-center gap-1.5 text-xs bg-teal-800/50 hover:bg-teal-700/60 text-teal-300 border border-teal-700/40 px-3 py-1.5 rounded-lg transition-colors font-medium">
                        <ExternalLink size={10}/> {t('agents.open')}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => generatePortal(lead)} disabled={genFor === lead.id}
                      className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors font-bold">
                      {genFor === lead.id ? <Loader2 size={10} className="animate-spin"/> : <Link size={10}/>} {t('agents.createPortal')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-4 text-xs text-slate-500 space-y-1">
        <p className="font-bold text-slate-400">{t('agents.portalWhat')}</p>
        <p>{t('agents.portalItem1')}</p>
        <p>{t('agents.portalItem2')}</p>
        <p>{t('agents.portalItem3')}</p>
        <p>{t('agents.portalItem4')}</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   FEATURE 9 — AGENT PERFORMANCE
══════════════════════════════════════════════════════════════════════════════ */
export function AgentPerformance({ leads, team, standaloneTask }: {
  leads: Lead[]; team: TeamMember[]; standaloneTask: StandaloneTask[];
}) {
  const { t } = useLang();
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
        <div><p className="text-white font-bold text-sm">{t('agents.performanceTitle')}</p><p className="text-zinc-500 text-xs">{team.length} · {t('agents.leaderboard')}</p></div>
      </div>

      {stats.length === 0 ? (
        <div className="text-center py-12 bg-zinc-900/50 border border-white/[0.06] rounded-2xl">
          <Users size={36} className="text-slate-700 mx-auto mb-3"/>
          <p className="text-white font-bold">{t('agents.assignLeads')}</p>
          <p className="text-zinc-400 text-sm mt-1">{t('agents.assignLeadsHint')}</p>
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
                        { label: t('agents.revenue'),   val: `₪${Math.round(s.revenue/1000)}K`, color: 'text-emerald-400' },
                        { label: t('agents.close'),     val: `${Math.round(s.closeRate)}%`,      color: 'text-blue-400' },
                        { label: t('agents.stat.leads'), val: s.total,                           color: 'text-slate-300' },
                        { label: t('agents.overdue'),   val: s.overdue,                          color: s.overdue > 0 ? 'text-red-400' : 'text-slate-500' },
                      ].map(({ label, val, color }) => (
                        <div key={label}><div className={`text-sm font-black ${color}`}>{val}</div><div className="text-[10px] text-slate-600">{label}</div></div>
                      ))}
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-[10px] text-slate-600">{t('agents.performanceScore')}</span>
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
            <h3 className="text-white font-bold text-sm mb-3">{t('agents.teamSummary')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              {[
                { label: t('agents.totalRevenue'),  val: `₪${stats.reduce((s,a)=>s+a.revenue,0).toLocaleString()}`, color: 'text-emerald-400' },
                { label: t('agents.avgClose'),      val: `${Math.round(stats.reduce((s,a)=>s+a.closeRate,0)/stats.length)}%`, color: 'text-blue-400' },
                { label: t('agents.totalLeads'),    val: stats.reduce((s,a)=>s+a.total,0), color: 'text-slate-300' },
                { label: t('agents.overdueTasks'),  val: stats.reduce((s,a)=>s+a.overdue,0), color: 'text-red-400' },
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
function MeetingBrief({ leads, currentUser, onToast, workspaceId }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast']; workspaceId?: string;
}) {
  const { t } = useLang();
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Meeting brief');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
    } catch { onToast?.('שגיאה ביצירת התדריך', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><FileText size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">{t('agents.briefTitle')}</p><p className="text-zinc-500 text-xs">{t('agents.briefDesc')}</p></div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-3">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.clientForMeeting')}</label>
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setBrief(''); }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">{t('agents.selectLead')}</option>
              {leads.filter(l => ['חדש','בתהליך','לקוח פעיל'].includes(l.status)).map(l => (
                <option key={l.id} value={l.id}>{l.company} ({l.status})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.meetingDate')}</label>
            <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"/>
          </div>
          {lead && (
            <div className="bg-slate-800/60 border border-white/[0.07] rounded-xl p-3 text-xs space-y-1">
              <p className="text-white font-bold">{lead.company}</p>
              <p className="text-slate-400">{lead.contactName} · {lead.phone}</p>
              <p className="text-slate-400">₪{lead.budget.toLocaleString()}/חודש · ציון {lead.aiScore}%</p>
              <p className="text-slate-400">{lead.notes.length} {t('agents.notesLabel')} · {lead.tasks.filter(tk=>!tk.completed).length} {t('agents.tasksLabel')}</p>
            </div>
          )}
          <button onClick={generate} disabled={!selectedId || loading}
            className="w-full bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> {t('agents.preparingBrief')}</> : <><FileText size={15}/> {t('agents.prepareBrief')}</>}
          </button>
        </div>
        <div className="md:col-span-2 bg-zinc-900/50 border border-white/[0.06] rounded-2xl p-5 min-h-[360px]">
          {brief ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] text-slate-600 flex items-center gap-1"><Sparkles size={9} className="text-slate-400"/> {t('agents.aiGenerated')}</span>
                <button onClick={() => { navigator.clipboard.writeText(brief).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
                  <Copy size={10}/> {copied ? '✓ ' + t('agents.copied') : t('agents.copyMessage')}
                </button>
              </div>
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap text-right overflow-y-auto max-h-[550px]">{brief}</div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <FileText size={40} className="text-slate-700 mb-3"/>
              <p className="text-slate-500 text-sm font-medium">{t('agents.selectClientFirst')}</p>
              <p className="text-slate-600 text-xs mt-1">{t('agents.briefDetails')}</p>
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
function MarketingAI({ leads, currentUser, onToast, workspaceId }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast']; workspaceId?: string;
}) {
  const { t } = useLang();
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Marketing content');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
    } catch { onToast?.('שגיאה ביצירת תוכן', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><Sparkles size={18} className="text-black"/></div>
        <div><p className="text-white font-bold text-sm">{t('agents.marketingTitle')}</p><p className="text-zinc-500 text-xs">{t('agents.marketingDesc')}</p></div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-4">
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-2">{t('agents.platform')}</label>
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
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.contentGoal')}</label>
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              {goals.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.tone')}</label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="professional">מקצועי</option>
              <option value="casual">קל ונגיש</option>
              <option value="urgent">דחוף ומניע</option>
              <option value="friendly">חברותי ואישי</option>
            </select>
          </div>
          <div>
            <label className="block text-zinc-500 text-xs font-medium mb-1.5">{t('agents.clientAdapt')}</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30">
              <option value="">{t('agents.general')}</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.company}</option>)}
            </select>
          </div>
          <button onClick={generate} disabled={loading}
            className="w-full bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={15} className="animate-spin"/> {t('agents.generatingContent')}</> : <><Sparkles size={15}/> {t('agents.generateContent')}</>}
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
function CampaignOptimizer({ leads, onToast, workspaceId }: {
  leads: Lead[]; onToast?: AgentsProps['onToast']; workspaceId?: string;
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Marketing content');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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
export function ChurnShield({ leads, onToast, workspaceId }: {
  leads: Lead[]; onToast?: AgentsProps['onToast']; workspaceId?: string;
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Follow-up agent');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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

function SmartTemplates({ leads, currentUser, onToast, workspaceId }: {
  leads: Lead[]; currentUser: string; onToast?: AgentsProps['onToast']; workspaceId?: string;
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Marketing content');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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
function SalesCoach({ leads, team, standaloneTask, currentUser, onToast, workspaceId }: {
  leads: Lead[]; team: TeamMember[]; standaloneTask: StandaloneTask[]; currentUser: string; onToast?: AgentsProps['onToast']; workspaceId?: string;
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
    if (workspaceId) {
      const hasBal = await hasBalance(workspaceId);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error'); return; }
    }
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
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspaceId) await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Follow-up agent');
      } catch (trackErr) { console.error('Token tracking failed:', trackErr); }
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
  onCreateTask, onUpdateLead, onToast, workspaceId,
}: AgentsProps) {
  const { t } = useLang();
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
    { key: 'followup',    emoji: '🎯', label: t('agents.tab.followup'),    badge: staleCount > 0 ? staleCount : undefined },
    { key: 'forecast',    emoji: '📈', label: t('agents.tab.forecast'),    badge: `₪${Math.round(confirmed/1000)}K` },
    { key: 'proposal',    emoji: '✍️', label: t('agents.tab.proposal'),   badge: undefined },
    { key: 'alerts',      emoji: '🚨', label: t('agents.tab.alerts'),     badge: alertCount > 0 ? alertCount : undefined },
    { key: 'roi',         emoji: '📊', label: t('agents.tab.roi'),        badge: undefined },
    { key: 'enrich',      emoji: '🔍', label: t('agents.tab.enrich'),     badge: undefined },
    { key: 'workflow',    emoji: '⚡', label: t('agents.tab.workflow'),   badge: undefined },
    { key: 'brief',       emoji: '📋', label: t('agents.tab.brief'),      badge: undefined },
    { key: 'marketing',   emoji: '🎨', label: t('agents.tab.marketing'),  badge: undefined },
    { key: 'campaign',    emoji: '📡', label: t('agents.tab.campaign'),   badge: undefined },
    { key: 'churn',       emoji: '🛡️', label: t('agents.tab.churn'),    badge: clients_at_risk > 0 ? clients_at_risk : undefined },
    { key: 'templates',   emoji: '📄', label: t('agents.tab.templates'),  badge: undefined },
    { key: 'coach',       emoji: '🧠', label: t('agents.tab.coach'),     badge: undefined },
  ];

  const activeClients = leads.filter(l => l.status === 'לקוח פעיל').length;

  const tabGroups: { label: string; desc: string; keys: AgentTab[] }[] = [
    { label: t('agents.group.sales'),     desc: '5', keys: ['followup','forecast','proposal','alerts','roi'] },
    { label: t('agents.group.leads'),     desc: '3', keys: ['enrich','workflow','brief'] },
    { label: t('agents.group.clients'),   desc: '2', keys: ['churn','templates'] },
    { label: t('agents.group.marketing'), desc: '3', keys: ['marketing','campaign','coach'] },
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
              <h1 className="text-white font-black text-xl md:text-2xl leading-none tracking-tight">{t('agents.smartAgents')}</h1>
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
            { label: t('agents.stat.leads'),         val: leads.length },
            { label: t('agents.stat.activeClients'), val: activeClients },
            { label: t('agents.stat.monthlyRevenue'), val: `₪${Math.round(confirmed/1000)}K` },
            { label: t('agents.stat.alerts'),        val: alertCount },
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
                  onCreateTask={onCreateTask} onUpdateLead={onUpdateLead} onToast={onToast} workspaceId={workspaceId}/>
              )}
              {tab === 'forecast'    && <RevenueForecast leads={leads}/>}
              {tab === 'proposal'    && <ProposalGenerator leads={leads} currentUser={currentUser} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'alerts'      && <SmartAlerts leads={leads} standaloneTask={standaloneTask}/>}
              {tab === 'roi'         && <SourceROI leads={leads}/>}
              {tab === 'enrich'      && <LeadEnrichment leads={leads} onUpdateLead={onUpdateLead} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'workflow'    && (
                <WorkflowBuilder leads={leads} currentUser={currentUser}
                  onCreateTask={onCreateTask} onUpdateLead={onUpdateLead} onToast={onToast}/>
              )}
              {tab === 'brief'       && <MeetingBrief leads={leads} currentUser={currentUser} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'marketing'   && <MarketingAI leads={leads} currentUser={currentUser} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'campaign'    && <CampaignOptimizer leads={leads} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'churn'       && <ChurnShield leads={leads} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'templates'   && <SmartTemplates leads={leads} currentUser={currentUser} onToast={onToast} workspaceId={workspaceId}/>}
              {tab === 'coach'       && <SalesCoach leads={leads} team={team} standaloneTask={standaloneTask} currentUser={currentUser} onToast={onToast} workspaceId={workspaceId}/>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
