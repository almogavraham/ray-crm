/**
 * dailyBackup.js — nightly snapshot of every workspace's leads and config.
 *
 * The recycle bin covers deletes and the audit log explains changes, but
 * neither helps against the case that actually happened here: a bulk write that
 * overwrote 253 records in place. Nothing was deleted, so nothing was in a bin;
 * the previous values simply stopped existing. A point-in-time snapshot is the
 * only thing that recovers from that.
 *
 * Design notes:
 *  • Runs server-side so it does not depend on anyone having the app open.
 *  • Keeps a rolling 14 days. Older snapshots are pruned each night, so storage
 *    stays bounded without anyone maintaining it.
 *  • Stores a compact per-lead projection, not whole documents. The point is to
 *    reconstruct WHAT CHANGED (status, owner, source, value) — keeping every
 *    note and activity daily would balloon storage for little recovery value,
 *    and the recycle bin already holds full documents for deletes.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const KEEP_DAYS = 14;

exports.dailyBackup = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'Asia/Jerusalem', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    const stamp = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD

    let workspaces;
    try {
      workspaces = await db.collection('workspaces').get();
    } catch (err) {
      console.error('dailyBackup: cannot list workspaces', err);
      return;
    }

    for (const ws of workspaces.docs) {
      const wid = ws.id;
      try {
        const leadsSnap = await db.collection('workspaces').doc(wid).collection('leads').get();
        if (leadsSnap.empty) continue;

        const leads = {};
        leadsSnap.forEach(d => {
          const v = d.data() || {};
          leads[d.id] = {
            company: v.company ?? '',
            contactName: v.contactName ?? '',
            phone: v.phone ?? '',
            status: v.status ?? '',
            source: v.source ?? '',
            assignedTo: v.assignedTo ?? '',
            budget: Number(v.budget) || 0,
            notesCount: Array.isArray(v.notes) ? v.notes.length : 0,
            solutionsCount: Array.isArray(v.solutions) ? v.solutions.length : 0,
          };
        });

        // Status config travels with the snapshot — restoring statuses is
        // useless if the definitions they point at are gone.
        let statuses = null;
        try {
          const cfg = await db.collection('workspaces').doc(wid).collection('config').doc('statuses').get();
          if (cfg.exists) statuses = cfg.data().configs ?? null;
        } catch { /* optional */ }

        await db.collection('workspaces').doc(wid)
          .collection('backups').doc(stamp)
          .set({ takenAt: Date.now(), date: stamp, leadCount: leadsSnap.size, leads, statuses });

        // Prune anything older than the retention window.
        const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
        const old = await db.collection('workspaces').doc(wid)
          .collection('backups').where('date', '<', cutoff).get();
        for (const doc of old.docs) await doc.ref.delete();

        console.log(`dailyBackup: ${wid} — ${leadsSnap.size} leads, pruned ${old.size}`);
      } catch (err) {
        // One failing workspace must not stop the rest.
        console.error(`dailyBackup: workspace ${wid} failed`, err);
      }
    }
  },
);
