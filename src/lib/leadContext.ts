/**
 * leadContext.ts — the single place that turns leads into something an agent
 * can reason over.
 *
 * All three copilots used to build their own, thinner view: the sales chat sent
 * derived signals with no notes or solutions, the marketing chat sent only
 * channel totals, and the automation builder saw nothing but the status/source
 * vocabulary. So each one gave advice while blind to most of the card.
 *
 * The shape here is deliberate:
 *
 *  • EVERY lead is sent, in a compact one-record form that still carries the
 *    things people actually reason about — status, source, solutions and their
 *    prices, objection, staleness, no-answer streak, note/activity counts. A
 *    strategy question ("which source stalls after the first call?") needs the
 *    whole population, not a top-20 sample.
 *
 *  • A SMALL set gets the full card — every note, every activity-log line,
 *    open tasks, meetings, custom fields. Chosen by relevance to what the user
 *    just asked, so naming a company pulls its history in automatically.
 *
 * That split is what keeps this affordable. Full cards for 300+ leads would be
 * enormous and mostly irrelevant; compact-only would make the agents guess.
 */

import type { Lead, Note, Task, LeadActivity, Solution } from '../types';

/* ── Dates ────────────────────────────────────────────────────────────────── */
function parseLoose(s?: string | number): number {
  if (s == null || s === '') return 0;
  const str = String(s).trim();
  if (/^\d{10,}$/.test(str)) return Number(str);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) { const t = Date.parse(str.slice(0, 10) + 'T00:00:00'); return isNaN(t) ? 0 : t; }
  const sep = str.includes('/') ? '/' : '.';
  const p = str.split(sep);
  if (p.length !== 3) { const t = Date.parse(str); return isNaN(t) ? 0 : t; }
  const [d, m, yR] = p.map(Number);
  if (!d || !m || !yR) return 0;
  const t = new Date(yR < 100 ? 2000 + yR : yR, m - 1, d).getTime();
  return isNaN(t) ? 0 : t;
}
const daysAgo = (s?: string | number) => { const t = parseLoose(s); return t ? Math.floor((Date.now() - t) / 86400000) : -1; };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ── Compact record — one per lead, for the whole population ───────────────── */
export interface CompactLead {
  id: string;
  company: string;
  contact: string;
  status: string;
  source: string;
  owner: string;
  budget: number;
  score: number;
  hot: boolean;
  flag: string | null;
  /** name[state,price] — enough to reason about what was sold and for how much. */
  solutions: string[];
  monthlyValue: number;
  oneTimeValue: number;
  daysSinceUpdate: number;
  daysSinceContact: number;
  everContacted: boolean;
  noAnswer: number;
  objection: string | null;
  contactMethod: string | null;
  followUpInDays: number | null;
  openTasks: number;
  overdueTasks: number;
  notesCount: number;
  activityCount: number;
  lastNote: string | null;
  lastActivity: string | null;
  custom: Record<string, string> | null;
  /** Campaign attribution, when the lead came through a tracked form. */
  campaign: string | null;
}

function solutionLine(s: Solution): string {
  const state = s.delivered ? 'הושלם' : s.inProgress ? 'בתהליך' : 'לא התחיל';
  return s.price
    ? `${s.name}[${state},₪${s.price}${s.priceType === 'one_time' ? ' חד"פ' : '/חודש'}]`
    : `${s.name}[${state}]`;
}

