import Link from "next/link";
import { HomeComposer } from "@/components/HomeComposer";
import { TrustRow } from "@/components/TrustRow";
import { ArrowUpIcon, BrandMark } from "@/components/icons";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:pt-16">
      {/* Hero — calm, editorial, conversation-first. No stock photos. */}
      <header className="animate-rise text-center">
        <p className="text-[11px] font-bold tracking-[0.2em] text-navy-500 uppercase">
          AI Railway Assistant
        </p>
        <h1 className="font-display mt-3 text-[34px] leading-[1.1] font-semibold tracking-tight text-navy-950 sm:text-[46px]">
          Your journey starts with
          <br className="hidden sm:block" /> a conversation.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-navy-600">
          Tell RailSaarthi where you want to go, when you&apos;re travelling, and what
          you need. I&apos;ll find the right trains for you.
        </p>
      </header>

      {/* Primary interaction card */}
      <section
        aria-label="Ask the assistant"
        className="surface-shadow animate-rise mt-8 rounded-3xl border border-cream-300 bg-white p-4 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-900 text-white"
          >
            <BrandMark className="h-5.5 w-5.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-navy-950">Hi! Where would you like to go?</p>
            <p className="text-[12px] text-navy-500">Hindi, Hinglish ya English — boliye ya likhiye.</p>
          </div>
        </div>
        <div className="mt-4">
          <HomeComposer />
        </div>
      </section>

      {/* One clear path into the full assistant */}
      <div className="mt-5 text-center">
        <Link
          href="/chat"
          data-testid="start-chatting"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-navy-900 px-7 text-[13.5px] font-bold text-white transition hover:bg-navy-800 active:scale-[0.98]"
        >
          Open the assistant
          <ArrowUpIcon className="h-3.5 w-3.5 rotate-45" />
        </Link>
      </div>

      {/* Trust row — real capability only, never claimed when unavailable */}
      <div className="mt-8">
        <TrustRow />
      </div>

      {/* Honesty promises — compact */}
      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-navy-500">
        <span>Source on every answer</span>
        <span aria-hidden className="text-cream-400">·</span>
        <span>No invented data</span>
        <span aria-hidden className="text-cream-400">·</span>
        <span>Booking &amp; ticketing disabled</span>
      </p>
    </div>
  );
}
