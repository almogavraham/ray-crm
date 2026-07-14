import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbResetPassword,
  sendEmailVerification,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { UserProfile, WorkspaceProfile } from '../types';

const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOGIN_KEY  = 'ray-login-at';

// Super admin check — verified server-side via Firebase custom claims
// Do NOT put the admin email here; it would be exposed in the client bundle
export const SUPER_ADMIN_EMAIL = 'almogavraham30@gmail.com'; // kept for legacy UI checks only

interface AuthContextType {
  user:              User | null;
  profile:           UserProfile | null;
  workspace:         WorkspaceProfile | null;
  loading:           boolean;
  isAdmin:           boolean;         // workspace admin
  isSuperAdmin:      boolean;         // system-wide super admin
  emailVerified:     boolean;         // Firebase email verification status
  signIn:            (email: string, password: string) => Promise<void>;
  signOut:           () => Promise<void>;
  resetPassword:     (email: string) => Promise<void>;
  resendVerification:() => Promise<void>;
  refreshProfile:    () => Promise<void>;
  refreshWorkspace:  () => Promise<void>;
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

  // Keep a ref to the active workspace onSnapshot unsubscribe so we can
  // cancel it when the user logs out or switches workspaces.
  const [wsUnsub, setWsUnsub] = useState<(() => void) | null>(null);

  const doSignOut = async () => {
    await fbSignOut(auth);
    localStorage.removeItem(LOGIN_KEY);
    setUser(null);
    setProfile(null);
    setWorkspace(null);
    // Cancel any live workspace listener
    setWsUnsub(prev => { prev?.(); return null; });
  };

  const loadProfile = async (uid: string): Promise<UserProfile | null> => {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data() as UserProfile;
    return null;
  };

  /**
   * Subscribe to the workspace document with onSnapshot so that admin
   * changes (allowedPages, plan, status, etc.) are reflected instantly
   * in the client without requiring a page reload.
   */
  const subscribeWorkspace = (workspaceId: string) => {
    // Cancel previous subscription if any
    setWsUnsub(prev => { prev?.(); return null; });

    const unsub = onSnapshot(
      doc(db, 'workspaces', workspaceId),
      (snap) => {
        if (snap.exists()) {
          setWorkspace(snap.data() as WorkspaceProfile);
        } else {
          setWorkspace(null);
        }
      },
      (err) => console.error('workspace onSnapshot error:', err),
    );

    setWsUnsub(() => unsub);
    return unsub;
  };

  const refreshProfile = async () => {
    if (!user) return;
    const p = await loadProfile(user.uid);
    setProfile(p);
    if (p?.workspaceId) {
      subscribeWorkspace(p.workspaceId);
    }
  };

  const refreshWorkspace = async () => {
    if (!profile?.workspaceId) return;
    // onSnapshot already keeps it live; just force a re-subscribe
    subscribeWorkspace(profile.workspaceId);
  };

  useEffect(() => {
    let activeWsUnsub: (() => void) | null = null;

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // Cancel previous workspace subscription on auth change
      activeWsUnsub?.();
      activeWsUnsub = null;

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

        // Subscribe to workspace (real-time) if user has one
        if (p?.workspaceId) {
          activeWsUnsub = onSnapshot(
            doc(db, 'workspaces', p.workspaceId),
            (snap) => {
              if (snap.exists()) {
                setWorkspace(snap.data() as WorkspaceProfile);
              } else {
                setWorkspace(null);
              }
            },
            (err) => console.error('workspace onSnapshot error:', err),
          );
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

    return () => { unsub(); activeWsUnsub?.(); clearInterval(timer); };
  }, []); // eslint-disable-line

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem(LOGIN_KEY, Date.now().toString());
  };

  const resetPassword = async (email: string) => {
    await fbResetPassword(auth, email);
  };

  const resendVerification = async () => {
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const isSuperAdmin  = !!(user?.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());
  const emailVerified = !!(user?.emailVerified || isSuperAdmin); // super admin is always verified

  return (
    <AuthContext.Provider value={{
      user, profile, workspace, loading,
      isAdmin:      profile?.role === 'admin' || isSuperAdmin,
      isSuperAdmin,
      emailVerified,
      signIn, signOut: doSignOut, resetPassword, resendVerification, refreshProfile, refreshWorkspace,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
