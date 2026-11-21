import Link from "next/link";
import { cn } from "@/lib/utils";

/** SafeHer mark: a shield formed by two embracing arcs around a beacon dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="sh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#7C6CF0" />
        </linearGradient>
      </defs>
      <path d="M16 2.5 4.5 7v8.2c0 7 4.9 12.4 11.5 14.3 6.6-1.9 11.5-7.3 11.5-14.3V7L16 2.5Z" fill="url(#sh-g)" />
      <path d="M10.5 15.5c0-3.4 2.4-6 5.5-6s5.5 2.6 5.5 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="19.5" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Logo({ href = "/", light, className }: { href?: string; light?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 rounded-lg", className)} aria-label="SafeHer home">
      <LogoMark />
      <span className={cn("font-display text-lg font-bold tracking-tight", light ? "text-white" : "text-primary")}>
        Safe<span className="text-accent">Her</span>
      </span>
    </Link>
  );
}
