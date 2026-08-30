/**
 * StatusRestoreTool — ONE-OFF repair for the cheX workspace.
 *
 * The 24/8 Excel import collapsed almost every lead into 'בתהליך',
 * destroying the real pipeline (הזדמנויות, הטמעה, רימרקטינג, …). The source
 * spreadsheet still holds the truth, so this maps each lead back by PHONE
 * NUMBER — a stabler key than company name, which varies in spelling.
 *
 * Safety rules baked in, not optional:
 *  • Only leads currently sitting in 'בתהליך' can move. Nothing else is
 *    touched, so a mistake here cannot scatter the pipeline.
 *  • Any lead whose activity log shows a manual status change is SKIPPED —
 *    hand corrections outrank a bulk restore, always.
 *  • Preview first; the write only happens on a second, explicit click.
 *  • Every current status is backed up to config/statusBackup_* first.
 *
 * DELETE THIS FILE once the restore is confirmed good — it is a migration,
 * not a feature.
 */

import { useState } from 'react';
import { collection, getDocs, doc, writeBatch, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AlertTriangle, Loader2, ShieldCheck, RotateCcw } from 'lucide-react';

const STATUSES = ["בתהליך", "הזדמנויות", "הטמעה", "הקמת כספת בבנק", "התנסות בצ'קס", "טופל", "לא רלוונטי", "לקוח פעיל", "רימרקטינג"];

/** last-9-digits of phone → index into STATUSES, taken from the source file. */
const PHONE_TO_STATUS: Record<string, number> = {"523342355": 8, "546766932": 8, "543202030": 8, "86110115": 8, "556665487": 5, "547770723": 2, "526989792": 7, "549831707": 7, "545378805": 7, "509929639": 7, "543029213": 7, "559615871": 8, "545232600": 8, "522261515": 2, "505626268": 7, "039495967": 8, "542410028": 3, "545750307": 7, "527052746": 7, "542131047": 7, "552239120": 2, "525771919": 7, "525223009": 7, "544344278": 1, "545847141": 7, "99525270": 1, "545651855": 7, "525656600": 2, "523576057": 8, "501284567": 6, "546239349": 7, "507788427": 7, "524636461": 2, "525104490": 8, "526135503": 7, "508655588": 2, "505889394": 7, "501112221": 6, "516912268": 8, "526897791": 2, "504655103": 8, "543327678": 8, "533018489": 6, "26751255": 7, "546760291": 2, "737779977": 8, "532843934": 8, "509070880": 6, "507732407": 8, "522464191": 2, "503879222": 8, "506951843": 2, "546766173": 8, "544347929": 2, "548528627": 8, "527262211": 8, "587987982": 8, "609323147": 8, "559377510": 8, "505494955": 6, "547912845": 7, "524058282": 7, "545223103": 8, "545657818": 7, "505341356": 7, "775704892": 8, "527152562": 8, "533147306": 6, "523221207": 8, "506469744": 7, "526007808": 7, "546864322": 7, "585005055": 2, "526720742": 8, "545463354": 6, "502130129": 1, "532422234": 8, "504877833": 7, "505777290": 8, "546544669": 8, "522686218": 2, "507866677": 1, "542079820": 7, "505203333": 7, "545241480": 8, "504590165": 7, "507900119": 7, "505609906": 8, "501234567": 2, "523896242": 6, "542442840": 3, "747474705": 7, "542645770": 2, "546904155": 6, "503623006": 2, "527145726": 8, "527905942": 7, "529402286": 2, "732411129": 2, "528310095": 8, "505110051": 2, "526949474": 8, "529247213": 7, "546556158": 2, "526830860": 7, "549480053": 8, "547388083": 7, "527211000": 8, "88660888": 8, "528520223": 6, "548051903": 8, "524753967": 7, "524038000": 3, "525805544": 7, "527159344": 8, "506288836": 2, "524719087": 7, "545419733": 8, "504784791": 7, "543219014": 3, "506361575": 8, "523126670": 2, "526969459": 2, "502185080": 2, "509360616": 3, "544462669": 2, "503515333": 3, "524442090": 8, "526065454": 7, "524049933": 8, "502171022": 2, "542355226": 2, "528315131": 7, "545659960": 3, "556892770": 2, "544320632": 2, "508114396": 8, "509916312": 7, "503939057": 1, "545743384": 1, "543434320": 2, "533333323": 3, "504808881": 7, "502277802": 0, "509252832": 7, "505380556": 8, "012345678": 2, "544204202": 6, "545574051": 7, "502026768": 7, "526553343": 1, "515150095": 2, "545522112": 1, "503933393": 8, "556688878": 1, "524688446": 2, "543023567": 3, "505912360": 1, "586533391": 2, "523327774": 6, "549404909": 1, "533141156": 6, "26714646": 8, "39243102": 8, "526175181": 1, "506622966": 8, "527990937": 1, "547998991": 1, "524764097": 8, "545916171": 1, "33744800": 7, "526556876": 8, "505479032": 2, "522592986": 7, "536601000": 1, "542622717": 2, "525644180": 2, "505899490": 7, "532448303": 7, "547748299": 1, "586500529": 1, "547679867": 8, "523615708": 1, "508339490": 6, "536207003": 7, "542325898": 1, "502023334": 1, "546352616": 2, "544999549": 2, "527141699": 2, "538898835": 6, "547713239": 8, "546868621": 8, "507580295": 1, "504288029": 8, "522419532": 8, "544224342": 1, "522689368": 7, "524700132": 8, "525550129": 1, "528571133": 8, "522968081": 1, "546623571": 8, "522747830": 8, "526459509": 8, "525951915": 1, "28008182": 1, "543551383": 1, "528952362": 4, "542364236": 4, "545634338": 1, "547833602": 1, "506905604": 1, "505286663": 1, "545415210": 1, "525655112": 1, "509983456": 6, "507274565": 1, "544859881": 2, "39063330": 1, "507829177": 2, "506904033": 2, "507316234": 7, "546977349": 1, "549002147": 7, "88549850": 2, "546662775": 8, "234567899": 7, "507006009": 3, "547480126": 3, "503613636": 8, "515599168": 2, "533330910": 2, "35597761": 8, "505599092": 1, "528459775": 0, "504292001": 3, "545620462": 2, "542340696": 1, "548000770": 8, "525802022": 3, "506455571": 0, "523659653": 2, "506780346": 2, "546674071": 7, "549002162": 7, "544253808": 8, "544360294": 7, "545209283": 7, "509361522": 2, "549487454": 2, "524841789": 2, "547393454": 2, "547341536": 7, "583280580": 3, "546667148": 2, "523610022": 0, "523420155": 2, "542208062": 8, "39191073": 1, "732207103": 8, "526532298": 8, "777392788": 0, "528870771": 7, "526662322": 3, "507727099": 2, "523188891": 0, "528207200": 8, "556681608": 8, "547006453": 0, "587802593": 0, "537427448": 8, "506763003": 6, "88521215": 2, "542300845": 8, "522962761": 0, "542220645": 0, "525292248": 8, "504420119": 3, "546137720": 8, "526388980": 0, "547528100": 0, "507962235": 0, "528772700": 0, "523642233": 3, "509240402": 2, "506917771": 0, "504883988": 2, "509330434": 0, "544285326": 2, "546662484": 0, "502445000": 0, "546777127": 0, "544404395": 2, "525286321": 1, "543737322": 0, "526684547": 0, "535405002": 7, "522684440": 0, "586881524": 0, "527757757": 7, "559933648": 1, "505753537": 1};
const digits = (s: string) => String(s || '').replace(/\D/g, '').slice(-9);
const COLLAPSED = 'בתהליך';
const STRAY_SPACE = 'הקמת כספת בבנק ';   // legacy value carrying a trailing space

