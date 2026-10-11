"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { TrainResultCards, type TrainCard } from "./TrainResultCards";
import { PassengerFormPanel, type PassengerFormState } from "./PassengerFormPanel";
import { ResultBlocks } from "./ResultBlocks";
import type { ResultBlock } from "@/assistant/orchestrator";
import { BrandMark, ArrowDownIcon, CheckIcon, MicIcon, PlusIcon, SendIcon, SpeakerIcon, StopIcon, WarnIcon } from "./icons";
import { availabilityKind, KIND_LABEL } from "./results/status";
import Link from "next/link";
import { useVoiceInput } from "./voice/useVoiceInput";
import { useSpeak } from "./voice/useSpeak";

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
  blocks?: ResultBlock[];
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
  "Ludhiana se Delhi ki trains",
  "Kal ki trains aur timings",
  "3A mein seat availability",
  "Is train ka fare kitna hai?",
  "Train abhi kahan hai?",
  "PNR status check karna hai",
];

function chipStyle(chip: ToolChip): string {
  if (chip.phase === "running") return "border-navy-200 bg-navy-50 text-navy-700";
  switch (chip.status) {
    case "ok":
      return "border-signal-500/30 bg-signal-500/10 text-signal-700";
    case "stale":
    case "not_configured":
    case "unavailable":
      return "border-saffron-500/40 bg-saffron-500/10 text-saffron-600";
    default:
      return "border-alert-500/30 bg-alert-500/10 text-alert-500";
  }
}

/** Concise spoken summary built ONLY from verified structured data in the
 *  message (cards/blocks). Never invents availability, fare or status. */
function speechSummary(m: ChatMsg): string {
  const bits: string[] = [];
  if (m.text) bits.push(m.text);
  for (const c of m.cards ?? []) {
    const av = (c.availability ?? [])
      .map((a) => `${a.classCode} ${KIND_LABEL[availabilityKind(a.status)]}`)
      .join(", ");
    bits.push(`${c.trainNumber} mein ${av || "abhi availability verify nahi hui"}.`);
  }
  for (const b of m.blocks ?? []) {
    if (b.kind === "availability") {
      bits.push(
        `${b.data.trainNumber}: ` +
          b.data.classes.map((x) => `${x.classCode} ${KIND_LABEL[availabilityKind(x.status)]}`).join(", ") +
          ".",
      );
    } else if (b.kind === "fare") {
      bits.push(`${b.data.trainNumber} ${b.data.classCode} fare ${b.data.totalFare} rupees hai.`);
    } else if (b.kind === "live") {
      bits.push(
        b.data.running === null
          ? `${b.data.trainNumber} ki live position verify nahi hui.`
          : `${b.data.trainNumber} ${
              b.data.running ? "running hai" : "running nahi hai"
            }, last report ${b.data.lastStation?.name ?? "unknown"}.`,
      );
    }
  }
  return bits.join(" ").slice(0, 1200);
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
        <span aria-hidden className="font-bold">✓</span>
      ) : (
        <WarnIcon className="h-3 w-3" />
      )}
      {chip.phase === "running" ? `${label}…` : `${label} · ${chip.summary ?? chip.status}`}
      {chip.phase !== "running" && chip.source && (
        <span className="text-navy-500/80" title="Data source">
          via {chip.source}
        </span>
      )}
      {chip.freshness === "stale" && <span className="font-semibold">(stale)</span>}
    </span>
  );
}

