/**
 * @deprecated — re-exports from email.ts for backward compatibility.
 * New code should import directly from '../lib/email'.
 */
export { sendLeadEmail, sendInviteEmail, isEmailConfigured as isEmailJSConfigured } from './email';

/** Sync check kept for components that haven't migrated yet (always false — use workspace.emailConfig). */
export function isEmailJSConfigured_legacy(): boolean { return false; }
