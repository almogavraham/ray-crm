/**
 * leadsExport.ts — full-fidelity Excel export of the leads table.
 *
 * The old export was an 8-column CSV, which silently dropped the two things
 * people actually need when they take the data elsewhere: the notes history and
 * the per-lead solutions with their prices. A single flat sheet can't hold
 * those without either truncating them or exploding one lead into many rows, so
 * the workbook is split:
 *
 *   לידים    — one row per lead, every scalar field, plus readable summaries
 *              of solutions and notes so this sheet alone is usable.
 *   הערות    — one row per note, full text, never truncated.
 *   פתרונות  — one row per solution, with status and price.
 *
 * Every child row repeats the lead's id + company so the sheets can be joined
 * (VLOOKUP / pivot) without needing the app.
 */

import type { Lead, Note, Solution } from '../types';

const str = (v: unknown) => (v == null ? '' : String(v));
/**
 * Collapse newlines for the summary column. The community build of SheetJS
 * cannot emit cell styles, so `wrapText` is unavailable and an embedded
 * newline renders as one long line anyway. The dedicated notes sheet keeps
 * the original text, one note per row.
 */
const oneLine = (v: unknown) => str(v).replace(/[\r\n]+/g, ' ⏎ ').replace(/\s{2,}/g, ' ').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** he-IL dates arrive in several shapes; normalise for sorting/reading. */
function readableDate(v?: string | number): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) {
    const d = new Date(Number(v));
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL');
  }
  const s = String(v);
  const t = Date.parse(s);
  if (!isNaN(t) && /^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(t).toLocaleDateString('he-IL');
  return s;   // already a display string like "24.8.2026"
}

function solutionLabel(s: Solution): string {
  const state = s.delivered ? 'הושלם' : s.inProgress ? 'בתהליך' : 'לא התחיל';
  const price = s.price
    ? ` — ₪${num(s.price).toLocaleString('he-IL')}${s.priceType === 'one_time' ? ' (חד־פעמי)' : ' (חודשי)'}`
    : '';
  return `${str(s.name)} [${state}]${price}`;
}

export interface ExportResult { fileName: string; leads: number; notes: number; solutions: number }

/**
 * Build and download the workbook. `xlsx` is imported lazily so the ~400 KB
 * library never lands in the initial bundle for users who don't export.
 */
export async function exportLeadsToExcel(
  leads: Lead[],
  opts: { workspaceName?: string } = {},
): Promise<ExportResult> {
  const XLSX = await import('xlsx');

  /* ── Sheet 1: לידים ─────────────────────────────────────────────────────── */
  const leadRows = leads.map(l => {
    const solutions = Array.isArray(l.solutions) ? l.solutions : [];
    const notes = Array.isArray(l.notes) ? (l.notes as Note[]) : [];
    const recurring = solutions
      .filter(s => s.priceType !== 'one_time').reduce((a, s) => a + num(s.price), 0);
    const oneTime = solutions
      .filter(s => s.priceType === 'one_time').reduce((a, s) => a + num(s.price), 0);

    return {
      'מזהה':            str(l.id),
      'חברה':            str(l.company),
      'איש קשר':         str(l.contactName),
      'טלפון':           str(l.phone),
      'מייל':            str(l.email),
      'סטטוס':           str(l.status),
      'תקציב':           num(l.budget),
      'מקור':            str(l.source),
      'אחראי':           str(l.assignedTo),
      'ציון AI':         num(l.aiScore),
      'ליד חם':          l.isHot ? 'כן' : '',
      'סימון':           str(l.flagReason || l.flagColor),
      'עדכון אחרון':     readableDate(l.lastUpdate),
      'נוצר':            readableDate(l.createdAt),
      'פנייה אחרונה':    readableDate(l.lastContactDate),
      'אמצעי פנייה':     str(l.contactMethod),
      'מעקב הבא':        readableDate(l.nextFollowUpDate),
      'הערת מעקב':       str(l.followUpNote),
      'ללא מענה (פעמים)': num(l.noAnswerCount),
      'התנגדות':         str(l.objection),
      'ממתין לתוכן':     l.waitingContent ? 'כן' : '',
      'מס׳ פתרונות':     solutions.length,
      'פתרונות':         solutions.map(solutionLabel).join(' | '),
      'סה״כ חודשי':      recurring,
      'סה״כ חד־פעמי':    oneTime,
      'מס׳ הערות':       notes.length,
      'הערות':           notes.map(n => `[${readableDate(n.timestamp)}${n.author ? ` ${n.author}` : ''}] ${oneLine(n.text)}`).join('  |  '),
      'משימות פתוחות':   (l.tasks ?? []).filter(t => !t.completed).length,
    };
  });

  /* ── Sheet 2: הערות — one row each, full text ───────────────────────────── */
  const noteRows: Record<string, string | number>[] = [];
  for (const l of leads) {
    for (const n of (Array.isArray(l.notes) ? (l.notes as Note[]) : [])) {
      noteRows.push({
        'מזהה ליד': str(l.id),
        'חברה':     str(l.company),
        'איש קשר':  str(l.contactName),
        'סטטוס':    str(l.status),
        'תאריך':    readableDate(n.timestamp),
        'נכתב ע״י': str(n.author),
        'הערה':     str(n.text),
      });
    }
  }

  /* ── Sheet 3: פתרונות — one row each, with price ────────────────────────── */
  const solutionRows: Record<string, string | number>[] = [];
  for (const l of leads) {
    for (const s of (Array.isArray(l.solutions) ? l.solutions : [])) {
      solutionRows.push({
        'מזהה ליד':  str(l.id),
        'חברה':      str(l.company),
        'סטטוס ליד': str(l.status),
        'פתרון':     str(s.name),
        'מצב':       s.delivered ? 'הושלם' : s.inProgress ? 'בתהליך' : 'לא התחיל',
        'מחיר':      num(s.price),
        'סוג חיוב':  s.priceType === 'one_time' ? 'חד־פעמי' : 'חודשי',
      });
    }
  }

  /* ── Assemble ───────────────────────────────────────────────────────────── */
  const wb = XLSX.utils.book_new();
  // Open the whole workbook right-to-left. NOTE: the per-sheet `ws['!views']`
  // RTL hint is silently dropped by this writer — the workbook-level view below
  // is what actually reaches the file, so don't 'simplify' it away.
  wb.Workbook = { ...(wb.Workbook ?? {}), Views: [{ RTL: true }] };

  const addSheet = (name: string, rows: Record<string, unknown>[], widths: number[], empty: string) => {
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([[empty]]);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    // Hebrew workbook — open every sheet right-to-left.
    ws['!views'] = [{ RTL: true }];
    if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] as string };
    ws['!freeze'] = { xSplit: '0', ySplit: '1' };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet('לידים', leadRows,
    [22, 22, 18, 14, 26, 14, 10, 14, 14, 8, 8, 16, 14, 14, 14, 12, 14, 24, 10, 14, 10, 10, 46, 12, 12, 10, 60, 10],
    'אין לידים');
  addSheet('הערות', noteRows, [22, 22, 18, 14, 14, 14, 80], 'אין הערות');
  addSheet('פתרונות', solutionRows, [22, 22, 14, 28, 12, 12, 12], 'אין פתרונות');

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (opts.workspaceName || 'RAY').replace(/[\\/:*?"<>|]/g, '').trim() || 'RAY';
  const fileName = `${slug}-leads-${stamp}.xlsx`;

  XLSX.writeFile(wb, fileName, { compression: true });

  return { fileName, leads: leadRows.length, notes: noteRows.length, solutions: solutionRows.length };
}
