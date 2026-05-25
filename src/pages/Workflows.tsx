import { Network } from 'lucide-react';
import { WorkflowBuilder } from './Agents';
import type { Lead, StandaloneTask } from '../types';

interface WorkflowsProps {
  leads: Lead[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onCreateTask: (task: StandaloneTask) => void;
  onUpdateLead: (lead: Lead) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  workspaceId?: string;
}

export default function Workflows({
  leads, currentUser, onCreateTask, onUpdateLead, onToast, workspaceId,
}: WorkflowsProps) {
  return (
    <div className="space-y-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
          <Network size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">בונה אוטומציות</h1>
          <p className="text-xs text-slate-500 mt-0.5">צור אוטומציות חכמות עם AI — WhatsApp, מייל, משימות ועוד</p>
        </div>
      </div>

      {/* WorkflowBuilder */}
      <WorkflowBuilder
        leads={leads}
        currentUser={currentUser}
        onCreateTask={onCreateTask}
        onUpdateLead={onUpdateLead}
        onToast={onToast}
        workspaceId={workspaceId}
      />
    </div>
  );
}
