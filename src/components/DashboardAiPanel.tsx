/**
 * DashboardAiPanel.tsx — Cyber CRM dark-theme AI assistant panel
 *
 * Tabs:
 *  1. מעקב      — stale leads (7+ days) with AI message generation
 *  2. פייפליין   — top expected-value opportunities
 *  3. תחזית AI  — revenue forecast + win probability (replaces WA templates)
 *  4. מאמן מכירות — personal performance coaching
 */

import { useState, useCallback, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, Clock, MessageCircle,
  CheckCircle2, Calendar, Copy, Loader2, Brain,
  RefreshCw, TrendingUp, Star, Activity,
  Sparkles, Award, Target, BarChart2,
  Flame, Snowflake, Zap, ArrowRight,
  AlertTriangle, DollarSign, MessageSquare, PhoneCall,
} from 'lucide-react';
import type { Lead, WorkspaceProfile, StandaloneTask, TaskPriority, TeamMember } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import { DEFAULT_STATUS_CONFIGS } from '../lib/statusConfig';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ══════════════════════════════════════════════════════════════════════════════
   NEON palette (mirrors main app)
══════════════════════════════════════════════════════════════════════════════ */
const NEON: Record<string, string> = {
  'חדש':        '#6366f1',
  'בתהליך':     '#f97316',
  'לקוח פעיל':  '#10b981',
  'רימרקטינג':  '#8b5cf6',
  'לא רלוונטי': '#64748b',
};

/* ══════════════════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════════════════ */
function parseDateHE(dateStr: string): Date | null {
  if (!dateStr) return null;
  // ISO format: YYYY-MM-DD (most common from Firestore / new saves)
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  // Numeric timestamp string (e.g. "1717500000000")
  if (/^\d{10,}$/.test(dateStr)) {
    const d = new Date(Number(dateStr));
    return isNaN(d.getTime()) ? null : d;
  }
  // Support both '/' (DD/MM/YYYY) and '.' (DD.MM.YYYY — he-IL locale) separators
  const sep = dateStr.includes('/') ? '/' : '.';
  const parts = dateStr.split(sep);
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

function daysSince(lead: Lead): number {
  const date = parseDateHE(lead.lastUpdate);
  if (date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
  }
  // No valid lastUpdate — fall back to createdAt timestamp (number or ISO string)
  const cat = lead.createdAt;
  if (cat) {
    const created = new Date(typeof cat === 'number' ? cat : String(cat));
    if (!isNaN(created.getTime())) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      created.setHours(0, 0, 0, 0);
      return Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86_400_000));
    }
  }
  // Unknown date — treat as brand new (0 days) to avoid false stale alerts
  return 0;
}

function closeProbability(lead: Lead): number {
  const base: Record<string, number> = {
    'חדש': 0.08, 'בתהליך': 0.38, 'לקוח פעיל': 1.0,
    'רימרקטינג': 0.12, 'לא רלוונטי': 0,
  };
  const b            = base[lead.status] ?? 0;
  const scoreMod     = (lead.aiScore / 100) * 0.25;
  const stalePenalty = Math.min(daysSince(lead) / 60, 0.25);
  return Math.max(0, Math.min(1, b + scoreMod - stalePenalty));
}

