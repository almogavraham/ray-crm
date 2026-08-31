/**
 * AutomationChat — a conversational automation builder.
 *
 * Instead of a one-shot "describe it and hope", this keeps a real conversation:
 * the assistant replies in Hebrew, asks clarifying questions when the request is
 * ambiguous, and maintains a LIVE DRAFT of the automation that the user can keep
 * refining ("also colour it red", "only for Facebook leads", "make it 72 hours").
 *
 * Every turn shows the current draft translated back into plain Hebrew plus how
 * many of the workspace's leads match it right now — so the user always sees the
 * real-world impact before saving anything.
 */

import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, Sparkles, CheckCircle2, Zap, Users, RotateCcw, Mic, Square, Volume2 } from 'lucide-react';
import type { Lead, TeamMember } from '../types';
import {
  TRIGGER_LABELS, ACTION_LABELS, VALUELESS_TRIGGERS, FLAG_COLORS, CONTACT_METHODS,
  matchesWorkflow, describeCondition, describeAction, SAFE_ACTIONS,
} from '../lib/automationEngine';
import type { TriggerType, WFActionType, Workflow, WorkflowCondition, WorkflowAction } from '../lib/automationEngine';
import {
  useChatSession, setMessages, appendMessage, updateSession, setOpen, clearSession,
} from '../lib/chatSessionStore';
import { useDraggableWindow } from '../lib/useDraggableWindow';
import { useVoiceChat } from '../lib/useVoiceChat';

const GREETING: ChatMsg = {
  role: 'assistant',
  text: `שלום! אני בונה האוטומציות של RAY 🤖

תאר לי במילים שלך מה אתה רוצה שיקרה — ואני אבנה את האוטומציה, אסביר בדיוק מה היא עושה, ונוכל לשפר אותה יחד.

למשל: "אם ליד לא ענה 3 פעמים — צבע אותו באדום ותפתח לי משימה"`,
};

interface DraftWorkflow {
  name: string;
  description: string;
  conditionLogic: 'and' | 'or';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  draft?: DraftWorkflow;      // snapshot of the draft produced by this turn
  matchCount?: number;
}

interface Props {
  leads: Lead[];
  statuses: string[];
  sources: string[];
  team?: TeamMember[];
  onSave: (wf: DraftWorkflow) => Promise<void> | void;
  onClose: () => void;
  /** Opens the chat with this question already asked — used by the studio's
   *  "ask the builder" buttons so context carries over. */
  seedPrompt?: string;
}

