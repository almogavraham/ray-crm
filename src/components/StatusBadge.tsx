import type { LeadStatus } from '../types';
import { STATUS_CONFIG } from '../data/mockData';
import { useLang } from '../contexts/LangContext';

interface StatusBadgeProps {
  status: LeadStatus;
  size?: 'sm' | 'md';
}

const FALLBACK = { color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };

const STATUS_KEY_MAP: Record<string, string> = {
  'חדש':        'status.new',
  'בתהליך':    'status.inProgress',
  'לקוח פעיל': 'status.activeClient',
  'רימרקטינג': 'status.remarketing',
  'לא רלוונטי': 'status.notRelevant',
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const { t } = useLang();
  const config = STATUS_CONFIG[status] ?? FALLBACK;
  const label = STATUS_KEY_MAP[status] ? t(STATUS_KEY_MAP[status]) : (status || '—');
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.color} ${
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {label}
    </span>
  );
}
