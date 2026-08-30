/**
 * notifications.ts
 *
 * Lightweight in-app notification store. The app had no general notification
 * collection (the bell only showed computed overdue-task / low-token alerts);
 * the autonomous Marketing Autopilot needs to surface "a plan is ready for your
 * approval" (and publish success/failure) as real, persisted notifications.
 *
 * Collection: workspaces/{wid}/notifications/{id}
 */

import { db } from './firebase';
import {
  collection, addDoc, getDocs, query, orderBy, limit as fsLimit,
  doc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';

export type NotificationType =
  | 'autopilot_approval'   // a plan is waiting for approval
  | 'autopilot_published'  // posts went live
  | 'autopilot_failed'     // a publish failed
  | 'info';

export interface AppNotification {
  id:        string;
  type:      NotificationType;
  title:     string;
  body:      string;
  link?:     string;       // in-app route, e.g. 'marketing-agent'
  planId?:   string;
  read:      boolean;
  createdAt: number;
}

function itemsCol(wid: string) {
  return collection(db, 'workspaces', wid, 'notifications');
}

/** Create a notification. Returns the new id (or '' on failure — never throws). */
export async function createNotification(
  wid: string,
  n: { type: NotificationType; title: string; body: string; link?: string; planId?: string },
): Promise<string> {
  try {
    const payload: Omit<AppNotification, 'id'> = {
      type:      n.type,
      title:     n.title,
      body:      n.body,
      read:      false,
      createdAt: Date.now(),
      ...(n.link   ? { link: n.link }     : {}),
      ...(n.planId ? { planId: n.planId } : {}),
    };
    const ref = await addDoc(itemsCol(wid), payload);
    return ref.id;
  } catch (err) {
    console.error('[notifications create]', err);
    return '';
  }
}

/** Load recent notifications (newest first). */
export async function loadNotifications(wid: string, max = 30): Promise<AppNotification[]> {
  try {
    const snap = await getDocs(query(itemsCol(wid), orderBy('createdAt', 'desc'), fsLimit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification));
  } catch {
    return [];
  }
}

export async function markNotificationRead(wid: string, id: string): Promise<void> {
  await updateDoc(doc(db, 'workspaces', wid, 'notifications', id), { read: true }).catch(() => {});
}

export async function markAllNotificationsRead(wid: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'workspaces', wid, 'notifications', id), { read: true }));
    await batch.commit();
  } catch (err) {
    console.error('[notifications markAll]', err);
  }
}

export async function deleteNotification(wid: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'workspaces', wid, 'notifications', id)).catch(() => {});
}
