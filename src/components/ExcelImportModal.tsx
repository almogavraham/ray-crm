/**
 * ExcelImportModal — v2
 * Robust Excel / CSV import with smart column detection and graceful fallbacks.
 * Fixes: narrow patterns, "company-required" block, empty-row skipping.
 */
import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  ChevronLeft, RefreshCw, Download, Info, Sparkles,
} from 'lucide-react';
import type { Lead, LeadStatus, LeadSource } from '../types';

/* ── Types ──────────────────────────────────────────────────────────────── */
type MappableField = 'company' | 'contactName' | 'phone' | 'email' | 'budget' | 'status' | 'source' | 'notes' | 'skip';

/* ── Much wider pattern lists ────────────────────────────────────────────── */
const FIELD_PATTERNS: Record<Exclude<MappableField, 'skip'>, string[]> = {
  company: [
    // Hebrew
    'חברה', 'שם חברה', 'שם העסק', 'עסק', 'שם עסק', 'שם', 'לקוח',
    'שם לקוח', 'שם ליד', 'ליד', 'ארגון', 'גוף', 'חברת',
    // English
    'company', 'company name', 'organization', 'organisation', 'org',
    'business', 'client', 'account', 'lead', 'prospect', 'name', 'firm',
  ],
  contactName: [
    // Hebrew
    'שם איש קשר', 'איש קשר', 'שם פרטי', 'שם מלא', 'שם + שם משפחה',
    'שם ושם משפחה', 'שם פרטי ושם משפחה', 'נציג', 'איש',
    // English
    'contact', 'contact name', 'full name', 'fullname', 'person',
    'first name', 'last name', 'firstname', 'lastname', 'rep',
  ],
  phone: [
    // Hebrew
    'טלפון', 'נייד', 'פלאפון', 'סלולרי', 'מספר טלפון', 'טל', 'טל׳',
    'מספר נייד', 'טלפון נייד', 'טלפון קווי',
    // English
    'phone', 'mobile', 'tel', 'cell', 'telephone', 'phone number',
    'mobile number', 'cell phone', 'cellphone',
  ],
  email: [
    // Hebrew
    'אימייל', 'מייל', 'דוא"ל', 'דואל', 'כתובת מייל', 'כתובת אימייל',
    'דואר אלקטרוני', 'אי מייל',
    // English
    'email', 'e-mail', 'mail', 'email address', 'e mail',
  ],
  budget: [
    // Hebrew
    'תקציב', 'תקציב חודשי', 'סכום', 'מחיר', 'ערך', 'ערך עסקה',
    'שווי', 'הצעת מחיר', 'הצעה', 'כמות', 'עלות', 'הכנסה',
    // English
    'budget', 'amount', 'value', 'price', 'revenue', 'deal value',
    'deal size', 'cost', 'quote', 'estimate',
  ],
  status: [
    // Hebrew
    'סטטוס', 'מצב', 'שלב', 'סטטוס ליד', 'מצב ליד',
    // English
    'status', 'state', 'stage', 'phase', 'lead status', 'lead stage',
  ],
  source: [
    // Hebrew
    'מקור', 'ערוץ', 'מקור ליד', 'ממי', 'איך הגיע',
    // English
    'source', 'channel', 'origin', 'medium', 'lead source', 'referral',
  ],
  notes: [
    // Hebrew
    'הערות', 'הערה', 'תיאור', 'פרטים', 'מידע נוסף', 'הערות נוספות',
    'תגובה', 'תוכן', 'פרטים נוספים', 'הסבר', 'בקשה', 'דרישות',
    // English
    'notes', 'note', 'description', 'comment', 'comments', 'details',
    'info', 'additional info', 'remarks', 'message', 'requirements',
  ],
};

const FIELD_LABELS: Record<MappableField, string> = {
  company:     '🏢 שם חברה / ליד *',
  contactName: '👤 שם איש קשר',
  phone:       '📞 טלפון',
  email:       '✉️ אימייל',
  budget:      '💰 תקציב',
  status:      '📊 סטטוס',
  source:      '🔗 מקור',
  notes:       '📝 הערות',
  skip:        '— דלג —',
};

