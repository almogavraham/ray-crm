/**
 * whatsappAgent.ts  — client-side WhatsApp integration.
 *
 * Incoming messages arrive via Firebase Cloud Function (whatsappWebhook)
 * and are stored in Firestore. This file provides real-time listeners
 * and sending capabilities.
 *
 * Firestore layout:
 *   workspaces/{wid}/whatsapp/config            — credentials + settings
 *   workspaces/{wid}/whatsapp/conversations/{phone}             — thread summary
 *   workspaces/{wid}/whatsapp/conversations/{phone}/messages/*  — individual messages
 */

import { db } from './firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc,
  collection, query, orderBy, onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

/* ── Types ────────────────────────────────────────────────────────────────── */
export interface WhatsAppConfig {
  connected: boolean;
  phoneNumberId: string;     // Meta phone number ID
  accessToken: string;       // Meta permanent access token
  webhookToken: string;      // Any random string — used for webhook verification
  displayPhone?: string;     // e.g. "+972-50-..."
  businessName?: string;
  connectedAt?: number;
}

export interface WhatsAppConversation {
  phone: string;
  name: string;
  lastMessage: string;
  lastMessageAt: number;
  status: 'active' | 'resolved';
  unread?: number;
}

export interface WhatsAppMessage {
  id: string;
  from: 'customer' | 'agent';
  text: string;
  timestamp: number;
  status: 'received' | 'pending' | 'sent';
  aiDraft?: string | null;
  aiStatus?: 'processing' | 'ready' | 'sent';
  confidence?: number;
  uncertainties?: string[];
}

/* ── Firestore config ─────────────────────────────────────────────────────── */
export async function loadWhatsAppConfig(wid: string): Promise<WhatsAppConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'workspaces', wid, 'whatsapp', 'config'));
    return snap.exists() ? (snap.data() as WhatsAppConfig) : null;
  } catch { return null; }
}

export async function saveWhatsAppConfig(wid: string, cfg: WhatsAppConfig): Promise<void> {
  await setDoc(doc(db, 'workspaces', wid, 'whatsapp', 'config'), cfg);
}

/* ── Real-time listeners ──────────────────────────────────────────────────── */
export function listenConversations(
  wid: string,
  onUpdate: (convs: WhatsAppConversation[]) => void,
): Unsubscribe {
  const ref = query(
    collection(db, 'workspaces', wid, 'whatsapp', 'conversations'),
    orderBy('lastMessageAt', 'desc'),
  );
  return onSnapshot(ref, snap => {
    onUpdate(snap.docs.map(d => ({ phone: d.id, ...d.data() } as WhatsAppConversation)));
  }, () => onUpdate([]));
}

export function listenMessages(
  wid: string,
  phone: string,
  onUpdate: (msgs: WhatsAppMessage[]) => void,
): Unsubscribe {
  const ref = query(
    collection(db, 'workspaces', wid, 'whatsapp', 'conversations', phone, 'messages'),
    orderBy('timestamp', 'asc'),
  );
  return onSnapshot(ref, snap => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as WhatsAppMessage)));
  }, () => onUpdate([]));
}

/* ── Send message (via Cloud Function) ────────────────────────────────────── */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<void> {
  const fns = getFunctions(undefined, 'us-central1');
  const fn  = httpsCallable<
    { phoneNumberId: string; accessToken: string; to: string; text: string },
    { success: boolean }
  >(fns, 'sendWhatsApp');
  await fn({ phoneNumberId, accessToken, to, text });
}

/* ── Mark message as sent in Firestore ────────────────────────────────────── */
export async function markMessageSent(wid: string, phone: string, msgId: string): Promise<void> {
  const { updateDoc } = await import('firebase/firestore');
  await updateDoc(
    doc(db, 'workspaces', wid, 'whatsapp', 'conversations', phone, 'messages', msgId),
    { aiStatus: 'sent', status: 'sent' },
  );
}

/* ── Store agent reply in Firestore ───────────────────────────────────────── */
export async function storeAgentMessage(wid: string, phone: string, text: string): Promise<void> {
  const { addDoc } = await import('firebase/firestore');
  await addDoc(
    collection(db, 'workspaces', wid, 'whatsapp', 'conversations', phone, 'messages'),
    { from: 'agent', text, timestamp: Date.now(), status: 'sent', aiStatus: 'sent' },
  );
}

/* ── Verify Meta token (test send) ────────────────────────────────────────── */
export async function verifyWhatsAppToken(phoneNumberId: string, accessToken: string): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Meta API error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.display_phone_number ?? data.verified_name ?? '';
}
