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
import type { UserProfile } from '../types';

const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const LOGIN_KEY  = 'ray-login-at';

interface AuthContextType {
  user:     User | null;
  profile:  UserProfile | null;
  loading:  boolean;
  isAdmin:  boolean;
  signIn:   (email: string, password: string) => Promise<void>;
  signOut:  () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const doSignOut = async () => {
    await fbSignOut(auth);
    localStorage.removeItem(LOGIN_KEY);
    setUser(null);
    setProfile(null);
  };

  const loadProfile = async (uid: string): Promise<UserProfile | null> => {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data() as UserProfile;
    return null;
  };

  const refreshProfile = async () => {
    if (!user) return;
    const p = await loadProfile(user.uid);
    setProfile(p);
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
      } else {
        setUser(null);
        setProfile(null);
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

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isAdmin: profile?.role === 'admin',
      signIn, signOut: doSignOut, resetPassword, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
