"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BrandMark, MicIcon, SendIcon } from "./icons";
import { useVoiceInput } from "./voice/useVoiceInput";

const TRY_ASKING = [
  "Kal Amritsar se Delhi ki trains dikhao",
  "12014 ka timetable batao",
  "Is train ki current availability check karo",
  "3A ka fare batao",
];

/**
 * Home composer card ("Ready to help you"). Handoff uses the EXISTING chat
 * architecture: the message travels via ?q= and /chat performs the real turn.
 * Nothing is rendered or invented here.
 */
export function HomeComposer() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLInputElement>(null);

  const onTranscript = (text: string) => {
    // Transcript lands in the input for review/edit — never auto-sent.
    setValue((prev) => (prev.trim() ? `${prev} ${text}` : text));
    areaRef.current?.focus();
  };
  const voice = useVoiceInput({ lang: "hi-IN", onTranscript });

  function go(text: string) {
    const t = text.trim();
    if (!t) return;
    router.push(`/chat?q=${encodeURIComponent(t)}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(value);
  }

  return (
    <div className="surface-shadow rounded-2xl bg-navy-900 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
          <svg viewBox="0 0 24 24" aria-hidden className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.5h16v10H9l-5 4v-14Z" />
            <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-bold text-white">Ready to help you</p>
          <p className="text-[11px] text-navy-200">Ask your railway query below</p>
        </div>
      </div>

      <form onSubmit={onSubmit} data-testid="home-composer" className="mt-3.5 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-full bg-white py-1 pr-1 pl-1.5">
          {voice.supported && (
            <button
              type="button"
              data-testid="home-mic"
              aria-label={
                voice.state === "recording" || voice.state === "processing"
                  ? "Cancel voice input"
                  : "Start voice input"
              }
              onClick={() =>
                voice.state === "recording" || voice.state === "processing"
                  ? voice.cancel()
                  : voice.start()
              }
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                voice.state === "recording" || voice.state === "processing"
                  ? "animate-pulse bg-alert-500/10 text-alert-500"
                  : "text-navy-500 hover:bg-navy-50 hover:text-navy-700"
              }`}
            >
              <MicIcon className="h-4.5 w-4.5" />
            </button>
          )}
          <input
            ref={areaRef}
            aria-label="Ask RailSaarthi"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(value);
              }
            }}
            placeholder="Type your message…"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-navy-900 placeholder:text-navy-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send to assistant"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-600 text-white transition hover:bg-navy-500 disabled:opacity-40"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </form>
      {(voice.state === "recording" || voice.state === "processing" || voice.message) && (
        <p
          role="status"
          className={`mt-1.5 text-[11px] font-medium ${
            voice.state === "denied" || voice.state === "error" ? "text-alert-500" : "text-navy-200"
          }`}
        >
          {voice.state === "recording" && "Sun raha hoon… boliye (tap mic to cancel)"}
          {voice.state === "processing" && "…samajh raha hoon"}
          {voice.message}
        </p>
      )}

      <p className="mt-3 text-[11px] font-medium text-navy-200">Try asking:</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {TRY_ASKING.map((s) => (
          <button
            key={s}
            type="button"
            data-testid="suggestion"
            onClick={() => go(s)}
            className="rounded-full border border-navy-700 bg-navy-800 px-3 py-1.5 text-[11px] font-medium text-navy-100 transition hover:border-navy-500 hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>

      <p className="mt-3.5 flex items-center gap-1.5 border-t border-navy-800 pt-2.5 text-[10px] font-medium text-navy-300">
        <BrandMark className="h-3.5 w-3.5 text-saffron-400" />
        Real train data · Trusted information · Always with you
      </p>
    </div>
  );
}
