"use client";

import { Menu, Phone, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/privacy-safety", label: "Privacy & Safety" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { status } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950/80 backdrop-blur-lg">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Logo light />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-2 text-sm font-medium text-white/70 hover:text-white", pathname === n.href && "text-white")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <a href="tel:112" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-300 hover:text-red-200">
            <Phone className="size-4" /> Emergency? Call 112
          </a>
          {status === "signed_in" ? (
            <Button asChild variant="light" size="sm"><Link href="/dashboard">Open dashboard</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10"><Link href="/login">Sign in</Link></Button>
              <Button asChild variant="accent" size="sm"><Link href="/signup">Get started</Link></Button>
            </>
          )}
        </div>
        <button className="rounded-lg p-2 text-white lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-white/10 bg-navy-950 lg:hidden">
          <nav className="container flex flex-col py-3" aria-label="Mobile">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-white/80 hover:bg-white/5">{n.label}</Link>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10"><Link href="/login">Sign in</Link></Button>
              <Button asChild variant="accent"><Link href="/signup">Get started</Link></Button>
            </div>
            <a href="tel:112" className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emergency py-3 font-semibold text-white"><Phone className="size-4" /> Call 112</a>
          </nav>
        </div>
      )}
    </header>
  );
}
