import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RailSaarthi AI — Honest Railway Assistant",
    template: "%s · RailSaarthi AI",
  },
  description:
    "Railway assistant in Hindi, Hinglish and English. Live data only from authorized providers — never guessed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1c3a",
  // Mobile keyboards resize the visual viewport so the composer stays
  // reachable instead of being covered (keyboard-aware behaviour).
  interactiveWidget: "resizes-content",
};

const NAV = [
  { href: "/chat", label: "Assistant" },
  { href: "/trains", label: "Trains" },
  { href: "/disruptions", label: "Disruptions" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${devanagari.variable} h-full`}>
      <body className="flex h-full min-h-screen flex-col bg-cream-100 font-sans text-navy-950 antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-cream-50"
          >
            Skip to content
          </a>
          <header className="sticky top-0 z-40 border-b border-navy-800/40 bg-navy-950/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-saffron-500 text-lg font-bold text-navy-950"
                >
                  रे
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-bold text-cream-50">रेलसारथी</span>
                  <span className="block text-[10px] font-medium tracking-widest text-navy-200 uppercase">
                    RailSaarthi AI
                  </span>
                </span>
              </Link>
              <nav aria-label="Main" className="flex items-center gap-1 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full px-3 py-1.5 font-medium text-navy-100 transition hover:bg-navy-800 hover:text-cream-50"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main id="main" className="flex-1">
            {children}
          </main>

          <footer className="border-t border-cream-300 bg-cream-50">
            <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-xs text-navy-600">
              <p className="font-semibold text-navy-800">Honesty first / सच्चाई पहले</p>
              <p>
                RailSaarthi never invents train numbers, fares, availability, PNR status or
                timings. Results appear only from authorized data providers, each labelled with
                its source, retrieval time and freshness.
              </p>
              <p>
                Booking, payment and ticket issuance are disabled until an authorized booking
                integration is supplied.
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
