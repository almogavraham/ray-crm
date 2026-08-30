/**
 * TasksAIPanel.tsx — the AI layer for the Tasks page.
 *
 *  1. Natural-language task creation: "תתקשר לדוד מחר ב-10" → a structured task,
 *     auto-linked to the matching lead.
 *  2. AI morning briefing: a concise, prioritized rundown of what to do today,
 *     what's overdue, and which deals are at risk.
 *
 * Reuses getAnthropicProxy (Claude) and the existing StandaloneTask model.
 */

import { useState } from 'react';
import { Sparkles, Send, Loader2, Sun, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { Lead, StandaloneTask, TaskPriority } from '../types';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface AiTaskLite {
  description: string;
  date: string;        // ISO yyyy-mm-dd
  priority: TaskPriority;
  completed: boolean;
  leadCompany?: string;
}

interface Props {
  leads: Lead[];
  openTasks: AiTaskLite[];   // today + overdue open tasks, for the briefing
  currentUser: string;
  onCreateTask: (task: StandaloneTask) => void;
  onToast?: ToastFn;
}

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default function TasksAIPanel({ leads, openTasks, currentUser, onCreateTask, onToast }: Props) {
  const { c: tc, isDark } = useTheme();

  const [nlText, setNlText]       = useState('');
  const [creating, setCreating]   = useState(false);
  const [briefing, setBriefing]   = useState<string>('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [plan, setPlan]           = useState<string>('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planOpen, setPlanOpen]   = useState(false);

  /* ── Natural-language → structured task ─────────────────────────────────── */
  const handleCreate = async () => {
    const text = nlText.trim();
    if (!text) return;
    setCreating(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const dow = now.toLocaleDateString('he-IL', { weekday: 'long' });
      const leadNames = leads.slice(0, 200).map(l => l.company || l.contactName).filter(Boolean);

      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `אתה ממיר משפט בעברית למשימת מכירה מובנית. היום הוא ${todayIso} (${dow}). המר ביטויי זמן ("מחר", "ביום ראשון", "בעוד שבוע") לתאריך מוחלט. החזר אך ורק JSON תקין במבנה:
{"description":"תיאור המשימה הנקי","date":"YYYY-MM-DD","time":"HH:MM","priority":"high|medium|low","leadName":"שם החברה/הלקוח שהוזכר או null"}
אם לא צוינה שעה, השתמש ב-"09:00". אם לא צוינה עדיפות, קבע לפי דחיפות ("דחוף"→high). החזר JSON בלבד.`,
        messages: [{ role: 'user', content: `המשפט: "${text}"\n${leadNames.length ? `רשימת לקוחות אפשריים לזיהוי: ${leadNames.join(', ')}` : ''}` }],
      });

      const raw = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text ?? '';
      const jsonStr = raw.replace(/```json\s*/i, '').replace(/```/g, '').trim();
      const first = jsonStr.indexOf('{'), last = jsonStr.lastIndexOf('}');
      const parsed = JSON.parse(first !== -1 ? jsonStr.slice(first, last + 1) : jsonStr) as {
        description?: string; date?: string; time?: string; priority?: TaskPriority; leadName?: string | null;
      };

      const description = (parsed.description || text).trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date! : todayIso;
      const time = /^\d{2}:\d{2}$/.test(parsed.time || '') ? parsed.time! : '09:00';
      const priority: TaskPriority = ['high', 'medium', 'low'].includes(parsed.priority as string) ? parsed.priority! : 'medium';

      // Match a lead by the mentioned name
      let leadId: string | undefined;
      if (parsed.leadName) {
        const target = norm(parsed.leadName);
        const match = leads.find(l => norm(l.company).includes(target) || norm(l.contactName).includes(target) || target.includes(norm(l.company)));
        if (match) leadId = match.id;
      }

      const task: StandaloneTask = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description,
        date,
        time,
        priority,
        completed: false,
        assignedTo: currentUser || '',
        assignedBy: currentUser || '',
        createdAt: new Date().toISOString(),
        kanbanStatus: 'todo',
        ...(leadId ? { leadId } : {}),
      };
      onCreateTask(task);
      setNlText('');
      onToast?.(leadId ? '✅ משימה נוצרה וקושרה ללקוח' : '✅ משימה נוצרה', 'success');
    } catch (err) {
      console.error('[ai task]', err);
      onToast?.('לא הצלחתי להבין את המשימה — נסה לנסח אחרת', 'error');
    } finally {
      setCreating(false);
    }
  };

  /* ── AI morning briefing ────────────────────────────────────────────────── */
  const handleBriefing = async () => {
    setBriefingLoading(true);
    setBriefOpen(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();

      const lines = openTasks.slice(0, 50).map(t =>
        `- [${t.priority}] ${t.description}${t.leadCompany ? ` (${t.leadCompany})` : ''} — ${t.date}`
      ).join('\n');
      const todayIso = new Date().toISOString().slice(0, 10);

      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: `אתה מנהל מכירות ותיק שנותן תדרוך בוקר קצר וממוקד לנציג. היום ${todayIso}. קבל רשימת משימות פתוחות (כולל איחורים) ותן: (1) שורת פתיחה אנרגטית קצרה, (2) 3 העדיפויות המובילות להיום לפי דחיפות והשפעה על הכנסות, (3) אזהרה על מה שנופל/מתעכב אם יש. תמציתי, בעברית, בפורמט בולטים קצרים. בלי הקדמות מיותרות.`,
        messages: [{ role: 'user', content: lines || 'אין משימות פתוחות כרגע.' }],
      });
      const text = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text?.trim() ?? '';
      setBriefing(text || 'אין מספיק נתונים לתדרוך.');
    } catch (err) {
      console.error('[ai briefing]', err);
      setBriefing('שגיאה בהפקת התדרוך — נסה שוב.');
    } finally {
      setBriefingLoading(false);
    }
  };

  /* ── AI "plan my day" (time-blocked) ────────────────────────────────────── */
  const handlePlanDay = async () => {
    setPlanLoading(true);
    setPlanOpen(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();
      const todayIso = new Date().toISOString().slice(0, 10);
      const lines = openTasks
        .filter(t => t.date <= todayIso)   // today + overdue
        .slice(0, 30)
        .map(t => `- [${t.priority}] ${t.description}${t.leadCompany ? ` (${t.leadCompany})` : ''}`)
        .join('\n');
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: `אתה מאמן פרודוקטיביות למכירות. בנה תוכנית יום מתוזמנת (time-blocking) מהמשימות של היום. סדר לפי דחיפות והיגיון (שיחות בשעות טובות להתקשרות, אדמין בסוף). פורמט: שורות של "🕐 09:00 — משימה". קצר, בעברית, בלי הקדמות.`,
        messages: [{ role: 'user', content: lines || 'אין משימות להיום.' }],
      });
      const text = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text?.trim() ?? '';
      setPlan(text || 'אין משימות לתכנן היום.');
    } catch (err) {
      console.error('[ai plan]', err);
      setPlan('שגיאה בבניית התוכנית — נסה שוב.');
    } finally {
      setPlanLoading(false);
    }
  };

  const card = { background: isDark ? 'rgba(255,255,255,0.03)' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}` };

  return (
    <div className="rounded-2xl overflow-hidden" style={card} dir="rtl">
      {/* Header strip */}
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
        <Sparkles size={16} className="text-white" />
        <span className="text-sm font-black text-white">עוזר המשימות החכם</span>
      </div>

      <div className="p-3 sm:p-4 space-y-3">
        {/* NL input */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Wand2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400" />
            <input
              value={nlText}
              onChange={e => setNlText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !creating && handleCreate()}
              placeholder="כתוב משימה חופשי: תתקשר לדוד מחר ב-10 — דחוף"
              className="w-full rounded-xl pr-9 pl-3 py-2.5 text-sm outline-none"
              style={{ background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: tc.textPrimary }}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !nlText.trim()}
            className="px-4 py-2.5 rounded-xl text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)' }}
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            הוסף
          </button>
        </div>

        {/* Briefing */}
        <div>
          <button
            onClick={briefing && !briefingLoading ? () => setBriefOpen(o => !o) : handleBriefing}
            disabled={briefingLoading}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
          >
            <span className="flex items-center gap-2">
              <Sun size={15} />
              {briefingLoading ? 'מכין תדרוך בוקר...' : briefing ? 'תדרוך בוקר AI' : 'הפק תדרוך בוקר AI'}
            </span>
            {briefingLoading ? <Loader2 size={14} className="animate-spin" /> : briefing ? (briefOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />) : null}
          </button>

          {briefOpen && briefing && (
            <div className="mt-2 rounded-xl p-3 text-sm whitespace-pre-wrap leading-relaxed"
              style={{ background: isDark ? 'rgba(0,0,0,0.2)' : '#f8fafc', color: tc.textPrimary, border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              {briefing}
            </div>
          )}
        </div>

        {/* Plan my day */}
        <div>
          <button
            onClick={plan && !planLoading ? () => setPlanOpen(o => !o) : handlePlanDay}
            disabled={planLoading}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)', color: '#6366f1' }}
          >
            <span className="flex items-center gap-2">
              <Sparkles size={15} />
              {planLoading ? 'בונה תוכנית יום...' : plan ? 'תוכנית היום שלי' : 'סדר לי את היום'}
            </span>
            {planLoading ? <Loader2 size={14} className="animate-spin" /> : plan ? (planOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />) : null}
          </button>

          {planOpen && plan && (
            <div className="mt-2 rounded-xl p-3 text-sm whitespace-pre-wrap leading-relaxed"
              style={{ background: isDark ? 'rgba(0,0,0,0.2)' : '#f8fafc', color: tc.textPrimary, border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              {plan}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
