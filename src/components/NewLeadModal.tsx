import { useState } from 'react';
import { X, Plus, Package, AlertTriangle } from 'lucide-react';
import type { Lead, LeadStatus, LeadSource, Solution } from '../types';

interface NewLeadModalProps {
  onClose: () => void;
  onAdd: (lead: Lead) => void;
  workspaceSolutions?: string[];
  currentUser?: string;
  existingLeads?: Lead[];   // used for duplicate detection
}

const SOURCES: LeadSource[] = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];
const STATUSES: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];

/** Normalize a string for fuzzy duplicate comparison */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export default function NewLeadModal({
  onClose, onAdd,
  workspaceSolutions = [],
  currentUser = '',
  existingLeads = [],
}: NewLeadModalProps) {
  const [form, setForm] = useState({
    company:     '',
    contactName: '',
    email:       '',
    phone:       '',
    status:      'חדש' as LeadStatus,
    source:      'אורגני' as LeadSource,
    assignedTo:  currentUser,
  });

  const [selectedSolutions, setSelectedSolutions] = useState<string[]>([]);
  const [duplicate, setDuplicate]   = useState<Lead | null>(null);   // detected dupe
  const [forceAdd,  setForceAdd]    = useState(false);               // user overrides

  const toggleSolution = (name: string) =>
    setSelectedSolutions(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );

  /* ── Check for duplicates whenever email or company changes ── */
  const checkDuplicate = (company: string, email: string): Lead | null => {
    const nc = norm(company);
    const ne = norm(email);
    return existingLeads.find(l => {
      if (ne && norm(l.email) === ne) return true;           // same email
      if (nc.length >= 3 && norm(l.company) === nc) return true; // same company name
      return false;
    }) ?? null;
  };

  const handleCompanyChange = (val: string) => {
    setForm(f => ({ ...f, company: val }));
    setForceAdd(false);
    setDuplicate(checkDuplicate(val, form.email));
  };

  const handleEmailChange = (val: string) => {
    setForm(f => ({ ...f, email: val }));
    setForceAdd(false);
    setDuplicate(checkDuplicate(form.company, val));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) return;

    // Block submit if there's a dupe and user hasn't confirmed
    if (duplicate && !forceAdd) {
      setForceAdd(false); // just ensure banner stays visible
      return;
    }

    const solutions: Solution[] = selectedSolutions.map(name => ({
      name,
      inProgress: false,
      delivered: false,
    }));

    const newLead: Lead = {
      id:             `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      company:        form.company.trim(),
      contactName:    form.contactName.trim(),
      email:          form.email.trim(),
      phone:          form.phone.trim(),
      status:         form.status,
      source:         form.source,
      assignedTo:     form.assignedTo,
      budget:         0,
      solutions,
      lastUpdate:     new Date().toLocaleDateString('he-IL'),
      aiScore:        0,
      notes:          [],
      tasks:          [],
      futureNotes:    [],
      waitingContent: false,
    };
    onAdd(newLead);
  };

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 text-right bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
          <h2 className="text-lg font-bold text-slate-800">ליד חדש</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* ── Duplicate warning ─────────────────────────────────────── */}
          {duplicate && !forceAdd && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 space-y-2" dir="rtl">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-amber-800">ליד כפול — כבר קיים במערכת</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    <span className="font-semibold">{duplicate.company}</span>
                    {duplicate.email && ` (${duplicate.email})`}
                    {' '}— סטטוס: {duplicate.status}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForceAdd(true)}
                  className="flex-1 text-xs font-semibold px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
                >
                  הוסף בכל זאת
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 text-xs font-medium px-3 py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}

          {/* Force-add confirmation chip */}
          {duplicate && forceAdd && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-right">
              <AlertTriangle size={13} className="text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-700 font-medium">יווצר ליד נוסף — גם אם קיים ליד דומה</p>
            </div>
          )}

          {/* Fields */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם חברה / לקוח *</label>
            <input
              type="text" required
              value={form.company}
              onChange={e => handleCompanyChange(e.target.value)}
              className={inp}
              placeholder="לדוגמה: מגדלי שפירא..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם איש קשר</label>
            <input type="text" value={form.contactName}
              onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
              className={inp} placeholder="שם מלא..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">טלפון</label>
              <input type="tel" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inp} placeholder="050-0000000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">מייל</label>
              <input
                type="email"
                value={form.email}
                onChange={e => handleEmailChange(e.target.value)}
                className={inp}
                placeholder="email@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">סטטוס</label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as LeadStatus }))}
                className={inp}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">מקור</label>
              <select value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value as LeadSource }))}
                className={inp}>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* ── Workspace solutions ──────────────────────────────────────── */}
          {workspaceSolutions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                <Package size={14} className="text-indigo-500" />
                באיזה פתרון מתעניין הליד?
              </label>
              <div className="flex flex-wrap gap-2">
                {workspaceSolutions.map(sol => {
                  const selected = selectedSolutions.includes(sol);
                  return (
                    <button
                      key={sol}
                      type="button"
                      onClick={() => toggleSolution(sol)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        selected
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {selected && <span className="ml-1">✓</span>}
                      {sol}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors">
              ביטול
            </button>
            <button
              type="submit"
              disabled={!!(duplicate && !forceAdd)}
              className="flex-1 bg-black hover:bg-neutral-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Plus size={16} />הוסף ליד
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
