import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { Lead, LeadStatus, LeadSource } from '../types';

interface NewLeadModalProps {
  onClose: () => void;
  onAdd: (lead: Lead) => void;
}

export default function NewLeadModal({ onClose, onAdd }: NewLeadModalProps) {
  const [form, setForm] = useState({
    company: '',
    contactName: '',
    email: '',
    phone: '',
    status: 'חדש' as LeadStatus,
    source: 'cheX' as LeadSource,
    assignedTo: 'Almog Avraham',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim()) return;

    const newLead: Lead = {
      id: Date.now().toString(),
      company: form.company.trim(),
      contactName: form.contactName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      status: form.status,
      source: form.source,
      assignedTo: form.assignedTo,
      banks: [],
      checkCount: 0,
      solutions: [],
      lastUpdate: new Date().toLocaleDateString('he-IL'),
      aiScore: 0,
      notes: [],
      tasks: [],
      futureNotes: [],
      waitingG3: false,
    };
    onAdd(newLead);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
          <h2 className="text-lg font-bold text-slate-800">ליד חדש</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם חברה *</label>
            <input
              type="text"
              required
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
              placeholder="שם החברה..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם איש קשר</label>
            <input
              type="text"
              value={form.contactName}
              onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
              placeholder="שם מלא..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">טלפון</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
                placeholder="050-0000000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">מייל</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right"
                placeholder="email@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">סטטוס</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as LeadStatus }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-white"
              >
                {(['חדש', 'הקמת כספת בבנק', 'הטמעה', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'] as LeadStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">מקור</label>
              <select
                value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value as LeadSource }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-white"
              >
                <option value="cheX">cheX</option>
                <option value="ci3">ci3</option>
                <option value="סורקים">סורקים</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors"
            >
              ביטול
            </button>
            <button
              type="submit"
              className="flex-1 bg-indigo-900 hover:bg-indigo-800 text-white py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Plus size={16} />
              הוסף ליד
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
