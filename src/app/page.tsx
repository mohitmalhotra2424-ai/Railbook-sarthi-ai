import Image from "next/image";
import Link from "next/link";
import { HomeComposer } from "@/components/HomeComposer";
import {
  BrandMark,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  HomeIcon,
  PulseIcon,
  RupeeIcon,
  SearchIcon,
  SeatIcon,
  TicketIcon,
} from "@/components/icons";

const FEATURES = [
  { icon: SearchIcon, title: "Find Trains", desc: "Search by source, destination & date", href: "/trains", tint: "bg-navy-50 text-navy-700" },
  { icon: PulseIcon, title: "Live Train Status", desc: "Track your train in real-time", href: "/chat?q=Train%20abhi%20kahan%20hai%3F", tint: "bg-signal-500/10 text-signal-700" },
  { icon: TicketIcon, title: "PNR Status", desc: "Check your booking status", href: "/chat?q=PNR%20status%20check%20karna%20hai", tint: "bg-saffron-500/10 text-saffron-600" },
  { icon: ClockIcon, title: "Timings & Routes", desc: "Schedules & stops", href: "/chat?q=Kal%20ki%20trains%20aur%20timings", tint: "bg-saffron-500/10 text-saffron-600" },
  { icon: RupeeIcon, title: "Fare & Classes", desc: "Compare & plan", href: "/chat?q=Is%20train%20ka%20fare%20kitna%20hai%3F", tint: "bg-signal-500/10 text-signal-700" },
  { icon: SeatIcon, title: "Seat Availability", desc: "Class-wise live updates", href: "/chat?q=3A%20mein%20seat%20availability", tint: "bg-navy-50 text-navy-700" },
];

const POPULAR_SEARCHES = [
  "Delhi → Mumbai",
  "Mumbai → Pune",
  "Tatkal",
  "Vande Bharat",
  "Shatabdi",
  "RAC vs Waitlist",
];

export default function HomePage() {
  return (
    <div className="bg-cream-100 pb-20 md:pb-0">
      {/* Hero — brand headline + the existing ask-anything composer */}
      <section className="relative bg-navy-950">
        <div className="mx-auto max-w-3xl px-4 pt-8 pb-8 sm:pt-12">
          <h1 className="font-display text-4xl leading-[1.12] font-semibold tracking-tight text-white sm:text-5xl">
            Plan. Track. Travel.
            <br />
            <span className="text-saffron-500 italic">With Your AI Sarthi.</span>
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-navy-100 sm:text-[15px]">
            Ask anything about Indian Railways in Hindi, Hinglish or English —
            trains, timings, fares, seat availability, routes and PNR status.
          </p>
          <div className="mt-5">
            <HomeComposer />
          </div>
          <Link
            href="/chat"
            data-testid="start-chatting"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-saffron-500 px-7 text-sm font-bold text-white transition hover:bg-saffron-600 active:scale-[0.98]"
          >
            Start Chatting
          </Link>
        </div>
        <div className="relative h-36 sm:h-48">
          <Image
            src="/hero-train.jpg"
            alt="A modern Indian express train crossing a viaduct at sunset"
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-navy-950 via-navy-950/20 to-transparent" />
        </div>
      </section>

      {/* Quick actions — only real, wired capabilities */}
      <div className="mx-auto -mt-6 max-w-3xl px-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className="surface-shadow flex flex-col items-start gap-2 rounded-2xl border border-cream-300 bg-white px-3.5 py-3.5 transition hover:border-navy-300"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${f.tint}`}>
                <f.icon className="h-5 w-5" />
              </span>
              <span className="text-[13px] leading-tight font-bold text-navy-900">{f.title}</span>
              <span className="text-[10.5px] leading-snug text-navy-500">{f.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Popular searches — suggestion queries, not data */}
      <section className="mx-auto max-w-3xl px-4 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-navy-900">
            <span aria-hidden className="text-saffron-500">🔥</span> Popular Searches
          </h2>
          <Link href="/trains" className="text-[11px] font-semibold text-navy-600 hover:text-navy-800">
            View all
          </Link>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {POPULAR_SEARCHES.map((s) => (
            <Link
              key={s}
              href={`/chat?q=${encodeURIComponent(s)}`}
              className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[11px] font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50"
            >
              {s}
            </Link>
          ))}
        </div>
      </section>

      {/* Travel-smart promo — reuses the existing local asset */}
      <section className="mx-auto max-w-3xl px-4 pt-5">
        <Link
          href="/chat"
          className="surface-shadow relative block overflow-hidden rounded-2xl border border-cream-300 bg-navy-900"
        >
          <Image
            src="/hero-train.jpg"
            alt=""
            aria-hidden
            width={1200}
            height={500}
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
          <div className="relative bg-gradient-to-r from-navy-950/90 via-navy-950/60 to-transparent p-4">
            <p className="font-display text-lg font-semibold text-white">Travel Smart with RailSaarthi</p>
            <p className="mt-1 text-[11px] leading-relaxed text-navy-100">
              Real-time data · Accurate info · Hassle-free journey
            </p>
          </div>
        </Link>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-3xl px-4 pt-7">
        <h2 className="font-display text-lg font-semibold text-navy-900">How it works</h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            { t: "Ask a question", d: "Likhein ya bolein — koi form nahi." },
            { t: "Get railway information", d: "Authorized providers se jaankari." },
            { t: "Explore the results", d: "Cards me timings, fare, availability." },
          ].map((s, i) => (
            <li key={s.t} className="flex gap-2.5 rounded-xl border border-cream-300 bg-white p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-600 text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <span>
                <span className="block text-[12px] font-bold text-navy-900">{s.t}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-navy-600">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Honesty */}
      <section className="mx-auto max-w-3xl px-4 pt-6 pb-8">
        <div className="rounded-xl border border-cream-300 bg-white p-3.5">
          <ul className="grid gap-2.5 sm:grid-cols-3">
            {[
              { t: "Source on every answer", d: "Provider, time aur freshness har result ke saath." },
              { t: "No invented data", d: "Provider nahi? Seedha bola jayega — mock kabhi nahi." },
              { t: "Uncertainty is visible", d: "Sources disagree karein to dono values dikhti hain." },
            ].map((f) => (
              <li key={f.t} className="flex gap-2">
                <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" />
                <span>
                  <span className="block text-[12px] font-semibold text-navy-900">{f.t}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-navy-600">{f.d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 border-t border-cream-200 pt-2.5 text-[11px] text-navy-500">
            Live answers depend on configured authorized providers. Booking, payment and
            ticketing are disabled.
          </p>
        </div>
      </section>

      {/* Bottom tab bar — presentation-only links to existing routes */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-300 bg-white/95 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {[
            { href: "/", label: "Home", icon: HomeIcon, active: true },
            { href: "/chat", label: "Chat", icon: ChatIcon, active: false },
            { href: "/trains", label: "Trains", icon: BrandMark, active: false },
            { href: "/chat?q=PNR%20status%20check%20karna%20hai", label: "PNR", icon: TicketIcon, active: false },
          ].map((t) => (
            <Link
              key={t.label}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold ${
                t.active ? "text-navy-800" : "text-navy-400 hover:text-navy-600"
              }`}
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
