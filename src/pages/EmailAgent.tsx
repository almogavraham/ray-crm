import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Mail, Brain, BookOpen, Send, CheckCircle, XCircle,
  Plus, RefreshCw, ChevronDown, ChevronUp,
  Sparkles, Edit3, Check, X, Settings,
  HelpCircle, MessageSquare, Link, Unlink, AlertCircle,
  MessageCircle, Phone, ArrowRight, Copy, ExternalLink,
  Star, Target, Zap, Shield, Clock, TrendingUp, Globe,
  Search, Trash2, Info, ChevronRight, Loader2, Tag,
  CheckCheck, PlugZap, Rocket, ArrowUpRight, Bot, ThumbsUp,
  BadgeCheck, Activity, Flame, GitBranch, Mic,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { WorkspaceProfile, Lead } from '../types';
import VoiceEmailComposer from '../components/VoiceEmailComposer';
import {
  loadAgentConfig, saveAgentConfig, loadKnowledge, addKnowledgeEntry,
  deleteKnowledgeEntry, updateKnowledgeEntry,
  loadDrafts, updateDraftStatus, saveDraft, markAsRead,
  requestGmailToken, requestGmailTokenSilent, getGmailAddress, sendGmailReply,
  fetchUnreadEmails, processEmailWithAI,
  searchEmails, askAboutEmails, scoreLeadFromEmail, detectOpportunity,
  loadTemplates, saveTemplate, updateTemplate, deleteTemplate,
  loadSequences, saveSequence, updateSequence, deleteSequence,
  fetchEmailAnalytics, loadCachedAnalytics, findEmailsNeedingFollowUp,
  generateSequenceSteps, personalizeEmail,
} from '../lib/gmailAgent';
import {
  requestOutlookToken, fetchOutlookUnread, markOutlookAsRead,
  sendOutlookReply, getOutlookToken,
} from '../lib/outlookAgent';
import {
  loadWhatsAppConfig, saveWhatsAppConfig, verifyWhatsAppToken,
  listenConversations, listenMessages, sendWhatsAppMessage,
  markMessageSent, storeAgentMessage,
} from '../lib/whatsappAgent';
import type {
  KnowledgeEntry, EmailDraft, EmailAgentConfig, EmailAccount, EmailProvider,
  EmailTemplate, EmailSequence, EmailAnalytics, EmailOpportunity,
} from '../types';
import type {
  WhatsAppConfig, WhatsAppConversation, WhatsAppMessage,
} from '../lib/whatsappAgent';
import { oauthOriginsForDisplay } from '../lib/oauthOrigins';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const DEFAULT_CONFIG: EmailAgentConfig = {
  enabled:             false,
  accounts:            [],
  agentName:           'סוכן מכירות AI',
  agentRole:           'מנהל מכירות',
  signature:           'בברכה,\nצוות המכירות',
  language:            'he',
  businessDescription: '',
  agentInstructions:   '',
  agentPersonality:    'מקצועי, ידידותי ומשכנע',
  salesGoals:          ['ליד חם', 'פגישה'],
  autoSend:            false,
  requireApproval:     true,
  confidenceThreshold: 90,
  replyTone:           'professional',
  emailLength:         'medium',
  useEmoji:            false,
  closingStyle:        'soft',
  ctaInEmail:          'reply',
  maxDailyEmails:      20,
  followUpDays:        3,
  workingHoursStart:   '08:00',
  workingHoursEnd:     '18:00',
  blacklistedWords:    '',
  sensitiveTopics:     '',
  // advanced
  maxEmailsPerDay:         50,
  maxFollowUps:            3,
  targetResponseTime:      60,
  sendOnlyBusinessHours:   false,
  businessHoursStart:      '08:00',
  businessHoursEnd:        '18:00',
  skipWeekends:            false,
  leadScoreThreshold:      60,
  priorityTopics:          [],
  competitorMentionAction: 'compare',
  requireApprovalForNewLeads: true,
  abTestEnabled:           false,
  learnFromReplies:        true,
  weeklySummary:           true,
};

const CATEGORY_LABELS: Record<KnowledgeEntry['category'], { label: string; emoji: string; desc: string }> = {
  pricing:    { label: 'מחירים',         emoji: '💰', desc: 'תמחור, חבילות, הנחות' },
  product:    { label: 'מוצר / שירות',  emoji: '📦', desc: 'תכונות, יתרונות, שאלות נפוצות' },
  support:    { label: 'תמיכה',         emoji: '🛠️', desc: 'פתרון בעיות, SLA, אחריות' },
  meeting:    { label: 'פגישות',        emoji: '📅', desc: 'זמינות, אופן קביעת פגישה' },
  objection:  { label: 'התנגדויות',    emoji: '🛡️', desc: 'תשובות להתנגדויות מכירה' },
  competitor: { label: 'מתחרים',       emoji: '⚔️', desc: 'יתרון על פני מתחרים' },
  general:    { label: 'כללי',          emoji: '💬', desc: 'מידע כללי שלא מתאים לשאר' },
};

const PROVIDER_META: Record<EmailProvider, { label: string; color: string; logo: string }> = {
  gmail:   { label: 'Gmail',   color: '#ea4335', logo: '📧' },
  outlook: { label: 'Outlook', color: '#0072c6', logo: '📩' },
};

/* ── RAY CRM built-in Google OAuth Client ID ─────────────────────────────── */
/**
 * Fallback Google client, used only when the workspace has not configured its
 * own. A workspace that sets `emailConfig.oauthClientId` MUST win over this:
 * its client is the one whose consent screen and authorised origins the admin
 * actually controls, and pinning everyone to the shared client is what made
 * "connect my mailbox" silently attach the wrong project.
 */
const RAY_CRM_GOOGLE_CLIENT_ID = '1006025078719-76fhqfnov6orhb6oaro8t8l2skeijmkf.apps.googleusercontent.com';

/* ── in-memory token map (accountId → token) ─────────────────────────────── */
const _liveTokens: Record<string, string> = {};

interface Props {
  workspaceId?: string;
  workspace?:   WorkspaceProfile;
  /** Used by the voice composer to attach an email to a lead for context. */
  leads?:       Lead[];
  onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
  onNavigate?: (page: string) => void;
  workflowsPanel?: ReactNode;
  defaultTab?: 'inbox' | 'search' | 'templates' | 'sequences' | 'analytics' | 'accounts' | 'whatsapp' | 'agent' | 'knowledge' | 'settings' | 'workflows';
}

