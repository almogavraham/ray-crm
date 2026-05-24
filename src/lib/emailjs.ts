/**
 * EmailJS helper — legacy global config (env vars).
 *
 * Per-workspace email config is now stored in Firestore under
 * `workspaces/{wid}.emailConfig` and used via dynamic import in
 * WorkspaceSettings.tsx and Settings.tsx.
 *
 * This file is kept for backward-compat with EmailModal.tsx and
 * TeamManagement.tsx which still check `isEmailJSConfigured()`.
 * Since VITE_EMAILJS_* env vars are not set in production, the
 * functions will always return false / throw — callers handle that gracefully.
 */

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID       || '';
const LEAD_TMPL   = import.meta.env.VITE_EMAILJS_TEMPLATE_LEAD    || '';
const INVITE_TMPL = import.meta.env.VITE_EMAILJS_TEMPLATE_INVITE  || '';
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY        || '';

/** Returns true only when all four env vars are configured. */
export function isEmailJSConfigured(): boolean {
  return !!(SERVICE_ID && LEAD_TMPL && INVITE_TMPL && PUBLIC_KEY);
}

export async function sendLeadEmail(params: {
  toEmail: string;
  toName: string;
  subject: string;
  message: string;
  fromName: string;
}): Promise<void> {
  if (!isEmailJSConfigured()) throw new Error('EmailJS is not configured');
  const emailjs = await import('@emailjs/browser');
  await emailjs.default.send(
    SERVICE_ID,
    LEAD_TMPL,
    {
      to_email:  params.toEmail,
      to_name:   params.toName,
      subject:   params.subject,
      message:   params.message,
      from_name: params.fromName,
    },
    PUBLIC_KEY,
  );
}

export async function sendInviteEmail(params: {
  toEmail: string;
  invitedBy: string;
  role: string;
  inviteLink: string;
}): Promise<void> {
  if (!isEmailJSConfigured()) throw new Error('EmailJS is not configured');
  const emailjs = await import('@emailjs/browser');
  await emailjs.default.send(
    SERVICE_ID,
    INVITE_TMPL,
    {
      to_email:    params.toEmail,
      invited_by:  params.invitedBy,
      role:        params.role,
      invite_link: params.inviteLink,
    },
    PUBLIC_KEY,
  );
}
