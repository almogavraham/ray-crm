/**
 * LeadAgents — per-lead focused versions of the smart agents.
 * Rendered inside the LeadModal "agents" tab.
 * Each agent is pre-scoped to the current lead (no lead-selector UI).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  FileText, Search, Calendar, Mail,
  Loader2, Copy, CheckCircle2, RefreshCw, ChevronDown,
  Sparkles,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import type { Lead, WorkspaceProfile } from '../types';
import { getApiKey } from '../lib/apiKey';

/* ── shared types ─────────────────────────────────────────────────────────── */
interface AgentProps {
  lead:       Lead;
  workspace?: WorkspaceProfile;
  currentUser?: string;
  onUpdateLead?: (updated: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/* ── copy helper ──────────────────────────────────────────────────────────── */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return { copied, copy };
}

/* ── markdown → JSX (simple) ─────────────────────────────────────────────── */
function MdText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed">
      {text.split('\n').map((line, i) => {
        const bold = line.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        return <p key={i} className="mb-1" dangerouslySetInnerHTML={{ __html: bold }} />;
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1. PROPOSAL GENERATOR
══════════════════════════════════════════════════════════════════════════ */
const PROPOSAL_TYPES = [
  'הצעת מחיר מלאה',
  'תמצית ביצועים',
  'הצעה לפגישה ראשונה',
  'חידוש חוזה / upgrade',
  'הצעה לאחר מעקב',
];

export function ProposalAgent({ lead, workspace, currentUser, onToast }: AgentProps) {
  const [type,     setType]     = useState(PROPOSAL_TYPES[0]);
  const [result,   setResult]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const { copied, copy } = useCopy();

  const bizName    = workspace?.name ?? 'העסק שלנו';
  const services   = lead.solutions.map(s => s.name).join(', ') || (workspace?.businessSolutions ?? []).join(', ') || 'שירותים שונים';
  const tone       = workspace?.aiProfile?.tone ?? 'מקצועי';

  const generate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setResult('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 900,
        system: `אתה כותב הצעות מחיר עבור ${bizName}. סגנון: ${tone}. כתוב בעברית בלבד, ממוקד ומכירתי.`,
        messages: [{
          role: 'user',
          content: `כתוב ${type} עבור הלקוח:
חברה: ${lead.company}
איש קשר: ${lead.contactName}
סטטוס: ${lead.status}
שירותים מעניינים: ${services}
תקציב: ₪${lead.budget ?? 0}/חודש
מי כותב: ${currentUser ?? bizName}

כלול: פתיחה אישית, פירוט שירותים, ערך מוסף, קריאה לפעולה.`,
        }],
      });
      setResult((msg.content[0] as { text: string }).text);
    } catch { onToast?.('שגיאה ביצירת הצעה', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ChevronDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <select
            value={type} onChange={e => setType(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2.5 pr-3 pl-7 appearance-none focus:outline-none focus:border-indigo-500"
          >
            {PROPOSAL_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <button
          onClick={generate} disabled={loading}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {loading ? 'יוצר...' : 'צור'}
        </button>
      </div>

      {result && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
          <MdText text={result} />
          <button
            onClick={() => copy(result)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'הועתק!' : 'העתק'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LEAD ENRICHMENT
══════════════════════════════════════════════════════════════════════════ */
export function EnrichAgent({ lead, workspace, onUpdateLead, onToast }: AgentProps) {
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(false);
  const { copied, copy } = useCopy();

  const bizName    = workspace?.name ?? 'העסק שלנו';
  const bizServices = (workspace?.businessSolutions ?? []).join(', ');

  const enrich = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setResult(''); setUpdated(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        model: 'claude-opus-4-6',
        max_tokens: 700,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `אתה אנליסט מכירות של ${bizName} (מציע: ${bizServices || 'שירותים שונים'}). חפש מידע עסקי רלוונטי. ענה בעברית, קצר וממוקד.`,
        messages: [{
          role: 'user',
          content: `חפש מידע עדכני על: ${lead.company}. מה חשוב לדעת לפני מכירה? תן: תחום, גודל, הזדמנות מכירה.`,
        }],
      };
      let finalText = '';
      for (let t = 0; t < 4; t++) {
        const res = await client.messages.create(payload);
        const texts = res.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
        if (texts) finalText = texts;
        if (res.stop_reason === 'end_turn' || !res.content.some((b: { type: string }) => b.type === 'tool_use')) break;
        payload.messages = [...payload.messages,
          { role: 'assistant', content: res.content },
          { role: 'user', content: res.content.filter((b: { type: string }) => b.type === 'tool_use').map((b: { id: string; name: string; input: { query?: string } }) => ({
            type: 'tool_result', tool_use_id: b.id,
            content: `Search results for: ${b.input.query ?? ''}`,
          })) },
        ];
      }
      setResult(finalText);
      // Auto-bump AI score a bit
      if (onUpdateLead && lead.aiScore < 90) {
        const updated = { ...lead, aiScore: Math.min(99, lead.aiScore + 5) };
        onUpdateLead(updated);
        setUpdated(true);
      }
    } catch { onToast?.('שגיאה בחיפוש מידע', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={enrich} disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
        {loading ? 'מחפש מידע על ' + lead.company + '...' : 'העשר מידע על ' + lead.company}
      </button>

      {updated && (
        <p className="text-emerald-400 text-xs flex items-center gap-1">
          <CheckCircle2 size={11} /> ציון AI עודכן אוטומטית
        </p>
      )}

      {result && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
          <MdText text={result} />
          <button onClick={() => copy(result)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'הועתק!' : 'העתק'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3. MEETING BRIEF
══════════════════════════════════════════════════════════════════════════ */
export function BriefAgent({ lead, workspace, currentUser, onToast }: AgentProps) {
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy();

  const bizName    = workspace?.name ?? 'העסק שלנו';
  const salesProc  = workspace?.aiProfile?.salesProcess ?? '';
  const services   = lead.solutions.map(s => s.name).join(', ') || (workspace?.businessSolutions ?? []).slice(0, 3).join(', ') || '';

  const generate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setResult('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 700,
        system: `אתה עוזר מכירות של ${bizName}. ${salesProc ? `תהליך המכירה: ${salesProc}` : ''} כתוב בריפים לפגישות בעברית, קצר וממוקד.`,
        messages: [{
          role: 'user',
          content: `צור בריף לפגישה עם:
חברה: ${lead.company} | איש קשר: ${lead.contactName}
סטטוס: ${lead.status} | תקציב: ₪${lead.budget ?? 0}/חודש
שירותים רלוונטיים: ${services}
מי מנהל הפגישה: ${currentUser ?? 'נציג מכירות'}

כלול: מטרת הפגישה, נקודות עיקריות לדיון, 3 שאלות לשאול, המלצת סגירה.`,
        }],
      });
      setResult((msg.content[0] as { text: string }).text);
    } catch { onToast?.('שגיאה ביצירת בריף', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={generate} disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Calendar size={12} />}
        {loading ? 'מכין בריף...' : 'צור בריף לפגישה עם ' + lead.company}
      </button>

      {result && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
          <MdText text={result} />
          <button onClick={() => copy(result)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'הועתק!' : 'העתק'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   4. SMART FOLLOW-UP MESSAGE
══════════════════════════════════════════════════════════════════════════ */
const MSG_CHANNELS = ['WhatsApp', 'אימייל', 'SMS', 'LinkedIn'];

export function FollowupMessageAgent({ lead, workspace, currentUser, onToast }: AgentProps) {
  const [channel, setChannel] = useState('WhatsApp');
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy();

  const bizName  = workspace?.name ?? 'העסק שלנו';
  const tone     = workspace?.aiProfile?.tone ?? 'ידידותי';
  const services = lead.solutions.map(s => s.name).join(', ') || (workspace?.businessSolutions ?? []).slice(0, 2).join(', ') || '';

  const generate = async () => {
    const apiKey = getApiKey();
    if (!apiKey) { onToast?.('מפתח API חסר', 'error'); return; }
    setLoading(true); setResult('');
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 400,
        system: `אתה כותב הודעות מעקב עבור ${bizName}. סגנון: ${tone}. ל-${channel}. עברית בלבד. קצר וממוקד.`,
        messages: [{
          role: 'user',
          content: `כתוב הודעת מעקב ל${channel}:
נמען: ${lead.contactName} (${lead.company})
סטטוס: ${lead.status}
שירותים: ${services}
שולח: ${currentUser ?? bizName}

הודעה קצרה, אישית, עם קריאה ברורה לפעולה.`,
        }],
      });
      setResult((msg.content[0] as { text: string }).text);
    } catch { onToast?.('שגיאה ביצירת הודעה', 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex gap-1 flex-wrap">
          {MSG_CHANNELS.map(c => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                channel === c ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={generate} disabled={loading}
          className="mr-auto flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? 'יוצר...' : 'צור'}
        </button>
      </div>

      {result && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
          <MdText text={result} />
          <div className="flex gap-3">
            <button onClick={() => copy(result)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
              {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'הועתק!' : 'העתק'}
            </button>
            {channel === 'WhatsApp' && lead.phone && (
              <a
                href={`https://wa.me/${lead.phone.replace(/\D/g, '').replace(/^0/, '972')}?text=${encodeURIComponent(result)}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                <Mail size={11} /> שלח WhatsApp ←
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AGENTS TAB — grid of 4 agents with expandable panels
══════════════════════════════════════════════════════════════════════════ */
type AgentKey = 'proposal' | 'enrich' | 'brief' | 'followup';

const AGENT_CARDS: { key: AgentKey; icon: ReactNode; label: string; desc: string; color: string }[] = [
  { key: 'proposal', icon: <FileText  size={16} />, label: 'הצעת מחיר',    desc: 'הצעה מכירתית מותאמת',  color: 'from-indigo-500 to-violet-600' },
  { key: 'enrich',   icon: <Search    size={16} />, label: 'העשרת ליד',    desc: 'חיפוש מידע על החברה', color: 'from-violet-500 to-purple-600'  },
  { key: 'brief',    icon: <Calendar  size={16} />, label: 'בריף פגישה',   desc: 'הכנה לפגישה הבאה',    color: 'from-amber-500 to-orange-600'   },
  { key: 'followup', icon: <Mail      size={16} />, label: 'הודעת מעקב',   desc: 'WhatsApp / מייל / SMS', color: 'from-emerald-500 to-teal-600'  },
];

interface AgentsTabProps extends AgentProps {}

export function AgentsTab({ lead, workspace, currentUser, onUpdateLead, onToast }: AgentsTabProps) {
  const [active, setActive] = useState<AgentKey | null>(null);

  return (
    <div className="space-y-3" dir="rtl">
      {/* Agent grid */}
      <div className="grid grid-cols-2 gap-2">
        {AGENT_CARDS.map(card => (
          <button
            key={card.key}
            onClick={() => setActive(active === card.key ? null : card.key)}
            className={`relative p-3 rounded-xl border text-right transition-all ${
              active === card.key
                ? 'border-indigo-500/60 bg-indigo-500/10'
                : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/70'
            }`}
          >
            <div className={`inline-flex w-8 h-8 rounded-lg bg-gradient-to-br ${card.color} items-center justify-center text-white mb-2`}>
              {card.icon}
            </div>
            <p className="text-white text-xs font-bold">{card.label}</p>
            <p className="text-slate-500 text-[10px] mt-0.5">{card.desc}</p>
            {active === card.key && (
              <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-indigo-400" />
            )}
          </button>
        ))}
      </div>

      {/* Active agent panel */}
      {active === 'proposal' && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <FileText size={11} className="text-indigo-400" /> הצעת מחיר — {lead.company}
          </p>
          <ProposalAgent lead={lead} workspace={workspace} currentUser={currentUser} onToast={onToast} />
        </div>
      )}
      {active === 'enrich' && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <Search size={11} className="text-violet-400" /> העשרת מידע — {lead.company}
          </p>
          <EnrichAgent lead={lead} workspace={workspace} onUpdateLead={onUpdateLead} onToast={onToast} />
        </div>
      )}
      {active === 'brief' && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <Calendar size={11} className="text-amber-400" /> בריף פגישה — {lead.company}
          </p>
          <BriefAgent lead={lead} workspace={workspace} currentUser={currentUser} onToast={onToast} />
        </div>
      )}
      {active === 'followup' && (
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
          <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <Mail size={11} className="text-emerald-400" /> הודעת מעקב — {lead.contactName}
          </p>
          <FollowupMessageAgent lead={lead} workspace={workspace} currentUser={currentUser} onToast={onToast} />
        </div>
      )}
    </div>
  );
}
