import Link from "next/link";
import { HomeComposer } from "@/components/HomeComposer";
import { CheckIcon } from "@/components/icons";

const SUGGESTIONS = [
  "Amritsar se Delhi ki trains",
  "Meri train abhi kahan hai?",
  "Train ka fare aur timing",
  "PNR status check karna hai",
];

const CAPABILITIES = [
  "Train search",
  "Timetable",
  "Live status",
  "Seat availability",
  "Fare",
  "PNR status",
  "Cancellations",
];

export default function HomePage() {
  return (
    <div>
      {/* Hero + composer: the assistant IS the home screen. */}
      <section className="bg-navy-950 px-4 pt-10 pb-20 sm:pt-14 sm:pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-saffron-500 uppercase">
            Hindi · Hinglish · English
          </p>
          <h1 className="mt-3 text-[34px] leading-tight font-bold tracking-tight text-cream-50 sm:text-5xl">
            रेलसारथी <span className="text-navy-300">AI</span>
          </h1>
          <p className="mt-3 text-lg leading-snug font-semibold text-cream-50 sm:text-xl">
            Trains, fares, timings, live status, PNR — apni bhasha mein poochhein.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-navy-200">
            Likhiye ya boliye, jaise aap dost se poochhte hain. No forms, no fixed
            sequence — answers sirf authorized railway data se.
          </p>
        </div>
      </section>

      {/* Floating composer card overlapping the hero. */}
      <div className="mx-auto -mt-12 max-w-2xl px-4 sm:-mt-14">
        <HomeComposer />
        <p className="mt-2.5 text-center text-xs text-navy-500">
          Ya inme se shuru karein:
        </p>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
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
      </div>

      {/* What the assistant covers — one calm strip, not a card grid. */}
      <section className="mx-auto max-w-2xl px-4 pt-10">
        <h2 className="text-sm font-bold text-navy-900">What you can ask</h2>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Supported enquiry types">
          {CAPABILITIES.map((c) => (
            <li
              key={c}
              className="rounded-full bg-navy-50 px-3 py-1.5 text-xs font-semibold text-navy-700"
            >
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-xs leading-relaxed text-navy-500">
          Live operational answers depend on the authorized railway data providers
          configured for this deployment — jo configured hai, wahi dikhta hai.
        </p>
      </section>

      {/* Honesty strip. */}
      <section className="mx-auto max-w-2xl px-4 pt-8 pb-10">
        <div className="rounded-2xl border border-cream-300 bg-white p-4 sm:p-5">
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              {
                t: "Source on every answer",
                d: "Har result ke saath provider, time aur freshness.",
              },
              {
                t: "No invented data",
                d: "Provider configured nahi? Seedha bola jayega — kabhi mock nahi.",
              },
              {
                t: "Uncertainty is visible",
                d: "Sources disagree karein to dono values saaf dikhti hain.",
              },
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
        </div>
      </section>
    </div>
  );
}
