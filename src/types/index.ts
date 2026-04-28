export type LeadStatus =
  | 'חדש'
  | 'הקמת כספת בבנק'
  | 'הטמעה'
  | 'לקוח פעיל'
  | 'רימרקטינג'
  | 'לא רלוונטי';

export type LeadSource = 'cheX' | 'ci3' | 'סורקים';

export type Bank =
  | 'פועלים'
  | 'לאומי'
  | 'מזרחי'
  | 'דיסקונט'
  | 'מרכנתיל'
  | 'בינלאומי';

export type Solution = {
  name: string;
  hasInstallation: boolean;
  hasTraining: boolean;
};

export type Task = {
  id: string;
  description: string;
  date: string;
  time: string;
  completed: boolean;
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
  banks: Bank[];
  checkCount: number;
  solutions: Solution[];
  assignedTo: string;
  source: LeadSource;
  lastUpdate: string;
  aiScore: number;
  notes: Note[];
  tasks: Task[];
  futureNotes: string[];
  waitingG3: boolean;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'מנהל' | 'סוכן';
  isCurrentUser?: boolean;
};

export type Page = 'dashboard' | 'overview' | 'team' | 'ai' | 'kanban';
