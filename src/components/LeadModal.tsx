import { useState, useRef, useMemo, useEffect } from 'react';
import {
  X, MessageCircle, Mail, Phone, Save, Plus, Trash2, Brain,
  Clock, Building2, CheckCircle2, Activity, Star, Zap,
  FileText, ListChecks, Loader2, Globe, ChevronDown, AlertCircle,
  Mic, MicOff, Sparkles, Calendar, CalendarPlus, PhoneCall,
  Users2, RotateCcw, Pencil, Check, Flame,
} from 'lucide-react';
import { AgentsTab } from './LeadAgents';
import ProposalEditorModal from './ProposalEditorModal';
import type { Lead, LeadStatus, LeadSource, TaskPriority, WorkspaceProfile, LeadActivity, LeadMeeting, ContactMethod, LeadActivityType, CardLayoutSettings } from '../types';
import { DEFAULT_CARD_LAYOUT, DEFAULT_CARD_SECTIONS } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import CardCustomizePanel from './CardCustomizePanel';
import { DEFAULT_STATUS_CONFIGS, getStatusConfig, buildAutomationTasks } from '../lib/statusConfig';
import { useDictation } from '../hooks/useDictation';

const LEAD_SOURCES: LeadSource[] = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];
import { SOLUTIONS } from '../data/mockData';
import StatusBadge from './StatusBadge';
import EmailModal from './EmailModal';
import WhatsAppModal from './WhatsAppModal';
import { useLang } from '../contexts/LangContext';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';

const PRIORITY_OPTS: { value: 'high' | 'medium' | 'low'; label: string; active: string; idle: string }[] = [
  { value: 'high',   label: '🔴', active: 'bg-red-500 text-white ring-2 ring-red-300',    idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
  { value: 'medium', label: '🟠', active: 'bg-amber-500 text-white ring-2 ring-amber-300', idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
  { value: 'low',    label: '🔵', active: 'bg-blue-500 text-white ring-2 ring-blue-300',   idle: 'bg-slate-700 text-slate-400 hover:bg-slate-600' },
];

function formatPhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) return '+' + digits;
  if (digits.startsWith('0') && digits.length >= 9) return '+972' + digits.slice(1);
  if (digits.length === 9) return '+972' + digits;
  return '+' + digits;
}