export function ChatClient({ initialMessage }: { initialMessage?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [paxForm, setPaxForm] = useState<PassengerFormState | null>(null);
  const paxPanelRef = useRef<HTMLDivElement | null>(null);
  const paxOpenRef = useRef(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Concurrency safety (Prompt 19): synchronous double-send guard, abortable
  // in-flight turn, and a generation counter so a superseded stream can never
  // mutate the new conversation (e.g. resurrect an old conversationId).
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Smart auto-scroll: only follow the conversation when the user is already
  // near the bottom — never yank the view away from someone reading history.
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  // Voice (Prompt 9): browser-native STT/TTS — tap-to-talk by default.
  const [voiceLang, setVoiceLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [conversationMode, setConversationMode] = useState(false);
  const lastAutoSpokenRef = useRef<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armConfirm = useCallback(() => {
    setConfirmReset(true);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmReset(false), 3000);
  }, []);

  const onTranscript = useCallback((text: string) => {
    // Transcript lands in the composer for review/edit — NEVER auto-sent.
    setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
    const el = composerRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
      el.focus();
    }
  }, []);

  const voice = useVoiceInput({ lang: voiceLang, onTranscript });

  const speak = useSpeak({
    // Conversation mode: after spoken playback ENDS, listen again. Playback
    // always starts from a user action, so this never surprises the user.
    onEnd: () => {
      if (conversationMode && !busy && voice.supported) voice.start();
    },
  });

  const onMicTap = useCallback(() => {
    if (voice.state === "recording" || voice.state === "processing") {
      voice.cancel();
      return;
    }
    if (speak.speakingId) speak.stop(); // barge-in: stop playback promptly
    voice.start();
  }, [voice, speak]);

  useEffect(() => {
    try {
      conversationIdRef.current = localStorage.getItem("railsaarthi.cid");
    } catch {
      /* private mode — ephemeral conversation */
    }
    // Lifecycle safety (Prompt 20 §6): leaving the page must cancel any
    // in-flight stream and clear pending timers — no work outlives the UI.
    return () => {
      genRef.current += 1;
      abortRef.current?.abort();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Conversation mode: speak the newest assistant answer once it completes.
  useEffect(() => {
    if (!conversationMode || busy) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.text);
    if (last && last.id !== lastAutoSpokenRef.current) {
      lastAutoSpokenRef.current = last.id;
      speak.speak(last.id, speechSummary(last));
    }
  }, [conversationMode, busy, messages, speak]);

  // Handoff from home (?q=): perform the real turn once, then clean the URL so
  // a refresh never re-sends the message.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!initialMessage || didInitRef.current) return;
    didInitRef.current = true;
    router.replace("/chat", { scroll: false });
    void send(initialMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const onLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    nearBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    nearBottomRef.current = true;
    setShowJump(false);
  }, []);

  const growComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`; // ≈5 lines max
  }, []);

  /** On failure, give the user's text back if they haven't typed something new. */
  const restoreTextOnFailure = useCallback(
    (text: string) => {
      setInput((prev) => (prev.trim() === "" ? text : prev));
      growComposer();
    },
    [growComposer],
  );

  const patchMsg = useCallback(
    (id: string, patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)),
      );
    },
    [],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy || sendingRef.current) return; // same-tick double-send guard
      sendingRef.current = true;
      setInput("");
      setBusy(true);
      const gen = ++genRef.current;
      const ac = new AbortController();
      abortRef.current = ac;
      const alive = () => genRef.current === gen;
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
          restoreTextOnFailure(text);
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
            if (!alive()) break; // superseded turn: never touch the new conversation

            switch (ev.type) {
              case "conversation":
                conversationIdRef.current = String(ev.conversationId ?? "");
                try {
                  localStorage.setItem("railsaarthi.cid", conversationIdRef.current ?? "");
                } catch {
                  /* ignore */
                }
                break;
              case "passenger_form": {
                // Prompt 25: authoritative selection + form state from the backend
                const nextForm: PassengerFormState = {
                  selection: (ev.selection as PassengerFormState["selection"]) ?? null,
                  passengers: (ev.passengers as PassengerFormState["passengers"]) ?? [],
                };
                const wasOpen = paxOpenRef.current;
                const nowOpen = Boolean(nextForm.selection?.classCode);
                paxOpenRef.current = nowOpen;
                setPaxForm(nextForm);
                // The form appears the moment a train is selected (tap, text or
                // voice) — bring it into view so the user sees it open.
                if (nowOpen && !wasOpen) {
                  setTimeout(() => paxPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
                }
                break;
              }
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
                  blocks: (ev.blocks as ResultBlock[] | undefined) ?? [],
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
                restoreTextOnFailure(text);
                break;
            }
          }
        }
        if (!settled && alive()) {
          patchMsg(assistantId, {
            thinking: false,
            error: { code: "INCOMPLETE_TURN", message: "The turn ended without an answer.", retryable: true },
          });
          restoreTextOnFailure(text);
        }
      } catch {
        if (!ac.signal.aborted && alive()) {
          patchMsg(assistantId, {
            thinking: false,
            error: { code: "NETWORK_ERROR", message: "Network error — please retry.", retryable: true },
          });
          restoreTextOnFailure(text);
        }
        // aborted/superseded = honest silence, not a fake error
      } finally {
        setBusy(false);
        sendingRef.current = false;
      }
    },
    [busy, patchMsg, restoreTextOnFailure],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  /** Desktop: Enter sends; Shift+Enter inserts a newline (safe multiline). */
  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function newConversation() {
    genRef.current += 1; // supersede any in-flight stream
    abortRef.current?.abort();
    conversationIdRef.current = null;
    try {
      localStorage.removeItem("railsaarthi.cid");
    } catch {
      /* ignore */
    }
    setMessages([]);
    setPaxForm(null);
    paxOpenRef.current = false;
    setConfirmReset(false);
    setShowJump(false);
    nearBottomRef.current = true;
    composerRef.current?.focus();
  }

  const hasVoice = voice.supported || speak.supported;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Chat header: brand bar with live status — fixed above the log */}
      <div className="bg-navy-800 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              aria-label="Back to home"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white transition hover:bg-navy-900/80"
            >
              <BrandMark className="h-5 w-5" />
            </Link>
            <p className="truncate text-[15px] font-extrabold text-white">RailSaarthi AI</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              data-testid="ready-pill"
              className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-navy-800"
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-saffron-500" : "bg-signal-500"}`} />
              {busy ? "Thinking…" : "Ready"}
            </span>
            <button
            type="button"
            data-testid="new-chat"
            aria-label="Start a new conversation"
            onClick={() => (confirmReset ? (setConfirmReset(false), newConversation()) : armConfirm())}
            disabled={messages.length === 0}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
              confirmReset
                ? "border-alert-500/40 bg-alert-500/10 text-alert-500"
                : "border-white/20 bg-white/10 text-white hover:border-white/40"
            }`}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {confirmReset ? "Confirm new chat?" : "New chat"}
            </button>
          </div>
        </div>
      </div>
      {/* Conversation surface */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={logRef}
          data-testid="chat-log"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          onScroll={onLogScroll}
          className="h-full space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {messages.length === 0 && (
            <div className="pt-2 pb-2 sm:pt-6">
              <div className="rounded-2xl border border-cream-300 bg-navy-50 p-4">
                <p className="text-sm font-bold text-navy-900">Namaste! 🙏</p>
                <p className="mt-1 text-[13px] leading-relaxed text-navy-700">
                  Main RailSaarthi AI hoon, aapka Indian Railways ka AI assistant.
                </p>
                <p className="mt-2.5 text-[12px] font-semibold text-navy-800">Main aapki madad kar sakta hoon:</p>
                <ul className="mt-1.5 space-y-1.5">
                  {[
                    "Train search aur timings",
                    "Fare aur travel classes",
                    "Seat availability",
                    "Live train status",
                    "PNR status",
                  ].map((x) => (
                    <li key={x} className="flex items-center gap-2 text-[12px] font-medium text-navy-800">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-navy-600 text-white">
                        <CheckIcon className="h-2.5 w-2.5" />
                      </span>
                      {x}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[12px] text-navy-600">
                  Aap kuch bhi pooch sakte hain — Hindi, Hinglish ya English mein.
                </p>
              </div>

              <p className="mt-4 mb-2 text-[12px] font-bold text-navy-800">Suggested Questions</p>
              <div className="grid gap-2 min-[420px]:grid-cols-2">
                {SUGGESTIONS.map((sg) => (
                  <button
                    key={sg}
                    type="button"
                    data-testid="suggestion"
                    onClick={() => void send(sg)}
                    className="flex items-center justify-between gap-2 rounded-full border border-cream-300 bg-white px-3.5 py-2 text-left text-[12px] font-medium text-navy-800 transition hover:border-navy-300 hover:bg-navy-50"
                  >
                    <span className="min-w-0 truncate">{sg}</span>
                    <span aria-hidden className="text-navy-400">›</span>
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
                    className="ml-auto w-fit max-w-full rounded-2xl rounded-br-md bg-navy-600 px-4 py-2.5 text-[14px] leading-relaxed text-white"
                  >
                    {m.text}
                    <p className="mt-1 text-right text-[9px] text-navy-200">
                      {new Date(Number(m.id.slice(2)) || Date.now()).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ) : (
                  <div data-testid="chat-message-assistant" className="space-y-2">
                    {m.chips && m.chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.chips.map((c) => (
                          <ToolChipView key={c.correlationId} chip={c} />
                        ))}
                      </div>
                    )}

                    {m.thinking && (
                      <div data-testid="chat-thinking" className="flex items-center gap-2 px-1 text-sm text-navy-500">
                        <span className="flex gap-1" aria-hidden>
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-navy-400 [animation-delay:300ms]" />
                        </span>
                        {(() => {
                          const running = [...(m.chips ?? [])].reverse().find((c) => c.phase === "running");
                          return running ? `${TOOL_LABELS[running.tool] ?? running.tool}…` : "soch raha hoon…";
                        })()}
                      </div>
                    )}

                    {m.text && (
                      <div className="rounded-2xl rounded-bl-md border border-cream-300 bg-white p-4">
                        <p className="text-[15px] leading-relaxed whitespace-pre-line text-navy-900">{m.text}</p>
                        {m.cards && m.cards.length > 0 && (
                          <TrainResultCards cards={m.cards} onAsk={(q) => void send(q)} busy={busy} selectedTrainNumber={paxForm?.selection?.trainNumber ?? null} />
                        )}
                        {m.blocks && m.blocks.length > 0 && <ResultBlocks blocks={m.blocks} />}
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-cream-200 pt-2.5">
                          <p className="text-[10px] text-navy-400" data-testid="answer-provenance">
                            {m.model ? `model: ${m.model}` : "model: —"}
                            {m.viaFallback ? " · via configured fallback" : ""}
                          </p>
                          {speak.supported && (
                            <button
                              type="button"
                              data-testid="speak-button"
                              aria-label={speak.speakingId === m.id ? "Stop speaking" : "Speak response"}
                              onClick={() =>
                                speak.speakingId === m.id ? speak.stop() : speak.speak(m.id, speechSummary(m))
                              }
                              className="flex items-center gap-1.5 rounded-full border border-navy-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-700 transition hover:border-navy-400"
                            >
                              {speak.speakingId === m.id ? (
                                <>
                                  <StopIcon className="h-3 w-3" /> Rok dein
                                </>
                              ) : (
                                <>
                                  <SpeakerIcon className="h-3.5 w-3.5" /> Suno
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        {speak.error && <p className="mt-1 text-[11px] text-alert-500">{speak.error}</p>}
                      </div>
                    )}

                    {m.error && (
                      <div
                        data-testid="chat-error"
                        className="rounded-2xl rounded-bl-md border border-alert-500/30 bg-alert-500/5 p-4"
                      >
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-alert-500">
                          <WarnIcon className="h-4 w-4" />
                          {m.error.code}
                        </p>
                        <p className="mt-1 text-sm text-navy-800">{m.error.message}</p>
                        {m.error.retryable && lastUserMessageRef.current && (
                          <button
                            type="button"
                            data-testid="retry-button"
                            disabled={busy}
                            onClick={() => void send(lastUserMessageRef.current ?? "")}
                            className="mt-2.5 rounded-full border border-navy-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-800 transition hover:bg-navy-50"
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

          {paxForm && (
            <div ref={paxPanelRef}>
              <PassengerFormPanel
                state={paxForm}
                conversationId={conversationIdRef.current}
                onState={setPaxForm}
              />
            </div>
          )}
        </div>

        {showJump && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <button
              type="button"
              data-testid="jump-latest"
              onClick={jumpToLatest}
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-navy-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-700 shadow-sm transition hover:border-navy-400"
            >
              <ArrowDownIcon className="h-3.5 w-3.5" />
              Latest
            </button>
          </div>
        )}
      </div>

      {/* Composer — anchored at the bottom, keyboard-aware */}
      <div className="border-t border-cream-300 bg-cream-50">
        {hasVoice && (
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-1.5 px-4 pt-2 text-[10px]">
            {voice.supported && (
              <>
                <button
                  type="button"
                  data-testid="voice-lang"
                  aria-label="Voice input language"
                  onClick={() => setVoiceLang((l) => (l === "hi-IN" ? "en-IN" : "hi-IN"))}
                  className="rounded-full border border-cream-300 bg-white px-2 py-0.5 font-semibold text-navy-600 transition hover:border-navy-300"
                >
                  {voiceLang === "hi-IN" ? "हिंदी" : "EN"}
                </button>
                {speak.supported && (
                  <button
                    type="button"
                    data-testid="conversation-mode"
                    aria-pressed={conversationMode}
                    onClick={() => setConversationMode((v) => !v)}
                    className={`rounded-full border px-2 py-0.5 font-semibold transition ${
                      conversationMode
                        ? "border-signal-500/40 bg-signal-500/10 text-signal-700"
                        : "border-cream-300 bg-white text-navy-600 hover:border-navy-300"
                    }`}
                  >
                    {conversationMode ? "● Conversation mode ON" : "Conversation mode"}
                  </button>
                )}
              </>
            )}
            {(voice.state === "recording" || voice.state === "processing" || voice.message) && (
              <p
                data-testid="voice-status"
                role="status"
                className={`ml-auto font-medium ${
                  voice.state === "denied" || voice.state === "error" ? "text-alert-500" : "text-navy-600"
                }`}
              >
                {voice.state === "recording" && "Sun raha hoon… boliye (tap mic to cancel)"}
                {voice.state === "processing" && "…samajh raha hoon"}
                {voice.message}
              </p>
            )}
          </div>
        )}
        <form onSubmit={onSubmit} className="p-3 sm:p-4">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <div className="flex min-w-0 flex-1 items-end rounded-full border border-cream-300 bg-white py-1 pr-1 pl-1 focus-within:border-navy-400">
              {voice.supported && (
                <button
                  type="button"
                  data-testid="mic-button"
                  aria-label={
                    voice.state === "recording" || voice.state === "processing"
                      ? "Cancel voice input"
                      : "Start voice input"
                  }
                  disabled={busy}
                  onClick={onMicTap}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
                    voice.state === "recording" || voice.state === "processing"
                      ? "animate-pulse bg-alert-500/10 text-alert-500"
                      : "text-navy-500 hover:bg-navy-50 hover:text-navy-800"
                  }`}
                >
                  <MicIcon className="h-4.5 w-4.5" />
                </button>
              )}
              <textarea
                ref={composerRef}
                aria-label="Message"
                aria-multiline="true"
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  growComposer();
                }}
                onKeyDown={onComposerKeyDown}
                placeholder="Type your journey…"
                className="max-h-28 min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-2 text-sm leading-relaxed text-navy-900 placeholder:text-navy-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-busy={busy}
              aria-label="Send"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-600 text-white transition hover:bg-navy-500 active:scale-95 disabled:opacity-40"
            >
              <SendIcon className="h-4.5 w-4.5" />
              <span className="sr-only">{busy ? "Sending…" : "Send"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