const VALID_STATUSES: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
const VALID_SOURCES:  LeadSource[]  = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function autoDetect(header: string): MappableField {
  const h = header.trim().toLowerCase().replace(/['"״]/g, '');
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as [Exclude<MappableField,'skip'>, string[]][]) {
    if (patterns.some(p => h === p.toLowerCase() || h.includes(p.toLowerCase()))) return field;
  }
  return 'skip';
}

function normalizeStatus(raw: string): LeadStatus {
  const r = raw.trim();
  if (VALID_STATUSES.includes(r as LeadStatus)) return r as LeadStatus;
  // Fuzzy match
  if (/חדש|new|lead/i.test(r))    return 'חדש';
  if (/תהליך|process|active/i.test(r)) return 'בתהליך';
  if (/פעיל|client|customer/i.test(r)) return 'לקוח פעיל';
  return 'חדש';
}

function normalizeSource(raw: string): LeadSource {
  const r = raw.trim().toLowerCase();
  if (/אורגני|organic|seo/i.test(r))           return 'אורגני';
  if (/ממומן|paid|ads|ppc|google ads/i.test(r)) return 'פרסום ממומן';
  if (/הפניה|referral|referal|recommend/i.test(r)) return 'הפניה';
  if (/insta|אינסטגרם/i.test(r))               return 'אינסטגרם';
  if (/facebook|פייסבוק|fb/i.test(r))           return 'פייסבוק';
  if (/google|גוגל/i.test(r))                   return 'גוגל';
  if (VALID_SOURCES.includes(r as LeadSource))  return r as LeadSource;
  return 'אורגני';
}

/** Try to find the actual header row (skip empty leading rows) */
function findHeaderRow(all: string[][]): { headerIdx: number; headers: string[] } {
  for (let i = 0; i < Math.min(5, all.length); i++) {
    const row = all[i].map(c => String(c ?? '').trim());
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length >= 2) {
      return { headerIdx: i, headers: row };
    }
  }
  // Fallback: generate generic headers
  const cols = all[0]?.length ?? 0;
  return { headerIdx: 0, headers: Array.from({ length: cols }, (_, i) => `עמודה ${i + 1}`) };
}

/* ── Props ──────────────────────────────────────────────────────────────── */
interface Props {
  onImport: (leads: Lead[]) => void;
  onClose:  () => void;
  currentUser?: string;
}