function urgencyStyle(days: number) {
  if (days >= 21) return {
    border:  'rgba(239,68,68,0.3)',
    bg:      'rgba(239,68,68,0.07)',
    dot:     '#ef4444',
    neon:    '#ef4444',
    badge:   { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' },
    label:   '🔴 דחוף',
  };
  if (days >= 14) return {
    border:  'rgba(249,115,22,0.3)',
    bg:      'rgba(249,115,22,0.07)',
    dot:     '#f97316',
    neon:    '#f97316',
    badge:   { background: 'rgba(249,115,22,0.15)', color: '#fb923c', border: '1px solid rgba(249,115,22,0.3)' },
    label:   '🟠 ממתין',
  };
  if (days >= 7) return {
    border:  'rgba(245,158,11,0.25)',
    bg:      'rgba(245,158,11,0.05)',
    dot:     '#f59e0b',
    neon:    '#f59e0b',
    badge:   { background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' },
    label:   '🟡 מתחמם',
  };
  if (days >= 3) return {
    border:  'rgba(99,102,241,0.2)',
    bg:      'rgba(99,102,241,0.04)',
    dot:     '#818cf8',
    neon:    '#818cf8',
    badge:   { background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.22)' },
    label:   '🔵 פעיל',
  };
  return {
    border:  'rgba(16,185,129,0.2)',
    bg:      'rgba(16,185,129,0.04)',
    dot:     '#10b981',
    neon:    '#10b981',
    badge:   { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.22)' },
    label:   '🟢 טרי',
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   Props
══════════════════════════════════════════════════════════════════════════════ */
interface DashboardAiPanelProps {
  leads:            Lead[];
  currentUser?:     string;
  workspace?:       WorkspaceProfile;
  onCreateTask?:    (task: StandaloneTask) => void;
  onUpdateLead?:    (lead: Lead) => void;
  onToast?:         (msg: string, type?: 'success' | 'error' | 'info') => void;
  team?:            TeamMember[];
  standaloneTask?:  StandaloneTask[];
  statusConfigs?:   StatusConfig[];
}

type Tab = 'followup' | 'pipeline' | 'forecast' | 'convo' | 'coach';

interface ConvoResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  objections: string[];
  nextSteps: string[];
  buyingSignals: string[];
  riskFactors: string[];
  suggestedAction: string;
  closeProbability: number;
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function DashboardAiPanel({
  leads, currentUser, workspace, onCreateTask, onUpdateLead, onToast,
  team = [], standaloneTask = [], statusConfigs = DEFAULT_STATUS_CONFIGS,
}: DashboardAiPanelProps) {

  const [expanded,       setExpanded]       = useState(false);
  const [tab,            setTab]            = useState<Tab>('followup');

  /* ── follow-up state ── */
  const [threshold]                          = useState(7);
  const [generatingFor,  setGeneratingFor]  = useState<string | null>(null);
  const [messages,       setMessages]       = useState<Record<string, string>>({});
  const [copiedId,       setCopiedId]       = useState<string | null>(null);
  const [mirrorStyles,   setMirrorStyles]   = useState<string[]>([]);

  /* ── coach state ── */
  const [coachLoading,   setCoachLoading]   = useState(false);
  const [coachResult,    setCoachResult]    = useState('');
  const [coachPeriod,    setCoachPeriod]    = useState<'week' | 'month' | 'quarter'>('month');

  /* ── forecast state ── */
  const [forecastPeriod, setForecastPeriod] = useState<30 | 60 | 90>(30);

  /* ── today state ── */
  const [todayDone, setTodayDone] = useState<Set<string>>(new Set());

  /* ── convo state ── */
  const [convoText,    setConvoText]    = useState('');
  const [convoResult,  setConvoResult]  = useState<ConvoResult | null>(null);
  const [convoLoading, setConvoLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<string>('');

  /* ── load mirror styles ── */
  useEffect(() => {
    getDoc(doc(db, 'mirror-mode', 'styles')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as { examples?: string[] };
        setMirrorStyles(d.examples ?? []);
      }
    }).catch(() => {});
  }, []);

  /* ── derived data ── */
  // pipeline statuses = all statuses except "לקוח פעיל" and "לא רלוונטי" (i.e. actively worked leads)
  const pipelineStatuses = statusConfigs
    .filter(c => c.label !== 'לקוח פעיל' && c.label !== 'לא רלוונטי')
    .map(c => c.label);

  // Show ALL pipeline leads sorted by staleness (most stale first)
  const staleLeads = leads
    .filter(l => pipelineStatuses.includes(l.status))
    .sort((a, b) => daysSince(b) - daysSince(a))
    .slice(0, 20);

  const urgentCount  = staleLeads.filter(l => daysSince(l) >= 21).length;
  const warningCount = staleLeads.filter(l => daysSince(l) >= 14 && daysSince(l) < 21).length;
  const normalCount  = staleLeads.filter(l => daysSince(l) >= 7 && daysSince(l) < 14).length;

  const topOpps = leads
    .filter(l => pipelineStatuses.includes(l.status) && l.budget > 0)
    .map(l => ({ lead: l, exp: l.budget * closeProbability(l) }))
    .filter(o => o.exp > 0)
    .sort((a, b) => b.exp - a.exp)
    .slice(0, 5);

  /* ── forecast calc ── */
  const activePipeline = leads.filter(l => pipelineStatuses.includes(l.status) && l.budget > 0);
  const forecastRevenue = activePipeline.reduce((s, l) => s + l.budget * closeProbability(l), 0);
  const forecastByStatus = pipelineStatuses.map(status => {
    const group = activePipeline.filter(l => l.status === status);
    const rev   = group.reduce((s, l) => s + l.budget * closeProbability(l), 0);
    return { status, rev, count: group.length };
  });
  const topCloseLeads = [...activePipeline]
    .map(l => ({ lead: l, prob: closeProbability(l) }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);
  const atRiskLeads = leads
    .filter(l => l.status === 'בתהליך' && daysSince(l) >= 14)
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 3);
  const existingRevenue = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
  const periodMult = forecastPeriod / 30;

  /* ── today derived ── */
  const todayStr    = new Date().toISOString().split('T')[0];
  const todayTasks  = standaloneTask.filter(t => t.date === todayStr && !t.completed && !todayDone.has(t.id));
  const overdueTasks = standaloneTask.filter(t => t.date < todayStr && !t.completed);
  const urgentLeads  = leads
    .filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) && daysSince(l) >= 7)
    .sort((a, b) => daysSince(b) - daysSince(a))
    .slice(0, 5);
  const todayTotal   = todayTasks.length + overdueTasks.length + urgentLeads.length;

  /* ── generate follow-up message ── */
  const generateFollowupMsg = useCallback(async (lead: Lead) => {
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש בדף החיוב.', 'error'); return; }
    }
    setGeneratingFor(lead.id);
    try {
      const client   = getAnthropicProxy();
      const lastNote = lead.notes[lead.notes.length - 1]?.text ?? 'אין הערות';
      const services = lead.solutions.map(s => s.name).join(', ') || 'טרם הוגדרו';
      const styleSection = mirrorStyles.length > 0
        ? `\nסגנון כתיבה (חקה בדיוק):\n${mirrorStyles.map((s, i) => `דוגמה ${i + 1}: ${s}`).join('\n')}\n`
        : '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 300,
        messages: [{ role: 'user', content:
          `כתוב הודעת ווטסאפ קצרה למעקב אחרי ליד שלא ענה זמן רב.\n\nלקוח: ${lead.company} | ${lead.contactName}\nסטטוס: ${lead.status} | תקציב: ₪${lead.budget.toLocaleString()}/חודש\nשירותים: ${services}\nהערה אחרונה: ${lastNote}\nימים ללא עדכון: ${daysSince(lead)}\n${styleSection}\nכללים:\n- עברית בלבד\n- 2-3 משפטים קצרים ואישיים\n- חמים ולא מכירתי מדי\n- ללא חתימה\n- כתוב רק את טקסט ההודעה`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setMessages(prev => ({ ...prev, [lead.id]: text }));
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-5', 'Dashboard follow-up agent');
      } catch {}
    } catch { onToast?.('שגיאה ביצירת הודעה', 'error'); }
    finally  { setGeneratingFor(null); }
  }, [mirrorStyles, workspace, onToast]);

  /* ── coach analyze ── */
  const analyzeCoach = useCallback(async () => {
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים.', 'error'); return; }
    }
    setCoachLoading(true); setCoachResult('');
    try {
      const client      = getAnthropicProxy();
      const total       = leads.length;
      const active      = leads.filter(l => l.status === 'לקוח פעיל').length;
      const revenue     = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
      const avgScore    = total > 0 ? Math.round(leads.reduce((s, l) => s + l.aiScore, 0) / total) : 0;
      const closeRate   = total > 0 ? Math.round((active / total) * 100) : 0;
      const todayDate   = new Date(); todayDate.setHours(0, 0, 0, 0);
      const overdueTasks = standaloneTask.filter(t => !t.completed && (() => { try { return new Date(t.date + 'T00:00:00') < todayDate; } catch { return false; } })()).length;
      const stale        = leads.filter(l => ['חדש', 'בתהליך'].includes(l.status) && daysSince(l) >= 14).length;
      const periodLabel  = coachPeriod === 'week' ? 'שבועי' : coachPeriod === 'month' ? 'חודשי' : 'רבעוני';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 2000,
        messages: [{ role: 'user', content:
          `אתה מאמן מכירות מוביל. נתח את הנתונים ותן אימון אישי ל${currentUser ?? 'המשתמש'} בעברית.\n\n**נתוני ביצועים:**\n• סה"כ לידים: ${total} | לקוחות פעילים: ${active} | שיעור סגירה: ${closeRate}%\n• הכנסה חודשית: ₪${revenue.toLocaleString()} | ממוצע ציון AI: ${avgScore}%\n• לידים ישנים (14+ ימים): ${stale} | משימות באיחור: ${overdueTasks}\n• גודל צוות: ${team.length} אנשים\n**תקופת ניתוח:** ${periodLabel}\n\n## 🏆 הישגים לחגוג\n## 📊 ניתוח מצב אמת\n## 🎯 3 אזורי שיפור קריטיים\n## 💡 5 טקטיקות מכירה לשבוע הקרוב\n## 📅 משימות ל-7 ימים הקרובים\n## 💪 מסר מעורר מהמאמן`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setCoachResult(text);
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-5', 'Sales coach analysis');
      } catch {}
    } catch { onToast?.('שגיאה בניתוח המאמן', 'error'); }
    finally  { setCoachLoading(false); }
  }, [leads, standaloneTask, team, currentUser, coachPeriod, workspace, onToast]);

  /* ── conversation intelligence ── */
  const analyzeConversation = useCallback(async () => {
    if (!convoText.trim()) return;
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים.', 'error'); return; }
    }
    setConvoLoading(true);
    try {
      const client  = getAnthropicProxy();
      const leadCtx = selectedLead ? leads.find(l => l.id === selectedLead) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 1000,
        messages: [{ role: 'user', content:
          `נתח את השיחה הבאה עם לקוח פוטנציאלי ותחזיר JSON בלבד (ללא markdown).${leadCtx ? `\nהקשר ליד: ${leadCtx.company}, סטטוס: ${leadCtx.status}, תקציב: ₪${leadCtx.budget}` : ''}

שיחה:
${convoText}

החזר JSON:
{
  "sentiment": "positive|neutral|negative",
  "summary": "סיכום קצר של השיחה",
  "objections": ["התנגדות 1", "התנגדות 2"],
  "nextSteps": ["צעד הבא 1", "צעד הבא 2"],
  "buyingSignals": ["סימן קנייה 1"],
  "riskFactors": ["גורם סיכון 1"],
  "suggestedAction": "פעולה מומלצת ספציפית",
  "closeProbability": 75
}`
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw    = res.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
      const parsed = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
      setConvoResult(parsed);
      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-5', 'Conversation analysis');
      } catch {}
    } catch { onToast?.('שגיאה בניתוח השיחה', 'error'); }
    finally  { setConvoLoading(false); }
  }, [convoText, selectedLead, leads, workspace, onToast]);

  /* ── follow-up actions ── */
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

  /* ── hide only when workspace has zero active leads ── */
  const activeLeads = leads.filter(l => !['לא רלוונטי', 'לקוח פעיל'].includes(l.status));
  if (activeLeads.length === 0) return null;

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div dir="rtl" className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid rgba(99,102,241,0.28)', boxShadow: '0 4px 32px rgba(0,0,0,0.4), 0 0 40px rgba(99,102,241,0.08)' }}>

      {/* ══ Collapsed header ══ */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-3.5 flex items-center gap-3 transition-all"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(139,92,246,0.25) 50%, rgba(6,182,212,0.15) 100%)',
          borderBottom: expanded ? '1px solid rgba(99,102,241,0.2)' : 'none',
        }}
      >
        {/* Chevron */}
        <div className="flex-shrink-0">
          {expanded
            ? <ChevronUp size={15} style={{ color: 'rgba(165,180,252,0.8)' }} />
            : <ChevronDown size={15} style={{ color: 'rgba(165,180,252,0.8)' }} />}
        </div>

        {/* Title — centered */}
        <div className="flex items-center gap-2.5 flex-1 justify-center">
          <div className="w-7 h-7 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.4)' }}>
            <Sparkles size={13} style={{ color: '#a5b4fc' }} />
          </div>
          <span className="font-bold text-sm" style={{ color: 'white' }}>סוכן AI</span>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px' }} className="hidden sm:inline">
            {urgentCount > 0 ? `${urgentCount} לידים דחופים` : `${staleLeads.length} לידים בפייפליין`}
          </span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {urgentCount  > 0 && <DarkPill color="#ef4444">{urgentCount} דחוף</DarkPill>}
          {warningCount > 0 && <DarkPill color="#f97316">{warningCount} ממתין</DarkPill>}
          {normalCount  > 0 && <DarkPill color="#f59e0b">{normalCount} מתחמם</DarkPill>}
        </div>
      </button>

      {/* ══ Expanded body ══ */}
      {expanded && (
        <div style={{ background: 'rgba(10,15,30,0.97)' }}>

          {/* ── Tab bar ── */}
          <div className="flex overflow-x-auto scrollbar-hide"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <DarkTab active={tab === 'followup'} onClick={() => setTab('followup')}
              icon={<Clock size={11}/>}
              label={`מעקב${staleLeads.length > 0 ? ` (${staleLeads.length})` : ''}`}
              neon="#6366f1" />
            <DarkTab active={tab === 'pipeline'} onClick={() => setTab('pipeline')}
              icon={<TrendingUp size={11}/>}
              label="פייפליין"
              neon="#f97316" />
            <DarkTab active={tab === 'forecast'} onClick={() => setTab('forecast')}
              icon={<BarChart2 size={11}/>}
              label="תחזית AI"
              neon="#10b981" />
            <DarkTab active={tab === 'convo'} onClick={() => setTab('convo')}
              icon={<MessageSquare size={11}/>}
              label="ניתוח שיחה"
              neon="#10b981" />
            <DarkTab active={tab === 'coach'} onClick={() => setTab('coach')}
              icon={<Award size={11}/>}
              label="מאמן מכירות"
              neon="#8b5cf6" />
          </div>

          {/* ══════════════════════════════════════════════
              TAB 1 — FOLLOW-UP
          ══════════════════════════════════════════════ */}
          {tab === 'followup' && (
            <div className="p-3 max-h-[520px] overflow-y-auto">
              {staleLeads.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 size={36} style={{ color: '#10b981', margin: '0 auto 12px' }} />
                  <p className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>כל הלידים מעודכנים 🎉</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>אין לידים ממתינים למעקב</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {staleLeads.map(lead => {
                  const days  = daysSince(lead);
                  const u     = urgencyStyle(days);
                  const msg   = messages[lead.id];
                  const isGen = generatingFor === lead.id;
                  const waNum = lead.phone ? `972${lead.phone.replace(/^0/,'').replace(/\D/g,'')}` : '';

                  return (
                    <div key={lead.id} className="rounded-xl overflow-hidden transition-all flex flex-col"
                      style={{ background: u.bg, border: `1px solid ${u.border}` }}>

                      {/* Card top: urgency strip */}
                      <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1.5">
                        {/* Urgency badge */}
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: u.dot, boxShadow: `0 0 5px ${u.dot}` }} />
                          <span className="text-[9px] font-black" style={{ color: u.dot }}>
                            {days === 999 ? '?' : days}י׳
                          </span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={u.badge}>{u.label}</span>
                      </div>

                      {/* Company name */}
                      <div className="px-2.5 text-right">
                        <p className="font-bold text-xs leading-tight truncate" style={{ color: 'rgba(255,255,255,0.92)' }}>
                          {lead.company}
                        </p>
                        <p className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {lead.contactName}
                        </p>
                        {lead.notes.length > 0 && (
                          <p className="text-[9px] mt-1 italic line-clamp-2 leading-tight" style={{ color: 'rgba(255,255,255,0.28)' }}>
                            "{lead.notes[lead.notes.length - 1].text}"
                          </p>
                        )}
                      </div>

                      {/* Action icons row */}
                      <div className="flex items-center justify-end gap-1 px-2 py-2 mt-auto">
                        <DarkIconBtn title="סמן כטיפלתי" neon="#10b981" onClick={() => markContacted(lead)}>
                          <CheckCircle2 size={11}/>
                        </DarkIconBtn>
                        {onCreateTask && currentUser && (
                          <DarkIconBtn title="צור משימת מעקב" neon="#6366f1" onClick={() => createFollowupTask(lead)}>
                            <Calendar size={11}/>
                          </DarkIconBtn>
                        )}
                        {waNum && (
                          <a href={`https://wa.me/${waNum}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`}
                            target="_blank" rel="noreferrer" title="WhatsApp"
                            className="w-6 h-6 rounded-lg flex items-center justify-center transition-all"
                            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}>
                            <MessageCircle size={11}/>
                          </a>
                        )}
                      </div>

                      {/* Generate / message section */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {!msg ? (
                          <button onClick={() => generateFollowupMsg(lead)} disabled={isGen}
                            className="w-full flex items-center justify-center gap-1 text-[10px] font-bold py-2 transition-all disabled:opacity-50"
                            style={{ color: isGen ? '#a5b4fc' : 'rgba(165,180,252,0.65)' }}>
                            {isGen
                              ? <><Loader2 size={10} className="animate-spin"/> מייצר...</>
                              : <><Brain size={10}/> צור הודעת מעקב AI</>}
                          </button>
                        ) : (
                          <div className="p-2 space-y-1.5">
                            <textarea
                              value={msg}
                              onChange={e => setMessages(p => ({ ...p, [lead.id]: e.target.value }))}
                              rows={3}
                              className="w-full text-[10px] resize-none focus:outline-none rounded-lg px-2 py-1.5 text-right leading-relaxed"
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}
                            />
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => generateFollowupMsg(lead)} disabled={isGen}
                                className="flex items-center gap-0.5 text-[9px] px-1.5 py-1 rounded-lg transition-colors"
                                style={{ color: 'rgba(255,255,255,0.35)' }}>
                                <RefreshCw size={8}/> שנה
                              </button>
                              <button onClick={() => copyMsg(lead.id, msg)}
                                className="flex items-center gap-0.5 text-[9px] px-2 py-1 rounded-lg transition-all font-medium"
                                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                                <Copy size={8}/> {copiedId === lead.id ? '✓' : 'העתק'}
                              </button>
                              {waNum && (
                                <a href={`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`}
                                  target="_blank" rel="noreferrer"
                                  className="flex items-center gap-0.5 text-[9px] px-2 py-1 rounded-lg transition-all font-medium"
                                  style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}>
                                  <MessageCircle size={8}/> WA
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              TAB 2 — PIPELINE
          ══════════════════════════════════════════════ */}
          {tab === 'pipeline' && (
            <div className="p-3 space-y-2">
              {topOpps.length === 0 ? (
                <div className="text-center py-12">
                  <TrendingUp size={36} style={{ color: 'rgba(255,255,255,0.1)', margin: '0 auto 12px' }} />
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>אין לידים עם תקציב בפייפליין</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-end gap-1.5 px-1">
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>הזדמנויות עם פוטנציאל סגירה גבוה ביותר</span>
                    <Star size={10} style={{ color: '#f59e0b' }} />
                  </div>

                  {topOpps.map(({ lead, exp }, i) => {
                    const prob = Math.round(closeProbability(lead) * 100);
                    const neon = NEON[lead.status] ?? '#6366f1';
                    return (
                      <div key={lead.id} className="rounded-xl px-4 py-3 flex items-center gap-3 transition-all"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRight: `3px solid ${neon}` }}>
                        {/* Rank */}
                        <span className="text-xs font-black w-5 text-center flex-shrink-0"
                          style={{ color: i === 0 ? '#f59e0b' : 'rgba(255,255,255,0.2)' }}>
                          {i === 0 ? '🥇' : i + 1}
                        </span>

                        {/* Info */}
                        <div className="flex-1 min-w-0 text-right">
                          <p className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>{lead.company}</p>
                          <div className="flex items-center gap-2 justify-end mt-0.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                              style={{ background: `${neon}18`, color: neon, border: `1px solid ${neon}35` }}>
                              {lead.status}
                            </span>
                            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{lead.contactName}</span>
                          </div>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-[9px] mb-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>צפי סגירה</p>
                            <p className="font-black text-sm" style={{ color: '#10b981' }}>₪{Math.round(exp).toLocaleString()}</p>
                          </div>
                          <div className="text-center">
                            <Activity size={9} style={{ color: 'rgba(255,255,255,0.25)', margin: '0 auto 2px' }} />
                            <span className="text-[11px] font-black"
                              style={{ color: prob >= 30 ? '#10b981' : prob >= 15 ? '#f97316' : 'rgba(255,255,255,0.35)' }}>
                              {prob}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Total */}
                  <div className="rounded-xl px-4 py-2.5 flex items-center justify-between"
                    style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <span className="font-black text-sm" style={{ color: '#a5b4fc' }}>
                      ₪{Math.round(topOpps.reduce((s, o) => s + o.exp, 0)).toLocaleString()}
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'rgba(165,180,252,0.7)' }}>סה"כ פוטנציאל צפוי</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              TAB 3 — AI FORECAST (replaces WA Templates)
          ══════════════════════════════════════════════ */}
          {tab === 'forecast' && (
            <div className="p-3 space-y-3">

              {/* Period picker */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {([30, 60, 90] as const).map(p => (
                    <button key={p} onClick={() => setForecastPeriod(p)}
                      className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all"
                      style={forecastPeriod === p
                        ? { background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', boxShadow: '0 0 10px rgba(16,185,129,0.15)' }
                        : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
                      }>
                      {p} ימים
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <BarChart2 size={12} style={{ color: '#34d399' }} />
                  <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>תחזית הכנסות</span>
                </div>
              </div>

              {/* Main forecast card */}
              <div className="rounded-xl p-4"
                style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,182,212,0.08) 100%)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>הכנסה חודשית קיימת</p>
                    <p className="font-black text-lg" style={{ color: '#34d399' }}>
                      ₪{Math.round(existingRevenue * periodMult).toLocaleString()}
                    </p>
                    <p className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>מלקוחות פעילים · בטוח</p>
                  </div>
                  <div className="text-left">
                    <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>פוטנציאל מהפייפליין</p>
                    <p className="font-black text-lg" style={{ color: '#a5b4fc' }}>
                      +₪{Math.round(forecastRevenue * periodMult).toLocaleString()}
                    </p>
                    <p className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>בהסתברות ממוצעת</p>
                  </div>
                </div>
                {/* Total bar */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xl" style={{ color: 'white' }}>
                      ₪{Math.round((existingRevenue + forecastRevenue) * periodMult).toLocaleString()}
                    </span>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>סה"כ צפוי ל-{forecastPeriod} ימים</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${Math.min(100, (forecastRevenue / Math.max(existingRevenue + forecastRevenue, 1)) * 100)}%`,
                      background: 'linear-gradient(90deg, #6366f1, #10b981)',
                    }} />
                  </div>
                </div>
              </div>

              {/* Breakdown by status */}
              {forecastByStatus.some(f => f.rev > 0) && (
                <div>
                  <p className="text-xs text-right font-bold mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>פירוט לפי סטטוס</p>
                  <div className="grid grid-cols-4 gap-2">
                    {forecastByStatus.filter(f => f.count > 0).map(({ status, rev, count }) => {
                      const neon = NEON[status] ?? '#6366f1';
                      const maxRev = Math.max(...forecastByStatus.map(f => f.rev), 1);
                      return (
                        <div key={status} className="rounded-xl p-2.5 flex flex-col gap-1.5 text-right"
                          style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${neon}22` }}>
                          <div className="w-1.5 h-1.5 rounded-full mr-auto" style={{ background: neon, boxShadow: `0 0 5px ${neon}` }} />
                          <p className="font-black text-xs leading-tight" style={{ color: neon }}>₪{Math.round(rev * periodMult).toLocaleString()}</p>
                          <p className="text-[9px] font-bold truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{status}</p>
                          <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{count} לידים</p>
                          <div className="h-0.5 rounded-full mt-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${(rev / maxRev) * 100}%`, background: neon, opacity: 0.7 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top leads to close */}
              {topCloseLeads.length > 0 && (
                <div>
                  <div className="flex items-center justify-end gap-1.5 mb-2">
                    <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>הכי קרובים לסגירה</span>
                    <Target size={11} style={{ color: '#10b981' }} />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {topCloseLeads.map(({ lead, prob }) => {
                      const pct = Math.round(prob * 100);
                      const neon = pct >= 30 ? '#10b981' : pct >= 15 ? '#f97316' : '#64748b';
                      return (
                        <div key={lead.id} className="rounded-xl p-2.5 flex flex-col gap-1 text-right"
                          style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${neon}22` }}>
                          <span className="text-xs font-black self-end px-1.5 py-0.5 rounded-lg"
                            style={{ background: `${neon}18`, color: neon, border: `1px solid ${neon}30` }}>
                            {pct}%
                          </span>
                          <p className="font-bold text-[10px] leading-tight truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{lead.company}</p>
                          <p className="text-[9px] truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{lead.contactName}</p>
                          <p className="text-[9px] font-bold" style={{ color: neon }}>₪{lead.budget.toLocaleString()}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* At-risk leads */}
              {atRiskLeads.length > 0 && (
                <div>
                  <div className="flex items-center justify-end gap-1.5 mb-2">
                    <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>לידים בסיכון (14+ ימים)</span>
                    <AlertTriangle size={11} style={{ color: '#f87171' }} />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {atRiskLeads.map(lead => (
                      <div key={lead.id} className="rounded-xl p-2.5 flex flex-col gap-1 text-right"
                        style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <p className="font-bold text-[10px] leading-tight truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{lead.company}</p>
                        {lead.budget > 0 && (
                          <p className="text-[9px] font-black" style={{ color: '#f87171' }}>₪{lead.budget.toLocaleString()}</p>
                        )}
                        <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{daysSince(lead)} ימים ללא מגע</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              TAB 4 — CONVERSATION INTELLIGENCE
          ══════════════════════════════════════════════ */}
          {tab === 'convo' && (
            <div className="p-3 space-y-3 max-h-[620px] overflow-y-auto">

              {/* Lead selector */}
              <div className="space-y-1.5">
                <p className="text-xs text-right font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>ליד לקשר (אופציונלי)</p>
                <select
                  value={selectedLead}
                  onChange={e => setSelectedLead(e.target.value)}
                  className="w-full text-xs rounded-xl px-3 py-2 text-right focus:outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' }}>
                  <option value="" style={{ background: '#0a0f1e' }}>ללא ליד ספציפי</option>
                  {leads.filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status)).map(l => (
                    <option key={l.id} value={l.id} style={{ background: '#0a0f1e' }}>
                      {l.company} · {l.status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Textarea */}
              <div className="space-y-1.5">
                <p className="text-xs text-right font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>תמליל השיחה</p>
                <textarea
                  value={convoText}
                  onChange={e => setConvoText(e.target.value)}
                  rows={6}
                  placeholder="הדבק כאן את תמליל השיחה, הצ'אט או המייל עם הלקוח..."
                  className="w-full text-xs resize-none focus:outline-none rounded-xl px-3 py-2.5 text-right transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                  dir="rtl"
                />
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {convoText.length} תווים
                  </span>
                  {convoResult && (
                    <button
                      type="button"
                      onClick={() => { setConvoText(''); setConvoResult(null); }}
                      className="text-[9px] px-2 py-0.5 rounded-lg transition-all"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                      נקה הכל
                    </button>
                  )}
                </div>
              </div>

              {/* Analyze button */}
              <button
                type="button"
                onClick={analyzeConversation}
                disabled={convoLoading || !convoText.trim()}
                className="w-full flex items-center justify-center gap-2 font-bold py-2.5 rounded-xl transition-all text-sm disabled:opacity-40"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399', boxShadow: '0 0 16px rgba(16,185,129,0.1)' }}>
                {convoLoading
                  ? <><Loader2 size={14} className="animate-spin"/> מנתח שיחה...</>
                  : <><MessageSquare size={14}/> נתח שיחה</>}
              </button>

              {/* Results */}
              {convoResult && (
                <div className="space-y-3">

                  {/* Sentiment + Close probability row */}
                  <div className="flex items-center gap-3">
                    {/* Sentiment badge */}
                    <div className="flex-1 rounded-xl px-3 py-2.5 text-center"
                      style={{
                        background: convoResult.sentiment === 'positive' ? 'rgba(16,185,129,0.1)' : convoResult.sentiment === 'negative' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${convoResult.sentiment === 'positive' ? 'rgba(16,185,129,0.25)' : convoResult.sentiment === 'negative' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                      }}>
                      <p className="text-lg">
                        {convoResult.sentiment === 'positive' ? '😊' : convoResult.sentiment === 'negative' ? '😟' : '😐'}
                      </p>
                      <p className="text-xs font-bold mt-0.5"
                        style={{ color: convoResult.sentiment === 'positive' ? '#34d399' : convoResult.sentiment === 'negative' ? '#f87171' : '#fbbf24' }}>
                        {convoResult.sentiment === 'positive' ? 'חיובי' : convoResult.sentiment === 'negative' ? 'שלילי' : 'נייטרלי'}
                      </p>
                    </div>

                    {/* Close probability ring */}
                    <div className="flex flex-col items-center gap-1">
                      <svg width="72" height="72" viewBox="0 0 72 72">
                        <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6"/>
                        <circle cx="36" cy="36" r="28" fill="none"
                          stroke={convoResult.closeProbability >= 60 ? '#10b981' : convoResult.closeProbability >= 35 ? '#f97316' : '#ef4444'}
                          strokeWidth="6"
                          strokeDasharray={`${(convoResult.closeProbability / 100) * 175.9} 175.9`}
                          strokeLinecap="round"
                          transform="rotate(-90 36 36)"
                        />
                        <text x="36" y="40" textAnchor="middle" fill="white" fontSize="14" fontWeight="900">
                          {convoResult.closeProbability}%
                        </text>
                      </svg>
                      <p className="text-[9px] font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>סיכוי סגירה</p>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-xs font-bold mb-1.5 text-right" style={{ color: 'rgba(255,255,255,0.5)' }}>סיכום</p>
                    <p className="text-xs leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.75)' }}>
                      {convoResult.summary}
                    </p>
                  </div>

                  {/* 2x2 grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Objections */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}>
                      <p className="text-[10px] font-black mb-2 text-right" style={{ color: '#f87171' }}>🚫 התנגדויות</p>
                      {convoResult.objections.length === 0
                        ? <p className="text-[9px] text-right" style={{ color: 'rgba(255,255,255,0.3)' }}>לא זוהו</p>
                        : convoResult.objections.map((o, i) => (
                          <p key={i} className="text-[9px] leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>• {o}</p>
                        ))}
                    </div>
                    {/* Buying signals */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)' }}>
                      <p className="text-[10px] font-black mb-2 text-right" style={{ color: '#34d399' }}>✅ סימני קנייה</p>
                      {convoResult.buyingSignals.length === 0
                        ? <p className="text-[9px] text-right" style={{ color: 'rgba(255,255,255,0.3)' }}>לא זוהו</p>
                        : convoResult.buyingSignals.map((s, i) => (
                          <p key={i} className="text-[9px] leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>• {s}</p>
                        ))}
                    </div>
                    {/* Next steps */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                      <p className="text-[10px] font-black mb-2 text-right" style={{ color: '#a5b4fc' }}>📋 צעדים הבאים</p>
                      {convoResult.nextSteps.length === 0
                        ? <p className="text-[9px] text-right" style={{ color: 'rgba(255,255,255,0.3)' }}>לא הוגדרו</p>
                        : convoResult.nextSteps.map((s, i) => (
                          <p key={i} className="text-[9px] leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>• {s}</p>
                        ))}
                    </div>
                    {/* Risk factors */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}>
                      <p className="text-[10px] font-black mb-2 text-right" style={{ color: '#fbbf24' }}>⚠️ גורמי סיכון</p>
                      {convoResult.riskFactors.length === 0
                        ? <p className="text-[9px] text-right" style={{ color: 'rgba(255,255,255,0.3)' }}>לא זוהו</p>
                        : convoResult.riskFactors.map((r, i) => (
                          <p key={i} className="text-[9px] leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>• {r}</p>
                        ))}
                    </div>
                  </div>

                  {/* Suggested action */}
                  <div className="rounded-xl px-4 py-3"
                    style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)', boxShadow: '0 0 16px rgba(6,182,212,0.05)' }}>
                    <p className="text-xs font-black mb-1.5 text-right" style={{ color: '#22d3ee' }}>💡 פעולה מומלצת</p>
                    <p className="text-sm font-bold leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      {convoResult.suggestedAction}
                    </p>
                  </div>
                </div>
              )}

              {!convoResult && !convoLoading && (
                <div className="text-center py-8 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <MessageSquare size={32} style={{ color: 'rgba(255,255,255,0.1)', margin: '0 auto 12px' }} />
                  <p className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>הדבק שיחה ולחץ "נתח שיחה"</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.22)' }}>AI ינתח סנטימנט, התנגדויות, סימני קנייה וצעדים הבאים</p>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════
              TAB 6 — SALES COACH
          ══════════════════════════════════════════════ */}
          {tab === 'coach' && (
            <div className="p-3 space-y-3">

              {/* KPI snapshot */}
              {(() => {
                const total     = leads.length;
                const active    = leads.filter(l => l.status === 'לקוח פעיל').length;
                const revenue   = leads.filter(l => l.status === 'לקוח פעיל').reduce((s, l) => s + l.budget, 0);
                const avgScore  = total > 0 ? Math.round(leads.reduce((s, l) => s + l.aiScore, 0) / total) : 0;
                const closeRate = total > 0 ? Math.round((active / total) * 100) : 0;
                const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
                const overdue   = standaloneTask.filter(t => !t.completed && (() => { try { return new Date(t.date + 'T00:00:00') < todayDate; } catch { return false; } })()).length;

                const stats = [
                  { label: 'לידים',       val: total,                           neon: '#6366f1' },
                  { label: 'לקוחות',      val: active,                          neon: '#10b981' },
                  { label: 'שיעור סגירה', val: `${closeRate}%`,                 neon: '#8b5cf6' },
                  { label: 'הכנסה/חודש',  val: `₪${Math.round(revenue/1000)}K`, neon: '#f59e0b' },
                  { label: 'ציון ממוצע',  val: `${avgScore}%`,                  neon: '#06b6d4' },
                  { label: 'משימות',      val: overdue, neon: overdue > 0 ? '#ef4444' : '#64748b' },
                ];

                return (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {stats.map(s => (
                      <div key={s.label} className="rounded-xl p-2.5 text-center"
                        style={{ background: `${s.neon}10`, border: `1px solid ${s.neon}25` }}>
                        <div className="text-lg font-black" style={{ color: s.neon }}>{s.val}</div>
                        <div className="text-[9px] mt-0.5 font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Period picker + run */}
              <div className="flex items-center gap-2 flex-wrap">
                {([['week','שבועי'],['month','חודשי'],['quarter','רבעוני']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setCoachPeriod(key)}
                    className="text-xs px-3.5 py-1.5 rounded-xl font-bold transition-all"
                    style={coachPeriod === key
                      ? { background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', color: '#c4b5fd', boxShadow: '0 0 10px rgba(139,92,246,0.15)' }
                      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
                    }>
                    {label}
                  </button>
                ))}
                <button onClick={analyzeCoach} disabled={coachLoading}
                  className="mr-auto flex items-center gap-2 font-bold py-1.5 px-4 rounded-xl transition-all text-sm disabled:opacity-40"
                  style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', color: '#c4b5fd', boxShadow: '0 0 16px rgba(139,92,246,0.15)' }}>
                  {coachLoading
                    ? <><Loader2 size={13} className="animate-spin"/> מנתח...</>
                    : <><Brain size={13}/> קבל אימון</>}
                </button>
              </div>

              {/* Result */}
              {coachResult ? (
                <div className="rounded-xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ background: 'rgba(139,92,246,0.1)', borderBottom: '1px solid rgba(139,92,246,0.15)' }}>
                    <button onClick={() => { navigator.clipboard.writeText(coachResult); onToast?.('הועתק ✓', 'success'); }}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
                      <Copy size={9}/> העתק
                    </button>
                    <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#c4b5fd' }}>
                      <Brain size={11}/> מאמן מכירות AI
                    </span>
                  </div>
                  <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-right max-h-[500px] overflow-y-auto"
                    style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {coachResult}
                  </div>
                </div>
              ) : !coachLoading && (
                <div className="text-center py-10 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <Award size={32} style={{ color: 'rgba(255,255,255,0.1)', margin: '0 auto 12px' }} />
                  <p className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.45)' }}>בחר תקופה ולחץ "קבל אימון"</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>AI ינתח את הביצועים ויכין תוכנית פעולה</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Sub-components
══════════════════════════════════════════════════════════════════════════════ */
function DarkPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-full leading-none whitespace-nowrap"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {children}
    </span>
  );
}

function DarkTab({ active, onClick, icon, label, neon }: {
  active: boolean; onClick: () => void;
  icon: React.ReactNode; label: string; neon: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold flex-1 justify-center transition-all whitespace-nowrap"
      style={active
        ? { color: neon, borderBottom: `2px solid ${neon}`, background: `${neon}0d` }
        : { color: 'rgba(255,255,255,0.38)', borderBottom: '2px solid transparent' }
      }>
      {icon}{label}
    </button>
  );
}

function DarkIconBtn({ title, neon, onClick, children }: {
  title: string; neon: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
      style={{ background: `${neon}12`, border: `1px solid ${neon}25`, color: neon }}>
      {children}
    </button>
  );
}

/* Suppress unused import warnings */
const _unused = { Flame, Snowflake, Zap, DollarSign, PhoneCall };
void _unused;
