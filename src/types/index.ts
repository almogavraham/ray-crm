// LeadStatus is now an open string type — supports custom statuses defined in statusConfig.ts.
// The legacy values ('חדש' | 'בתהליך' | 'לקוח פעיל' | 'רימרקטינג' | 'לא רלוונטי') remain fully valid.
export type LeadStatus = string;

export type LeadSource =
  | 'אורגני'
  | 'פרסום ממומן'
  | 'הפניה'
  | 'אינסטגרם'
  | 'פייסבוק'
  | 'גוגל';

export type Solution = {
  name: string;
  inProgress: boolean;
  delivered: boolean;
  price?: number;       // monthly / one-time price in ILS
  priceType?: 'monthly' | 'one_time';  // default: monthly
};

export type TaskPriority = 'high' | 'medium' | 'low';
export type KanbanStatus = 'todo' | 'inprogress' | 'waiting' | 'done' | 'cancelled';
// Activity type of a task — drives icons, filtering and reporting (like Salesforce/HubSpot).
export type TaskType = 'call' | 'email' | 'whatsapp' | 'meeting' | 'followup' | 'proposal' | 'other';

export type Task = {
  id: string;
  description: string;
  notes?: string;
  date: string;
  time: string;
  completed: boolean;
  priority?: TaskPriority;
  completedAt?: string;
  assignedTo?: string;
  assignedBy?: string;
  kanbanStatus?: KanbanStatus;
  type?: TaskType;
};

export type StandaloneTask = {
  id: string;
  description: string;
  notes?: string;
  date: string;
  time: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  assignedTo: string;
  assignedBy: string;
  leadId?: string;
  createdAt: string;
  kanbanStatus?: KanbanStatus;
  type?: TaskType;
};

export type Note = {
  id: string;
  text: string;
  author: string;
  timestamp: string;
};

/** A single configurable field that appears on every lead card */
export type CustomFieldDef = {
  id: string;        // unique key, e.g. "accounting_software"
  label: string;     // displayed title, e.g. "תוכנת הנהלת חשבונות"
  options: string[]; // selectable chips, e.g. ["חשבשבת", "פריוריטי", "זאפ"]
  multiSelect?: boolean; // allow picking more than one option
};

export type Lead = {
  id: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  status: LeadStatus;
  budget: number;
  solutions: Solution[];
  assignedTo: string;
  source: LeadSource;
  lastUpdate: string;
  createdAt?: number;   // Unix timestamp — set on creation
  aiScore: number;
  notes: Note[];
  tasks: Task[];
  futureNotes: string[];
  waitingContent: boolean;
  activityLog?: LeadActivity[];       // chronological activity log
  meetings?: LeadMeeting[];           // scheduled meetings
  objection?: string;                 // objection type when "לא רלוונטי"
  contactMethod?: ContactMethod;      // how last contact was made
  lastContactDate?: string;           // ISO - when last contacted
  nextFollowUpDate?: string;          // ISO - scheduled next follow-up
  followUpNote?: string;              // note for next follow-up
  customFields?: Record<string, string | string[]>; // values for workspace custom fields
  isHot?: boolean;                    // manually marked "hot" by the user (shows a 🔥 badge)
  // ── Automation-driven fields ──────────────────────────────────────────────
  flagColor?: string;                 // hex colour stripe set manually or by an automation
  flagReason?: string;                // why it was flagged (shown on hover)
  noAnswerCount?: number;             // how many logged contact attempts went unanswered
  lastNoAnswerAt?: string;            // ISO of the most recent unanswered attempt
  // ── Campaign attribution ──────────────────────────────────────────────────
  // Captured from the page the lead submitted on. `source` alone answers
  // "Facebook"; these answer WHICH campaign — the difference between a guess
  // and a real ROI number.
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPage?: string;
  referrer?: string;
  /** Set when the lead arrived through an embedded form. */
  formId?: string;
  formName?: string;
};