const uid = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export default function AutomationChat({ leads, statuses, sources, team, onSave, onClose, seedPrompt }: Props) {
  const { backdropProps, panelProps, handleProps } = useDraggableWindow('automation');
  /* Session lives in the shared store — closing the window keeps both the
     conversation and the live draft, and lets a running turn finish. */
  const session = useChatSession<ChatMsg>('automation');
  const msgs    = session.msgs.length ? session.msgs : [GREETING];
  const busy    = session.busy;

  // Speak to RAY here the same way as in the personal assistant: the hook runs
  // listen → send → speak the answer → listen again until it is switched off.
  const askVoice = (t: string) => { void submitText(t); };
  const lastReply = [...msgs].reverse().find(m => m.role === 'assistant')?.text;
  const voice = useVoiceChat({
    onSay: t => { setInput(''); void askVoice(t); },
    lastReply,
    busy: busy,
  });
  const draft   = (session.extra.draft as DraftWorkflow | undefined) ?? null;
  const setMsgs = (u: ChatMsg[] | ((p: ChatMsg[]) => ChatMsg[])) =>
    setMessages<ChatMsg>('automation', prev => {
      const base = prev.length ? prev : [GREETING];
      return typeof u === 'function' ? (u as (p: ChatMsg[]) => ChatMsg[])(base) : u;
    });
  const setBusy  = (v: boolean) => updateSession('automation', { busy: v });
  const setDraft = (d: DraftWorkflow | null) =>
    updateSession('automation', s => ({ extra: { ...s.extra, draft: d } }));

  const [input, setInput]     = useState('');
  const [saving, setSaving]   = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen('automation', true); return () => setOpen('automation', false); }, []);

  // Fire the seeded question once, on open.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !seedPrompt?.trim()) return;
    setSeeded(true);
    setInput(seedPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  /** How many leads the current draft would hit right now. */
  const countMatches = (d: DraftWorkflow) => {
    const wf: Workflow = {
      id: 'preview', name: d.name, active: true,
      conditionLogic: d.conditionLogic, conditions: d.conditions, actions: d.actions,
      createdAt: '', runCount: 0,
    };
    return leads.filter(l => matchesWorkflow(l, wf)).length;
  };

  /** `send` reads the composer; voice supplies its own text, so both share this. */
  const submitText = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    const history = [...msgs, { role: 'user' as const, text }];
    setMsgs(history);
    setBusy(true);

    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const client = getAnthropicProxy();

      const triggerDocs = (Object.keys(TRIGGER_LABELS) as TriggerType[])
        .map(k => `  "${k}" — ${TRIGGER_LABELS[k]}${VALUELESS_TRIGGERS.includes(k) ? ' (ללא value)' : ''}`).join('\n');
      const actionDocs = (Object.keys(ACTION_LABELS) as WFActionType[])
        .map(k => `  "${k}" — ${ACTION_LABELS[k].replace(/^\S+\s/, '')}${SAFE_ACTIONS.includes(k) ? '' : ' [ידני בלבד — לא ירוץ אוטומטית]'}`).join('\n');
      const solutions = [...new Set(leads.flatMap(l => (l.solutions ?? []).map(s => s.name)))].slice(0, 20);

      const system = `אתה "בונה האוטומציות" של מערכת ה-CRM בשם RAY. אתה מומחה למכירות ולאוטומציה, מדבר עברית, ידידותי ותכליתי.

תפקידך: לנהל שיחה עם המשתמש ולבנות איתו אוטומציה מדויקת. אתה גם *עונה* לו כמו יועץ — מסביר מה בנית, מציע שיפורים, ושואל שאלה מבהירה אחת כשמשהו באמת לא ברור.

## סוגי תנאים (conditions.type) — רק אלה:
${triggerDocs}

## סוגי פעולות (actions.type) — רק אלה:
${actionDocs}

## ערכים חוקיים בסביבה הזו (אל תמציא!):
סטטוסים: ${statuses.join(' | ')}
מקורות: ${sources.join(' | ')}
${team?.length ? `צוות: ${team.map(m => m.name).join(' | ')}` : ''}
${solutions.length ? `פתרונות: ${solutions.join(' | ')}` : ''}
צבעים: ${FLAG_COLORS.map(f => `${f.value}=${f.label}`).join(' | ')}
אמצעי פנייה: ${CONTACT_METHODS.map(m => m.value).join(' | ')}

## config לכל פעולה:
create_task {"description","priority":"high|medium|low"} · change_status {"status"} · set_flag_color {"color","reason"} · set_followup {"days"} · add_note {"noteText"} · assign_to {"assignee"} · send_whatsapp_ai|send_email_ai {"tone","prompt"} · send_webhook {"url"} · mark_hot|unmark_hot|clear_flag_color {}

## הנתונים שתקבל
תקבל את **כל הלידים** ברשומה קומפקטית (סטטוס, מקור, פתרונות ומחירים, התנגדות, ימים ללא מגע, ללא-מענה, משימות, הערה ופעילות אחרונות) ו**כרטיסים מלאים** לכמה מהם עם כל ההערות ויומן הפעילות.

השתמש בזה כדי לבנות אוטומציות שמתאימות למציאות ולא לתיאוריה:
- לפני שאתה מציע כלל — הערך בעצמך כמה לידים הוא היה תופס היום, ואמור זאת למשתמש.
- אם רואה דפוס חוזר (התנגדות שחוזרת, מקור שתמיד נתקע, פתרון שנמכר יחד עם אחר) — הצע אוטומציה שמטפלת בו, גם אם המשתמש לא ביקש.
- אזהר אם כלל יתפוס יותר מדי לידים או אפס לידים.

## כללי בנייה:
- תנאי "ללא value" → value:"".
- לשעות השתמש ב-hours_* ; לימים ב-days_*.
- הוסף תנאי סטטוס מגביל כשזה מונע הפעלה חוזרת מיותרת (למשל status_is "חדש" לכלל שמעביר ל"בתהליך").
- אפשר לשלב כמה תנאים וכמה פעולות.

## פורמט התשובה — JSON בלבד, בלי markdown:
{"reply":"תשובתך למשתמש בעברית — הסבר קצר מה בנית/שינית + הצעה לשיפור אם רלוונטי","workflow":{"name":"","description":"","conditionLogic":"and","conditions":[{"type":"","value":""}],"actions":[{"type":"","config":{}}]}}

אם אתה רק עונה על שאלה ולא משנה את האוטומציה — שים workflow:null.
כשהמשתמש מבקש שיפור — החזר את האוטומציה **המלאה המעודכנת**, לא רק את השינוי.`;

      const convo = history.map(m => ({
        role: m.role,
        content: m.role === 'user' ? m.text : (m.text || '(בניתי אוטומציה)'),
      }));
      // The builder now sees the real pipeline, not just the vocabulary. An
      // automation is only sensible against actual data — how many leads a rule
      // would hit, which objections recur, which sources go cold.
      const { buildLeadContext } = await import('../lib/leadContext');
      const leadCtx = buildLeadContext(leads, text, { maxCompact: 400, maxFull: 4 });
      convo.push({ role: 'user', content: leadCtx.text });

      if (draft) {
        convo.push({
          role: 'user',
          content: `[מצב האוטומציה הנוכחית לעיונך: ${JSON.stringify(draft)}]`,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-sonnet-4-6', max_tokens: 2000, system, messages: convo,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}');
      const p = JSON.parse(a !== -1 && b !== -1 ? cleaned.slice(a, b + 1) : cleaned);

      let newDraft: DraftWorkflow | undefined;
      if (p.workflow && (p.workflow.conditions?.length || p.workflow.actions?.length)) {
        const validT = new Set(Object.keys(TRIGGER_LABELS));
        const validA = new Set(Object.keys(ACTION_LABELS));
        newDraft = {
          name: p.workflow.name || 'אוטומציה חדשה',
          description: p.workflow.description || '',
          conditionLogic: p.workflow.conditionLogic === 'or' ? 'or' : 'and',
          conditions: (p.workflow.conditions ?? [])
            .filter((c: { type: string }) => validT.has(c.type))
            .map((c: { type: TriggerType; value?: string }) => ({
              id: uid(), type: c.type,
              value: VALUELESS_TRIGGERS.includes(c.type) ? '' : String(c.value ?? ''),
            })),
          actions: (p.workflow.actions ?? [])
            .filter((x: { type: string }) => validA.has(x.type))
            .map((x: { type: WFActionType; config?: Record<string, string> }) => ({
              id: uid(), type: x.type, config: x.config ?? {},
            })),
        };
        if (newDraft.conditions.length || newDraft.actions.length) setDraft(newDraft);
        else newDraft = undefined;
      }

      appendMessage<ChatMsg>('automation', {
        role: 'assistant',
        text: p.reply || 'עדכנתי את האוטומציה.',
        draft: newDraft,
        matchCount: newDraft ? countMatches(newDraft) : undefined,
      });
    } catch (err) {
      console.error('[automation chat]', err);
      appendMessage<ChatMsg>('automation', { role: 'assistant', text: '⚠️ משהו השתבש. נסה לנסח שוב, או פרט קצת יותר מה תרצה שיקרה.' });
    } finally {
      setBusy(false);
    }
  };

  const send = () => void submitText(input);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
      clearSession('automation');   // saved — next open starts a fresh build
      onClose();
    } finally { setSaving(false); }
  };

  const matchCount = draft ? countMatches(draft) : 0;
  const hasManualOnly = draft?.actions.some(a => !SAFE_ACTIONS.includes(a.type));

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      {...backdropProps} onClick={backdropProps.onClick === undefined ? undefined : onClose}>
      <div dir="rtl" onClick={e => e.stopPropagation()} ref={panelProps.ref}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh', height: '92vh', ...panelProps.style }}>

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between flex-shrink-0"
          {...handleProps}
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)', ...handleProps.style }}>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="text-white/80 hover:text-white p-1"><X size={18} /></button>
            <button
              title="נקה שיחה והתחל מחדש"
              onClick={() => { clearSession('automation'); setInput(''); }}
              className="text-white/60 hover:text-white p-1"><RotateCcw size={15} /></button>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-white font-black text-sm">בונה האוטומציות החכם</div>
              <div className="text-indigo-200 text-[10px]">שוחח איתי ואבנה לך כל אוטומציה</div>
            </div>
            <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: '#f8fafc' }}>
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                {m.text}
                {m.draft && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-1.5">
                    <div className="font-bold text-[11px] text-violet-700">⚡ {m.draft.name}</div>
                    <div className="text-[11px] text-slate-500">
                      <span className="font-semibold">כאשר</span> ({m.draft.conditionLogic === 'and' ? 'כל התנאים' : 'אחד מהתנאים'}):
                    </div>
                    {m.draft.conditions.map(c => (
                      <div key={c.id} className="text-[11px] text-slate-600 pr-2">• {describeCondition(c)}</div>
                    ))}
                    <div className="text-[11px] text-slate-500 font-semibold">אז:</div>
                    {m.draft.actions.map(a => (
                      <div key={a.id} className="text-[11px] text-slate-600 pr-2">← {describeAction(a)}</div>
                    ))}
                    {typeof m.matchCount === 'number' && (
                      <div className="flex items-center gap-1 text-[11px] font-bold mt-1"
                        style={{ color: m.matchCount ? '#059669' : '#f59e0b' }}>
                        <Users size={11} /> {m.matchCount} לידים תואמים כרגע
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-end">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-violet-500" />
                <span className="text-xs text-slate-400">חושב ובונה...</span>
              </div>
            </div>
          )}
        </div>

        {/* Live draft bar */}
        {draft && (
          <div className="px-4 py-2.5 flex-shrink-0 border-t" style={{ background: '#faf5ff', borderColor: '#e9d5ff' }}>
            {hasManualOnly && (
              <p className="text-[10px] text-amber-600 mb-1.5 text-right">
                ⚠️ האוטומציה כוללת פעולת AI/Webhook — היא תרוץ רק בהפעלה ידנית או באישור, לא אוטומטית
              </p>
            )}
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                שמור והפעל
              </button>
              <button onClick={() => { setDraft(null); setMsgs(m => [...m, { role: 'assistant', text: 'ניקיתי את הטיוטה. נתחיל מחדש — מה תרצה שהאוטומציה תעשה?' }]); }}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white" title="נקה טיוטה">
                <RotateCcw size={13} />
              </button>
              <div className="flex-1 text-right">
                <span className="text-[11px] font-bold text-violet-700">{draft.name}</span>
                <span className="text-[10px] text-slate-400 mr-2">
                  {draft.conditions.length} תנאים · {draft.actions.length} פעולות · {matchCount} לידים
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="px-4 py-3 flex-shrink-0 border-t border-slate-200 bg-white">
          {msgs.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 justify-end mb-2">
              {[
                'אם תיעדתי פנייה — העבר ל"בתהליך"',
                'ליד שלא ענה 3 פעמים — צבע באדום',
                'ליד חם בלי משימות — פתח לי משימת שיחה',
                'ליד שלא עודכן 14 יום — סמן והוסף הערה',
              ].map(s => (
                <button key={s} onClick={() => setInput(s)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-600 hover:bg-violet-100">
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={voice.toggle}
              title={voice.active ? 'עצור שיחה קולית' : 'דבר עם RAY'}
              aria-pressed={voice.active}
              className="px-3 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
              style={voice.active
                ? { background: '#dc2626', color: '#fff' }
                : { background: 'rgba(0,0,0,0.06)', color: '#475569' }}>
              {voice.speaking ? <Volume2 size={16} />
                : voice.active ? <Square size={15} />
                : <Mic size={16} />}
            </button>
            <button onClick={send} disabled={busy || !input.trim()}
              className="px-4 rounded-xl text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)' }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
            <textarea
              value={input} onChange={e => setInput(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={draft ? 'מה עוד לשפר? למשל: "רק ללידים מפייסבוק"' : 'תאר מה תרצה שיקרה...'}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right resize-none focus:outline-none focus:ring-2 focus:ring-violet-200"
              style={{ maxHeight: 100 }}
            />
          </div>
          <p className="text-[10px] text-slate-400 text-right mt-1.5">
            <Zap size={9} className="inline" /> אפשר להמשיך לשוחח ולשפר — האוטומציה מתעדכנת בזמן אמת
          </p>
        </div>
      </div>
    </div>
  );
}
