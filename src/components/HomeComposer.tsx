"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, MicIcon } from "./icons";
import { useVoiceInput } from "./voice/useVoiceInput";

const TRY_ASKING = [
  "Amritsar se Delhi kal",
  "Morning trains to Delhi",
  "Check seat availability",
  "Track my train",
];

/**
 * Home composer card. Handoff uses the EXISTING chat architecture: the
 * message travels via ?q= and /chat performs the real turn. Nothing is
 * rendered or invented here. Voice stays tap-to-talk; typing always works.
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

  const listening = voice.state === "recording" || voice.state === "processing";

  return (
    <div data-testid="home-composer">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-[22px] border border-cream-300 bg-cream-50 p-1.5 transition focus-within:border-navy-400 focus-within:ring-4 focus-within:ring-navy-500/10">
          {voice.supported && (
            <button
              type="button"
              data-testid="home-mic"
              aria-label={listening ? "Cancel voice input" : "Start voice input"}
              onClick={() => (listening ? voice.cancel() : voice.start())}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                listening
                  ? "mic-live bg-navy-900 text-white"
                  : "bg-navy-900 text-white hover:bg-navy-800 active:scale-95"
              }`}
            >
              <MicIcon className="h-5 w-5" />
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
            placeholder="Try: Amritsar se Delhi kal jaana hai..."
            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] text-navy-950 placeholder:text-navy-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send to assistant"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-600 text-white transition hover:bg-navy-500 active:scale-95 disabled:opacity-40"
          >
            <ArrowUpIcon className="h-5 w-5" />
          </button>
        </div>
      </form>

      {(listening || voice.message) && (
        <p
          role="status"
          className={`mt-2 text-[12px] font-medium ${
            voice.state === "denied" || voice.state === "error" ? "text-alert-500" : "text-navy-600"
          }`}
        >
          {voice.state === "recording" && "Sun raha hoon… boliye (tap mic to cancel)"}
          {voice.state === "processing" && "…samajh raha hoon"}
          {voice.message}
        </p>
      )}

      <p className="mt-4 text-[12px] font-semibold text-navy-500">Try asking</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {TRY_ASKING.map((s) => (
          <button
            key={s}
            type="button"
            data-testid="suggestion"
            onClick={() => go(s)}
            className="rounded-full border border-cream-300 bg-cream-50 px-3.5 py-2 text-[12.5px] font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900 active:scale-[0.98]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
