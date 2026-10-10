import Link from "next/link";

const CAPABILITIES = [
  { title: "Train search", hi: "ट्रेन खोज", href: "/trains" },
  { title: "Train details", hi: "ट्रेन विवरण", href: "/trains" },
  { title: "Timetable", hi: "टाइमटेबल", href: "/trains" },
  { title: "Live status", hi: "लाइव स्टेटस", href: "/trains" },
  { title: "Seat availability", hi: "सीट उपलब्धता", href: "/trains" },
  { title: "Fare", hi: "किराया", href: "/trains" },
  { title: "PNR status", hi: "PNR स्थिति", href: "/#pnr" },
  { title: "Cancellations", hi: "रद्द ट्रेनें", href: "/disruptions" },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-navy-950 via-navy-900 to-navy-800 px-4 pt-12 pb-14 text-center sm:pt-16">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.25em] text-saffron-500 uppercase">
            Hindi · Hinglish · English
          </p>
          <h1 className="mt-3 text-4xl font-bold text-cream-50 sm:text-5xl">
            रेलसारथी <span className="text-navy-200">AI</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-navy-100 sm:text-base">
            Your honest railway assistant. Ask about trains, PNR, fares and live
            status — get answers only from authorized data providers, always
            labelled with source and freshness. Never guessed.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/chat"
              className="w-full rounded-full bg-saffron-500 px-6 py-3 text-sm font-bold text-navy-950 transition hover:bg-saffron-600 hover:text-cream-50 sm:w-auto"
            >
              Chat with RailSaarthi
            </Link>
            <Link
              href="/trains"
              className="w-full rounded-full border border-navy-400 px-6 py-3 text-sm font-semibold text-cream-50 transition hover:bg-navy-800 sm:w-auto"
            >
              Search trains
            </Link>
          </div>
        </div>
      </section>

      {/* Capability grid */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="text-center text-lg font-bold text-navy-900">
          What RailSaarthi covers
        </h2>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="rounded-2xl border border-cream-300 bg-cream-50 p-4 text-center shadow-sm transition hover:border-navy-300"
            >
              <p className="text-sm font-semibold text-navy-900">{c.title}</p>
              <p className="mt-0.5 text-xs text-navy-500">{c.hi}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* PNR hint */}
      <section id="pnr" className="mx-auto max-w-5xl px-4 pb-10">
        <div className="rounded-3xl border border-cream-300 bg-cream-50 p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-bold text-navy-900">PNR status / PNR स्थिति</h2>
          <p className="mt-1 text-xs text-navy-600">
            Ask the assistant with your 10-digit PNR (e.g. “PNR 1234567890 ka
            status?”), or open a PNR page directly at /pnr/&lt;your-pnr&gt;.
          </p>
          <Link
            href="/chat"
            className="mt-3 inline-block rounded-full border border-navy-300 px-4 py-2 text-xs font-semibold text-navy-800 transition hover:bg-navy-50"
          >
            Check PNR via assistant
          </Link>
        </div>
      </section>

      {/* Honesty promise */}
      <section className="border-t border-cream-300 bg-cream-50 px-4 py-10">
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3">
          {[
            {
              title: "Source on every answer",
              body: "Every result shows its provider, retrieval timestamp and freshness status.",
            },
            {
              title: "No invented data",
              body: "No live provider configured? You see that message — never mock trains, fares or PNR statuses.",
            },
            {
              title: "Uncertainty is visible",
              body: "When sources disagree, both values are shown with a clear uncertainty notice.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-cream-300 bg-white p-4">
              <p className="text-sm font-semibold text-navy-900">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-navy-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
