"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";

interface Persona { id: string; fullName: string; role: string; description: string }

/** Demo mode sign-in: choose a fictional persona. No real accounts or alerts. */
export function DemoPersonaPicker({ redirectTo = "/dashboard" }: { redirectTo?: string }) {
  const { signInDemo } = useAuth();
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ personas: Persona[] }>("/api/demo/session").then((r) => setPersonas(r.personas)).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Demo mode: simulated data only">
        Firebase isn&apos;t configured, so SafeHer is running with fictional people. No real notifications are sent. Sign in as different
        personas to see both sides of an emergency.
      </Alert>
      {error && <Alert tone="emergency">{error}</Alert>}
      <div className="grid gap-2.5">
        {personas.map((p) => (
          <button
            key={p.id}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(p.id);
              setError(null);
              try { await signInDemo(p.id); router.push(redirectTo); } catch (e) { setError((e as Error).message); setBusy(null); }
            }}
            className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-left shadow-soft transition hover:border-accent hover:shadow-md disabled:opacity-60"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-white">{initials(p.fullName)}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{p.fullName} <span className="text-xs font-medium text-accent">· {p.role}</span></span>
              <span className="block text-xs text-muted-foreground">{p.description}</span>
            </span>
            {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </div>
  );
}
