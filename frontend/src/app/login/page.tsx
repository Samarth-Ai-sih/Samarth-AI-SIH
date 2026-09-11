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

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin.demo@samarth-demo.in", role: "System Admin" },
  { label: "District Auth", email: "district.lucknow.demo@samarth-demo.in", role: "District Authority (Lucknow)" },
  { label: "Inspector", email: "inspector.lucknow.demo@samarth-demo.in", role: "Field Inspector (Lucknow)" },
  { label: "State Nodal", email: "sno.up.demo@samarth-demo.in", role: "State Nodal (UP)" },
  { label: "MP", email: "mp.varanasi.demo@samarth-demo.in", role: "MP (Varanasi)" },
  { label: "Agency", email: "agency.delhi.demo@samarth-demo.in", role: "Agency (Delhi)" },
  { label: "MoSPI", email: "mospi.demo@samarth-demo.in", role: "MoSPI Officer" },
  { label: "Citizen", email: "citizen.demo@samarth-demo.in", role: "Citizen User" },
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

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(params.get("redirect") || "/dashboard");
  }, [isAuthenticated, isLoading, params, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      router.push(params.get("redirect") || "/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in was not successful. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <LoadingState label="Checking your session…" />;

  return (
    <main className="grid min-h-screen bg-slate-50/50 lg:grid-cols-2">
      <section className="hidden bg-white border-r border-slate-200 p-12 text-slate-900 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-950">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white font-black">S</span>
          SAMARTH AI
        </Link>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Role-based operations</p>
          <h1 className="mt-4 max-w-md text-4xl font-bold leading-tight text-slate-900">
            A calm, accountable workspace for public-works delivery.
          </h1>
          <p className="mt-5 max-w-md text-slate-600">
            Use scoped queues to record progress, inspect evidence, manage case decisions, and preserve an audit trail.
          </p>
        </div>
        <p className="text-xs text-slate-400">Independent demonstration interface · no official branding represented</p>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-10">
        <Card className="w-full max-w-md shadow-xs border-slate-200">
          <CardHeader>
            <Link href="/" className="mb-6 inline-flex w-fit items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
              <ArrowLeft className="h-4 w-4" />
              Back to public portal
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
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Quick Demo Sign-In
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword("Password@123");
                      setError("");
                    }}
                    className="flex flex-col items-start px-2 py-1.5 text-xs rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-left transition-colors"
                  >
                    <span className="font-semibold text-slate-800">{acc.label}</span>
                    <span className="text-[10px] text-slate-500 truncate w-full">{acc.role}</span>
                  </button>
                ))}
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
