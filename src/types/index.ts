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

export type Page = 'dashboard' | 'overview' | 'team' | 'ai' | 'kanban' | 'tasks' | 'settings' | 'content';

export type AppSettings = {
  userName: string;
  userInitials: string;
  companyName: string;
  compactMode: boolean;
  showOverduePopup: boolean;
  defaultPage: Page;
  accentColor: 'indigo' | 'blue' | 'emerald' | 'rose' | 'violet';
};
