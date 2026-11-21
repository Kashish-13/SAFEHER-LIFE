"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoPersonaPicker } from "@/components/auth/demo-persona-picker";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { friendlyAuthError, useAuth } from "@/hooks/use-auth";

export default function SignupPage() {
  const { mode, status, profile, signUpEmail } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signed_in") router.replace(profile?.onboardingComplete ? "/dashboard" : "/onboarding");
  }, [status, profile, router]);

  return (
    <>
      <h1 className="text-3xl font-bold">Create your SafeHer account</h1>
      <p className="mt-1.5 text-muted-foreground">Set up your trusted circle in about two minutes.</p>
      <div className="mt-8">
        {mode === "demo" ? (
          <DemoPersonaPicker />
        ) : mode === "unconfigured" ? (
          <Alert tone="emergency" title="Authentication is not configured">Set the Firebase environment variables (see .env.example).</Alert>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              if (password !== String(f.get("confirm"))) { setError("Passwords don't match."); return; }
              setBusy(true); setError(null);
              try { await signUpEmail(String(f.get("fullName")).trim(), String(f.get("email")), password); }
              catch (err) { setError(friendlyAuthError(err)); setBusy(false); }
            }}
          >
            <GoogleButton onError={setError} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
            <Field id="fullName" label="Full name"><Input id="fullName" name="fullName" required maxLength={80} autoComplete="name" /></Field>
            <Field id="email" label="Email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
            <Field id="password" label="Password" hint="At least 8 characters.">
              <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <Field id="confirm" label="Confirm password"><Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
            {error && <Alert tone="emergency">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy}>Create account</Button>
            <p className="text-center text-xs text-muted-foreground">By continuing you agree that SafeHer is a support tool, not an emergency service. See <Link href="/privacy-safety" className="underline">Privacy & Safety</Link>.</p>
          </form>
        )}
      </div>
      {mode !== "demo" && <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-semibold text-accent">Sign in</Link></p>}
    </>
  );
}
