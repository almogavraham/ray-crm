import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import {
  Sparkles, Copy, Check, Loader2, Layers,
  FileText, Image, CalendarDays, Target, RefreshCw, Download,
  Plus, Trash2, ChevronDown, Upload, X, Eye, FolderOpen,
  Building2, Folder, Search, Bot, AlertCircle,
} from 'lucide-react';
import { getApiKey, getOpenAiKey } from '../lib/apiKey';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ClientBrief {
  company: string;
  niche: string;
  targetAudience: string;
  demographics: string;
  painPoints: string;
  usp: string;
  brandVoice: 'professional' | 'fun' | 'bold' | 'warm';
  goals: string[];
  language: 'he' | 'en';
}

interface ProjectFile {
  id: string;
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  analysis?: string;
  uploadedAt: string;
}

interface ContentProject {
  id: string;
  clientId: string;
  name: string;
  description: string;
  files: ProjectFile[];
  createdAt: string;
}

interface ContentClient {
  id: string;
  brief: ClientBrief;
  projects: string[]; // project ids
  createdAt: string;
}

type TabId = 'posts' | 'visuals' | 'calendar' | 'ads';
interface SectionState { content: string; loading: boolean; done: boolean }
const EMPTY: SectionState = { content: '', loading: false, done: false };
const EMPTY_SECTIONS: Record<TabId, SectionState> = {
  posts: { ...EMPTY }, visuals: { ...EMPTY }, calendar: { ...EMPTY }, ads: { ...EMPTY },
};

/* ─── Constants ──────────────────────────────────────────────────────────── */
const VOICE_OPTIONS = [
  { id: 'professional' as const, label: 'מקצועי', emoji: '💼' },
  { id: 'fun'          as const, label: 'כיפי',   emoji: '🎉' },
  { id: 'bold'         as const, label: 'נועז',   emoji: '🔥' },
  { id: 'warm'         as const, label: 'חמים',   emoji: '🤝' },
];
const GOAL_OPTIONS = [
  { id: 'awareness', label: 'מודעות' },
  { id: 'leads',     label: 'לידים'  },
  { id: 'sales',     label: 'מכירות' },
];
const TABS = [
  { id: 'posts'    as TabId, label: 'פוסטים',   icon: FileText },
  { id: 'visuals'  as TabId, label: 'ויזואל',   icon: Image },
  { id: 'calendar' as TabId, label: 'לוח תוכן', icon: CalendarDays },
  { id: 'ads'      as TabId, label: 'פרסומות',  icon: Target },
];
const EMPTY_BRIEF: ClientBrief = {
  company: '', niche: '', targetAudience: '', demographics: '',
  painPoints: '', usp: '', brandVoice: 'professional', goals: ['leads'], language: 'he',
};
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml,application/pdf';
const MAX_FILE_MB = 8;

