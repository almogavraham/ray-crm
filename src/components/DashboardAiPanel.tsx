/**
 * DashboardAiPanel.tsx
 * Embedded AI assistant for the Leads/Dashboard page.
 * Shows stale leads needing follow-up and lets the user generate
 * personalised WhatsApp messages inline — all without leaving the leads list.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Bot, ChevronDown, ChevronUp, Clock, MessageCircle,
  CheckCircle2, Calendar, Copy, Loader2, Brain,
  RefreshCw, TrendingUp, Star, Activity,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, WorkspaceProfile, StandaloneTask, TaskPriority } from '../types';
import { getApiKey } from '../lib/apiKey';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ── helpers (duplicated from Agents.tsx to keep this component self-contained) */
function parseDateHE(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

function daysSince(lead: Lead): number {
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
  const scoreMod    = (lead.aiScore / 100) * 0.25;
  const stalePenalty = Math.min(daysSince(lead) / 60, 0.25);
  return Math.max(0, Math.min(1, b + scoreMod - stalePenalty));
}

/* ── urgency config ─────────────────────────────────────────────────────────── */
function urgencyOf(days: number) {
  if (days >= 21) return {
    border: 'border-red-200',   bg: 'bg-red-50',
    dot:    'bg-red-500',       badge: 'bg-red-100 text-red-700 border-red-200',
    label:  '🔴 דחוף',          pillBg: 'bg-red-500',
  };
  if (days >= 14) return {
    border: 'border-orange-200', bg: 'bg-orange-50',
    dot:    'bg-orange-500',     badge: 'bg-orange-100 text-orange-700 border-orange-200',
    label:  '🟠 ממתין',          pillBg: 'bg-orange-400',
  };
  return {
    border: 'border-amber-200',  bg: 'bg-amber-50/60',
    dot:    'bg-amber-400',      badge: 'bg-amber-100 text-amber-700 border-amber-200',
    label:  '🟡 מתחמם',          pillBg: 'bg-amber-400',
  };
}

/* ── component props ─────────────────────────────────────────────────────────── */
interface DashboardAiPanelProps {
  leads:          Lead[];
  currentUser?:   string;
  workspace?:     WorkspaceProfile;
  onCreateTask?:  (task: StandaloneTask) => void;
  onUpdateLead?:  (lead: Lead) => void;
  onToast?:       (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function DashboardAiPanel({
  leads, currentUser, workspace, onCreateTask, onUpdateLead, onToast,
}: DashboardAiPanelProps) {

  /* ── state ── */
  const [tab,          setTab]          = useState<'followup' | 'pipeline'>('followup');
  const [expanded,     setExpanded]     = useState(false);
  const [threshold]                     = useState(7);
  const [generatingFor,setGeneratingFor]= useState<string | null>(null);
  const [messages,     setMessages]     = useState<Record<string, string>>({});
  const [copiedId,     setCopiedId]     = useState<string | null>(null);
  const [mirrorStyles, setMirrorStyles] = useState<string[]>([]);

  /* ── load mirror-writing styles once ── */
  useEffect(() => {
    getDoc(doc(db, 'mirror-mode', 'styles')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as { examples?: string[] };
        setMirrorStyles(d.examples ?? []);
      }
    }).catch(() => {});
  }, []);

  /* ── derived data ── */
  const staleLeads = leads
    .filter(l =>
      ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) &&
      daysSince(l) >= threshold
    )
    .sort((a, b) => daysSince(b) - daysSince(a))
    .slice(0, 10);

  const urgentCount  = staleLeads.filter(l => daysSince(l) >= 21).length;
  const warningCount = staleLeads.filter(l => daysSince(l) >= 14 && daysSince(l) < 21).length;
  const normalCount  = staleLeads.filter(l => daysSince(l) < 14).length;

  /* pipeline top-5 */
  const topOpps = leads
    .filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) && l.budget > 0)
    .map(l => ({ lead: l, exp: l.budget * closeProbability(l) }))
    .filter(o => o.exp > 0)
    .sort((a, b) => b.exp - a.exp)
    .slice(0, 5);

  /* ── generate WhatsApp message via Claude ── */
  const generateMessage = useCallback(async (lead: Lead) => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }

    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) {
        onToast?.('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.', 'error');
        return;
      }
    }

    setGeneratingFor(lead.id);
    try {
      const client   = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const lastNote = lead.notes[lead.notes.length - 1]?.text ?? 'אין הערות';
      const services = lead.solutions.map(s => s.name).join(', ') || 'טרם הוגדרו';
      const styleSection = mirrorStyles.length > 0
        ? `\nסגנון כתיבה (חקה בדיוק):\n${mirrorStyles.map((s, i) => `דוגמה ${i + 1}: ${s}`).join('\n')}\n`
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
ימים ללא עדכון: ${daysSince(lead)}
${styleSection}
כללים:
- עברית בלבד
- 2-3 משפטים קצרים ואישיים
- חמים ולא מכירתי מדי
- ללא חתימה (תצורף ידנית)
- כתוב רק את טקסט ההודעה`,
        }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setMessages(prev => ({ ...prev, [lead.id]: text }));

      try {
        const cost = calculateCost(
          'claude-opus-4-5',
          res.usage?.input_tokens  ?? 0,
          res.usage?.output_tokens ?? 0,
        );
        if (workspace?.id) {
          await deductTokens(workspace.id, cost, 'claude-opus-4-5', 'Dashboard follow-up agent');
        }
      } catch (err) { console.error('Token tracking:', err); }

    } catch { onToast?.('שגיאה ביצירת הודעה', 'error'); }
    finally  { setGeneratingFor(null); }
  }, [mirrorStyles, workspace, onToast]);

  /* ── actions ── */
  const markContacted = (lead: Lead) => {
    onUpdateLead?.({ ...lead, lastUpdate: new Date().toLocaleDateString('he-IL') });
    onToast?.(`${lead.company} עודכן ✓`, 'success');
  };

  const createFollowupTask = (lead: Lead) => {
    if (!onCreateTask || !currentUser) return;
    const task: StandaloneTask = {
      id:          Date.now().toString(),
      description: `מעקב — ${lead.company} (${lead.contactName})`,
      date:        new Date().toISOString().split('T')[0],
      time:        '10:00',
      priority:    'high' as TaskPriority,
      completed:   false,
      assignedTo:  currentUser,
      assignedBy:  currentUser,
      createdAt:   new Date().toISOString(),
      leadId:      lead.id,
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

  /* ── if no stale leads AND no pipeline opps, hide the panel ── */
  if (staleLeads.length === 0 && topOpps.length === 0) return null;

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="rounded-2xl overflow-hidden border border-indigo-200/80 shadow-md shadow-indigo-100/40">

      {/* ── Collapsed header bar ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full bg-gradient-to-l from-indigo-600 via-indigo-600 to-violet-700 px-5 py-3.5
                   flex items-center gap-3 hover:from-indigo-500 hover:to-violet-600 transition-all"
      >
        {/* Expand chevron */}
        <div className="flex-shrink-0">
          {expanded
            ? <ChevronUp   size={15} className="text-indigo-200" />
            : <ChevronDown size={15} className="text-indigo-200" />}
        </div>

        {/* Title + subtitle */}
        <div className="flex-1 text-right">
          <span className="text-white font-bold text-sm">🤖 סוכן AI</span>
          <span className="text-indigo-200 text-xs mr-2 hidden sm:inline">
            {staleLeads.length > 0
              ? `${staleLeads.length} לידים ממתינים למעקב`
              : 'תובנות פייפליין'}
          </span>
        </div>

        {/* Urgency pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {urgentCount  > 0 && (
            <span className="bg-red-500    text-white text-[10px] font-black px-2 py-0.5 rounded-full leading-none">
              {urgentCount} דחוף
            </span>
          )}
          {warningCount > 0 && (
            <span className="bg-orange-400 text-white text-[10px] font-black px-2 py-0.5 rounded-full leading-none">
              {warningCount} ממתין
            </span>
          )}
          {normalCount  > 0 && (
            <span className="bg-amber-400  text-white text-[10px] font-black px-2 py-0.5 rounded-full leading-none">
              {normalCount} מתחמם
            </span>
          )}
          {staleLeads.length === 0 && topOpps.length > 0 && (
            <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full leading-none">
              {topOpps.length} הזדמנויות
            </span>
          )}
        </div>
      </button>

      {/* ── Expanded body ─────────────────────────────────────────────────────── */}
      {expanded && (
        <div className="bg-slate-50 border-t border-indigo-100">

          {/* Tab bar (only show if both sections have data) */}
          {staleLeads.length > 0 && topOpps.length > 0 && (
            <div className="flex border-b border-slate-200 bg-white">
              <TabBtn
                active={tab === 'followup'}
                onClick={() => setTab('followup')}
                icon={<Clock size={12} />}
                label={`מעקב (${staleLeads.length})`}
              />
              <TabBtn
                active={tab === 'pipeline'}
                onClick={() => setTab('pipeline')}
                icon={<TrendingUp size={12} />}
                label="פייפליין"
              />
            </div>
          )}

          {/* ── Follow-up tab ── */}
          {(tab === 'followup' || topOpps.length === 0) && staleLeads.length > 0 && (
            <div className="p-3 space-y-2.5 max-h-[500px] overflow-y-auto">
              {staleLeads.map(lead => {
                const days  = daysSince(lead);
                const u     = urgencyOf(days);
                const msg   = messages[lead.id];
                const isGen = generatingFor === lead.id;
                const waNumber = lead.phone
                  ? `972${lead.phone.replace(/^0/, '').replace(/\D/g, '')}`
                  : '';

                return (
                  <div key={lead.id}
                    className={`border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${u.border} ${u.bg}`}
                  >
                    {/* Lead row */}
                    <div className="p-3">
                      <div className="flex items-start gap-2.5">

                        {/* Days indicator */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 pt-1">
                          <div className={`w-2 h-2 rounded-full ${u.dot}`} />
                          <span className="text-[9px] font-black text-slate-500 whitespace-nowrap">
                            {days === 999 ? '?י׳' : `${days}י׳`}
                          </span>
                        </div>

                        {/* Lead info */}
                        <div className="flex-1 min-w-0 text-right">
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${u.badge}`}>
                              {u.label}
                            </span>
                            <span className="font-bold text-slate-800 text-sm leading-tight">
                              {lead.company}
                            </span>
                          </div>
                          <p className="text-slate-500 text-xs mt-0.5 truncate">
                            {lead.contactName}
                            {lead.phone && ` · ${lead.phone}`}
                            {lead.budget > 0 && ` · ₪${lead.budget.toLocaleString()}`}
                          </p>
                          {lead.notes.length > 0 && (
                            <p className="text-slate-400 text-[10px] mt-1 italic line-clamp-1">
                              "{lead.notes[lead.notes.length - 1].text}"
                            </p>
                          )}
                        </div>

                        {/* Quick-action buttons */}
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => markContacted(lead)}
                            title="סמן כטיפלתי"
                            className="w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-200
                                       flex items-center justify-center text-emerald-600 transition-colors"
                          >
                            <CheckCircle2 size={12} />
                          </button>

                          {onCreateTask && currentUser && (
                            <button
                              onClick={() => createFollowupTask(lead)}
                              title="צור משימת מעקב"
                              className="w-7 h-7 rounded-lg bg-blue-100 hover:bg-blue-200 border border-blue-200
                                         flex items-center justify-center text-blue-600 transition-colors"
                            >
                              <Calendar size={12} />
                            </button>
                          )}

                          {waNumber && (
                            <a
                              href={`https://wa.me/${waNumber}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`}
                              target="_blank" rel="noreferrer"
                              title="פתח ב-WhatsApp"
                              className="w-7 h-7 rounded-lg bg-green-100 hover:bg-green-200 border border-green-200
                                         flex items-center justify-center text-green-600 transition-colors"
                            >
                              <MessageCircle size={12} />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Generate message button */}
                      {!msg && (
                        <button
                          onClick={() => generateMessage(lead)}
                          disabled={isGen}
                          className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-xs font-bold py-1.5
                                     rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200
                                     text-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGen
                            ? <><Loader2 size={11} className="animate-spin" /> מייצר הודעה...</>
                            : <><Brain size={11} /> צור הודעת ווטסאפ חכמה</>
                          }
                        </button>
                      )}
                    </div>

                    {/* Generated message area */}
                    {msg && (
                      <div className="border-t border-slate-200/80 bg-white p-3 space-y-2">
                        <textarea
                          value={msg}
                          onChange={e => setMessages(p => ({ ...p, [lead.id]: e.target.value }))}
                          rows={2}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2
                                     text-xs text-slate-700 resize-none focus:outline-none
                                     focus:ring-1 focus:ring-indigo-300 text-right"
                        />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => copyMsg(lead.id, msg)}
                            className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200
                                       text-slate-600 px-2.5 py-1 rounded-lg transition-colors font-medium"
                          >
                            <Copy size={9} />
                            {copiedId === lead.id ? '✓ הועתק' : 'העתק'}
                          </button>

                          {waNumber && (
                            <a
                              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-xs bg-green-100 hover:bg-green-200
                                         text-green-700 border border-green-200 px-2.5 py-1 rounded-lg
                                         transition-colors font-medium"
                            >
                              <MessageCircle size={9} /> שלח
                            </a>
                          )}

                          <button
                            onClick={() => generateMessage(lead)}
                            disabled={isGen}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600
                                       px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <RefreshCw size={9} /> שנה
                          </button>

                          <span className="mr-auto text-[9px] text-slate-400 flex items-center gap-1">
                            ✨ {mirrorStyles.length > 0 ? 'Mirror Style' : 'AI Default'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Pipeline tab ── */}
          {(tab === 'pipeline' || staleLeads.length === 0) && topOpps.length > 0 && (
            <div className="p-3 space-y-2">
              <p className="text-xs text-slate-500 text-right px-1 flex items-center gap-1 justify-end">
                <Star size={10} className="text-amber-400" />
                הזדמנויות עם הפוטנציאל הגבוה ביותר לסגירה
              </p>

              {topOpps.map(({ lead, exp }, i) => {
                const prob = Math.round(closeProbability(lead) * 100);
                return (
                  <div key={lead.id}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-indigo-200 transition-colors"
                  >
                    <span className="text-slate-300 text-xs font-bold flex-shrink-0 w-4 text-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="font-bold text-slate-800 text-sm leading-tight">{lead.company}</p>
                      <p className="text-slate-500 text-xs">{lead.contactName} · {lead.status}</p>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-400">ציפייה</p>
                        <p className="text-emerald-600 font-black text-sm">₪{Math.round(exp).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-col items-center">
                        <Activity size={10} className="text-slate-400 mb-0.5" />
                        <span className={`text-[10px] font-bold ${
                          prob >= 30 ? 'text-emerald-600' : prob >= 15 ? 'text-orange-500' : 'text-slate-400'
                        }`}>
                          {prob}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Pipeline total */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-indigo-500 text-xs font-bold">
                  ₪{Math.round(topOpps.reduce((s, o) => s + o.exp, 0)).toLocaleString()}
                </span>
                <span className="text-indigo-700 text-xs font-bold text-right">סה"כ פוטנציאל מצופה</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── TabBtn helper ─────────────────────────────────────────────────────────── */
function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex-1 justify-center ${
        active
          ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}{label}
    </button>
  );
}
