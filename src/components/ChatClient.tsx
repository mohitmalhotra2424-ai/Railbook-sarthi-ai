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
import type { PassengerFormState } from "./PassengerFormPanel";
import { ResultBlocks } from "./ResultBlocks";
import type { ResultBlock } from "@/assistant/orchestrator";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrandMark,
  MicIcon,
  PlusIcon,
  SpeakerIcon,
  StopIcon,
  WarnIcon,
} from "./icons";
import Link from "next/link";
import { useVoiceInput } from "./voice/useVoiceInput";
import { useSpeak } from "./voice/useSpeak";
import { speechSummary } from "./voice/speechSummary";

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

function ToolChipView({ chip }: { chip: ToolChip }) {
  const label = TOOL_LABELS[chip.tool] ?? chip.tool;
  return (
    <span
      data-testid="tool-chip"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chipStyle(chip)}`}
    >
      {chip.phase === "running" ? (
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy-400" />
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

/** Compact desktop-only journey context (read-only summary of authoritative
 *  session state already held by the client — no new data, no controls). */
function JourneyContext({ form }: { form: PassengerFormState }) {
  const sel = form.selection;
  if (!sel?.classCode) return null;
  const complete = form.passengers.filter((p) => p.name && p.age !== undefined && p.gender && p.berth).length;
  const status =
    form.review?.status === "confirmed"
      ? "IRCTC handoff ready"
      : form.review
        ? "Awaiting confirmation"
        : form.readiness?.ready
          ? "Ready for review"
          : "Collecting details";
  return (
    <div className="space-y-4">
      <p className="text-[10.5px] font-bold tracking-[0.14em] text-navy-500 uppercase">Journey context</p>
      <div className="space-y-3.5">
        <div>
          <p className="text-[10.5px] font-semibold text-navy-500">Journey</p>
          <p className="mt-0.5 text-[13px] font-bold text-navy-950">
            {sel.from && sel.to ? `${sel.from} → ${sel.to}` : "Route not set"}
          </p>
          <p className="text-[11.5px] text-navy-600">{sel.journeyDate ?? "Date not set"}</p>
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-navy-500">Train</p>
          <p className="mt-0.5 text-[13px] font-bold text-navy-950">
            {sel.trainNumber}
            {sel.trainName ? ` — ${sel.trainName}` : ""}
          </p>
          <p className="text-[11.5px] text-navy-600">Class {sel.classCode}</p>
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-navy-500">Passengers</p>
          <p className="mt-0.5 text-[13px] font-bold text-navy-950">
            {complete} of {Math.max(form.passengers.length, 1)} complete
          </p>
          {form.passengers
            .filter((p) => p.name)
            .map((p, i) => (
              <p key={i} className="text-[11.5px] text-navy-600">
                {p.name}
                {p.age !== undefined && p.gender ? ` · ${p.age} · ${p.gender}` : ""}
              </p>
            ))}
        </div>
        <div>
          <p className="text-[10.5px] font-semibold text-navy-500">Status</p>
          <p className="mt-0.5 text-[13px] font-bold text-navy-950">{status}</p>
          <p className="text-[11px] text-navy-500">Booking execution disabled — review only.</p>
        </div>
      </div>
    </div>
  );
}

export function ChatClient({ initialMessage, passengerConversationId, onPassengerState, onBusyChange }: { initialMessage?: string; passengerConversationId?: string; onPassengerState?: (state: PassengerFormState) => void; onBusyChange?: (busy: boolean) => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [paxForm, setPaxForm] = useState<PassengerFormState | null>(null);
  const paxOpenRef = useRef(false);
  const passengerCallback = useRef(onPassengerState);
  useEffect(() => { passengerCallback.current = onPassengerState; }, [onPassengerState]);
  const pendingPassengerRoute = useRef<string | null>(null);
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
  const [autoSpeak, setAutoSpeak] = useState(true);
  useEffect(() => {
    try {
      // Reading a persisted preference after mount is the whole point here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutoSpeak(localStorage.getItem("railsaarthi.autospeak") !== "off");
    } catch {
      /* private mode: default on */
    }
  }, []);
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
      conversationIdRef.current = passengerConversationId || localStorage.getItem("railsaarthi.cid");
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
  }, [passengerConversationId]);

  useEffect(() => {
    if (nearBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Prompt 45: auto-play EVERY new assistant answer by default (no "Suno"
  // tap needed) — neural server voice; toggle persisted, off = "off".
  // Browsers may still block playback after an asynchronous reply; keep
  // the explicit replay button and error handling as the fallback.
  useEffect(() => {
    if (!autoSpeak || busy || !speak.supported) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.text);
    if (last && last.id !== lastAutoSpokenRef.current) {
      lastAutoSpokenRef.current = last.id;
      speak.speak(last.id, speechSummary(last));
    }
  }, [autoSpeak, busy, messages, speak]);

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
      speak.stop(); // Prompt 35: typing/sending interrupts assistant playback
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
                  readiness: (ev.readiness as PassengerFormState["readiness"]) ?? null,
                  review: (ev.review as PassengerFormState["review"]) ?? null,
                };
                const wasOpen = paxOpenRef.current;
                const nowOpen = Boolean(nextForm.selection?.classCode);
                paxOpenRef.current = nowOpen;
                setPaxForm(nextForm);
                passengerCallback.current?.(nextForm);
                // Do not unmount/cancel the stream before its validated writes finish.
                if (nowOpen && !wasOpen && !passengerCallback.current && conversationIdRef.current) {
                  pendingPassengerRoute.current = `/passengers?c=${encodeURIComponent(conversationIdRef.current)}`;
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
        if (alive() && !ac.signal.aborted && pendingPassengerRoute.current) {
          const target = pendingPassengerRoute.current;
          pendingPassengerRoute.current = null;
          router.push(target);
        }
      }
    },
    [busy, patchMsg, restoreTextOnFailure, speak, router],
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

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const hasVoice = voice.supported || speak.supported;
  const listening = voice.state === "recording" || voice.state === "processing";
  const showContext = Boolean(paxForm?.selection?.classCode);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversation header — compact, light, status + new chat */}
      <div className="border-b border-cream-300 bg-cream-50/85 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              aria-label="RailSaarthi AI — home"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-navy-900 text-white transition hover:bg-navy-800"
            >
              <BrandMark className="h-4.5 w-4.5" />
            </Link>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-bold text-navy-950">RailSaarthi</p>
              <p
                data-testid="ready-pill"
                className="flex items-center gap-1.5 text-[11px] font-medium text-navy-500"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-saffron-500" : "bg-signal-500"}`}
                />
                {busy ? "Thinking…" : "Online · Ready"}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="new-chat"
            aria-label="Start a new conversation"
            onClick={() => (confirmReset ? (setConfirmReset(false), newConversation()) : armConfirm())}
            disabled={!!passengerConversationId || messages.length === 0}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition disabled:opacity-40 ${
              confirmReset
                ? "border-alert-500/40 bg-alert-500/10 text-alert-500"
                : "border-cream-300 bg-white text-navy-700 hover:border-navy-300 hover:text-navy-900"
            }`}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {confirmReset ? "Confirm new chat?" : "New chat"}
          </button>
        </div>
      </div>

      {/* Conversation surface (+ compact desktop context panel) */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={logRef}
            data-testid="chat-log"
            role="log"
            aria-live="polite"
            aria-label="Conversation"
            onScroll={onLogScroll}
            className="h-full overflow-y-auto px-4 py-5 sm:px-6"
          >
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.length === 0 && (
                <div className="animate-rise mx-auto max-w-xl pt-6 pb-2 text-center sm:pt-10">
                  <span
                    aria-hidden
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-navy-900 text-white"
                  >
                    <BrandMark className="h-7 w-7" />
                  </span>
                  <h2 className="font-display mt-4 text-[24px] font-semibold tracking-tight text-navy-950">
                    Where are you travelling today?
                  </h2>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-navy-600">
                    Main RailSaarthi hoon — trains, fares, seat availability, live status
                    aur PNR. Hindi, Hinglish ya English mein poochhiye.
                  </p>
                  <p className="mt-5 text-[12px] text-navy-500">
                    Try saying:{" "}
                    <span className="font-semibold text-navy-800">“Amritsar se Delhi kal jaana hai”</span>
                  </p>
                  <div className="mt-4 grid gap-2 text-left min-[420px]:grid-cols-2">
                    {SUGGESTIONS.map((sg) => (
                      <button
                        key={sg}
                        type="button"
                        data-testid="suggestion"
                        onClick={() => void send(sg)}
                        className="surface-shadow-soft rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[13px] font-medium text-navy-800 transition hover:border-navy-300 hover:bg-navy-50 active:scale-[0.99]"
                      >
                        {sg}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`animate-rise flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "user" ? (
                    <div className="w-full max-w-[88%] sm:max-w-[72%]">
                      <div
                        data-testid="chat-message-user"
                        className="ml-auto w-fit max-w-full rounded-2xl rounded-br-lg bg-cream-200 px-4 py-2.5 text-[14.5px] leading-relaxed text-navy-900"
                      >
                        {m.text}
                        <p className="mt-1 text-right text-[9.5px] text-navy-500">
                          {new Date(Number(m.id.slice(2)) || Date.now()).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div data-testid="chat-message-assistant" className="w-full space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-white"
                        >
                          <BrandMark className="h-3.5 w-3.5" />
                        </span>
                        <p className="text-[12.5px] font-bold text-navy-800">RailSaarthi</p>
                        {m.viaFallback && (
                          <span className="rounded-full border border-saffron-500/40 bg-saffron-500/10 px-2 py-0.5 text-[9.5px] font-semibold text-saffron-600">
                            via configured fallback
                          </span>
                        )}
                      </div>

                      {m.chips && m.chips.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.chips.map((c) => (
                            <ToolChipView key={c.correlationId} chip={c} />
                          ))}
                        </div>
                      )}

                      {m.thinking && (
                        <div data-testid="chat-thinking" className="flex items-center gap-2 px-1 text-[13px] text-navy-500">
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
                        <div className="surface-shadow-soft rounded-2xl rounded-tl-lg border border-cream-300 bg-white p-4 sm:p-5">
                          <p className="text-[15px] leading-relaxed whitespace-pre-line text-navy-950">{m.text}</p>
                          {m.cards && m.cards.length > 0 && (
                            <TrainResultCards cards={m.cards} onAsk={(q) => void send(q)} busy={busy} selectedTrainNumber={paxForm?.selection?.trainNumber ?? null} />
                          )}
                          {m.blocks && m.blocks.length > 0 && <ResultBlocks blocks={m.blocks} />}
                          <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-cream-200 pt-3">
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
                                className="flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-navy-700 transition hover:border-navy-400 hover:text-navy-900"
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
                          {speak.error && <p className="mt-1.5 text-[11px] text-alert-500">{speak.error}</p>}
                        </div>
                      )}

                      {m.error && (
                        <div
                          data-testid="chat-error"
                          className="rounded-2xl rounded-tl-lg border border-cream-300 bg-white p-4 sm:p-5"
                        >
                          <p className="flex items-center gap-2 text-[14px] font-semibold text-navy-950">
                            <WarnIcon className="h-4 w-4 text-saffron-500" />
                            Something went wrong while checking the railway service.
                          </p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-navy-700">{m.error.message}</p>
                          <p className="mt-1 text-[10px] font-semibold tracking-wide text-navy-400">{m.error.code}</p>
                          {m.error.retryable && lastUserMessageRef.current && (
                            <button
                              type="button"
                              data-testid="retry-button"
                              disabled={busy}
                              onClick={() => void send(lastUserMessageRef.current ?? "")}
                              className="mt-3 rounded-full bg-navy-900 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-navy-800 disabled:opacity-50"
                            >
                              Try again
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {!passengerConversationId && paxForm?.selection?.classCode && (
                <div data-testid="passenger-page-cta" className="rounded-xl border border-navy-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-sm text-navy-600">
                    Passenger details alag page par khulti hain (IRCTC jaisa) — chat ke beech form nahi.
                  </p>
                  <Link
                    href={`/passengers?c=${encodeURIComponent(conversationIdRef.current ?? "")}`}
                    className="mt-2 inline-block rounded-lg bg-navy-600 px-4 py-2 text-sm font-bold text-white hover:bg-navy-500"
                  >
                    Passenger Details kholen →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {showJump && (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <button
                type="button"
                data-testid="jump-latest"
                onClick={jumpToLatest}
                className="surface-shadow pointer-events-auto flex items-center gap-1 rounded-full border border-cream-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-700 transition hover:border-navy-400"
              >
                <ArrowDownIcon className="h-3.5 w-3.5" />
                Latest
              </button>
            </div>
          )}
        </div>

        {/* Desktop compact context panel — summary only, from real state */}
        {showContext && paxForm && (
          <aside className="hidden w-[272px] shrink-0 overflow-y-auto border-l border-cream-300 bg-cream-50 p-5 xl:block">
            <JourneyContext form={paxForm} />
          </aside>
        )}
      </div>

      {/* Composer — persistent, keyboard-aware, thumb-friendly */}
      <div className="border-t border-cream-300 bg-cream-100/95 px-3 py-3 backdrop-blur sm:px-4 sm:py-4">
        <div className="mx-auto max-w-3xl">
          {hasVoice && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
              {voice.supported && (
                <>
                  <button
                    type="button"
                    data-testid="voice-lang"
                    aria-label="Voice input language"
                    onClick={() => setVoiceLang((l) => (l === "hi-IN" ? "en-IN" : "hi-IN"))}
                    className="rounded-full border border-cream-300 bg-white px-2.5 py-1 font-semibold text-navy-600 transition hover:border-navy-300"
                  >
                    {voiceLang === "hi-IN" ? "हिंदी" : "EN"}
                  </button>
                </>
              )}
                  {speak.supported && (
                    <>
                    <button
                      type="button"
                      data-testid="autospeak-toggle"
                      aria-pressed={autoSpeak}
                      onClick={() => {
                        const next = !autoSpeak;
                        setAutoSpeak(next);
                        try {
                          localStorage.setItem("railsaarthi.autospeak", next ? "on" : "off");
                        } catch {
                          /* ignore */
                        }
                        if (!next) speak.stop();
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy-600 transition hover:border-navy-300"
                    >
                      <SpeakerIcon className="h-3.5 w-3.5" />
                      {autoSpeak ? "Auto-suno: On" : "Auto-suno: Off"}
                    </button>
                    <button
                      type="button"
                      data-testid="conversation-mode"
                      aria-pressed={conversationMode}
                      onClick={() => setConversationMode((v) => !v)}
                      className={`rounded-full border px-2.5 py-1 font-semibold transition ${
                        conversationMode
                          ? "border-signal-500/40 bg-signal-500/10 text-signal-700"
                          : "border-cream-300 bg-white text-navy-600 hover:border-navy-300"
                      }`}
                    >
                      {conversationMode ? "● Conversation mode ON" : "Conversation mode"}
                    </button>
                    </>
                  )}
              {(listening || voice.message) && (
                <p
                  data-testid="voice-status"
                  role="status"
                  className={`ml-auto flex items-center gap-1.5 font-medium ${
                    voice.state === "denied" || voice.state === "error" ? "text-alert-500" : "text-navy-600"
                  }`}
                >
                  {voice.state === "recording" && (
                    <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy-700" />
                  )}
                  {voice.state === "recording" && "Sun raha hoon… boliye (tap mic to cancel)"}
                  {voice.state === "processing" && "…samajh raha hoon"}
                  {voice.message}
                </p>
              )}
            </div>
          )}
          <form onSubmit={onSubmit}>
            <div className="surface-shadow flex items-end gap-1.5 rounded-[22px] border border-cream-300 bg-white p-1.5 transition focus-within:border-navy-400 focus-within:ring-4 focus-within:ring-navy-500/10">
              {voice.supported && (
                <button
                  type="button"
                  data-testid="mic-button"
                  aria-label={listening ? "Cancel voice input" : "Start voice input"}
                  disabled={busy}
                  onClick={onMicTap}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
                    listening
                      ? "mic-live bg-navy-900 text-white"
                      : "bg-navy-50 text-navy-700 hover:bg-navy-100 hover:text-navy-900"
                  }`}
                >
                  <MicIcon className="h-5 w-5" />
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
                className="max-h-28 min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-2.5 text-[15px] leading-relaxed text-navy-950 placeholder:text-navy-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-busy={busy}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-600 text-white transition hover:bg-navy-500 active:scale-95 disabled:opacity-40"
              >
                <ArrowUpIcon className="h-5 w-5" />
                <span className="sr-only">{busy ? "Sending…" : "Send"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