export type TeamMember = {
  id: string;
  uid?: string;         // Firebase Auth UID — present for workspace users
  name: string;
  email: string;
  role: 'מנהל' | 'סוכן';
  isCurrentUser?: boolean;
};

export type Page = 'home' | 'dashboard' | 'overview' | 'analytics' | 'team' | 'ai' | 'kanban' | 'tasks' | 'settings' | 'content' | 'deals' | 'agents' | 'workflows' | 'admin' | 'billing' | 'integrations' | 'ai-studio' | 'email-agent' | 'marketing-agent' | 'opportunities';

/**
 * Every page in the product. Written as a Record so that adding a value to
 * `Page` without listing it here fails the build — the alternative, a plain
 * array, silently omits new pages from the super-admin menu and the omission
 * is only ever noticed by a person who cannot find a screen.
 */
const PAGE_REGISTRY: Record<Page, true> = {
  home: true, dashboard: true, overview: true, analytics: true, team: true,
  ai: true, kanban: true, tasks: true, settings: true, content: true,
  deals: true, agents: true, workflows: true, admin: true, billing: true,
  integrations: true, 'ai-studio': true, 'email-agent': true,
  'marketing-agent': true, opportunities: true,
};

export const ALL_PAGES = Object.keys(PAGE_REGISTRY) as Page[];

/* ── Email Agent types ──────────────────────────────────────────────────────── */
export type EmailProvider = 'gmail' | 'outlook';

export interface EmailAccount {
  id: string;            // unique per account (email address)
  provider: EmailProvider;
  email: string;
  displayName?: string;
  clientId: string;      // Google Client ID  OR  Azure App (client) ID
  tenantId?: string;     // Outlook only: Azure tenant / 'common'
  connectedAt: number;
  // Persisted token so the user stays connected across page refreshes
  cachedToken?: string;
  cachedTokenExpiry?: number;
}

export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  category: 'pricing' | 'product' | 'support' | 'meeting' | 'objection' | 'competitor' | 'general';
  addedBy: 'user' | 'ai';
  tags?: string[];
  usageCount?: number;   // how many times the agent used this entry
  createdAt: number;
  updatedAt?: number;
}

export interface EmailDraft {
  id: string;
  accountId: string;     // which connected account received this
  provider: EmailProvider;
  threadId: string;
  messageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  originalText: string;
  aiDraft: string;
  confidence: number;
  uncertainties: string[];
  status: 'pending' | 'approved' | 'sent' | 'rejected';
  leadId?: string;
  createdAt: number;
  leadScore?: number;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'urgent';
  opportunities?: string[];
  attachmentSummary?: string;
}

export interface EmailAgentConfig {
  // ── Core ──────────────────────────────────────────────────────────────────
  enabled:              boolean;
  accounts:             EmailAccount[];

  // ── Identity ──────────────────────────────────────────────────────────────
  agentName:            string;
  agentRole:            string;            // e.g. "מנהל מכירות", "נציג שירות"
  signature:            string;
  language:             'he' | 'en' | 'auto';

  // ── Context & Instructions ─────────────────────────────────────────────────
  businessDescription:  string;            // synced from workspace.prompt
  agentInstructions:    string;            // personal system-prompt
  agentPersonality:     string;            // legacy one-liner style
  salesGoals:           string[];          // ['מכירה','ליד חם','פגישה','הצעת מחיר',…]
  /**
   * Monthly revenue target, in shekels. 0 or undefined means no target set.
   *
   * Distinct from salesGoals, which say what the agent should aim for in a
   * conversation. This is the number the month is measured against, and it is
   * what makes progress reportable rather than just activity.
   */
  monthlySalesTarget?:  number;

  // ── Reply behavior ─────────────────────────────────────────────────────────
  autoSend:             boolean;           // legacy — keep for compat
  requireApproval:      boolean;
  confidenceThreshold:  number;            // 0-100 % for auto-send
  replyTone:            'friendly' | 'professional' | 'formal' | 'assertive';