export default function EmailAgent({ workspaceId, workspace, leads, onToast, onNavigate, workflowsPanel, defaultTab }: Props) {
  const { c, isDark } = useTheme();
  const [tab, setTab]           = useState<'inbox' | 'compose' | 'search' | 'analytics' | 'agent' | 'knowledge' | 'settings' | 'workflows'>(
    (defaultTab === 'templates' || defaultTab === 'sequences' ? 'workflows' :
     defaultTab === 'accounts' || defaultTab === 'whatsapp' ? 'settings' :
     defaultTab) ?? 'inbox'
  );
  const [settingsSubTab, setSettingsSubTab] = useState<'advanced' | 'email' | 'whatsapp'>('advanced');
  const [workflowsSubTab, setWorkflowsSubTab] = useState<'builder' | 'templates' | 'sequences' | 'auto-reply' | 'scheduling'>('builder');
  const [onboardingCollapsed, setOnboardingCollapsed] = useState(() => {
    // Default collapsed; only open if user explicitly opened it
    const key = `emailAgent_onboardingCollapsed_${workspaceId ?? 'default'}`;
    return localStorage.getItem(key) !== 'false';
  });
  const [config, setConfig]     = useState<EmailAgentConfig>(DEFAULT_CONFIG);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [drafts, setDrafts]     = useState<EmailDraft[]>([]);
  const [loading, setLoading]   = useState(true);
  const [checking, setChecking] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  /* knowledge form */
  const [newQ, setNewQ]         = useState('');
  const [newA, setNewA]         = useState('');
  const [newCat, setNewCat]     = useState<KnowledgeEntry['category']>('general');
  const [addingK, setAddingK]   = useState(false);
  const [showKForm, setShowKForm] = useState(false);
  const [kSearch, setKSearch]   = useState('');
  const [kFilter, setKFilter]   = useState<KnowledgeEntry['category'] | 'all'>('all');
  const [editingK, setEditingK] = useState<string | null>(null);
  const [editKQ, setEditKQ]     = useState('');
  const [editKA, setEditKA]     = useState('');
  const [deletingK, setDeletingK] = useState<string | null>(null);
  const [generatingKnowledge, setGeneratingKnowledge] = useState(false);

  /* draft UI */
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [editingDraft, setEditingDraft]   = useState<string | null>(null);
  const [editText, setEditText]           = useState('');
  const [sending, setSending]             = useState<string | null>(null);

  /* add-account modal */
  const [showAddModal, setShowAddModal]     = useState(false);
  const [addProvider, setAddProvider]       = useState<EmailProvider>('gmail');
  const [addClientId, setAddClientId]       = useState('');
  const [addTenantId, setAddTenantId]       = useState('common');
  const [connecting, setConnecting]         = useState(false);
  const [tokenTick,  setTokenTick]          = useState(0); // bump to re-check _liveTokens
  const [showGuideExpanded, setShowGuideExpanded] = useState(true);

  /* Search & Ask state */
  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState<import('../lib/gmailAgent').GmailMessage[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [askQuestion, setAskQuestion]       = useState('');
  const [askAnswer, setAskAnswer]           = useState<{ answer: string; sources: { subject: string; from: string; date: number }[] } | null>(null);
  const [askLoading, setAskLoading]         = useState(false);
  const [searchMode, setSearchMode]         = useState<'search' | 'ask'>('ask');

  /* Templates state */
  const [templates, setTemplates]             = useState<EmailTemplate[]>([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate]   = useState<EmailTemplate | null>(null);
  const [newTemplate, setNewTemplate]           = useState<Partial<EmailTemplate>>({ category: 'first_contact' });
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [previewTemplate, setPreviewTemplate]   = useState<EmailTemplate | null>(null);

  /* Sequences state */
  const [sequences, setSequences]             = useState<EmailSequence[]>([]);
  const [showSeqForm, setShowSeqForm]         = useState(false);
  const [newSeqLead, setNewSeqLead]           = useState('');
  const [newSeqEmail, setNewSeqEmail]         = useState('');
  const [newSeqContext, setNewSeqContext]     = useState('');
  const [generatingSeq, setGeneratingSeq]    = useState(false);

  /* Analytics state */
  const [analytics, setAnalytics]             = useState<EmailAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  /* Follow-up reminders */
  const [followUps, setFollowUps]             = useState<import('../lib/gmailAgent').GmailMessage[]>([]);
  const [followUpsLoaded, setFollowUpsLoaded] = useState(false);

  /* Lead scores */
  const [draftScores, setDraftScores]         = useState<Record<string, { score: number; tier: string; signals: string[]; sentiment: string }>>({});

  /* WhatsApp state */
  const [waCfg, setWaCfg]                   = useState<WhatsAppConfig | null>(null);
  const [waConvs, setWaConvs]               = useState<WhatsAppConversation[]>([]);
  const [selPhone, setSelPhone]             = useState<string | null>(null);
  const [waMsgs, setWaMsgs]                 = useState<WhatsAppMessage[]>([]);
  const [waReply, setWaReply]               = useState('');
  const [waSending, setWaSending]           = useState(false);
  const [showWaSetup, setShowWaSetup]       = useState(false);
  const [waDraft, setWaDraft]               = useState<Partial<WhatsAppConfig>>({
    phoneNumberId: '', accessToken: '', webhookToken: '', businessName: '',
  });
  const [waVerifying, setWaVerifying]       = useState(false);
  const [waSavingCfg, setWaSavingCfg]       = useState(false);
  const chatEndRef                           = useRef<HTMLDivElement>(null);
  const unsubConvRef                         = useRef<(() => void) | null>(null);
  const unsubMsgRef                          = useRef<(() => void) | null>(null);

  const wid = workspaceId ?? '';

  /* ── Initial load ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!wid) return;
    (async () => {
      setLoading(true);
      const [cfg, kb, dr, wa] = await Promise.all([
        loadAgentConfig(wid), loadKnowledge(wid), loadDrafts(wid), loadWhatsAppConfig(wid),
      ]);
      if (cfg) {
        setConfig(c => ({
          ...DEFAULT_CONFIG,
          ...cfg,
          accounts: cfg.accounts ?? [],
          // Fallback from workspace if not set in saved config
          businessDescription: cfg.businessDescription || workspace?.prompt || '',
          agentInstructions:   cfg.agentInstructions   || workspace?.aiInstructions || '',
          agentName:           cfg.agentName || workspace?.name ? `סוכן ${workspace?.name}` : DEFAULT_CONFIG.agentName,
        }));
        // Restore cached OAuth tokens so user stays connected across page refreshes
        let restoredAny = false;
        for (const account of cfg.accounts ?? []) {
          if (
            account.cachedToken &&
            account.cachedTokenExpiry &&
            Date.now() < account.cachedTokenExpiry - 60_000 // still valid (1 min margin)
          ) {
            _liveTokens[account.id] = account.cachedToken;
            restoredAny = true;
          }
        }
        if (restoredAny) setTokenTick(t => t + 1);
      } else {
        // First time: pre-fill from workspace
        setConfig(c => ({
          ...c,
          businessDescription: workspace?.prompt || '',
          agentInstructions:   workspace?.aiInstructions || '',
          agentName:           workspace?.name ? `סוכן ${workspace.name}` : DEFAULT_CONFIG.agentName,
          signature:           workspace?.name ? `בברכה,\n${workspace.name}` : DEFAULT_CONFIG.signature,
        }));
      }
      setKnowledge(kb);
      setDrafts(dr);
      const [seqs, tmpl, cachedAnalytics] = await Promise.all([
        loadSequences(wid),
        loadTemplates(wid),
        loadCachedAnalytics(wid),
      ]);
      setSequences(seqs);
      setTemplates(tmpl);
      if (cachedAnalytics) setAnalytics(cachedAnalytics);
      if (wa) {
        setWaCfg(wa);
        setWaDraft({ phoneNumberId: wa.phoneNumberId, accessToken: wa.accessToken, webhookToken: wa.webhookToken, businessName: wa.businessName });
        if (wa.connected) {
          unsubConvRef.current = listenConversations(wid, setWaConvs);
        }
      }
      setLoading(false);
    })();
    return () => { unsubConvRef.current?.(); unsubMsgRef.current?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  /* ── WhatsApp message listener ─────────────────────────────────────────── */
  useEffect(() => {
    unsubMsgRef.current?.();
    if (!wid || !selPhone) { setWaMsgs([]); return; }
    unsubMsgRef.current = listenMessages(wid, selPhone, msgs => {
      setWaMsgs(msgs);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return () => unsubMsgRef.current?.();
  }, [wid, selPhone]);

  /* ── Persist token into the account record in Firestore ────────────────── */
  const persistToken = useCallback(async (cfg: EmailAgentConfig, accountId: string, token: string, expiresInSec = 3600) => {
    const expiry = Date.now() + (expiresInSec - 120) * 1000; // 2-min safety margin
    const updated: EmailAgentConfig = {
      ...cfg,
      accounts: cfg.accounts.map(a =>
        a.id === accountId ? { ...a, cachedToken: token, cachedTokenExpiry: expiry } : a
      ),
    };
    setConfig(updated);
    await saveAgentConfig(wid, updated);
    return updated;
  }, [wid]); // eslint-disable-line

  /* ── Connect account ───────────────────────────────────────────────────── */
  const handleConnect = async () => {
    const clientIdToUse = addProvider === 'gmail'
      ? (workspace?.emailConfig?.oauthClientId || RAY_CRM_GOOGLE_CLIENT_ID)
      : addClientId.trim();
    if (!clientIdToUse) { onToast?.('הכנס Client ID', 'error'); return; }
    setConnecting(true);
    try {
      let email = '', displayName = '', token = '';

      if (addProvider === 'gmail') {
        token = await requestGmailToken(clientIdToUse);
        email = await getGmailAddress(token);
        displayName = email;
      } else {
        const res = await requestOutlookToken(clientIdToUse, addTenantId.trim() || 'common');
        token = res.token; email = res.email; displayName = res.displayName || email;
      }
      if (!email) throw new Error('לא הצליח לקבל כתובת מייל');

      const accountId = `${addProvider}:${email}`;
      _liveTokens[accountId] = token;
      setTokenTick(t => t + 1);

      const newAccount: EmailAccount = {
        id: accountId, provider: addProvider, email, displayName,
        clientId: clientIdToUse,
        tenantId: addProvider === 'outlook' ? (addTenantId.trim() || 'common') : undefined,
        connectedAt: Date.now(),
        cachedToken: token,
        cachedTokenExpiry: Date.now() + 3480_000, // ~58 min
      };
      const updated: EmailAgentConfig = {
        ...config,
        accounts: [...config.accounts.filter(a => a.id !== accountId), newAccount],
      };
      setConfig(updated);
      await saveAgentConfig(wid, updated);
      setShowAddModal(false); setAddClientId('');
      onToast?.(`${PROVIDER_META[addProvider].label} חובר: ${email}`, 'success');
      // Auto-fetch emails right after connecting
      setTimeout(() => handleCheckEmails(), 300);
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setConnecting(false);
    }
  };

  /* ── Disconnect account ────────────────────────────────────────────────── */
  const handleDisconnect = async (accountId: string) => {
    delete _liveTokens[accountId];
    const updated: EmailAgentConfig = {
      ...config,
      accounts: config.accounts.filter(a => a.id !== accountId),
    };
    setConfig(updated);
    await saveAgentConfig(wid, updated);
    setTokenTick(t => t + 1);
    onToast?.('חשבון הוסר', 'info');
  };

  /* ── Reconnect (refresh token) ──────────────────────────────────────────── */
  const handleReconnect = async (account: EmailAccount) => {
    setConnecting(true);
    try {
      let token = '';
      if (account.provider === 'gmail') {
        // Use the workspace's CURRENT client id, not the one frozen onto the
        // account when it was first connected: if the OAuth client was recreated
        // (new project, new consent screen) the stored id is stale and the
        // reconnect fails against a client that no longer grants these scopes.
        const clientIdNow = workspace?.emailConfig?.oauthClientId || account.clientId;
        token = await requestGmailToken(clientIdNow, account.email);
      } else {
        const res = await requestOutlookToken(account.clientId, account.tenantId ?? 'common');
        token = res.token;
      }
      _liveTokens[account.id] = token;
      setTokenTick(t => t + 1);
      await persistToken(config, account.id, token);
      onToast?.(`${account.email} חובר מחדש ✅`, 'success');
      // Auto-fetch emails right after reconnecting
      setTimeout(() => handleCheckEmails(), 300);
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setConnecting(false);
    }
  };

  /* ── Check all emails ──────────────────────────────────────────────────── */
  const handleCheckEmails = async () => {
    if (!oauthConnected) {
      if (smtpConnected) {
        onToast?.('חיבור SMTP מאפשר שליחה בלבד — כדי לקרוא מיילים נכנסים יש להוסיף חיבור OAuth בטאב "מייל"', 'info');
      } else {
        onToast?.('חבר חשבון מייל תחילה', 'error');
      }
      return;
    }
    setChecking(true);
    let total = 0;
    try {
      for (const account of config.accounts) {
        let token = _liveTokens[account.id];
        if (!token && account.provider === 'outlook') token = getOutlookToken(account.id) ?? '';
        if (!token) { onToast?.(`${account.email}: לא מחובר — חבר שוב`, 'info'); continue; }

        let emails;
        if (account.provider === 'gmail') {
          emails = await fetchUnreadEmails(token, 5);
        } else {
          emails = await fetchOutlookUnread(token, 5);
        }

        for (const email of emails) {
          const { draft, confidence, uncertainties } = await processEmailWithAI(email, knowledge, config);
          await saveDraft(wid, {
            accountId:    account.id,
            provider:     account.provider,
            threadId:     email.threadId,
            messageId:    email.id,
            fromEmail:    email.from,
            fromName:     email.fromName,
            subject:      email.subject,
            originalText: email.body || email.snippet,
            aiDraft:      draft,
            confidence,
            uncertainties,
            status:       'pending',
            createdAt:    Date.now(),
          });
          if (account.provider === 'gmail') await markAsRead(email.id, token);
          else await markOutlookAsRead(email.id, token);
          total++;
        }
      }
      const fresh = await loadDrafts(wid);
      setDrafts(fresh);
      onToast?.(total ? `עובדו ${total} מיילים` : 'אין מיילים חדשים', 'info');
      if (total) setTab('drafts');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  /* ── Follow-up reminders ──────────────────────────────────────────────── */
  const handleLoadFollowUps = async () => {
    const token = Object.values(_liveTokens)[0];
    if (!token || followUpsLoaded) return;
    try {
      const emails = await findEmailsNeedingFollowUp(token, config.followUpDays || 3);
      setFollowUps(emails);
      setFollowUpsLoaded(true);
    } catch {}
  };

  /* ── Score draft lead ─────────────────────────────────────────────────── */
  const handleScoreDraft = async (draft: EmailDraft) => {
    if (draftScores[draft.id]) return;
    try {
      const fakeEmail: import('../lib/gmailAgent').GmailMessage = {
        id: draft.messageId, threadId: draft.threadId,
        from: draft.fromEmail, fromName: draft.fromName,
        subject: draft.subject, snippet: draft.originalText,
        body: draft.originalText, date: draft.createdAt,
      };
      const score = await scoreLeadFromEmail(fakeEmail, config);
      setDraftScores(prev => ({ ...prev, [draft.id]: score }));
    } catch {}
  };

  /* ── Generate sequence ────────────────────────────────────────────────── */
  const handleGenerateSequence = async () => {
    if (!newSeqLead || !newSeqEmail) { onToast?.('הכנס שם ואימייל', 'error'); return; }
    setGeneratingSeq(true);
    try {
      const steps = await generateSequenceSteps(newSeqLead, newSeqEmail, newSeqContext, config);
      await saveSequence(wid, {
        name: `סדרה: ${newSeqLead}`,
        leadEmail: newSeqEmail, leadName: newSeqLead,
        accountId: config.accounts[0]?.id ?? '',
        steps: steps.map(s => ({ ...s, sent: false })),
        currentStep: 0, status: 'active',
        createdAt: Date.now(), nextSendAt: Date.now(),
      });
      setSequences(await loadSequences(wid));
      setShowSeqForm(false);
      setNewSeqLead(''); setNewSeqEmail(''); setNewSeqContext('');
      onToast?.('סדרת מעקב נוצרה!', 'success');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally { setGeneratingSeq(false); }
  };

  /* ── Load analytics ───────────────────────────────────────────────────── */
  const handleLoadAnalytics = async () => {
    const token = Object.values(_liveTokens)[0];
    if (!token) { onToast?.('חבר Gmail תחילה', 'error'); return; }
    setAnalyticsLoading(true);
    try {
      const data = await fetchEmailAnalytics(token, wid);
      setAnalytics(data);
      onToast?.('אנליטיקס עודכן', 'success');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally { setAnalyticsLoading(false); }
  };

  /* ── Save template ────────────────────────────────────────────────────── */
  const handleSaveTemplate = async () => {
    if (!newTemplate.name || !newTemplate.subject || !newTemplate.body) {
      onToast?.('מלא את כל השדות', 'error'); return;
    }
    setTemplatesLoading(true);
    try {
      if (editingTemplate) {
        await updateTemplate(wid, editingTemplate.id, newTemplate);
      } else {
        await saveTemplate(wid, { ...newTemplate as Omit<EmailTemplate,'id'>, usageCount: 0, createdAt: Date.now() });
      }
      setTemplates(await loadTemplates(wid));
      setShowTemplateForm(false); setEditingTemplate(null);
      setNewTemplate({ category: 'first_contact' });
      onToast?.(editingTemplate ? 'תבנית עודכנה' : 'תבנית נשמרה', 'success');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally { setTemplatesLoading(false); }
  };

  /* ── Search emails ─────────────────────────────────────────────────────── */
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const token = Object.values(_liveTokens)[0];
    if (!token) { onToast?.('חבר חשבון Gmail תחילה', 'error'); return; }
    setSearchLoading(true);
    setSearchResults([]);
    try {
      const results = await searchEmails(token, searchQuery.trim(), 20);
      setSearchResults(results);
      if (!results.length) onToast?.('לא נמצאו מיילים', 'info');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  /* ── Ask AI about mailbox ──────────────────────────────────────────────── */
  const handleAsk = async () => {
    if (!askQuestion.trim()) return;
    const token = Object.values(_liveTokens)[0];
    if (!token) { onToast?.('חבר חשבון Gmail תחילה', 'error'); return; }
    setAskLoading(true);
    setAskAnswer(null);
    try {
      // First search for relevant emails based on the question
      const emails = await searchEmails(token, askQuestion.trim(), 15);
      const result = await askAboutEmails(askQuestion.trim(), emails, config);
      setAskAnswer(result);
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setAskLoading(false);
    }
  };

  /* ── Save agent config ─────────────────────────────────────────────────── */
  const handleSaveAgent = async () => {
    setSavingCfg(true);
    await saveAgentConfig(wid, config);
    setSavingCfg(false);
    onToast?.('נשמר', 'success');
  };

  /* ── Knowledge ─────────────────────────────────────────────────────────── */
  const handleAddKnowledge = async () => {
    if (!newQ.trim() || !newA.trim()) return;
    setAddingK(true);
    await addKnowledgeEntry(wid, { question: newQ.trim(), answer: newA.trim(), category: newCat, addedBy: 'user', createdAt: Date.now() });
    setKnowledge(await loadKnowledge(wid));
    setNewQ(''); setNewA(''); setNewCat('general'); setShowKForm(false); setAddingK(false);
    onToast?.('ידע נוסף', 'success');
  };

  /* ── Send draft ────────────────────────────────────────────────────────── */
  const handleSendDraft = async (draft: EmailDraft) => {
    const token = _liveTokens[draft.accountId] ?? (draft.provider === 'outlook' ? getOutlookToken(draft.accountId) : null);
    if (!token) { onToast?.('חבר את החשבון שוב', 'error'); return; }
    setSending(draft.id);
    try {
      const body = editingDraft === draft.id ? editText : draft.aiDraft;
      if (draft.provider === 'gmail') {
        await sendGmailReply(token, draft.fromEmail, draft.subject, body, draft.threadId);
      } else {
        await sendOutlookReply(token, draft.messageId, body);
      }
      await updateDraftStatus(wid, draft.id, 'sent', editingDraft === draft.id ? editText : undefined);
      setDrafts(p => p.map(d => d.id === draft.id ? { ...d, status: 'sent' } : d));
      setEditingDraft(null);
      onToast?.('נשלח ✓', 'success');
    } catch (err) {
      onToast?.(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setSending(null);
    }
  };

  const handleRejectDraft = useCallback(async (id: string) => {
    await updateDraftStatus(wid, id, 'rejected');
    setDrafts(p => p.map(d => d.id === id ? { ...d, status: 'rejected' } : d));
  }, [wid]);

  /* ── WhatsApp: verify token ─────────────────────────────────────────────── */
  const handleVerifyWa = async () => {
    if (!waDraft.phoneNumberId || !waDraft.accessToken) { onToast?.('מלא Phone Number ID ו-Access Token', 'error'); return; }
    setWaVerifying(true);
    try {
      const phone = await verifyWhatsAppToken(waDraft.phoneNumberId, waDraft.accessToken);
      onToast?.(`אומת! מספר: ${phone}`, 'success');
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setWaVerifying(false); }
  };

  /* ── WhatsApp: save config ───────────────────────────────────────────────── */
  const handleSaveWa = async () => {
    if (!waDraft.phoneNumberId || !waDraft.accessToken || !waDraft.webhookToken) {
      onToast?.('מלא את כל השדות הנדרשים', 'error'); return;
    }
    setWaSavingCfg(true);
    try {
      const newCfg: WhatsAppConfig = {
        connected: true,
        phoneNumberId: waDraft.phoneNumberId!,
        accessToken:   waDraft.accessToken!,
        webhookToken:  waDraft.webhookToken!,
        businessName:  waDraft.businessName,
        connectedAt:   Date.now(),
      };
      await saveWhatsAppConfig(wid, newCfg);
      setWaCfg(newCfg);
      setShowWaSetup(false);
      unsubConvRef.current?.();
      unsubConvRef.current = listenConversations(wid, setWaConvs);
      onToast?.('WhatsApp חובר בהצלחה ✓', 'success');
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setWaSavingCfg(false); }
  };

  /* ── WhatsApp: send reply ────────────────────────────────────────────────── */
  const handleWaSend = async (text: string, msgId?: string) => {
    if (!waCfg || !selPhone || !text.trim()) return;
    setWaSending(true);
    try {
      await sendWhatsAppMessage(waCfg.phoneNumberId, waCfg.accessToken, selPhone, text.trim());
      await storeAgentMessage(wid, selPhone, text.trim());
      if (msgId) await markMessageSent(wid, selPhone, msgId);
      setWaReply('');
      onToast?.('נשלח ✓', 'success');
    } catch (err) { onToast?.(`שגיאה: ${(err as Error).message}`, 'error'); }
    finally { setWaSending(false); }
  };

  const pendingDrafts = drafts.filter(d => d.status === 'pending');

  /* ── Email connection detection ────────────────────────────────────────── */
  // Two paths to "email connected":
  // 1. OAuth accounts (config.accounts) → full inbox read capability
  // 2. Workspace SMTP (workspace.emailConfig) → sending only, but user DID connect email
  const smtpConnected  = !!(workspace?.emailConfig?.gmailUser && workspace?.emailConfig?.gmailAppPasswordSet);
  const oauthConnected = config.accounts.length > 0;
  const emailAnyConnected = oauthConnected || smtpConnected;
  // accounts are saved but no live token (e.g. after page refresh) — tokenTick forces re-check
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const needsReconnect = oauthConnected && tokenTick >= 0 &&
    config.accounts.every(a => !_liveTokens[a.id] && !(a.provider === 'outlook' && getOutlookToken(a.id)));
  const whatsappConnected = waCfg?.connected === true;

  /* ── Onboarding steps ──────────────────────────────────────────────────── */
  const onboardingSteps = useMemo(() => [
    {
      id: 'email', emoji: '📧',
      label: oauthConnected ? 'מייל מחובר (OAuth)' : smtpConnected ? 'מייל מחובר (SMTP)' : 'חבר מייל',
      desc: oauthConnected
        ? `${config.accounts[0]?.email ?? ''} — קריאה ושליחה מלאה`
        : smtpConnected
          ? `${workspace?.emailConfig?.gmailUser} — מחובר לשליחה. הוסף OAuth לקריאת תיבת דואר`
          : 'Gmail או Outlook — כך הסוכן קורא ומגיב למיילים',
      done: emailAnyConnected,
      partial: smtpConnected && !oauthConnected, // has SMTP but not OAuth
      action: smtpConnected && !oauthConnected
        ? () => setTab('accounts')       // guide them to add OAuth in accounts tab
        : () => onNavigate?.('integrations'),
      actionLabel: smtpConnected && !oauthConnected
        ? 'הפעל קריאת תיבת דואר →'
        : 'חבר מייל →',
      color: oauthConnected ? '#10b981' : smtpConnected ? '#f59e0b' : '#ea4335',
    },
    {
      id: 'whatsapp', emoji: '💬', label: 'חבר WhatsApp',
      desc: 'לקבלת ושליחת הודעות WhatsApp עסקי',
      done: whatsappConnected,
      action: () => onNavigate?.('integrations'),
      actionLabel: 'חבר WhatsApp →',
      color: '#25D366',
    },
    {
      id: 'personality', emoji: '🧠', label: 'הגדר אישיות הסוכן',
      desc: 'שם, תפקיד, תיאור עסקי וסגנון תקשורת',
      done: (config.businessDescription?.length ?? 0) > 20,
      action: () => setTab('agent'),
      actionLabel: 'הגדר אישיות →',
      color: '#6366f1',
    },
    {
      id: 'knowledge', emoji: '📚', label: 'הוסף בסיס ידע',
      desc: 'לפחות 3 שאלות ותשובות — כך הסוכן לומד את העסק שלך',
      done: knowledge.length >= 3,
      action: () => setTab('knowledge'),
      actionLabel: `הוסף ידע (${knowledge.length}/3) →`,
      color: '#8b5cf6',
    },
    {
      id: 'launch', emoji: '🚀', label: 'הפעל את הסוכן',
      desc: 'הסוכן יתחיל לנטר מיילים ולייצר תשובות לאישורך',
      done: config.enabled === true,
      action: () => setConfig(p => ({ ...p, enabled: true })),
      actionLabel: 'הפעל עכשיו →',
      color: '#10b981',
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [oauthConnected, smtpConnected, emailAnyConnected, config.businessDescription, config.enabled, knowledge.length, whatsappConnected]);

  const onboardingDone = onboardingSteps.every(s => s.done);
  const onboardingProgress = onboardingSteps.filter(s => s.done).length;
  const nextStep = onboardingSteps.find(s => !s.done);

  /* ── Learning stats ───────────────────────────────────────────────────── */
  const learningStats = useMemo(() => {
    const sent     = drafts.filter(d => d.status === 'sent').length;
    const rejected = drafts.filter(d => d.status === 'rejected').length;
    const total    = sent + rejected;
    const approvalRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const avgConf = drafts.length
      ? Math.round(drafts.reduce((s, d) => s + (d.confidence ?? 0), 0) / drafts.length)
      : 0;
    const autoSendReady = config.learnFromReplies && sent >= 10 && avgConf >= (config.confidenceThreshold ?? 90);
    return { sent, rejected, total, approvalRate, avgConf, autoSendReady };
  }, [drafts, config.learnFromReplies, config.confidenceThreshold]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="w-full px-4 py-6 space-y-5" dir="rtl">

      {/* ══ Header ══════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            <Brain size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black" style={{ color: c.textPrimary }}>סוכן מכירות AI</h1>
            <div className="flex items-center gap-2">
              {config.enabled ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/> פעיל
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"/> לא פעיל
                </span>
              )}
              <span className="text-xs" style={{ color: c.textMuted }}>•</span>
              <span className="text-xs font-medium" style={{ color: c.textMuted }}>
                {config.accounts.length} חשבון{config.accounts.length !== 1 ? 'ות' : ''} מחובר
              </span>
              {learningStats.sent > 0 && (
                <>
                  <span className="text-xs" style={{ color: c.textMuted }}>•</span>
                  <span className="text-xs font-medium" style={{ color: c.textMuted }}>
                    🧠 למד מ-{learningStats.sent} מיילים
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Learning badge */}
          {learningStats.autoSendReady && !config.autoSend && (
            <button onClick={() => { setConfig(p => ({ ...p, autoSend: true })); onToast?.('מצב אוטומטי הופעל! 🚀', 'success'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl animate-pulse"
              style={{ background: 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(5,150,105,0.1))', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981' }}>
              <BadgeCheck size={12} /> הסוכן מוכן לאוטומציה מלאה!
            </button>
          )}
          <button onClick={handleCheckEmails} disabled={checking || !oauthConnected}
            title={smtpConnected && !oauthConnected ? 'נדרש חיבור OAuth לקריאת תיבת דואר — הוסף מטאב "מייל"' : ''}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all shadow-md hover:shadow-lg"
            style={{ background: smtpConnected && !oauthConnected ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            {checking ? 'בודק...' : smtpConnected && !oauthConnected ? 'נדרש OAuth לקריאה' : 'בדוק מיילים'}
          </button>
        </div>
      </div>

      {/* ══ ONBOARDING WIZARD ═══════════════════════════════════════════════ */}
      {!onboardingDone && !onboardingCollapsed && (
        <div className="rounded-3xl overflow-hidden shadow-xl"
          style={{ background: 'linear-gradient(135deg,rgba(79,70,229,0.12),rgba(124,58,237,0.08))', border: '1px solid rgba(99,102,241,0.3)' }}>
          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(135deg,rgba(79,70,229,0.2),rgba(124,58,237,0.12))' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow: '0 0 20px rgba(79,70,229,0.4)' }}>
                🚀
              </div>
              <div>
                <h2 className="font-black text-base" style={{ color: c.textPrimary }}>הגדרת סוכן מכירות AI</h2>
                <p className="text-[11px]" style={{ color: c.textMuted }}>השלם {5 - onboardingProgress} צעדים נוספים כדי שהסוכן יתחיל לעבוד</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Progress */}
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {onboardingSteps.map(s => (
                    <div key={s.id} className="w-8 h-1.5 rounded-full transition-all"
                      style={{ background: s.done ? '#10b981' : 'rgba(255,255,255,0.15)' }} />
                  ))}
                </div>
                <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>{onboardingProgress}/5</span>
              </div>
              <button onClick={() => { setOnboardingCollapsed(true); localStorage.removeItem(`emailAgent_onboardingCollapsed_${workspaceId ?? 'default'}`); }}
                className="p-1.5 rounded-xl text-xs" style={{ color: c.textMuted, background: 'rgba(255,255,255,0.06)' }}>
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Steps grid */}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-5 gap-3">
            {onboardingSteps.map((step, idx) => (
              <div key={step.id}
                className="rounded-2xl p-4 transition-all cursor-pointer"
                style={{
                  background: step.done
                    ? `linear-gradient(135deg,${step.color}15,${step.color}08)`
                    : step === nextStep
                      ? 'rgba(255,255,255,0.07)'
                      : 'rgba(255,255,255,0.03)',
                  border: step.done
                    ? `1px solid ${step.color}40`
                    : step === nextStep
                      ? '1px solid rgba(99,102,241,0.35)'
                      : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: step === nextStep ? '0 0 20px rgba(99,102,241,0.15)' : 'none',
                }}
                onClick={step.done ? undefined : step.action}>
                {/* Step number + check */}
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-2xl">{step.emoji}</span>
                  {step.done
                    ? <CheckCheck size={16} style={{ color: step.color }} />
                    : <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black"
                        style={{ background: step === nextStep ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)',
                          color: step === nextStep ? '#818cf8' : c.textMuted, border: `1px solid ${step === nextStep ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                        {idx + 1}
                      </span>
                  }
                </div>
                <p className="text-sm font-bold mb-1" style={{ color: step.done ? step.color : c.textPrimary }}>{step.label}</p>
                <p className="text-[10px] leading-relaxed mb-3" style={{ color: c.textMuted }}>{step.desc}</p>
                {!step.done && (
                  <button className="w-full text-center text-[10px] font-bold py-1.5 rounded-lg transition-all"
                    style={{
                      background: step === nextStep ? `linear-gradient(135deg,${step.color},${step.color}cc)` : 'rgba(255,255,255,0.06)',
                      color: step === nextStep ? 'white' : c.textMuted,
                      border: step === nextStep ? 'none' : '1px solid rgba(255,255,255,0.08)',
                    }}>
                    {step.actionLabel}
                  </button>
                )}
                {step.done && (
                  <p className="text-[10px] font-bold" style={{ color: step.color }}>✓ הושלם</p>
                )}
              </div>
            ))}
          </div>

          {/* Next step highlight */}
          {nextStep && (
            <div className="px-5 pb-4">
              <button onClick={nextStep.action}
                className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:scale-[1.01]"
                style={{ background: `linear-gradient(135deg,${nextStep.color},${nextStep.color}cc)`,
                  boxShadow: `0 4px 20px ${nextStep.color}40` }}>
                <span className="flex items-center gap-2">
                  <span>{nextStep.emoji}</span>
                  <span>הצעד הבא: {nextStep.label}</span>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsed onboarding bar */}
      {!onboardingDone && onboardingCollapsed && (
        <button onClick={() => { setOnboardingCollapsed(false); localStorage.setItem(`emailAgent_onboardingCollapsed_${workspaceId ?? 'default'}`, 'false'); }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all"
          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <Rocket size={14} style={{ color: '#818cf8' }} />
          <span className="font-semibold" style={{ color: c.textSecondary }}>
            הגדרת הסוכן — {onboardingProgress}/5 שלבים הושלמו
          </span>
          <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(onboardingProgress/5)*100}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
          </div>
          <ChevronDown size={13} style={{ color: c.textMuted }} />
        </button>
      )}

      {/* Onboarding complete banner */}
      {onboardingDone && !config.enabled && (
        <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl"
          style={{ background: 'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(5,150,105,0.08))', border: '1px solid rgba(16,185,129,0.3)' }}>
          <BadgeCheck size={18} style={{ color: '#10b981' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: '#10b981' }}>הסוכן מוגדר ומוכן!</p>
            <p className="text-[11px]" style={{ color: c.textMuted }}>לחץ "הפעל" כדי שהסוכן יתחיל לנטר מיילים</p>
          </div>
          <button onClick={() => setConfig(p => ({ ...p, enabled: true }))}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
            🚀 הפעל סוכן
          </button>
        </div>
      )}

      {/* Pending drafts alert */}
      {pendingDrafts.length > 0 && (
        <div onClick={() => setTab('inbox')}
          className="cursor-pointer flex items-center gap-3 px-4 py-3 rounded-2xl hover:scale-[1.005] transition-all"
          style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(217,119,6,0.08))', border: '1px solid rgba(245,158,11,0.35)' }}>
          <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.2)' }}>
            <Flame size={14} style={{ color: '#f59e0b' }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>
              {pendingDrafts.length} מייל{pendingDrafts.length !== 1 ? 'ים' : ''} ממתין{pendingDrafts.length !== 1 ? 'ים' : ''} לאישורך
            </p>
            <p className="text-[11px]" style={{ color: c.textMuted }}>הסוכן הכין תשובות — לחץ לאישור ושליחה</p>
          </div>
          <ArrowRight size={14} style={{ color: '#f59e0b' }} />
        </div>
      )}

      {/* ══ Tabs ════════════════════════════════════════════════════════════ */}
      <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
        style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${c.cardBorder}` }}>
        {([
          { id: 'inbox',     label: `תיבת דואר${pendingDrafts.length ? ` (${pendingDrafts.length})` : ''}`, icon: Mail },
          { id: 'compose',   label: 'כתיבה קולית', icon: Mic },
          { id: 'search',    label: 'חיפוש AI', icon: Search },
          { id: 'analytics', label: 'אנליטיקס', icon: TrendingUp },
          { id: 'agent',     label: 'אישיות הסוכן', icon: Brain },
          { id: 'knowledge', label: `בסיס ידע (${knowledge.length})`, icon: BookOpen },
          { id: 'settings',  label: 'הגדרות', icon: Settings },
          { id: 'workflows', label: 'בונה אוטומציות', icon: GitBranch },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
            style={{
              minWidth: '80px',
              ...(tab === t.id
                ? { background: isDark ? 'rgba(99,102,241,0.25)' : 'white', color: '#6366f1',
                    boxShadow: isDark ? '0 0 12px rgba(99,102,241,0.2)' : '0 1px 6px rgba(0,0,0,0.1)',
                    border: '1px solid rgba(99,102,241,0.3)' }
                : { color: c.textMuted, background: 'transparent', border: '1px solid transparent' })
            }}>
            <t.icon size={12} />
            <span>{t.label}</span>
            {t.id === 'inbox' && pendingDrafts.length > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-black min-w-[16px] h-4 rounded-full flex items-center justify-center px-1">
                {pendingDrafts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ INBOX TAB (main email inbox + AI approval) ══════════════════════ */}
      {tab === 'inbox' && (
        <div className="space-y-4">

          {/* ── Reconnect banner: accounts saved but no live token ─────────── */}
          {needsReconnect && (
            <div className="rounded-2xl p-4 flex items-center gap-4"
              style={{ background: 'linear-gradient(135deg,rgba(239,68,68,0.08),rgba(220,38,38,0.05))', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(239,68,68,0.12)' }}>🔌</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: '#ef4444' }}>
                  המייל מנותק — נדרש חיבור מחדש
                </p>
                <p className="text-xs mt-0.5" style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)' }}>
                  {config.accounts[0]?.email} — הטוקן פג תוקף עם רענון הדף. לחץ לחיבור מחדש.
                </p>
              </div>
              <button
                onClick={() => handleReconnect(config.accounts[0])}
                disabled={connecting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white flex-shrink-0 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}>
                {connecting ? <><Loader2 size={14} className="animate-spin"/>מחבר...</> : <>🔑 חבר מחדש</>}
              </button>
            </div>
          )}

          {/* Learning Progress Bar */}
          {learningStats.total > 0 && (
            <div className="rounded-2xl p-4 flex items-center gap-4"
              style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.04)', border: `1px solid ${c.cardBorder}` }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.15))', border: '1px solid rgba(99,102,241,0.3)' }}>
                <Bot size={18} style={{ color: '#818cf8' }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold" style={{ color: c.textPrimary }}>
                    🧠 הסוכן למד מ-{learningStats.sent} מיילים — ביטחון ממוצע {learningStats.avgConf}%
                  </span>
                  {learningStats.autoSendReady ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
                      🚀 מוכן לאוטומציה
                    </span>
                  ) : (
                    <span className="text-[10px]" style={{ color: c.textMuted }}>
                      עוד {Math.max(0, 10 - learningStats.sent)} מיילים לאוטומציה מלאה
                    </span>
                  )}
                </div>
                <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100,(learningStats.sent/10)*100)}%`,
                      background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', boxShadow: '0 0 8px rgba(99,102,241,0.4)' }} />
                </div>
                <div className="flex gap-4 mt-1.5">
                  <span className="text-[10px]" style={{ color: c.textMuted }}>✓ {learningStats.sent} אושרו ונשלחו</span>
                  <span className="text-[10px]" style={{ color: c.textMuted }}>↩ {learningStats.rejected} נדחו</span>
                  <span className="text-[10px]" style={{ color: c.textMuted }}>📊 {learningStats.approvalRate}% שיעור אישור</span>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {drafts.length === 0 ? (
            <div className="rounded-3xl p-12 text-center"
              style={{ background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', border: `1px dashed ${c.cardBorder}` }}>
              <div className="w-16 h-16 rounded-3xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <Mail size={28} style={{ color: '#818cf8' }} />
              </div>
              <p className="font-black text-base mb-1" style={{ color: c.textPrimary }}>תיבת הדואר ריקה</p>
              <p className="text-sm mb-4" style={{ color: c.textMuted }}>לחץ "בדוק מיילים" כדי שהסוכן יסרוק מיילים נכנסים ויכין תשובות</p>
              {!emailAnyConnected && (
                <button onClick={() => onNavigate?.('integrations')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                  <PlugZap size={14} /> חבר מייל תחילה
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Filter row */}
              <div className="flex items-center gap-2 overflow-x-auto">
                {(['all','pending','sent','rejected'] as const).map(s => (
                  <button key={s}
                    className="flex-shrink-0 whitespace-nowrap text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-all"
                    style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                    {s === 'all' ? `הכל (${drafts.length})` : s === 'pending' ? `ממתין (${pendingDrafts.length})` : s === 'sent' ? `נשלח (${drafts.filter(d=>d.status==='sent').length})` : `נדחה (${drafts.filter(d=>d.status==='rejected').length})`}
                  </button>
                ))}
              </div>
              {drafts.map(draft => (
                <div key={draft.id}>
                  <EnhancedDraftCard draft={draft}
                    expanded={expandedDraft === draft.id}
                    editing={editingDraft === draft.id}
                    editText={editText}
                    sending={sending === draft.id}
                    isDark={isDark}
                    c={c}
                    onToggleExpand={() => setExpandedDraft(p => p === draft.id ? null : draft.id)}
                    onStartEdit={() => { setEditingDraft(draft.id); setEditText(draft.aiDraft); }}
                    onCancelEdit={() => setEditingDraft(null)}
                    onEditText={setEditText}
                    onSend={() => handleSendDraft(draft)}
                    onReject={() => handleRejectDraft(draft.id)}
                  />
                  {draftScores[draft.id] && (
                    <div className="flex items-center gap-2 px-4 pb-2">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={{
                          background: draftScores[draft.id].tier === 'hot' ? '#ef444422' : draftScores[draft.id].tier === 'warm' ? '#f59e0b22' : '#6b728022',
                          color: draftScores[draft.id].tier === 'hot' ? '#ef4444' : draftScores[draft.id].tier === 'warm' ? '#f59e0b' : '#6b7280',
                        }}>
                        {draftScores[draft.id].tier === 'hot' ? '🔥 ליד חם' : draftScores[draft.id].tier === 'warm' ? '⚡ ליד חמים' : '❄️ ליד קר'} {draftScores[draft.id].score}
                      </span>
                      <span className="text-[10px]" style={{ color: c.textMuted }}>{draftScores[draft.id].sentiment === 'urgent' ? '⚠️ דחוף' : draftScores[draft.id].sentiment === 'positive' ? '😊 חיובי' : ''}</span>
                      <button onClick={() => handleScoreDraft(draft)} className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: c.textMuted, border: `1px solid ${c.cardBorder}` }}>
                        נתח
                      </button>
                    </div>
                  )}
                  {!draftScores[draft.id] && (
                    <div className="px-4 pb-2">
                      <button onClick={() => handleScoreDraft(draft)} className="text-[10px] px-2 py-0.5 rounded-full transition-colors hover:opacity-80"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}>
                        🎯 נתח ליד
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Follow-up reminder bar ─────────────────────────────────────── */}
      {tab === 'inbox' && config.accounts.length > 0 && !followUpsLoaded && (
        <button onClick={handleLoadFollowUps}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-right transition-all hover:scale-[1.005]"
          style={{ background: 'linear-gradient(135deg,rgba(59,130,246,0.1),rgba(99,102,241,0.07))', border: '1px solid rgba(59,130,246,0.25)' }}>
          <Clock size={16} style={{ color: '#3b82f6' }} className="flex-shrink-0"/>
          <div className="flex-1 text-right">
            <p className="text-sm font-bold" style={{ color: '#3b82f6' }}>בדוק מיילים שממתינים למעקב</p>
            <p className="text-[11px]" style={{ color: c.textMuted }}>מצא מיילים שיצאו לפני {config.followUpDays || 3}+ ימים ולא קיבלו תשובה</p>
          </div>
          <RefreshCw size={13} style={{ color: '#3b82f6' }}/>
        </button>
      )}
      {tab === 'inbox' && followUps.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <p className="text-xs font-black" style={{ color: '#3b82f6' }}>⏰ {followUps.length} מיילים ממתינים למעקב</p>
          {followUps.slice(0, 5).map(e => (
            <div key={e.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
              <Mail size={12} style={{ color: c.textMuted }}/>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate" style={{ color: c.text }}>{e.subject}</p>
                <p className="text-[10px]" style={{ color: c.textMuted }}>{e.fromName || e.from} · {new Date(e.date).toLocaleDateString('he-IL')}</p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-lg font-bold flex-shrink-0" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>שלח מעקב</span>
            </div>
          ))}
        </div>
      )}

      {/* ══ SEARCH AI TAB ════════════════════════════════════════════════════ */}
      {tab === 'compose' && (
        <VoiceEmailComposer
          workspaceId={workspaceId}
          config={config}
          leads={leads}
          isDark={isDark}
          onToast={(m, t) => onToast?.(m, t ?? 'info')}
        />
      )}

      {tab === 'search' && (
        <div className="space-y-4" dir="rtl">

          {/* Mode toggle */}
          <div className="flex gap-2 p-1 rounded-2xl" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${c.cardBorder}` }}>
            {([
              { id: 'ask',    label: '🤖 שאל את הסוכן', desc: 'שאל שאלה — הסוכן יחפש ויענה' },
              { id: 'search', label: '🔍 חיפוש מיילים',  desc: 'חפש לפי מילות מפתח' },
            ] as const).map(m => (
              <button key={m.id} onClick={() => setSearchMode(m.id)}
                className="flex-1 py-2.5 px-3 rounded-xl text-sm font-bold transition-all"
                style={searchMode === m.id
                  ? { background: isDark ? 'rgba(99,102,241,0.25)' : 'white', color: '#6366f1', boxShadow: '0 1px 6px rgba(0,0,0,0.1)', border: '1px solid rgba(99,102,241,0.3)' }
                  : { color: c.textMuted, background: 'transparent', border: '1px solid transparent' }}>
                {m.label}
              </button>
            ))}
          </div>

          {/* ASK mode */}
          {searchMode === 'ask' && (
            <div className="space-y-4">
              <div className="rounded-2xl p-5 space-y-3" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <Bot size={18} style={{ color: '#6366f1' }} />
                  <h3 className="font-black text-base" style={{ color: c.text }}>שאל את הסוכן על המייל שלך</h3>
                </div>
                <p className="text-xs" style={{ color: c.textMuted }}>הסוכן יחפש במייל שלך ויתן לך תשובה מפורטת</p>
                <div className="flex gap-2">
                  <textarea
                    value={askQuestion}
                    onChange={e => setAskQuestion(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAsk(); }}
                    placeholder="לדוגמה: מה הסטטוס של ההצעה שהגשתי ללקוח אבי? / האם יש מיילים שממתינים לתשובה מהשבוע? / מה סיכמנו עם דוד לגבי המחיר?"
                    rows={3}
                    className="flex-1 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', border: `1px solid ${c.cardBorder}`, color: c.text }}
                  />
                  <button onClick={handleAsk} disabled={askLoading || !askQuestion.trim()}
                    className="px-4 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 flex flex-col items-center justify-center gap-1 min-w-[70px]"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 4px 15px rgba(99,102,241,0.3)' }}>
                    {askLoading
                      ? <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin"/>
                      : <><Bot size={16}/><span className="text-[10px]">Ctrl+↵</span></>
                    }
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['מיילים שממתינים לתשובה', 'הצעות מחיר שהגשתי', 'לקוחות שלא ענו', 'פגישות השבוע', 'תלונות לקוחות'].map(s => (
                    <button key={s} onClick={() => setAskQuestion(s)}
                      className="text-[11px] px-2.5 py-1 rounded-full transition-colors hover:opacity-80"
                      style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Answer */}
              {askLoading && (
                <div className="rounded-2xl p-6 flex flex-col items-center gap-3" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                  <div className="w-10 h-10 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin"/>
                  <p className="text-sm font-semibold" style={{ color: c.textMuted }}>מחפש במייל שלך ומנתח...</p>
                </div>
              )}
              {askAnswer && !askLoading && (
                <div className="rounded-2xl p-5 space-y-4" style={{ background: c.cardBg, border: '1px solid rgba(99,102,241,0.25)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <Bot size={16} className="text-white"/>
                    </div>
                    <h4 className="font-black text-sm" style={{ color: c.text }}>תשובת הסוכן</h4>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: c.text }}>{askAnswer.answer}</p>
                  {askAnswer.sources.length > 0 && (
                    <div className="pt-3 border-t" style={{ borderColor: c.cardBorder }}>
                      <p className="text-[11px] font-bold mb-2" style={{ color: c.textMuted }}>מיילים רלוונטיים שנסרקו:</p>
                      <div className="space-y-1.5">
                        {askAnswer.sources.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', border: `1px solid ${c.cardBorder}` }}>
                            <Mail size={11} style={{ color: c.textMuted }} className="flex-shrink-0"/>
                            <span className="text-xs font-semibold truncate" style={{ color: c.text }}>{s.subject}</span>
                            <span className="text-[10px] flex-shrink-0" style={{ color: c.textMuted }}>— {s.from}</span>
                            <span className="text-[10px] flex-shrink-0 mr-auto" style={{ color: c.textMuted }}>{new Date(s.date).toLocaleDateString('he-IL')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SEARCH mode */}
          {searchMode === 'search' && (
            <div className="space-y-4">
              <div className="rounded-2xl p-5 space-y-3" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                <div className="flex gap-2">
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="חפש מיילים... (לדוגמה: from:david@co.il, subject:הצעה, הזמנה)"
                    className="flex-1 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', border: `1px solid ${c.cardBorder}`, color: c.text, direction: 'ltr' }}
                  />
                  <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()}
                    className="px-5 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    {searchLoading ? <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin"/> : <Search size={16}/>}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['is:unread', 'from:boss@', 'subject:חשבונית', 'has:attachment', 'newer_than:7d'].map(s => (
                    <button key={s} onClick={() => setSearchQuery(s)}
                      className="text-[11px] px-2.5 py-1 rounded-full font-mono transition-colors hover:opacity-80"
                      style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold px-1" style={{ color: c.textMuted }}>נמצאו {searchResults.length} תוצאות</p>
                  {searchResults.map(email => (
                    <div key={email.id} className="rounded-2xl p-4 space-y-1.5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate" style={{ color: c.text }}>{email.subject}</p>
                          <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>
                            {email.fromName || email.from} · {new Date(email.date).toLocaleDateString('he-IL')}
                          </p>
                        </div>
                        <span className="text-[10px] flex-shrink-0 px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>Gmail</span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: c.textMuted }}>{email.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}



      {/* ══ ANALYTICS TAB ════════════════════════════════════════════════════ */}
      {tab === 'analytics' && (
        <div className="space-y-4" dir="rtl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-lg" style={{ color: c.text }}>אנליטיקס מייל</h3>
              <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>סטטיסטיקות 30 ימים אחרונים</p>
            </div>
            <button onClick={handleLoadAnalytics} disabled={analyticsLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {analyticsLoading
                ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/>
                : <RefreshCw size={14}/>}
              {analyticsLoading ? 'טוען...' : 'עדכן נתונים'}
            </button>
          </div>
          {!analytics ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
              <p className="text-5xl mb-3">📊</p>
              <p className="font-bold" style={{ color: c.text }}>לחץ "עדכן נתונים" לטעינת הסטטיסטיקות</p>
              <p className="text-xs mt-1" style={{ color: c.textMuted }}>נדרש חיבור Gmail</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'מיילים שנשלחו', value: analytics.totalSent, icon: '📤', color: '#6366f1' },
                  { label: 'מיילים שהתקבלו', value: analytics.totalReceived, icon: '📥', color: '#10b981' },
                  { label: 'אחוז מענה', value: `${analytics.responseRate}%`, icon: '↩️', color: '#f59e0b' },
                  { label: 'זמן תגובה ממוצע', value: `${analytics.avgResponseTimeHours.toFixed(1)}ש'`, icon: '⏱️', color: '#3b82f6' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-2xl p-4 text-center" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                    <div className="text-2xl mb-1">{stat.icon}</div>
                    <div className="text-2xl font-black" style={{ color: stat.color }}>{stat.value}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>{stat.label}</div>
                  </div>
                ))}
              </div>
              {analytics.topSenders.length > 0 && (
                <div className="rounded-2xl p-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                  <p className="text-sm font-black mb-3" style={{ color: c.text }}>📬 השולחים הנפוצים ביותר</p>
                  <div className="space-y-2.5">
                    {analytics.topSenders.map((s, i) => (
                      <div key={s.email} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate" style={{ color: c.text }}>{s.name}</p>
                          <p className="text-[10px] truncate" style={{ color: c.textMuted }}>{s.email}</p>
                        </div>
                        <span className="text-sm font-black flex-shrink-0" style={{ color: '#6366f1' }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-center text-[10px]" style={{ color: c.textMuted }}>
                עודכן: {new Date(analytics.lastCalculated).toLocaleString('he-IL')}
              </p>
            </>
          )}
        </div>
      )}



      {/* ══════════════════════════════════════════════════════════════════
       * TAB: AGENT PERSONALITY
       * ══════════════════════════════════════════════════════════════════ */}
      {tab === 'agent' && (
        <div className="space-y-4 max-w-2xl" dir="rtl">

          {/* ── 1. זהות הסוכן ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-indigo-50 dark:from-indigo-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <Brain size={13} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">זהות הסוכן</h3>
                <p className="text-[10px] text-slate-400">שם, תפקיד, שפה וחתימה</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שם הסוכן</label>
                  <input value={config.agentName}
                    onChange={e => setConfig(p => ({ ...p, agentName: e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="סוכן מכירות AI" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">תפקיד</label>
                  <input value={config.agentRole}
                    onChange={e => setConfig(p => ({ ...p, agentRole: e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="מנהל מכירות" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שפת תגובה</label>
                <div className="flex gap-2">
                  {[{ v:'he', l:'🇮🇱 עברית' }, { v:'en', l:'🇺🇸 English' }, { v:'auto', l:'🌍 לפי השולח' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setConfig(p => ({ ...p, language: v as EmailAgentConfig['language'] }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        config.language === v
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">חתימה</label>
                <textarea value={config.signature}
                  onChange={e => setConfig(p => ({ ...p, signature: e.target.value }))}
                  rows={3}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
          </div>

          {/* ── 2. הקשר עסקי ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-emerald-50 dark:from-emerald-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <Globe size={13} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-slate-800 dark:text-white">הקשר עסקי</h3>
                <p className="text-[10px] text-slate-400">הסוכן ישתמש בזה לכל תגובה — ממלא אוטומטית מהגדרות העסק</p>
              </div>
              {workspace?.prompt && config.businessDescription !== workspace.prompt && (
                <button
                  onClick={() => setConfig(p => ({ ...p, businessDescription: workspace.prompt ?? '' }))}
                  className="text-[10px] font-semibold text-emerald-600 hover:underline flex-shrink-0">
                  ← ייבא מהגדרות
                </button>
              )}
            </div>
            <div className="p-5 space-y-3">
              {workspace?.prompt && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
                  <Info size={12} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">מהגדרות המערכת:</span> {workspace.prompt.slice(0, 140)}{workspace.prompt.length > 140 ? '...' : ''}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">תיאור העסק לסוכן המכירות</label>
                <textarea rows={4}
                  value={config.businessDescription}
                  onChange={e => setConfig(p => ({ ...p, businessDescription: e.target.value }))}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="תאר את העסק, המוצרים/שירותים, מחירים, קהל יעד, יתרון תחרותי — כל מה שהסוכן צריך לדעת כדי למכור..." />
                <p className="text-[10px] text-slate-400 mt-1">{config.businessDescription.length} תווים</p>
              </div>
              {/* Sales Goals */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">יעדי מכירה — מה הסוכן מנסה להשיג?</label>
                <div className="flex flex-wrap gap-2">
                  {['מכירה ישירה', 'ליד חם', 'קביעת פגישה', 'הצעת מחיר', 'הדגמה', 'טלפון', 'ניסיון חינם'].map(g => {
                    const on = config.salesGoals.includes(g);
                    return (
                      <button key={g}
                        onClick={() => setConfig(p => ({ ...p, salesGoals: on ? p.salesGoals.filter(x => x !== g) : [...p.salesGoals, g] }))}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all ${
                          on ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400'
                        }`}>{g}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── 3. הנחיות אישיות לסוכן ────────────────────────────────────── */}
          <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-violet-50 dark:from-violet-900/20 border-b border-violet-100 dark:border-violet-800">
              <div className="w-7 h-7 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                <Sparkles size={13} className="text-violet-600 dark:text-violet-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-slate-800 dark:text-white">הנחיות אישיות לסוכן</h3>
                <p className="text-[10px] text-slate-400">פרומפט שהסוכן קורא לפני כל תגובה — ממלא אוטומטית מהגדרות העסק</p>
              </div>
              {workspace?.aiInstructions && config.agentInstructions !== workspace.aiInstructions && (
                <button onClick={() => setConfig(p => ({ ...p, agentInstructions: workspace.aiInstructions ?? '' }))}
                  className="text-[10px] font-semibold text-violet-600 hover:underline flex-shrink-0">
                  ← ייבא מהגדרות
                </button>
              )}
            </div>
            <div className="p-5 space-y-3">
              {workspace?.aiInstructions && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800">
                  <Info size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-violet-700 dark:text-violet-400">
                    <span className="font-bold">הנחיות מהגדרות המערכת:</span> {workspace.aiInstructions.slice(0, 120)}{workspace.aiInstructions.length > 120 ? '...' : ''}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  פרומפט הנחיות לסוכן המכירות
                  <span className="font-normal text-slate-400 mr-1">— יוסף לכל מייל ותגובה</span>
                </label>
                <textarea rows={6}
                  value={config.agentInstructions}
                  onChange={e => setConfig(p => ({ ...p, agentInstructions: e.target.value }))}
                  className="w-full text-sm border border-violet-200 dark:border-violet-700 rounded-xl px-3 py-2.5 bg-violet-50/30 dark:bg-slate-700 text-slate-700 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder={`לדוגמה:\n- תמיד להתחיל בשאלה שמייצרת עניין\n- לא להזכיר מחירים בתגובה הראשונה\n- לנסות לקבוע שיחת טלפון כשלב ראשון\n- לענות תוך 3 משפטים מקסימום\n- תמיד להסיים עם CTA ברור\n- אם לקוח מתלונן — להתחיל באמפתיה`} />
                <p className="text-[10px] text-slate-400 mt-1">{config.agentInstructions.length} תווים</p>
              </div>
            </div>
          </div>

          {/* ── 4. סגנון תקשורת ───────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-pink-50 dark:from-pink-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center">
                <MessageSquare size={13} className="text-pink-600 dark:text-pink-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">סגנון תקשורת</h3>
                <p className="text-[10px] text-slate-400">איך הסוכן כותב ומתקשר</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Tone */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">טון כתיבה</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { v:'friendly',     l:'😊 ידידותי',    sub:'חם ואישי' },
                    { v:'professional', l:'💼 מקצועי',     sub:'עסקי ואמין' },
                    { v:'formal',       l:'📋 פורמלי',     sub:'רשמי ומדויק' },
                    { v:'assertive',    l:'🎯 נחרץ',       sub:'בטוח ומשכנע' },
                  ].map(({ v, l, sub }) => (
                    <button key={v}
                      onClick={() => setConfig(p => ({ ...p, replyTone: v as EmailAgentConfig['replyTone'] }))}
                      className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                        config.replyTone === v ? 'bg-pink-500 text-white border-pink-500' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>
                      <span>{l}</span>
                      <span className={`text-[9px] font-normal ${config.replyTone === v ? 'text-pink-100' : 'text-slate-400'}`}>{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Email length + Emoji */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">אורך מייל</label>
                  <div className="flex gap-1.5">
                    {[{ v:'short', l:'קצר' }, { v:'medium', l:'בינוני' }, { v:'long', l:'ארוך' }].map(({ v, l }) => (
                      <button key={v}
                        onClick={() => setConfig(p => ({ ...p, emailLength: v as EmailAgentConfig['emailLength'] }))}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          config.emailLength === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">אימוג'י</label>
                  <div className="flex gap-1.5">
                    <button onClick={() => setConfig(p => ({ ...p, useEmoji: false }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${!config.useEmoji ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>🚫 ללא</button>
                    <button onClick={() => setConfig(p => ({ ...p, useEmoji: true }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${config.useEmoji ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>😊 כן</button>
                  </div>
                </div>
              </div>
              {/* CTA style */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">סגנון קריאה לפעולה (CTA)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {[
                    { v:'call',    l:'📞 שיחה' },
                    { v:'meeting', l:'📅 פגישה' },
                    { v:'demo',    l:'🖥️ הדגמה' },
                    { v:'reply',   l:'✉️ תשובה' },
                    { v:'link',    l:'🔗 קישור' },
                  ].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setConfig(p => ({ ...p, ctaInEmail: v as EmailAgentConfig['ctaInEmail'] }))}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                        config.ctaInEmail === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Save */}
          <button onClick={handleSaveAgent} disabled={savingCfg}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            {savingCfg ? <><Loader2 size={14} className="animate-spin" /> שומר...</> : <><Check size={14} /> שמור אישיות הסוכן</>}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
       * TAB: KNOWLEDGE BASE (improved)
       * ══════════════════════════════════════════════════════════════════ */}
      {tab === 'knowledge' && (
        <div className="space-y-4" dir="rtl">

          {/* ── Header bar ──────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={kSearch} onChange={e => setKSearch(e.target.value)}
                placeholder="חפש בבסיס הידע..."
                className="w-full text-sm pr-8 pl-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            {/* Category filter */}
            <select value={kFilter} onChange={e => setKFilter(e.target.value as KnowledgeEntry['category'] | 'all')}
              className="text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="all">כל הקטגוריות</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{typeof v === 'object' ? `${v.emoji} ${v.label}` : v}</option>
              ))}
            </select>
            {/* AI Generate button */}
            <button onClick={() => {/* handleGenerateKnowledge */}}
              disabled={generatingKnowledge}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50 transition-all"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
              {generatingKnowledge ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              צור מהמידע העסקי
            </button>
            {/* Add manual */}
            <button onClick={() => setShowKForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors">
              <Plus size={13} /> הוסף ידע
            </button>
          </div>

          {/* ── Category coverage pills ─────────────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CATEGORY_LABELS).map(([cat, val]) => {
              const count = knowledge.filter(k => k.category === cat).length;
              const label = typeof val === 'object' ? val.label : val;
              const emoji = typeof val === 'object' ? val.emoji : '';
              return (
                <button key={cat}
                  onClick={() => setKFilter(kFilter === cat ? 'all' : cat as KnowledgeEntry['category'])}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[10px] font-bold border transition-all ${
                    kFilter === cat ? 'bg-indigo-600 text-white border-indigo-600' :
                    count === 0 ? 'border-dashed border-slate-300 text-slate-400' :
                    'border-slate-200 text-slate-600 bg-white hover:border-indigo-400'
                  }`}>
                  <span>{emoji}</span>
                  <span>{label}</span>
                  <span className={`rounded-full px-1 ${kFilter === cat ? 'bg-white/20 text-white' : count === 0 ? 'text-slate-300' : 'bg-indigo-100 text-indigo-700'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* ── Add form ────────────────────────────────────────────────────── */}
          {showKForm && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-2xl p-5 space-y-3">
              <h4 className="text-sm font-black text-indigo-700 dark:text-indigo-400">הוספת ידע חדש</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">קטגוריה</label>
                  <select value={newCat} onChange={e => setNewCat(e.target.value as KnowledgeEntry['category'])}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{typeof v === 'object' ? `${v.emoji} ${v.label}` : v}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-1">תגיות (אופציונלי)</label>
                  <input placeholder="מחיר, בסיסי, VIP"
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">שאלה / נושא</label>
                <input value={newQ} onChange={e => setNewQ(e.target.value)} placeholder="מהו המחיר של הפלאן הבסיסי?"
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-1">תשובה מלאה</label>
                <textarea value={newA} onChange={e => setNewA(e.target.value)} rows={3} placeholder="הפלאן הבסיסי עולה 99₪/חודש ומכיל..."
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddKnowledge} disabled={addingK || !newQ || !newA}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  <Check size={13} /> {addingK ? 'מוסיף...' : 'הוסף'}
                </button>
                <button onClick={() => setShowKForm(false)} className="px-4 py-2 text-slate-500 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">ביטול</button>
              </div>
            </div>
          )}

          {/* ── Edit modal ──────────────────────────────────────────────────── */}
          {editingK && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir="rtl">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-slate-900 dark:text-white">עריכת ידע</h3>
                  <button onClick={() => setEditingK(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X size={16} /></button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">שאלה / נושא</label>
                  <input value={editKQ} onChange={e => setEditKQ(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">תשובה</label>
                  <textarea value={editKA} onChange={e => setEditKA(e.target.value)} rows={5}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingK(null)} className="px-4 py-2 text-slate-500 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">ביטול</button>
                  <button
                    onClick={async () => {
                      if (!workspace?.id || !editingK) return;
                      await updateKnowledgeEntry(workspace.id, editingK, { question: editKQ, answer: editKA });
                      setKnowledge(prev => prev.map(k => k.id === editingK ? { ...k, question: editKQ, answer: editKA } : k));
                      setEditingK(null);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700">
                    <Check size={13} /> שמור
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Empty state ──────────────────────────────────────────────────── */}
          {knowledge.length === 0 && !showKForm && (
            <div className="bg-white dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-12 text-center">
              <BookOpen size={36} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-600 dark:text-slate-300 font-bold text-base mb-1">בסיס הידע ריק</p>
              <p className="text-slate-400 text-sm mb-5">הוסף מחירים, תיאורי מוצר, תנאי תשלום, שאלות נפוצות ועוד</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['💰 מחירים', '📦 מוצרים', '🤝 תנאים', '❓ שאלות נפוצות', '🏆 יתרונות', '⚠️ התנגדויות'].map(tag => (
                  <button key={tag} onClick={() => setShowKForm(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">{tag}</button>
                ))}
              </div>
              <button onClick={() => {/* handleGenerateKnowledge */}}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white mx-auto"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                <Sparkles size={12} /> או: צור אוטומטית מהמידע שיש לנו על העסק
              </button>
            </div>
          )}

          {/* ── Knowledge list ──────────────────────────────────────────────── */}
          {knowledge.length > 0 && (() => {
            const filtered = knowledge.filter(k =>
              (kFilter === 'all' || k.category === kFilter) &&
              (!kSearch || k.question.toLowerCase().includes(kSearch.toLowerCase()) || k.answer.toLowerCase().includes(kSearch.toLowerCase()))
            );
            if (filtered.length === 0) return (
              <div className="text-center py-8 text-slate-400 text-sm">
                לא נמצאו תוצאות עבור "{kSearch || kFilter}"
              </div>
            );
            // Group by category
            const grouped = Object.entries(CATEGORY_LABELS).map(([cat, val]) => ({
              cat, val, items: filtered.filter(k => k.category === cat)
            })).filter(g => g.items.length > 0);
            return (
              <div className="space-y-4">
                {grouped.map(({ cat, val, items }) => {
                  const label = typeof val === 'object' ? val.label : val;
                  const emoji = typeof val === 'object' ? val.emoji : '';
                  const desc  = typeof val === 'object' ? val.desc  : '';
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="text-base">{emoji}</span>
                        <span className="text-xs font-black text-slate-600 dark:text-slate-300">{label}</span>
                        {desc && <span className="text-[10px] text-slate-400">{desc}</span>}
                        <span className="mr-auto text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full">{items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {items.map(k => (
                          <div key={k.id}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-600 transition-all group">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-800 dark:text-white text-sm leading-snug">{k.question}</p>
                                <p className="text-slate-500 dark:text-slate-400 text-xs mt-1.5 leading-relaxed line-clamp-2">{k.answer}</p>
                                <div className="flex items-center gap-2 mt-2">
                                  {k.addedBy === 'ai' && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-semibold">✨ AI</span>
                                  )}
                                  {k.tags?.map(tag => (
                                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 font-semibold">{tag}</span>
                                  ))}
                                  {k.usageCount !== undefined && k.usageCount > 0 && (
                                    <span className="text-[10px] text-slate-400">שימוש: {k.usageCount}×</span>
                                  )}
                                </div>
                              </div>
                              {/* Action buttons — show on hover */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                  onClick={() => { setEditingK(k.id); setEditKQ(k.question); setEditKA(k.answer); }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!workspace?.id || deletingK === k.id) return;
                                    setDeletingK(k.id);
                                    try {
                                      await deleteKnowledgeEntry(workspace.id, k.id);
                                      setKnowledge(prev => prev.filter(x => x.id !== k.id));
                                    } finally { setDeletingK(null); }
                                  }}
                                  disabled={deletingK === k.id}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50">
                                  {deletingK === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════
       * TAB: ADVANCED SETTINGS
       * ══════════════════════════════════════════════════════════════════ */}
      {tab === 'settings' && (
        <div className="space-y-4" dir="rtl">
          {/* Settings sub-tabs */}
          <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
            style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${c.cardBorder}` }}>
            {([
              { id: 'advanced', label: 'הגדרות מתקדמות', icon: Settings },
              { id: 'email',    label: `חיבור מייל (${config.accounts.length})`, icon: Mail },
              { id: 'whatsapp', label: `WhatsApp${waCfg?.connected ? ' ✓' : ''}`, icon: MessageCircle },
            ] as const).map(st => (
              <button key={st.id} onClick={() => setSettingsSubTab(st.id)}
                className="flex-shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={settingsSubTab === st.id
                  ? { background: isDark ? 'rgba(99,102,241,0.25)' : 'white', color: '#6366f1',
                      boxShadow: isDark ? '0 0 12px rgba(99,102,241,0.2)' : '0 1px 6px rgba(0,0,0,0.1)',
                      border: '1px solid rgba(99,102,241,0.3)' }
                  : { color: c.textMuted, background: 'transparent', border: '1px solid transparent' }}>
                <st.icon size={12} />
                <span>{st.label}</span>
              </button>
            ))}
          </div>

          {settingsSubTab === 'advanced' && (<div className="space-y-4">

          {/* ── 1. אוטו-ריפליי ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-indigo-50 dark:from-indigo-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                <Zap size={13} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">תגובה אוטומטית</h3>
                <p className="text-[10px] text-slate-400">מתי ואיך הסוכן שולח תגובות</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Auto-send toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">שליחה אוטומטית מלאה</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">מיילים עם ביטחון גבוה ישלחו ללא אישור</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, autoSend: !p.autoSend }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.autoSend ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.autoSend ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Confidence threshold */}
              {config.autoSend && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">סף ביטחון לשליחה אוטומטית</label>
                    <span className="text-xs font-bold text-indigo-600">{config.confidenceThreshold ?? 90}%</span>
                  </div>
                  <input type="range" min={60} max={99} step={5}
                    value={config.confidenceThreshold ?? 90}
                    onChange={e => setConfig(p => ({ ...p, confidenceThreshold: +e.target.value }))}
                    className="w-full accent-indigo-600" />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                    <span>60% — שולח הרבה</span><span>99% — שולח רק ב-100% בטוח</span>
                  </div>
                </div>
              )}

              {/* Response time target */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">זמן תגובה יעד</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[{ v:5, l:'5 דקות' }, { v:15, l:'15 דקות' }, { v:60, l:'שעה' }, { v:240, l:'4 שעות' }].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setConfig(p => ({ ...p, targetResponseTime: v }))}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                        config.targetResponseTime === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Max emails per day */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מקסימום מיילים ביום</label>
                  <input type="number" min={1} max={500} value={config.maxEmailsPerDay ?? 50}
                    onChange={e => setConfig(p => ({ ...p, maxEmailsPerDay: +e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מקסימום follow-ups ללקוח</label>
                  <input type="number" min={0} max={10} value={config.maxFollowUps ?? 3}
                    onChange={e => setConfig(p => ({ ...p, maxFollowUps: +e.target.value }))}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
            </div>
          </div>

          {/* ── 2. תזמון שליחה ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-sky-50 dark:from-sky-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                <Clock size={13} className="text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">תזמון שליחה</h3>
                <p className="text-[10px] text-slate-400">שעות עבודה ויום שליחה</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Business hours toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">שלח רק בשעות עסקים</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">מיילים מחוץ לשעות העסקים יושהו לבוקר</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, sendOnlyBusinessHours: !p.sendOnlyBusinessHours }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.sendOnlyBusinessHours ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.sendOnlyBusinessHours ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {config.sendOnlyBusinessHours && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שעת התחלה</label>
                    <input type="time" value={config.businessHoursStart ?? '08:00'}
                      onChange={e => setConfig(p => ({ ...p, businessHoursStart: e.target.value }))}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שעת סיום</label>
                    <input type="time" value={config.businessHoursEnd ?? '18:00'}
                      onChange={e => setConfig(p => ({ ...p, businessHoursEnd: e.target.value }))}
                      className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  </div>
                </div>
              )}
              {/* Skip weekends */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">דלג על סופי שבוע</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">לא לשלוח בשישי-שבת</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, skipWeekends: !p.skipWeekends }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.skipWeekends ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.skipWeekends ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* ── 3. מיקוד מכירות ────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-emerald-50 dark:from-emerald-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <Target size={13} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">מיקוד מכירות</h3>
                <p className="text-[10px] text-slate-400">עדיפויות, ניקוד ופילטרים</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Lead scoring threshold */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">סף ניקוד ליד לטיפול</label>
                  <span className="text-xs font-bold text-emerald-600">{config.leadScoreThreshold ?? 60}/100</span>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={config.leadScoreThreshold ?? 60}
                  onChange={e => setConfig(p => ({ ...p, leadScoreThreshold: +e.target.value }))}
                  className="w-full accent-emerald-600" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>0 — כולם</span><span>100 — חמים בלבד</span>
                </div>
              </div>
              {/* Priority topics */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">נושאי עדיפות גבוהה (נענה ראשון)</label>
                <div className="flex flex-wrap gap-2">
                  {['הצעת מחיר', 'דמו', 'ניסיון', 'שותפות', 'הזמנה', 'תלונה', 'עניין גבוה'].map(t => {
                    const on = (config.priorityTopics ?? []).includes(t);
                    return (
                      <button key={t}
                        onClick={() => setConfig(p => ({ ...p, priorityTopics: on ? (p.priorityTopics ?? []).filter(x => x !== t) : [...(p.priorityTopics ?? []), t] }))}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all ${
                          on ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-emerald-400'
                        }`}>{t}</button>
                    );
                  })}
                </div>
              </div>
              {/* Competitor mentions */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מתחרים — דרך טיפול כשמוזכרים</label>
                <div className="flex gap-2">
                  {[
                    { v:'ignore',  l:'🙈 התעלם' },
                    { v:'compare', l:'⚖️ השווה לטובתנו' },
                    { v:'flag',    l:'🚩 סמן לסקירה' },
                  ].map(({ v, l }) => (
                    <button key={v}
                      onClick={() => setConfig(p => ({ ...p, competitorMentionAction: v as any }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        config.competitorMentionAction === v ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── 4. אבטחת מותג ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-red-50 dark:from-red-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <Shield size={13} className="text-red-500 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">אבטחת מותג</h3>
                <p className="text-[10px] text-slate-400">מה הסוכן לא יגיד לעולם</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מילים/נושאים אסורים</label>
                <textarea value={config.blacklistedWords}
                  onChange={e => setConfig(p => ({ ...p, blacklistedWords: e.target.value }))}
                  rows={2} placeholder="מחיר מינימום, מתחרה X, פיטורים, ..."
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-red-300" />
                <p className="text-[10px] text-slate-400 mt-1">הפרד בפסיקים</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">נושאים רגישים — הסוכן יעביר למנהל</label>
                <textarea value={config.sensitiveTopics ?? ''}
                  onChange={e => setConfig(p => ({ ...p, sensitiveTopics: e.target.value }))}
                  rows={2} placeholder="תביעות משפטיות, ביטולי עסקאות גדולות, ..."
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
              {/* Require approval for new leads */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">אשר ידנית תגובות ראשונות ללידים חדשים</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">מסר הראשון ללקוח חדש תמיד עובר דרכך</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, requireApprovalForNewLeads: !p.requireApprovalForNewLeads }))}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 mr-3 ${config.requireApprovalForNewLeads ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.requireApprovalForNewLeads ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* ── 5. ביצועים ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-amber-50 dark:from-amber-900/20 border-b border-slate-100 dark:border-slate-700">
              <div className="w-7 h-7 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <TrendingUp size={13} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">ביצועים ולמידה</h3>
                <p className="text-[10px] text-slate-400">כיוון הסוכן לתוצאות טובות יותר</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* A/B test */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">A/B בדיקת גישות</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">הסוכן מנסה גישות שונות ולומד מה עובד</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, abTestEnabled: !p.abTestEnabled }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.abTestEnabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.abTestEnabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {/* Learn from replies */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">למד מתגובות לקוחות</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">הסוכן מעדכן את בסיס הידע לפי תגובות בשדה</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, learnFromReplies: !p.learnFromReplies }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.learnFromReplies ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.learnFromReplies ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {/* Weekly summary */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">סיכום שבועי</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">קבל דוח שבועי על ביצועי הסוכן למייל</p>
                </div>
                <button onClick={() => setConfig(p => ({ ...p, weeklySummary: !p.weeklySummary }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.weeklySummary ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.weeklySummary ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Save */}
          <button onClick={handleSaveAgent} disabled={savingCfg}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            {savingCfg ? <><Loader2 size={14} className="animate-spin" /> שומר...</> : <><Check size={14} /> שמור הגדרות מתקדמות</>}
          </button>
          </div>)}

          {/* ── Email sub-tab ── */}
          {settingsSubTab === 'email' && (
            <div className="space-y-4">

          {/* ── SMTP detected — explain the difference ──────────────────── */}
          {smtpConnected && !oauthConnected && (
            <div className="rounded-2xl p-4 space-y-3"
              style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.1),rgba(217,119,6,0.07))', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
                  style={{ background: 'rgba(245,158,11,0.18)' }}>
                  ⚡
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>
                    זיהינו שחיברת מייל דרך דף אינטגרציות ✓
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }}>
                    <strong>{workspace?.emailConfig?.gmailUser}</strong> — מוגדר לשליחת הודעות מהמערכת
                  </p>
                </div>
              </div>
              <div className="rounded-xl p-3 space-y-2"
                style={{ background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.6)', border: `1px solid rgba(245,158,11,0.2)` }}>
                <p className="text-xs font-bold" style={{ color: isDark ? 'white' : '#1e293b' }}>
                  🔐 למה צריך לחבר שוב?
                </p>
                <div className="space-y-1.5 text-[11px]" style={{ color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)' }}>
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 flex-shrink-0">📤</span>
                    <span><strong>דף אינטגרציות (App Password)</strong> — שולח הודעות מהמערכת (הזמנות צוות, התראות)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-indigo-400 flex-shrink-0">📥</span>
                    <span><strong>סוכן מכירות (OAuth)</strong> — קורא את תיבת הדואר שלך, מזהה מיילים נכנסים וכותב תשובות AI</span>
                  </div>
                </div>
                <p className="text-[10px] mt-1" style={{ color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
                  ✅ לחץ "חבר חשבון" → בחר Gmail → הרשה גישה → הסוכן יוכל לקרוא מיילים נכנסים
                </p>
              </div>
            </div>
          )}

          {/* ── No email at all — guide to Integrations ─────────────────── */}
          {!smtpConnected && !oauthConnected && (
            <div className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <span className="text-xl">💡</span>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: isDark ? 'white' : '#1e293b' }}>
                  לא חיברת מייל עדיין
                </p>
                <p className="text-[11px]" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                  עבור לדף אינטגרציות ← חיבור אימייל כדי להגדיר App Password תחילה
                </p>
              </div>
              <button onClick={() => onNavigate?.('integrations')}
                className="px-3 py-2 rounded-xl text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                דף אינטגרציות →
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm flex-1" style={{ color: isDark ? 'rgba(255,255,255,0.5)' : '#64748b' }}>חבר כמה חשבונות שתרצה — Gmail, Outlook ועוד. הסוכן יבדוק את כולם.</p>
            <button onClick={() => { setAddClientId(workspace?.emailConfig?.oauthClientId || ''); setShowAddModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors flex-shrink-0">
              <Plus size={14} /> חבר חשבון
            </button>
          </div>

          {/* Account list */}
          {config.accounts.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center">
              <Mail size={36} className="mx-auto text-slate-300 mb-3" />
              <p className="font-semibold text-slate-500">אין חשבונות מחוברים</p>
              <p className="text-sm text-slate-400 mt-1 mb-4">חבר Gmail או Outlook כדי שהסוכן יתחיל לעבוד</p>
              <button onClick={() => { setAddClientId(workspace?.emailConfig?.oauthClientId || ''); setShowAddModal(true); }}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors">
                <Plus size={14} /> חבר חשבון ראשון
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {config.accounts.map(acc => {
                const meta    = PROVIDER_META[acc.provider];
                const isLive  = !!_liveTokens[acc.id] || (acc.provider === 'outlook' && !!getOutlookToken(acc.id));
                return (
                  <div key={acc.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 hover:border-indigo-200 transition-colors">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: `${meta.color}15` }}>
                      {meta.logo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-800 truncate">{acc.displayName || acc.email}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: `${meta.color}15`, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className={`flex items-center gap-1 text-xs font-medium ${isLive ? 'text-emerald-600' : 'text-amber-600'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-400'} animate-pulse`} />
                          {isLive ? 'פעיל' : 'פג תוקף — חבר שוב'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400 mt-0.5">{acc.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isLive && (
                        <button onClick={() => handleReconnect(acc)} disabled={connecting}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-200 transition-colors">
                          <Link size={11} /> חבר שוב
                        </button>
                      )}
                      <button onClick={() => handleDisconnect(acc.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 text-xs font-bold rounded-lg hover:bg-red-100 transition-colors">
                        <Unlink size={11} /> הסר
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* How it works */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
            <h4 className="font-bold text-slate-700 text-sm mb-3">📋 מה צריך להכין?</h4>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-bold text-red-600 mb-1.5">📧 Gmail</p>
                <ol className="text-slate-600 space-y-1 text-xs leading-relaxed">
                  <li>1. <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">Google Cloud Console</a></li>
                  <li>2. Enable Gmail API</li>
                  <li>3. Create OAuth 2.0 Client ID (Web)</li>
                  <li>4. Authorized JS Origins: כתובת האפליקציה</li>
                  <li>5. העתק <strong>Client ID</strong></li>
                </ol>
              </div>
              <div>
                <p className="font-bold text-blue-600 mb-1.5">📩 Outlook / Office 365</p>
                <ol className="text-slate-600 space-y-1 text-xs leading-relaxed">
                  <li>1. <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">Azure Portal</a> → App registrations</li>
                  <li>2. New registration → Multitenant + Personal</li>
                  <li>3. Redirect URI: SPA → כתובת האפליקציה</li>
                  <li>4. API permissions → Microsoft Graph: Mail.Read, Mail.Send, Mail.ReadWrite</li>
                  <li>5. העתק <strong>Application (client) ID</strong></li>
                </ol>
              </div>
            </div>
          </div>
            </div>
          )}

          {/* ── WhatsApp sub-tab ── */}
          {settingsSubTab === 'whatsapp' && (
            <div className="space-y-4">
          {/* Connection status bar */}
          <div className={`rounded-2xl p-4 flex items-center justify-between ${waCfg?.connected ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">💬</span>
              <div>
                <p className="font-bold text-sm text-slate-800">
                  {waCfg?.connected ? (waCfg.businessName || 'WhatsApp Business') : 'WhatsApp לא מחובר'}
                </p>
                <p className="text-xs text-slate-500">
                  {waCfg?.connected ? `${waConvs.length} שיחות פעילות` : 'חבר כדי לקבל ולשלוח הודעות WhatsApp'}
                </p>
              </div>
            </div>
            <button onClick={() => setShowWaSetup(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white text-sm font-bold rounded-xl hover:bg-[#20b954] transition-colors">
              <MessageCircle size={14} />
              {waCfg?.connected ? 'ערוך הגדרות' : 'חבר WhatsApp'}
            </button>
          </div>

          {/* Setup panel */}
          {showWaSetup && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <h3 className="font-black text-slate-800">הגדרות WhatsApp Business API</h3>

              {/* Step guide */}
              <div className="bg-[#25D366]/5 border border-[#25D366]/20 rounded-xl p-4 text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <p className="font-bold text-slate-700 mb-2">📋 הגדרה חד-פעמית:</p>
                <p>1. <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">developers.facebook.com</a> → My Apps → Create App → Business</p>
                <p>2. הוסף מוצר: <strong>WhatsApp</strong> → WhatsApp Business Platform</p>
                <p>3. העתק <strong>Phone Number ID</strong> ו-<strong>Temporary Access Token</strong> (או צור permanent)</p>
                <p>4. Webhooks → Configure → URL = <code className="bg-slate-100 px-1 rounded text-[10px]">https://us-central1-chex-crm.cloudfunctions.net/whatsappWebhook</code></p>
                <p>5. Verify token = הטוקן שתגדיר למטה → Subscribe: <strong>messages</strong></p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">שם העסק <span className="text-slate-400 font-normal">(לתצוגה בלבד)</span></label>
                  <input value={waDraft.businessName ?? ''} onChange={e => setWaDraft(p => ({ ...p, businessName: e.target.value }))}
                    placeholder="העסק שלי בע״מ"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number ID <span className="text-red-400">*</span></label>
                  <input value={waDraft.phoneNumberId ?? ''} onChange={e => setWaDraft(p => ({ ...p, phoneNumberId: e.target.value }))}
                    placeholder="1234567890123456"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Webhook Verify Token <span className="text-red-400">*</span></label>
                  <div className="flex gap-2">
                    <input value={waDraft.webhookToken ?? ''} onChange={e => setWaDraft(p => ({ ...p, webhookToken: e.target.value }))}
                      placeholder="any-secret-string"
                      className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <button onClick={() => { const t = Math.random().toString(36).slice(2,14); setWaDraft(p=>({...p,webhookToken:t})); navigator.clipboard.writeText(t); onToast?.('Token נוצר ועתק', 'info'); }}
                      className="px-3 py-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Access Token (Meta) <span className="text-red-400">*</span></label>
                  <input value={waDraft.accessToken ?? ''} onChange={e => setWaDraft(p => ({ ...p, accessToken: e.target.value }))}
                    type="password" placeholder="EAAxxxxx..."
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
                  <p className="text-xs text-slate-400 mt-1">⚠️ Token נשמר ב-Firestore. לאבטחה מרבית השתמש ב-System User Token שלא פג תוקף.</p>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-2">Webhook URL (העתק ל-Meta Developer Portal):</label>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    <code className="text-xs text-slate-700 flex-1 break-all">https://us-central1-chex-crm.cloudfunctions.net/whatsappWebhook</code>
                    <button onClick={() => { navigator.clipboard.writeText('https://us-central1-chex-crm.cloudfunctions.net/whatsappWebhook'); onToast?.('הועתק', 'info'); }}
                      className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors flex-shrink-0">
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={handleVerifyWa} disabled={waVerifying || !waDraft.phoneNumberId || !waDraft.accessToken}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-colors">
                  <CheckCircle size={14} /> {waVerifying ? 'בודק...' : 'אמת Token'}
                </button>
                <button onClick={handleSaveWa} disabled={waSavingCfg}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#25D366] text-white text-sm font-bold rounded-xl hover:bg-[#20b954] disabled:opacity-50 transition-colors">
                  <Check size={14} /> {waSavingCfg ? 'שומר...' : 'חבר ושמור'}
                </button>
                <button onClick={() => setShowWaSetup(false)} className="px-4 py-2.5 text-slate-500 text-sm rounded-xl hover:bg-slate-100">ביטול</button>
              </div>
            </div>
          )}

          {/* Conversations */}
          {waCfg?.connected && (
            <div className="flex flex-col sm:flex-row gap-4 sm:h-[520px]">
              {/* Conversation list */}
              <div className="w-full sm:w-72 flex-shrink-0 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col max-h-48 sm:max-h-none">
                <div className="p-3 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-700">שיחות</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {waConvs.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      <MessageCircle size={24} className="mx-auto mb-2 opacity-50" />
                      ממתין להודעות נכנסות...
                    </div>
                  ) : waConvs.map(conv => (
                    <button key={conv.phone} onClick={() => setSelPhone(conv.phone)}
                      className={`w-full text-right p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${selPhone === conv.phone ? 'bg-green-50 border-r-2 border-r-[#25D366]' : ''}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
                          <Phone size={14} className="text-[#25D366]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{conv.name}</p>
                          <p className="text-xs text-slate-400 truncate">{conv.lastMessage}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat window */}
              <div className="flex-1 min-h-64 sm:min-h-0 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                {!selPhone ? (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                    <div className="text-center">
                      <MessageCircle size={32} className="mx-auto mb-2 opacity-30" />
                      בחר שיחה משמאל
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Chat header */}
                    <div className="p-4 border-b border-slate-100 flex items-center gap-3 bg-[#25D366]/5">
                      <div className="w-9 h-9 rounded-full bg-[#25D366]/15 flex items-center justify-center">
                        <Phone size={14} className="text-[#25D366]" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{waConvs.find(c => c.phone === selPhone)?.name || selPhone}</p>
                        <p className="text-xs text-slate-400">{selPhone}</p>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#E5DDD5]/20">
                      {waMsgs.map(msg => (
                        <div key={msg.id} className={`flex ${msg.from === 'agent' ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${msg.from === 'agent' ? 'bg-white border border-slate-200 rounded-tr-sm' : 'bg-[#25D366] text-white rounded-tl-sm'}`}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                            <p className={`text-[10px] mt-1 ${msg.from === 'agent' ? 'text-slate-400' : 'text-white/70'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {/* AI draft suggestion for incoming messages */}
                            {msg.from === 'customer' && msg.aiDraft && msg.aiStatus === 'ready' && (
                              <div className="mt-2 pt-2 border-t border-slate-200">
                                <p className="text-[10px] font-bold text-indigo-600 mb-1 flex items-center gap-1">
                                  <Sparkles size={9} /> הצעת סוכן AI:
                                </p>
                                <p className="text-xs text-slate-600 leading-relaxed">{msg.aiDraft}</p>
                                {msg.uncertainties?.length ? (
                                  <p className="text-[10px] text-amber-600 mt-1">⚠️ {msg.uncertainties[0]}</p>
                                ) : null}
                                <button
                                  onClick={() => setWaReply(msg.aiDraft ?? '')}
                                  className="mt-1.5 text-[10px] font-bold text-indigo-600 hover:underline">
                                  ↓ העתק לתיבת שליחה
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Reply input */}
                    <div className="p-3 border-t border-slate-100 flex gap-2">
                      <textarea
                        value={waReply}
                        onChange={e => setWaReply(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleWaSend(waReply); } }}
                        rows={2} placeholder="כתוב תשובה... (Enter לשליחה)"
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                      <button onClick={() => handleWaSend(waReply)} disabled={waSending || !waReply.trim()}
                        className="px-4 py-2 bg-[#25D366] text-white rounded-xl hover:bg-[#20b954] disabled:opacity-50 transition-colors flex-shrink-0">
                        <Send size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
            </div>
          )}
        </div>
      )}

      {/* ══ WORKFLOWS TAB ════════════════════════════════════════════════════ */}
      {tab === 'workflows' && (
        <div className="space-y-4">
          {/* Workflows sub-tabs */}
          <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
            style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${c.cardBorder}` }}>
            {([
              { id: 'builder',    label: 'בונה אוטומציות', icon: GitBranch },
              { id: 'templates',  label: `תבניות (${templates.length})`, icon: Edit3 },
              { id: 'sequences',  label: `סדרות (${sequences.filter(s => s.status === 'active').length})`, icon: ArrowRight },
              { id: 'auto-reply', label: 'תגובה אוטומטית', icon: Zap },
              { id: 'scheduling', label: 'תזמון שליחה', icon: Clock },
            ] as const).map(st => (
              <button key={st.id} onClick={() => setWorkflowsSubTab(st.id)}
                className="flex-shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{
                  minWidth: '80px',
                  ...(workflowsSubTab === st.id
                    ? { background: isDark ? 'rgba(99,102,241,0.25)' : 'white', color: '#6366f1',
                        boxShadow: isDark ? '0 0 12px rgba(99,102,241,0.2)' : '0 1px 6px rgba(0,0,0,0.1)',
                        border: '1px solid rgba(99,102,241,0.3)' }
                    : { color: c.textMuted, background: 'transparent', border: '1px solid transparent' })
                }}>
                <st.icon size={12} />
                <span>{st.label}</span>
              </button>
            ))}
          </div>

          {/* Builder sub-tab */}
          {workflowsSubTab === 'builder' && (
            <div className="min-h-[400px]">
              {workflowsPanel ?? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <GitBranch size={36} style={{ color: c.textMuted, opacity: 0.3 }}/>
                  <p className="text-sm font-semibold" style={{ color: c.textMuted }}>בונה האוטומציות לא זמין</p>
                  <p className="text-xs" style={{ color: c.textMuted }}>נווט לדף "בונה האוטומציות" מהתפריט</p>
                </div>
              )}
            </div>
          )}

          {/* Templates sub-tab */}
          {workflowsSubTab === 'templates' && (
            <div className="space-y-4" dir="rtl">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-lg" style={{ color: c.text }}>תבניות מייל</h3>
            <button onClick={() => { setShowTemplateForm(true); setEditingTemplate(null); setNewTemplate({ category: 'first_contact' }); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              <Plus size={14}/> תבנית חדשה
            </button>
          </div>

          {showTemplateForm && (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: c.cardBg, border: '1px solid rgba(99,102,241,0.3)' }}>
              <h4 className="font-bold text-sm" style={{ color: c.text }}>{editingTemplate ? 'עריכת תבנית' : 'תבנית חדשה'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={newTemplate.name || ''} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))}
                  placeholder="שם התבנית"
                  className="rounded-xl px-3 py-2 text-sm border focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}/>
                <select value={newTemplate.category || 'first_contact'} onChange={e => setNewTemplate(p => ({ ...p, category: e.target.value as EmailTemplate['category'] }))}
                  className="rounded-xl px-3 py-2 text-sm border focus:outline-none"
                  style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}>
                  <option value="first_contact">פנייה ראשונה</option>
                  <option value="followup">מעקב</option>
                  <option value="proposal">הצעת מחיר</option>
                  <option value="after_meeting">אחרי פגישה</option>
                  <option value="objection">התנגדות</option>
                  <option value="closing">סגירה</option>
                </select>
              </div>
              <input value={newTemplate.subject || ''} onChange={e => setNewTemplate(p => ({ ...p, subject: e.target.value }))}
                placeholder="נושא — {{name}}, {{company}}"
                className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}/>
              <textarea value={newTemplate.body || ''} onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))}
                placeholder="גוף המייל — {{name}}, {{senderName}}, {{signature}}"
                rows={6} className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none resize-none"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}/>
              <div className="flex gap-2">
                <button onClick={handleSaveTemplate} disabled={templatesLoading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                  {templatesLoading ? 'שומר...' : editingTemplate ? 'עדכן' : 'שמור'}
                </button>
                <button onClick={() => { setShowTemplateForm(false); setEditingTemplate(null); }}
                  className="px-5 py-2.5 rounded-xl text-sm" style={{ color: c.textMuted }}>ביטול</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {(['first_contact','followup','proposal','after_meeting','objection','closing'] as EmailTemplate['category'][]).map(cat => {
              const catTemplates = templates.filter(t => t.category === cat);
              if (!catTemplates.length) return null;
              const catLabels: Record<string, { label: string; color: string; emoji: string }> = {
                first_contact: { label: 'פנייה ראשונה', color: '#10b981', emoji: '👋' },
                followup: { label: 'מעקב', color: '#f59e0b', emoji: '🔄' },
                proposal: { label: 'הצעת מחיר', color: '#6366f1', emoji: '📋' },
                after_meeting: { label: 'אחרי פגישה', color: '#3b82f6', emoji: '🤝' },
                objection: { label: 'התנגדות', color: '#ef4444', emoji: '🛡️' },
                closing: { label: 'סגירה', color: '#8b5cf6', emoji: '🎯' },
              };
              const meta = catLabels[cat];
              return (
                <div key={cat}>
                  <p className="text-xs font-black mb-2 flex items-center gap-1.5" style={{ color: meta.color }}>
                    <span>{meta.emoji}</span>{meta.label}
                  </p>
                  <div className="space-y-2">
                    {catTemplates.map(t => (
                      <div key={t.id} className="rounded-2xl p-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-bold text-sm truncate" style={{ color: c.text }}>{t.name}</p>
                              {t.isDefault && <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>ברירת מחדל</span>}
                            </div>
                            <p className="text-xs truncate" style={{ color: c.textMuted }}>{t.subject}</p>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setPreviewTemplate(previewTemplate?.id === t.id ? null : t)}
                              className="p-1.5 rounded-lg" style={{ color: c.textMuted }}><Search size={12}/></button>
                            <button onClick={() => { setEditingTemplate(t); setNewTemplate(t); setShowTemplateForm(true); }}
                              className="p-1.5 rounded-lg" style={{ color: c.textMuted }}><Edit3 size={12}/></button>
                            {!t.isDefault && <button onClick={async () => { await deleteTemplate(wid, t.id); setTemplates(await loadTemplates(wid)); onToast?.('נמחק', 'info'); }}
                              className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}><Trash2 size={12}/></button>}
                          </div>
                        </div>
                        {previewTemplate?.id === t.id && (
                          <div className="mt-3 rounded-xl p-3 text-xs whitespace-pre-wrap" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', color: c.textMuted, border: `1px solid ${c.cardBorder}` }}>
                            {t.body}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px]" style={{ color: c.textMuted }}>שימושים: {t.usageCount}</span>
                          <button onClick={async () => {
                              const recipientName = window.prompt('שם הנמען:') || '';
                              const recipientEmail = window.prompt('אימייל הנמען:') || '';
                              if (!recipientName || !recipientEmail) return;
                              onToast?.('מתאים אישית...', 'info');
                              const personalized = await personalizeEmail(t.body, recipientName, recipientEmail, config);
                              const fullText = `נושא: ${t.subject.replace(/\{\{name\}\}/g, recipientName)}\n\n${personalized.replace(/\{\{signature\}\}/g, config.signature || '')}`;
                              navigator.clipboard.writeText(fullText);
                              await updateTemplate(wid, t.id, { usageCount: (t.usageCount || 0) + 1 });
                              setTemplates(await loadTemplates(wid));
                              onToast?.('✨ מותאם אישית והועתק!', 'success');
                            }}
                            className="text-[10px] px-2.5 py-1 rounded-full font-bold"
                            style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                            ✨ התאם ושלח
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
            </div>
          )}

          {/* Sequences sub-tab */}
          {workflowsSubTab === 'sequences' && (
            <div className="space-y-4" dir="rtl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-lg" style={{ color: c.text }}>סדרות מעקב אוטומטיות</h3>
              <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>הסוכן שולח מיילים אוטומטיים בהפרשי ימים</p>
            </div>
            <button onClick={() => setShowSeqForm(v => !v)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              <Plus size={14}/> סדרה חדשה
            </button>
          </div>

          {showSeqForm && (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: c.cardBg, border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="font-bold text-sm" style={{ color: c.text }}>🤖 יצירת סדרה עם AI (4 מיילים)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={newSeqLead} onChange={e => setNewSeqLead(e.target.value)} placeholder="שם הליד"
                  className="rounded-xl px-3 py-2 text-sm border focus:outline-none"
                  style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}/>
                <input value={newSeqEmail} onChange={e => setNewSeqEmail(e.target.value)} placeholder="אימייל הליד"
                  className="rounded-xl px-3 py-2 text-sm border focus:outline-none"
                  style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text, direction: 'ltr' }}/>
              </div>
              <textarea value={newSeqContext} onChange={e => setNewSeqContext(e.target.value)}
                placeholder="הקשר: מה אתה מוכר? מה שוחח עם הליד? מה המטרה?"
                rows={3} className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none resize-none"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc', borderColor: c.cardBorder, color: c.text }}/>
              <div className="flex gap-2">
                <button onClick={handleGenerateSequence} disabled={generatingSeq || !newSeqLead || !newSeqEmail}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                  {generatingSeq
                    ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>יוצר סדרה...</span></>
                    : <><Sparkles size={14}/><span>צור סדרה עם AI</span></>}
                </button>
                <button onClick={() => setShowSeqForm(false)} className="px-5 py-2.5 rounded-xl text-sm" style={{ color: c.textMuted }}>ביטול</button>
              </div>
            </div>
          )}

          {sequences.length === 0 ? (
            <div className="text-center py-12 rounded-2xl" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
              <p className="text-5xl mb-3">📬</p>
              <p className="font-bold" style={{ color: c.text }}>אין סדרות פעילות</p>
              <p className="text-xs mt-1" style={{ color: c.textMuted }}>צור סדרת מעקב כדי לא לפספס שום ליד</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sequences.map(seq => {
                const statusColors: Record<string, string> = { active: '#10b981', paused: '#f59e0b', completed: '#6366f1', stopped: '#ef4444' };
                const statusLabels: Record<string, string> = { active: 'פעיל', paused: 'מושהה', completed: 'הושלם', stopped: 'הופסק' };
                const progress = seq.steps.length > 0 ? Math.round((seq.currentStep / seq.steps.length) * 100) : 0;
                return (
                  <div key={seq.id} className="rounded-2xl p-4 space-y-3" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full inline-block mb-1"
                          style={{ background: `${statusColors[seq.status]}22`, color: statusColors[seq.status] }}>
                          {statusLabels[seq.status]}
                        </span>
                        <p className="font-bold text-sm" style={{ color: c.text }}>{seq.name}</p>
                        <p className="text-xs" style={{ color: c.textMuted }}>{seq.leadEmail}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={async () => {
                            await updateSequence(wid, seq.id, { status: seq.status === 'active' ? 'paused' : 'active' });
                            setSequences(await loadSequences(wid));
                          }}
                          className="text-[11px] px-2.5 py-1 rounded-lg font-bold"
                          style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                          {seq.status === 'active' ? '⏸ השהה' : '▶ הפעל'}
                        </button>
                        <button onClick={async () => { await deleteSequence(wid, seq.id); setSequences(await loadSequences(wid)); onToast?.('נמחק', 'info'); }}
                          className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}>
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1" style={{ color: c.textMuted }}>
                        <span>שלב {seq.currentStep + 1}/{seq.steps.length}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0' }}>
                        <div className="h-full rounded-full" style={{ width: `${progress}%`, background: statusColors[seq.status] }}/>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {seq.steps.map((step, i) => (
                        <span key={i} className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{
                          background: step.sent ? '#10b98122' : i === seq.currentStep ? '#6366f122' : isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9',
                          color: step.sent ? '#10b981' : i === seq.currentStep ? '#6366f1' : c.textMuted,
                        }}>
                          {step.sent ? '✓' : i === seq.currentStep ? '→' : '·'} יום {step.dayOffset}
                        </span>
                      ))}
                    </div>
                    {seq.steps[seq.currentStep] && !seq.steps[seq.currentStep].sent && (
                      <div className="rounded-xl p-3 text-xs" style={{ background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}>
                        <p className="font-bold mb-1" style={{ color: '#6366f1' }}>📧 הבא לשליחה — יום {seq.steps[seq.currentStep].dayOffset}</p>
                        <p className="truncate" style={{ color: c.text }}>{seq.steps[seq.currentStep].subject}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
            </div>
          )}

          {/* Auto-reply sub-tab */}
          {workflowsSubTab === 'auto-reply' && (
            <div className="space-y-4" dir="rtl">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-indigo-50 dark:from-indigo-900/20 border-b border-slate-100 dark:border-slate-700">
                  <div className="w-7 h-7 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <Zap size={13} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 dark:text-white">תגובה אוטומטית</h3>
                    <p className="text-[10px] text-slate-400">מתי ואיך הסוכן שולח תגובות</p>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* Auto-send toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">שליחה אוטומטית מלאה</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">מיילים עם ביטחון גבוה ישלחו ללא אישור</p>
                    </div>
                    <button onClick={() => setConfig(p => ({ ...p, autoSend: !p.autoSend }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${config.autoSend ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.autoSend ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {/* Confidence threshold */}
                  {config.autoSend && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">סף ביטחון לשליחה אוטומטית</label>
                        <span className="text-xs font-bold text-indigo-600">{config.confidenceThreshold ?? 90}%</span>
                      </div>
                      <input type="range" min={60} max={99} step={5}
                        value={config.confidenceThreshold ?? 90}
                        onChange={e => setConfig(p => ({ ...p, confidenceThreshold: +e.target.value }))}
                        className="w-full accent-indigo-600" />
                      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                        <span>60% — שולח הרבה</span><span>99% — שולח רק ב-100% בטוח</span>
                      </div>
                    </div>
                  )}

                  {/* Response time target */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">זמן תגובה יעד</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[{ v:5, l:'5 דקות' }, { v:15, l:'15 דקות' }, { v:60, l:'שעה' }, { v:240, l:'4 שעות' }].map(({ v, l }) => (
                        <button key={v}
                          onClick={() => setConfig(p => ({ ...p, targetResponseTime: v }))}
                          className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                            config.targetResponseTime === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}>{l}</button>
                      ))}
                    </div>
                  </div>

                  {/* Max emails per day */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מקסימום מיילים ביום</label>
                      <input type="number" min={1} max={500} value={config.maxEmailsPerDay ?? 50}
                        onChange={e => setConfig(p => ({ ...p, maxEmailsPerDay: +e.target.value }))}
                        className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">מקסימום follow-ups ללקוח</label>
                      <input type="number" min={0} max={10} value={config.maxFollowUps ?? 3}
                        onChange={e => setConfig(p => ({ ...p, maxFollowUps: +e.target.value }))}
                        className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={handleSaveAgent} disabled={savingCfg}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {savingCfg ? <><Loader2 size={14} className="animate-spin" /> שומר...</> : <><Check size={14} /> שמור</>}
              </button>
            </div>
          )}

          {/* Scheduling sub-tab */}
          {workflowsSubTab === 'scheduling' && (
            <div className="space-y-4" dir="rtl">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 py-3.5 bg-gradient-to-l from-sky-50 dark:from-sky-900/20 border-b border-slate-100 dark:border-slate-700">
                  <div className="w-7 h-7 rounded-xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                    <Clock size={13} className="text-sky-600 dark:text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 dark:text-white">תזמון שליחה</h3>
                    <p className="text-[10px] text-slate-400">שעות עבודה ויום שליחה</p>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* Business hours toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">שלח רק בשעות עסקים</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">מיילים מחוץ לשעות העסקים יושהו לבוקר</p>
                    </div>
                    <button onClick={() => setConfig(p => ({ ...p, sendOnlyBusinessHours: !p.sendOnlyBusinessHours }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${config.sendOnlyBusinessHours ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.sendOnlyBusinessHours ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {config.sendOnlyBusinessHours && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שעת התחלה</label>
                        <input type="time" value={config.businessHoursStart ?? '08:00'}
                          onChange={e => setConfig(p => ({ ...p, businessHoursStart: e.target.value }))}
                          className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">שעת סיום</label>
                        <input type="time" value={config.businessHoursEnd ?? '18:00'}
                          onChange={e => setConfig(p => ({ ...p, businessHoursEnd: e.target.value }))}
                          className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                      </div>
                    </div>
                  )}
                  {/* Skip weekends */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">דלג על סופי שבוע</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">לא לשלוח בשישי-שבת</p>
                    </div>
                    <button onClick={() => setConfig(p => ({ ...p, skipWeekends: !p.skipWeekends }))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${config.skipWeekends ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.skipWeekends ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>
              </div>
              <button onClick={handleSaveAgent} disabled={savingCfg}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {savingCfg ? <><Loader2 size={14} className="animate-spin" /> שומר...</> : <><Check size={14} /> שמור</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ADD ACCOUNT MODAL ────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]" dir="rtl">

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
              <div>
                <h3 className="font-black text-slate-900 text-xl">חיבור מייל לסוכן AI</h3>
                <p className="text-xs text-slate-500 mt-0.5">מאפשר לסוכן לקרוא מיילים נכנסים ולהגיב עליהם</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-6 pb-2 space-y-4">

              {/* Provider selector */}
              <div className="grid grid-cols-2 gap-3">
                {(['gmail', 'outlook'] as EmailProvider[]).map(p => {
                  const meta = PROVIDER_META[p];
                  return (
                    <button key={p} onClick={() => setAddProvider(p)}
                      className={`p-4 rounded-2xl border-2 text-center transition-all ${addProvider === p ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="text-2xl mb-1">{meta.logo}</div>
                      <div className="font-bold text-sm text-slate-800">{meta.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{p === 'gmail' ? 'Google Workspace / Gmail' : 'Outlook / Microsoft 365'}</div>
                    </button>
                  );
                })}
              </div>

              {/* What you'll get banner */}
              <div className="rounded-2xl p-3 flex items-start gap-3"
                style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.07),rgba(139,92,246,0.05))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <span className="text-xl flex-shrink-0">🤖</span>
                <div>
                  <p className="text-xs font-bold text-slate-800 mb-1">מה הסוכן יוכל לעשות אחרי החיבור?</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[10px] text-slate-600">
                    {['📥 קריאת מיילים נכנסים', '✍️ כתיבת תשובות חכמות', '📤 שליחה לאחר אישורך'].map(t => (
                      <div key={t} className="bg-white rounded-lg px-2 py-1 text-center border border-slate-100">{t}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step-by-step guide — only show for Outlook (Gmail uses built-in client) */}
              {addProvider === 'outlook' && <div className="rounded-2xl overflow-hidden border border-slate-200">
                <button type="button" onClick={() => setShowGuideExpanded(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                  <span className="text-[11px] text-slate-500">{showGuideExpanded ? 'הסתר מדריך' : 'הצג מדריך הגדרה'}</span>
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>📋</span>
                    מדריך Azure Portal (5 דקות)
                    {showGuideExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                  </span>
                </button>

                {showGuideExpanded && (
                  <div className="p-4 space-y-3 bg-slate-50/50">
                    {addProvider === 'gmail' ? (
                      <div className="space-y-2.5">
                        {[
                          {
                            n: 1, icon: '🌐',
                            title: 'פתח את Google Cloud Console',
                            body: <span>כנס ל-<a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-semibold">console.cloud.google.com</a> ← ודא שאתה מחובר לחשבון Google הנכון</span>,
                          },
                          {
                            n: 2, icon: '📁',
                            title: 'צור או בחר פרויקט',
                            body: <span>בתפריט העליון לחץ על שם הפרויקט ← <strong>"New Project"</strong> ← תן שם (לדוגמה: "RAY CRM") ← <strong>Create</strong></span>,
                          },
                          {
                            n: 3, icon: '✅',
                            title: 'הפעל את Gmail API',
                            body: <span>מתפריט הצד: <strong>APIs & Services → Library</strong> ← חפש <strong>"Gmail API"</strong> ← לחץ עליו ← <strong>Enable</strong></span>,
                          },
                          {
                            n: 4, icon: '🛡️',
                            title: 'הגדר מסך הסכמה (OAuth consent screen)',
                            body: <span><strong>APIs & Services → OAuth consent screen</strong> ← בחר <strong>Internal</strong> אם המייל שלך שייך ל-Google Workspace של הארגון.<br/>
                              <span className="text-[10px] text-emerald-600 mt-1 block">
                                חשוב: Internal חוסך אישור אבטחה של Google לקריאת מיילים. אם תבחר External תיתקע בבדיקה יקרה.
                              </span>
                            </span>,
                          },
                          {
                            n: 5, icon: '🔑',
                            title: 'צור OAuth Client ID',
                            body: <span><strong>APIs & Services → Credentials</strong> ← <strong>"+ Create Credentials"</strong> ← בחר <strong>"OAuth client ID"</strong> ← Application type: <strong>"Web application"</strong></span>,
                          },
                          {
                            n: 6, icon: '🔗',
                            title: 'הוסף Authorized JS Origins',
                            body: <span>תחת "Authorized JavaScript origins" לחץ <strong>+ Add URI</strong> והוסף את <strong>כולן</strong> (אחרת החיבור יעבוד בכתובת אחת ויישבר באחרת):<br/>
                              {oauthOriginsForDisplay().map(o => (
                                <code key={o} className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-mono mt-1 ml-1 inline-block">{o}</code>
                              ))}
                            </span>,
                          },
                          {
                            n: 7, icon: '📋',
                            title: 'העתק את ה-Client ID',
                            body: <span>לחץ <strong>Create</strong> ← תראה חלון עם Client ID ← לחץ על סמל ההעתקה ← הדבק בשדה למטה<br/>
                              <span className="text-[10px] text-slate-400 mt-1 block">הפורמט: <code className="font-mono">123456789-xxxxx.apps.googleusercontent.com</code></span>
                            </span>,
                          },
                        ].map(step => (
                          <div key={step.n} className="flex gap-3 bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center">{step.n}</div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 mb-0.5">{step.icon} {step.title}</p>
                              <p className="text-[11px] text-slate-600 leading-relaxed">{step.body}</p>
                            </div>
                          </div>
                        ))}
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 leading-relaxed">
                          <strong>⚠️ לא רואה "App passwords"?</strong> בדוק שאימות דו-שלבי (2-Step Verification) מופעל בחשבון ← <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" className="underline">myaccount.google.com/security</a>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {[
                          {
                            n: 1, icon: '🌐',
                            title: 'פתח Azure App Registrations',
                            body: <span>כנס ל-<a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-semibold">portal.azure.com</a> ← "App registrations" ← <strong>+ New registration</strong></span>,
                          },
                          {
                            n: 2, icon: '📝',
                            title: 'הגדר את האפליקציה',
                            body: <span>שם: "RAY CRM" ← Supported account types: <strong>"Accounts in any organizational directory and personal Microsoft accounts"</strong> (Multitenant + Personal)</span>,
                          },
                          {
                            n: 3, icon: '🔗',
                            title: 'הוסף Redirect URI',
                            body: <span>Platform: <strong>Single-page application (SPA)</strong> ← Redirect URI:<br/>
                              <code className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-mono mt-1 inline-block">{window.location.origin}</code>
                            </span>,
                          },
                          {
                            n: 4, icon: '🔑',
                            title: 'הוסף הרשאות Mail',
                            body: <span><strong>API permissions → + Add a permission → Microsoft Graph → Delegated</strong> ← הוסף: <strong>Mail.Read, Mail.Send, Mail.ReadWrite</strong></span>,
                          },
                          {
                            n: 5, icon: '📋',
                            title: 'העתק Application (client) ID',
                            body: <span>עמוד "Overview" ← העתק את ה-<strong>Application (client) ID</strong> ← הדבק בשדה למטה<br/>
                              <span className="text-[10px] text-slate-400 mt-1 block">הפורמט: <code className="font-mono">xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code></span>
                            </span>,
                          },
                        ].map(step => (
                          <div key={step.n} className="flex gap-3 bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-black flex items-center justify-center">{step.n}</div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 mb-0.5">{step.icon} {step.title}</p>
                              <p className="text-[11px] text-slate-600 leading-relaxed">{step.body}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>}

              {/* Gmail: built-in ready notice */}
              {addProvider === 'gmail' && (
                <div className="rounded-2xl p-4 flex items-start gap-3"
                  style={{ background: 'linear-gradient(135deg,rgba(34,197,94,0.08),rgba(16,185,129,0.05))', border: '1px solid rgba(34,197,94,0.25)' }}>
                  <span className="text-xl flex-shrink-0">✅</span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">מוכן לחיבור!</p>
                    <p className="text-xs text-slate-600 mt-0.5">RAY CRM מוגדר מראש עם Gmail API. לחץ "חבר Gmail" ותעבור ישירות להתחברות עם חשבון Google שלך.</p>
                  </div>
                </div>
              )}

              {/* Client ID input — Outlook only */}
              {addProvider === 'outlook' && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-slate-700">
                    🔑 Azure Application (client) ID
                  </label>
                  <input value={addClientId} onChange={e => setAddClientId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition-all"
                    style={{ direction: 'ltr' }} />
                </div>
              )}

              {addProvider === 'outlook' && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-slate-700">Tenant ID <span className="text-slate-400 font-normal text-xs">(השאר "common" לחשבון אישי/Hotmail)</span></label>
                  <input value={addTenantId} onChange={e => setAddTenantId(e.target.value)}
                    placeholder="common"
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
                    style={{ direction: 'ltr' }} />
                </div>
              )}

            </div>

            {/* Footer actions */}
            <div className="px-6 py-4 flex gap-3 flex-shrink-0 border-t border-slate-100">
              <button onClick={handleConnect}
                disabled={connecting || (addProvider === 'outlook' && !addClientId.trim())}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 text-white font-bold rounded-2xl disabled:opacity-50 transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: connecting ? '#a5b4fc' : 'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow: '0 4px 15px rgba(99,102,241,0.35)' }}>
                {connecting
                  ? <><div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"/><span>מתחבר...</span></>
                  : <><Link size={15}/><span>חבר {PROVIDER_META[addProvider].label}</span></>
                }
              </button>
              <button onClick={() => setShowAddModal(false)}
                className="px-5 py-3.5 text-slate-500 rounded-2xl hover:bg-slate-100 transition-colors text-sm font-semibold">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── EnhancedDraftCard ─────────────────────────────────────────────────── */
interface EnhancedDraftCardProps {
  draft: EmailDraft;
  expanded: boolean; editing: boolean; editText: string; sending: boolean;
  isDark: boolean;
  c: ReturnType<typeof useTheme>['c'];
  onToggleExpand: () => void; onStartEdit: () => void; onCancelEdit: () => void;
  onEditText: (t: string) => void; onSend: () => void; onReject: () => void;
}

function EnhancedDraftCard({
  draft, expanded, editing, editText, sending, isDark, c,
  onToggleExpand, onStartEdit, onCancelEdit, onEditText, onSend, onReject,
}: EnhancedDraftCardProps) {
  const meta = PROVIDER_META[draft.provider ?? 'gmail'];
  const conf = draft.confidence ?? 0;
  const confColor = conf >= 80 ? '#10b981' : conf >= 60 ? '#f59e0b' : '#ef4444';
  const confBg = conf >= 80 ? 'rgba(16,185,129,0.1)' : conf >= 60 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
  const confBorder = conf >= 80 ? 'rgba(16,185,129,0.25)' : conf >= 60 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)';

  const statusMap = {
    pending:  { label: 'ממתין לאישור', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
    sent:     { label: '✓ נשלח', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
    rejected: { label: 'נדחה', color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.15)' },
    approved: { label: '✓ אושר', color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
  };
  const statusInfo = statusMap[draft.status as keyof typeof statusMap] ?? statusMap.pending;

  return (
    <div className="rounded-2xl overflow-hidden transition-all"
      style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'white',
        border: `1px solid ${draft.status === 'pending' ? 'rgba(245,158,11,0.3)' : c.cardBorder}`,
        boxShadow: draft.status === 'pending' ? '0 2px 20px rgba(245,158,11,0.08)' : 'none' }}>
      {/* Card header */}
      <div className="p-4 flex items-start gap-3 cursor-pointer" onClick={onToggleExpand}>
        {/* Provider icon */}
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: `${meta.color}15`, border: `1px solid ${meta.color}25` }}>
          {meta.logo}
        </div>
        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-bold text-sm" style={{ color: c.textPrimary }}>{draft.fromName || draft.fromEmail}</p>
            {/* Provider badge */}
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${meta.color}15`, color: meta.color }}>{meta.label}</span>
            {/* Status badge */}
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: statusInfo.bg, border: `1px solid ${statusInfo.border}`, color: statusInfo.color }}>
              {statusInfo.label}
            </span>
          </div>
          <p className="text-[11px] mb-1" style={{ color: c.textMuted }}>{draft.fromEmail}</p>
          <p className="text-sm font-medium truncate" style={{ color: c.textSecondary }}>📨 {draft.subject}</p>
        </div>
        {/* Confidence + expand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Confidence pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
            style={{ background: confBg, border: `1px solid ${confBorder}` }}>
            <Brain size={10} style={{ color: confColor }} />
            <span className="text-[11px] font-black" style={{ color: confColor }}>{conf}%</span>
          </div>
          {expanded ? <ChevronUp size={15} style={{ color: c.textMuted }} /> : <ChevronDown size={15} style={{ color: c.textMuted }} />}
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-0.5 mx-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${conf}%`, background: `linear-gradient(90deg,${confColor},${confColor}88)` }} />
      </div>

      {/* Uncertainties */}
      {draft.uncertainties?.length > 0 && draft.status === 'pending' && (
        <div className="mx-4 mt-3 p-3 rounded-xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-[11px] font-bold mb-1 flex items-center gap-1" style={{ color: '#f59e0b' }}>
            <HelpCircle size={11} /> שאלות לא ברורות לסוכן:
          </p>
          {draft.uncertainties.map((q, i) => (
            <p key={i} className="text-[11px]" style={{ color: c.textSecondary }}>• {q}</p>
          ))}
          <p className="text-[10px] mt-1.5" style={{ color: c.textMuted }}>
            💡 הוסף תשובות ל<button onClick={e => { e.stopPropagation(); }} className="underline" style={{ color: '#818cf8' }}>בסיס הידע</button> כדי לשפר את הסוכן
          </p>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3">
          {/* Original email */}
          <div>
            <p className="text-[11px] font-bold mb-2 flex items-center gap-1.5" style={{ color: c.textMuted }}>
              <MessageSquare size={11} /> מייל מקורי
            </p>
            <div className="rounded-xl p-3 text-[12px] leading-relaxed max-h-28 overflow-y-auto whitespace-pre-wrap"
              style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}>
              {draft.originalText || '(ריק)'}
            </div>
          </div>

          {/* AI draft */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: c.textMuted }}>
                <Sparkles size={11} style={{ color: '#818cf8' }} />
                <span style={{ color: '#818cf8' }}>תשובת הסוכן AI</span>
              </p>
              {draft.status === 'pending' && !editing && (
                <button onClick={e => { e.stopPropagation(); onStartEdit(); }}
                  className="flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: '#6366f1' }}>
                  <Edit3 size={10} /> ערוך
                </button>
              )}
            </div>
            {editing ? (
              <textarea value={editText} onChange={e => onEditText(e.target.value)} rows={8}
                className="w-full rounded-xl p-3 text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ background: isDark ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.03)',
                  border: '1px solid rgba(99,102,241,0.3)', color: c.textPrimary }} />
            ) : (
              <div className="rounded-xl p-3 text-[12px] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap"
                style={{ background: isDark ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.03)',
                  border: '1px solid rgba(99,102,241,0.2)', color: c.textSecondary }}>
                {draft.aiDraft}
              </div>
            )}
          </div>

          {/* Action buttons */}
          {draft.status === 'pending' && (
            <div className="flex items-center gap-2 pt-1">
              <button onClick={e => { e.stopPropagation(); onSend(); }} disabled={sending}
                className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all hover:scale-[1.02] shadow-md"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow: '0 4px 12px rgba(79,70,229,0.3)' }}>
                {sending
                  ? <><Loader2 size={13} className="animate-spin" /> שולח...</>
                  : editing
                    ? <><Send size={13} /> שמור ושלח</>
                    : <><ThumbsUp size={13} /> אשר ושלח</>}
              </button>
              {editing && (
                <button onClick={e => { e.stopPropagation(); onCancelEdit(); }}
                  className="px-3 py-2.5 text-sm rounded-xl transition-all"
                  style={{ color: c.textMuted, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
                  ביטול
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); onReject(); }}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold rounded-xl transition-all"
                style={{ color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <XCircle size={12} /> דחה
              </button>
              {/* Learning note */}
              {draft.status === 'pending' && (
                <p className="text-[10px] mr-auto flex items-center gap-1" style={{ color: c.textMuted }}>
                  <Brain size={9} /> הסוכן ילמד מהבחירה שלך
                </p>
              )}
            </div>
          )}

          {/* Sent state */}
          {draft.status === 'sent' && (
            <div className="flex items-center gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <CheckCheck size={14} style={{ color: '#10b981' }} />
              <p className="text-sm font-semibold" style={{ color: '#10b981' }}>נשלח בהצלחה — הסוכן למד מהתשובה ✓</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── DraftCard ──────────────────────────────────────────────────────────── */
interface DraftCardProps {
  draft: EmailDraft;
  expanded: boolean; editing: boolean; editText: string; sending: boolean;
  onToggleExpand: () => void; onStartEdit: () => void; onCancelEdit: () => void;
  onEditText: (t: string) => void; onSend: () => void; onReject: () => void;
}

function DraftCard({ draft, expanded, editing, editText, sending, onToggleExpand, onStartEdit, onCancelEdit, onEditText, onSend, onReject }: DraftCardProps) {
  const meta = PROVIDER_META[draft.provider ?? 'gmail'];
  const confColor = draft.confidence >= 80 ? 'text-emerald-600' : draft.confidence >= 60 ? 'text-amber-600' : 'text-red-500';
  const statusBg  = { pending: 'border-amber-200 bg-amber-50', sent: 'border-blue-200 bg-blue-50', rejected: 'border-slate-200 bg-slate-50', approved: 'border-emerald-200 bg-emerald-50' }[draft.status];

  return (
    <div className={`border rounded-2xl overflow-hidden transition-all ${statusBg}`}>
      <div className="p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-base flex-shrink-0">{meta.logo}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-800 text-sm">{draft.fromName || draft.fromEmail}</p>
            <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: `${meta.color}15`, color: meta.color }}>{meta.label}</span>
            <span className={`text-xs font-bold ${confColor}`}>{draft.confidence}%</span>
            {draft.status === 'pending' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">ממתין</span>}
            {draft.status === 'sent'    && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">נשלח ✓</span>}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{draft.fromEmail}</p>
          <p className="text-sm font-medium text-slate-700 mt-1 truncate">📨 {draft.subject}</p>
        </div>
        <button onClick={onToggleExpand} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {draft.uncertainties?.length > 0 && draft.status === 'pending' && (
        <div className="mx-4 mb-3 p-3 bg-white rounded-xl border border-amber-200">
          <p className="text-xs font-bold text-amber-700 mb-1 flex items-center gap-1"><HelpCircle size={11} /> שאלות לסוכן — ענה בבסיס הידע:</p>
          {draft.uncertainties.map((q, i) => <p key={i} className="text-xs text-amber-800">• {q}</p>)}
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <p className="text-xs font-bold text-slate-400 mb-1.5 flex items-center gap-1"><MessageSquare size={10} /> מייל מקורי</p>
            <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-600 leading-relaxed max-h-28 overflow-y-auto whitespace-pre-wrap">{draft.originalText || '(ריק)'}</div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-bold text-slate-400 flex items-center gap-1"><Sparkles size={10} /> תשובת הסוכן</p>
              {draft.status === 'pending' && !editing && (
                <button onClick={onStartEdit} className="text-xs text-indigo-600 flex items-center gap-1 hover:underline"><Edit3 size={10} /> ערוך</button>
              )}
            </div>
            {editing
              ? <textarea value={editText} onChange={e => onEditText(e.target.value)} rows={7}
                  className="w-full border border-indigo-300 rounded-xl p-3 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              : <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-700 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">{draft.aiDraft}</div>
            }
          </div>
          {draft.status === 'pending' && (
            <div className="flex items-center gap-2">
              <button onClick={onSend} disabled={sending}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                <Send size={12} /> {sending ? 'שולח...' : editing ? 'שמור ושלח' : 'אשר ושלח'}
              </button>
              {editing && <button onClick={onCancelEdit} className="px-3 py-2 text-slate-500 text-xs rounded-xl hover:bg-slate-100">ביטול</button>}
              <button onClick={onReject} className="flex items-center gap-1.5 px-3 py-2 text-red-500 text-xs font-semibold rounded-xl hover:bg-red-50 transition-colors">
                <XCircle size={12} /> דחה
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
