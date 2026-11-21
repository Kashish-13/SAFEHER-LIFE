import { Phone } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <p className="font-display text-6xl font-extrabold text-primary">404</p>
        <h1 className="mt-2 text-xl font-semibold">This page doesn&apos;t exist</h1>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>
        <Button asChild variant="emergency"><a href="tel:112"><Phone />Call 112</a></Button>
      </div>
    </div>
  );
}
