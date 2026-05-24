/**
 * DashboardAiPanel.tsx
 * Embedded AI assistant panel for the Leads/Dashboard page.
 *
 * Tabs:
 *  1. Follow-up  — stale leads (7+ days) with AI WhatsApp message generation
 *  2. Pipeline   — top-5 expected-value opportunities
 *  3. WA Templates — save/generate/send WhatsApp message templates per lead status
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronUp, Clock, MessageCircle,
  CheckCircle2, Calendar, Copy, Loader2, Brain,
  RefreshCw, TrendingUp, Star, Activity,
  Smartphone, Plus, Trash2, Send, ChevronRight,
  Sparkles,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, WorkspaceProfile, StandaloneTask, TaskPriority } from '../types';
import { getApiKey } from '../lib/apiKey';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import {
  doc, getDoc, collection, getDocs, setDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ══════════════════════════════════════════════════════════════════════════════
   Types
══════════════════════════════════════════════════════════════════════════════ */
type WATemplateCategory = 'general' | 'חדש' | 'בתהליך' | 'רימרקטינג';

interface WATemplate {
  id:         string;
  title:      string;
  text:       string;
  category:   WATemplateCategory;
  createdAt:  string;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════════════════ */
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
  const b            = base[lead.status] ?? 0;
  const scoreMod     = (lead.aiScore / 100) * 0.25;
  const stalePenalty = Math.min(daysSince(lead) / 60, 0.25);
  return Math.max(0, Math.min(1, b + scoreMod - stalePenalty));
}

function urgencyOf(days: number) {
  if (days >= 21) return {
    border: 'border-red-200',    bg: 'bg-red-50',
    dot:    'bg-red-500',        badge: 'bg-red-100 text-red-700 border-red-200',
    label:  '🔴 דחוף',
  };
  if (days >= 14) return {
    border: 'border-orange-200', bg: 'bg-orange-50',
    dot:    'bg-orange-500',     badge: 'bg-orange-100 text-orange-700 border-orange-200',
    label:  '🟠 ממתין',
  };
  return {
    border: 'border-amber-200',  bg: 'bg-amber-50/60',
    dot:    'bg-amber-400',      badge: 'bg-amber-100 text-amber-700 border-amber-200',
    label:  '🟡 מתחמם',
  };
}

const CATEGORY_LABELS: Record<WATemplateCategory, string> = {
  general:    'כללי',
  'חדש':      'ליד חדש',
  'בתהליך':   'בתהליך',
  'רימרקטינג': 'רימרקטינג',
};

const CATEGORY_COLOR: Record<WATemplateCategory, string> = {
  general:    'bg-slate-100 text-slate-700 border-slate-200',
  'חדש':      'bg-blue-100 text-blue-700 border-blue-200',
  'בתהליך':   'bg-indigo-100 text-indigo-700 border-indigo-200',
  'רימרקטינג': 'bg-amber-100 text-amber-700 border-amber-200',
};

/* ── Firestore helpers ── */
const templatesCol = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, 'waTemplates');

const templateDoc = (workspaceId: string, id: string) =>
  doc(db, 'workspaces', workspaceId, 'waTemplates', id);