  // ── Email style ────────────────────────────────────────────────────────────
  emailLength:          'short' | 'medium' | 'long';
  useEmoji:             boolean;
  closingStyle:         'soft' | 'direct' | 'question';
  ctaInEmail:           'call' | 'meeting' | 'demo' | 'reply' | 'link';

  // ── Schedule & limits ──────────────────────────────────────────────────────
  maxDailyEmails:       number;
  followUpDays:         number;            // auto follow-up after N days
  workingHoursStart:    string;            // '08:00'
  workingHoursEnd:      string;            // '18:00'

  // ── Brand safety ──────────────────────────────────────────────────────────
  blacklistedWords:     string;
  sensitiveTopics?:     string;

  // ── Advanced auto-reply ───────────────────────────────────────────────────
  maxEmailsPerDay?:         number;
  maxFollowUps?:            number;
  targetResponseTime?:      number;        // minutes
  sendOnlyBusinessHours?:   boolean;
  businessHoursStart?:      string;        // 'HH:mm'
  businessHoursEnd?:        string;        // 'HH:mm'
  skipWeekends?:            boolean;

  // ── Sales focus ───────────────────────────────────────────────────────────
  leadScoreThreshold?:      number;        // 0-100
  priorityTopics?:          string[];
  competitorMentionAction?: 'ignore' | 'compare' | 'flag';
  requireApprovalForNewLeads?: boolean;

  // ── Learning & performance ────────────────────────────────────────────────
  abTestEnabled?:           boolean;
  learnFromReplies?:        boolean;
  weeklySummary?:           boolean;

  // ── Legacy ────────────────────────────────────────────────────────────────
  lastCheckedAt?:       number;
  gmailConnected?:      boolean;
  gmailEmail?:          string;
  clientId?:            string;
}

/* ── Email Templates ──────────────────────────────────────────────────────── */
export interface EmailTemplate {
  id: string;
  name: string;
  category: 'first_contact' | 'followup' | 'proposal' | 'after_meeting' | 'objection' | 'closing';
  subject: string;
  body: string;
  isDefault?: boolean;
  usageCount: number;
  createdAt: number;
}

/* ── Email Sequences ──────────────────────────────────────────────────────── */
export interface SequenceStep {
  dayOffset: number;
  subject: string;
  body: string;
  sent: boolean;
  sentAt?: number;
}

export interface EmailSequence {
  id: string;
  name: string;
  leadEmail: string;
  leadName: string;
  accountId: string;
  steps: SequenceStep[];
  currentStep: number;
  status: 'active' | 'paused' | 'completed' | 'stopped';
  createdAt: number;
  nextSendAt: number;
}

/* ── Lead Intelligence ────────────────────────────────────────────────────── */
export interface LeadScore {
  email: string;
  name: string;
  score: number;
  tier: 'hot' | 'warm' | 'cold';
  signals: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  lastEmailSubject: string;
  lastUpdated: number;
}

export interface EmailOpportunity {
  id: string;
  draftId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  signal: string;
  suggestedAction: string;
  detectedAt: number;
  dismissed: boolean;
}

/* ── Email Analytics ──────────────────────────────────────────────────────── */
export interface DailyEmailStat {
  date: string;
  sent: number;
  received: number;
  replied: number;
}

export interface EmailAnalytics {
  totalSent: number;
  totalReceived: number;
  totalReplied: number;
  avgResponseTimeHours: number;
  responseRate: number;
  topSenders: { email: string; name: string; count: number }[];
  dailyStats: DailyEmailStat[];
  lastCalculated: number;
}

export type CampaignPlatform = 'meta' | 'google' | 'tiktok' | 'linkedin' | 'other';
export type CampaignStatus   = 'active' | 'paused' | 'ended' | 'draft';
export type CampaignObjective = 'awareness' | 'leads' | 'sales' | 'engagement';

