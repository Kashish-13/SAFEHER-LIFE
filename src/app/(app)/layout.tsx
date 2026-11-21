"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Spinner } from "@/components/ui/feedback";
import { useAuth } from "@/hooks/use-auth";
import { SafetyStatusProvider } from "@/hooks/use-safety-status";

/**
 * Client-side route guard for UX only. Real access control is enforced by the
 * API on every request; an unauthenticated user here simply can't load data.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed_out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    // Onboarding first, then back to where the user was headed (e.g. an invitation link).
    else if (status === "signed_in" && profile && !profile.onboardingComplete) router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
  }, [status, profile, router, pathname]);

  if (status !== "signed_in" || !profile) {
    return <div className="grid min-h-screen place-items-center"><Spinner className="size-8" /></div>;
  }
  return (
    <SafetyStatusProvider enabled>
      <AppShell>{children}</AppShell>
    </SafetyStatusProvider>
  );
}
