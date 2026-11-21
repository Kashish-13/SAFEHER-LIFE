"use client";

import { Bell, FlaskConical, LogOut, Phone, Siren, UserCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/hooks/use-auth";
import { useSafetyStatus } from "@/hooks/use-safety-status";
import { cn, initials } from "@/lib/utils";
import { BOTTOM_NAV, NAV_GROUPS } from "./nav-config";

function EmergencyBanners() {
  const { activeEmergency, incomingAlerts, pendingApprovals } = useSafetyStatus();
  const pathname = usePathname();
  const pending = incomingAlerts.filter((a) => a.myResponse !== "acknowledged" && a.myResponse !== "declined");
  return (
    <>
      {activeEmergency && !pathname.startsWith(`/emergency/${activeEmergency.id}`) && (
        <Link href={`/emergency/${activeEmergency.id}`} className="flex items-center justify-center gap-2 bg-emergency px-4 py-2.5 text-sm font-semibold text-white">
          <Siren className="size-4 animate-pulse" /> Your emergency alert is active. Tap to view responses.
        </Link>
      )}
      {pending.map((a) => (
        <Link key={a.eventId} href={`/emergency/${a.eventId}`} className="flex items-center justify-center gap-2 bg-emergency px-4 py-2.5 text-sm font-semibold text-white">
          <Siren className="size-4 animate-pulse" /> {a.isSimulated && "[SIMULATED] "}{a.fromName} needs help. Tap to respond.
        </Link>
      ))}
      {pendingApprovals > 0 && pathname !== "/circle" && (
        <Link href="/circle" className="flex items-center justify-center gap-2 bg-primary px-4 py-2 text-sm font-semibold text-white">
          <UserCheck className="size-4" /> {pendingApprovals} {pendingApprovals === 1 ? "person is" : "people are"} waiting for your approval to join your circle
        </Link>
      )}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, mode, signOut } = useAuth();
  const { unreadNotifications } = useSafetyStatus();
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = profile?.roles.includes("admin");
  const active = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center px-5"><Logo href="/dashboard" /></div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="App">
          {NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin).map((g) => (
            <div key={g.label}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
                  className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground", active(i.href) && "bg-secondary text-primary")}>
                  <i.icon className="size-4" />{i.label}
                  {i.href === "/notifications" && unreadNotifications > 0 && <span className="ml-auto rounded-full bg-emergency px-1.5 text-[10px] font-bold text-white">{unreadNotifications}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <Link href="/sos" className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-emergency py-3 text-sm font-bold text-white shadow-sm hover:bg-emergency/90"><Siren className="size-4" /> SOS</Link>
          <button onClick={async () => { await signOut(); router.push("/login"); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-secondary">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <EmergencyBanners />
        {mode === "demo" && (
          <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-medium text-[hsl(30_80%_28%)]">
            <FlaskConical className="size-3.5" /> Demo mode: simulated data. No real alerts are sent.
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 backdrop-blur-lg sm:px-6">
          <div className="lg:hidden"><Logo href="/dashboard" /></div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1.5">
            <a href="tel:112" className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-emergency hover:bg-emergency-soft" aria-label="Call 112 emergency">
              <Phone className="size-4" /><span className="hidden sm:inline">112</span>
            </a>
            <Link href="/notifications" className="relative rounded-xl p-2.5 hover:bg-secondary" aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}>
              <Bell className="size-5" />
              {unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-emergency ring-2 ring-background" />}
            </Link>
            <Link href="/profile" className="grid size-9 place-items-center rounded-full bg-primary text-xs font-bold text-white" aria-label="Profile">
              {initials(profile?.fullName ?? "")}
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden" aria-label="Primary">
        <ul className="grid grid-cols-5">
          {BOTTOM_NAV.map((i) => (
            <li key={i.href}>
              {i.sos ? (
                <Link href={i.href} className="-mt-5 flex flex-col items-center" aria-label="SOS emergency">
                  <span className="grid size-14 place-items-center rounded-full bg-emergency text-white shadow-[0_6px_20px_hsl(var(--emergency)/0.45)] ring-4 ring-card"><i.icon className="size-6" /></span>
                  <span className="mt-0.5 text-[11px] font-bold text-emergency">SOS</span>
                </Link>
              ) : (
                <Link href={i.href} aria-current={active(i.href) ? "page" : undefined}
                  className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground", active(i.href) && "text-primary")}>
                  <i.icon className="size-5" />{i.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
