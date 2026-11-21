"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ConfigProblem } from "@/components/auth/config-problem";
import { DemoPersonaPicker } from "@/components/auth/demo-persona-picker";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { friendlyAuthError, useAuth } from "@/hooks/use-auth";
import { safeRedirect } from "@/lib/utils";

function LoginInner() {
  const { mode, status, profile, signInEmail } = useAuth();
  const router = useRouter();
  const nextParam = useSearchParams().get("next");
  const safeNext = safeRedirect(nextParam);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "signed_in" || !profile) return;
    // New accounts finish onboarding first, then continue to where they were going (e.g. an invitation).
    router.replace(profile.onboardingComplete ? safeNext : `/onboarding?next=${encodeURIComponent(safeNext)}`);
  }, [status, profile, router, safeNext]);

  const signupHref = nextParam ? `/signup?next=${encodeURIComponent(safeNext)}` : "/signup";

  return (
    <>
      <h1 className="text-3xl font-bold">Welcome back</h1>
      <p className="mt-1.5 text-muted-foreground">
        {safeNext.startsWith("/invite/") ? "Sign in or create an account to respond to your invitation." : "Sign in to your safety circle."}
      </p>
      <div className="mt-8">
        {mode === "demo" ? (
          <DemoPersonaPicker redirectTo={safeNext} />
        ) : mode !== "firebase" ? (
          <ConfigProblem />
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true); setError(null);
              try { await signInEmail(String(f.get("email")), String(f.get("password"))); } catch (err) { setError(friendlyAuthError(err)); setBusy(false); }
            }}
          >
            <GoogleButton onError={setError} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
            <Field id="email" label="Email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
            <Field id="password" label={<span className="flex w-full justify-between">Password <Link href="/forgot-password" className="text-xs font-semibold text-accent">Forgot password?</Link></span>}>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </Field>
            {error && <Alert tone="emergency">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>
        )}
      </div>
      {mode === "firebase" && <p className="mt-6 text-center text-sm text-muted-foreground">New to SafeHer? <Link href={signupHref} className="font-semibold text-accent">Create an account</Link></p>}
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
