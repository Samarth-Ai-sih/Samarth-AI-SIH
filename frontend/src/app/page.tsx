import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, MapPinned, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-950">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">S</span>
            SAMARTH <span className="text-blue-600">AI</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button size="sm" variant="ghost" asChild>
              <Link href="/public">Citizen Portal</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/login">Official sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:py-24">
        <div>
          <p className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[.12em] text-slate-700">
            Public works delivery assurance
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
            Clearer delivery oversight. Stronger public participation.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Search public-safe work information, share a ground observation, or use the role-based workspace to manage delivery, evidence, reviews, and inspections.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/public">
                Find a public work <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Open official workspace</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6 shadow-xs sm:p-8">
          <p className="text-sm font-semibold text-slate-900">Designed around accountable workflows</p>
          <div className="mt-6 space-y-5">
            <Feature
              icon={<MapPinned className="h-5 w-5" />}
              title="Search and verify"
              description="Public-safe project details and QR project lookup in one accessible portal."
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Human-led decisions"
              description="Risk and evidence signals are marked for verification, not treated as findings."
            />
            <Feature
              icon={<UsersRound className="h-5 w-5" />}
              title="Role-based assurance"
              description="District teams, agencies, and inspectors operate in scoped, auditable queues."
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-6 text-center text-xs text-slate-500">
        SAMARTH AI is an independent demonstration interface. It does not represent an official identity or agency.
      </footer>
    </main>
  );
}

function Feature({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white border border-slate-200 text-blue-600 shadow-2xs">
        {icon}
      </span>
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}