/* ══════════════════════════════════════════════════════════════════════════════
   Props
══════════════════════════════════════════════════════════════════════════════ */
interface DashboardAiPanelProps {
  leads:         Lead[];
  currentUser?:  string;
  workspace?:    WorkspaceProfile;
  onCreateTask?: (task: StandaloneTask) => void;
  onUpdateLead?: (lead: Lead) => void;
  onToast?:      (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type Tab = 'followup' | 'pipeline' | 'templates';

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function DashboardAiPanel({
  leads, currentUser, workspace, onCreateTask, onUpdateLead, onToast,
}: DashboardAiPanelProps) {

  /* ── shared state ── */
  const [expanded,      setExpanded]      = useState(false);
  const [tab,           setTab]           = useState<Tab>('followup');

  /* ── follow-up state ── */
  const [threshold]                        = useState(7);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [messages,      setMessages]      = useState<Record<string, string>>({});
  const [copiedId,      setCopiedId]      = useState<string | null>(null);
  const [mirrorStyles,  setMirrorStyles]  = useState<string[]>([]);

  /* ── templates state ── */
  const [templates,         setTemplates]         = useState<WATemplate[]>([]);
  const [templatesLoaded,   setTemplatesLoaded]   = useState(false);
  const [templateCat,       setTemplateCat]       = useState<WATemplateCategory>('general');
  const [generatingTemplate,setGeneratingTemplate]= useState(false);
  const [copiedTemplateId,  setCopiedTemplateId]  = useState<string | null>(null);
  const [sendPicker,        setSendPicker]        = useState<string | null>(null); // templateId
  const [expandedTemplate,  setExpandedTemplate]  = useState<string | null>(null);
  const sendPickerRef = useRef<HTMLDivElement>(null);

  /* ── load mirror styles once ── */
  useEffect(() => {
    getDoc(doc(db, 'mirror-mode', 'styles')).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as { examples?: string[] };
        setMirrorStyles(d.examples ?? []);
      }
    }).catch(() => {});
  }, []);

  /* ── load WA templates from Firestore ── */
  useEffect(() => {
    if (!workspace?.id || templatesLoaded) return;
    getDocs(templatesCol(workspace.id))
      .then(snap => {
        const list: WATemplate[] = snap.docs.map(d => d.data() as WATemplate);
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setTemplates(list);
        setTemplatesLoaded(true);
      })
      .catch(() => setTemplatesLoaded(true));
  }, [workspace?.id, templatesLoaded]);

  /* ── close send-picker on outside click ── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sendPickerRef.current && !sendPickerRef.current.contains(e.target as Node)) {
        setSendPicker(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── derived data ── */
  const staleLeads = leads
    .filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) && daysSince(l) >= threshold)
    .sort((a, b) => daysSince(b) - daysSince(a))
    .slice(0, 10);

  const urgentCount  = staleLeads.filter(l => daysSince(l) >= 21).length;
  const warningCount = staleLeads.filter(l => daysSince(l) >= 14 && daysSince(l) < 21).length;
  const normalCount  = staleLeads.filter(l => daysSince(l) < 14).length;

  const topOpps = leads
    .filter(l => ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status) && l.budget > 0)
    .map(l => ({ lead: l, exp: l.budget * closeProbability(l) }))
    .filter(o => o.exp > 0)
    .sort((a, b) => b.exp - a.exp)
    .slice(0, 5);

  const filteredTemplates = templateCat === 'general'
    ? templates
    : templates.filter(t => t.category === templateCat || t.category === 'general');

  /* ── pick leads relevant to a template (for the send-picker) ── */
  const pickerLeads = (tmpl: WATemplate) => {
    const base = leads.filter(l => l.phone && ['חדש', 'בתהליך', 'רימרקטינג'].includes(l.status));
    if (tmpl.category === 'general') return base;
    return base.sort((a, b) => {
      const aMatch = a.status === tmpl.category ? -1 : 1;
      const bMatch = b.status === tmpl.category ? -1 : 1;
      return aMatch - bMatch;
    });
  };

  /* ── generate follow-up WhatsApp message for a lead ── */
  const generateFollowupMsg = useCallback(async (lead: Lead) => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש בדף החיוב.', 'error'); return; }
    }
    setGeneratingFor(lead.id);
    try {
      const client    = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const lastNote  = lead.notes[lead.notes.length - 1]?.text ?? 'אין הערות';
      const services  = lead.solutions.map(s => s.name).join(', ') || 'טרם הוגדרו';
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
    finally   { setGeneratingFor(null); }
  }, [mirrorStyles, workspace, onToast]);

  /* ── generate WA template via AI ── */
  const generateTemplate = useCallback(async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) { onToast?.('⚠️ אין מספיק טוקנים. רכוש בדף החיוב.', 'error'); return; }
    }
    setGeneratingTemplate(true);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const bizCtx = workspace?.prompt ? `\nהקשר עסקי: ${workspace.prompt}` : '';
      const catLabel = CATEGORY_LABELS[templateCat];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 400,
        messages: [{ role: 'user', content:
          `צור תבנית הודעת ווטסאפ מקצועית לעסק.${bizCtx}\nקטגוריה: ${catLabel}\n\nהחזר JSON בלבד בפורמט הבא (ללא תגיות markdown):\n{"title":"כותרת קצרה לתבנית","text":"טקסט ההודעה עצמה"}\n\nכללים:\n- עברית בלבד\n- 2-4 משפטים\n- חמים ומקצועי\n- ללא חתימה\n- אפשר להשאיר [שם הלקוח] כ-placeholder`,
        }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = res.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
      const parsed = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,''));

      if (!parsed.title || !parsed.text) throw new Error('Invalid JSON from AI');

      const newTmpl: WATemplate = {
        id:        `tmpl_${Date.now()}`,
        title:     parsed.title,
        text:      parsed.text,
        category:  templateCat,
        createdAt: new Date().toISOString(),
      };

      if (workspace?.id) {
        await setDoc(templateDoc(workspace.id, newTmpl.id), newTmpl);
      }
      setTemplates(prev => [...prev, newTmpl]);

      try {
        const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
        if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-5', 'WA template generation');
      } catch {}

      onToast?.('תבנית נוצרה ✓', 'success');
    } catch (e) {
      console.error(e);
      onToast?.('שגיאה ביצירת תבנית', 'error');
    }
    finally { setGeneratingTemplate(false); }
  }, [templateCat, workspace, onToast]);

  /* ── delete template ── */
  const deleteTemplate = async (tmpl: WATemplate) => {
    setTemplates(prev => prev.filter(t => t.id !== tmpl.id));
    if (workspace?.id) {
      await deleteDoc(templateDoc(workspace.id, tmpl.id)).catch(() => {});
    }
    onToast?.('תבנית נמחקה', 'info');
  };

  /* ── send template to lead ── */
  const sendToLead = (tmpl: WATemplate, lead: Lead) => {
    const waNumber = `972${lead.phone.replace(/^0/, '').replace(/\D/g, '')}`;
    const personalised = tmpl.text.replace(/\[שם הלקוח\]/g, lead.contactName || lead.company);
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(personalised)}`, '_blank');
    setSendPicker(null);
    onToast?.(`נשלח ל-${lead.company} ✓`, 'success');
  };

  /* ── copy template ── */
  const copyTemplate = (tmpl: WATemplate) => {
    navigator.clipboard.writeText(tmpl.text).then(() => {
      setCopiedTemplateId(tmpl.id);
      setTimeout(() => setCopiedTemplateId(null), 2000);
    });
  };

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

  const copyFollowupMsg = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  /* ── header badge counts ── */
  const totalTemplates = templates.length;

  /* ── hide panel if truly empty ── */
  if (staleLeads.length === 0 && topOpps.length === 0 && totalTemplates === 0) return null;

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="rounded-2xl overflow-hidden border border-indigo-200/80 shadow-md shadow-indigo-100/40">

      {/* ══ Collapsed header ══ */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full bg-gradient-to-l from-indigo-600 via-indigo-600 to-violet-700 px-5 py-3.5
                   flex items-center gap-3 hover:from-indigo-500 hover:to-violet-600 transition-all"
      >
        <div className="flex-shrink-0">
          {expanded ? <ChevronUp size={15} className="text-indigo-200" /> : <ChevronDown size={15} className="text-indigo-200" />}
        </div>
        <div className="flex-1 text-right">
          <span className="text-white font-bold text-sm">🤖 סוכן AI</span>
          <span className="text-indigo-200 text-xs mr-2 hidden sm:inline">
            {staleLeads.length > 0 ? `${staleLeads.length} לידים ממתינים` : `${totalTemplates} תבניות WA`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {urgentCount  > 0 && <Pill color="bg-red-500">    {urgentCount}  דחוף</Pill>}
          {warningCount > 0 && <Pill color="bg-orange-400"> {warningCount} ממתין</Pill>}
          {normalCount  > 0 && <Pill color="bg-amber-400">  {normalCount}  מתחמם</Pill>}
          {totalTemplates > 0 && staleLeads.length === 0 && (
            <Pill color="bg-green-500">{totalTemplates} תבניות</Pill>
          )}
        </div>
      </button>

      {/* ══ Expanded body ══ */}
      {expanded && (
        <div className="bg-slate-50 border-t border-indigo-100">

          {/* Tab bar */}
          <div className="flex border-b border-slate-200 bg-white">
            <TabBtn active={tab === 'followup'}  onClick={() => setTab('followup')}
              icon={<Clock size={12}/>}       label={`מעקב${staleLeads.length > 0 ? ` (${staleLeads.length})` : ''}`} />
            <TabBtn active={tab === 'pipeline'}  onClick={() => setTab('pipeline')}
              icon={<TrendingUp size={12}/>}  label="פייפליין" />
            <TabBtn active={tab === 'templates'} onClick={() => setTab('templates')}
              icon={<Smartphone size={12}/>}  label={`תבניות WA${totalTemplates > 0 ? ` (${totalTemplates})` : ''}`} />
          </div>

          {/* ══ TAB: Follow-up ══ */}
          {tab === 'followup' && (
            <div className="p-3 space-y-2.5 max-h-[500px] overflow-y-auto">
              {staleLeads.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-300" />
                  <p className="text-sm font-medium">כל הלידים מעודכנים 🎉</p>
                </div>
              ) : staleLeads.map(lead => {
                const days  = daysSince(lead);
                const u     = urgencyOf(days);
                const msg   = messages[lead.id];
                const isGen = generatingFor === lead.id;
                const waNum = lead.phone ? `972${lead.phone.replace(/^0/,'').replace(/\D/g,'')}` : '';

                return (
                  <div key={lead.id} className={`border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${u.border} ${u.bg}`}>
                    <div className="p-3">
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 flex flex-col items-center gap-0.5 pt-1">
                          <div className={`w-2 h-2 rounded-full ${u.dot}`} />
                          <span className="text-[9px] font-black text-slate-500">{days === 999 ? '?' : days}י׳</span>
                        </div>
                        <div className="flex-1 min-w-0 text-right">
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${u.badge}`}>{u.label}</span>
                            <span className="font-bold text-slate-800 text-sm">{lead.company}</span>
                          </div>
                          <p className="text-slate-500 text-xs mt-0.5 truncate">
                            {lead.contactName}{lead.phone && ` · ${lead.phone}`}{lead.budget > 0 && ` · ₪${lead.budget.toLocaleString()}`}
                          </p>
                          {lead.notes.length > 0 && (
                            <p className="text-slate-400 text-[10px] mt-1 italic line-clamp-1">"{lead.notes[lead.notes.length - 1].text}"</p>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => markContacted(lead)} title="סמן כטיפלתי"
                            className="w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-200 flex items-center justify-center text-emerald-600 transition-colors">
                            <CheckCircle2 size={12}/>
                          </button>
                          {onCreateTask && currentUser && (
                            <button onClick={() => createFollowupTask(lead)} title="צור משימת מעקב"
                              className="w-7 h-7 rounded-lg bg-blue-100 hover:bg-blue-200 border border-blue-200 flex items-center justify-center text-blue-600 transition-colors">
                              <Calendar size={12}/>
                            </button>
                          )}
                          {waNum && (
                            <a href={`https://wa.me/${waNum}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`}
                              target="_blank" rel="noreferrer" title="WhatsApp"
                              className="w-7 h-7 rounded-lg bg-green-100 hover:bg-green-200 border border-green-200 flex items-center justify-center text-green-600 transition-colors">
                              <MessageCircle size={12}/>
                            </a>
                          )}
                        </div>
                      </div>
                      {!msg && (
                        <button onClick={() => generateFollowupMsg(lead)} disabled={isGen}
                          className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-xs font-bold py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 transition-all disabled:opacity-50">
                          {isGen ? <><Loader2 size={11} className="animate-spin"/> מייצר...</> : <><Brain size={11}/> צור הודעת ווטסאפ חכמה</>}
                        </button>
                      )}
                    </div>
                    {msg && (
                      <div className="border-t border-slate-200/80 bg-white p-3 space-y-2">
                        <textarea value={msg} onChange={e => setMessages(p => ({ ...p, [lead.id]: e.target.value }))}
                          rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300 text-right"/>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button onClick={() => copyFollowupMsg(lead.id, msg)}
                            className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded-lg transition-colors font-medium">
                            <Copy size={9}/> {copiedId === lead.id ? '✓ הועתק' : 'העתק'}
                          </button>
                          {waNum && (
                            <a href={`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg transition-colors font-medium">
                              <MessageCircle size={9}/> שלח
                            </a>
                          )}
                          <button onClick={() => generateFollowupMsg(lead)} disabled={isGen}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                            <RefreshCw size={9}/> שנה
                          </button>
                          <span className="mr-auto text-[9px] text-slate-400">✨ {mirrorStyles.length > 0 ? 'Mirror Style' : 'AI Default'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ TAB: Pipeline ══ */}
          {tab === 'pipeline' && (
            <div className="p-3 space-y-2">
              {topOpps.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <TrendingUp size={32} className="mx-auto mb-2 text-slate-200" />
                  <p className="text-sm">אין לידים עם תקציב בפייפליין</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500 text-right px-1 flex items-center gap-1 justify-end">
                    <Star size={10} className="text-amber-400"/> הזדמנויות עם הפוטנציאל הגבוה ביותר לסגירה
                  </p>
                  {topOpps.map(({ lead, exp }, i) => {
                    const prob = Math.round(closeProbability(lead) * 100);
                    return (
                      <div key={lead.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-indigo-200 transition-colors">
                        <span className="text-slate-300 text-xs font-bold flex-shrink-0 w-4 text-center">{i + 1}</span>
                        <div className="flex-1 min-w-0 text-right">
                          <p className="font-bold text-slate-800 text-sm">{lead.company}</p>
                          <p className="text-slate-500 text-xs">{lead.contactName} · {lead.status}</p>
                        </div>
                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-slate-400">ציפייה</p>
                            <p className="text-emerald-600 font-black text-sm">₪{Math.round(exp).toLocaleString()}</p>
                          </div>
                          <div className="flex flex-col items-center">
                            <Activity size={10} className="text-slate-400 mb-0.5"/>
                            <span className={`text-[10px] font-bold ${prob >= 30 ? 'text-emerald-600' : prob >= 15 ? 'text-orange-500' : 'text-slate-400'}`}>{prob}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
                    <span className="text-indigo-500 text-xs font-bold">₪{Math.round(topOpps.reduce((s, o) => s + o.exp, 0)).toLocaleString()}</span>
                    <span className="text-indigo-700 text-xs font-bold">סה"כ פוטנציאל מצופה</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ TAB: WhatsApp Templates ══ */}
          {tab === 'templates' && (
            <div className="p-3 space-y-3">

              {/* Category filter + Generate button */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={generateTemplate}
                  disabled={generatingTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {generatingTemplate
                    ? <><Loader2 size={11} className="animate-spin"/> יוצר...</>
                    : <><Sparkles size={11}/> צור תבנית AI</>
                  }
                </button>
                <div className="flex items-center gap-1.5 overflow-x-auto flex-wrap">
                  {(['general','חדש','בתהליך','רימרקטינג'] as WATemplateCategory[]).map(cat => (
                    <button key={cat} onClick={() => setTemplateCat(cat)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                        templateCat === cat
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                      }`}>
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Templates list */}
              {filteredTemplates.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-200">
                  <Smartphone size={28} className="mx-auto mb-2 text-slate-200"/>
                  <p className="text-sm text-slate-400 font-medium">אין תבניות עדיין</p>
                  <p className="text-xs text-slate-300 mt-1">לחץ "צור תבנית AI" ליצירה אוטומטית</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {filteredTemplates.map(tmpl => {
                    const isExpanded = expandedTemplate === tmpl.id;
                    const isSendOpen = sendPicker === tmpl.id;
                    const sendLeads  = pickerLeads(tmpl);

                    return (
                      <div key={tmpl.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-indigo-200 transition-colors">

                        {/* Template header */}
                        <div className="px-3.5 py-3 flex items-start gap-2.5">
                          {/* Category dot */}
                          <span className={`mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full border font-bold flex-shrink-0 ${CATEGORY_COLOR[tmpl.category]}`}>
                            {CATEGORY_LABELS[tmpl.category]}
                          </span>

                          {/* Title + text preview */}
                          <div className="flex-1 min-w-0 text-right">
                            <p className="font-semibold text-slate-800 text-sm">{tmpl.title}</p>
                            <p className={`text-xs text-slate-500 mt-0.5 ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                              {tmpl.text}
                            </p>
                            {!isExpanded && tmpl.text.length > 80 && (
                              <button onClick={() => setExpandedTemplate(tmpl.id)}
                                className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-0.5 flex items-center gap-0.5 mr-auto">
                                הצג הכל <ChevronRight size={9}/>
                              </button>
                            )}
                            {isExpanded && (
                              <button onClick={() => setExpandedTemplate(null)}
                                className="text-[10px] text-slate-400 hover:text-slate-600 mt-0.5">
                                כווץ
                              </button>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => copyTemplate(tmpl)} title="העתק"
                              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                              {copiedTemplateId === tmpl.id
                                ? <CheckCircle2 size={11} className="text-emerald-500"/>
                                : <Copy size={11}/>}
                            </button>
                            <button onClick={() => setSendPicker(isSendOpen ? null : tmpl.id)} title="שלח לליד"
                              className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                                isSendOpen
                                  ? 'bg-green-600 border-green-600 text-white'
                                  : 'bg-green-50 hover:bg-green-100 border-green-200 text-green-600'
                              }`}>
                              <Send size={11}/>
                            </button>
                            <button onClick={() => deleteTemplate(tmpl)} title="מחק"
                              className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors">
                              <Trash2 size={11}/>
                            </button>
                          </div>
                        </div>

                        {/* Send-to-lead picker */}
                        {isSendOpen && (
                          <div ref={sendPickerRef} className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                            <p className="text-[10px] text-slate-400 text-right mb-2 font-medium">בחר ליד לשליחה:</p>
                            {sendLeads.length === 0 ? (
                              <p className="text-xs text-slate-400 text-center py-2">אין לידים עם מספר טלפון</p>
                            ) : (
                              <div className="space-y-1 max-h-44 overflow-y-auto">
                                {sendLeads.map(lead => (
                                  <button key={lead.id} onClick={() => sendToLead(tmpl, lead)}
                                    className="w-full flex items-center justify-between bg-white hover:bg-green-50 border border-slate-200 hover:border-green-300 rounded-lg px-3 py-2 text-right transition-colors group">
                                    <MessageCircle size={12} className="text-green-400 group-hover:text-green-600 flex-shrink-0"/>
                                    <div className="flex-1 text-right mx-2">
                                      <span className="text-sm font-semibold text-slate-800">{lead.company}</span>
                                      <span className="text-xs text-slate-400 mr-2">{lead.contactName}</span>
                                    </div>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${CATEGORY_COLOR[lead.status as WATemplateCategory] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                      {lead.status}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tip */}
              <p className="text-[10px] text-slate-400 text-center">
                תבניות נשמרות אוטומטית · [שם הלקוח] יוחלף שמו בשליחה
              </p>
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
function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`${color} text-white text-[10px] font-black px-2 py-0.5 rounded-full leading-none whitespace-nowrap`}>
      {children}
    </span>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors flex-1 justify-center ${
        active
          ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
      }`}>
      {icon}{label}
    </button>
  );
}
