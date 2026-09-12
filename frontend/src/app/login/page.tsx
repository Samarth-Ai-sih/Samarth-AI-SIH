"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { SamarthLogo } from "@/components/ui/samarth-logo";

const DEMO_ACCOUNTS = [
  { label: "MP (Varanasi)", email: "mp.varanasi.demo@samarth-demo.in", role: "MP (Varanasi Urban)" },
  { label: "DA (Varanasi)", email: "da.varanasi.demo@samarth-demo.in", role: "District Magistrate (VNS)" },
  { label: "Agency (Varanasi)", email: "agency.varanasi.demo@samarth-demo.in", role: "UP Jal Nigam (Line Agency)" },
  { label: "Inspector (Varanasi)", email: "inspector.varanasi.demo@samarth-demo.in", role: "Field Technical Inspector" },
  { label: "State Nodal (UP)", email: "sno.up.demo@samarth-demo.in", role: "State Nodal Officer (UP)" },
  { label: "MoSPI", email: "mospi.demo@samarth-demo.in", role: "National Oversight" },
  { label: "Admin", email: "admin.demo@samarth-demo.in", role: "System Administrator" },
  { label: "Citizen", email: "citizen.demo@samarth-demo.in", role: "Public Social Auditor" },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sign in…" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeDemo, setActiveDemo] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(params.get("redirect") || "/dashboard");
  }, [isAuthenticated, isLoading, params, router]);

  async function executeLogin(targetEmail: string, targetPassword: string) {
    setError("");
    setSubmitting(true);
    try {
      await login(targetEmail, targetPassword);
      router.push(params.get("redirect") || "/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in was not successful. Please try again.");
    } finally {
      setSubmitting(false);
      setActiveDemo(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await executeLogin(email, password);
  }

  async function handleDemoLogin(accEmail: string, accLabel: string) {
    setEmail(accEmail);
    setPassword("Password@123");
    setActiveDemo(accLabel);
    await executeLogin(accEmail, "Password@123");
  }

  if (isLoading) return <LoadingState label="Checking your session…" />;

  return (
    <main className="grid min-h-screen bg-slate-50/50 lg:grid-cols-2">
      <section className="hidden bg-gradient-to-br from-amber-50/40 via-slate-50 to-sky-50/50 border-r border-slate-200/90 p-8 xl:p-12 text-slate-900 lg:flex lg:flex-col lg:justify-between relative overflow-hidden">
        {/* Subtle decorative background ambient glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-72 h-72 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center justify-between">
          <SamarthLogo
            size="lg"
            variant="light"
            showSubtitle={true}
            subtitle="Government of India · MPLADS Assurance"
            href="/"
          />
          <span className="hidden xl:inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 bg-white/90 border border-slate-200/90 px-3 py-1 rounded-full shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            सत्यमेव जयते
          </span>
        </div>

        {/* Architectural Centerpiece: Parliament of India Image */}
        <div className="relative z-10 my-auto py-6">
          <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-lg shadow-slate-200/60 backdrop-blur-xs">
            {/* Real Parliament Image Container */}
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-slate-200/90 shadow-xs group bg-slate-100">
              <img
                src="/images/parliament_of_india.jpg"
                alt="Parliament of India - Sansad Bhavan, New Delhi"
                className="h-full w-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
              />
              {/* Subtle tricolor top accent bar */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-white to-emerald-600" />

              {/* Architectural caption badge */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/50 to-transparent p-4 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-xs sm:text-sm font-bold tracking-wide text-white">
                      संसद भवन · Parliament of India
                    </p>
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-200 bg-white/20 border border-white/25 px-2 py-0.5 rounded backdrop-blur-xs">
                    New Delhi
                  </span>
                </div>
                <p className="text-[11px] text-slate-200 mt-1 font-medium">
                  Constitutional Authority for Members of Parliament Local Area Development Scheme
                </p>
              </div>
            </div>

            {/* Core Statutory Mandates */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2.5 text-center">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[10px] uppercase font-bold tracking-wider text-blue-700">Lok Sabha</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">543 Seats</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-700">Annual Fund</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">₹5.00 Cr / MP</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[10px] uppercase font-bold tracking-wider text-amber-700">Audit Rule</p>
                <p className="text-sm font-extrabold text-slate-900 mt-0.5">≤50m Spatial</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              A calm, accountable workspace for public-works delivery.
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 max-w-md">
              Statutory request routing connects MPs, District Magistrates, Executing Line Agencies, and Field Inspectors with complete audit transparency.
            </p>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-200/80">
          <span className="flex items-center gap-1.5 font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Digital Sansad &amp; MPLADS Architecture
          </span>
          <span className="font-semibold text-slate-600">MoSPI Guidelines Compliant</span>
        </div>
      </section>

      <section className="flex flex-col items-center justify-center p-5 sm:p-10">
        {/* Mobile-only Top Brand Header */}
        <div className="mb-6 lg:hidden">
          <SamarthLogo size="md" showSubtitle={true} subtitle="MPLADS Governance Portal" href="/" />
        </div>

        <Card className="w-full max-w-md shadow-xs border-slate-200">
          <CardHeader>
            <Link href="/" className="mb-4 inline-flex w-fit items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Home / Public Portal
            </Link>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-800">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Official sign in</CardTitle>
                <CardDescription>Use your authorised account to access a role-scoped workspace.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Email address
                <Input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@example.gov.in"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                Password
                <Input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in securely"}
              </Button>
            </form>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Quick Demo Sign-In
                </p>
                <span className="text-[11px] text-blue-600 font-medium">Click to sign in instantly</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => {
                  const isThisActive = activeDemo === acc.label;
                  return (
                    <button
                      key={acc.email}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDemoLogin(acc.email, acc.label)}
                      className={cn(
                        "flex flex-col items-start px-2.5 py-2 text-xs rounded-lg border transition-all text-left cursor-pointer",
                        isThisActive
                          ? "border-blue-500 bg-blue-50 text-blue-900 shadow-sm"
                          : "border-slate-200 bg-slate-50 hover:bg-blue-50/60 hover:border-blue-300 text-slate-800",
                        submitting && !isThisActive && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        {acc.label}
                        {isThisActive && <span className="inline-block h-2 w-2 rounded-full bg-blue-600 animate-ping" />}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate w-full">
                        {isThisActive ? "Signing in…" : acc.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-5 flex gap-2 text-xs leading-5 text-slate-500">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
              Access is logged and limited to your assigned role and jurisdiction.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
