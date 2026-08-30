/**
 * auditTrail.ts — recycle bin + audit log.
 *
 * Written after a single Excel import silently rewrote 253 lead statuses with
 * no record of the previous values and no way back. That was recoverable only
 * because the source spreadsheet happened to still exist. This module makes the
 * next incident recoverable by design:
 *
 *  • Deleting a lead moves the WHOLE document to the recycle bin instead of
 *    erasing it. Restoring is putting the same document back.
 *  • Anything that changes data worth explaining writes an audit entry — who,
 *    what, when, and for bulk operations, how many.
 *
 * Both live under the workspace, so the existing member-only rules already
 * cover them and no rule change is needed.
 *
 * Deliberately fire-and-forget: an audit write must never block or fail the
 * user action it is describing. A missing log line is bad; a delete that hangs
 * because logging broke is worse.
 */

import {
  collection, doc, setDoc, getDocs, deleteDoc, query, orderBy, limit as qLimit,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Lead } from '../types';

export type AuditAction =
  | 'lead.create' | 'lead.update' | 'lead.delete' | 'lead.restore'
  | 'lead.status' | 'lead.bulk_delete' | 'lead.bulk_status'
  | 'lead.import' | 'lead.export'
  | 'settings.status' | 'settings.update'
  | 'team.invite' | 'team.remove'
  | 'automation.run';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  /** Human-readable, already in Hebrew — the log is read by the customer. */
  summary: string;
  actor: string;
  at: number;
  targetId?: string;
  targetName?: string;
  /** For bulk operations. */
  count?: number;
  before?: string;
  after?: string;
}

export interface DeletedLead {
  id: string;
  lead: Lead;
  deletedAt: number;
  deletedBy: string;
}

const auditCol = (wid: string) => collection(db, 'workspaces', wid, 'auditLog');
const binCol   = (wid: string) => collection(db, 'workspaces', wid, 'recycleBin');

/** Firestore rejects undefined; strip before writing. */
function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/* ── Audit ────────────────────────────────────────────────────────────────── */
export function logAudit(
  wid: string | null | undefined,
  entry: Omit<AuditEntry, 'id' | 'at'>,
): void {
  if (!wid) return;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  void setDoc(doc(auditCol(wid), id), clean({ ...entry, id, at: Date.now() }))
    .catch(err => console.error('[audit]', err));
}

export async function loadAudit(wid: string, max = 200): Promise<AuditEntry[]> {
  const snap = await getDocs(query(auditCol(wid), orderBy('at', 'desc'), qLimit(max)));
  return snap.docs.map(d => d.data() as AuditEntry);
}

/* ── Recycle bin ──────────────────────────────────────────────────────────── */
/**
 * Park a lead instead of destroying it. Returns false if parking failed, so the
 * caller can refuse to delete rather than lose the record — a delete that
 * skipped the bin would defeat the entire point.
 */
export async function moveToRecycleBin(wid: string, lead: Lead, actor: string): Promise<boolean> {
  try {
    await setDoc(doc(binCol(wid), lead.id), clean({
      id: lead.id,
      lead: JSON.parse(JSON.stringify(lead)),   // plain object, no class instances
      deletedAt: Date.now(),
      deletedBy: actor || '',
    }));
    return true;
  } catch (err) {
    console.error('[recycleBin]', err);
    return false;
  }
}

export async function loadRecycleBin(wid: string): Promise<DeletedLead[]> {
  const snap = await getDocs(query(binCol(wid), orderBy('deletedAt', 'desc'), qLimit(300)));
  return snap.docs.map(d => d.data() as DeletedLead);
}

/** Put the document back exactly as it was, then clear the bin entry. */
export async function restoreFromBin(wid: string, entry: DeletedLead): Promise<void> {
  await setDoc(doc(db, 'workspaces', wid, 'leads', entry.id), entry.lead);
  await deleteDoc(doc(binCol(wid), entry.id));
}

/** Irreversible. Only from an explicit "empty bin" action. */
export async function purgeFromBin(wid: string, id: string): Promise<void> {
  await deleteDoc(doc(binCol(wid), id));
}

export function daysInBin(e: DeletedLead): number {
  return Math.floor((Date.now() - (e.deletedAt || 0)) / 86400000);
}
