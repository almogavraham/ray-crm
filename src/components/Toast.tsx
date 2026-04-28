import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export default function Toast({ toasts, onRemove }: ToastProps) {
  return (
    <div className="fixed bottom-5 left-5 z-[100] flex flex-col gap-2" dir="rtl">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(toast.id), 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const styles = {
    success: { bg: 'bg-green-600', icon: <CheckCircle2 size={16} className="text-white flex-shrink-0" /> },
    error: { bg: 'bg-red-600', icon: <AlertCircle size={16} className="text-white flex-shrink-0" /> },
    info: { bg: 'bg-indigo-600', icon: <Info size={16} className="text-white flex-shrink-0" /> },
  }[toast.type];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg transition-all duration-300 ${styles.bg} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <button onClick={() => onRemove(toast.id)} className="text-white/70 hover:text-white ml-1">
        <X size={14} />
      </button>
      <span>{toast.message}</span>
      {styles.icon}
    </div>
  );
}
