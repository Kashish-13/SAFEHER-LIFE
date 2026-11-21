"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DemoPersonaPicker } from "@/components/auth/demo-persona-picker";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { friendlyAuthError, useAuth } from "@/hooks/use-auth";

function LoginInner() {
  const { mode, status, signInEmail } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"; // no open redirects
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (status === "signed_in") router.replace(safeNext); }, [status, router, safeNext]);

  return (
    <>
      <h1 className="text-3xl font-bold">Welcome back</h1>
      <p className="mt-1.5 text-muted-foreground">Sign in to your safety circle.</p>
      <div className="mt-8">
        {mode === "demo" ? (
          <DemoPersonaPicker redirectTo={safeNext} />
        ) : mode === "unconfigured" ? (
          <Alert tone="emergency" title="Authentication is not configured">Set the Firebase environment variables (see .env.example) or enable NEXT_PUBLIC_DEMO_MODE.</Alert>
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
      {mode !== "demo" && <p className="mt-6 text-center text-sm text-muted-foreground">New to SafeHer? <Link href="/signup" className="font-semibold text-accent">Create an account</Link></p>}
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