interface Plan {
  changes: { id: string; company: string; from: string; to: string }[];
  byTarget: Record<string, number>;
  skippedManual: number;
  unmatched: number;
  alreadyCorrect: number;
  total: number;
}

export default function StatusRestoreTool({ workspaceId, onToast }: {
  workspaceId: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const buildPlan = async () => {
    setBusy('קורא לידים...');
    setDone(null);
    try {
      const snap = await getDocs(collection(db, 'workspaces', workspaceId, 'leads'));
      const p: Plan = { changes: [], byTarget: {}, skippedManual: 0, unmatched: 0, alreadyCorrect: 0, total: snap.size };

      snap.forEach(d => {
        const v = d.data() as Record<string, unknown>;
        const status = String(v.status ?? '');
        const company = String(v.company ?? '');
        const log = Array.isArray(v.activityLog) ? (v.activityLog as { content?: string }[]) : [];
        const touchedByHand = log.some(e => String(e?.content ?? '').startsWith('סטטוס שונה'));

        // Normalise the stray trailing space regardless of anything else.
        if (status === STRAY_SPACE) {
          p.changes.push({ id: d.id, company, from: status, to: STRAY_SPACE.trim() });
          p.byTarget['ניקוי רווח מיותר'] = (p.byTarget['ניקוי רווח מיותר'] ?? 0) + 1;
          return;
        }

        const idx = PHONE_TO_STATUS[digits(String(v.phone ?? ''))];
        if (idx === undefined) { p.unmatched++; return; }
        const want = STATUSES[idx];
        if (status === want) { p.alreadyCorrect++; return; }
        if (status !== COLLAPSED) { p.alreadyCorrect++; return; }   // never move anything else
        if (touchedByHand) { p.skippedManual++; return; }

        p.changes.push({ id: d.id, company, from: status, to: want });
        const k = `${status} ← ${want}`;
        p.byTarget[k] = (p.byTarget[k] ?? 0) + 1;
      });

      setPlan(p);
      onToast(`נמצאו ${p.changes.length} שינויים`, 'info');
    } catch (e) {
      onToast(`שגיאה: ${(e as Error).message}`, 'error');
    } finally { setBusy(null); }
  };

  const apply = async () => {
    if (!plan) return;
    if (!window.confirm(`לשחזר ${plan.changes.length} סטטוסים?\n\nגיבוי של המצב הנוכחי יישמר לפני הכתיבה.`)) return;
    setBusy('מגבה...');
    try {
      // Back up EVERY current status, so undoing is one command rather than a
      // reconstruction job.
      const snap = await getDocs(collection(db, 'workspaces', workspaceId, 'leads'));
      const statuses: Record<string, string> = {};
      snap.forEach(d => { statuses[d.id] = String((d.data() as Record<string, unknown>).status ?? ''); });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await setDoc(doc(db, 'workspaces', workspaceId, 'config', `statusBackup_${stamp}`), {
        takenAt: new Date().toISOString(),
        reason: 'before restoring statuses lost in the 24/8 Excel import',
        statuses,
      });

      setBusy(`כותב ${plan.changes.length} לידים...`);
      // Firestore caps a batch at 500 writes.
      for (let i = 0; i < plan.changes.length; i += 400) {
        const b = writeBatch(db);
        plan.changes.slice(i, i + 400).forEach(c => {
          b.update(doc(db, 'workspaces', workspaceId, 'leads', c.id), { status: c.to });
        });
        await b.commit();
      }

      // Every restored status needs a config, or the leads land orphaned in the
      // UI exactly like they were before.
      setBusy('מעדכן הגדרות סטטוסים...');
      const cfgRef = doc(db, 'workspaces', workspaceId, 'config', 'statuses');
      const cfgSnap = await getDoc(cfgRef);
      const existing = ((cfgSnap.exists() ? cfgSnap.data().configs : []) ?? []) as Record<string, unknown>[];
      const have = new Set(existing.map(c => String(c.id)));
      const palette = ['#0ea5e9', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16'];
      let order = existing.length;
      const added: string[] = [];
      for (const s of STATUSES) {
        if (have.has(s)) continue;
        existing.push({
          id: s, label: s, color: palette[added.length % palette.length], emoji: '🏷️',
          order: order++, isDefault: false, pipeline: true, description: '',
        });
        added.push(s);
      }
      // Drop the stale trailing-space variant now that no lead uses it.
      const cleaned = existing.filter(c => String(c.id) !== STRAY_SPACE);
      await setDoc(cfgRef, { configs: cleaned }, { merge: true });

      setDone(`שוחזרו ${plan.changes.length} לידים · נוספו ${added.length} סטטוסים · גיבוי: statusBackup_${stamp}`);
      onToast('השחזור הושלם ✓', 'success');
      setPlan(null);
    } catch (e) {
      onToast(`השחזור נכשל: ${(e as Error).message}`, 'error');
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" dir="rtl"
      style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)' }}>
      <div className="flex items-center gap-2 justify-end text-amber-300 font-bold text-sm">
        <span>שחזור סטטוסים — ייבוא 24.8</span>
        <AlertTriangle size={15} />
      </div>
      <p className="text-[11px] text-white/50 text-right leading-relaxed">
        מחזיר לידים שהייבוא כיווץ ל"בתהליך" לסטטוס האמיתי שלהם, לפי קובץ המקור.
        לידים שתוקנו ידנית לא ייגעו. גיבוי מלא נשמר לפני הכתיבה.
      </p>

      <div className="flex gap-2 justify-end">
        <button onClick={buildPlan} disabled={!!busy}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 border border-white/20 text-white/80 disabled:opacity-40 flex items-center gap-1.5">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          {busy ?? 'הצג תצוגה מקדימה'}
        </button>
      </div>

      {plan && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <div className="text-[11px] text-white/70 text-right">
            סה״כ {plan.total} לידים · <strong className="text-amber-300">{plan.changes.length} ישתנו</strong> ·
            {' '}{plan.skippedManual} דולגו (תוקנו ידנית) · {plan.alreadyCorrect} כבר נכונים · {plan.unmatched} לא בקובץ
          </div>
          <div className="space-y-1">
            {Object.entries(plan.byTarget).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <div key={k} className="flex justify-between text-[11px] text-white/60">
                <span className="font-bold text-amber-300">{n}</span>
                <span dir="rtl">{k}</span>
              </div>
            ))}
          </div>
          {plan.changes.length > 0 && (
            <button onClick={apply} disabled={!!busy}
              className="w-full mt-1 px-3 py-2 rounded-lg text-[11px] font-black text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#f59e0b,#ea580c)' }}>
              בצע שחזור של {plan.changes.length} לידים
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="rounded-lg px-3 py-2 text-[11px] text-emerald-300 flex items-center gap-2 justify-end"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
          <span>{done}</span>
          <ShieldCheck size={13} />
        </div>
      )}
    </div>
  );
}
