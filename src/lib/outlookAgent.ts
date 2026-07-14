/**
 * outlookAgent.ts
 *
 * Microsoft Outlook / Office 365 email integration via Microsoft Graph API.
 * Uses MSAL.js (loaded from CDN) for OAuth 2.0.
 *
 * Setup required (one-time):
 *   1. portal.azure.com → App registrations → New registration
 *   2. Supported account types: "Accounts in any org + personal Microsoft accounts"
 *   3. Redirect URI → Single-page application (SPA) → your app URL
 *   4. API permissions → Microsoft Graph → Mail.Read, Mail.Send, Mail.ReadWrite
 *   5. Copy "Application (client) ID"
 */

import type { GmailMessage } from './gmailAgent';

/* ─── Token cache (per account) ─────────────────────────────────────────── */
const _tokens: Record<string, { token: string; expiry: number }> = {};

function isTokenValid(accountId: string) {
  const t = _tokens[accountId];
  return !!t && Date.now() < t.expiry - 60_000;
}

export function getOutlookToken(accountId: string): string | null {
  return isTokenValid(accountId) ? _tokens[accountId].token : null;
}

/* ─── Load MSAL script ───────────────────────────────────────────────────── */
function loadMsal(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('msal-script')) { resolve(); return; }
    const s = document.createElement('script');
    s.id  = 'msal-script';
    s.src = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load MSAL'));
    document.head.appendChild(s);
  });
}

/* ─── OAuth — get access token ───────────────────────────────────────────── */
export async function requestOutlookToken(
  clientId: string,
  tenantId = 'common',
): Promise<{ token: string; email: string; displayName: string }> {
  await loadMsal();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msal = (window as any).msal;
  if (!msal) throw new Error('MSAL not loaded');

  const pca = new msal.PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });

  await pca.initialize();

  const scopes = [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/User.Read',
  ];

  let result;
  try {
    // Try silent first (existing session)
    const accounts = pca.getAllAccounts();
    if (accounts.length > 0) {
      result = await pca.acquireTokenSilent({ scopes, account: accounts[0] });
    } else {
      throw new Error('no account');
    }
  } catch {
    // Fall back to popup
    result = await pca.acquireTokenPopup({ scopes });
  }

  const token = result.accessToken;
  const expiry = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3600_000;
  const accountId = result.account?.username ?? result.account?.localAccountId ?? clientId;

  _tokens[accountId] = { token, expiry };

  // Get user profile
  const me = await graphGet('/me', token);
  return {
    token,
    email: me.mail ?? me.userPrincipalName ?? '',
    displayName: me.displayName ?? '',
  };
}

/* ─── Microsoft Graph API helper ────────────────────────────────────────── */
async function graphGet(path: string, token: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ─── Fetch unread emails from Outlook ───────────────────────────────────── */
export async function fetchOutlookUnread(token: string, maxResults = 10): Promise<GmailMessage[]> {
  const data = await graphGet(
    `/me/mailFolders/Inbox/messages?$filter=isRead eq false&$top=${maxResults}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,bodyPreview,body,receivedDateTime`,
    token,
  );

  return (data.value ?? [])
    .filter((m: { from?: { emailAddress?: { address?: string } } }) => {
      const addr = m.from?.emailAddress?.address ?? '';
      return addr && !addr.includes('noreply') && !addr.includes('no-reply');
    })
    .map((m: {
      id: string;
      conversationId: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      bodyPreview?: string;
      body?: { content?: string; contentType?: string };
      receivedDateTime?: string;
    }) => ({
      id:       m.id,
      threadId: m.conversationId,
      from:     m.from?.emailAddress?.address ?? '',
      fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '',
      subject:  m.subject ?? '(ללא נושא)',
      snippet:  m.bodyPreview ?? '',
      body:     m.body?.contentType === 'html'
        ? (m.body.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : (m.body?.content ?? m.bodyPreview ?? ''),
      date:     m.receivedDateTime ? new Date(m.receivedDateTime).getTime() : Date.now(),
    } as GmailMessage));
}

/* ─── Mark Outlook email as read ─────────────────────────────────────────── */
export async function markOutlookAsRead(messageId: string, token: string) {
  await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  });
}

/* ─── Send reply via Microsoft Graph ─────────────────────────────────────── */
export async function sendOutlookReply(
  token: string,
  messageId: string,
  body: string,
) {
  await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        body: { contentType: 'Text', content: body },
      },
    }),
  });
}
