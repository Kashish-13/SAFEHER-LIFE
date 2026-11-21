import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function MarketingFooter() {
  return (
    <footer className="border-t bg-navy-950 text-white/70">
      <div className="container grid gap-10 py-14 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <Logo light />
          <p className="max-w-sm text-sm">Your Safety. Your Circle. Your Protection. A coordinated emergency response platform built around consent and privacy.</p>
          <p className="max-w-md text-xs text-white/50">
            SafeHer is not an emergency service and is not integrated with police dispatch. Alerts depend on network connectivity and device
            settings and cannot be guaranteed. In immediate danger, call <a className="font-semibold text-white underline" href="tel:112">112</a>.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Product</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/features" className="hover:text-white">Features</Link></li>
            <li><Link href="/how-it-works" className="hover:text-white">How it works</Link></li>
            <li><Link href="/signup" className="hover:text-white">Create account</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Company</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/about" className="hover:text-white">About</Link></li>
            <li><Link href="/privacy-safety" className="hover:text-white">Privacy & Safety</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-white/40">© {new Date().getFullYear()} SafeHer. Built as a social-impact software engineering project.</div>
    </footer>
  );
}