/* ─── Prompt builders ────────────────────────────────────────────────────── */
function ctx(b: ClientBrief, filesContext: string) {
  return `Company: ${b.company} | Niche: ${b.niche} | Audience: ${b.targetAudience || 'general'} | Demographics: ${b.demographics || 'all ages'} | Pain points: ${b.painPoints || 'not specified'} | USP: ${b.usp || 'quality service'} | Voice: ${b.brandVoice} | Goals: ${b.goals.join(', ') || 'awareness'} | Language: ${b.language === 'he' ? 'Hebrew' : 'English'}${filesContext ? `\n\nBrand Assets Analysis:\n${filesContext}` : ''}`;
}
function postsPrompt(b: ClientBrief, fc: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create 3 Facebook posts for: ${ctx(b, fc)}\n\nFormat exactly:\n═══ POST 1 — SHORT & PUNCHY ═══\n[1-3 bold lines, strong hook]\n#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5\n📍 Best time: [day + time]\n\n═══ POST 2 — STORYTELLING ═══\n[Problem → journey → solution → CTA, 6-8 lines]\n#hashtag1 #hashtag2 #hashtag3\n📍 Best time: [day + time]\n\n═══ POST 3 — PAS FORMAT ═══\n[Problem → Agitate → Solution → CTA, 6-8 lines]\n#hashtag1 #hashtag2 #hashtag3\n📍 Best time: [day + time]`;
}
function visualsPrompt(b: ClientBrief, fc: string) {
  const lang = b.language === 'he' ? 'Descriptions in Hebrew, DALL-E prompts in English.' : 'Write entirely in English.';
  return `${lang} Create visual content brief for: ${ctx(b, fc)}\n\nFormat exactly:\n═══ IMAGE 1 — HERO SHOT ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt, style, lighting, mood]"\nFormat: Square 1:1\n\n═══ IMAGE 2 — SOCIAL PROOF ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt]"\nFormat: Portrait 4:5\n\n═══ IMAGE 3 — PROBLEM/SOLUTION ═══\nConcept: [scene description]\nDALL-E prompt: "[detailed English prompt]"\nFormat: Square 1:1\n\n═══ 30-SECOND REEL STORYBOARD ═══\nHook 0-3s: [visual + text overlay]\nScene 1 (3-10s): [action + narration]\nScene 2 (10-20s): [action + narration]\nCTA 20-30s: [closing frame + CTA text]\nMusic: [mood/genre]`;
}
function calendarPrompt(b: ClientBrief, fc: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create a 30-day social media calendar for: ${ctx(b, fc)}\nMix: 40% educational, 30% promotional, 20% engagement, 10% video.\n\nFormat exactly:\n═══ WEEK 1 — [Theme] ═══\nMon: 📚 [Educational topic]\nWed: 🎯 [Promo angle]\nFri: 💬 [Engagement question/poll]\nSun: 🎬 [Reel idea]\n\n═══ WEEK 2 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ WEEK 3 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ WEEK 4 — [Theme] ═══\nMon: 📚 [topic] | Wed: 🎯 [angle] | Fri: 💬 [question] | Sun: 🎬 [idea]\n\n═══ ALGORITHM TIPS ═══\n• [tip 1]\n• [tip 2]\n• [tip 3]`;
}
function adsPrompt(b: ClientBrief, fc: string) {
  const lang = b.language === 'he' ? 'Write entirely in Hebrew.' : 'Write entirely in English.';
  return `${lang} Create Facebook ad strategy for: ${ctx(b, fc)}\n\nFormat exactly:\n═══ TOF — AWARENESS ═══\nObjective: [campaign objective]\nDaily budget: [ILS amount]\nAudiences: [3 specific interests/behaviors]\nAd format: [format]\nCopy sample: [25-word hook]\nKPIs: [metrics]\n\n═══ MOF — CONSIDERATION ═══\nObjective: [objective]\nDaily budget: [ILS amount]\nAudiences: [retargeting + lookalike]\nAd format: [format]\nCopy sample: [25-word value-focused copy]\nKPIs: [metrics]\n\n═══ BOF — CONVERSION ═══\nObjective: [objective]\nDaily budget: [ILS amount]\nAudiences: [hot retarget]\nAd format: [format]\nCopy sample: [25-word urgency copy]\nKPIs: [metrics]\n\n═══ BUDGET SPLIT ═══\nTOF [%] | MOF [%] | BOF [%]\nMonthly total: [ILS] | Expected CPL: [range]`;
}

/* ─── Utility: file → base64 ─────────────────────────────────────────────── */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

/* ─── CopyBtn ────────────────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${copied ? 'border-green-400 bg-green-50 text-green-600' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500'}`}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'הועתק!' : 'העתק'}
    </button>
  );
}

/* ─── SectionOutput ──────────────────────────────────────────────────────── */
function SectionOutput({ content, loading }: { content: string; loading: boolean }) {
  if (!content && loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
      <Loader2 size={28} className="animate-spin text-black" />
      <span className="text-sm font-medium">מייצר תוכן...</span>
    </div>
  );
  if (!content) return null;
  const blocks = content.split(/═{3,}[^═\n]*═{3,}/g);
  const titles = [...content.matchAll(/═{3,}([^═\n]+)═{3,}/g)].map(m => m[1].trim());
  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        return (
          <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {titles[i - 1] && <div className="px-4 py-2.5 bg-neutral-900"><span className="text-white text-sm font-bold">{titles[i - 1]}</span></div>}
            <div className="px-4 py-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans text-right" dir="rtl">{trimmed}</pre>
              <div className="mt-3 flex justify-start"><CopyBtn text={trimmed} /></div>
            </div>
          </div>
        );
      }).filter(Boolean)}
      {loading && <div className="flex items-center gap-2 text-slate-400 text-xs pb-2"><Loader2 size={12} className="animate-spin" /><span>ממשיך לייצר...</span></div>}
    </div>
  );
}

