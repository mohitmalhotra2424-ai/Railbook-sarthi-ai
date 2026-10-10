"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserCapability } from "./useBrowserCapability";

/**
 * Minimal declarations for the (non-standard, Chromium-implemented) Web
 * Speech Recognition API. We rely ONLY on this documented browser
 * capability — no server STT, no credentials, and no audio ever reaches
 * our code or storage (the API returns text only).
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type VoiceInputState =
  | "idle"
  | "recording"
  | "processing"
  | "denied"
  | "no-speech"
  | "error";

export interface VoiceInputApi {
  /** False when this browser has no speech-recognition capability. */
  supported: boolean;
  state: VoiceInputState;
  /** Human-readable issue for denied/error states (never technical dumps). */
  message: string | null;
  start: () => void;
  cancel: () => void;
  /** Clear a previously shown error message. */
  dismissMessage: () => void;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

const hasSpeechRecognition = () => getCtor() !== null;

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone permission nahi mili. Browser settings mein microphone allow karke phir try karein.",
  "service-not-allowed":
    "Browser ne speech service block kar di hai. Permissions check karein.",
  "no-speech": "Kuch sunai nahi diya — phir se try karein.",
  network: "Speech service se connect nahi ho paya. Internet check karein, ya text se type kar lein.",
};

/**
 * Tap-to-talk voice input via the browser's speech recognition.
 * The final transcript is handed to the caller (it lands in the composer
 * for review/edit) — recognition NEVER auto-submits to the assistant.
 */
export function useVoiceInput(opts: {
  lang: string;
  onTranscript: (text: string) => void;
}): VoiceInputApi {
  const { lang, onTranscript } = opts;
  const supported = useBrowserCapability(hasSpeechRecognition);
  const [state, setState] = useState<VoiceInputState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const langRef = useRef(lang);
  const onTranscriptRef = useRef(onTranscript);

  // Keep latest values available to recognition callbacks (effect-synced,
  // never written during render).
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const cancel = useCallback(() => {
    recRef.current?.abort();
    recRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return; // never start twice / never without support
    setMessage(null);
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setState("error");
      setMessage("Speech recognition start nahi ho paya.");
      return;
    }
    rec.lang = langRef.current;
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) finalText += result[0]?.transcript ?? "";
      }
      const trimmed = finalText.trim();
      if (trimmed) {
        setState("processing"); // transcript received — handing it to the composer
        onTranscriptRef.current(trimmed);
      }
    };
    rec.onerror = (event) => {
      recRef.current = null; // release the instance so the mic works again (onend may follow)
      const msg = ERROR_MESSAGES[event.error] ?? null;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setState("denied");
        setMessage(msg ?? "Microphone permission chahiye.");
      } else if (event.error === "no-speech") {
        setState("no-speech");
        setMessage(msg);
      } else if (event.error !== "aborted") {
        setState("error");
        setMessage(msg ?? "Voice input mein dikkat aayi. Text se type kar sakte hain.");
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setState((s) => (s === "recording" || s === "processing" ? "idle" : s));
    };
    recRef.current = rec;
    setState("recording");
    try {
      rec.start(); // permission prompt happens here — only after this user tap
    } catch {
      recRef.current = null;
      setState("error");
      setMessage("Recording start nahi ho payi.");
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, state, message, start, cancel, dismissMessage: () => setMessage(null) };
}
