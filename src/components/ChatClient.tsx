"use client";

import { useState, type FormEvent } from "react";
import { FreshnessPill } from "./FreshnessPill";
import { SourceBadge } from "./SourceBadge";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  meta?: {
    sources: { providerId: string; authorization: string }[];
    retrievedAt: string | null;
    freshness: "fresh" | "stale" | "unknown" | null;
    notConfigured: boolean;
  };
}

const SUGGESTIONS = [
  "PNR 1234567890 ka status?",
  "दिल्ली से मुंबई ट्रेन",
  "Aaj cancelled trains",
  "Namaste!",
];

export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const json = (await res.json()) as {
        text?: string;
        sources?: { providerId: string; authorization: string }[];
        retrievedAt?: string | null;
        freshness?: "fresh" | "stale" | "unknown" | null;
        notConfigured?: boolean;
        error?: { message?: string };
      };
      setMessages((m) => [
        ...m,
        json.text
          ? {
              role: "assistant",
              text: json.text,
              meta: {
                sources: json.sources ?? [],
                retrievedAt: json.retrievedAt ?? null,
                freshness: json.freshness ?? null,
                notConfigured: json.notConfigured ?? false,
              },
            }
          : {
              role: "assistant",
              text: json.error?.message ?? "Assistant is unavailable right now.",
            },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Network error — please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        data-testid="chat-log"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm text-navy-700">
            <p className="font-semibold text-navy-900">नमस्ते! I am RailSaarthi.</p>
            <p className="mt-1">
              Ask me in Hindi, Hinglish or English. Railway facts come only from
              authorized data providers — I never guess.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-700 transition hover:border-navy-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              data-testid={`chat-message-${m.role}`}
              className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm ${
                m.role === "user"
                  ? "rounded-br-md bg-navy-900 text-cream-50"
                  : "rounded-bl-md border border-cream-300 bg-cream-50 text-navy-900"
              }`}
            >
              {m.text}
              {m.meta && m.meta.sources.length > 0 && (
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <SourceBadge
                    source={{
                      providerId: m.meta.sources[0].providerId,
                      kind: "none",
                      termsRef: "",
                      authorization:
                        m.meta.sources[0].authorization === "configured"
                          ? "configured"
                          : "not-configured",
                    }}
                  />
                  {m.meta.retrievedAt && m.meta.freshness && (
                    <FreshnessPill freshness={m.meta.freshness} retrievedAt={m.meta.retrievedAt} />
                  )}
                </span>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div
              data-testid="chat-typing"
              className="rounded-2xl rounded-bl-md border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-sm text-navy-500"
            >
              …
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-cream-300 bg-cream-50 p-3 sm:p-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ट्रेन, PNR, लाइव स्टेटस… / train, PNR, live status…"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-navy-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-full bg-navy-900 px-4 py-2.5 text-sm font-semibold text-cream-50 transition hover:bg-navy-800 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
