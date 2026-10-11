import Image from "next/image";
import Link from "next/link";
import { HomeComposer } from "@/components/HomeComposer";
import {
  CheckIcon,
  ClockIcon,
  PulseIcon,
  RupeeIcon,
  SearchIcon,
  SeatIcon,
  TicketIcon,
} from "@/components/icons";

const FEATURES = [
  { icon: SearchIcon, title: "Find Trains", desc: "Between stations", href: "/trains" },
  { icon: ClockIcon, title: "Timings & Routes", desc: "Schedules & stops", href: "/chat?q=Kal%20ki%20trains%20aur%20timings" },
  { icon: RupeeIcon, title: "Fare & Classes", desc: "Compare & plan", href: "/chat?q=Is%20train%20ka%20fare%20kitna%20hai%3F" },
  { icon: SeatIcon, title: "Seat Availability", desc: "Live updates", href: "/chat?q=3A%20mein%20seat%20availability" },
  { icon: PulseIcon, title: "Live Train Status", desc: "Track your train", href: "/chat?q=Train%20abhi%20kahan%20hai%3F" },
  { icon: TicketIcon, title: "PNR Status", desc: "Check your booking", href: "/chat?q=PNR%20status%20check%20karna%20hai" },
];

export default function HomePage() {
  return (
    <div className="bg-cream-100">
      {/* Hero */}
      <section className="relative bg-navy-950">
        <div className="mx-auto max-w-3xl px-4 pt-10 pb-6 sm:pt-14">
          <h1 className="font-display text-4xl leading-[1.1] font-semibold tracking-tight text-white sm:text-5xl">
            Your Journey,
            <br />
            <span className="text-saffron-500 italic">Simplified.</span>
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-navy-100 sm:text-[15px]">
            Ask anything about Indian Railways in Hindi, Hinglish or English —
            trains, timings, fares, seat availability, routes and PNR status.
          </p>
          <Link
            href="/chat"
            data-testid="start-chatting"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-saffron-500 px-8 text-sm font-bold text-white transition hover:bg-saffron-600 active:scale-[0.98]"
          >
            Start Chatting
          </Link>
        </div>
        <div className="relative h-40 sm:h-52">
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

      {/* Feature sheet overlapping the hero image */}
      <div className="mx-auto -mt-8 max-w-3xl px-4">
        <div className="surface-shadow grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-cream-300 bg-cream-200 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className="flex flex-col items-center gap-1.5 bg-white px-3 py-4 text-center transition hover:bg-navy-50"
            >
              <f.icon className="h-5 w-5 text-navy-600" />
              <span className="text-[12px] leading-tight font-bold text-navy-900">{f.title}</span>
              <span className="text-[10px] text-navy-500">{f.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Composer card */}
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <HomeComposer />
      </div>

      {/* How it works */}
      <section className="mx-auto max-w-3xl px-4 pt-8">
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
    </div>
  );
}
