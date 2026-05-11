import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbResetPassword,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile, WorkspaceProfile } from '../types';

const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOGIN_KEY  = 'ray-login-at';

// Super admin email — full system access
export const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com';

interface AuthContextType {
  user:            User | null;
  profile:         UserProfile | null;
  workspace:       WorkspaceProfile | null;
  loading:         boolean;
  isAdmin:         boolean;         // workspace admin
  isSuperAdmin:    boolean;         // system-wide super admin
  signIn:          (email: string, password: string) => Promise<void>;
  signOut:         () => Promise<void>;
  resetPassword:   (email: string) => Promise<void>;
  refreshProfile:  () => Promise<void>;
  refreshWorkspace:() => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<User | null>(null);
  const [profile,   setProfile]   = useState<UserProfile | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceProfile | null>(null);
  const [loading,   setLoading]   = useState(true);

  const doSignOut = async () => {
    await fbSignOut(auth);
    localStorage.removeItem(LOGIN_KEY);
    setUser(null);
    setProfile(null);
    setWorkspace(null);
  };

  const loadProfile = async (uid: string): Promise<UserProfile | null> => {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data() as UserProfile;
    return null;
  };

  const loadWorkspace = async (workspaceId: string): Promise<WorkspaceProfile | null> => {
    const snap = await getDoc(doc(db, 'workspaces', workspaceId));
    if (snap.exists()) return snap.data() as WorkspaceProfile;
    return null;
  };

  const refreshProfile = async () => {
    if (!user) return;
    const p = await loadProfile(user.uid);
    setProfile(p);
    if (p?.workspaceId) {
      const w = await loadWorkspace(p.workspaceId);
      setWorkspace(w);
    }
  };

  const refreshWorkspace = async () => {
    if (!profile?.workspaceId) return;
    const w = await loadWorkspace(profile.workspaceId);
    setWorkspace(w);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Check 12-hour session
        const loginAt = parseInt(localStorage.getItem(LOGIN_KEY) || '0');
        if (loginAt && Date.now() - loginAt > SESSION_MS) {
          await doSignOut();
          setLoading(false);
          return;
        }
        const p = await loadProfile(firebaseUser.uid);
        setProfile(p);
        setUser(firebaseUser);

        // Load workspace if user has one
        if (p?.workspaceId) {
          const w = await loadWorkspace(p.workspaceId);
          setWorkspace(w);
        }
      } else {
        setUser(null);
        setProfile(null);
        setWorkspace(null);
      }
      setLoading(false);
    });

    // Periodic session check (every 60s)
    const timer = setInterval(() => {
      const loginAt = parseInt(localStorage.getItem(LOGIN_KEY) || '0');
      if (loginAt && Date.now() - loginAt > SESSION_MS) {
        doSignOut();
      }
    }, 60_000);

    return () => { unsub(); clearInterval(timer); };
  }, []); // eslint-disable-line

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem(LOGIN_KEY, Date.now().toString());
  };

  const resetPassword = async (email: string) => {
    await fbResetPassword(auth, email);
  };

  const isSuperAdmin = !!(user?.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());

  return (
    <AuthContext.Provider value={{
      user, profile, workspace, loading,
      isAdmin:      profile?.role === 'admin' || isSuperAdmin,
      isSuperAdmin,
      signIn, signOut: doSignOut, resetPassword, refreshProfile, refreshWorkspace,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
