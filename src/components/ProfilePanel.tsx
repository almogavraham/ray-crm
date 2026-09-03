/**
 * ProfilePanel — who you are and which workspace you are in, in one place.
 *
 * The avatar in the header carried the user's initials and `cursor-default`:
 * it looked like the account control every other product puts there, and did
 * nothing. Meanwhile the two things it should lead to were split apart — the
 * workspace lives in Settings, and there was no user profile view at all.
 *
 * This is the account panel that button should always have opened. It shows
 * both, because from the user's side "my profile" and "my workspace" are one
 * question — which account am I working in — and answering half of it means
 * they go looking for the rest.
 *
 * Deliberately read-only apart from the links out. Editing here would be a
 * third place that writes the same fields as Settings, and three writers for
 * one record is how they drift.
 */

import { useEffect } from 'react';
import { X, Building2, User, Mail, Shield, CreditCard, Settings as SettingsIcon, LogOut, Gem } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { formatTokenDisplay } from '../lib/tokenTracker';
import type { WorkspaceProfile } from '../types';

const PLAN_LABEL: Record<string, string> = {
  trial:      'ניסיון',
  basic:      'Basic',
  pro:        'Pro',
  enterprise: 'Enterprise',
};

export default function ProfilePanel({
  userName, userEmail, userInitials, isAdmin, workspace,
  onClose, onGoSettings, onGoBilling, onSignOut,
}: {
  userName: string;
  userEmail?: string;
  userInitials: string;
  isAdmin?: boolean;
  workspace?: WorkspaceProfile;
  onClose: () => void;
  onGoSettings: () => void;
  onGoBilling: () => void;
  onSignOut?: () => void;
}) {
  const { c } = useTheme();

  // Escape closes it. A panel opened from a header button is dismissed by
  // reflex, and without this the only way out is finding the small ×.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const plan = String(workspace?.plan ?? '');
  const balance = workspace?.tokenBalance ?? 0;

  const Row = ({ icon: Icon, label, value }: {
    icon: typeof User; label: string; value: React.ReactNode;
  }) => (
    <div className="flex items-start gap-2.5 py-2">
      <Icon size={14} className="flex-shrink-0 mt-0.5" style={{ color: c.textMuted }} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px]" style={{ color: c.textMuted }}>{label}</p>
        <p className="text-[13.5px] font-semibold break-words" style={{ color: c.textPrimary }}>{value}</p>
      </div>
    </div>
  );

  const action =
    'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:p-8"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      dir="rtl"
    >
      <div
        // Stops a click inside the card from reaching the backdrop and closing
        // the panel the user is trying to read.
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl mt-10"
        style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ background: c.cardBgAlt, borderBottom: `1px solid ${c.cardBorder}` }}>
          <button onClick={onClose} aria-label="סגור" className="p-1 rounded-lg"
            style={{ color: c.textMuted }}>
            <X size={17} />
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-black text-[15px]" style={{ color: c.textPrimary }}>{userName}</p>
              <p className="text-[11px]" style={{ color: c.textMuted }}>
                {isAdmin ? 'מנהל מערכת' : 'משתמש'}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #3b82f6)' }}>
              {userInitials}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* User */}
          <section>
            <p className="text-[11px] font-black tracking-widest mb-1" style={{ color: c.textMuted }}>
              פרופיל משתמש
            </p>
            <div style={{ borderTop: `1px solid ${c.cardBorder}` }}>
              <Row icon={User}  label="שם" value={userName} />
              {userEmail && <Row icon={Mail} label="דוא״ל" value={<span dir="ltr">{userEmail}</span>} />}
              <Row icon={Shield} label="הרשאה" value={isAdmin ? 'מנהל מערכת' : 'משתמש רגיל'} />
            </div>
          </section>

          {/* Workspace */}
          {workspace && (
            <section>
              <p className="text-[11px] font-black tracking-widest mb-1" style={{ color: c.textMuted }}>
                סביבת עבודה
              </p>
              <div style={{ borderTop: `1px solid ${c.cardBorder}` }}>
                <Row icon={Building2} label="שם" value={workspace.name || '—'} />
                <Row icon={CreditCard} label="מסלול"
                  value={PLAN_LABEL[plan] ?? (plan || '—')} />
                {/* The token figure the customer sees elsewhere — a count, never
                    the operator's cost for it. */}
                <Row icon={Gem} label="יתרת טוקנים AI" value={formatTokenDisplay(balance)} />
              </div>
            </section>
          )}

          {/* Links out. Editing lives in Settings; a second editor for the same
              fields is how two copies of one record drift apart. */}
          <div className="space-y-2 pt-1">
            <button onClick={() => { onClose(); onGoSettings(); }} className={action}
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}>
              <SettingsIcon size={14} /> הגדרות סביבת העבודה
            </button>
            <button onClick={() => { onClose(); onGoBilling(); }} className={action}
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}>
              <CreditCard size={14} /> מנוי ותשלום
            </button>
            {onSignOut && (
              <button onClick={() => { onClose(); onSignOut(); }} className={action}
                style={{ border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e' }}>
                <LogOut size={14} /> התנתקות
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
