import emailjs from '@emailjs/browser';

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID  || '';
const LEAD_TMPL   = import.meta.env.VITE_EMAILJS_TEMPLATE_LEAD   || '';
const INVITE_TMPL = import.meta.env.VITE_EMAILJS_TEMPLATE_INVITE || '';
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY  || '';

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
  await emailjs.send(
    SERVICE_ID,
    LEAD_TMPL,
    {
      to_email: params.toEmail,
      to_name:  params.toName,
      subject:  params.subject,
      message:  params.message,
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
  await emailjs.send(
    SERVICE_ID,
    INVITE_TMPL,
    {
      to_email:   params.toEmail,
      invited_by: params.invitedBy,
      role:        params.role,
      invite_link: params.inviteLink,
    },
    PUBLIC_KEY,
  );
}
