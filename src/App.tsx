import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import './index.css';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import TeamManagement from './pages/TeamManagement';
import AiAssistant from './pages/AiAssistant';
import Kanban from './pages/Kanban';
import Tasks from './pages/Tasks';
import Settings from './pages/Settings';
import ContentHub from './pages/ContentHub';
import HomeDashboard from './pages/HomeDashboard';
import Deals from './pages/Deals';
import LeadModal from './components/LeadModal';
import NewLeadModal from './components/NewLeadModal';
import CommandPalette from './components/CommandPalette';
import Toast from './components/Toast';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { Lead, Note, Page, TeamMember, AppSettings, Task, StandaloneTask } from './types';
import type { ToastMessage } from './components/Toast';
import { initialLeads, initialTeam } from './data/mockData';
import { db } from './lib/firebase';
import {
  collection, doc, getDoc, setDoc, getDocs, onSnapshot, writeBatch, deleteDoc,
} from 'firebase/firestore';

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('App error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">אירעה שגיאה</h2>
          <p className="text-slate-500 text-sm mb-6 max-w-sm">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            רענן את האפליקציה
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Lead normalizer — guards against missing/null/invalid fields from Firestore or localStorage ──
const VALID_STATUSES: Lead['status'][] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
const VALID_SOURCES:  Lead['source'][] = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

function normalizeLead(raw: unknown): Lead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawStatus = r.status as Lead['status'];
  const rawSource = r.source as Lead['source'];
  // migrate old status names from cheX era
  const migratedStatus: Lead['status'] =
    (rawStatus as string) === 'הטמעה' ? 'בתהליך' : rawStatus;
  // migrate old source names
  const migratedSource: Lead['source'] =
    ['cheX', 'ci3', 'סורקים'].includes(rawSource as string) ? 'אורגני' : rawSource;
  return {
    id:             String(r.id           ?? Date.now()),
    company:        String(r.company      ?? ''),
    contactName:    String(r.contactName  ?? ''),
    email:          String(r.email        ?? ''),
    phone:          String(r.phone        ?? ''),
    status:         VALID_STATUSES.includes(migratedStatus) ? migratedStatus : 'חדש',
    source:         VALID_SOURCES.includes(migratedSource)  ? migratedSource : 'אורגני',
    assignedTo:     String(r.assignedTo   ?? ''),
    lastUpdate:     String(r.lastUpdate   ?? ''),
    budget:         isFinite(Number(r.budget ?? r.checkCount)) ? Number(r.budget ?? r.checkCount) : 0,
    aiScore:        isFinite(Number(r.aiScore)) ? Number(r.aiScore) : 0,
    waitingContent: Boolean(r.waitingContent ?? r.waitingG3),
    tasks:          Array.isArray(r.tasks)       ? r.tasks       : [],
    notes:          Array.isArray(r.notes)       ? r.notes       : [],
    solutions:      Array.isArray(r.solutions)   ? r.solutions   : [],
    futureNotes:    Array.isArray(r.futureNotes) ? r.futureNotes : [],
  } as Lead;
}

// ─── Default settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Almog Avraham',
  userInitials: 'AA',
  companyName: 'RAY Digital Agency',
  compactMode: false,
  showOverduePopup: true,
  defaultPage: 'home',
  accentColor: 'indigo',
};

