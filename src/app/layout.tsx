import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Fraunces, Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BrandMark } from "@/components/icons";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fraunces",
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
    default: "RailSaarthi AI — Your AI Railway Assistant",
    template: "%s · RailSaarthi AI",
  },
  description:
    "Railway assistant in Hindi, Hinglish and English. Ask about trains, fares, timings, live status and PNR in your own words. Live data only from authorized providers — never guessed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#081f1a",
  // Mobile keyboards resize the visual viewport so the composer stays
  // reachable instead of being covered (keyboard-aware behaviour).
  interactiveWidget: "resizes-content",
};

const NAV = [
  { href: "/chat", label: "Assistant", mobile: true },
  { href: "/trains", label: "Trains", mobile: true },
  { href: "/disruptions", label: "Disruptions", mobile: false },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${devanagari.variable} ${fraunces.variable} h-full`}>
      <body className="flex h-full min-h-dvh flex-col bg-cream-100 font-sans text-navy-950 antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-cream-50"
          >
            Skip to content
          </a>
          <header className="sticky top-0 z-40 bg-navy-950">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
              <Link
                href="/"
                aria-label="RailSaarthi AI — home"
                className="flex min-w-0 items-center gap-2.5 rounded-lg"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-saffron-500 text-navy-950"
                >
                  <BrandMark className="h-5.5 w-5.5" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="font-display block truncate text-[15px] font-semibold tracking-tight text-cream-50">
                    RailSaarthi AI
                  </span>
                  <span className="hidden truncate text-[10px] font-medium text-navy-300 min-[400px]:block">
                    रेलसारथी · your AI railway assistant
                  </span>
                </span>
              </Link>
              <nav aria-label="Main" className="flex shrink-0 items-center gap-0.5 text-sm">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-3 py-2 font-medium text-navy-100 transition hover:bg-navy-800 hover:text-cream-50 ${
                      item.mobile ? "" : "hidden sm:block"
                    }`}
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
            <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-5 text-xs text-navy-600 sm:flex-row sm:items-center sm:justify-between">
              <p>
                <span className="font-semibold text-navy-800">सच्चाई पहले · Honesty first.</span>{" "}
                Results appear only from authorized providers, labelled with source and
                freshness. Booking &amp; ticketing are disabled.
              </p>
              <p className="shrink-0">
                <Link href="/trains" className="font-medium text-navy-700 underline-offset-2 hover:underline">
                  Trains
                </Link>
                <span aria-hidden className="mx-1.5 text-navy-300">·</span>
                <Link href="/disruptions" className="font-medium text-navy-700 underline-offset-2 hover:underline">
                  Disruptions
                </Link>
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