/* ─── VisualsOutput ──────────────────────────────────────────────────────── */
interface ImgState { url?: string; loading: boolean; error?: string }
function VisualsOutput({ content, sectionLoading }: { content: string; sectionLoading: boolean }) {
  const [images, setImages] = useState<Record<number, ImgState>>({});
  const openaiKey = getOpenAiKey();
  const blocks = useMemo(() => {
    if (!content) return [];
    const parts = content.split(/═{3,}[^═\n]*═{3,}/g);
    const titles = [...content.matchAll(/═{3,}([^═\n]+)═{3,}/g)].map(m => m[1].trim());
    let pi = 0;
    return parts.map((block, i) => {
      const trimmed = block.trim();
      if (!trimmed) return null;
      const title = titles[i - 1] ?? '';
      const isImageBlock = /DALL-E prompt:/i.test(trimmed);
      const promptMatch = trimmed.match(/DALL-E prompt:\s*"([^"]+)"/i);
      const promptText = promptMatch?.[1] ?? '';
      const idx = isImageBlock ? pi++ : -1;
      return { trimmed, title, isImageBlock, promptText, idx };
    }).filter(Boolean) as { trimmed: string; title: string; isImageBlock: boolean; promptText: string; idx: number }[];
  }, [content]);

  const generate = async (idx: number, prompt: string) => {
    if (!openaiKey) return;
    setImages(prev => ({ ...prev, [idx]: { loading: true } }));
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `שגיאה ${res.status}`);
      setImages(prev => ({ ...prev, [idx]: { url: data.data[0].url, loading: false } }));
    } catch (err) {
      setImages(prev => ({ ...prev, [idx]: { loading: false, error: err instanceof Error ? err.message : String(err) } }));
    }
  };
  if (!content && sectionLoading) return <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400"><Loader2 size={28} className="animate-spin text-black" /><span className="text-sm font-medium">מייצר תוכן...</span></div>;
  if (!content) return null;
  return (
    <div className="space-y-3" dir="rtl">
      {blocks.map(({ trimmed, title, isImageBlock, promptText, idx }) => (
        <div key={idx >= 0 ? `img-${idx}` : trimmed.slice(0, 20)} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {title && <div className="px-4 py-2.5 bg-neutral-900"><span className="text-white text-sm font-bold">{title}</span></div>}
          <div className="px-4 py-4 space-y-4">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans text-right" dir="rtl">{trimmed}</pre>
            {isImageBlock && !sectionLoading && (
              <div className="border-t border-slate-100 pt-4">
                {!openaiKey ? (
                  <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-right">💡 הוסף <strong>VITE_OPENAI_API_KEY</strong> ל-Vercel לייצור תמונות</div>
                ) : images[idx]?.url ? (
                  <div className="space-y-3">
                    <img src={images[idx].url} alt="DALL-E" className="w-full rounded-xl border border-slate-200 shadow-sm" />
                    <div className="flex gap-2">
                      <a href={images[idx].url} target="_blank" rel="noreferrer" download className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs font-semibold rounded-lg hover:bg-neutral-800"><Download size={12} /> הורד</a>
                      <button onClick={() => generate(idx, promptText)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-slate-50"><RefreshCw size={12} /> צור מחדש</button>
                    </div>
                  </div>
                ) : images[idx]?.error ? (
                  <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-right">⚠️ {images[idx].error} <button onClick={() => generate(idx, promptText)} className="underline ml-2">נסה שוב</button></div>
                ) : (
                  <button onClick={() => generate(idx, promptText)} disabled={images[idx]?.loading} className="flex items-center gap-2 px-4 py-2.5 bg-black hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl">
                    {images[idx]?.loading ? <><Loader2 size={13} className="animate-spin" /> מייצר...</> : <><Image size={13} /> צור תמונה עם DALL-E 3</>}
                  </button>
                )}
              </div>
            )}
            <div className="flex justify-start"><CopyBtn text={trimmed} /></div>
          </div>
        </div>
      ))}
      {sectionLoading && <div className="flex items-center gap-2 text-slate-400 text-xs pb-2"><Loader2 size={12} className="animate-spin" /><span>ממשיך לייצר...</span></div>}
    </div>
  );
}

