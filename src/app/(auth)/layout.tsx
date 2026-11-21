import { CheckCheck, Lock, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hero-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="grid-fade absolute inset-0" aria-hidden />
        <Logo light className="relative" />
        <div className="relative space-y-6">
          <h2 className="text-4xl font-extrabold leading-tight">Your Safety.<br />Your Circle.<br /><span className="text-teal-300">Your Protection.</span></h2>
          <ul className="space-y-3 text-white/75">
            <li className="flex gap-3"><Users className="size-5 text-teal-300" /> Alert your whole trusted circle with one trigger</li>
            <li className="flex gap-3"><CheckCheck className="size-5 text-teal-300" /> See exactly who received and acknowledged</li>
            <li className="flex gap-3"><Lock className="size-5 text-teal-300" /> Location shared only with people you choose</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">SafeHer is not an emergency service. In immediate danger, call 112.</p>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
