"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TrainResultCards, type TrainCard } from "./TrainResultCards";

interface ToolChip {
  correlationId: string;
  tool: string;
  phase: "running" | "done";
  status?: string;
  summary?: string;
  freshness?: string;
  source?: string;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text?: string;
  cards?: TrainCard[];
  chips?: ToolChip[];
  thinking?: boolean;
  model?: string;
  viaFallback?: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

const TOOL_LABELS: Record<string, string> = {
  SEARCH_TRAINS: "Searching trains",
  GET_TRAIN_INFO: "Fetching train info",
  GET_TIMETABLE: "Fetching timetable",
  TRACK_TRAIN: "Tracking live status",
  CHECK_AVAILABILITY: "Checking seats",
  GET_FARE: "Checking fare",
  CHECK_PNR: "Checking PNR",
  GET_CANCELLED_TRAINS: "Checking cancellations",
  GENERAL_RAILWAY_ANSWER: "General railway info",
};

const SUGGESTIONS = [
  "Ludhiana se Delhi ki trains batao",
  "WL ticket ka matlab kya hai?",
  "PNR 1234567890 ka status",
];

function chipStyle(chip: ToolChip): string {
  if (chip.phase === "running") return "border-navy-200 bg-navy-50 text-navy-700";
  switch (chip.status) {
    case "ok":
      return "border-signal-500/30 bg-signal-500/10 text-signal-700";
    case "stale":
      return "border-saffron-500/40 bg-saffron-500/10 text-saffron-600";
    case "not_configured":
    case "unavailable":
      return "border-saffron-500/40 bg-saffron-500/10 text-saffron-600";
    default:
      return "border-alert-500/30 bg-alert-500/10 text-alert-500";
  }
}

function ToolChipView({ chip }: { chip: ToolChip }) {
  const label = TOOL_LABELS[chip.tool] ?? chip.tool;
  return (
    <span
      data-testid="tool-chip"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chipStyle(chip)}`}
    >
      {chip.phase === "running" ? (
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-navy-400" />
      ) : chip.status === "ok" ? (
        <span aria-hidden>✓</span>
      ) : (
        <span aria-hidden>⚠</span>
      )}
      {chip.phase === "running" ? `${label}…` : `${label} · ${chip.summary ?? chip.status}`}
      {chip.freshness === "stale" && <span className="font-semibold">(stale)</span>}
    </span>
  );
}

export function ChatClient() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      conversationIdRef.current = localStorage.getItem("railsaarthi.cid");
    } catch {
      /* private mode — ephemeral conversation */
    }
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const patchMsg = useCallback((id: string, patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)),
    );
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput("");
      setBusy(true);
      lastUserMessageRef.current = text;

      const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text },
        { id: assistantId, role: "assistant", thinking: true, chips: [] },
      ]);

      let settled = false;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          patchMsg(assistantId, {
            thinking: false,
            error: {
              code: "HTTP_ERROR",
              message: err?.error?.message ?? `Request failed (${res.status}).`,
              retryable: true,
            },
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: Record<string, never> & { type: string };
            try {
              event = JSON.parse(line.slice(6)) as typeof event;
            } catch {
              continue;
            }
            const ev = event as unknown as Record<string, unknown> & { type: string };

            switch (ev.type) {
              case "conversation":
                conversationIdRef.current = String(ev.conversationId ?? "");
                try {
                  localStorage.setItem("railsaarthi.cid", conversationIdRef.current ?? "");
                } catch {
                  /* ignore */
                }
                break;
              case "status":
                if (ev.text === "using_fallback") {
                  patchMsg(assistantId, { viaFallback: true, model: ev.model ? String(ev.model) : undefined });
                }
                break;
              case "tool_call":
                patchMsg(assistantId, (m) => ({
                  chips: [...(m.chips ?? []), { correlationId: String(ev.correlationId), tool: String(ev.tool), phase: "running" }],
                }));
                break;
              case "tool_result":
                patchMsg(assistantId, (m) => ({
                  chips: (m.chips ?? []).map((c) =>
                    c.correlationId === ev.correlationId
                      ? {
                          ...c,
                          phase: "done" as const,
                          status: String(ev.status ?? ""),
                          summary: String(ev.summary ?? ""),
                          freshness: ev.freshness ? String(ev.freshness) : undefined,
                          source: ev.source ? String(ev.source) : undefined,
                        }
                      : c,
                  ),
                }));
                break;
              case "message":
                settled = true;
                patchMsg(assistantId, {
                  thinking: false,
                  text: String(ev.text ?? ""),
                  cards: (ev.cards as TrainCard[] | undefined) ?? [],
                  model: String(ev.model ?? ""),
                  viaFallback: Boolean(ev.viaFallback),
                });
                break;
              case "error":
                settled = true;
                patchMsg(assistantId, {
                  thinking: false,
                  error: {
                    code: String(ev.code ?? "ERROR"),
                    message: String(ev.message ?? "Something went wrong."),
                    retryable: Boolean(ev.retryable),
                  },
                });
                break;
            }
          }
        }
        if (!settled) {
          patchMsg(assistantId, {
            thinking: false,
            error: { code: "INCOMPLETE_TURN", message: "The turn ended without an answer.", retryable: true },
          });
        }
      } catch {
        patchMsg(assistantId, {
          thinking: false,
          error: { code: "NETWORK_ERROR", message: "Network error — please retry.", retryable: true },
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, patchMsg],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={logRef} data-testid="chat-log" className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md rounded-3xl border border-cream-300 bg-cream-50 p-5">
            <p className="text-base font-semibold text-navy-900">नमस्ते! Main RailSaarthi हूँ.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-navy-600">
              Ask me anything about trains in Hindi, Hinglish or English. Live answers come only
              from authorized data providers — I never guess.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
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

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="w-full max-w-[88%] sm:max-w-[75%]">
              {m.role === "user" ? (
                <div
                  data-testid="chat-message-user"
                  className="ml-auto w-fit rounded-3xl rounded-br-lg bg-navy-900 px-4 py-3 text-sm leading-relaxed text-cream-50"
                >
                  {m.text}
                </div>
              ) : (
                <div data-testid="chat-message-assistant" className="space-y-2.5">
                  {m.chips && m.chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.chips.map((c) => (
                        <ToolChipView key={c.correlationId} chip={c} />
                      ))}
                    </div>
                  )}

                  {m.thinking && (
                    <div data-testid="chat-thinking" className="flex items-center gap-2 text-sm text-navy-500">
                      <span className="flex gap-1" aria-hidden>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:300ms]" />
                      </span>
                      soch raha hoon…
                    </div>
                  )}

                  {m.text && (
                    <div className="rounded-3xl rounded-bl-lg border border-cream-300 bg-cream-50 px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-navy-900">
                      {m.text}
                      {m.cards && m.cards.length > 0 && <TrainResultCards cards={m.cards} />}
                      <p className="mt-2 text-[10px] text-navy-400" data-testid="answer-provenance">
                        {m.model ? `model: ${m.model}` : "model: —"}
                        {m.viaFallback ? " · via configured fallback" : ""}
                      </p>
                    </div>
                  )}

                  {m.error && (
                    <div
                      data-testid="chat-error"
                      className="rounded-3xl rounded-bl-lg border border-alert-500/30 bg-alert-500/5 px-4 py-3 text-sm text-navy-900"
                    >
                      <p className="font-semibold text-alert-500">[{m.error.code}]</p>
                      <p className="mt-0.5">{m.error.message}</p>
                      {m.error.retryable && lastUserMessageRef.current && (
                        <button
                          type="button"
                          data-testid="retry-button"
                          onClick={() => void send(lastUserMessageRef.current ?? "")}
                          className="mt-2.5 rounded-full border border-navy-300 px-3.5 py-1.5 text-xs font-semibold text-navy-800 transition hover:bg-navy-50"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={onSubmit} className="border-t border-cream-300 bg-cream-50 p-3 sm:p-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ट्रेन, PNR, लाइव स्टेटस… / trains, PNR, live status…"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white px-4 py-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-navy-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-full bg-navy-900 px-5 py-3 text-sm font-semibold text-cream-50 transition hover:bg-navy-800 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
