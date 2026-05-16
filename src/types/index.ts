export type LeadStatus =
  | 'חדש'
  | 'בתהליך'
  | 'לקוח פעיל'
  | 'רימרקטינג'
  | 'לא רלוונטי';

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
};

export type TaskPriority = 'high' | 'medium' | 'low';

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
};

export type Note = {
  id: string;
  text: string;
  author: string;
  timestamp: string;
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
};

export type TeamMember = {
  id: string;
  uid?: string;         // Firebase Auth UID — present for workspace users
  name: string;
  email: string;
  role: 'מנהל' | 'סוכן';
  isCurrentUser?: boolean;
};

export type Page = 'home' | 'dashboard' | 'overview' | 'team' | 'ai' | 'kanban' | 'tasks' | 'settings' | 'content' | 'deals' | 'agents' | 'admin';

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
  memberCount?: number;          // denormalized counter
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
};