export function compactLead(l: Lead): CompactLead {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tasks = arr<Task>(l.tasks).filter(t => !t.completed);
  const notes = arr<Note>(l.notes);
  const acts = arr<LeadActivity>(l.activityLog);
  const sols = arr<Solution>(l.solutions);
  const custom = l.customFields && Object.keys(l.customFields).length
    ? Object.fromEntries(Object.entries(l.customFields).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : String(v)]))
    : null;

  return {
    id: l.id,
    company: clip(l.company, 60),
    contact: clip(l.contactName, 40),
    status: String(l.status ?? ''),
    source: String(l.source ?? ''),
    owner: clip(l.assignedTo, 30),
    budget: Number(l.budget) || 0,
    score: Number(l.aiScore) || 0,
    hot: Boolean(l.isHot),
    flag: l.flagColor ? (l.flagReason || 'מסומן') : null,
    solutions: sols.map(solutionLine),
    monthlyValue: sols.filter(s => s.priceType !== 'one_time').reduce((a, s) => a + (Number(s.price) || 0), 0),
    oneTimeValue: sols.filter(s => s.priceType === 'one_time').reduce((a, s) => a + (Number(s.price) || 0), 0),
    daysSinceUpdate: daysAgo(l.lastUpdate),
    daysSinceContact: l.lastContactDate ? daysAgo(l.lastContactDate) : -1,
    everContacted: Boolean(l.lastContactDate),
    noAnswer: Number(l.noAnswerCount) || 0,
    objection: l.objection ?? null,
    contactMethod: l.contactMethod ?? null,
    followUpInDays: l.nextFollowUpDate
      ? Math.round((Date.parse(l.nextFollowUpDate) - Date.now()) / 86400000)
      : null,
    openTasks: tasks.length,
    overdueTasks: tasks.filter(t => parseLoose(t.date) && parseLoose(t.date) < today.getTime()).length,
    notesCount: notes.length,
    activityCount: acts.length,
    lastNote: notes.length ? clip(notes[notes.length - 1]?.text, 140) : null,
    lastActivity: acts.length ? clip(acts[acts.length - 1]?.content, 100) : null,
    custom,
    campaign: [l.utmCampaign, l.utmSource, l.utmMedium].filter(Boolean).join(' / ') || null,
  };
}

