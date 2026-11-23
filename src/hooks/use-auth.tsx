"use client";

import {
  createUserWithEmailAndPassword, EmailAuthProvider, GoogleAuthProvider, onIdTokenChanged, reauthenticateWithCredential,
  reauthenticateWithPopup, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut as fbSignOut,
  updateProfile as fbUpdateProfile, type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UserProfile } from "@/core/types";
import { api, setTokenProvider } from "@/lib/api-client";
import { clientMode } from "@/lib/config";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { usesFirebase, type AppMode } from "@/lib/mode";

const DEMO_TOKEN_KEY = "safeher.demoToken";

type Status = "loading" | "signed_out" | "signed_in";
export type ReauthMethod = "password" | "google" | "demo" | null;

interface AuthContextValue {
  mode: AppMode;
  /** Why the app can't run (misconfigured mode). Variable names only, never values. */
  configProblems: string[];
  status: Status;
  uid: string | null;
  email: string | null;
  profile: UserProfile | null;
  reauthMethod: ReauthMethod;
  refreshProfile: () => Promise<UserProfile | null>;
  setProfile: (p: UserProfile) => void;
  signInDemo: (personaId: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (fullName: string, email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Confirms identity again (fresh sign-in time) before sensitive actions. */
  reauthenticate: (password?: string) => Promise<void>;
  /** `redirectTo` overrides the default "go to login" after signing out (e.g. "/" after account deletion). */
  signOut: (opts?: { redirectTo?: string }) => Promise<void>;
  /** Where the app should go after a deliberate sign-out, if not the login page. */
  exitTo: string | null;
  signOutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readDemoToken() {
  try { return localStorage.getItem(DEMO_TOKEN_KEY); } catch { return null; }
}
function writeDemoToken(token: string | null) {
  try { if (token) localStorage.setItem(DEMO_TOKEN_KEY, token); else localStorage.removeItem(DEMO_TOKEN_KEY); } catch {}
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
    "auth/invalid-phone-number": "That phone number isn't valid. Include the country code, e.g. +91.",
    "auth/invalid-verification-code": "That code is incorrect. Check the SMS and try again.",
    "auth/code-expired": "That code has expired. Request a new one.",
    "auth/credential-already-in-use": "This phone number is already linked to another account.",
    "auth/provider-already-linked": "A phone number is already linked to this account.",
    "auth/captcha-check-failed": "The security check failed. Please try again.",
    "auth/requires-recent-login": "Please sign in again to confirm it's you.",
  };
  return map[code] ?? (err as Error)?.message ?? "Something went wrong.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>(clientMode.mode);
  const [configProblems, setConfigProblems] = useState<string[]>(clientMode.problems);
  const [status, setStatus] = useState<Status>("loading");
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reauthMethod, setReauthMethod] = useState<ReauthMethod>(null);
  const [exitTo, setExitTo] = useState<string | null>(null);
  const fbUser = useRef<User | null>(null);
  const pendingName = useRef<string | null>(null);
  const lastUid = useRef<string | null>(null);

  useEffect(() => {
    setTokenProvider(async () => {
      if (usesFirebase(clientMode.mode)) return fbUser.current ? fbUser.current.getIdToken() : null;
      if (clientMode.mode === "demo") return readDemoToken();
      return null;
    });
  }, []);

  // Browser and server must agree on the mode, otherwise sign-in would fail in confusing ways.
  useEffect(() => {
    if (clientMode.mode === "misconfigured") return;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: { mode?: AppMode; problems?: string[] }) => {
        if (!h.mode || h.mode === clientMode.mode) return;
        setMode("misconfigured");
        setConfigProblems(
          h.mode === "misconfigured" && h.problems?.length
            ? h.problems
            : [`The browser is configured for "${clientMode.mode}" mode but the server is in "${h.mode}" mode. Check your environment variables.`],
        );
        setStatus("signed_out");
      })
      .catch(() => {});
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

  const clearSession = useCallback(() => {
    lastUid.current = null;
    writeDemoToken(null);
    setProfile(null); setUid(null); setEmail(null); setReauthMethod(null); setStatus("signed_out");
  }, []);

  useEffect(() => {
    if (usesFirebase(clientMode.mode)) {
      const auth = getFirebaseAuth()!;
      return onIdTokenChanged(auth, async (u) => {
        fbUser.current = u;
        if (!u) { clearSession(); return; }
        setReauthMethod(u.providerData.some((p) => p.providerId === "password") ? "password" : "google");
        // Token refreshes fire this hourly; only (re)load the profile when the user changes.
        if (lastUid.current !== u.uid) {
          lastUid.current = u.uid;
          setUid(u.uid); setEmail(u.email);
          try { await loadProfile(); setStatus("signed_in"); } catch { setStatus("signed_out"); }
        }
      });
    }
    if (clientMode.mode === "demo") {
      if (!readDemoToken()) { setStatus("signed_out"); return; }
      api<{ profile: UserProfile | null }>("/api/me")
        .then(({ profile: p }) => {
          if (!p) throw new Error("no profile");
          setProfile(p); setUid(p.id); setEmail(p.email); setReauthMethod("demo"); setStatus("signed_in");
        })
        .catch(() => clearSession());
      return;
    }
    setStatus("signed_out");
  }, [loadProfile, clearSession]);

  const signInDemo = useCallback(async (personaId: string) => {
    const { token } = await api<{ token: string }>("/api/demo/session", { method: "POST", body: { personaId } });
    writeDemoToken(token);
    const { profile: p } = await api<{ profile: UserProfile }>("/api/me");
    setProfile(p); setUid(p.id); setEmail(p.email); setReauthMethod("demo"); setStatus("signed_in");
  }, []);

  const signOut = useCallback(async (opts?: { redirectTo?: string }) => {
    setExitTo(opts?.redirectTo ?? null); // set BEFORE status flips, so route guards see it
    if (usesFirebase(clientMode.mode)) await fbSignOut(getFirebaseAuth()!);
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({
    mode, configProblems, status, uid, email, profile, reauthMethod, exitTo,
    refreshProfile: loadProfile,
    setProfile,
    signInDemo,
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
    async reauthenticate(password) {
      if (clientMode.mode === "demo") {
        // Demo: re-issue the persona token so its sign-in time is fresh.
        if (!uid) throw new Error("Not signed in");
        await signInDemo(uid);
        return;
      }
      const user = getFirebaseAuth()?.currentUser;
      if (!user) throw new Error("Not signed in");
      if (reauthMethod === "password") {
        if (!password || !user.email) throw new Error("Enter your password to continue.");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }
      await user.getIdToken(true); // fresh token carries the new auth_time
    },
    signOut,
    async signOutEverywhere() {
      await api("/api/me/sessions", { method: "DELETE" });
      await signOut({ redirectTo: "/login" });
    },
  }), [mode, configProblems, status, uid, email, profile, reauthMethod, exitTo, loadProfile, signInDemo, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