/* ── Component ───────────────────────────────────────────────────────────── */
export default function ExcelImportModal({ onImport, onClose, currentUser }: Props) {
  const [step,      setStep]      = useState<'upload' | 'map' | 'importing' | 'done'>('upload');
  const [headers,   setHeaders]   = useState<string[]>([]);
  const [rows,      setRows]      = useState<string[][]>([]);
  const [mapping,   setMapping]   = useState<Record<string, MappableField>>({});
  const [imported,  setImported]  = useState(0);
  const [skipped,   setSkipped]   = useState(0);
  const [error,     setError]     = useState('');
  const [dragging,  setDragging]  = useState(false);
  const [fileName,  setFileName]  = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── File parsing ───────────────────────────────────────────────────────── */
  const parseFile = useCallback((file: File) => {
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array', cellText: true, cellDates: true });
        const ws   = wb.Sheets[wb.SheetNames[0]];

        // Get all rows as string arrays
        const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
          .map(r => (r as unknown[]).map(c => String(c ?? '').trim())) as string[][];

        if (all.length === 0) { setError('הקובץ ריק'); return; }

        // Find the real header row
        const { headerIdx, headers: hdrs } = findHeaderRow(all);

        const dataRows = all
          .slice(headerIdx + 1)
          .filter(r => r.some(c => c.trim().length > 0)); // skip blank rows

        if (dataRows.length === 0) {
          setError('לא נמצאו שורות נתונים בקובץ. ודא שהקובץ מכיל לפחות שורת כותרות + שורת נתונים.');
          return;
        }

        // Auto-detect column mapping
        const initMap: Record<string, MappableField> = {};
        hdrs.forEach(h => { initMap[h] = autoDetect(h); });

        // Smart fallback: if nothing maps to 'company', map first non-empty column
        const hasCompany = Object.values(initMap).includes('company');
        if (!hasCompany) {
          const firstNonSkip = hdrs.find(h => initMap[h] !== 'skip') ?? hdrs[0];
          if (firstNonSkip) initMap[firstNonSkip] = 'company';
        }

        setHeaders(hdrs);
        setRows(dataRows);
        setMapping(initMap);
        setStep('map');
      } catch (err) {
        console.error('Excel parse error:', err);
        setError('שגיאה בקריאת הקובץ — ודא שזה קובץ Excel תקני (.xlsx / .xls / .csv)');
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  };

  /* ── Import ─────────────────────────────────────────────────────────────── */
  const doImport = async () => {
    setStep('importing');

    const today = new Date().toLocaleDateString('he-IL');
    const leads: Lead[] = [];
    let skip = 0;

    // Find company header — with fallback to first column
    const companyHeader =
      Object.entries(mapping).find(([, v]) => v === 'company')?.[0] ??
      headers[0]; // always fallback to first column

    const get = (field: MappableField, row: string[]) => {
      const hdr = Object.entries(mapping).find(([, v]) => v === field)?.[0];
      if (!hdr) return '';
      const idx = headers.indexOf(hdr);
      return idx >= 0 ? (row[idx] ?? '').trim() : '';
    };

    for (const row of rows) {
      const companyIdx = headers.indexOf(companyHeader);
      const company = companyIdx >= 0 ? (row[companyIdx] ?? '').trim() : '';

      if (!company) { skip++; continue; }

      const rawBudget = get('budget', row).replace(/[^\d.]/g, '');
      const budget    = rawBudget ? parseFloat(rawBudget) || 0 : 0;

      const statusRaw = get('status', row);
      const sourceRaw = get('source', row);
      const notesRaw  = get('notes', row);

      // Build initial notes array from the notes column
      const initialNotes = notesRaw.trim()
        ? [{
            id:        `note_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            text:      notesRaw.trim(),
            author:    currentUser ?? 'ייבוא אקסל',
            timestamp: new Date().toLocaleString('he-IL'),
          }]
        : [];

      leads.push({
        id:            `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        company,
        contactName:   get('contactName', row),
        phone:         get('phone', row),
        email:         get('email', row),
        budget,
        status:        statusRaw ? normalizeStatus(statusRaw) : 'חדש',
        source:        sourceRaw ? normalizeSource(sourceRaw) : 'אורגני',
        aiScore:       0,
        assignedTo:    currentUser ?? 'לא מוקצה',
        lastUpdate:    today,
        notes:         initialNotes,
        tasks:         [],
        solutions:     [],
        futureNotes:   [],
        waitingContent: false,
      });
    }

    await new Promise(r => setTimeout(r, 700));

    setImported(leads.length);
    setSkipped(skip);
    onImport(leads);
    setStep('done');
  };

  /* ── Template download ──────────────────────────────────────────────────── */
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['שם חברה', 'שם איש קשר', 'טלפון', 'אימייל', 'תקציב', 'סטטוס', 'מקור', 'הערות'],
      ['חברה לדוגמה בע"מ', 'ישראל ישראלי', '050-1234567', 'israel@example.co.il', '10000', 'חדש', 'הפניה', 'הגיע דרך שותף — מעוניין בחבילה מלאה'],
      ['חברה 2 בע"מ', 'שרה לוי', '052-9876543', 'sara@co.il', '5000', 'בתהליך', 'פייסבוק', 'דיברנו בטלפון, שלחנו הצעת מחיר'],
    ]);
    // Set column widths
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'לידים');
    XLSX.writeFile(wb, 'ray-crm-leads-template.xlsx');
  };

  /* ── Derived ─────────────────────────────────────────────────────────────── */
  const hasCompanyCol  = Object.values(mapping).includes('company');
  const mappedCount    = Object.values(mapping).filter(v => v !== 'skip').length;
  const previewRows    = rows.slice(0, 4);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800">
            <X size={16} />
          </button>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-emerald-400" />
            <h2 className="text-white font-bold text-base">ייבוא לידים מאקסל</h2>
            {fileName && <span className="text-slate-500 text-xs truncate max-w-[120px]">{fileName}</span>}
          </div>
        </div>

        {/* ── Progress dots ── */}
        {(step === 'upload' || step === 'map') && (
          <div className="flex justify-center gap-2 py-3 border-b border-slate-800 flex-shrink-0">
            {(['upload', 'map'] as const).map((s, i) => (
              <div key={s} className={`flex items-center gap-2 text-xs ${step === s ? 'text-emerald-400' : i < ['upload','map'].indexOf(step) ? 'text-slate-400' : 'text-slate-700'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                  step === s ? 'border-emerald-400 bg-emerald-400/20 text-emerald-400' :
                  i < ['upload','map'].indexOf(step) ? 'border-slate-500 bg-slate-700 text-slate-400' :
                  'border-slate-700 text-slate-700'}`}>
                  {i + 1}
                </div>
                {s === 'upload' ? 'העלאת קובץ' : 'מיפוי עמודות'}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-y-auto flex-1">

          {/* ══ STEP: UPLOAD ══ */}
          {step === 'upload' && (
            <div className="p-6 space-y-5">
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all select-none ${
                  dragging
                    ? 'border-emerald-400 bg-emerald-500/10 scale-[1.01]'
                    : 'border-slate-700 hover:border-emerald-500/60 hover:bg-slate-800/50'
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all ${
                  dragging ? 'bg-emerald-500/20' : 'bg-slate-800'
                }`}>
                  <Upload size={26} className={dragging ? 'text-emerald-400' : 'text-slate-500'} />
                </div>
                <p className="text-white font-semibold text-base mb-1">גרור קובץ לכאן או לחץ לבחירה</p>
                <p className="text-slate-500 text-sm">Excel (.xlsx, .xls) או CSV</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Tips + template */}
              <div className="bg-slate-800/60 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition-colors">
                    <Download size={14} />
                    הורד תבנית Excel לדוגמה
                  </button>
                  <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                    <Sparkles size={11} className="text-indigo-400" />
                    זיהוי אוטומטי חכם
                  </div>
                </div>
                <div className="border-t border-slate-700 pt-3 space-y-1.5">
                  {[
                    'המערכת מזהה אוטומטית את עמודות הטלפון, אימייל, תקציב וכו׳',
                    'שורה ראשונה = כותרות עמודות (לא חובה, יש זיהוי חכם)',
                    'כל שורה = ליד אחד',
                  ].map(t => (
                    <div key={t} className="flex items-start gap-2 text-slate-500 text-xs">
                      <Info size={10} className="flex-shrink-0 mt-0.5 text-slate-600" />
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══ STEP: MAP ══ */}
          {step === 'map' && (
            <div className="p-5 space-y-4">
              {/* Summary */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-bold">
                  {rows.length} שורות נמצאו
                </span>
                <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-bold">
                  {headers.length} עמודות
                </span>
                <span className="bg-slate-700 text-slate-400 px-3 py-1 rounded-full text-xs">
                  {mappedCount} עמודות מזוהות אוטומטית
                </span>
              </div>

              {/* Info if no company */}
              {!hasCompanyCol && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-400 text-xs">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>לא זוהתה עמודת "שם חברה" — עמודה ראשונה תשמש כשם הליד אוטומטית. תוכל לשנות למטה.</span>
                </div>
              )}

              {/* Column mapping */}
              <div className="space-y-1.5">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">מיפוי עמודות</p>
                <div className="space-y-1.5">
                  {headers.map((hdr, hIdx) => {
                    const sampleValues = previewRows
                      .map(r => r[hIdx] ?? '')
                      .filter(Boolean)
                      .slice(0, 2);
                    const fieldVal = mapping[hdr] ?? 'skip';
                    const isMapped = fieldVal !== 'skip';
                    return (
                      <div key={hdr}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all ${
                          isMapped
                            ? 'bg-slate-800 border-slate-600'
                            : 'bg-slate-800/50 border-slate-700/50'
                        }`}>
                        {/* Column name + sample */}
                        <div className="flex-1 text-right min-w-0">
                          <span className={`text-sm font-semibold ${isMapped ? 'text-white' : 'text-slate-500'}`}>
                            {hdr || `עמודה ${hIdx + 1}`}
                          </span>
                          {sampleValues.length > 0 && (
                            <span className="text-slate-600 text-xs mr-2 truncate">
                              · {sampleValues.join(', ')}
                            </span>
                          )}
                        </div>
                        {/* Mapping select */}
                        <select
                          value={fieldVal}
                          onChange={e => setMapping(m => ({ ...m, [hdr]: e.target.value as MappableField }))}
                          className={`flex-shrink-0 w-44 bg-slate-700 border text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all ${
                            isMapped
                              ? 'border-indigo-500/50 text-white'
                              : 'border-slate-600 text-slate-500'
                          }`}
                        >
                          {(Object.keys(FIELD_LABELS) as MappableField[]).map(f => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview table */}
              {previewRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    תצוגה מקדימה — {Math.min(4, rows.length)} מתוך {rows.length} שורות
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-700">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-800 border-b border-slate-700">
                          {headers.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-right text-slate-400 font-medium whitespace-nowrap">
                              {h || `עמודה ${i + 1}`}
                              {mapping[h] !== 'skip' && mapping[h] && (
                                <span className="mr-1 text-emerald-400 text-[10px]">
                                  → {FIELD_LABELS[mapping[h]].replace(/[🏢👤📞✉️💰📊🔗]/g, '').replace(' *','').trim()}
                                </span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/40'}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-2 text-slate-300 text-right whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis">
                                {cell || <span className="text-slate-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 4 && (
                    <p className="text-slate-600 text-xs text-center">...ועוד {rows.length - 4} שורות</p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1 border-t border-slate-800">
                <button
                  onClick={() => { setStep('upload'); setHeaders([]); setRows([]); setFileName(''); }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 text-sm transition-colors"
                >
                  <ChevronLeft size={14} />
                  חזרה
                </button>
                <button
                  onClick={doImport}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                >
                  <Upload size={15} />
                  ייבא {rows.length} לידים
                </button>
              </div>
            </div>
          )}

          {/* ══ STEP: IMPORTING ══ */}
          {step === 'importing' && (
            <div className="p-14 text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto">
                <RefreshCw size={28} className="text-emerald-400 animate-spin" />
              </div>
              <div>
                <p className="text-white font-bold text-lg">מייבא לידים...</p>
                <p className="text-slate-500 text-sm mt-1">מעבד {rows.length} רשומות</p>
              </div>
            </div>
          )}

          {/* ══ STEP: DONE ══ */}
          {step === 'done' && (
            <div className="p-10 text-center space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-black text-2xl">הייבוא הושלם!</p>
                <p className="text-slate-400 text-sm mt-1">הלידים נוספו לרשימה שלך</p>
              </div>
              <div className="flex gap-3 justify-center">
                <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl px-8 py-4 text-center">
                  <p className="text-emerald-400 font-black text-3xl">{imported}</p>
                  <p className="text-slate-500 text-xs mt-1">לידים יובאו</p>
                </div>
                {skipped > 0 && (
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl px-8 py-4 text-center">
                    <p className="text-slate-400 font-black text-3xl">{skipped}</p>
                    <p className="text-slate-500 text-xs mt-1">שורות ריקות/דולגו</p>
                  </div>
                )}
                {imported > 0 && Object.values(mapping).includes('notes') && (
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl px-6 py-4 text-center">
                    <p className="text-indigo-400 font-black text-2xl">📝</p>
                    <p className="text-slate-500 text-xs mt-1">הערות סונכרנו</p>
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-full bg-white hover:bg-neutral-100 text-black font-bold py-3.5 rounded-2xl transition-colors text-sm"
              >
                סגור וצפה בלידים
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