/* ── Full card — the entire history, for a handful of leads ────────────────── */
export function fullCard(l: Lead): string {
  const out: string[] = [];
  const c = compactLead(l);
  out.push(`### ${c.company} (id: ${c.id})`);
  out.push(`איש קשר: ${c.contact}${l.phone ? ` · ${l.phone}` : ''}${l.email ? ` · ${l.email}` : ''}`);
  out.push(`סטטוס: ${c.status} · מקור: ${c.source} · אחראי: ${c.owner || '—'} · תקציב: ₪${c.budget} · ציון: ${c.score}${c.hot ? ' · 🔥חם' : ''}`);
  if (c.flag) out.push(`סימון: ${c.flag}`);
  if (c.solutions.length) out.push(`פתרונות: ${c.solutions.join(' | ')} (חודשי ₪${c.monthlyValue}, חד"פ ₪${c.oneTimeValue})`);
  out.push(`עודכן לפני ${c.daysSinceUpdate} ימים · ${c.everContacted ? `פנייה אחרונה לפני ${c.daysSinceContact} ימים (${c.contactMethod ?? '—'})` : 'מעולם לא נוצר קשר'} · ללא מענה: ${c.noAnswer}`);
  if (c.objection) out.push(`התנגדות: ${c.objection}`);
  if (c.followUpInDays !== null) out.push(`מעקב הבא: בעוד ${c.followUpInDays} ימים${l.followUpNote ? ` — ${clip(l.followUpNote, 120)}` : ''}`);
  if (c.campaign) out.push(`ייחוס קמפיין: ${c.campaign}${l.landingPage ? ` · דף נחיתה: ${clip(l.landingPage, 90)}` : ''}`);
  if (c.custom) out.push(`שדות מותאמים: ${Object.entries(c.custom).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  const notes = arr<Note>(l.notes);
  if (notes.length) {
    out.push(`הערות (${notes.length}):`);
    notes.slice(-12).forEach(n => out.push(`  · [${clip(n.timestamp, 10)}] ${clip(n.text, 260)}`));
  }
  const acts = arr<LeadActivity>(l.activityLog);
  if (acts.length) {
    out.push(`יומן פעילות (${acts.length}):`);
    acts.slice(-15).forEach(a => out.push(`  · [${clip(a.timestamp, 10)}] ${a.type}: ${clip(a.content, 180)}`));
  }
  const tasks = arr<Task>(l.tasks).filter(t => !t.completed);
  if (tasks.length) {
    out.push(`משימות פתוחות (${tasks.length}):`);
    tasks.slice(0, 8).forEach(t => out.push(`  · ${clip(t.date, 10)} [${t.priority}] ${clip(t.description, 140)}`));
  }
  return out.join('\n');
}

/* ── Relevance ────────────────────────────────────────────────────────────── */
/** Generic "needs attention" weight, used when the question names nobody. */
function urgency(c: CompactLead): number {
  return (c.overdueTasks ? 40 : 0)
    + (c.followUpInDays !== null && c.followUpInDays < 0 ? 35 : 0)
    + (c.hot ? 30 : 0)
    + c.noAnswer * 8
    + (!c.everContacted ? 20 : 0)
    + Math.min(Math.max(c.daysSinceUpdate, 0), 60) / 2
    + c.score / 10
    + (c.budget > 0 ? 5 : 0);
}

/** Leads whose company or contact name appears in the user's message. */
function mentioned(leads: Lead[], text: string): Lead[] {
  const t = (text || '').toLowerCase();
  if (t.length < 2) return [];
  return leads.filter(l => {
    const co = String(l.company ?? '').toLowerCase().trim();
    const nm = String(l.contactName ?? '').toLowerCase().trim();
    return (co.length > 2 && t.includes(co)) || (nm.length > 2 && t.includes(nm));
  });
}

export interface LeadContext {
  /** Ready to drop into a prompt. */
  text: string;
  compactCount: number;
  fullCount: number;
}

/**
 * Build the lead block for a prompt.
 *
 * @param question  what the user just asked — drives which cards get expanded
 * @param maxCompact hard cap on records, so a huge pipeline can't blow the request
 * @param maxFull    how many cards get their full history
 */
export function buildLeadContext(
  leads: Lead[],
  question: string,
  { maxCompact = 400, maxFull = 6 }: { maxCompact?: number; maxFull?: number } = {},
): LeadContext {
  const compact = leads.map(compactLead);

  // Expand what the question points at; otherwise what most needs attention.
  const named = mentioned(leads, question);
  const byUrgency = [...leads].sort((a, b) => urgency(compactLead(b)) - urgency(compactLead(a)));
  const pickedIds = new Set<string>();
  const picked: Lead[] = [];
  for (const l of [...named, ...byUrgency]) {
    if (picked.length >= maxFull) break;
    if (pickedIds.has(l.id)) continue;
    pickedIds.add(l.id);
    picked.push(l);
  }

  // Compact list: keep the expanded ones plus the most relevant remainder.
  const rest = compact
    .filter(c => !pickedIds.has(c.id))
    .sort((a, b) => urgency(b) - urgency(a))
    .slice(0, Math.max(0, maxCompact - picked.length));
  const compactSet = [...compact.filter(c => pickedIds.has(c.id)), ...rest];

  // Drop empty fields before serialising. Most leads carry no solutions, notes
  // or objection, and repeating `"objection":null` 340 times tripled the request
  // for no information. Absent === empty, and the prompt says so.
  const sparse = (o: CompactLead) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      if (v === false) continue;
      if (v === 0 && k !== 'daysSinceUpdate' && k !== 'daysSinceContact') continue;
      out[k] = v;
    }
    return out;
  };

  const parts: string[] = [];
  parts.push(
    `## כל הלידים (${compactSet.length} מתוך ${leads.length})\n`
    + 'JSON, רשומה לכל ליד. שדות: status, source, owner, budget, score, hot, flag, solutions '
    + '(שם[מצב,מחיר]), monthlyValue/oneTimeValue, daysSinceUpdate, daysSinceContact (-1 = מעולם), '
    + 'everContacted, noAnswer, objection, contactMethod, followUpInDays (שלילי = באיחור), '
    + 'openTasks/overdueTasks, notesCount/activityCount, lastNote, lastActivity, custom.\n'
    + JSON.stringify(compactSet.map(sparse)),
  );
  if (picked.length) {
    parts.push(
      `\n## כרטיסים מלאים (${picked.length}) — כולל כל ההערות ויומן הפעילות\n`
      + picked.map(fullCard).join('\n\n'),
    );
  }

  return { text: parts.join('\n'), compactCount: compactSet.length, fullCount: picked.length };
}