const ALL_STATUSES: LeadStatus[] = [
  'חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

const DEFAULT_OBJECTIONS = ['💰 מחיר גבוה', '⏰ לא הזמן הנכון', '🔄 כבר יש פתרון', '❌ לא מתאים'];

const ACTIVITY_ICONS: Record<LeadActivityType, string> = {
  call: '📞', email: '✉️', whatsapp: '💬', meeting: '📅',
  task: '✓', note: '📝', status_change: '🔄', objection: '❌', in_person: '🤝',
};
const ACTIVITY_COLORS: Record<LeadActivityType, string> = {
  call: 'bg-blue-500/20 text-blue-400',
  email: 'bg-indigo-500/20 text-indigo-400',
  whatsapp: 'bg-green-500/20 text-green-400',
  meeting: 'bg-purple-500/20 text-purple-400',
  task: 'bg-orange-500/20 text-orange-400',
  note: 'bg-slate-600/40 text-slate-400',
  status_change: 'bg-amber-500/20 text-amber-400',
  objection: 'bg-red-500/20 text-red-400',
  in_person: 'bg-teal-500/20 text-teal-400',
};

const STATUS_COLORS: Record<LeadStatus, string> = {
  'חדש':        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'בתהליך':    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'לקוח פעיל': 'bg-green-500/20 text-green-300 border-green-500/30',
  'רימרקטינג': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'לא רלוונטי': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

type Tab = 'details' | 'tasks' | 'activity' | 'agents';

interface CompanyInsight {
  summary: string;
  industry?: string;
  size?: string;
  salesAngle?: string;
  sources?: string[];
}

interface LeadModalProps {
  lead: Lead;
  onClose: () => void;
  onSave: (updated: Lead) => void;
  onUpdate: (updated: Lead) => void;
  onDelete?: (id: string) => void;
  workspace?: WorkspaceProfile;
  currentUser?: string;
  team?: import('../types').TeamMember[];
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate?: (updates: Partial<WorkspaceProfile>) => Promise<void>;
  statusConfigs?: StatusConfig[];
}

export default function LeadModal({ lead, onClose, onSave, onUpdate, onDelete, workspace, currentUser, team = [], onToast, onWorkspaceUpdate, statusConfigs = DEFAULT_STATUS_CONFIGS }: LeadModalProps) {
  const { t, dir } = useLang();
  // Dynamic status list from config
  const configStatuses = useMemo(() => statusConfigs.map(c => c.label), [statusConfigs]);
  // Solutions list: workspace-specific (from wizard) or fallback to hardcoded
  const solutionsList = (workspace?.businessSolutions?.length ?? 0) > 0
    ? (workspace!.businessSolutions!)
    : SOLUTIONS;
  const [data, setData] = useState<Lead>({ ...lead });

  // ── Auto-save ──────────────────────────────────────────────────────────────
  // Persist every edit immediately (debounced) so the user never has to press a
  // save button, and nothing is lost on refresh. A final flush on close covers
  // edits made within the debounce window.
  const latestData = useRef(data);
  latestData.current = data;
  const autoSaveInit = useRef(true);
  const autoSaveDirty = useRef(false);
  useEffect(() => {
    if (autoSaveInit.current) { autoSaveInit.current = false; return; }
    autoSaveDirty.current = true;
    const id = setTimeout(() => { onUpdate(latestData.current); autoSaveDirty.current = false; }, 700);
    return () => clearTimeout(id);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (autoSaveDirty.current) onUpdate(latestData.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [newNote, setNewNote] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('09:00');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [aiScoring, setAiScoring] = useState(false);
  const [aiInsight, setAiInsight] = useState<CompanyInsight | null>(null);
  const [aiInsightText, setAiInsightText] = useState('');
  const [aiInsightError, setAiInsightError] = useState('');
  const [showInsight, setShowInsight] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showProposalEditor, setShowProposalEditor] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editingContact, setEditingContact] = useState(false);  // edit company/contact/email/phone
  const toggleHot = () => { const updated = { ...data, isHot: !data.isHot }; setData(updated); onUpdate(updated); };
  // AI "Next Best Action"
  const [nbaLoading, setNbaLoading] = useState(false);
  const [nba, setNba] = useState<{ action: string; reason: string; task: { description: string; date: string; time: string; priority: TaskPriority } } | null>(null);

  // Contact logging
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactType, setContactType] = useState<ContactMethod>('phone');
  const [contactNote, setContactNote] = useState('');
  const [customContactLabel, setCustomContactLabel] = useState('');
  const [followUpDays, setFollowUpDays] = useState('');
  // Post-contact automatic action
  const [postContactAction, setPostContactAction] = useState<'none' | 'task' | 'email' | 'whatsapp'>('none');
  const [postContactTaskDesc, setPostContactTaskDesc] = useState('');
  const [postContactTaskPriority, setPostContactTaskPriority] = useState<TaskPriority>('medium');
  // Meeting scheduling
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('10:00');
  const [meetingDuration, setMeetingDuration] = useState(60);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  // Objections
  const [showObjectionModal, setShowObjectionModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);
  const [selectedObjection, setSelectedObjection] = useState('');

  // ── Card layout customization ──────────────────────────────────────────────
  const [showCustomize, setShowCustomize] = useState(false);
  const cardLayout: CardLayoutSettings = {
    ...DEFAULT_CARD_LAYOUT,
    ...(workspace?.cardLayout ?? {}),
    sections: (workspace?.cardLayout?.sections && workspace.cardLayout.sections.length > 0)
      ? workspace.cardLayout.sections
      : DEFAULT_CARD_SECTIONS,
  };

  const handleSaveLayout = async (newLayout: CardLayoutSettings) => {
    setShowCustomize(false);
    if (onWorkspaceUpdate) {
      await onWorkspaceUpdate({ cardLayout: newLayout });
      onToast?.('עיצוב הכרטיס עודכן ✓', 'success');
    }
  };

  // ── Label / field editing ────────────────────────────────────────────────────
  const [editingRightLabel, setEditingRightLabel] = useState(false);
  const [editingLeftLabel,  setEditingLeftLabel]  = useState(false);
  const [tempRightLabel,    setTempRightLabel]    = useState('');
  const [tempLeftLabel,     setTempLeftLabel]     = useState('');
  const [aiLabelSugg,       setAiLabelSugg]       = useState<{ right: string[]; left: string[] }>({ right: [], left: [] });
  const [loadingLabelAi,    setLoadingLabelAi]    = useState(false);
  const [savingLabel,       setSavingLabel]        = useState(false);
  // Solutions list editing
  const [editingSolutions,  setEditingSolutions]  = useState(false);
  const [newSolItem,        setNewSolItem]         = useState('');
  // Quick options editing
  const [editingQuickOpts,  setEditingQuickOpts]  = useState(false);
  const [tempQuickOpts,     setTempQuickOpts]      = useState(['', '', '']);
  // Status section label editing
  const [editingStatusLabel, setEditingStatusLabel] = useState(false);
  const [tempStatusLabel,    setTempStatusLabel]    = useState('');
  const [savingStatusLabel,  setSavingStatusLabel]  = useState(false);
  // Source section label + list editing
  const [editingSourceLabel, setEditingSourceLabel] = useState(false);
  const [tempSourceLabel,    setTempSourceLabel]    = useState('');
  const [savingSourceLabel,  setSavingSourceLabel]  = useState(false);
  const [editingSources,     setEditingSources]     = useState(false);
  const [newSourceItem,      setNewSourceItem]      = useState('');
  // Add new custom row inline
  const [addingCustomRow,    setAddingCustomRow]    = useState(false);
  const [newRowLabel,        setNewRowLabel]        = useState('');
  const [newRowOptions,      setNewRowOptions]      = useState<string[]>([]);
  const [newRowOptionInput,  setNewRowOptionInput]  = useState('');
  // Edit existing custom field
  const [editingFieldId,     setEditingFieldId]     = useState<string | null>(null);
  const [editFieldLabel,     setEditFieldLabel]     = useState('');
  const [editFieldOptions,   setEditFieldOptions]   = useState<string[]>([]);
  const [editFieldOptionInput, setEditFieldOptionInput] = useState('');

  // Continuous voice dictation (records until stop) + AI clean-up — for the note
  // field and for the contact-log ("תיעוד הפנייה") details field.
  const noteDictation    = useDictation(setNewNote,     { onToast });
  const contactDictation = useDictation(setContactNote, { onToast });

  const toggleSolution = (name: string) => {
    setData(d => {
      const existing = d.solutions.find(s => s.name === name);
      if (existing) return { ...d, solutions: d.solutions.filter(s => s.name !== name) };
      return { ...d, solutions: [...d.solutions, { name, inProgress: false, delivered: false }] };
    });
  };

  // ── Label / field editing helpers ──────────────────────────────────────────
  const currentRightLabel    = workspace?.solutionsLabel    || t('leadModal.solutions');
  const currentLeftLabel     = workspace?.cardLeftField?.label || t('leadModal.budgetFallback');
  const currentStatusLabel   = workspace?.statusSectionLabel || t('common.status');
  const currentSourceLabel   = workspace?.sourceLabel        || t('newLead.source');
  const sourceList: string[] = workspace?.leadSources?.length
    ? workspace.leadSources
    : LEAD_SOURCES as unknown as string[];

  const fetchAiLabelSuggestions = async () => {
    if (loadingLabelAi) return;
    setLoadingLabelAi(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = getAnthropicProxy() as any;
      const industry  = workspace?.industry ?? 'כללי';
      const solutions = (workspace?.businessSolutions ?? []).join(', ') || 'שירותים כלליים';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `אתה עוזר לעסק בתחום "${industry}" לבחור כותרות לשני שדות בכרטיס ליד.
שירותים/מוצרים: ${solutions}
כותרת נוכחית לשירותים: "${currentRightLabel}"
כותרת נוכחית לשדה הכמות: "${currentLeftLabel}"

הצע 2 כותרות קצרות (עד 4 מילים, עברית מקצועית) לכל שדה.
JSON בלבד: {"right":["הצעה1","הצעה2"],"left":["הצעה1","הצעה2"]}`,
        }],
      });
      const text: string = resp?.content?.[0]?.text ?? '{}';
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setAiLabelSugg({ right: parsed.right ?? [], left: parsed.left ?? [] });
      }
    } catch (e) { console.error('AI label suggestions failed', e); }
    finally { setLoadingLabelAi(false); }
  };

  const openEditRight = () => {
    setTempRightLabel(currentRightLabel);
    setEditingRightLabel(true);
    if (aiLabelSugg.right.length === 0) fetchAiLabelSuggestions();
  };
  const openEditLeft = () => {
    setTempLeftLabel(currentLeftLabel);
    setEditingLeftLabel(true);
    if (aiLabelSugg.left.length === 0) fetchAiLabelSuggestions();
  };

  const saveRightLabel = async () => {
    if (!tempRightLabel.trim() || !onWorkspaceUpdate) return;
    setSavingLabel(true);
    await onWorkspaceUpdate({ solutionsLabel: tempRightLabel.trim() });
    setSavingLabel(false);
    setEditingRightLabel(false);
    onToast?.('הכותרת עודכנה ✓', 'success');
  };

  const saveLeftLabel = async () => {
    if (!tempLeftLabel.trim() || !onWorkspaceUpdate || !workspace?.cardLeftField) return;
    setSavingLabel(true);
    await onWorkspaceUpdate({ cardLeftField: { ...workspace.cardLeftField, label: tempLeftLabel.trim() } });
    setSavingLabel(false);
    setEditingLeftLabel(false);
    onToast?.('הכותרת עודכנה ✓', 'success');
  };

  const addSolutionItem = async () => {
    if (!newSolItem.trim() || !onWorkspaceUpdate) return;
    const updated = [...(workspace?.businessSolutions ?? []), newSolItem.trim()];
    await onWorkspaceUpdate({ businessSolutions: updated });
    setNewSolItem('');
    onToast?.('שירות נוסף ✓', 'success');
  };

  const removeSolutionItem = async (name: string) => {
    if (!onWorkspaceUpdate) return;
    const updated = (workspace?.businessSolutions ?? []).filter(s => s !== name);
    await onWorkspaceUpdate({ businessSolutions: updated });
    onToast?.('שירות הוסר', 'info');
  };

  const saveQuickOpts = async () => {
    if (!onWorkspaceUpdate || !workspace?.cardLeftField) return;
    const nums = tempQuickOpts.map(v => parseInt(v)).filter(n => !isNaN(n) && n > 0);
    if (nums.length === 0) return;
    await onWorkspaceUpdate({ cardLeftField: { ...workspace.cardLeftField, quickOptions: nums } });
    setEditingQuickOpts(false);
    onToast?.('אפשרויות מהירות עודכנו ✓', 'success');
  };

  // ── Status label ───────────────────────────────────────────────────────────
  const saveStatusLabel = async () => {
    if (!tempStatusLabel.trim() || !onWorkspaceUpdate) return;
    setSavingStatusLabel(true);
    await onWorkspaceUpdate({ statusSectionLabel: tempStatusLabel.trim() });
    setSavingStatusLabel(false);
    setEditingStatusLabel(false);
    onToast?.('הכותרת עודכנה ✓', 'success');
  };

  // ── Source label + list ────────────────────────────────────────────────────
  const saveSourceLabel = async () => {
    if (!tempSourceLabel.trim() || !onWorkspaceUpdate) return;
    setSavingSourceLabel(true);
    await onWorkspaceUpdate({ sourceLabel: tempSourceLabel.trim() });
    setSavingSourceLabel(false);
    setEditingSourceLabel(false);
    onToast?.('הכותרת עודכנה ✓', 'success');
  };

  const addSourceItem = async () => {
    if (!newSourceItem.trim() || !onWorkspaceUpdate) return;
    const updated = [...sourceList, newSourceItem.trim()];
    await onWorkspaceUpdate({ leadSources: updated });
    setNewSourceItem('');
    onToast?.('מקור נוסף ✓', 'success');
  };

  const removeSourceItem = async (s: string) => {
    if (!onWorkspaceUpdate) return;
    const updated = sourceList.filter(x => x !== s);
    await onWorkspaceUpdate({ leadSources: updated });
    onToast?.('מקור הוסר', 'info');
  };

  // ── Custom row helpers ──────────────────────────────────────────────────────
  const addCustomRow = async () => {
    if (!newRowLabel.trim() || !onWorkspaceUpdate) return;
    const existing: import('../types').CustomFieldDef[] = (workspace as any)?.customFieldDefs ?? [];
    const newDef: import('../types').CustomFieldDef = {
      id: `cf_${Date.now()}`,
      label: newRowLabel.trim(),
      options: newRowOptions,
      multiSelect: false,
    };
    await onWorkspaceUpdate({ customFieldDefs: [...existing, newDef] });
    setNewRowLabel('');
    setNewRowOptions([]);
    setNewRowOptionInput('');
    setAddingCustomRow(false);
    onToast?.('שורה נוספת ✓', 'success');
  };

  const deleteCustomRow = async (fieldId: string) => {
    if (!onWorkspaceUpdate) return;
    const existing: import('../types').CustomFieldDef[] = (workspace as any)?.customFieldDefs ?? [];
    await onWorkspaceUpdate({ customFieldDefs: existing.filter(f => f.id !== fieldId) });
    onToast?.('השורה נמחקה', 'info');
  };

  const startEditField = (fieldDef: import('../types').CustomFieldDef) => {
    setEditingFieldId(fieldDef.id);
    setEditFieldLabel(fieldDef.label);
    setEditFieldOptions([...fieldDef.options]);
    setEditFieldOptionInput('');
  };

  const saveEditField = async () => {
    if (!editingFieldId || !onWorkspaceUpdate) return;
    const existing: import('../types').CustomFieldDef[] = (workspace as any)?.customFieldDefs ?? [];
    const updated = existing.map(f =>
      f.id === editingFieldId ? { ...f, label: editFieldLabel.trim() || f.label, options: editFieldOptions } : f
    );
    await onWorkspaceUpdate({ customFieldDefs: updated });
    setEditingFieldId(null);
    onToast?.('השורה עודכנה ✓', 'success');
  };

  const cancelEditField = () => {
    setEditingFieldId(null);
    setEditFieldLabel('');
    setEditFieldOptions([]);
    setEditFieldOptionInput('');
  };

  // ── Activity log helper ────────────────────────────────────────────────────
  const appendActivity = (type: LeadActivityType, content: string, metadata?: Record<string, string>): LeadActivity[] => {
    const entry: LeadActivity = {
      id: Date.now().toString(),
      type,
      content,
      author: currentUser || 'מנהל',
      timestamp: new Date().toISOString(),
      metadata,
    };
    return [...(data.activityLog || []), entry];
  };

  // ── Contact log submit ─────────────────────────────────────────────────────
  const handleLogContact = () => {
    if (!contactNote.trim()) return;
    const contactLabels: Record<ContactMethod, string> = {
      phone: 'שיחת טלפון', email: 'מייל', whatsapp: 'וואטסאפ', in_person: 'פגישה פנים-אל-פנים',
      meeting: 'פגישה נקבעה', quote: 'הצעת מחיר נשלחה', no_answer: 'לא ענה',
      custom: customContactLabel || 'תיעוד מותאם',
    };
    const followUpDate = followUpDays
      ? new Date(Date.now() + parseInt(followUpDays) * 86400000).toISOString()
      : undefined;
    let newLog = appendActivity(
      contactType,
      `${contactLabels[contactType]}: ${contactNote.trim()}`,
      followUpDate ? { followUpDate, followUpDays } : undefined,
    );

    // If creating a follow-up task, add it to the lead's task list
    let extraTasks = data.tasks;
    if (postContactAction === 'task' && postContactTaskDesc.trim() && followUpDate) {
      const taskDateStr = new Date(followUpDate).toISOString().split('T')[0];
      extraTasks = [...data.tasks, {
        id: Date.now().toString(),
        description: postContactTaskDesc.trim(),
        date: taskDateStr,
        time: '09:00',
        completed: false,
        priority: postContactTaskPriority,
      }];
      // Also log the task creation in activity
      newLog = [
        ...newLog,
        {
          id: (Date.now() + 1).toString(),
          type: 'task' as LeadActivityType,
          text: `משימה נוצרה: ${postContactTaskDesc.trim()} — ${taskDateStr}`,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    // "לא ענה" keeps a running counter + timestamp so automations can act on
    // "didn't answer N times" / "N hours since the last unanswered attempt".
    const isNoAnswer = contactType === 'no_answer';
    const updated: Lead = {
      ...data,
      activityLog: newLog,
      tasks: extraTasks,
      lastContactDate: new Date().toISOString(),
      contactMethod: contactType,
      ...(followUpDate ? { nextFollowUpDate: followUpDate } : {}),
      ...(isNoAnswer
        ? { noAnswerCount: (data.noAnswerCount ?? 0) + 1, lastNoAnswerAt: new Date().toISOString() }
        : { noAnswerCount: 0 }),   // a real answer resets the streak
    };
    setData(updated);
    onUpdate(updated);
    setShowContactModal(false);
    setContactNote('');
    setFollowUpDays('');

    // Trigger post-contact automatic actions
    if (postContactAction === 'email') {
      setTimeout(() => setShowEmail(true), 150);
    } else if (postContactAction === 'whatsapp') {
      setTimeout(() => setShowWhatsApp(true), 150);
    }

    setPostContactAction('none');
    setPostContactTaskDesc('');
    onToast?.('הפנייה תועדה בהצלחה ✓', 'success');
  };

  // ── Meeting scheduling ─────────────────────────────────────────────────────
  function buildGCalUrl(m: { title: string; date: string; time: string; duration: number; location?: string; notes?: string; attendeeEmail?: string }) {
    const start = new Date(`${m.date}T${m.time}:00`);
    const end = new Date(start.getTime() + m.duration * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const p = new URLSearchParams({
      action: 'TEMPLATE', text: m.title,
      dates: `${fmt(start)}/${fmt(end)}`,
      ...(m.location ? { location: m.location } : {}),
      ...(m.notes ? { details: m.notes } : {}),
      ...(m.attendeeEmail ? { add: m.attendeeEmail } : {}),
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  function buildOutlookUrl(m: { title: string; date: string; time: string; duration: number; location?: string; notes?: string }) {
    const start = new Date(`${m.date}T${m.time}:00`);
    const end = new Date(start.getTime() + m.duration * 60000);
    const p = new URLSearchParams({
      path: '/calendar/action/compose', rru: 'addevent',
      subject: m.title,
      startdt: start.toISOString(),
      enddt: end.toISOString(),
      ...(m.location ? { location: m.location } : {}),
      ...(m.notes ? { body: m.notes } : {}),
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`;
  }

  const handleScheduleMeeting = (provider: 'google' | 'outlook' = 'google') => {
    if (!meetingTitle.trim() || !meetingDate) return;
    const meetingInput = {
      title: meetingTitle, date: meetingDate, time: meetingTime,
      duration: meetingDuration, location: meetingLocation || undefined,
      notes: meetingNotes || undefined, attendeeEmail: data.email || undefined,
    };
    const calUrl = buildGCalUrl(meetingInput);
    const outlookUrl = buildOutlookUrl(meetingInput);
    const openUrl = provider === 'outlook' ? outlookUrl : calUrl;
    const meeting: LeadMeeting = {
      id: Date.now().toString(),
      title: meetingTitle.trim(),
      date: meetingDate, time: meetingTime,
      duration: meetingDuration,
      location: meetingLocation || undefined,
      notes: meetingNotes || undefined,
      attendeeEmail: data.email || undefined,
      calendarLink: calUrl,
      createdAt: new Date().toISOString(),
      createdBy: currentUser || 'מנהל',
    };
    const newLog = appendActivity('meeting', `פגישה נקבעה: ${meetingTitle} — ${meetingDate} ${meetingTime}`, { meetingId: meeting.id, calendarLink: calUrl });
    const updated: Lead = {
      ...data,
      meetings: [...(data.meetings || []), meeting],
      activityLog: newLog,
    };
    setData(updated);
    onUpdate(updated);
    window.open(openUrl, '_blank');
    setShowMeetingModal(false);
    setMeetingTitle(''); setMeetingDate(''); setMeetingTime('10:00');
    setMeetingDuration(60); setMeetingLocation(''); setMeetingNotes('');
    onToast?.(provider === 'outlook' ? 'הפגישה נקבעה ונפתחה ב-Outlook ✓' : 'הפגישה נקבעה ונפתחה ב-Google Calendar ✓', 'success');
  };

  // ── Status change with objection intercept ─────────────────────────────────
  // Fire a status' automation playbook (single task + sequence) when a lead enters it.
  const withAutomation = (updated: Lead, newStatus: LeadStatus): Lead => {
    if (newStatus === data.status) return updated;   // only on real transition
    const cfg = getStatusConfig(newStatus, statusConfigs ?? DEFAULT_STATUS_CONFIGS);
    const autoTasks = buildAutomationTasks(cfg, updated, currentUser || '');
    if (!autoTasks.length) return updated;
    onToast?.(`⚙️ נוצרו ${autoTasks.length} משימות אוטומטיות לסטטוס "${newStatus}"`, 'info');
    return { ...updated, tasks: [...updated.tasks, ...autoTasks] };
  };

  const handleStatusChange = (newStatus: LeadStatus) => {
    if (newStatus === 'לא רלוונטי' && data.status !== 'לא רלוונטי') {
      setPendingStatus(newStatus);
      setShowObjectionModal(true);
      return;
    }
    const newLog = appendActivity('status_change', `סטטוס שונה מ"${data.status}" ל"${newStatus}"`);
    const updated = withAutomation({ ...data, status: newStatus, activityLog: newLog }, newStatus);
    setData(updated);
    onUpdate(updated);
  };

  const handleObjectionConfirm = () => {
    if (!pendingStatus) return;
    const objText = selectedObjection || 'לא צוינה סיבה';
    const newLog = appendActivity('objection', `סומן כ"לא רלוונטי" — ${objText}`, { objection: objText });
    const updated: Lead = withAutomation({
      ...data,
      status: pendingStatus,
      objection: objText,
      activityLog: newLog,
    }, pendingStatus);
    setData(updated);
    onUpdate(updated);
    setShowObjectionModal(false);
    setPendingStatus(null);
    setSelectedObjection('');
  };

  const addNote = () => {
    if (!newNote.trim()) return;
    const newLog = appendActivity('note', newNote.trim());
    const updated = {
      ...data,
      notes: [...data.notes, {
        id: Date.now().toString(),
        text: newNote.trim(),
        author: currentUser || 'מנהל',
        timestamp: new Date().toLocaleString('he-IL'),
      }],
      activityLog: newLog,
    };
    setData(updated);
    onUpdate(updated);
    setNewNote('');
  };

  const addTask = () => {
    if (!newTaskDesc.trim() || !newTaskDate) return;
    const newLog = appendActivity('task', `משימה נוצרה: ${newTaskDesc.trim()} — ${newTaskDate} ${newTaskTime}`);
    const updated = {
      ...data,
      tasks: [...data.tasks, {
        id: Date.now().toString(),
        description: newTaskDesc.trim(),
        date: newTaskDate,
        time: newTaskTime,
        completed: false,
        priority: newTaskPriority,
      }],
      activityLog: newLog,
    };
    setData(updated);
    onUpdate(updated);
    setNewTaskDesc('');
    setNewTaskDate('');
  };

  const toggleTask = (id: string) => {
    const updated = { ...data, tasks: data.tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t) };
    setData(updated);
    onUpdate(updated);
  };

  const deleteTask = (id: string) => {
    const updated = { ...data, tasks: data.tasks.filter(t => t.id !== id) };
    setData(updated);
    onUpdate(updated);
  };

  // ── AI: Next Best Action ────────────────────────────────────────────────────
  const handleNextBestAction = async () => {
    setNbaLoading(true);
    setNba(null);
    try {
      const client = getAnthropicProxy();
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const recentNotes = (data.notes ?? []).slice(-3).map(n => `- ${n.text}`).join('\n');
      const recentActivity = (data.activityLog ?? []).slice(-5).map(a => `- ${a.type}: ${a.content}`).join('\n');
      const ctx = [
        `לקוח: ${data.company}${data.contactName ? ` (${data.contactName})` : ''}`,
        `סטטוס: ${data.status}`,
        data.source ? `מקור: ${data.source}` : '',
        data.solutions?.length ? `פתרונות: ${data.solutions.map(s => s.name).join(', ')}` : '',
        data.lastContactDate ? `יצירת קשר אחרונה: ${data.lastContactDate.slice(0, 10)}` : 'טרם נוצר קשר',
        data.nextFollowUpDate ? `מעקב מתוכנן: ${data.nextFollowUpDate}` : '',
        (data as { objection?: string }).objection ? `התנגדות: ${(data as { objection?: string }).objection}` : '',
        recentNotes ? `הערות אחרונות:\n${recentNotes}` : '',
        recentActivity ? `פעילות אחרונה:\n${recentActivity}` : '',
      ].filter(Boolean).join('\n');

      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `אתה מנהל מכירות בכיר. בהינתן מצב הליד, קבע את הפעולה הבאה הכי אפקטיבית לקידום העסקה. היום ${todayIso}. החזר אך ורק JSON:
{"action":"כותרת קצרה לפעולה","reason":"משפט אחד למה זו הפעולה הנכונה עכשיו","taskDescription":"תיאור משימה מעשי","date":"YYYY-MM-DD","time":"HH:MM","priority":"high|medium|low"}
החזר JSON בלבד.`,
        messages: [{ role: 'user', content: ctx }],
      });
      const raw = (resp.content?.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined)?.text ?? '';
      const s = raw.replace(/```json\s*/i, '').replace(/```/g, '').trim();
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      const p = JSON.parse(a !== -1 ? s.slice(a, b + 1) : s) as { action?: string; reason?: string; taskDescription?: string; date?: string; time?: string; priority?: TaskPriority };
      setNba({
        action: p.action || 'המשך טיפול בליד',
        reason: p.reason || '',
        task: {
          description: p.taskDescription || p.action || 'מעקב',
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date! : todayIso,
          time: /^\d{2}:\d{2}$/.test(p.time || '') ? p.time! : '09:00',
          priority: ['high', 'medium', 'low'].includes(p.priority as string) ? p.priority! : 'medium',
        },
      });
    } catch (err) {
      console.error('[nba]', err);
      onToast?.('לא הצלחתי להפיק המלצה — נסה שוב', 'error');
    } finally {
      setNbaLoading(false);
    }
  };

  const createNbaTask = () => {
    if (!nba) return;
    const newLog = appendActivity('task', `משימה נוצרה (AI): ${nba.task.description} — ${nba.task.date} ${nba.task.time}`);
    const updated = {
      ...data,
      tasks: [...data.tasks, {
        id: Date.now().toString(),
        description: nba.task.description,
        date: nba.task.date,
        time: nba.task.time,
        completed: false,
        priority: nba.task.priority,
      }],
      activityLog: newLog,
    };
    setData(updated);
    onUpdate(updated);
    setNba(null);
    onToast?.('✅ המשימה נוצרה', 'success');
  };

  /* ── AI Company Research ─────────────────────────────────────────────────── */
  const runAiResearch = async () => {
    // Check token balance before making the API call
    if (workspace?.id) {
      const hasBal = await hasBalance(workspace.id);
      if (!hasBal) {
        setAiInsightError('⚠️ אין מספיק טוקנים. רכוש טוקנים נוספים בדף החיוב.');
        setShowInsight(true);
        return;
      }
    }

    setAiScoring(true);
    setShowInsight(true);
    setAiInsight(null);
    setAiInsightText('');
    setAiInsightError('');

    try {
      const client = getAnthropicProxy();

      const bizName     = workspace?.name      ?? 'Our Business';
      const bizIndustry = workspace?.industry   ?? '';
      const bizServices = solutionsList.join(', ');
      const aiProfile   = workspace?.aiProfile;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reqPayload: any = {
        model: 'claude-opus-4-6',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `אתה אנליסט מכירות של ${bizName} — עסק בתחום ${bizIndustry}.
השירותים שאנו מציעים: ${bizServices}.
${aiProfile?.idealClient ? `לקוח אידיאלי: ${aiProfile.idealClient}` : ''}
${aiProfile?.uniqueValue ? `הייחוד שלנו: ${aiProfile.uniqueValue}` : ''}
חפש מידע על החברה הבאה ותן תמצית מכירות שתעזור לצוות.
ענה בעברית, בצורה קצרה וממוקדת.
פורמט:
🏢 **סקירה**: [2-3 משפטים על החברה]
🏭 **תחום**: [תחום הפעילות]
📊 **גודל**: [עובדים/היקף אם ידוע]
💡 **זווית מכירה**: [למה הפתרונות של ${bizName} מתאימים לחברה זו]
🔥 **רמת עניין**: [הערכת התאמה ללקוח האידיאלי]`,
        messages: [{
          role: 'user',
          content: `חפש מידע עדכני על החברה: "${data.company}".
מידע שיש לי: סטטוס=${data.status}, תקציב=₪${data.budget}/חודש, שירותים שמעניינים=${data.solutions.map(s => s.name).join(', ') || 'לא ידוע'}.
תן לי מידע שיעזור לי למכור להם את השירותים של ${bizName}.`,
        }],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let finalText = '';
      const searchedFor: string[] = [];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Agentic loop for web search
      for (let turn = 0; turn < 4; turn++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await (client.messages as any).create(reqPayload);
        totalInputTokens += response.usage?.input_tokens ?? 0;
        totalOutputTokens += response.usage?.output_tokens ?? 0;
        const content: unknown[] = response.content || [];

        const textParts = content
          .filter((b: unknown) => (b as { type: string }).type === 'text')
          .map((b: unknown) => (b as { text: string }).text)
          .join('');

        const toolUses = content.filter(
          (b: unknown) => (b as { type: string }).type === 'tool_use'
        ) as { id: string; name: string; input: { query?: string } }[];

        // Stream text to UI as it builds up
        if (textParts) {
          finalText = textParts;
          setAiInsightText(finalText);
        }

        // Track search queries
        for (const tu of toolUses) {
          if (tu.name === 'web_search' && tu.input?.query) {
            searchedFor.push(tu.input.query);
          }
        }

        if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
          // Also update AI score based on status
          const scoreMap: Record<string, number> = {
            'לקוח פעיל': 85, 'בתהליך': 65,
            'חדש': 40, 'רימרקטינג': 30, 'לא רלוונטי': 10,
          };
          const baseScore = scoreMap[data.status] ?? 35;
          const budgetBonus = Math.min(20, Math.floor((data.budget ?? 0) / 2000));
          const solutionsBonus = Math.min(10, data.solutions.length * 3);
          const score = Math.min(99, baseScore + budgetBonus + solutionsBonus);
          setData(d => ({ ...d, aiScore: score }));
          setAiInsight({ summary: finalText, sources: searchedFor });
          // Deduct tokens after research completes
          try {
            const cost = calculateCost('claude-opus-4-6', totalInputTokens, totalOutputTokens);
            if (workspace?.id) await deductTokens(workspace.id, cost, 'claude-opus-4-6', 'Lead enrichment');
          } catch (trackErr) {
            console.error('Token tracking failed:', trackErr);
          }
          break;
        }

        if (response.stop_reason === 'tool_use') {
          reqPayload.messages = [
            ...reqPayload.messages,
            {
              role: 'assistant',
              content: content.filter(
                (b: unknown) => ['text', 'tool_use'].includes((b as { type: string }).type)
              ),
            },
            {
              role: 'user',
              content: toolUses.map(tu => ({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: [{ type: 'text', text: 'Search results will be provided.' }],
              })),
            },
          ];
        }
      }
    } catch (err) {
      console.error('AI research failed:', err);
      setAiInsightError(t('leadModal.aiSearchError'));
      // Fallback: just update score
      const scoreMap: Record<string, number> = {
        'לקוח פעיל': 85, 'בתהליך': 65,
        'חדש': 40, 'רימרקטינג': 30, 'לא רלוונטי': 10,
      };
      const budgetBonus = Math.min(20, Math.floor((data.budget ?? 0) / 2000));
      const score = Math.min(99, (scoreMap[data.status] ?? 35) + budgetBonus);
      setData(d => ({ ...d, aiScore: score }));
    } finally {
      setAiScoring(false);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => { onSave(data); }, 500);
  };

  const completedTasks = data.tasks.filter(t => t.completed).length;
  const scoreColor = data.aiScore >= 75 ? '#22c55e' : data.aiScore >= 50 ? '#f97316' : '#818cf8';

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'details',  label: t('leadModal.tab.details'),  icon: <Building2 size={13} /> },
    { key: 'tasks',    label: t('leadModal.tab.tasks'),    icon: <ListChecks size={13} />, badge: data.tasks.filter(t => !t.completed).length },
    { key: 'activity', label: t('leadModal.tab.activity'), icon: <Activity size={13} /> },
    { key: 'agents',   label: `${t('leadModal.tab.agents')} ⚡`, icon: <Sparkles size={13} /> },
  ];

  return (
    <>
      {/* Card Customize Panel */}
      {showCustomize && (
        <CardCustomizePanel
          layout={cardLayout}
          statuses={(statusConfigs ?? DEFAULT_STATUS_CONFIGS).map(c => c.label)}
          onSave={handleSaveLayout}
          onClose={() => setShowCustomize(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm md:p-4 overflow-y-auto">
        {/* Status color accent — left border of the modal */}
        <div
          className="bg-slate-900 text-white md:rounded-2xl w-full md:max-w-2xl md:my-4 shadow-2xl border-0 md:border border-slate-700/50 overflow-hidden min-h-screen md:min-h-0"
          style={cardLayout.statusColors[data.status] ? { borderRight: `4px solid ${cardLayout.statusColors[data.status]}` } : {}}
        >

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="relative bg-gradient-to-l from-slate-800 to-slate-900 border-b border-slate-700/60">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors p-1.5 hover:bg-slate-700 rounded-lg flex-shrink-0"
              >
                <X size={16} />
              </button>

              <div className="flex-1 text-right mx-4">
                {editingContact ? (
                  /* ── Edit contact details ─────────────────────────────── */
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 justify-end mb-1">
                      <button onClick={toggleHot} title={data.isHot ? 'הסר סימון ליד חם' : 'סמן כליד חם'}
                        className={`p-1 rounded transition-all ${data.isHot ? 'text-orange-400 hover:text-orange-300' : 'text-slate-600 hover:text-orange-400 hover:bg-slate-700'}`}>
                        <Flame size={14} className={data.isHot ? 'fill-orange-400' : ''} />
                      </button>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[data.status]}`}>{data.status}</span>
                      <input autoFocus value={data.company} onChange={e => setData(d => ({ ...d, company: e.target.value }))}
                        placeholder="שם החברה"
                        className="flex-1 bg-slate-700/80 border border-indigo-500/60 text-white text-base font-bold px-2 py-1 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <input value={data.contactName} onChange={e => setData(d => ({ ...d, contactName: e.target.value }))}
                      placeholder="שם איש הקשר"
                      className="w-full bg-slate-700/80 border border-slate-600/60 text-slate-200 text-sm px-2 py-1 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={data.phone} onChange={e => setData(d => ({ ...d, phone: e.target.value }))}
                        placeholder="טלפון" dir="ltr"
                        className="bg-slate-700/80 border border-slate-600/60 text-slate-200 text-xs px-2 py-1 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <input value={data.email} onChange={e => setData(d => ({ ...d, email: e.target.value }))}
                        placeholder="אימייל" dir="ltr"
                        className="bg-slate-700/80 border border-slate-600/60 text-slate-200 text-xs px-2 py-1 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <button onClick={() => setEditingContact(false)}
                      className="mt-1 flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300 justify-end w-full">
                      <Check size={12} /> סיום עריכה (נשמר אוטומטית)
                    </button>
                  </div>
                ) : (
                  /* ── Display contact details ──────────────────────────── */
                  <>
                    <div className="flex items-center gap-2 justify-end mb-1">
                      <button onClick={() => setEditingContact(true)} title="ערוך פרטי קשר"
                        className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-white transition-all">
                        <Pencil size={12} />
                      </button>
                      <button onClick={toggleHot} title={data.isHot ? 'הסר סימון ליד חם' : 'סמן כליד חם'}
                        className={`p-1 rounded transition-all ${data.isHot ? 'text-orange-400 hover:text-orange-300' : 'text-slate-600 hover:text-orange-400 hover:bg-slate-700'}`}>
                        <Flame size={14} className={data.isHot ? 'fill-orange-400' : ''} />
                      </button>
                      {data.isHot && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border border-orange-500/40 bg-orange-500/15 text-orange-400">
                          <Flame size={10} className="fill-orange-400" /> חם
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[data.status]}`}>
                        {data.status}
                      </span>
                      <h2 className="text-xl font-bold text-white leading-none">{data.company}</h2>
                    </div>
                    <p className="text-slate-400 text-sm">{data.contactName}</p>
                    <div className="flex items-center gap-3 mt-1.5 justify-end flex-wrap">
                      {data.email && (
                        <a href={`mailto:${data.email}`}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                          <Mail size={11} />{data.email}
                        </a>
                      )}
                      {data.phone && (
                        <a href={`tel:${data.phone}`}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                          <Phone size={11} />{data.phone}
                        </a>
                      )}
                    </div>
                    {data.source && (
                      <div className="flex items-center gap-1 text-xs text-slate-500 justify-end mt-1">
                        <span className="bg-slate-700/50 px-2 py-0.5 rounded-full">{data.source}</span>
                        <span className="text-slate-600">מקור</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* AI Score */}
              <div className="flex-shrink-0 flex flex-col items-center gap-1">
                <div
                  className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center border-2 shadow-lg"
                  style={{ borderColor: scoreColor + '60', background: scoreColor + '15' }}
                >
                  <div className="text-2xl font-black leading-none" style={{ color: scoreColor }}>
                    {data.aiScore}
                  </div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">AI</div>
                </div>
                <div className="w-16 bg-slate-700/60 rounded-full h-1">
                  <div className="h-1 rounded-full transition-all duration-700"
                    style={{ width: `${data.aiScore}%`, background: `linear-gradient(to right, #404040, #f97316)` }} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 px-4 md:px-5 pb-4 flex-wrap">
              {data.phone && (
                <button
                  onClick={() => setShowWhatsApp(true)}
                  className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg hover:shadow-green-500/20"
                >
                  <MessageCircle size={13} />WhatsApp ✨
                </button>
              )}

              {/* SMART EMAIL BUTTON */}
              {data.email && (
                <button
                  onClick={() => setShowEmail(true)}
                  className="flex items-center gap-1.5 bg-neutral-800 hover:bg-black text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg"
                >
                  <Mail size={13} />{t('leadModal.sendEmail')} ✨
                </button>
              )}

              {data.phone && (
                <button
                  onClick={() => window.open(`tel:${data.phone}`, '_blank')}
                  className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Phone size={13} />{t('leadModal.call')}
                </button>
              )}

              {/* CONTACT LOG BUTTON */}
              <button
                onClick={() => setShowContactModal(true)}
                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg hover:shadow-amber-500/20"
              >
                <PhoneCall size={13} />תיעוד פנייה
              </button>

              {/* MEETING BUTTON */}
              <button
                onClick={() => setShowMeetingModal(true)}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:shadow-lg hover:shadow-purple-500/20"
              >
                <Calendar size={13} />קבע פגישה
              </button>

              {/* CUSTOMIZE BUTTON */}
              {onWorkspaceUpdate && (
                <button
                  onClick={() => setShowCustomize(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    showCustomize
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                      : 'bg-white/10 hover:bg-white/20 border border-white/20 text-slate-300 hover:text-white'
                  }`}
                >
                  🎨 עיצוב
                </button>
              )}

              {/* AI RESEARCH BUTTON */}
              <button
                onClick={runAiResearch}
                disabled={aiScoring}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all mr-auto"
              >
                {aiScoring ? (
                  <><Loader2 size={13} className="animate-spin" />{t('leadModal.aiScoring')}</>
                ) : (
                  <><Brain size={13} />{t('leadModal.aiScore')}</>
                )}
              </button>

              {/* NEXT BEST ACTION BUTTON */}
              <button
                onClick={handleNextBestAction}
                disabled={nbaLoading}
                className="flex items-center gap-1.5 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)' }}
              >
                {nbaLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                הפעולה הבאה
              </button>
            </div>

            {/* NEXT BEST ACTION RESULT */}
            {nba && (
              <div className="mx-4 md:mx-5 mb-4 rounded-xl p-3.5 border" style={{ background: 'rgba(124,58,237,0.12)', borderColor: 'rgba(139,92,246,0.4)' }}>
                <div className="flex items-start gap-2">
                  <Sparkles size={16} className="text-violet-300 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-white">🎯 {nba.action}</p>
                    {nba.reason && <p className="text-xs text-slate-300 mt-0.5">{nba.reason}</p>}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800/70 text-slate-300">📋 {nba.task.description}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800/70 text-slate-400">📅 {nba.task.date} {nba.task.time}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button onClick={createNbaTask}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                        ✓ צור משימה
                      </button>
                      <button onClick={() => setNba(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">בטל</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Research Panel */}
            {showInsight && (
              <div className="mx-5 mb-4 bg-slate-800/80 border border-white/20 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/50">
                  <button
                    onClick={() => setShowInsight(false)}
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <X size={14} />
                  </button>
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
                    {aiScoring ? (
                      <><Loader2 size={12} className="animate-spin" /><Globe size={12} />{t('leadModal.aiScoring')} {data.company}...</>
                    ) : (
                      <><Globe size={12} />{t('leadModal.aiScore')} — {data.company}</>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {aiInsightError ? (
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle size={13} />{aiInsightError}
                    </div>
                  ) : aiInsightText ? (
                    <>
                      {aiInsightText}
                      {aiScoring && <span className="inline-block w-1 h-3.5 bg-neutral-400 animate-pulse ml-0.5 rounded-sm" />}
                      {aiInsight?.sources && aiInsight.sources.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-wrap gap-1">
                          {aiInsight.sources.map((s, i) => (
                            <span key={i} className="flex items-center gap-1 bg-indigo-900/40 text-indigo-400 px-1.5 py-0.5 rounded text-[10px]">
                              <Globe size={8} />{s}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 size={12} className="animate-spin" />{t('ai.searching')}...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Tabs ───────────────────────────────────────────────────────── */}
          <div className="flex border-b border-slate-700/60 bg-slate-800/50">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-all ${
                  activeTab === tab.key
                    ? 'text-white border-b-2 border-white bg-slate-800'
                    : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center ${
                    activeTab === tab.key ? 'bg-white text-black' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab Content ────────────────────────────────────────────────── */}
          <div className={`p-4 md:p-5 max-h-[calc(100vh-280px)] md:max-h-[55vh] overflow-y-auto ${cardLayout.viewMode === 'compact' ? 'space-y-2' : 'space-y-4'}`}>

            {/* DETAILS TAB */}
            {activeTab === 'details' && (
              <>
                {/* ── Highlight Fields Banner ── */}
                {cardLayout.highlightFields.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {cardLayout.highlightFields.map(field => {
                      let value: string | number | undefined;
                      let label = field;
                      if (field === 'budget') { value = data.budget ? `${workspace?.cardLeftField?.prefix ?? '₪'}${(data.budget).toLocaleString()}` : undefined; label = workspace?.cardLeftField?.label ?? 'תקציב'; }
                      else if (field === 'status') { value = data.status; label = workspace?.statusSectionLabel ?? 'סטטוס'; }
                      else if (field === 'source') { value = data.source; label = workspace?.sourceLabel ?? 'מקור'; }
                      else if (field === 'aiScore') { value = `${data.aiScore}%`; label = 'AI'; }
                      else if (field === 'solutions') { value = data.solutions.length > 0 ? `${data.solutions.length} שירותים` : undefined; label = workspace?.solutionsLabel ?? 'שירותים'; }
                      else if (field === 'assignedTo') { value = data.assignedTo; label = 'אחראי'; }
                      if (!value) return null;
                      return (
                        <div key={field} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-900/30 border border-indigo-500/30 text-xs">
                          <span className="text-indigo-300 font-bold">{value}</span>
                          <span className="text-slate-500">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Render sections in user-defined order with visibility control */}
                {(() => {
                  const sectionJSX: Record<string, React.ReactNode> = {
                    prices: (
                      <div className={`grid gap-4 ${cardLayout.columnLayout === '1col' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {/* Solutions */}
                  <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                    {/* Header */}
                    {editingRightLabel ? (
                      <div className="mb-3 space-y-2">
                        <input
                          autoFocus
                          value={tempRightLabel}
                          onChange={e => setTempRightLabel(e.target.value)}
                          className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-indigo-500 focus:outline-none text-right"
                          placeholder="כותרת הסעיף..."
                        />
                        {loadingLabelAi && (
                          <div className="flex justify-center py-1"><Loader2 size={12} className="animate-spin text-indigo-400" /></div>
                        )}
                        {aiLabelSugg.right.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {aiLabelSugg.right.map((s, i) => (
                              <button key={i} onClick={() => setTempRightLabel(s)}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 hover:bg-indigo-800/60 transition-colors">
                                ✨ {s}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-1.5">
                          <button onClick={() => setEditingRightLabel(false)}
                            className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">
                            ביטול
                          </button>
                          <button onClick={saveRightLabel} disabled={savingLabel}
                            className="flex-1 py-1 rounded-lg text-[10px] bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                            {savingLabel ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} שמור
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between mb-3">
                        <button onClick={openEditRight}
                          className="p-1 rounded hover:bg-slate-700 transition-all text-slate-600 hover:text-slate-300"
                          title="ערוך כותרת">
                          <Pencil size={11} />
                        </button>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          {currentRightLabel} <Zap size={11} className="text-orange-400" />
                        </h3>
                      </div>
                    )}

                    {/* Solutions list */}
                    <div className="space-y-2">
                      {solutionsList.map(sol => {
                        const active = data.solutions.find(s => s.name === sol);
                        return (
                          <div key={sol} className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              {editingSolutions && (
                                <button onClick={() => removeSolutionItem(sol)}
                                  className="text-red-400 hover:text-red-300 flex-shrink-0 p-0.5 hover:bg-red-900/30 rounded transition-colors">
                                  <X size={10} />
                                </button>
                              )}
                              <button
                                onClick={() => !editingSolutions && toggleSolution(sol)}
                                className={`flex-1 text-right px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                  active && !editingSolutions
                                    ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/20'
                                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700'
                                }`}
                              >
                                {sol}
                              </button>
                            </div>
                            {/* Price input shown when solution is active */}
                            {active && !editingSolutions && (
                              <div className="flex items-center gap-1.5 mr-1 pr-1">
                                <select
                                  value={active.priceType ?? 'monthly'}
                                  onChange={e => {
                                    const val = e.target.value as 'monthly' | 'one_time';
                                    setData(d => ({
                                      ...d,
                                      solutions: d.solutions.map(s =>
                                        s.name === sol ? { ...s, priceType: val } : s
                                      ),
                                    }));
                                  }}
                                  className="bg-slate-700 text-slate-300 text-[10px] rounded-md px-1 py-1 border border-slate-600 focus:outline-none focus:border-orange-500"
                                  style={{ direction: 'rtl' }}
                                >
                                  <option value="monthly">חודשי</option>
                                  <option value="one_time">חד-פעמי</option>
                                </select>
                                <div className="flex items-center gap-1 flex-1 bg-slate-700/60 rounded-md border border-slate-600 px-2 py-1 focus-within:border-orange-500 transition-colors">
                                  <span className="text-[10px] text-slate-400">₪</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={active.price ?? ''}
                                    onChange={e => {
                                      const val = e.target.value ? Number(e.target.value) : undefined;
                                      setData(d => ({
                                        ...d,
                                        solutions: d.solutions.map(s =>
                                          s.name === sol ? { ...s, price: val } : s
                                        ),
                                      }));
                                    }}
                                    placeholder="מחיר..."
                                    className="flex-1 bg-transparent text-white text-xs text-right focus:outline-none w-full"
                                    style={{ direction: 'rtl' }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Add solution input */}
                      {editingSolutions && (
                        <div className="flex gap-1 mt-2">
                          <button onClick={addSolutionItem} disabled={!newSolItem.trim()}
                            className="px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-[10px] font-semibold disabled:opacity-40 transition-colors">
                            הוסף
                          </button>
                          <input
                            value={newSolItem}
                            onChange={e => setNewSolItem(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addSolutionItem()}
                            placeholder="שירות חדש..."
                            className="flex-1 bg-slate-700 text-white text-xs px-2 py-1 rounded-lg border border-slate-600 focus:outline-none focus:border-orange-500 text-right"
                          />
                        </div>
                      )}
                    </div>

                    {/* Send Proposal button */}
                    {workspace && data.solutions.length > 0 && !editingSolutions && (
                      <button
                        onClick={() => setShowProposalEditor(true)}
                        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-white transition-all"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                        <FileText size={12} />
                        הפק הצעת מחיר לחתימה
                      </button>
                    )}

                    {/* Edit solutions toggle */}
                    {onWorkspaceUpdate && (
                      <button onClick={() => setEditingSolutions(v => !v)}
                        className="mt-2 w-full text-center text-[10px] text-slate-500 hover:text-slate-300 transition-colors py-0.5">
                        {editingSolutions ? '✓ סיים עריכה' : '✏️ ערוך רשימה'}
                      </button>
                    )}
                  </div>

                  {/* Budget / custom left field */}
                  {(() => {
                    const clf      = workspace?.cardLeftField;
                    const label    = clf?.label    ?? t('leadModal.budgetFallback');
                    const prefix   = clf?.prefix   ?? '₪';
                    const quickOpts = clf?.quickOptions?.length
                      ? clf.quickOptions
                      : [5000, 10000, 20000];
                    return (
                      <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                        {/* Header */}
                        {editingLeftLabel ? (
                          <div className="mb-3 space-y-2">
                            <input
                              autoFocus
                              value={tempLeftLabel}
                              onChange={e => setTempLeftLabel(e.target.value)}
                              className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-amber-500 focus:outline-none text-right"
                              placeholder="כותרת הסעיף..."
                            />
                            {loadingLabelAi && (
                              <div className="flex justify-center py-1"><Loader2 size={12} className="animate-spin text-amber-400" /></div>
                            )}
                            {aiLabelSugg.left.length > 0 && (
                              <div className="flex flex-wrap gap-1 justify-end">
                                {aiLabelSugg.left.map((s, i) => (
                                  <button key={i} onClick={() => setTempLeftLabel(s)}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-700/50 hover:bg-amber-800/60 transition-colors">
                                    ✨ {s}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1.5">
                              <button onClick={() => setEditingLeftLabel(false)}
                                className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">
                                ביטול
                              </button>
                              <button onClick={saveLeftLabel} disabled={savingLabel}
                                className="flex-1 py-1 rounded-lg text-[10px] bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {savingLabel ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} שמור
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mb-3">
                            <button onClick={openEditLeft}
                              className="p-1 rounded hover:bg-slate-700 transition-all text-slate-600 hover:text-slate-300"
                              title="ערוך כותרת">
                              <Pencil size={11} />
                            </button>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              {currentLeftLabel} <Star size={11} className="text-amber-400" />
                            </h3>
                          </div>
                        )}

                        <div className="space-y-2">
                          <input
                            type="number"
                            placeholder={`${label} (${prefix})`}
                            value={data.budget || ''}
                            onChange={e => setData(d => ({ ...d, budget: parseInt(e.target.value) || 0 }))}
                            className="w-full bg-slate-700/80 text-white placeholder-slate-500 px-3 py-2 rounded-lg text-xs text-right focus:outline-none focus:ring-2 focus:ring-orange-500 border border-slate-600/50"
                          />
                          {(data.budget ?? 0) > 0 && (
                            <div className={`text-center py-2 rounded-lg text-sm font-bold ${
                              (data.budget ?? 0) >= 15000
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-slate-700/60 text-slate-300'
                            }`}>
                              {prefix}{(data.budget ?? 0).toLocaleString()}
                              {(data.budget ?? 0) >= 15000 && ' 🌟 VIP'}
                            </div>
                          )}

                          {/* Quick option buttons */}
                          {editingQuickOpts ? (
                            <div className="space-y-2 mt-1">
                              <div className="grid grid-cols-3 gap-1">
                                {tempQuickOpts.map((v, i) => (
                                  <input
                                    key={i}
                                    type="number"
                                    value={v}
                                    onChange={e => setTempQuickOpts(prev => {
                                      const next = [...prev];
                                      next[i] = e.target.value;
                                      return next;
                                    })}
                                    placeholder={`אפשרות ${i + 1}`}
                                    className="bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-amber-500/50 focus:outline-none focus:border-amber-400 text-center"
                                  />
                                ))}
                              </div>
                              <div className="flex gap-1.5">
                                <button onClick={() => setEditingQuickOpts(false)}
                                  className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">
                                  ביטול
                                </button>
                                <button onClick={saveQuickOpts} disabled={savingLabel}
                                  className="flex-1 py-1 rounded-lg text-[10px] bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                  {savingLabel ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} שמור
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-1 mt-1 group/opts relative">
                              {quickOpts.slice(0, 3).map(val => (
                                <button
                                  key={val}
                                  onClick={() => setData(d => ({ ...d, budget: val }))}
                                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                    data.budget === val
                                      ? 'bg-orange-500 text-white'
                                      : 'bg-slate-700/80 text-slate-400 hover:bg-slate-700'
                                  }`}
                                >
                                  {prefix}{val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}K` : val}
                                </button>
                              ))}
                              {onWorkspaceUpdate && (
                                <button
                                  onClick={() => {
                                    setTempQuickOpts(quickOpts.slice(0, 3).map(String));
                                    setEditingQuickOpts(true);
                                  }}
                                  className="absolute -top-1 -left-1 opacity-0 group-hover/opts:opacity-100 p-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-all"
                                  title="ערוך אפשרויות מהירות"
                                >
                                  <Pencil size={9} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                    ),
                    status: (
                      <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                        {editingStatusLabel ? (
                          <div className="mb-3 space-y-2">
                            <input autoFocus value={tempStatusLabel} onChange={e => setTempStatusLabel(e.target.value)}
                              className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-indigo-500 focus:outline-none text-right"
                              placeholder="כותרת הסעיף..." onKeyDown={e => e.key === 'Enter' && saveStatusLabel()} />
                            <div className="flex gap-1.5">
                              <button onClick={() => setEditingStatusLabel(false)} className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">ביטול</button>
                              <button onClick={saveStatusLabel} disabled={savingStatusLabel} className="flex-1 py-1 rounded-lg text-[10px] bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {savingStatusLabel ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} שמור
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{currentStatusLabel}</span>
                              {onWorkspaceUpdate && (
                                <button onClick={() => { setTempStatusLabel(currentStatusLabel); setEditingStatusLabel(true); }}
                                  className="p-1 rounded hover:bg-slate-700 transition-all text-slate-600 hover:text-slate-300" title="ערוך כותרת">
                                  <Pencil size={11} />
                                </button>
                              )}
                            </div>
                            <StatusBadge status={data.status} />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {configStatuses.map(s => {
                            const cfg = getStatusConfig(s, statusConfigs);
                            const isActive = data.status === s;
                            return (
                              <button key={s} onClick={() => handleStatusChange(s)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1"
                                style={isActive ? { background: cfg.color, color: 'white', boxShadow: `0 0 8px ${cfg.color}66` }
                                  : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.65)', border: `1px solid ${cfg.color}33` }}>
                                <span>{cfg.emoji}</span><span>{s}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ),
                    source: (
                      <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                        {editingSourceLabel ? (
                          <div className="mb-3 space-y-2">
                            <input autoFocus value={tempSourceLabel} onChange={e => setTempSourceLabel(e.target.value)}
                              className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-amber-500 focus:outline-none text-right"
                              placeholder="כותרת הסעיף..." onKeyDown={e => e.key === 'Enter' && saveSourceLabel()} />
                            <div className="flex gap-1.5">
                              <button onClick={() => setEditingSourceLabel(false)} className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">ביטול</button>
                              <button onClick={saveSourceLabel} disabled={savingSourceLabel} className="flex-1 py-1 rounded-lg text-[10px] bg-amber-600 text-white hover:bg-amber-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {savingSourceLabel ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} שמור
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{currentSourceLabel}</span>
                              {onWorkspaceUpdate && (
                                <button onClick={() => { setTempSourceLabel(currentSourceLabel); setEditingSourceLabel(true); }}
                                  className="p-1 rounded hover:bg-slate-700 transition-all text-slate-600 hover:text-slate-300" title="ערוך כותרת">
                                  <Pencil size={11} />
                                </button>
                              )}
                            </div>
                            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                              <Star size={10} className="text-amber-400" />{data.source || '—'}
                            </span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {sourceList.map(s => (
                            <div key={s} className="flex items-center gap-0.5">
                              {editingSources && (
                                <button onClick={() => removeSourceItem(s)} className="text-red-400 hover:text-red-300 p-0.5 hover:bg-red-900/30 rounded transition-colors"><X size={10} /></button>
                              )}
                              <button onClick={() => !editingSources && setData(d => ({ ...d, source: s as import('../types').LeadSource }))}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${data.source === s ? 'bg-white text-black ring-2 ring-white/30 shadow-sm' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700 border border-slate-600/30'}`}>
                                {s}
                              </button>
                            </div>
                          ))}
                        </div>
                        {editingSources && (
                          <div className="flex gap-1 mt-2">
                            <button onClick={addSourceItem} disabled={!newSourceItem.trim()} className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-semibold disabled:opacity-40 transition-colors">הוסף</button>
                            <input value={newSourceItem} onChange={e => setNewSourceItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSourceItem()} placeholder="מקור חדש..." className="flex-1 bg-slate-700 text-white text-xs px-2 py-1 rounded-lg border border-slate-600 focus:outline-none focus:border-amber-500 text-right" />
                          </div>
                        )}
                        {onWorkspaceUpdate && (
                          <button onClick={() => setEditingSources(v => !v)} className="mt-2 w-full text-center text-[10px] text-slate-500 hover:text-slate-300 transition-colors py-0.5">
                            {editingSources ? '✓ סיים עריכה' : '✏️ ערוך רשימה'}
                          </button>
                        )}
                      </div>
                    ),
                    assignee: team.length > 0 ? (
                      <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">אחראי</span>
                          {data.assignedTo ? (
                            <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-indigo-500/30 border border-indigo-400/40 text-[10px] flex items-center justify-center text-indigo-300 font-bold">{data.assignedTo[0]?.toUpperCase()}</span>
                              {data.assignedTo}
                            </span>
                          ) : <span className="text-xs text-slate-500">לא שויך</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          <button onClick={() => setData(d => ({ ...d, assignedTo: '' }))}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${!data.assignedTo ? 'bg-white text-black ring-2 ring-white/30 shadow-sm' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-700 border border-slate-600/30'}`}>ללא</button>
                          {team.map(member => (
                            <button key={member.id} onClick={() => setData(d => ({ ...d, assignedTo: member.name }))}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${data.assignedTo === member.name ? 'bg-white text-black ring-2 ring-white/30 shadow-sm' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700 border border-slate-600/30'}`}>
                              <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold ${data.assignedTo === member.name ? 'bg-black/20 text-black' : 'bg-indigo-500/30 text-indigo-300'}`}>{member.name[0]?.toUpperCase()}</span>
                              {member.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null,
                    customFields: (
                      <>
                        {(workspace?.customFieldDefs ?? []).length > 0 && (workspace!.customFieldDefs!).map(fieldDef => {
                          if (editingFieldId === fieldDef.id) {
                            return (
                              <div key={fieldDef.id} className="bg-slate-800/80 rounded-xl p-4 border border-indigo-500/50 space-y-3">
                                <div className="space-y-1">
                                  <p className="text-[10px] text-slate-500 text-right">שם השורה</p>
                                  <input autoFocus value={editFieldLabel} onChange={e => setEditFieldLabel(e.target.value)} className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-indigo-500 focus:outline-none text-right" />
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[10px] text-slate-500 text-right">אפשרויות ברשימה</p>
                                  <div className="flex flex-wrap gap-1.5 justify-end">
                                    {editFieldOptions.map((opt, i) => (
                                      <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] border border-indigo-500/30">
                                        {opt}<button onClick={() => setEditFieldOptions(prev => prev.filter((_, j) => j !== i))} className="hover:text-red-400 transition-colors ml-0.5">×</button>
                                      </span>
                                    ))}
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => { if (!editFieldOptionInput.trim()) return; setEditFieldOptions(prev => [...prev, editFieldOptionInput.trim()]); setEditFieldOptionInput(''); }} className="px-2 py-1 rounded-lg text-[10px] bg-indigo-600/80 text-white hover:bg-indigo-500 transition-colors">+ הוסף</button>
                                    <input value={editFieldOptionInput} onChange={e => setEditFieldOptionInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && editFieldOptionInput.trim()) { setEditFieldOptions(prev => [...prev, editFieldOptionInput.trim()]); setEditFieldOptionInput(''); } }} placeholder="אפשרות חדשה..." className="flex-1 bg-slate-700 text-white text-xs px-2 py-1 rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none text-right" />
                                  </div>
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={cancelEditField} className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">ביטול</button>
                                  <button onClick={saveEditField} className="flex-1 py-1 rounded-lg text-[10px] bg-indigo-600 text-white hover:bg-indigo-500 transition-colors flex items-center justify-center gap-1"><Check size={10} /> שמור שינויים</button>
                                </div>
                              </div>
                            );
                          }
                          const currentVal = data.customFields?.[fieldDef.id];
                          const selectedArr: string[] = fieldDef.multiSelect ? (Array.isArray(currentVal) ? currentVal as string[] : (currentVal ? [currentVal as string] : [])) : [];
                          const selectedStr: string = !fieldDef.multiSelect ? (typeof currentVal === 'string' ? currentVal : '') : '';
                          const toggleOption = (opt: string) => {
                            if (fieldDef.multiSelect) {
                              const next = selectedArr.includes(opt) ? selectedArr.filter(v => v !== opt) : [...selectedArr, opt];
                              setData(d => ({ ...d, customFields: { ...(d.customFields ?? {}), [fieldDef.id]: next } }));
                            } else {
                              const next = selectedStr === opt ? '' : opt;
                              setData(d => ({ ...d, customFields: { ...(d.customFields ?? {}), [fieldDef.id]: next } }));
                            }
                          };
                          return (
                            <div key={fieldDef.id} className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{fieldDef.label}</span>
                                  {onWorkspaceUpdate && (
                                    <>
                                      <button onClick={() => startEditField(fieldDef)} title="ערוך שורה" className="text-slate-600 hover:text-indigo-400 transition-colors p-0.5 rounded"><Pencil size={12} /></button>
                                      <button onClick={() => deleteCustomRow(fieldDef.id)} title="מחק שורה" className="text-slate-600 hover:text-red-400 transition-colors p-0.5 rounded"><Trash2 size={12} /></button>
                                    </>
                                  )}
                                </div>
                                <span className="text-xs text-slate-500">{fieldDef.multiSelect ? (selectedArr.length > 0 ? selectedArr.join(', ') : 'לא נבחר') : (selectedStr || 'לא נבחר')}</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5 justify-end">
                                {fieldDef.options.map(opt => {
                                  const isActive = fieldDef.multiSelect ? selectedArr.includes(opt) : selectedStr === opt;
                                  return (
                                    <button key={opt} onClick={() => toggleOption(opt)}
                                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${isActive ? 'bg-indigo-500 text-white ring-2 ring-indigo-300/40 shadow-sm' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700 border border-slate-600/30'}`}>
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {onWorkspaceUpdate && (
                          <div>
                            {addingCustomRow ? (
                              <div className="bg-slate-800/80 rounded-xl p-3 border border-indigo-500/40 space-y-3">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-bold text-slate-400 text-right">שם השורה החדשה</p>
                                  <input autoFocus value={newRowLabel} onChange={e => setNewRowLabel(e.target.value)} placeholder='לדוגמה: "תוכנת הנהלת חשבונות"' className="w-full bg-slate-700 text-white text-xs px-2 py-1.5 rounded-lg border border-indigo-500 focus:outline-none text-right" />
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[10px] text-slate-500 text-right">אפשרויות ברשימה (אופציונלי)</p>
                                  {newRowOptions.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 justify-end">
                                      {newRowOptions.map((opt, i) => (
                                        <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] border border-indigo-500/30">
                                          {opt}<button onClick={() => setNewRowOptions(prev => prev.filter((_, j) => j !== i))} className="hover:text-red-400 transition-colors ml-0.5">×</button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex gap-1">
                                    <button onClick={() => { if (!newRowOptionInput.trim()) return; setNewRowOptions(prev => [...prev, newRowOptionInput.trim()]); setNewRowOptionInput(''); }} className="px-2 py-1 rounded-lg text-[10px] bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors whitespace-nowrap">+ הוסף</button>
                                    <input value={newRowOptionInput} onChange={e => setNewRowOptionInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newRowOptionInput.trim()) { setNewRowOptions(prev => [...prev, newRowOptionInput.trim()]); setNewRowOptionInput(''); } }} placeholder="לדוגמה: חשבשבת, פריוריטי..." className="flex-1 bg-slate-700 text-white text-xs px-2 py-1 rounded-lg border border-slate-600 focus:border-indigo-500 focus:outline-none text-right" />
                                  </div>
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={() => { setAddingCustomRow(false); setNewRowLabel(''); setNewRowOptions([]); setNewRowOptionInput(''); }} className="flex-1 py-1 rounded-lg text-[10px] bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors">ביטול</button>
                                  <button onClick={addCustomRow} disabled={!newRowLabel.trim()} className="flex-1 py-1 rounded-lg text-[10px] bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"><Check size={10} /> הוסף שורה</button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setAddingCustomRow(true)} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs transition-all hover:bg-indigo-500/10" style={{ border: '1px dashed rgba(99,102,241,0.3)', color: 'rgba(165,180,252,0.5)' }}>
                                <Plus size={12} />הוסף שורה חדשה לכרטיס
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ),
                    stats: (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                          <div className="text-lg font-bold text-white">{data.budget > 0 ? `${workspace?.cardLeftField?.prefix ?? '₪'}${(data.budget / 1000).toFixed(0)}K` : '—'}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{workspace?.cardLeftField?.label ?? t('leadModal.budgetShortFallback')}</div>
                        </div>
                        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                          <div className="text-xl font-bold text-white">{data.solutions.length}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{t('leadModal.solutions')}</div>
                        </div>
                        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 text-center">
                          <div className="text-xl font-bold text-white">{data.tasks.filter(t => !t.completed).length}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{t('deals.openTasks')}</div>
                        </div>
                      </div>
                    ),
                  };
                  return cardLayout.sections
                    .filter(s => s.visible)
                    .map(s => sectionJSX[s.id] ? <div key={s.id}>{sectionJSX[s.id]}</div> : null);
                })()}

                {/* Auto-save — no manual save button needed */}
                <div className="w-full py-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <CheckCircle2 size={13} className="text-green-500" />
                  השינויים נשמרים אוטומטית
                </div>

                {/* Delete button */}
                {onDelete && (
                  <button
                    onClick={() => {
                      if (deleteConfirm) {
                        onDelete(data.id);
                        onClose();
                      } else {
                        setDeleteConfirm(true);
                        setTimeout(() => setDeleteConfirm(false), 3000);
                      }
                    }}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all border ${
                      deleteConfirm
                        ? 'bg-red-600 text-white border-red-500 shadow-sm shadow-red-500/30'
                        : 'bg-transparent text-slate-500 border-slate-700 hover:border-red-500 hover:text-red-400'
                    }`}
                  >
                    <Trash2 size={14} />
                    {deleteConfirm ? t('leadModal.confirmDelete') : t('leadModal.delete')}
                  </button>
                )}
              </>
            )}

            {/* TASKS TAB */}
            {activeTab === 'tasks' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded-lg">
                    {completedTasks}/{data.tasks.length} {t('leadModal.completed')}
                  </span>
                  <h3 className="text-sm font-bold text-slate-200">{t('leadModal.tasks')}</h3>
                </div>

                {/* Add task form */}
                <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50 space-y-3">
                  <input
                    type="text"
                    placeholder={t('leadModal.taskDesc') + '...'}
                    value={newTaskDesc}
                    onChange={e => setNewTaskDesc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTask()}
                    className="w-full bg-slate-700/80 text-white placeholder-slate-500 px-3 py-2.5 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-slate-600/50"
                  />
                  <div className="flex gap-1.5 justify-end">
                    {PRIORITY_OPTS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setNewTaskPriority(opt.value)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          newTaskPriority === opt.value ? opt.active : opt.idle
                        }`}
                      >
                        {opt.label} {opt.value === 'high' ? t('tasks.high') : opt.value === 'low' ? t('tasks.low') : t('tasks.medium')}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={addTask}
                      disabled={!newTaskDesc.trim() || !newTaskDate}
                      className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
                    >
                      <Plus size={13} />{t('leadModal.addTask')}
                    </button>
                    <input type="time" value={newTaskTime} onChange={e => setNewTaskTime(e.target.value)}
                      className="bg-slate-700/80 border border-slate-600/50 text-white px-2 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 w-24" />
                    <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)}
                      className="flex-1 bg-slate-700/80 border border-slate-600/50 text-white px-2 py-2 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                </div>

                {/* Tasks list */}
                {data.tasks.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-10 bg-slate-800/40 rounded-xl border border-slate-700/30">
                    <div className="text-3xl mb-2">📋</div>
                    {t('leadModal.noTasks')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.tasks.map(task => (
                      <div key={task.id} className={`group flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${
                        task.completed ? 'bg-slate-800/40 border-slate-700/30 opacity-60' : 'bg-slate-800/80 border-slate-700/50 hover:border-slate-600'
                      }`}>
                        <button onClick={() => deleteTask(task.id)}
                          className="text-slate-700 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100">
                          <Trash2 size={12} />
                        </button>
                        <div className="flex-1 text-right">
                          <div className={`text-sm font-medium ${task.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                            {task.description}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 justify-end mt-1">
                            {task.priority && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                task.priority === 'high' ? 'bg-red-900/60 text-red-400' :
                                task.priority === 'low'  ? 'bg-blue-900/60 text-blue-400' :
                                'bg-amber-900/60 text-amber-400'
                              }`}>
                                {task.priority === 'high' ? t('tasks.high') : task.priority === 'low' ? t('tasks.low') : t('tasks.medium')}
                              </span>
                            )}
                            <span>{task.time}</span>
                            <Clock size={10} />
                            <span>{task.date}</span>
                          </div>
                        </div>
                        <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)}
                          className="rounded accent-indigo-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* NOTES TAB */}
            {/* AGENTS TAB */}
            {activeTab === 'agents' && (
              <AgentsTab
                lead={data}
                workspace={workspace}
                currentUser={currentUser}
                onUpdateLead={onUpdate}
                onToast={onToast}
              />
            )}

            {/* ACTIVITY TAB */}
            {activeTab === 'activity' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowContactModal(true)}
                    className="flex items-center gap-1.5 bg-amber-600/80 hover:bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                  >
                    <PhoneCall size={12} />+ תעד פנייה
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-200">יומן פעילות</span>
                    <Activity size={15} className="text-indigo-400" />
                  </div>
                </div>

                {/* Add note — moved here from the old standalone Notes tab */}
                <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50">
                  <div className="flex gap-2">
                    <button onClick={addNote} disabled={!newNote.trim()}
                      className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors">
                      {t('leadModal.addNote')}
                    </button>
                    <div className="flex-1 relative">
                      <input type="text" placeholder={t('leadModal.notes') + '...'} value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addNote()}
                        className="w-full bg-slate-700/80 border border-slate-600/50 text-white placeholder-slate-500 pr-3 pl-10 py-2.5 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button
                        onClick={() => noteDictation.toggle(newNote)}
                        disabled={noteDictation.transcribing}
                        title={noteDictation.recording ? t('leadModal.stopRecording') : t('leadModal.startRecording')}
                        className={`absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${
                          noteDictation.recording
                            ? 'bg-red-500 text-white animate-pulse'
                            : 'text-slate-400 hover:text-white hover:bg-slate-600'
                        }`}
                      >
                        {noteDictation.transcribing ? <Loader2 size={14} className="animate-spin" /> : noteDictation.recording ? <MicOff size={14} /> : <Mic size={14} />}
                      </button>
                    </div>
                  </div>
                  {noteDictation.recording && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      🎤 מקליט... דבר חופשי ולחץ על העצירה כשתסיים
                    </div>
                  )}
                  {noteDictation.transcribing && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-indigo-400">
                      <Loader2 size={12} className="animate-spin" />
                      מפענח עם AI...
                    </div>
                  )}
                </div>

                {/* Follow-up info */}
                {(data.lastContactDate || data.nextFollowUpDate) && (
                  <div className="bg-indigo-900/30 border border-indigo-500/20 rounded-xl px-4 py-3 text-right space-y-1">
                    {data.lastContactDate && (
                      <div className="text-xs text-slate-400 flex items-center justify-end gap-1.5">
                        <span>פנייה אחרונה: <span className="text-slate-200 font-medium">{new Date(data.lastContactDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
                        <PhoneCall size={10} className="text-indigo-400" />
                      </div>
                    )}
                    {data.nextFollowUpDate && (
                      <div className="text-xs flex items-center justify-end gap-1.5">
                        <span className={`font-medium ${new Date(data.nextFollowUpDate) < new Date() ? 'text-red-400' : 'text-amber-300'}`}>
                          {new Date(data.nextFollowUpDate) < new Date()
                            ? `⚠️ פנייה באיחור — הייתה ב-${new Date(data.nextFollowUpDate).toLocaleDateString('he-IL')}`
                            : `📅 פנייה הבאה: ${new Date(data.nextFollowUpDate).toLocaleDateString('he-IL')}`}
                        </span>
                        <RotateCcw size={10} className="text-amber-400" />
                      </div>
                    )}
                  </div>
                )}

                {/* Meetings list */}
                {(data.meetings?.length ?? 0) > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-400 text-right">📅 פגישות מתוכננות</div>
                    {data.meetings!.map(m => (
                      <div key={m.id} className="flex items-center justify-between bg-purple-900/20 border border-purple-500/20 rounded-xl px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {m.calendarLink && (
                            <a href={m.calendarLink} target="_blank" rel="noreferrer"
                              className="text-[10px] text-purple-400 hover:text-purple-300 underline">Google Cal</a>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-200">{m.title}</div>
                          <div className="text-xs text-slate-400">{m.date} {m.time} · {m.duration} דקות {m.location ? `· ${m.location}` : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Activity log entries */}
                {(data.activityLog?.length ?? 0) === 0 && data.notes.length === 0 && data.tasks.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-10 bg-slate-800/40 rounded-xl border border-slate-700/30">
                    <div className="text-3xl mb-2">📊</div>
                    <div>אין פעילות עדיין</div>
                    <div className="text-xs mt-1 text-slate-600">לחץ על "תעד פנייה" כדי להתחיל</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[
                      ...(data.activityLog || []).map(a => ({
                        type: a.type as string, text: a.content, time: a.timestamp, author: a.author, isActivity: true,
                      })),
                      ...data.notes.filter(() => !(data.activityLog || []).some(a => a.type === 'note' && a.content === data.notes[0]?.text)).map(n => ({
                        type: 'note', text: n.text, time: n.timestamp, author: n.author, isActivity: false,
                      })),
                    ]
                      .sort((a, b) => b.time.localeCompare(a.time))
                      .map((item, i) => (
                        <div key={i} className="flex items-start gap-3 bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/30">
                          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5 ${ACTIVITY_COLORS[item.type as LeadActivityType] || 'bg-slate-700 text-slate-400'}`}>
                            {ACTIVITY_ICONS[item.type as LeadActivityType] || '📋'}
                          </div>
                          <div className="flex-1 text-right">
                            <div className="text-sm text-slate-300">{item.text}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {new Date(item.time).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {item.author}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-slate-700/60 bg-slate-800/30 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Star size={10} className="text-amber-400" />{data.source}
              </span>
              <span>{data.assignedTo}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ChevronDown size={11} />
              {t('leadModal.lastUpdate')} {data.lastUpdate}
            </div>
          </div>
        </div>
      </div>

      {/* Smart Email Modal */}
      {showEmail && (
        <EmailModal lead={data} workspace={workspace} onClose={() => setShowEmail(false)} />
      )}

      {/* Smart WhatsApp Modal */}
      {showWhatsApp && (
        <WhatsAppModal lead={data} workspace={workspace} onClose={() => setShowWhatsApp(false)} />
      )}

      {/* ── CONTACT LOG MODAL ──────────────────────────────────────────── */}
      {showContactModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <button onClick={() => setShowContactModal(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              <div className="flex items-center gap-2 text-sm font-bold text-white"><PhoneCall size={14} className="text-amber-400" />תיעוד פנייה</div>
            </div>
            <div className="p-5 space-y-4">
              {/* Contact type */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block text-right">אמצעי התקשורת</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'phone',     label: '📞 טלפון' },
                    { key: 'email',     label: '✉️ מייל' },
                    { key: 'whatsapp',  label: '💬 וואטסאפ' },
                    { key: 'in_person', label: '🤝 פנים-אל-פנים' },
                    { key: 'meeting',   label: '📅 פגישה נקבעה' },
                    { key: 'quote',     label: '📄 הצעת מחיר' },
                    { key: 'no_answer', label: '📵 לא ענה' },
                  ] as { key: ContactMethod; label: string }[]).map(opt => (
                    <button key={opt.key} onClick={() => { setContactType(opt.key); if (opt.key !== 'custom') setCustomContactLabel(''); }}
                      className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all border ${contactType === opt.key ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {contactType === 'no_answer' && (
                  <p className="text-[11px] text-amber-400 mt-2 text-right">
                    📵 ייספר כניסיון ללא מענה (סה"כ עד כה: {(data.noAnswerCount ?? 0)}) — אוטומציות יכולות להגיב לזה
                  </p>
                )}
                {/* Custom type row */}
                <div className="mt-2">
                  <button
                    onClick={() => setContactType('custom')}
                    className={`w-full py-2 px-3 rounded-xl text-xs font-semibold text-right transition-all border flex items-center gap-2 ${contactType === 'custom' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    <span>✏️</span>
                    {contactType === 'custom' ? (
                      <input
                        type="text"
                        value={customContactLabel}
                        onChange={e => setCustomContactLabel(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="הקלד סוג תיעוד מותאם..."
                        autoFocus
                        className="flex-1 bg-transparent focus:outline-none text-white placeholder-amber-200/50 text-right"
                      />
                    ) : (
                      <span className="flex-1 text-right">סוג תיעוד מותאם אישית</span>
                    )}
                  </button>
                </div>
              </div>
              {/* Note */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block text-right">פרטי הפנייה</label>
                <div className="relative">
                  <textarea
                    value={contactNote} onChange={e => setContactNote(e.target.value)}
                    rows={3} placeholder="תאר את הפנייה... או הקלט בקול 🎤"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 pl-10 text-sm text-white text-right resize-none focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => contactDictation.toggle(contactNote)}
                    disabled={contactDictation.transcribing}
                    title={contactDictation.recording ? 'עצור הקלטה' : 'הקלטה קולית'}
                    className={`absolute left-2 top-2 p-1.5 rounded-lg transition-all ${
                      contactDictation.recording
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    {contactDictation.transcribing ? <Loader2 size={14} className="animate-spin" /> : contactDictation.recording ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                </div>
                {contactDictation.recording && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-red-400">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    🎤 מקליט... דבר חופשי ולחץ על העצירה כשתסיים
                  </div>
                )}
                {contactDictation.transcribing && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-indigo-400">
                    <Loader2 size={12} className="animate-spin" /> מפענח עם AI...
                  </div>
                )}
              </div>
              {/* Follow-up */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block text-right">פנייה הבאה (ימים)</label>
                <div className="flex gap-2">
                  {['3', '7', '14', '30'].map(d => (
                    <button key={d} onClick={() => setFollowUpDays(d)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${followUpDays === d ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {d}י
                    </button>
                  ))}
                  <input type="number" value={followUpDays} onChange={e => setFollowUpDays(e.target.value)}
                    placeholder="אחר" className="w-16 bg-slate-800 border border-slate-700 rounded-xl px-2 text-xs text-center text-white focus:outline-none focus:border-indigo-500" />
                </div>
              </div>
              {/* Post-contact action */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block text-right">פעולה אוטומטית לאחר שמירה</label>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {([
                    { key: 'task',      label: '✅ צור משימה',    active: 'bg-indigo-600 border-indigo-500 text-white' },
                    { key: 'email',     label: '✉️ שלח מייל',    active: 'bg-blue-600 border-blue-500 text-white' },
                    { key: 'whatsapp',  label: '💬 וואטסאפ',      active: 'bg-green-600 border-green-500 text-white' },
                  ] as { key: typeof postContactAction; label: string; active: string }[]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        const next = postContactAction === opt.key ? 'none' : opt.key;
                        setPostContactAction(next);
                        if (next === 'task' && !postContactTaskDesc) {
                          const labels: Record<ContactMethod, string> = {
                            phone: `התקשר ל-${data.company}`,
                            email: `שלח מייל ל-${data.company}`,
                            whatsapp: `שלח וואטסאפ ל-${data.company}`,
                            in_person: `פגישה עם ${data.company}`,
                            meeting: `פגישה נקבעה עם ${data.company}`,
                            quote: `מעקב על הצעת מחיר — ${data.company}`,
                            custom: customContactLabel ? `${customContactLabel} — ${data.company}` : `מעקב עם ${data.company}`,
                          };
                          setPostContactTaskDesc(labels[contactType]);
                        }
                      }}
                      className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all border ${postContactAction === opt.key ? opt.active : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Task details — shown when task action selected */}
                {postContactAction === 'task' && (
                  <div className="space-y-2 p-3 bg-slate-800/60 rounded-xl border border-indigo-500/20">
                    <input
                      value={postContactTaskDesc}
                      onChange={e => setPostContactTaskDesc(e.target.value)}
                      placeholder={`התקשר ל-${data.company}`}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white text-right focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex gap-2 justify-end">
                      {(['high', 'medium', 'low'] as TaskPriority[]).map(p => (
                        <button key={p} onClick={() => setPostContactTaskPriority(p)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                            postContactTaskPriority === p
                              ? p === 'high' ? 'bg-red-600 border-red-500 text-white' : p === 'medium' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-slate-700 border-slate-600 text-slate-400'
                          }`}>
                          {p === 'high' ? '🔴 דחוף' : p === 'medium' ? '🟠 בינוני' : '🔵 נמוך'}
                        </button>
                      ))}
                    </div>
                    {!followUpDays && (
                      <p className="text-[10px] text-amber-400 text-right">⚠️ בחר מספר ימים לפנייה הבאה כדי לתזמן את המשימה</p>
                    )}
                    {followUpDays && (
                      <p className="text-[10px] text-slate-400 text-right">
                        📅 המשימה תיקבע ל-{new Date(Date.now() + parseInt(followUpDays) * 86400000).toLocaleDateString('he-IL')}
                      </p>
                    )}
                  </div>
                )}

                {postContactAction === 'email' && (
                  <p className="text-[11px] text-blue-400 text-right px-1">✉️ לאחר השמירה תיפתח חלונית כתיבת מייל ל-{data.email || data.company}</p>
                )}
                {postContactAction === 'whatsapp' && (
                  <p className="text-[11px] text-green-400 text-right px-1">💬 לאחר השמירה תיפתח חלונית וואטסאפ ל-{data.phone || data.company}</p>
                )}
              </div>

              <button onClick={handleLogContact}
                disabled={!contactNote.trim() || (postContactAction === 'task' && !postContactTaskDesc.trim())}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-all">
                {postContactAction === 'task' ? '💾 שמור ויצור משימה' : postContactAction === 'email' ? '💾 שמור ופתח מייל' : postContactAction === 'whatsapp' ? '💾 שמור ופתח וואטסאפ' : 'שמור פנייה'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MEETING MODAL ──────────────────────────────────────────────── */}
      {showMeetingModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <button onClick={() => setShowMeetingModal(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              <div className="flex items-center gap-2 text-sm font-bold text-white"><Calendar size={14} className="text-purple-400" />קביעת פגישה</div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block text-right">כותרת הפגישה</label>
                <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)}
                  placeholder={`פגישה עם ${data.company}`}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-right focus:outline-none focus:border-purple-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block text-right">שעה</label>
                  <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-right focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block text-right">תאריך</label>
                  <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-right focus:outline-none focus:border-purple-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block text-right">משך</label>
                <div className="grid grid-cols-4 gap-2">
                  {[30, 60, 90, 120].map(d => (
                    <button key={d} onClick={() => setMeetingDuration(d)}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${meetingDuration === d ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {d}′
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block text-right">מיקום (אופציונלי)</label>
                <input value={meetingLocation} onChange={e => setMeetingLocation(e.target.value)}
                  placeholder="כתובת / Zoom / Teams"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-right focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block text-right">הערות</label>
                <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)}
                  rows={2} placeholder="נושאי הפגישה..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white text-right resize-none focus:outline-none focus:border-purple-500" />
              </div>
              {data.email && (
                <div className="flex items-center gap-2 text-xs text-slate-400 justify-end bg-slate-800/50 rounded-xl px-3 py-2">
                  <span>{data.email}</span>
                  <span>הזמנה תשלח ל:</span>
                  <Users2 size={12} className="text-purple-400" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => handleScheduleMeeting('google')}
                  disabled={!meetingTitle.trim() || !meetingDate}
                  className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2">
                  <CalendarPlus size={15} />Google
                </button>
                <button onClick={() => handleScheduleMeeting('outlook')}
                  disabled={!meetingTitle.trim() || !meetingDate}
                  className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2">
                  <CalendarPlus size={15} />Outlook
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── OBJECTION MODAL ────────────────────────────────────────────── */}
      {showObjectionModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <button onClick={() => { setShowObjectionModal(false); setPendingStatus(null); }} className="text-slate-400 hover:text-white"><X size={16} /></button>
              <div className="text-sm font-bold text-white">מה הסיבה?</div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-400 text-right">בחר את סיבת ה"לא רלוונטי":</p>
              <div className="space-y-2">
                {DEFAULT_OBJECTIONS.map(obj => (
                  <button key={obj} onClick={() => setSelectedObjection(obj)}
                    className={`w-full text-right px-4 py-3 rounded-xl text-sm font-medium transition-all border ${selectedObjection === obj ? 'bg-red-600/20 border-red-500/40 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-red-500/30'}`}>
                    {obj}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => { setShowObjectionModal(false); setPendingStatus(null); }}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium border border-slate-700 transition-all">
                  ביטול
                </button>
                <button onClick={handleObjectionConfirm}
                  className="py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold transition-all">
                  אשר
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Proposal Editor ─────────────────────────────────────────── */}
      {showProposalEditor && workspace && (
        <ProposalEditorModal
          lead={data}
          workspace={workspace}
          onClose={() => setShowProposalEditor(false)}
          onToast={onToast}
        />
      )}
    </>
  );
}
