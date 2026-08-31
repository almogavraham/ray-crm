/**
 * automationSend.ts — turn an automation's template action into a real message.
 *
 * Two rules shape this file:
 *
 * 1. **A lead is never messaged twice by the same rule.** Automations re-evaluate
 *    on every lead save, so without a ledger a matching rule would email the same
 *    person on every edit. Each send writes a deterministic marker document and
 *    refuses to run when that marker already exists.
 *
 * 2. **Nothing is reported as sent unless it was.** Every failure is returned to
 *    the caller with its reason instead of being swallowed, and WhatsApp is
 *    reported as a link to open rather than a message that went out — there is
 *    no unattended WhatsApp API here, and claiming otherwise would be a lie the
 *    customer only discovers when the lead never replies.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { sendLeadEmail } from './email';
import { loadTemplates, renderTemplate } from './messageTemplates';
import type { MessageTemplate } from './messageTemplates';
import type { PendingSend } from './automationEngine';
import type { Lead, WorkspaceProfile } from '../types';

export interface SendOutcome {
  /** Emails that actually went out. */
  sent: string[];
  /** WhatsApp messages prepared — a human still has to press send. */
  links: { rule: string; url: string }[];
  /** Sends that were attempted and failed, with the reason. */
  failed: { rule: string; reason: string }[];
  /** Sends skipped because this rule already messaged this lead. */
  skipped: number;
}

const EMPTY: SendOutcome = { sent: [], links: [], failed: [], skipped: 0 };

/** Deterministic id — the same rule + lead + template can only ever fire once. */
const markerId = (s: PendingSend, leadId: string) =>
  `${s.workflowId}__${leadId}__${s.templateId}`.replace(/[/#[\]]/g, '_');

function waLink(phone: string, body: string): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  // Israeli local numbers (05…) need the country code for wa.me to resolve.
  const intl = digits.startsWith('972') ? digits
    : digits.startsWith('0') ? `972${digits.slice(1)}`
    : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(body)}`;
}

export async function dispatchAutomationSends(params: {
  workspaceId?: string;
  workspace?: WorkspaceProfile | null;
  lead: Lead;
  sends: PendingSend[];
  fromName: string;
  /** Default true — send as noreply@ray-crm.com. */
  fromPlatform?: boolean;
  /** Address a customer's reply should reach, since noreply cannot receive. */
  replyTo?: string;
}): Promise<SendOutcome> {
  const { workspaceId, workspace, lead, sends, fromName } = params;
  if (!sends.length || !workspaceId) return EMPTY;

  let templates: MessageTemplate[];
  try {
    templates = await loadTemplates(workspaceId);
  } catch (e) {
    // Without the templates there is nothing to send, and guessing at content
    // would be worse than reporting the failure.
    return { ...EMPTY, failed: sends.map(s => ({ rule: s.workflowName, reason: `לא הצלחתי לטעון את התבניות: ${(e as Error).message}` })) };
  }

  const out: SendOutcome = { sent: [], links: [], failed: [], skipped: 0 };

  for (const s of sends) {
    const tpl = templates.find(t => t.id === s.templateId);
    if (!tpl) {
      out.failed.push({ rule: s.workflowName, reason: 'התבנית נמחקה — האוטומציה מפנה לתבנית שלא קיימת' });
      continue;
    }

    const ref = doc(db, 'workspaces', workspaceId, 'automationSends', markerId(s, lead.id));
    try {
      if ((await getDoc(ref)).exists()) { out.skipped++; continue; }
    } catch {
      // A ledger we cannot read is a ledger we cannot trust. Refusing to send is
      // the safe direction: a missed follow-up is recoverable, a duplicate blast
      // to a customer is not.
      out.failed.push({ rule: s.workflowName, reason: 'לא הצלחתי לוודא שההודעה לא נשלחה כבר — לא שלחתי' });
      continue;
    }

    const body = renderTemplate(tpl.body, lead);

    if (s.channel === 'whatsapp') {
      const url = waLink(lead.phone ?? '', body);
      if (!url) { out.failed.push({ rule: s.workflowName, reason: 'אין מספר טלפון תקין לליד' }); continue; }
      out.links.push({ rule: s.workflowName, url });
      continue;   // no marker: nothing was sent yet, a human still has to press send
    }

    if (!lead.email) { out.failed.push({ rule: s.workflowName, reason: 'אין כתובת מייל לליד' }); continue; }

    try {
      await sendLeadEmail({
        toEmail: lead.email,
        toName:  lead.contactName || lead.company || '',
        subject: renderTemplate(tpl.subject ?? '', lead) || tpl.name,
        message: body,
        fromName,
        workspaceId,
        workspace,
        // Automated mail goes out from the platform address by default: it must
        // not depend on the workspace having its own mailbox connected, and a
        // machine-sent message should not arrive from an inbox someone watches.
        fromPlatform: params.fromPlatform !== false,
        replyTo: params.replyTo,
      });
    } catch (e) {
      out.failed.push({ rule: s.workflowName, reason: (e as Error).message || 'שליחת המייל נכשלה' });
      continue;
    }

    // Written only after the send succeeded, so a failure can be retried.
    await setDoc(ref, {
      workflowId: s.workflowId, workflowName: s.workflowName, leadId: lead.id,
      templateId: s.templateId, channel: s.channel, to: lead.email,
      sentAt: new Date().toISOString(),
    }).catch(() => {
      // The mail is already gone; the worst case now is one duplicate later.
      // Surfacing it beats pretending the ledger is intact.
      out.failed.push({ rule: s.workflowName, reason: 'המייל נשלח אך לא הצלחתי לרשום זאת — ייתכן שיישלח שוב' });
    });
    out.sent.push(`${s.workflowName} → ${lead.email}`);
  }

  return out;
}