export type Campaign = {
  id: string;
  name: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  objective: CampaignObjective;
  budget: number;       // monthly budget ILS
  spent: number;        // actual spend ILS
  leads: number;        // leads generated
  conversions: number;  // leads → clients
  revenue: number;      // revenue generated ILS
  startDate: string;    // YYYY-MM-DD
  endDate?: string;
  notes?: string;
  createdAt: string;
};

// ─── Account Management ──────────────────────────────────────────────────────
export type PaymentStatus = 'paid' | 'pending' | 'overdue' | 'cancelled';
export type PaymentType   = 'retainer' | 'one_time' | 'bonus';

export type PaymentRecord = {
  id: string;
  date: string;            // YYYY-MM-DD
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  invoiceNumber?: string;
  notes?: string;
  paidAt?: string;
  month?: string;          // legacy field — kept for backward compat
};

export type SolutionStatus = 'not_started' | 'in_progress' | 'delivered' | 'approved';

export type ManagedSolution = {
  id: string;
  name: string;
  description?: string;
  status: SolutionStatus;
  dueDate?: string;
  assignedTo?: string;
  notes?: string;
  createdAt: string;
};

export type ActivityType = 'note' | 'call' | 'meeting' | 'email' | 'whatsapp';

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  text: string;
  author: string;
  timestamp: string;
};

export type LeadActivityType =
  | 'call' | 'email' | 'whatsapp' | 'meeting' | 'task'
  | 'note' | 'status_change' | 'objection' | 'in_person';

export type LeadActivity = {
  id: string;
  type: LeadActivityType;
  content: string;
  author: string;
  timestamp: string;          // ISO string
  metadata?: Record<string, string>;  // extra info: objection type, meeting title, etc.
};

export type LeadMeeting = {
  id: string;
  title: string;
  date: string;               // YYYY-MM-DD
  time: string;               // HH:mm
  duration: number;           // minutes: 30 | 60 | 90 | 120
  location?: string;
  notes?: string;
  attendeeEmail?: string;
  calendarLink?: string;      // generated Google Calendar URL
  createdAt: string;
  createdBy: string;
};

export type ContactMethod = 'phone' | 'email' | 'whatsapp' | 'in_person' | 'meeting' | 'quote' | 'no_answer' | 'custom';

export type MediaPlatform = 'meta' | 'google' | 'tiktok' | 'linkedin' | 'email' | 'other';

export type MediaRecord = {
  id: string;
  month: string;          // YYYY-MM
  platform: MediaPlatform;
  spend: number;
  impressions?: number;
  clicks?: number;
  leads: number;
  conversions: number;
  notes?: string;
};

export type ClientGoal = {
  id: string;
  month: string;          // YYYY-MM
  leadsTarget: number;
  revenueTarget: number;
  spendBudget: number;
};

export type ClientLink = {
  id: string;
  title: string;
  url: string;
};

export type FileCategory = 'renders' | 'documents' | 'contracts' | 'creative' | 'references' | 'other';
export type FileKind     = 'image' | 'video' | 'pdf' | 'doc' | 'link' | 'other';

export type ClientFile = {
  id: string;
  title: string;
  category: FileCategory;
  kind: FileKind;
  url: string;               // download URL or external link
  storagePath?: string;      // Firebase Storage path (if uploaded)
  size?: number;             // bytes
  aiContext?: string;        // text excerpt / description the AI can read
  notes?: string;
  createdAt: string;
  uploadedBy: string;
};

export type AccountData = {
  leadId: string;
  contractStart: string;   // keep for backward compat
  contractEnd: string;     // keep for backward compat
  monthlyRetainer: number; // keep for backward compat
  projects: Project[];
  updatedAt: string;
  /* Written by the account card; read by the assistant for context. They were
     missing here, so the assistant's reads were typed as always-empty and its
     "client materials" answers were dead code. */
  files?: ClientFile[];
  proposals?: Proposal[];
};

export type DealStage = 'new' | 'proposal' | 'negotiation' | 'won' | 'lost';

export type ProposalItem = {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
};

