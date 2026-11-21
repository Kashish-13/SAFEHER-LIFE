"use client";

import {
  createUserWithEmailAndPassword, GoogleAuthProvider, onIdTokenChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signOut as fbSignOut, updateProfile as fbUpdateProfile, type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserProfile } from "@/core/types";
import { api, setTokenProvider } from "@/lib/api-client";
import { isDemoClient, isFirebaseClientConfigured } from "@/lib/config";
import { getFirebaseAuth } from "@/lib/firebase/client";

const DEMO_TOKEN_KEY = "safeher.demoToken";

type Mode = "firebase" | "demo" | "unconfigured";
type Status = "loading" | "signed_out" | "signed_in";

interface AuthContextValue {
  mode: Mode;
  status: Status;
  uid: string | null;
  email: string | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<UserProfile | null>;
  setProfile: (p: UserProfile) => void;
  signInDemo: (personaId: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (fullName: string, email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const mode: Mode = isFirebaseClientConfigured ? "firebase" : isDemoClient ? "demo" : "unconfigured";

function readDemoToken() {
  try { return localStorage.getItem(DEMO_TOKEN_KEY); } catch { return null; }
}

/** Maps Firebase error codes to messages a stressed user can act on. */
export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found with this email.",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in.",
    "auth/weak-password": "Use a stronger password (at least 8 characters).",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] ?? (err as Error)?.message ?? "Something went wrong.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const fbUser = useRef<User | null>(null);
  const pendingName = useRef<string | null>(null);
  const lastUid = useRef<string | null>(null);

  useEffect(() => {
    setTokenProvider(async () => {
      if (mode === "firebase") return fbUser.current ? fbUser.current.getIdToken() : null;
      if (mode === "demo") return readDemoToken();
      return null;
    });
  }, []);

  const loadProfile = useCallback(async (): Promise<UserProfile | null> => {
    const { profile: p } = await api<{ profile: UserProfile | null }>("/api/me");
    if (p) { setProfile(p); return p; }
    // First sign-in: create the server-side profile.
    const name = pendingName.current ?? fbUser.current?.displayName ?? "";
    const created = await api<{ profile: UserProfile }>("/api/me", { method: "POST", body: { fullName: name || "SafeHer user" } });
    setProfile(created.profile);
    return created.profile;
  }, []);

  const finishSignIn = useCallback(async (id: string, mail: string | null) => {
    setUid(id);
    setEmail(mail);
    try {
      await loadProfile();
      setStatus("signed_in");
    } catch {
      setStatus("signed_out");
    }
  }, [loadProfile]);

  useEffect(() => {
    if (mode === "firebase") {
      const auth = getFirebaseAuth()!;
      return onIdTokenChanged(auth, async (u) => {
        fbUser.current = u;
        if (!u) { lastUid.current = null; setUid(null); setProfile(null); setStatus("signed_out"); return; }
        // Token refreshes fire this hourly; only (re)load the profile when the user changes.
        if (lastUid.current !== u.uid) { lastUid.current = u.uid; await finishSignIn(u.uid, u.email); }
      });
    }
    if (mode === "demo") {
      const token = readDemoToken();
      if (!token) { setStatus("signed_out"); return; }
      api<{ profile: UserProfile | null }>("/api/me")
        .then(({ profile: p }) => {
          if (!p) throw new Error("no profile");
          setProfile(p); setUid(p.id); setEmail(p.email); setStatus("signed_in");
        })
        .catch(() => { try { localStorage.removeItem(DEMO_TOKEN_KEY); } catch {} setStatus("signed_out"); });
      return;
    }
    setStatus("signed_out");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    mode, status, uid, email, profile,
    refreshProfile: loadProfile,
    setProfile,
    async signInDemo(personaId) {
      const { token } = await api<{ token: string }>("/api/demo/session", { method: "POST", body: { personaId } });
      try { localStorage.setItem(DEMO_TOKEN_KEY, token); } catch {}
      const { profile: p } = await api<{ profile: UserProfile }>("/api/me");
      setProfile(p); setUid(p.id); setEmail(p.email); setStatus("signed_in");
    },
    async signInEmail(mail, password) {
      await signInWithEmailAndPassword(getFirebaseAuth()!, mail, password);
    },
    async signUpEmail(fullName, mail, password) {
      pendingName.current = fullName;
      const cred = await createUserWithEmailAndPassword(getFirebaseAuth()!, mail, password);
      await fbUpdateProfile(cred.user, { displayName: fullName });
    },
    async signInGoogle() {
      await signInWithPopup(getFirebaseAuth()!, new GoogleAuthProvider());
    },
    async resetPassword(mail) {
      await sendPasswordResetEmail(getFirebaseAuth()!, mail);
    },
    async signOut() {
      if (mode === "firebase") await fbSignOut(getFirebaseAuth()!);
      try { localStorage.removeItem(DEMO_TOKEN_KEY); } catch {}
      setProfile(null); setUid(null); setStatus("signed_out");
    },
  }), [status, uid, email, profile, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
