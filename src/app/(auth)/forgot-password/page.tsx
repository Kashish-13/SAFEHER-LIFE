"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useAuth } from "@/hooks/use-auth";

export default function ForgotPasswordPage() {
  const { mode, resetPassword } = useAuth();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <h1 className="text-3xl font-bold">Reset your password</h1>
      <p className="mt-1.5 text-muted-foreground">We&apos;ll email you a secure reset link.</p>
      <div className="mt-8">
        {mode !== "firebase" ? (
          <Alert tone="warning" title="Not available in demo mode">Password reset requires Firebase Authentication. Demo personas don&apos;t have passwords.</Alert>
        ) : sent ? (
          // Same message whether or not the account exists, to avoid account enumeration.
          <Alert tone="success" title="Check your inbox">If an account exists for that email, a reset link is on its way.</Alert>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true); setError(null);
              try { await resetPassword(String(new FormData(e.currentTarget).get("email"))); setSent(true); }
              catch (err) {
                if ((err as { code?: string }).code === "auth/user-not-found") setSent(true);
                else setError("Couldn't send the reset email. Please try again.");
              } finally { setBusy(false); }
            }}
          >
            <Field id="email" label="Email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
            {error && <Alert tone="emergency">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
          </form>
        )}
      </div>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="font-semibold text-accent">Back to sign in</Link></p>
    </>
  );
}
