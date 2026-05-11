import { useState, useRef, useEffect } from 'react';
import {
  User, Palette, Database, Info, Save, RefreshCw, Download,
  Upload, CheckCircle2, AlertTriangle, Shield, Zap, Bell,
  ChevronLeft, Monitor, Moon, Globe, Users2, Copy, Link,
  Mail, KeyRound, Lock, Unlock,
} from 'lucide-react';
import { collection, getDocs, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import type { Lead, AppSettings, Page, UserProfile } from '../types';

interface SettingsProps {
  settings: AppSettings;
  leads: Lead[];
  onSettingsChange: (s: AppSettings) => void;
  onImportLeads: (leads: Lead[]) => void;
  onResetData: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  isAdmin?: boolean;
  currentUserUid?: string;
}

type Section = 'profile' | 'appearance' | 'notifications' | 'data' | 'about' | 'users' | 'security';

const ALL_PAGES: { page: Page; label: string }[] = [
  { page: 'home',      label: 'לוח בקרה' },
  { page: 'dashboard', label: 'לידים' },
  { page: 'kanban',    label: 'פייפליין' },
  { page: 'deals',     label: 'ניהול לקוחות' },
  { page: 'tasks',     label: 'משימות' },
  { page: 'content',   label: 'קריאייטיב' },
  { page: 'overview',  label: 'דוחות' },
  { page: 'ai',        label: 'עוזר AI' },
  { page: 'team',      label: 'צוות' },
];

const ACCENT_COLORS: { key: AppSettings['accentColor']; label: string; swatch: string }[] = [
  { key: 'indigo',  label: 'אינדיגו',   swatch: 'bg-indigo-600' },
  { key: 'blue',    label: 'כחול',      swatch: 'bg-blue-600'   },
  { key: 'emerald', label: 'ירוק',      swatch: 'bg-emerald-600'},
  { key: 'rose',    label: 'ורוד',      swatch: 'bg-rose-600'   },
  { key: 'violet',  label: 'סגול',      swatch: 'bg-violet-600' },
];

export default function Settings({
  settings, leads, onSettingsChange, onImportLeads, onResetData, onToast,
  isAdmin = false,
}: SettingsProps) {
  const BASE_SECTIONS: { key: Section; label: string; desc: string; Icon: React.ElementType }[] = [
    { key: 'profile',       label: 'פרופיל',        desc: 'שם משתמש ותפקיד',         Icon: User    },
    { key: 'appearance',    label: 'מראה',           desc: 'ערכת נושא ותצוגה',         Icon: Palette },
    { key: 'notifications', label: 'התראות',         desc: 'הגדרות התראות',            Icon: Bell    },
    { key: 'data',          label: 'נתונים',         desc: 'ייצוא, ייבוא ואיפוס',       Icon: Database},
    { key: 'about',         label: 'אודות',          desc: 'גרסה ומידע על המערכת',      Icon: Info    },
  ];

  const SECTIONS = isAdmin
    ? [
        ...BASE_SECTIONS,
        { key: 'users'    as Section, label: 'משתמשים', desc: 'ניהול משתמשים והרשאות', Icon: Users2  },
        { key: 'security' as Section, label: 'אבטחה',   desc: 'הגדרות גישה ואימות',    Icon: Shield  },
      ]
    : BASE_SECTIONS;

  const [section, setSection]     = useState<Section>('profile');
  const [local, setLocal]         = useState<AppSettings>({ ...settings });
  const [saved, setSaved]         = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef                   = useRef<HTMLInputElement>(null);

  // ── Security section state ──
  const [bypassAuth,        setBypassAuth]        = useState(false);
  const [bypassAuthLoading, setBypassAuthLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    getDoc(doc(db, 'app-settings', 'auth'))
      .then(snap => { if (snap.exists()) setBypassAuth(snap.data().bypassAuth === true); })
      .catch(() => {});
  }, [isAdmin]);

  const handleToggleBypassAuth = async (val: boolean) => {
    setBypassAuthLoading(true);
    try {
      await setDoc(doc(db, 'app-settings', 'auth'), { bypassAuth: val }, { merge: true });
      setBypassAuth(val);
      onToast(val ? 'כניסה ללא אימות הופעלה' : 'כניסה ללא אימות בוטלה', 'info');
    } catch {
      onToast('שגיאה בעדכון הגדרת האבטחה', 'error');
    } finally {
      setBypassAuthLoading(false);
    }
  };

  // ── Users section state ──
  const [users, setUsers]             = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUid, setEditingUid]   = useState<string | null>(null);
  const [editPages, setEditPages]     = useState<Page[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState<'admin' | 'agent'>('agent');
  const [invitePages, setInvitePages] = useState<Page[]>([...ALL_PAGES.map(p => p.page)]);
  const [inviteLink, setInviteLink]   = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (section === 'users' && isAdmin) {
      setUsersLoading(true);
      getDocs(collection(db, 'users'))
        .then(snap => {
          setUsers(snap.docs.map(d => d.data() as UserProfile));
        })
        .catch(() => onToast('שגיאה בטעינת משתמשים', 'error'))
        .finally(() => setUsersLoading(false));
    }
  }, [section, isAdmin]); // eslint-disable-line

  const handleChange = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setLocal(s => ({ ...s, [key]: val }));
    setSaved(false);
  };

  const handleSave = () => {
    onSettingsChange(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onToast('ההגדרות נשמרו ✓', 'success');
  };

  /* ── Export ── */
  const exportCSV = () => {
    const headers = ['id','company','contactName','email','phone','status','budget','source','aiScore','assignedTo','lastUpdate'];
    const rows = leads.map(l => [
      l.id, l.company, l.contactName, l.email, l.phone,
      l.status, l.budget, l.source, l.aiScore, l.assignedTo, l.lastUpdate,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    download('﻿' + csv, 'ray-leads.csv', 'text/csv;charset=utf-8;');
    onToast('CSV יוצא בהצלחה', 'success');
  };

  const exportJSON = () => {
    download(JSON.stringify({ leads, settings, exportedAt: new Date().toISOString() }, null, 2),
      'ray-backup.json', 'application/json');
    onToast('גיבוי JSON יוצא בהצלחה', 'success');
  };

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Import CSV ── */
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text  = ev.target?.result as string;
        const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
        const [header, ...rows] = lines;
        const cols = header.split(',');
        const imported: Lead[] = rows.map((row, i) => {
          const vals = row.split(',');
          const get  = (key: string) => vals[cols.indexOf(key)] ?? '';
          return {
            id:          `import-${Date.now()}-${i}`,
            company:     get('company')     || 'לא ידוע',
            contactName: get('contactName') || '',
            email:       get('email')       || '',
            phone:       get('phone')       || '',
            status:      (get('status') as Lead['status']) || 'חדש',
            budget:      parseInt(get('budget')) || 0,
            source:      (get('source') as Lead['source']) || 'אורגני',
            aiScore:     parseInt(get('aiScore')) || 0,
            assignedTo:  get('assignedTo') || local.userName,
            lastUpdate:  get('lastUpdate') || new Date().toLocaleDateString('he-IL'),
            solutions:   [],
            tasks:       [],
            notes:       [],
            futureNotes: [],
            waitingContent: false,
          };
        });
        onImportLeads(imported);
        onToast(`${imported.length} לידים יובאו בהצלחה`, 'success');
      } catch {
        onToast('שגיאה בקריאת הקובץ', 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  /* ── Reset ── */
  const handleReset = () => {
    onResetData();
    setConfirmReset(false);
    onToast('הנתונים אופסו להגדרות ברירת המחדל', 'info');
  };

  /* ── Create invite ── */
  const handleCreateInvite = async () => {
    if (!inviteEmail.trim()) { onToast('הכנס כתובת אימייל', 'error'); return; }
    setInviteLoading(true);
    try {
      const token = crypto.randomUUID();
      await setDoc(doc(db, 'invites', token), {
        token,
        email: inviteEmail.trim(),
        role: inviteRole,
        allowedPages: invitePages,
        createdAt: new Date().toISOString(),
        used: false,
        createdBy: 'admin',
      });
      const link = `${window.location.origin}?token=${token}`;
      setInviteLink(link);
      onToast('קישור הזמנה נוצר בהצלחה ✓', 'success');
    } catch {
      onToast('שגיאה ביצירת ההזמנה', 'error');
    } finally {
      setInviteLoading(false);
    }
  };

  /* ── Update user pages ── */
  const handleSaveUserPages = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { allowedPages: editPages });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, allowedPages: editPages } : u));
      setEditingUid(null);
      onToast('הרשאות עודכנו ✓', 'success');
    } catch {
      onToast('שגיאה בעדכון הרשאות', 'error');
    }
  };

  /* ── Send password reset ── */
  const handlePasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      onToast(`מייל שחזור סיסמה נשלח ל-${email}`, 'success');
    } catch {
      onToast('שגיאה בשליחת מייל שחזור', 'error');
    }
  };

  const activeLeads   = leads.filter(l => l.status === 'לקוח פעיל').length;
  const totalTasks    = leads.reduce((s, l) => s + l.tasks.length, 0);
  const overdueTasks  = leads
    .flatMap(l => l.tasks.filter(t => !t.completed))
    .filter(t => new Date(t.date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0))).length;

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6 min-h-[calc(100vh-130px)]" dir="rtl">

      {/* ── Sidebar (desktop) / Tab bar (mobile) ── */}
      <div className="w-full md:w-52 md:flex-shrink-0">
        {/* Mobile: horizontal tab strip */}
        <div className="md:hidden flex gap-1 overflow-x-auto pb-1 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm">
          {SECTIONS.map(s => {
            const Icon = s.Icon;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                  section === s.key ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Icon size={14} />
                {s.label}
              </button>
            );
          })}
        </div>
        {/* Desktop: vertical sidebar */}
        <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden sticky top-[80px]">
          <div className="px-4 py-3.5 border-b border-slate-100 bg-gradient-to-l from-neutral-50 to-white">
            <div className="font-bold text-slate-800">הגדרות</div>
            <div className="text-xs text-slate-400 mt-0.5">RAY Lead Manager</div>
          </div>
          <nav className="p-1.5 space-y-0.5">
            {SECTIONS.map(s => {
              const Icon = s.Icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    section === s.key
                      ? 'bg-black text-white font-medium shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={15} />
                  <div className="text-right flex-1">
                    <div className="font-medium leading-none">{s.label}</div>
                  </div>
                  {section !== s.key && <ChevronLeft size={12} className="text-slate-300" />}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 space-y-4">

        {/* ── PROFILE ── */}
        {section === 'profile' && (
          <>
            <SectionHeader icon={<User size={18} />} title="פרופיל משתמש" desc="שם תצוגה ואיניציאלים" />
            <Card>
              {/* Avatar */}
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-100">
                <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center text-white text-2xl font-bold shadow-md select-none">
                  {local.userInitials || '?'}
                </div>
                <div className="flex-1 text-right">
                  <div className="font-bold text-slate-800 text-lg">{local.userName || 'שם משתמש'}</div>
                  <div className="text-sm text-slate-400">{local.companyName}</div>
                  <div className="mt-1">
                    <span className="text-xs bg-neutral-100 text-neutral-700 px-2.5 py-0.5 rounded-full font-medium">מנהל מערכת</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <FormField label="שם מלא">
                  <input
                    type="text"
                    value={local.userName}
                    onChange={e => handleChange('userName', e.target.value)}
                    className={inputCls}
                    placeholder="הכנס שם מלא"
                  />
                </FormField>
                <FormField label="ראשי תיבות (לאוואטר)">
                  <input
                    type="text"
                    value={local.userInitials}
                    onChange={e => handleChange('userInitials', e.target.value.slice(0, 2).toUpperCase())}
                    className={inputCls + ' w-20 text-center'}
                    placeholder="AA"
                    maxLength={2}
                  />
                </FormField>
                <FormField label="שם החברה">
                  <input
                    type="text"
                    value={local.companyName}
                    onChange={e => handleChange('companyName', e.target.value)}
                    className={inputCls}
                    placeholder="RAY Digital Agency"
                  />
                </FormField>
              </div>
            </Card>
          </>
        )}

        {/* ── APPEARANCE ── */}
        {section === 'appearance' && (
          <>
            <SectionHeader icon={<Palette size={18} />} title="מראה ותצוגה" desc="התאם את הממשק לטעמך" />
            <Card>
              <FormField label="מצב תצוגה קומפקטי">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">שורות צפופות יותר בטבלאות</span>
                  <Toggle
                    value={local.compactMode}
                    onChange={v => handleChange('compactMode', v)}
                  />
                </div>
              </FormField>
            </Card>

            <Card>
              <div className="font-semibold text-slate-700 mb-3 text-right">צבע ראשי</div>
              <div className="flex gap-3 flex-wrap justify-end">
                {ACCENT_COLORS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => handleChange('accentColor', c.key)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                      local.accentColor === c.key
                        ? 'border-slate-700 shadow-md scale-105'
                        : 'border-transparent hover:border-slate-200'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl ${c.swatch} shadow-sm`} />
                    <span className="text-xs text-slate-600">{c.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3 text-right">שינוי הצבע יכנס לתוקף בגרסה הבאה</p>
            </Card>

            <Card>
              <div className="font-semibold text-slate-700 mb-3 text-right">עמוד ברירת מחדל</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'dashboard', label: 'לידים' },
                  { key: 'overview',  label: 'דאשבורד' },
                  { key: 'kanban',    label: 'פייפליין' },
                ] as { key: Page; label: string }[]).map(p => (
                  <button
                    key={p.key}
                    onClick={() => handleChange('defaultPage', p.key)}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                      local.defaultPage === p.key
                        ? 'border-black bg-neutral-50 text-black font-semibold'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ── NOTIFICATIONS ── */}
        {section === 'notifications' && (
          <>
            <SectionHeader icon={<Bell size={18} />} title="התראות" desc="שלוט על אילו התראות להציג" />
            <Card>
              <div className="space-y-5">
                <NotifRow
                  icon={<AlertTriangle size={16} className="text-red-500" />}
                  title="התראות משימות פגות תוקף"
                  desc="הצג badge אדום בדף המשימות"
                  value={local.showOverduePopup}
                  onChange={v => handleChange('showOverduePopup', v)}
                />
                <div className="border-t border-slate-100 pt-5">
                  <div className="flex items-start gap-3 justify-end">
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-400">שליחת מייל יומי</div>
                      <div className="text-xs text-slate-400 mt-0.5">סיכום יומי במייל</div>
                    </div>
                    <div className="flex-shrink-0">
                      <div className="w-10 h-6 bg-slate-200 rounded-full cursor-not-allowed opacity-50" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 text-right">🔜 בקרוב — דורש אינטגרציית מייל</p>
                </div>
              </div>
            </Card>

            {/* Stats summary */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {[
                { label: 'לקוחות פעילים', value: activeLeads, color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
                { label: 'סה"כ משימות', value: totalTasks, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-100' },
                { label: 'משימות פגות תוקף', value: overdueTasks, color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
              ].map(s => (
                <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
                  <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-sm text-slate-600 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── DATA ── */}
        {section === 'data' && (
          <>
            <SectionHeader icon={<Database size={18} />} title="ניהול נתונים" desc="ייצוא, ייבוא ואיפוס נתונים" />

            {/* Export */}
            <Card>
              <div className="font-semibold text-slate-700 mb-1 text-right flex items-center gap-2 justify-end">
                <span>ייצוא נתונים</span>
                <Download size={15} className="text-slate-400" />
              </div>
              <p className="text-xs text-slate-400 mb-4 text-right">
                הורד עותק של הנתונים שלך
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={exportCSV}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <span>📊</span> ייצא CSV
                </button>
                <button
                  onClick={exportJSON}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <span>💾</span> גיבוי JSON מלא
                </button>
              </div>
            </Card>

            {/* Import */}
            <Card>
              <div className="font-semibold text-slate-700 mb-1 text-right flex items-center gap-2 justify-end">
                <span>ייבוא לידים מ-CSV</span>
                <Upload size={15} className="text-slate-400" />
              </div>
              <p className="text-xs text-slate-400 mb-3 text-right">
                הקובץ צריך לכלול: company, contactName, email, phone, status, budget, source
              </p>
              <div
                className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-neutral-400 hover:bg-neutral-50 transition-all"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={24} className="mx-auto mb-2 text-slate-300" />
                <div className="text-sm font-medium text-slate-600">לחץ לבחירת קובץ CSV</div>
                <div className="text-xs text-slate-400 mt-1">או גרור קובץ לכאן</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
            </Card>

            {/* Danger Zone */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-5">
              <div className="flex items-center gap-2 justify-end mb-3">
                <span className="font-bold text-red-700">אזור מסוכן</span>
                <Shield size={16} className="text-red-500" />
              </div>
              <p className="text-sm text-red-600 text-right mb-4">
                איפוס הנתונים ישחזר את כל הלידים לנתוני ברירת המחדל. לא ניתן לבטל פעולה זו.
              </p>
              {!confirmReset ? (
                <div className="flex justify-end">
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-red-300 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 transition-colors"
                  >
                    <RefreshCw size={14} />
                    אפס לנתוני ברירת מחדל
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="text-sm font-semibold text-red-700 text-right">⚠️ האם אתה בטוח? פעולה זו בלתי הפיכה!</div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setConfirmReset(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                      ביטול
                    </button>
                    <button onClick={handleReset} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors">
                      כן, אפס הכל
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ABOUT ── */}
        {section === 'about' && (
          <>
            <SectionHeader icon={<Info size={18} />} title="אודות RAY Lead Manager" desc="מידע על המערכת" />
            <Card>
              <div className="flex items-center gap-4 mb-6">
                <svg width="56" height="56" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 rounded-2xl shadow-md">
                  <rect width="100" height="100" rx="16" fill="black"/>
                  <rect x="22" y="62" width="56" height="8" rx="4" fill="white"/>
                  <rect x="22" y="48" width="40" height="7" rx="3.5" fill="white"/>
                  <rect x="22" y="30" width="56" height="12" rx="6" fill="white"/>
                  <rect x="52" y="48" width="26" height="22" rx="4" fill="white"/>
                </svg>
                <div className="text-right flex-1">
                  <div className="font-black text-slate-900 text-xl tracking-tight">RAY</div>
                  <div className="font-semibold text-slate-700">Lead Manager</div>
                  <div className="text-sm text-slate-400">RAY Digital Agency</div>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'גרסה',        value: 'v2.4.0',         icon: <Zap size={14} /> },
                  { label: 'מסד נתונים',  value: 'Firebase Firestore', icon: <Database size={14} /> },
                  { label: 'ממשק',        value: 'React + TypeScript + Tailwind', icon: <Monitor size={14} /> },
                  { label: 'AI',          value: 'Claude (Anthropic)', icon: <SparklesIcon size={14} /> },
                  { label: 'אחסון',       value: 'Vercel Edge Network', icon: <Globe size={14} /> },
                  { label: 'עיצוב',       value: 'RTL Hebrew, Dark/Light', icon: <Moon size={14} /> },
                ].map(({ label, value, icon }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                    <div className="text-sm font-medium text-slate-700">{value}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span>{label}</span>
                      <span className="text-slate-300">{icon}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="bg-black rounded-xl p-5 text-white">
              <div className="font-bold text-lg mb-1 text-right">סטטיסטיקות המערכת</div>
              <div className="grid grid-cols-3 gap-3 md:gap-4 mt-4">
                {[
                  { label: 'לידים',   value: leads.length },
                  { label: 'משימות',  value: totalTasks },
                  { label: 'הערות',   value: leads.reduce((s, l) => s + l.notes.length, 0) },
                ].map(s => (
                  <div key={s.label} className="text-center bg-white/10 rounded-xl py-3">
                    <div className="text-2xl font-bold">{s.value}</div>
                    <div className="text-xs text-neutral-400 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── USERS (admin only) ── */}
        {section === 'users' && isAdmin && (
          <>
            <SectionHeader icon={<Users2 size={18} />} title="ניהול משתמשים" desc="הרשאות, הזמנות ואיפוס סיסמאות" />

            {/* Create Invite */}
            <Card>
              <div className="font-semibold text-slate-700 mb-4 text-right flex items-center gap-2 justify-end">
                <span>יצירת קישור הזמנה</span>
                <Link size={15} className="text-slate-400" />
              </div>
              <div className="space-y-4">
                <FormField label="אימייל מוזמן">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className={inputCls}
                    placeholder="user@example.com"
                    dir="ltr"
                  />
                </FormField>
                <FormField label="תפקיד">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as 'admin' | 'agent')}
                    className={inputCls}
                  >
                    <option value="agent">סוכן</option>
                    <option value="admin">מנהל</option>
                  </select>
                </FormField>
                <div>
                  <div className="text-sm font-medium text-slate-700 mb-2 text-right">עמודים מורשים</div>
                  <div className="grid grid-cols-3 gap-2">
                    {ALL_PAGES.map(({ page, label }) => (
                      <label key={page} className="flex items-center gap-2 cursor-pointer select-none justify-end">
                        <span className="text-xs text-slate-600">{label}</span>
                        <input
                          type="checkbox"
                          checked={invitePages.includes(page)}
                          onChange={e => {
                            if (e.target.checked) setInvitePages(prev => [...prev, page]);
                            else setInvitePages(prev => prev.filter(p => p !== page));
                          }}
                          className="w-4 h-4 rounded accent-indigo-600"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleCreateInvite}
                    disabled={inviteLoading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    <Link size={14} />
                    {inviteLoading ? 'יוצר...' : 'צור קישור הזמנה'}
                  </button>
                </div>

                {inviteLink && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-indigo-700 mb-2 text-right">קישור הזמנה:</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { navigator.clipboard.writeText(inviteLink); onToast('הקישור הועתק ✓', 'success'); }}
                        className="flex-shrink-0 p-2 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                        title="העתק"
                      >
                        <Copy size={14} className="text-indigo-600" />
                      </button>
                      <input
                        readOnly
                        value={inviteLink}
                        className="flex-1 text-xs bg-white border border-indigo-200 rounded-lg px-3 py-2 text-indigo-800 truncate"
                        dir="ltr"
                        onClick={e => (e.target as HTMLInputElement).select()}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Users list */}
            <Card>
              <div className="font-semibold text-slate-700 mb-4 text-right flex items-center gap-2 justify-end">
                <span>משתמשים רשומים</span>
                <Users2 size={15} className="text-slate-400" />
              </div>

              {usersLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <p className="text-sm text-slate-400 text-right py-4">אין משתמשים רשומים עדיין</p>
              ) : (
                <div className="space-y-3">
                  {users.map(u => (
                    <div key={u.uid} className="border border-slate-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePasswordReset(u.email)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 border border-slate-200 hover:border-indigo-300 rounded-lg px-2.5 py-1.5 transition-colors"
                            title="שלח מייל איפוס סיסמה"
                          >
                            <KeyRound size={12} />
                            <span>שחזור סיסמה</span>
                          </button>
                          <button
                            onClick={() => {
                              if (editingUid === u.uid) {
                                setEditingUid(null);
                              } else {
                                setEditingUid(u.uid);
                                setEditPages([...u.allowedPages]);
                              }
                            }}
                            className="flex items-center gap-1 text-xs text-white bg-slate-700 hover:bg-slate-600 rounded-lg px-2.5 py-1.5 transition-colors"
                          >
                            {editingUid === u.uid ? 'ביטול' : 'ערוך הרשאות'}
                          </button>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {u.role === 'admin' ? 'מנהל' : 'סוכן'}
                            </span>
                            <p className="text-sm font-semibold text-slate-800">{u.firstName} {u.lastName}</p>
                          </div>
                          <div className="flex items-center gap-1 justify-end mt-0.5">
                            <Mail size={10} className="text-slate-400" />
                            <p className="text-xs text-slate-400" dir="ltr">{u.email}</p>
                          </div>
                        </div>
                      </div>

                      {editingUid === u.uid && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="text-xs font-semibold text-slate-600 mb-2 text-right">עמודים מורשים:</div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            {ALL_PAGES.map(({ page, label }) => (
                              <label key={page} className="flex items-center gap-2 cursor-pointer select-none justify-end">
                                <span className="text-xs text-slate-600">{label}</span>
                                <input
                                  type="checkbox"
                                  checked={editPages.includes(page)}
                                  onChange={e => {
                                    if (e.target.checked) setEditPages(prev => [...prev, page]);
                                    else setEditPages(prev => prev.filter(p => p !== page));
                                  }}
                                  className="w-4 h-4 rounded accent-indigo-600"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleSaveUserPages(u.uid)}
                              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              <CheckCircle2 size={12} />
                              שמור הרשאות
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}

        {/* ── SECURITY (admin only) ── */}
        {section === 'security' && isAdmin && (
          <>
            <SectionHeader icon={<Shield size={18} />} title="אבטחה וגישה" desc="שליטה על אימות וכניסת משתמשים" />

            <Card>
              <div className="text-right mb-5">
                <p className="font-semibold text-slate-700 mb-1">כניסה ללא אימות</p>
                <p className="text-sm text-slate-400">כשמופעל, כל אחד שיגיע לאפליקציה יוכל להיכנס ישירות מבלי להזין שם משתמש וסיסמה</p>
              </div>

              <div className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${bypassAuth ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                <button
                  onClick={() => handleToggleBypassAuth(!bypassAuth)}
                  disabled={bypassAuthLoading}
                  className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${bypassAuth ? 'bg-amber-400' : 'bg-slate-300'} ${bypassAuthLoading ? 'opacity-50' : ''}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${bypassAuth ? 'left-6' : 'left-0.5'}`} />
                </button>
                <div className="text-right flex items-center gap-3">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">
                      {bypassAuth ? 'כניסה ללא אימות — פעיל' : 'כניסה ללא אימות — כבוי'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {bypassAuth ? 'המערכת פתוחה לכולם ללא התחברות' : 'נדרש אימות עם שם משתמש וסיסמה'}
                    </p>
                  </div>
                  {bypassAuth
                    ? <Unlock size={20} className="text-amber-500 flex-shrink-0" />
                    : <Lock    size={20} className="text-emerald-500 flex-shrink-0" />
                  }
                </div>
              </div>

              {bypassAuth && (
                <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-right">
                  <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    <strong>אזהרה:</strong> כניסה ללא אימות מאפשרת לכל מי שיש לו את קישור האפליקציה לגשת לכל הנתונים. השתמש בזה רק בסביבת פיתוח או רשת פנימית מאובטחת.
                  </p>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ── Save Button ── */}
        {section !== 'data' && section !== 'about' && section !== 'users' && section !== 'security' && (
          <div className="flex justify-start">
            <button
              onClick={handleSave}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-sm ${
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-black hover:bg-neutral-800 text-white'
              }`}
            >
              {saved ? <><CheckCircle2 size={15} />נשמר!</> : <><Save size={15} />שמור שינויים</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */
function SectionHeader({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 justify-end">
      <div className="text-right">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-700">
        {icon}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      {children}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">{children}</div>
      <label className="text-sm font-medium text-slate-700 text-right min-w-[120px]">{label}</label>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        value ? 'bg-black' : 'bg-slate-200'
      }`}
    >
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
        value ? 'left-5' : 'left-0.5'
      }`} />
    </button>
  );
}

function NotifRow({ icon, title, desc, value, onChange }: {
  icon: React.ReactNode; title: string; desc: string;
  value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 justify-between">
      <Toggle value={value} onChange={onChange} />
      <div className="flex-1 text-right">
        <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 justify-end">
          {title}
          {icon}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:border-neutral-400 transition-all';

// SparklesIcon used in about section
function SparklesIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