export type Proposal = {
  id: string;
  title: string;
  clientName: string;
  clientEmail?: string;
  items: ProposalItem[];
  discount?: number;
  validUntil?: string;
  notes?: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected';
  createdAt: string;
  templateId?: string;
  logoUrl?: string;
};

export type Deal = {
  id: string;
  company: string;
  clientName: string;
  leadId?: string;
  stage: DealStage;
  value: number;
  probability: number;
  assignedTo: string;
  expectedCloseDate: string;
  proposals: Proposal[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
};

export type ProjectStatus   = 'planning' | 'active' | 'review' | 'completed' | 'paused';
export type ProjectPriority = 'high' | 'medium' | 'low';

export type ProjectTask = {
  id: string;
  title: string;
  completed: boolean;
  assignedTo?: string;
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
  notes?: string;
};

export type Project = {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  color?: string;
  startDate?: string;
  dueDate?: string;
  monthlyRetainer?: number;
  contractStart?: string;
  contractEnd?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  // Management data (each project has its own)
  tasks: ProjectTask[];
  notes?: string;
  solutions: ManagedSolution[];
  payments: PaymentRecord[];
  activityLog: ActivityEntry[];
  mediaRecords: MediaRecord[];
  goals: ClientGoal[];
  links: ClientLink[];
  files: ClientFile[];
  proposals: Proposal[];
  upsellNote: string;
  nextStep?: string;
  satisfactionScore?: number;
};

export type AppSettings = {
  userName: string;
  userInitials: string;
  companyName: string;
  compactMode: boolean;
  showOverduePopup: boolean;
  defaultPage: Page;
  accentColor: 'indigo' | 'blue' | 'emerald' | 'rose' | 'violet';
  theme?: 'dark' | 'light';
  objectionTypes?: string[];          // custom objection types, defaults to 4 standard ones
};

// ─── Auth & Permissions ──────────────────────────────────────────────────────
export type UserProfile = {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'agent';
  allowedPages: Page[];
  createdAt: string;
  workspaceId?: string;   // link to workspace tenant
};

export type Invite = {
  token: string;
  email: string;
  role: 'admin' | 'agent';
  allowedPages: Page[];
  createdAt: string;
  used: boolean;
  createdBy: string;
  workspaceId?: string;   // which workspace this invite belongs to
};

// ─── Token System ────────────────────────────────────────────────────────────
export type TokenTopupPackage = {
  id:      string;   // 'topup5' | 'topup10' | 'topup25'
  dollars: number;   // 5 | 10 | 25
  label:   string;   // '$5' | '$10' | '$25'
  bonus?:  number;   // optional bonus % (e.g. 10 = 10% extra)
};

export type TokenHistoryEntry = {
  id:          string;
  type:        'plan' | 'topup' | 'usage' | 'manual';
  amount:      number;   // positive = credit, negative = debit (USD)
  model?:      string;   // claude model used (for usage entries)
  description: string;
  timestamp:   string;   // ISO
};

// ─── Meta Integration ────────────────────────────────────────────────────────
export type MetaAdAccount = {
  id:              string;   // numeric ID without "act_" prefix
  name:            string;
  currency:        string;   // e.g. "ILS", "USD"
  hasPaymentMethod: boolean;
  status:          string;   // "ACTIVE" | "UNSETTLED" | etc.
};

export type MetaPage = {
  id: string;
  name: string;
  category: string;
  fanCount: number;
  accessToken: string;   // page-level token (sensitive, stored server-side)
  subscribed: boolean;   // whether leadgen webhook is active
  leadCount: number;
  instagramBusinessAccountId?: string | null;  // linked Instagram Business Account ID
};

export type MetaIntegration = {
  connected: boolean;
  pages: MetaPage[];
  userAccessToken?: string;     // user-level long-lived token
  adAccountId?: string;         // @deprecated — use adAccounts array instead
  adAccounts?: MetaAdAccount[];  // fetched during OAuth
  connectedAt: string;   // ISO
  updatedAt: string;     // ISO
  expiresAt: string;     // ISO — when user token expires (~60 days)
  hasPostingPermission?: boolean;  // true when pages_manage_posts + instagram_content_publish granted
};

// ─── White Label / Multi-tenant ─────────────────────────────────────────────
export type WorkspacePlan   = 'trial' | 'basic' | 'pro' | 'enterprise';
export type WorkspaceStatus = 'pending' | 'trial' | 'active' | 'suspended';

export type WorkspaceProfile = {
  id: string;                    // Firestore doc ID  (= workspaceId)
  slug?: string;                 // clean URL slug — e.g. "x7k2m9p" → ray-crm-app.web.app/x7k2m9p
  name: string;                  // שם העסק
  businessId: string;            // ח.פ
  phone: string;
  email: string;                 // owner email
  ownerId: string;               // Firebase Auth UID
  logoUrl?: string;              // base64 or storage URL
  prompt?: string;               // AI context — describe the business
  aiInstructions?: string;       // Custom AI instructions — how the user wants RAY to behave
  industry?: string;             // סוג עסק
  teamSize?: string;
  isBusiness?: boolean;          // האם זה עסק (B2B/B2C מוצרים/שירותים)
  businessSolutions?: string[];  // רשימת שירותים/מוצרים — מוצגת בלידים
  status: WorkspaceStatus;
  plan: WorkspacePlan;
  trialEndsAt?: string;          // ISO date — end of 14-day trial
  createdAt: string;
  onboardingComplete: boolean;
  leadsSetupDone?: boolean;      // AI lead-card setup wizard completed
  cardLeftField?: {              // AI-chosen left-panel field for the lead card
    key: string;
    label: string;
    prefix?: string;
    quickOptions?: number[];
  };
  solutionsLabel?: string;       // custom label for the solutions/services right panel
  statusSectionLabel?: string;   // custom label for the status row in the lead card
  sourceLabel?: string;          // custom label for the source row in the lead card
  leadSources?: string[];        // custom source list (overrides the hardcoded LEAD_SOURCES)
  customFieldDefs?: CustomFieldDef[]; // workspace-level custom field definitions
  memberCount?: number;          // denormalized counter
  allowedPages?: Page[];         // override: which pages this workspace can see (null = use plan defaults)
  // ── Webhook / Lead Integrations ────────────────────────────────────────────
  webhookSecret?: string;              // random secret for the incoming leads webhook
  webhookDefaultSource?: string;       // LeadSource to assign when no source in payload
  webhookDefaultAssignedTo?: string;   // team member name/id to auto-assign webhook leads
  // ── Meta / Facebook integration ───────────────────────────────────────────
  metaAppId?: string;                  // Facebook App ID (public — safe in frontend)
  metaAppSecret?: string;              // Facebook App Secret (sensitive — write-only display)
  metaIntegration?: MetaIntegration;   // live connection state
  // ── Google Ads integration ────────────────────────────────────────────────
  googleAdsWebhookKey?: string;         // optional secret key sent by Google in body.google_key
  // ── Token balance ──────────────────────────────────────────────────────────
  tokenBalance?: number;         // USD remaining (e.g. 8.42)
  tokenUsed?: number;            // USD consumed total (cumulative)
  tokenPlanAllocation?: number;  // USD granted by current plan
  // System message — shown as a top banner to all workspace users
  systemMessage?: string;
  /**
   * Optional split of the pipeline into two screens: "לידים" for everything
   * still being qualified, and "הזדמנויות מכירה" for what is actively being
   * sold. Off by default — plenty of businesses want one list, and forcing the
   * split on them adds a screen without adding meaning.
   *
   * Implemented as a STATUS PARTITION rather than a separate record type: the
   * same lead moves between screens by changing status, so nothing has to be
   * converted, duplicated, or kept in sync.
   */
  pipelineSplit?: {
    enabled: boolean;
    /** Statuses that belong to the opportunities screen. */
    opportunityStatuses: string[];
  };
  // Email config — multiple provider support
  emailConfig?: {
    provider?: 'gmail' | 'outlook' | 'emailjs'; // active email provider
    // Gmail / Outlook (server-side via Cloud Function + Nodemailer)
    gmailUser?: string;             // Gmail/Outlook address used for sending
    fromName?: string;              // Display name (e.g. "Almog Agency")
    gmailAppPasswordSet?: boolean;  // true = App Password is saved server-side
    emailProvider?: 'gmail' | 'outlook'; // smtp variant for Cloud Function
    // EmailJS (browser-side JS approach)
    emailServiceId?: string;
    emailTemplateId?: string;       // general emails template
    emailInviteTmpl?: string;       // invite emails template
    emailPublicKey?: string;
    // Google OAuth client id — required for INBOX READ access (App Password can
    // only send). Used by the email agent and the copilot's in-chat connect.
    oauthClientId?: string;
    oauthProvider?: 'gmail' | 'outlook';
  };
  // AI Profile — configures the AI assistant for this workspace
  aiProfile?: {
    idealClient?: string;        // לקוח אידיאלי — מי הקהל היעד
    painPoints?: string;         // בעיות שהעסק פותר
    salesProcess?: string;       // תהליך מכירה טיפוסי
    avgDealSize?: string;        // ממוצע עסקה
    commonObjections?: string;   // התנגדויות נפוצות
    uniqueValue?: string;        // מה מייחד את העסק
    tone?: string;               // טון תקשורת: פורמלי / ידידותי / מקצועי
  };
  stripePaymentLink?: string;       // Stripe payment link URL
  metaAdAccountId?: string;          // Meta Ads ad account ID (act_XXXXX format)
  campaignAgencyFeePercent?: number; // Agency fee % added on top of ad spend (e.g. 20)
  cardLayout?: CardLayoutSettings;   // lead card / kanban card customization
};

// ─── Card Layout Customization ───────────────────────────────────────────────
export interface CardSectionItem {
  id: string;
  visible: boolean;
}

export interface CardLayoutSettings {
  sections: CardSectionItem[];           // order + visibility
  statusColors: Record<string, string>;  // status label → hex color
  highlightFields: string[];             // max 3 field keys to show prominently
  viewMode: 'full' | 'compact';
  columnLayout: '1col' | '2col';
  kanbanFields: string[];                // which fields to show in KanbanCard
  dashboardFields: string[];             // which columns to show in Dashboard table
}

export const DEFAULT_CARD_SECTIONS: CardSectionItem[] = [
  { id: 'prices',       visible: true },
  { id: 'status',       visible: true },
  { id: 'source',       visible: true },
  { id: 'assignee',     visible: true },
  { id: 'customFields', visible: true },
  { id: 'stats',        visible: true },
];

export const DEFAULT_CARD_LAYOUT: CardLayoutSettings = {
  sections: DEFAULT_CARD_SECTIONS,
  statusColors: {},
  highlightFields: ['budget', 'status', 'source'],
  viewMode: 'full',
  columnLayout: '2col',
  kanbanFields: ['aiScore', 'budget', 'source', 'solutions', 'tasks', 'conversion', 'temperature', 'nextTask', 'assignedTo'],
  dashboardFields: ['company', 'contactName', 'status', 'budget', 'source', 'lastUpdate', 'aiScore'],
};

export type PlatformCampaign = {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  objective: 'leads' | 'awareness' | 'sales' | 'traffic';
  location: string;
  ageMin: number;
  ageMax: number;
  gender: 'all' | 'male' | 'female';
  interests: string[];
  headline: string;
  primaryText: string;
  description?: string;
  ctaButton: string;
  imageUrl?: string;
  dailyBudget: number;    // ILS per day
  duration: number;       // days
  agencyFeePercent: number;
  status: 'draft' | 'pending_payment' | 'active' | 'paused' | 'ended' | 'failed';
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  metaCampaignId?: string;
  createdAt: string;
  paidAt?: string;
};
