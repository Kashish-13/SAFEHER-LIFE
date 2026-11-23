"use client";

import { linkWithPhoneNumber, RecaptchaVerifier, type ConfirmationResult } from "firebase/auth";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEMO_OTP_CODE } from "@/core/defaults";
import type { UserProfile } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { friendlyAuthError, useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { usesFirebase } from "@/lib/mode";

/**
 * Phone OTP verification.
 * Firebase mode: Firebase Phone Auth (invisible reCAPTCHA) links the number to
 * the account, and the server confirms it on the Auth record before marking it verified.
 * Demo mode: no SMS is sent; the simulated code is displayed.
 */
export function PhoneVerify({ initialPhone, onVerified }: { initialPhone?: string | null; onVerified?: (p: UserProfile) => void }) {
  const { mode, profile, setProfile } = useAuth();
  const [phone, setPhone] = useState(initialPhone ?? profile?.phone ?? "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"enter" | "code" | "done">(profile?.phoneVerified ? "done" : "enter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const verifierRef = useRef<{ verifier: RecaptchaVerifier; el: HTMLElement } | null>(null);
  const normalized = phone.replace(/[\s()-]/g, "");

  /**
   * reCAPTCHA can only render once per element, so a retry after a failed attempt
   * used to throw "reCAPTCHA has already been rendered". Each attempt now gets a
   * FRESH host element, and the previous verifier is cleared on error/unmount.
   */
  const resetVerifier = () => {
    try { verifierRef.current?.verifier.clear(); } catch { /* already cleared */ }
    verifierRef.current?.el.remove();
    verifierRef.current = null;
  };
  const getVerifier = () => {
    if (verifierRef.current) return verifierRef.current.verifier;
    const el = document.createElement("div");
    recaptchaRef.current!.appendChild(el);
    const verifier = new RecaptchaVerifier(getFirebaseAuth()!, el, { size: "invisible" });
    verifierRef.current = { verifier, el };
    return verifier;
  };
  useEffect(() => resetVerifier, []);

  const sendCode = async () => {
    setError(null);
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) { setError("Enter your number with country code, e.g. +919876543210"); return; }
    setBusy(true);
    try {
      if (usesFirebase(mode)) {
        const auth = getFirebaseAuth()!;
        confirmation.current = await linkWithPhoneNumber(auth.currentUser!, normalized, getVerifier());
      }
      setStage("code");
    } catch (e) {
      resetVerifier(); // allow a clean retry
      setError(friendlyAuthError(e));
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      if (usesFirebase(mode)) await confirmation.current!.confirm(code);
      const { profile: p } = await api<{ profile: UserProfile }>("/api/me/phone", { body: { phone: normalized, code: mode === "demo" ? code : undefined } });
      setProfile(p); setStage("done"); onVerified?.(p);
    } catch (e) { setError(friendlyAuthError(e)); } finally { setBusy(false); }
  };

  if (stage === "done") {
    return <Alert tone="success" title="Phone verified"><span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5" />{profile?.phone}</span></Alert>;
  }
  return (
    <div className="space-y-3">
      <div ref={recaptchaRef} />
      {stage === "enter" ? (
        <>
          <Field id="phone" label="Mobile number" hint="Used so your trusted contacts can recognise you. Never shared publicly.">
            <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Button onClick={sendCode} loading={busy} variant="outline" className="w-full">Send verification code</Button>
        </>
      ) : (
        <>
          {mode === "demo" && <Alert tone="warning" title="Simulated SMS">Demo mode doesn&apos;t send SMS. Use code <strong>{DEMO_OTP_CODE}</strong>.</Alert>}
          <Field id="otp" label={`Code sent to ${normalized}`}>
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => { resetVerifier(); setCode(""); setStage("enter"); }}>Change number</Button>
            <Button onClick={confirm} loading={busy} disabled={code.length < 6}>Verify</Button>
          </div>
        </>
      )}
      {error && <Alert tone="emergency">{error}</Alert>}
    </div>
  );
}
