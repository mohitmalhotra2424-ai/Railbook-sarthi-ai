"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MicIcon, SendIcon } from "./icons";
import { useVoiceInput } from "./voice/useVoiceInput";

/**
 * Home-screen composer. Handing off to the assistant uses the EXISTING chat
 * architecture: the message travels via ?q= and /chat performs the real turn.
 * No results are ever rendered or invented here.
 */
export function HomeComposer() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const onTranscript = (text: string) => {
    // Transcript lands in the composer for review/edit — never auto-sent.
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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      go(value);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid="home-composer"
      className="surface-shadow rounded-2xl border border-cream-300 bg-white p-2"
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
              voice.state === "recording" || voice.state === "processing"
                ? "animate-pulse bg-alert-500/10 text-alert-500"
                : "text-navy-500 hover:bg-navy-50 hover:text-navy-800"
            }`}
          >
            <MicIcon className="h-5 w-5" />
          </button>
        )}
        <textarea
          ref={areaRef}
          aria-label="Ask RailSaarthi"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Train, fare, timing… poochhein"
          className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-relaxed text-navy-900 placeholder:text-navy-400 focus:outline-none"
        />
        </div>
        <button
          type="submit"
          disabled={!value.trim()}
          className="flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-cream-50 transition hover:bg-navy-800 disabled:opacity-40 sm:w-auto"
        >
          <SendIcon className="h-4.5 w-4.5" />
          <span>Poochhein</span>
        </button>
      </div>
      {voice.message && (
        <p
          role="status"
          className={`px-2 pb-1.5 text-xs font-medium ${
            voice.state === "denied" || voice.state === "error" ? "text-alert-500" : "text-navy-600"
          }`}
        >
          {voice.message}
        </p>
      )}
      {voice.state === "recording" && (
        <p role="status" className="px-2 pb-1.5 text-xs font-medium text-signal-700">
          Sun raha hoon… boliye (tap mic to cancel)
        </p>
      )}
    </form>
  );
}
