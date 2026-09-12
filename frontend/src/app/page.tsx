import Link from "next/link";
import {
  ArrowRight,
  MapPinned,
  ShieldCheck,
  UsersRound,
  Landmark,
  Building2,
  HardHat,
  Search,
  Camera,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  FileCheck2,
  Layers,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SamarthLogo } from "@/components/ui/samarth-logo";
import { ParliamentIllustration } from "@/components/ui/parliament-illustration";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* ── 1. Official National Navigation Header ── */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 py-3.5">
          {/* Top-Left: SAMARTH AI Logo & Name */}
          <SamarthLogo
            size="lg"
            showSubtitle={true}
            subtitle="Government of India · भारत सरकार"
            href="/"
          />

          {/* Nav Actions */}
          <nav className="flex items-center gap-2 sm:gap-3">
            <Button size="sm" variant="ghost" asChild className="text-slate-700 hover:text-blue-700 font-medium hidden sm:inline-flex">
              <Link href="/public">
                <Search className="h-3.5 w-3.5 mr-1.5 text-blue-600" />
                Find Public Works
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild className="border-slate-300 font-semibold text-slate-800 hover:bg-slate-100">
              <Link href="/public">Citizen Portal</Link>
            </Button>
            <Button size="sm" asChild className="bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs">
              <Link href="/login">
                Official Sign In <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* ── 2. Hero Section: नमस्ते भारत & Parliament of India ── */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-blue-50/20 to-slate-50 py-12 lg:py-20">
        {/* Background ambient lighting */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 left-10 w-72 h-72 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-10 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            {/* Left Hero Content */}
            <div className="flex flex-col items-start space-y-6">
              {/* 🇮🇳 NAMASTE BHARAT Banner (in Hindi) with Tricolor Badge */}
              <div className="inline-flex items-center gap-3 rounded-full border border-amber-300/80 bg-gradient-to-r from-amber-50 via-white to-emerald-50 px-4 py-2 shadow-xs">
                {/* Tricolor Dot Cluster */}
                <div className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF9933] shadow-xs" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white border border-slate-300 shadow-xs" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#138808] shadow-xs" />
                </div>
                <span className="text-base sm:text-lg font-black tracking-wide text-slate-900 font-serif">
                  नमस्ते भारत
                </span>
                <span className="hidden sm:inline-block text-slate-300">|</span>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  National Digital Public Works Assurance
                </span>
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl leading-[1.12]">
                Empowering India&apos;s Public Works with{" "}
                <span className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 bg-clip-text text-transparent">
                  AI Transparency &amp; Civic Trust
                </span>
              </h1>

              <p className="max-w-2xl text-base sm:text-lg text-slate-600 leading-relaxed">
                SAMARTH AI unites <strong>Citizens, Members of Parliament, District Magistrates, Executing Line Agencies,</strong> and <strong>Field Inspectors</strong> onto a unified, transparent delivery pipeline ensuring every public development rupee creates durable, verifiable community assets.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2 w-full sm:w-auto">
                <Button size="lg" asChild className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-base px-6 h-12 shadow-sm">
                  <Link href="/public">
                    <Search className="h-4 w-4 mr-2" />
                    Explore Works in Your Area
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="border-slate-300 text-slate-800 hover:bg-slate-100 font-semibold text-base px-5 h-12">
                  <Link href="/login">
                    <Landmark className="h-4 w-4 mr-2 text-indigo-600" />
                    Official Department Login
                  </Link>
                </Button>
              </div>

              {/* Institutional Key Highlights */}
              <div className="pt-4 border-t border-slate-200/90 grid grid-cols-3 gap-4 w-full text-left">
                <div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900">543</div>
                  <div className="text-xs text-slate-500 font-medium">Constituencies Monitored</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-700">₹5.00 Cr</div>
                  <div className="text-xs text-slate-500 font-medium">Annual Entitlement / MP</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black text-blue-700">&le; 50m</div>
                  <div className="text-xs text-slate-500 font-medium">Spatial Duplicate Rule</div>
                </div>
              </div>
            </div>

            {/* Right Hero Showcase: Parliament of India Reference Artwork */}
            <div className="relative">
              <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xl relative overflow-hidden">
                {/* Top Corner Ribbon */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                      Constitutional &amp; Parliamentary Mandate
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    MPLADS Digital
                  </span>
                </div>

                {/* Parliament Illustration Vector */}
                <ParliamentIllustration
                  variant="outline"
                  showCaption={true}
                  captionTitle="संसद भवन · Parliament of India"
                  captionSubtitle="Supreme Legislative Authority for Members of Parliament Local Area Development Scheme"
                />

                {/* Statutory Governance Ribbon */}
                <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Lok Sabha &amp; Rajya Sabha</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>MoSPI Statutory Norms</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>15% SC / 7.5% ST Quota</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>100% Geo-tagged Auditing</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. 5-Stage Transparent Request Routing ("Verify Request Going to Which User") ── */}
      <section className="py-16 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
            End-to-End Governance Architecture
          </p>
          <h2 className="mt-2 text-3xl font-extrabold text-slate-950 sm:text-4xl">
            5-Stage Transparent Request Routing
          </h2>
          <p className="mt-3 max-w-2xl mx-auto text-sm sm:text-base text-slate-600">
            Every community work in SAMARTH AI transparently displays who holds the decision ballot, active statutory SLAs, and real-time execution hand-offs.
          </p>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Stage 1 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left flex flex-col justify-between hover:border-blue-400 hover:bg-white transition-all shadow-2xs">
              <div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 text-blue-800 font-bold text-xs mb-3">
                  01
                </div>
                <h3 className="font-bold text-slate-900 text-sm">MP Recommendation</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Originating MP proposes community asset with automated spatial duplicate checks (&le;50m rule).
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-bold text-blue-700">
                Custodian: Hon. Member of Parliament
              </div>
            </div>

            {/* Stage 2 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left flex flex-col justify-between hover:border-blue-400 hover:bg-white transition-all shadow-2xs">
              <div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 font-bold text-xs mb-3">
                  02
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Admin Sanction (AS)</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  District Magistrate / Collector vets feasibility, issues formal AS Order Ref, and allocates agency.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-bold text-indigo-700">
                Custodian: District Authority (DM)
              </div>
            </div>

            {/* Stage 3 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left flex flex-col justify-between hover:border-blue-400 hover:bg-white transition-all shadow-2xs">
              <div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 text-purple-800 font-bold text-xs mb-3">
                  03
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Civil Execution</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Line Agency (UP Jal Nigam, PWD) mobilizes site, records milestones, and requests tranche drawdowns.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-bold text-purple-700">
                Custodian: Executing Line Agency
              </div>
            </div>

            {/* Stage 4 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left flex flex-col justify-between hover:border-blue-400 hover:bg-white transition-all shadow-2xs">
              <div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-xs mb-3">
                  04
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Field Inspection</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Technical Inspector receives dispatch, conducts on-site GPS verification, and submits quality report.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-bold text-emerald-700">
                Custodian: Field Quality Inspector
              </div>
            </div>

            {/* Stage 5 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-left flex flex-col justify-between hover:border-blue-400 hover:bg-white transition-all shadow-2xs">
              <div>
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-800 font-bold text-xs mb-3">
                  05
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Tranche Disbursal</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  DA scrutinizes Measurement Book and disburses tranche payment via PFMS with SNO &amp; MoSPI oversight.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] font-bold text-amber-700">
                Custodian: District Authority / SNO
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Multi-Role Portal Gateways ── */}
      <section className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">
              Tailored Role Command Centers
            </p>
            <h2 className="mt-2 text-3xl font-extrabold text-slate-950 sm:text-4xl">
              Dedicated Workspaces for Every Public Stakeholder
            </h2>
            <p className="mt-3 text-slate-600 text-sm sm:text-base">
              Each user operates within an authorized, jurisdiction-scoped command center engineered specifically for their constitutional role.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* MP Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-blue-100 text-blue-700">
                  <Landmark className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Member of Parliament (MP)</h3>
                  <p className="text-xs text-slate-500">Lok Sabha &amp; Rajya Sabha</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Constituency Command Center: recommend high-impact works, monitor ₹5.00 Cr annual entitlement, verify &le;50m spatial duplicates, and generate Civic Delivery Dossiers.
              </p>
              <Button size="sm" variant="outline" asChild className="w-full justify-between text-xs font-semibold">
                <Link href="/login">
                  Open MP Portal <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {/* District Authority Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-indigo-100 text-indigo-700">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">District Authority (DM / DC)</h3>
                  <p className="text-xs text-slate-500">District Magistrate &amp; Collector</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                District Review &amp; Sanction: vet MP recommendations, accord Administrative Sanctions (AS), assign executing line agencies, dispatch field inspectors, and release tranches.
              </p>
              <Button size="sm" variant="outline" asChild className="w-full justify-between text-xs font-semibold">
                <Link href="/login">
                  Open District Portal <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {/* Implementing Line Agency Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-purple-100 text-purple-700">
                  <HardHat className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Implementing Line Agency</h3>
                  <p className="text-xs text-slate-500">UP Jal Nigam, PWD, RES, CPWD</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Agency Command Center: monitor assigned civil contracts, record physical progress milestone percentages, request tranche drawdowns, and trigger joint field inspections.
              </p>
              <Button size="sm" variant="outline" asChild className="w-full justify-between text-xs font-semibold">
                <Link href="/login">
                  Open Agency Hub <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {/* Field Quality Inspector Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-emerald-100 text-emerald-700">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Field Technical Inspector</h3>
                  <p className="text-xs text-slate-500">District Quality Evaluator</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Inspection Mobile Hub: view dispatched tasks, navigate shortest path to site, capture tamper-proof GPS photos, verify Measurement Book, and submit sign-offs.
              </p>
              <Button size="sm" variant="outline" asChild className="w-full justify-between text-xs font-semibold">
                <Link href="/login">
                  Open Inspector Queue <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {/* State Nodal Officer (SNO) Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-amber-100 text-amber-800">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">State Nodal Officer (SNO)</h3>
                  <p className="text-xs text-slate-500">State Secretariat Oversight</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                State Secretariat Hub: Statewide Risk Heatmap, bottleneck escalations, inter-district fund reallocations, 10% mandatory physical audit tracking, and DM directive memos.
              </p>
              <Button size="sm" variant="outline" asChild className="w-full justify-between text-xs font-semibold">
                <Link href="/login">
                  Open State Portal <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {/* Citizen Social Auditor Card */}
            <div className="rounded-2xl border-2 border-blue-600 bg-blue-50/40 p-6 shadow-xs hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-xl bg-blue-600 text-white">
                  <UsersRound className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Public Citizen &amp; Social Auditor</h3>
                  <p className="text-xs text-blue-700 font-semibold">Open to All Citizens of India</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Citizen Social Audit: Search works by constituency, scan project QR codes, capture ground photos to report stalled or defective assets, and track authority resolution.
              </p>
              <Button size="sm" asChild className="w-full justify-between text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white">
                <Link href="/public">
                  Launch Citizen Portal <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Official Footer ── */}
      <footer className="border-t border-slate-200 bg-white mt-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-col items-center md:items-start">
              <SamarthLogo size="md" showSubtitle={true} subtitle="Members of Parliament Local Area Development Scheme" />
              <p className="text-xs text-slate-500 mt-2 text-center md:text-left">
                Empowering accountable public asset delivery across all 543 Parliamentary Constituencies of India.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-600 font-medium">
              <Link href="/public" className="hover:text-blue-600 transition-colors">Public Works Explorer</Link>
              <Link href="/login" className="hover:text-blue-600 transition-colors">Official Sign In</Link>
              <Link href="/dashboard/agency" className="hover:text-blue-600 transition-colors">Implementing Agency Hub</Link>
              <Link href="/dashboard/mp" className="hover:text-blue-600 transition-colors">MP Command Center</Link>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-3">
            <p>© 2026 SAMARTH AI · Smart MPLADS Delivery &amp; Real-Time Governance Assurance</p>
            <p className="text-center sm:text-right">MoSPI Guidelines Compliant · Open Governance Architecture</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
