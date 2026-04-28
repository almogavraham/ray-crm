import { useState, useCallback, useEffect } from 'react';
import './index.css';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import TeamManagement from './pages/TeamManagement';
import AiAssistant from './pages/AiAssistant';
import Kanban from './pages/Kanban';
import LeadModal from './components/LeadModal';
import NewLeadModal from './components/NewLeadModal';
import Toast from './components/Toast';
import type { Lead, Page, TeamMember } from './types';
import type { ToastMessage } from './components/Toast';
import { initialLeads, initialTeam } from './data/mockData';

// ─── localStorage helpers ────────────────────────────────────────────────────
function loadLeads(): Lead[] {
  try {
    const saved = localStorage.getItem('crm-leads');
    return saved ? JSON.parse(saved) : initialLeads;
  } catch { return initialLeads; }
}

function loadTeam(): TeamMember[] {
  try {
    const saved = localStorage.getItem('crm-team');
    return saved ? JSON.parse(saved) : initialTeam;
  } catch { return initialTeam; }
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [leads, setLeads] = useState<Lead[]>(loadLeads);
  const [team, setTeam] = useState<TeamMember[]>(loadTeam);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // ─── Persist to localStorage ─────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('crm-leads', JSON.stringify(leads)); }, [leads]);
  useEffect(() => { localStorage.setItem('crm-team', JSON.stringify(team)); }, [team]);

  const addToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleLeadSave = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    setSelectedLead(null);
    addToast('הכרטיס נשמר בהצלחה ✓');
  };

  const handleLeadUpdate = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
  };

  const handleAddLead = (lead: Lead) => {
    setLeads(prev => [lead, ...prev]);
    setShowNewLead(false);
    addToast(`ליד חדש נוסף: ${lead.company}`, 'success');
  };

  // ─── Complete task directly from Dashboard panel ──────────────────────────
  const handleTaskComplete = (leadId: string, taskId: string) => {
    setLeads(prev => prev.map(l =>
      l.id === leadId
        ? { ...l, tasks: l.tasks.map(t => t.id === taskId ? { ...t, completed: true } : t) }
        : l
    ));
    addToast('משימה הושלמה! ✅', 'success');
  };

  const handleUpdateRole = (id: string, role: 'מנהל' | 'סוכן') => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, role } : m));
    addToast('תפקיד עודכן', 'info');
  };

  const handleInvite = (email: string, role: 'מנהל' | 'סוכן') => {
    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: email.split('@')[0],
      email,
      role,
    };
    setTeam(prev => [...prev, newMember]);
    addToast(`הזמנה נשלחה ל-${email}`, 'success');
  };

  return (
    <>
      <Layout
        currentPage={page}
        onPageChange={setPage}
        onNewLead={() => setShowNewLead(true)}
        onRefresh={() => addToast('הנתונים עדכניים ✓', 'info')}
      >
        {page === 'dashboard' && (
          <Dashboard
            leads={leads}
            onLeadClick={setSelectedLead}
            onNoteClick={setSelectedLead}
            onTaskComplete={handleTaskComplete}
            onToast={addToast}
          />
        )}
        {page === 'overview' && (
          <Overview leads={leads} onLeadClick={setSelectedLead} />
        )}
        {page === 'team' && (
          <TeamManagement
            team={team}
            leads={leads}
            onUpdateRole={handleUpdateRole}
            onInvite={handleInvite}
          />
        )}
        {page === 'ai' && (
          <AiAssistant leads={leads} />
        )}
        {page === 'kanban' && (
          <Kanban
            leads={leads}
            onLeadClick={setSelectedLead}
            onLeadSave={handleLeadUpdate}
          />
        )}
      </Layout>

      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={handleLeadSave}
          onUpdate={handleLeadUpdate}
        />
      )}

      {showNewLead && (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onAdd={handleAddLead}
        />
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}
