"use client";

import { Alert } from "@/components/ui/feedback";
import { useAuth } from "@/hooks/use-auth";

/** Shown instead of sign-in forms when the deployment can't safely run. */
export function ConfigProblem() {
  const { mode, configProblems } = useAuth();
  if (mode === "unconfigured") {
    return (
      <Alert tone="emergency" title="Sign-in is not available">
        This deployment has no authentication configured. Administrators: set the Firebase variables from .env.example, or explicitly enable demo mode.
      </Alert>
    );
  }
  return (
    <Alert tone="emergency" title="SafeHer is not configured correctly">
      <p>Sign-in is disabled until this is fixed. If you are in danger, call 112.</p>
      {configProblems.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{configProblems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
    </Alert>
  );
}
