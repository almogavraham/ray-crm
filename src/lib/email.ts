/**
 * Email helper — supports multiple providers:
 *   - 'gmail'   : Firebase Cloud Function → Nodemailer → Gmail SMTP
 *   - 'outlook' : Firebase Cloud Function → Nodemailer → Office 365 SMTP
 *   - 'emailjs' : Browser-side @emailjs/browser (no server needed)
 *
 * Credentials are NEVER stored in the client for gmail/outlook.
 * For EmailJS the public key is safe to expose.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import type { WorkspaceProfile } from '../types';

interface SendEmailPayload {
  workspaceId?: string;
  to:        string;
  subject:   string;
  htmlBody:  string;
  textBody?: string;
}

/** Call the Cloud Function to send an email (gmail / outlook). */
async function callSendEmail(payload: SendEmailPayload): Promise<void> {
  const functions = getFunctions(undefined, 'us-central1');
  const fn = httpsCallable<SendEmailPayload, { success: boolean }>(functions, 'sendEmail');
  await fn(payload);
}

/** Returns true when the workspace has ANY email provider configured. */
export function isEmailConfigured(workspace?: WorkspaceProfile | null): boolean {
  const cfg = workspace?.emailConfig;
  if (!cfg) return false;
  const provider = cfg.provider ?? 'gmail';
  if (provider === 'emailjs') {
    return !!(cfg.emailServiceId && cfg.emailPublicKey && cfg.emailTemplateId);
  }
  // gmail or outlook
  return !!(cfg.gmailUser && cfg.gmailAppPasswordSet);
}

/** Returns the active email provider ('gmail' | 'outlook' | 'emailjs'). */
export function getEmailProvider(workspace?: WorkspaceProfile | null): 'gmail' | 'outlook' | 'emailjs' {
  return (workspace?.emailConfig?.provider as 'gmail' | 'outlook' | 'emailjs') ?? 'gmail';
}

/** Build plain HTML body for lead emails. */
function buildLeadHtml(message: string, fromName: string): string {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b;">
      <p style="white-space: pre-wrap; line-height: 1.7;">${message.replace(/\n/g, '<br>')}</p>
      <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;" />
      <p style="color: #94a3b8; font-size: 12px;">${fromName}</p>
    </div>
  `;
}

/** Send a lead-related email. */
export async function sendLeadEmail(params: {
  toEmail:     string;
  toName:      string;
  subject:     string;
  message:     string;
  fromName:    string;
  workspaceId?: string;
  workspace?:  WorkspaceProfile | null;
}): Promise<void> {
  const provider = getEmailProvider(params.workspace);
  const cfg = params.workspace?.emailConfig;

  if (provider === 'emailjs' && cfg?.emailServiceId && cfg?.emailTemplateId && cfg?.emailPublicKey) {
    const emailjs = await import('@emailjs/browser');
    await emailjs.send(
      cfg.emailServiceId,
      cfg.emailTemplateId,
      {
        to_email:   params.toEmail,
        to_name:    params.toName,
        from_name:  params.fromName,
        subject:    params.subject,
        message:    params.message,
      },
      { publicKey: cfg.emailPublicKey },
    );
    return;
  }

  // gmail / outlook — via Cloud Function
  await callSendEmail({
    workspaceId: params.workspaceId,
    to:          params.toEmail,
    subject:     params.subject,
    htmlBody:    buildLeadHtml(params.message, params.fromName),
    textBody:    params.message,
  });
}

/** Send a team-invite email. */
export async function sendInviteEmail(params: {
  toEmail:     string;
  invitedBy:   string;
  role:        string;
  inviteLink:  string;
  workspaceId?: string;
  workspace?:  WorkspaceProfile | null;
}): Promise<void> {
  const provider = getEmailProvider(params.workspace);
  const cfg = params.workspace?.emailConfig;

  const subject = `הוזמנת ל-RAY CRM על-ידי ${params.invitedBy}`;

  if (provider === 'emailjs' && cfg?.emailServiceId && cfg?.emailPublicKey) {
    const templateId = cfg.emailInviteTmpl || cfg.emailTemplateId;
    if (!templateId) throw new Error('EmailJS invite template not configured.');
    const emailjs = await import('@emailjs/browser');
    await emailjs.send(
      cfg.emailServiceId,
      templateId,
      {
        to_email:    params.toEmail,
        invited_by:  params.invitedBy,
        role:        params.role,
        invite_link: params.inviteLink,
        subject,
      },
      { publicKey: cfg.emailPublicKey },
    );
    return;
  }

  // gmail / outlook — via Cloud Function
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b;">
      <h2 style="margin-bottom: 8px;">הוזמנת להצטרף ל-RAY CRM</h2>
      <p>${params.invitedBy} מזמין אותך להצטרף כ-<strong>${params.role}</strong>.</p>
      <a href="${params.inviteLink}"
         style="display: inline-block; margin-top: 16px; padding: 12px 24px;
                background: #4f46e5; color: white; border-radius: 8px;
                text-decoration: none; font-weight: 600;">
        הצטרף עכשיו
      </a>
      <p style="margin-top: 16px; color: #64748b; font-size: 13px;">
        או העתק קישור: <a href="${params.inviteLink}">${params.inviteLink}</a>
      </p>
    </div>
  `;
  await callSendEmail({
    workspaceId: params.workspaceId,
    to:          params.toEmail,
    subject,
    htmlBody:    html,
  });
}
