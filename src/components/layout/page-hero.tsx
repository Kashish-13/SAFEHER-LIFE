import type { ReactNode } from "react";

export function PageHero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section className="hero-gradient relative overflow-hidden text-white">
      <div className="grid-fade absolute inset-0" aria-hidden />
      <div className="container relative max-w-3xl py-16 text-center md:py-20">
        <p className="text-sm font-semibold uppercase tracking-wider text-teal-300">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-extrabold sm:text-5xl">{title}</h1>
        {children && <div className="mt-4 text-lg text-white/70">{children}</div>}
      </div>
    </section>
  );
}
