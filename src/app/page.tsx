import Link from "next/link";
import {
  BrandMark,
  CheckIcon,
  ClockIcon,
  PulseIcon,
  RupeeIcon,
  SearchIcon,
  SeatIcon,
  TicketIcon,
} from "@/components/icons";

const FEATURES = [
  { icon: SearchIcon, title: "Find Trains", desc: "Route ya naam se trains dhoundhein." },
  { icon: ClockIcon, title: "Timings & Routes", desc: "Stations, timings aur poora route." },
  { icon: RupeeIcon, title: "Fare & Classes", desc: "Class-wise kiram, ₹ me saaf-saaf." },
  { icon: SeatIcon, title: "Seat Availability", desc: "Available, RAC ya waitlist — as reported." },
  { icon: PulseIcon, title: "Live Train Status", desc: "Train kahan hai, kitni late hai." },
  { icon: TicketIcon, title: "PNR Status", desc: "Booking aur current status, passenger-wise." },
];

const EXAMPLES = [
  "Ludhiana se Delhi ki trains",
  "Kal ki trains aur timings",
  "3A mein seat availability",
  "Is train ka fare kitna hai?",
  "Train abhi kahan hai?",
  "PNR status check karna hai",
];

/** Decorative train-route line (aria-hidden) — identity, not data. */
function RouteGraphic() {
  return (
    <svg
      viewBox="0 0 320 56"
      aria-hidden
      className="mx-auto mt-8 w-full max-w-sm text-navy-300"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M12 40 C 90 12, 230 12, 308 40" strokeDasharray="1 7" />
      <circle cx="12" cy="40" r="4" fill="currentColor" stroke="none" />
      <circle cx="160" cy="21" r="3" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="308" cy="40" r="4" fill="var(--color-saffron-500)" stroke="none" />
      <g transform="translate(146 8)">
        <rect x="0" y="0" width="28" height="14" rx="4" fill="var(--color-saffron-500)" stroke="none" />
        <rect x="4" y="3" width="6" height="5" rx="1" fill="var(--color-navy-950)" stroke="none" />
        <rect x="13" y="3" width="6" height="5" rx="1" fill="var(--color-navy-950)" stroke="none" />
        <circle cx="7" cy="14" r="2.2" fill="var(--color-cream-50)" stroke="none" />
        <circle cx="21" cy="14" r="2.2" fill="var(--color-cream-50)" stroke="none" />
      </g>
    </svg>
  );
}

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-navy-950 px-4 pt-12 pb-12 text-center sm:pt-16 sm:pb-14">
        <div className="mx-auto max-w-2xl">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-navy-700 bg-navy-900 px-3 py-1 text-[11px] font-semibold text-navy-100">
            <BrandMark className="h-3.5 w-3.5 text-saffron-500" />
            Indian Railways · AI assistant
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-cream-50 sm:text-5xl">
            Your Journey, Simplified.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-navy-200 sm:text-base">
            Ask anything about Indian Railways in Hindi, Hinglish or English —
            trains, timings, fares, seat availability, routes and PNR status.
          </p>
          <Link
            href="/chat"
            data-testid="start-chatting"
            className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-saffron-500 px-8 text-[15px] font-bold text-navy-950 transition hover:bg-saffron-600 hover:text-cream-50"
          >
            Start Chatting
          </Link>
          <RouteGraphic />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-3xl px-4 pt-10">
        <h2 className="text-center text-lg font-bold text-navy-900">
          Ek assistant, poori railway jaankari
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-cream-300 bg-white p-3.5 sm:p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
                <f.icon className="h-4.5 w-4.5" />
              </span>
              <p className="mt-2.5 text-[13px] font-bold text-navy-900">{f.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-navy-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-3xl px-4 pt-9">
        <h2 className="text-center text-lg font-bold text-navy-900">How it works</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { t: "Ask a question", d: "Apni bhasha mein likhein ya bolein — koi form nahi." },
            { t: "Get railway information", d: "Assistant authorized providers se jaankari laata hai." },
            { t: "Explore the results", d: "Cards me timings, fare, availability — source ke saath." },
          ].map((s, i) => (
            <li key={s.t} className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-cream-50">
                {i + 1}
              </span>
              <p className="mt-2 text-[13px] font-bold text-navy-900">{s.t}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-navy-600">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Example questions */}
      <section className="mx-auto max-w-3xl px-4 pt-9">
        <h2 className="text-center text-sm font-bold text-navy-900">Try tapping one</h2>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((s) => (
            <Link
              key={s}
              href={`/chat?q=${encodeURIComponent(s)}`}
              data-testid="suggestion"
              className="rounded-full border border-cream-300 bg-white px-3.5 py-2 text-[13px] font-medium text-navy-800 transition hover:border-navy-300 hover:bg-navy-50"
            >
              {s}
            </Link>
          ))}
        </div>
      </section>

      {/* Honesty strip */}
      <section className="mx-auto max-w-3xl px-4 pt-9 pb-10">
        <div className="rounded-2xl border border-cream-300 bg-white p-4 sm:p-5">
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              { t: "Source on every answer", d: "Har result ke saath provider, time aur freshness." },
              { t: "No invented data", d: "Provider configured nahi? Seedha bola jayega — kabhi mock nahi." },
              { t: "Uncertainty is visible", d: "Sources disagree karein to dono values saaf dikhti hain." },
            ].map((f) => (
              <li key={f.t} className="flex gap-2.5">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-signal-500" />
                <span>
                  <span className="block text-[13px] font-semibold text-navy-900">{f.t}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-navy-600">{f.d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-cream-200 pt-3 text-xs leading-relaxed text-navy-500">
            Live operational answers depend on the authorized railway data providers configured
            for this deployment. Booking, payment and ticketing are disabled.
          </p>
        </div>
      </section>
    </div>
  );
}