// ─── localStorage helpers ────────────────────────────────────────────────────
function loadLeadsLocal(): Lead[] {
  try {
    const s = localStorage.getItem('crm-leads');
    const raw: unknown[] = s ? JSON.parse(s) : initialLeads;
    return Array.isArray(raw) ? raw.map(normalizeLead) : initialLeads.map(normalizeLead);
  } catch { return initialLeads.map(normalizeLead); }
}
function loadTeamLocal(): TeamMember[] {
  try { const s = localStorage.getItem('crm-team'); return s ? JSON.parse(s) : initialTeam; }
  catch { return initialTeam; }
}
function loadSettings(): AppSettings {
  try { const s = localStorage.getItem('crm-settings'); return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
}

// ─── AppInner: rendered inside AuthProvider ──────────────────────────────────
function AppInner() {
  const { user, profile, loading, isAdmin, signOut } = useAuth();

  // Invite token in URL?
  const inviteToken = new URLSearchParams(window.location.search).get('token') ?? '';

  // ── bypassAuth — כניסה ללא אימות מופעלת ──────────────────────────────────
  const bypassAuth = true;
  void getDoc; // suppress unused import warning

  const [page, setPage]               = useState<Page>('home');
  const [leads, setLeads]             = useState<Lead[]>(loadLeadsLocal);
  const [team, setTeam]               = useState<TeamMember[]>(loadTeamLocal);
  const [settings, setSettings]       = useState<AppSettings>(loadSettings);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [toasts, setToasts]           = useState<ToastMessage[]>([]);
  const [fbReady, setFbReady]             = useState(false);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask[]>([]);
  const initialSyncDone                   = useRef(false);

  // ─── Overdue badge ────────────────────────────────────────────────────────
  const overdueBadge = useMemo(() => {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return leads
        .flatMap(l => (l.tasks ?? []).filter(t => !t.completed))
        .filter(t => { try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; } })
        .length;
    } catch { return 0; }
  }, [leads]);

  // ─── Global Cmd+K listener ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
      if (e.key === 'Escape') setShowPalette(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Firestore init & real-time sync ─────────────────────────────────────
  useEffect(() => {
    let unsub: (() => void) | null = null;
    async function init() {
      try {
        const snap = await getDocs(collection(db, 'leads'));
        if (snap.empty) {
          const batch = writeBatch(db);
          loadLeadsLocal().forEach(l => batch.set(doc(db, 'leads', l.id), l));
          await batch.commit();
        }
        unsub = onSnapshot(collection(db, 'leads'), ss => {
          const fbLeads = ss.docs
            .map(d => normalizeLead(d.data()))
            .sort((a, b) => {
              const aTime = (a as Record<string, unknown>).createdAt ?? 0;
              const bTime = (b as Record<string, unknown>).createdAt ?? 0;
              return (bTime as number) - (aTime as number);
            });
          setLeads(fbLeads);
          localStorage.setItem('crm-leads', JSON.stringify(fbLeads));
        });
        const teamSnap = await getDocs(collection(db, 'team'));
        if (teamSnap.empty) {
          const batch2 = writeBatch(db);
          loadTeamLocal().forEach(m => batch2.set(doc(db, 'team', m.id), m));
          await batch2.commit();
          setTeam(loadTeamLocal());
        } else {
          const fbTeam = teamSnap.docs.map(d => d.data() as TeamMember);
          setTeam(fbTeam);
          localStorage.setItem('crm-team', JSON.stringify(fbTeam));
        }
        initialSyncDone.current = true;
        setFbReady(true);
      } catch {
        setFbReady(true);
      }
    }
    init();
    return () => { if (unsub) unsub(); };
  }, []);

  // ─── Save team to Firestore ───────────────────────────────────────────────
  useEffect(() => {
    if (!fbReady || !initialSyncDone.current) return;
    localStorage.setItem('crm-team', JSON.stringify(team));
    team.forEach(m => setDoc(doc(db, 'team', m.id), m).catch(console.error));
  }, [team, fbReady]);

  // ─── Standalone tasks — real-time sync ───────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tasks'), snap => {
      const tasks: StandaloneTask[] = snap.docs.map(d => d.data() as StandaloneTask);
      tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setStandaloneTask(tasks);
    });
    return () => unsub();
  }, []);

  // ─── Save settings to localStorage ───────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('crm-settings', JSON.stringify(settings));
  }, [settings]);

  // ─── Toast helpers ────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Save single lead ────────────────────────────────────────────────────
  const saveLead = useCallback(async (lead: Lead) => {
    try { await setDoc(doc(db, 'leads', lead.id), lead); }
    catch (err) { console.error('Error saving lead:', err); }
  }, []);

  // ─── Lead handlers ────────────────────────────────────────────────────────
  const handleLeadSave = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    saveLead(updated);
    setSelectedLead(null);
    addToast('הכרטיס נשמר בהצלחה ✓');
  };

  const handleLeadUpdate = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    saveLead(updated);
  };

  const handleLeadDelete = (id: string) => {
    setLeads(prev => prev.filter(l => l.id !== id));
    setSelectedLead(null);
    deleteDoc(doc(db, 'leads', id)).catch(console.error);
    addToast('הליד נמחק', 'info');
  };

  const handleAddLead = async (lead: Lead) => {
    const leadWithTimestamp = { ...lead, createdAt: Date.now() } as Lead;
    setLeads(prev => [leadWithTimestamp, ...prev]);
    await saveLead(leadWithTimestamp);
    setShowNewLead(false);
    addToast(`ליד חדש נוסף: ${lead.company}`, 'success');
  };

  const handleTaskComplete = (leadId: string, taskId: string) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId
          ? { ...l, tasks: l.tasks.map(t => t.id === taskId ? { ...t, completed: true, completedAt: new Date().toISOString() } : t) }
          : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה הושלמה! ✅', 'success');
  };

  const handleTaskDelete = (leadId: string, taskId: string) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, tasks: l.tasks.filter(t => t.id !== taskId) } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה נמחקה', 'info');
  };

  const handleAddTask = (leadId: string, task: Task) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, tasks: [...l.tasks, task] } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה נוצרה בהצלחה ✓', 'success');
  };

  const handleBulkDelete = (leadIds: string[]) => {
    setLeads(prev => prev.filter(l => !leadIds.includes(l.id)));
    leadIds.forEach(id => deleteDoc(doc(db, 'leads', id)).catch(console.error));
    addToast(`${leadIds.length} לידים נמחקו`, 'info');
  };

  const handleBulkStatusChange = (leadIds: string[], status: Lead['status']) => {
    setLeads(prev => {
      const next = prev.map(l =>
        leadIds.includes(l.id)
          ? { ...l, status, lastUpdate: new Date().toLocaleDateString('he-IL') }
          : l
      );
      leadIds.forEach(id => {
        const updated = next.find(l => l.id === id);
        if (updated) saveLead(updated);
      });
      return next;
    });
    addToast(`${leadIds.length} לידים עודכנו לסטטוס "${status}"`, 'success');
  };

  // ─── Team handlers ────────────────────────────────────────────────────────
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
  const handleRemoveMember = (id: string) => {
    setTeam(prev => prev.filter(m => m.id !== id));
    addToast('חבר הצוות הוסר', 'info');
  };
  // ─── Standalone task handlers ─────────────────────────────────────────────
  const handleStandaloneAdd = async (task: StandaloneTask) => {
    // Optimistic update — show immediately without waiting for Firestore
    setStandaloneTask(prev =>
      prev.some(t => t.id === task.id) ? prev : [...prev, task]
    );
    // Firestore rejects documents with undefined values — strip them before saving
    const firestoreTask = Object.fromEntries(
      Object.entries(task).filter(([, v]) => v !== undefined)
    ) as StandaloneTask;
    await setDoc(doc(db, 'tasks', task.id), firestoreTask).catch(console.error);
    addToast('משימה נוספה ✓', 'success');
  };
  const handleStandaloneComplete = async (taskId: string) => {
    const task = standaloneTask.find(t => t.id === taskId);
    if (!task) return;
    const updated = { ...task, completed: true, completedAt: new Date().toISOString() };
    // Optimistic update
    setStandaloneTask(prev => prev.map(t => t.id === taskId ? updated : t));
    await setDoc(doc(db, 'tasks', taskId), updated).catch(console.error);
  };
  const handleStandaloneDelete = async (taskId: string) => {
    // Optimistic update
    setStandaloneTask(prev => prev.filter(t => t.id !== taskId));
    await deleteDoc(doc(db, 'tasks', taskId)).catch(console.error);
  };

  const handleStandaloneEdit = async (task: StandaloneTask) => {
    setStandaloneTask(prev => prev.map(t => t.id === task.id ? task : t));
    const firestoreTask = Object.fromEntries(
      Object.entries(task).filter(([, v]) => v !== undefined)
    ) as StandaloneTask;
    await setDoc(doc(db, 'tasks', task.id), firestoreTask).catch(console.error);
    addToast('משימה עודכנה ✓', 'success');
  };

  // ─── AI agent: add note to lead ───────────────────────────────────────────
  const handleAddNote = (leadId: string, noteText: string) => {
    const note: Note = {
      id:        Date.now().toString(),
      text:      noteText,
      author:    settings.userName,
      timestamp: new Date().toISOString(),
    };
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, notes: [...l.notes, note] } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('הערה נוספה ✓', 'success');
  };

  // ─── Settings handlers ────────────────────────────────────────────────────
  const handleSettingsChange = (s: AppSettings) => {
    setSettings(s);
    addToast('ההגדרות נשמרו ✓', 'success');
  };

  const handleImportLeads = (imported: Lead[]) => {
    setLeads(prev => [...imported, ...prev]);
    imported.forEach(l => saveLead(l));
    addToast(`${imported.length} לידים יובאו`, 'success');
  };

  const handleResetData = () => {
    setLeads(initialLeads);
    initialLeads.forEach(l => saveLead(l));
    addToast('הנתונים אופסו', 'info');
  };

  // ─── Derive display name/initials from profile ────────────────────────────
  const displayName     = profile ? `${profile.firstName} ${profile.lastName}` : settings.userName;
  const displayInitials = profile && profile.firstName && profile.lastName
    ? `${profile.firstName[0]}${profile.lastName[0]}`
    : settings.userInitials;

  // ─── Auth gates ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Password reset link from Firebase email (?mode=resetPassword&oobCode=xxx)
  const urlParams   = new URLSearchParams(window.location.search);
  const resetMode   = urlParams.get('mode');
  const resetCode   = urlParams.get('oobCode') ?? '';
  if (resetMode === 'resetPassword' && resetCode) {
    return (
      <ResetPassword
        oobCode={resetCode}
        onDone={() => {
          window.history.replaceState({}, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  if (inviteToken) {
    return (
      <Register
        token={inviteToken}
        onSuccess={() => {
          window.history.replaceState({}, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  if (!user && !bypassAuth) return <Login />;

  return (
    <>
      <Layout
        currentPage={page}
        onPageChange={setPage}
        onNewLead={() => setShowNewLead(true)}
        onRefresh={() => addToast(fbReady ? 'מחובר ל-Firebase ✓' : 'טוען...', 'info')}
        overdueBadge={overdueBadge}
        userInitials={displayInitials}
        userName={displayName}
        allowedPages={profile?.allowedPages ?? (bypassAuth ? ['home','dashboard','overview','team','ai','kanban','tasks','settings','content','deals'] : [])}
        isAdmin={bypassAuth ? true : isAdmin}
        onSignOut={signOut}
      >
        {/* Firebase loading indicator */}
        {!fbReady && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-900 text-white text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            מתחבר ל-Firebase...
          </div>
        )}

        {page === 'home' && (
          <HomeDashboard
            leads={leads}
            standaloneTask={standaloneTask}
            currentUser={displayName}
            onLeadClick={setSelectedLead}
            onPageChange={setPage}
          />
        )}
        {page === 'dashboard' && (
          <Dashboard
            leads={leads}
            onLeadClick={setSelectedLead}
            onNoteClick={setSelectedLead}
            onTaskComplete={handleTaskComplete}
            onToast={addToast}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkDelete={handleBulkDelete}
            compact={settings.compactMode}
          />
        )}
        {page === 'overview' && (
          <Overview leads={leads} onLeadClick={setSelectedLead} />
        )}
        {page === 'team' && (
          <TeamManagement team={team} leads={leads} onUpdateRole={handleUpdateRole} onInvite={handleInvite} onRemoveMember={handleRemoveMember} />
        )}
        {page === 'ai' && (
          <AiAssistant
            leads={leads}
            team={team}
            currentUser={displayName}
            standaloneTask={standaloneTask}
            onCreateTask={handleStandaloneAdd}
            onUpdateLead={handleLeadUpdate}
            onAddNote={handleAddNote}
          />
        )}
        {page === 'kanban' && (
          <Kanban leads={leads} onLeadClick={setSelectedLead} onLeadSave={handleLeadUpdate} />
        )}
        {page === 'tasks' && (
          <Tasks
            leads={leads}
            team={team}
            currentUser={displayName}
            standaloneTask={standaloneTask}
            onLeadClick={setSelectedLead}
            onLeadTaskComplete={handleTaskComplete}
            onLeadTaskDelete={handleTaskDelete}
            onLeadAddTask={handleAddTask}
            onStandaloneAdd={handleStandaloneAdd}
            onStandaloneComplete={handleStandaloneComplete}
            onStandaloneDelete={handleStandaloneDelete}
            onStandaloneEdit={handleStandaloneEdit}
          />
        )}
        {page === 'settings' && isAdmin && (
          <Settings
            settings={settings}
            leads={leads}
            onSettingsChange={handleSettingsChange}
            onImportLeads={handleImportLeads}
            onResetData={handleResetData}
            onToast={addToast}
            isAdmin={isAdmin}
            currentUserUid={user?.uid ?? ''}
          />
        )}
        {page === 'content' && (
          <ContentHub />
        )}
        {page === 'deals' && (
          <Deals leads={leads} team={team} currentUser={displayName} onLeadClick={setSelectedLead} onToast={addToast} />
        )}
      </Layout>

      {/* Command Palette */}
      {showPalette && (
        <CommandPalette
          leads={leads}
          onClose={() => setShowPalette(false)}
          onLeadClick={lead => { setSelectedLead(lead); setShowPalette(false); }}
          onPageChange={p => { setPage(p); setShowPalette(false); }}
          onNewLead={() => { setShowNewLead(true); setShowPalette(false); }}
        />
      )}

      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={handleLeadSave}
          onUpdate={handleLeadUpdate}
          onDelete={handleLeadDelete}
        />
      )}

      {showNewLead && (
        <NewLeadModal onClose={() => setShowNewLead(false)} onAdd={handleAddLead} />
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  );
}
