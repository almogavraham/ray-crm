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
  aiScore: number;
  notes: Note[];
  tasks: Task[];
  futureNotes: string[];
  waitingContent: boolean;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'מנהל' | 'סוכן';
  isCurrentUser?: boolean;
};

export type Page = 'home' | 'dashboard' | 'overview' | 'team' | 'ai' | 'kanban' | 'tasks' | 'settings' | 'content' | 'campaigns' | 'deals';

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
export type PaymentStatus = 'paid' | 'pending' | 'overdue';

export type PaymentRecord = {
  id: string;
  month: string;       // YYYY-MM
  amount: number;
  status: PaymentStatus;
  paidAt?: string;
};

export type AccountData = {
  leadId: string;
  contractStart: string;   // YYYY-MM-DD
  contractEnd: string;     // YYYY-MM-DD
  monthlyRetainer: number;
  payments: PaymentRecord[];
  upsellNote: string;
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

export type AppSettings = {
  userName: string;
  userInitials: string;
  companyName: string;
  compactMode: boolean;
  showOverduePopup: boolean;
  defaultPage: Page;
  accentColor: 'indigo' | 'blue' | 'emerald' | 'rose' | 'violet';
};