/* ─── FileCard ───────────────────────────────────────────────────────────── */
function FileCard({ file, onDelete, onAnalyze, analyzing }: {
  file: ProjectFile;
  onDelete: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-start gap-2">
        {isImage(file.mimeType) ? (
          <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name}
            className="w-12 h-12 object-cover rounded-lg border border-slate-200 flex-shrink-0 cursor-pointer"
            onClick={() => setPreview(true)} />
        ) : (
          <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <FileText size={20} className="text-slate-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700 truncate text-right">{file.name}</p>
          <p className="text-[10px] text-slate-400 text-right">{formatBytes(file.size)}</p>
          {file.analysis && (
            <p className="text-[10px] text-emerald-600 mt-0.5 text-right">✓ נותח על ידי AI</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {isImage(file.mimeType) && (
            <button onClick={() => setPreview(true)} className="text-slate-300 hover:text-slate-600 transition-colors">
              <Eye size={13} />
            </button>
          )}
          <button onClick={onDelete} className="text-slate-300 hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Analysis section */}
      {!file.analysis ? (
        <button onClick={onAnalyze} disabled={analyzing}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-indigo-300 text-indigo-600 text-[10px] font-semibold rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50">
          {analyzing ? <><Loader2 size={10} className="animate-spin" /> מנתח...</> : <><Bot size={10} /> נתח עם AI</>}
        </button>
      ) : (
        <details className="mt-2">
          <summary className="text-[10px] text-indigo-600 cursor-pointer hover:text-indigo-800 text-right">הצג ניתוח AI ▾</summary>
          <p className="text-[10px] text-slate-600 mt-1 leading-relaxed bg-slate-50 rounded-lg p-2 text-right">{file.analysis}</p>
        </details>
      )}

      {/* Image preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name}
            className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setPreview(false)} className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/70"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function ContentHub() {
  // ── Clients & Projects (Firestore) ─────────────────────────────────────
  const [clients,        setClients]        = useState<ContentClient[]>([]);
  const [projects,       setProjects]       = useState<ContentProject[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedProject,setSelectedProject]= useState<string | null>(null);
  const [showNewClient,  setShowNewClient]  = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newClientName,  setNewClientName]  = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [clientSearch,   setClientSearch]   = useState('');

  // ── File uploads ────────────────────────────────────────────────────────
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Content generation ──────────────────────────────────────────────────
  const [brief,     setBrief]     = useState<ClientBrief>(EMPTY_BRIEF);
  const [sections,  setSections]  = useState<Record<TabId, SectionState>>(EMPTY_SECTIONS);
  const [activeTab, setActiveTab] = useState<TabId>('posts');
  const [generating,setGenerating]= useState(false);
  const abortRef = useRef(false);

  // ── Firestore listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'content-clients'), snap =>
      setClients(snap.docs.map(d => d.data() as ContentClient))
    );
    const u2 = onSnapshot(collection(db, 'content-projects'), snap =>
      setProjects(snap.docs.map(d => d.data() as ContentProject))
    );
    return () => { u1(); u2(); };
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const client  = clients.find(c => c.id === selectedClient) ?? null;
  const project = projects.find(p => p.id === selectedProject) ?? null;
  const clientProjects = projects.filter(p => p.clientId === selectedClient);
  const files   = project?.files ?? [];

  const filesContext = files
    .filter(f => f.analysis)
    .map(f => `[${f.name}]: ${f.analysis}`)
    .join('\n');

  const filteredClients = clients.filter(c =>
    c.brief.company.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // ── Sync brief from selected client ─────────────────────────────────────
  useEffect(() => {
    if (client) setBrief(client.brief);
  }, [selectedClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Client CRUD ─────────────────────────────────────────────────────────
  const createClient = async () => {
    if (!newClientName.trim()) return;
    const id = Date.now().toString();
    const newClient: ContentClient = {
      id,
      brief: { ...EMPTY_BRIEF, company: newClientName.trim() },
      projects: [],
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'content-clients', id), newClient).catch(console.error);
    setSelectedClient(id);
    setSelectedProject(null);
    setNewClientName('');
    setShowNewClient(false);
    setBrief(newClient.brief);
  };

  const deleteClient = async (id: string) => {
    await deleteDoc(doc(db, 'content-clients', id)).catch(console.error);
    // delete all projects of this client
    projects.filter(p => p.clientId === id).forEach(p =>
      deleteDoc(doc(db, 'content-projects', p.id)).catch(console.error)
    );
    if (selectedClient === id) { setSelectedClient(null); setSelectedProject(null); }
  };

  // Auto-save brief changes to Firestore
  const saveBrief = useCallback(async (updated: ClientBrief) => {
    if (!client) return;
    const updatedClient = { ...client, brief: updated };
    await setDoc(doc(db, 'content-clients', client.id), updatedClient).catch(console.error);
  }, [client]);

  const updateBrief = (patch: Partial<ClientBrief>) => {
    const updated = { ...brief, ...patch };
    setBrief(updated);
    saveBrief(updated);
  };

  // ── Project CRUD ─────────────────────────────────────────────────────────
  const createProject = async () => {
    if (!newProjectName.trim() || !selectedClient) return;
    const id = Date.now().toString();
    const newProject: ContentProject = {
      id,
      clientId: selectedClient,
      name: newProjectName.trim(),
      description: '',
      files: [],
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'content-projects', id), newProject).catch(console.error);
    setSelectedProject(id);
    setNewProjectName('');
    setShowNewProject(false);
  };

  const deleteProject = async (id: string) => {
    await deleteDoc(doc(db, 'content-projects', id)).catch(console.error);
    if (selectedProject === id) setSelectedProject(null);
  };

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !project) return;
    const apiKey = getApiKey();

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) { alert(`${file.name} גדול מ-${MAX_FILE_MB}MB`); continue; }
      try {
        const base64 = await fileToBase64(file);
        const pf: ProjectFile = {
          id:         Date.now().toString() + Math.random(),
          name:       file.name,
          mimeType:   file.type,
          base64,
          size:       file.size,
          uploadedAt: new Date().toISOString(),
        };

        // Auto-analyze images if API key available
        let analysis: string | undefined;
        if (isImage(file.type) && apiKey) {
          try {
            const client2 = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
            const resp = await client2.messages.create({
              model: 'claude-opus-4-6',
              max_tokens: 400,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } },
                  { type: 'text', text: 'תאר תמונה זו בקצרה מנקודת מבט שיווקית: מה היא מציגה, צבעים, סגנון, וכיצד ניתן להשתמש בה בקמפיין דיגיטלי? ענה בעברית, עד 3 משפטים.' },
                ],
              }],
            });
            analysis = resp.content[0].type === 'text' ? resp.content[0].text : undefined;
          } catch { /* analysis optional */ }
        }

        const updatedProject: ContentProject = {
          ...project,
          files: [...project.files, { ...pf, analysis }],
        };
        await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
      } catch { alert(`שגיאה בהעלאת ${file.name}`); }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const deleteFile = async (fileId: string) => {
    if (!project) return;
    const updatedProject = { ...project, files: project.files.filter(f => f.id !== fileId) };
    await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
  };

  const analyzeFile = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file || !project) return;
    const apiKey = getApiKey();
    if (!apiKey || !isImage(file.mimeType)) return;
    setAnalyzingId(fileId);
    try {
      const client2 = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const resp = await client2.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: file.base64 } },
            { type: 'text', text: 'תאר תמונה זו בקצרה מנקודת מבט שיווקית: מה היא מציגה, צבעים, סגנון, וכיצד ניתן להשתמש בה בקמפיין דיגיטלי? ענה בעברית, עד 3 משפטים.' },
          ],
        }],
      });
      const analysis = resp.content[0].type === 'text' ? resp.content[0].text : '';
      const updatedProject = { ...project, files: project.files.map(f => f.id === fileId ? { ...f, analysis } : f) };
      await setDoc(doc(db, 'content-projects', project.id), updatedProject).catch(console.error);
    } catch (e) { console.error(e); }
    setAnalyzingId(null);
  };

  // ── Content generation ───────────────────────────────────────────────────
  const updateSection = useCallback((tab: TabId, patch: Partial<SectionState>) => {
    setSections(prev => ({ ...prev, [tab]: { ...prev[tab], ...patch } }));
  }, []);

  const runStream = useCallback(async (client2: Anthropic, tab: TabId, prompt: string) => {
    updateSection(tab, { content: '', loading: true, done: false });
    try {
      let text = '';
      const stream = await client2.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 1500,
        system: [{ type: 'text' as const, text: 'You are a world-class digital marketing strategist. Output structured, immediately usable content. Follow format instructions exactly.', cache_control: { type: 'ephemeral' as const } }],
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (abortRef.current) { stream.abort(); break; }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          updateSection(tab, { content: text });
        }
      }
      updateSection(tab, { loading: false, done: true });
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      updateSection(tab, { content: `⚠️ שגיאה: ${raw}`, loading: false, done: true });
    }
  }, [updateSection]);

  const handleGenerate = useCallback(async () => {
    if (!brief.company.trim() || !brief.niche.trim()) return;
    const apiKey = getApiKey();
    if (!apiKey) return;
    abortRef.current = false;
    setGenerating(true);
    setSections(EMPTY_SECTIONS);
    const c2 = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const fc = filesContext;
    const plan: [TabId, string][] = [
      ['posts',    postsPrompt(brief, fc)],
      ['visuals',  visualsPrompt(brief, fc)],
      ['calendar', calendarPrompt(brief, fc)],
      ['ads',      adsPrompt(brief, fc)],
    ];
    for (const [tab, prompt] of plan) {
      if (abortRef.current) break;
      setActiveTab(tab);
      await runStream(c2, tab, prompt);
    }
    setGenerating(false);
  }, [brief, runStream, filesContext]);

  const handleStop  = useCallback(() => { abortRef.current = true; setGenerating(false); }, []);
  const handleReset = useCallback(() => { abortRef.current = true; setGenerating(false); setSections(EMPTY_SECTIONS); }, []);
  const toggleGoal  = (id: string) => updateBrief({ goals: brief.goals.includes(id) ? brief.goals.filter(g => g !== id) : [...brief.goals, id] });

  const hasContent = Object.values(sections).some(s => s.content || s.loading);
  const cur = sections[activeTab];
  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-right bg-white placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-neutral-300 transition-all';
  const lbl = 'block text-[11px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest text-right';

  /* ── View mode ─────────────────────────────────────────────────────────── */
  type ViewMode = 'clients' | 'project' | 'generate';
  const viewMode: ViewMode = !selectedClient ? 'clients' : !selectedProject ? 'project' : 'generate';

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <div className="flex gap-5" dir="rtl">

      {/* ════════════════ LEFT SIDEBAR ════════════════ */}
      <div className="w-80 flex-shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm sticky top-20 flex flex-col" style={{ maxHeight: 'calc(100vh - 88px)' }}>

          {/* Header */}
          <div className="bg-neutral-900 px-4 py-4 rounded-t-2xl flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Layers size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="text-white font-bold text-sm">Creative Hub</div>
              <div className="text-white/40 text-xs">מנוע קריאייטיב AI</div>
            </div>
          </div>

          {/* ── Client selector ─── */}
          <div className="flex-shrink-0 p-3 border-b border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setShowNewClient(v => !v)}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                <Plus size={12} /> לקוח חדש
              </button>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">לקוח</span>
            </div>

            {/* New client input */}
            {showNewClient && (
              <div className="flex gap-1.5">
                <button onClick={createClient} className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded-lg font-semibold hover:bg-slate-700">צור</button>
                <input autoFocus value={newClientName} onChange={e => setNewClientName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createClient()}
                  placeholder="שם הלקוח..." className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            )}

            {/* Client search */}
            {clients.length > 3 && (
              <div className="relative">
                <Search size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="חיפוש לקוח..." className="w-full pr-7 pl-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right focus:outline-none" />
              </div>
            )}

            {/* Client list */}
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {filteredClients.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-2">אין לקוחות — צור לקוח חדש</p>
              )}
              {filteredClients.map(c => (
                <div key={c.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all group ${selectedClient === c.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-700'}`}
                  onClick={() => { setSelectedClient(c.id); setSelectedProject(null); }}>
                  <Building2 size={12} className={selectedClient === c.id ? 'text-white/60' : 'text-slate-400'} />
                  <span className="flex-1 text-xs font-semibold truncate">{c.brief.company}</span>
                  <button onClick={e => { e.stopPropagation(); deleteClient(c.id); }}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity ${selectedClient === c.id ? 'text-white/50 hover:text-red-300' : 'text-slate-300 hover:text-red-400'}`}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Project selector (only when client selected) ─── */}
          {selectedClient && (
            <div className="flex-shrink-0 p-3 border-b border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <button onClick={() => setShowNewProject(v => !v)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                  <Plus size={12} /> פרויקט חדש
                </button>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">פרויקט</span>
              </div>
              {showNewProject && (
                <div className="flex gap-1.5">
                  <button onClick={createProject} className="px-3 py-1.5 bg-slate-900 text-white text-xs rounded-lg font-semibold hover:bg-slate-700">צור</button>
                  <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createProject()}
                    placeholder="שם הפרויקט..." className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
              )}
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {clientProjects.length === 0 && <p className="text-xs text-slate-400 text-center py-1">אין פרויקטים ללקוח זה</p>}
                {clientProjects.map(p => (
                  <div key={p.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all group ${selectedProject === p.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}
                    onClick={() => setSelectedProject(p.id)}>
                    <Folder size={12} className={selectedProject === p.id ? 'text-white/70' : 'text-slate-400'} />
                    <span className="flex-1 text-xs font-semibold truncate">{p.name}</span>
                    <span className={`text-[10px] ${selectedProject === p.id ? 'text-white/60' : 'text-slate-400'}`}>{p.files.length} קבצים</span>
                    <button onClick={e => { e.stopPropagation(); deleteProject(p.id); }}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity ${selectedProject === p.id ? 'text-white/50 hover:text-red-300' : 'text-slate-300 hover:text-red-400'}`}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Brief form (scrollable) ─── */}
          {selectedClient && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className={lbl}>שם החברה *</label>
                  <input type="text" value={brief.company}
                    onChange={e => updateBrief({ company: e.target.value })}
                    className={inp} placeholder="לדוגמה: מגדלי הים..." />
                </div>
                <div>
                  <label className={lbl}>תחום / ניצ'</label>
                  <input type="text" value={brief.niche}
                    onChange={e => updateBrief({ niche: e.target.value })}
                    className={inp} placeholder='נדל"ן, פינטק, אופנה...' />
                </div>
              </div>
              <hr className="border-slate-100" />
              <div className="space-y-3">
                <div>
                  <label className={lbl}>קהל יעד</label>
                  <input type="text" value={brief.targetAudience}
                    onChange={e => updateBrief({ targetAudience: e.target.value })}
                    className={inp} placeholder="עסקים קטנים, גיל 30-50..." />
                </div>
                <div>
                  <label className={lbl}>דמוגרפיה</label>
                  <input type="text" value={brief.demographics}
                    onChange={e => updateBrief({ demographics: e.target.value })}
                    className={inp} placeholder="גיל, מין, אזור..." />
                </div>
              </div>
              <hr className="border-slate-100" />
              <div className="space-y-3">
                <div>
                  <label className={lbl}>נקודות כאב</label>
                  <textarea value={brief.painPoints}
                    onChange={e => updateBrief({ painPoints: e.target.value })}
                    className={`${inp} resize-none`} rows={2} placeholder="מה מציק ללקוח?" />
                </div>
                <div>
                  <label className={lbl}>יתרון ייחודי (USP)</label>
                  <input type="text" value={brief.usp}
                    onChange={e => updateBrief({ usp: e.target.value })}
                    className={inp} placeholder="מה מייחד אותך?" />
                </div>
              </div>
              <hr className="border-slate-100" />
              <div>
                <label className={lbl}>טון תקשורת</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {VOICE_OPTIONS.map(v => (
                    <button key={v.id} onClick={() => updateBrief({ brandVoice: v.id })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${brief.brandVoice === v.id ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-600 hover:border-neutral-300 hover:bg-slate-50'}`}>
                      <span>{v.emoji}</span><span>{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>מטרות קמפיין</label>
                <div className="flex gap-2">
                  {GOAL_OPTIONS.map(g => (
                    <button key={g.id} onClick={() => toggleGoal(g.id)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${brief.goals.includes(g.id) ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-500 hover:border-neutral-300'}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>שפה</label>
                <div className="flex gap-2">
                  {[{ id: 'he' as const, label: '🇮🇱 עברית' }, { id: 'en' as const, label: '🇺🇸 English' }].map(l => (
                    <button key={l.id} onClick={() => updateBrief({ language: l.id })}
                      className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${brief.language === l.id ? 'border-black bg-black text-white' : 'border-slate-200 text-slate-500'}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Actions ─── */}
          <div className="p-4 border-t border-slate-100 flex-shrink-0 space-y-2">
            {!selectedClient ? (
              <p className="text-center text-[11px] text-slate-400 py-1">בחר לקוח כדי להתחיל</p>
            ) : !selectedProject ? (
              <p className="text-center text-[11px] text-slate-400 py-1">בחר פרויקט כדי להמשיך</p>
            ) : generating ? (
              <div className="flex gap-2">
                <div className="flex-1 bg-black text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                  <Loader2 size={15} className="animate-spin" /> מייצר...
                </div>
                <button onClick={handleStop} className="px-4 py-3 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium">עצור</button>
              </div>
            ) : hasContent ? (
              <div className="flex gap-2">
                <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                  className="flex-1 bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                  <RefreshCw size={14} /> צור מחדש
                </button>
                <button onClick={handleReset} className="px-4 py-3 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-sm font-medium">נקה</button>
              </div>
            ) : (
              <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                className="w-full bg-black hover:bg-neutral-800 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                <Sparkles size={15} /> צור תוכן קריאייטיב
                {filesContext && <span className="text-[10px] opacity-60">+ {files.filter(f=>f.analysis).length} קבצים</span>}
              </button>
            )}
            {selectedClient && selectedProject && !brief.company.trim() && (
              <p className="text-center text-[11px] text-slate-400">מלא שם חברה להמשך</p>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════ RIGHT MAIN AREA ════════════════ */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* ── No client selected ── */}
        {viewMode === 'clients' && (
          <div className="flex flex-col items-center justify-center min-h-[500px] gap-6 text-center">
            <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center shadow-lg">
              <Layers size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Creative Hub</h2>
              <p className="text-slate-400 text-sm max-w-sm leading-relaxed">
                צור לקוח חדש בסרגל הצדדי, הוסף פרויקט, העלה קבצי מותג — ו-AI יבנה עבורך תוכן שיווקי מותאם אישית.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs text-slate-400 max-w-sm">
              {[
                { icon: <Building2 size={18}/>, label: 'לקוחות שמורים' },
                { icon: <FolderOpen size={18}/>, label: 'פרויקטים מאורגנים' },
                { icon: <Upload size={18}/>, label: 'ניתוח קבצי מותג' },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <div className="text-slate-500">{item.icon}</div>
                  <span className="font-medium text-slate-600">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Client selected, no project ── */}
        {viewMode === 'project' && client && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setShowNewProject(true)}
                  className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-700 transition-all">
                  <Plus size={14} /> פרויקט חדש
                </button>
                <div className="text-right">
                  <h2 className="text-xl font-bold text-slate-800">{client.brief.company}</h2>
                  <p className="text-sm text-slate-400">{clientProjects.length} פרויקטים</p>
                </div>
              </div>
              {clientProjects.length === 0 ? (
                <div className="text-center py-12">
                  <FolderOpen size={40} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">אין פרויקטים עדיין — צור פרויקט חדש</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {clientProjects.map(p => (
                    <div key={p.id} onClick={() => setSelectedProject(p.id)}
                      className="p-4 border-2 border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 rounded-xl cursor-pointer transition-all group">
                      <div className="flex items-center justify-between mb-2">
                        <button onClick={e => { e.stopPropagation(); deleteProject(p.id); }}
                          className="text-slate-200 group-hover:text-red-300 hover:!text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                        <Folder size={20} className="text-indigo-400" />
                      </div>
                      <p className="text-sm font-bold text-slate-800 text-right">{p.name}</p>
                      <p className="text-xs text-slate-400 text-right mt-1">{p.files.length} קבצים</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Project selected — files + content generation ── */}
        {viewMode === 'generate' && project && (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <button onClick={() => setSelectedProject(null)} className="hover:text-slate-800 transition-colors flex items-center gap-1">
                <Building2 size={13} /> {client?.brief.company}
              </button>
              <ChevronDown size={13} className="-rotate-90" />
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <Folder size={13} className="text-indigo-500" /> {project.name}
              </span>
            </div>

            {/* File upload area */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                  <Upload size={12} /> העלה קבצים
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{files.length} קבצים</span>
                  {files.filter(f => f.analysis).length > 0 && (
                    <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
                      {files.filter(f => f.analysis).length} נותחו ✓
                    </span>
                  )}
                  <span className="text-sm font-bold text-slate-700">קבצי מותג</span>
                </div>
              </div>

              <input ref={fileInputRef} type="file" multiple accept={ACCEPTED}
                className="hidden" onChange={e => handleFiles(e.target.files)} />

              {files.length === 0 ? (
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="m-4 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 rounded-xl p-8 text-center cursor-pointer transition-all">
                  <Upload size={28} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-500">גרור קבצים לכאן או לחץ להעלאה</p>
                  <p className="text-xs text-slate-400 mt-1">תמונות (PNG, JPG, WebP) · עד {MAX_FILE_MB}MB לקובץ</p>
                  <p className="text-xs text-indigo-500 mt-2 font-medium">תמונות מותג, לוגו, עיצובים — AI ינתח ויתאים את התוכן</p>
                </div>
              ) : (
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {files.map(f => (
                      <FileCard key={f.id} file={f}
                        onDelete={() => deleteFile(f.id)}
                        onAnalyze={() => analyzeFile(f.id)}
                        analyzing={analyzingId === f.id} />
                    ))}
                  </div>
                  <div
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-dashed border-slate-200 hover:border-indigo-300 rounded-xl p-3 text-center cursor-pointer transition-all">
                    <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5">
                      <Upload size={11} /> הוסף עוד קבצים
                    </p>
                  </div>
                  {filesContext && (
                    <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <Bot size={12} className="text-emerald-600" />
                      <p className="text-[11px] text-emerald-700 font-medium">קבצים מנותחים ישולבו בתוכן המיוצר</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Content tabs */}
            {hasContent && (
              <>
                <div className="flex gap-1 bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm">
                  {TABS.map(tab => {
                    const s = sections[tab.id];
                    const active = activeTab === tab.id;
                    return (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${active ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
                        <tab.icon size={14} />
                        <span className="hidden sm:inline">{tab.label}</span>
                        {s.loading && <Loader2 size={11} className="animate-spin opacity-60" />}
                        {s.done && !s.loading && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {cur.done && cur.content && !cur.content.startsWith('⚠️') && <CopyBtn text={cur.content} />}
                  </div>
                  <div className="text-right">
                    <h3 className="font-bold text-slate-800">{TABS.find(t => t.id === activeTab)?.label}</h3>
                    {brief.company && <p className="text-xs text-slate-400">{brief.company} · {brief.niche}</p>}
                  </div>
                </div>
                {activeTab === 'visuals'
                  ? <VisualsOutput content={cur.content} sectionLoading={cur.loading} />
                  : <SectionOutput content={cur.content} loading={cur.loading} />}
              </>
            )}

            {/* Empty content state */}
            {!hasContent && (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
                <Sparkles size={32} className="text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 font-semibold">מוכן לייצור תוכן</p>
                <p className="text-xs text-slate-400 mt-1">
                  {filesContext
                    ? `AI ישלב את ניתוח ${files.filter(f=>f.analysis).length} הקבצים בתוכן`
                    : 'העלה קבצי מותג לתוצאות מותאמות יותר'}
                </p>
                <button onClick={handleGenerate} disabled={!brief.company.trim() || !brief.niche.trim()}
                  className="mt-4 inline-flex items-center gap-2 bg-black hover:bg-neutral-800 disabled:opacity-40 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all">
                  <Sparkles size={14} /> צור תוכן קריאייטיב
                </button>
                {(!brief.company.trim() || !brief.niche.trim()) && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-amber-600">
                    <AlertCircle size={12} /> מלא שם חברה ותחום בסרגל הצדדי
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
