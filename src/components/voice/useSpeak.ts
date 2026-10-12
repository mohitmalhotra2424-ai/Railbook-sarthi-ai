"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserCapability } from "./useBrowserCapability";
import { detectTtsLanguage, speakableText } from "./lang";

/**
 * Text-to-speech via the browser's speechSynthesis — a documented browser
 * capability needing no credentials. We speak ONLY the actual assistant
 * response (cleaned of markdown), never a separately scripted answer, and
 * never autoplay: playback starts from an explicit user action (speaker
 * button or a user-enabled conversation mode).
 */
export interface SpeakApi {
  supported: boolean;
  /** Id of the message currently being spoken, or null. */
  speakingId: string | null;
  error: string | null;
  /** Speak the assistant text for message `id`. Stops any current playback first. */
  speak: (id: string, text: string) => void;
  /** Stop playback promptly (used for barge-in / stop button). */
  stop: () => void;
}

const hasSpeechSynthesis = () =>
  typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function";

export function useSpeak(opts: { onEnd?: () => void } = {}): SpeakApi {
  const supported = useBrowserCapability(hasSpeechSynthesis);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const onEndRef = useRef(opts.onEnd);

  useEffect(() => {
    onEndRef.current = opts.onEnd;
  }, [opts.onEnd]);

  // Voices arrive asynchronously on most browsers; keep a fresh list.
  useEffect(() => {
    if (!hasSpeechSynthesis()) return;
    const load = () => {
      try {
        voicesRef.current = window.speechSynthesis.getVoices();
      } catch {
        /* ignore */
      }
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", load);
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    speakingIdRef.current = null;
    setSpeakingId(null);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    try {
      window.speechSynthesis?.cancel(); // fires utterance onend in real browsers
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback((id: string, text: string) => {
    if (typeof window === "undefined" || typeof window.speechSynthesis?.speak !== "function") {
      setError("Is browser mein speech playback available nahi hai.");
      return;
    }
    const clean = speakableText(text);
    if (!clean) return;
    const synth = window.speechSynthesis;

    const doSpeak = () => {
      pendingTimerRef.current = null;
      try {
        const utterance = new SpeechSynthesisUtterance(clean);
        const lang = detectTtsLanguage(clean);
        utterance.lang = lang;
        // A language-matched voice greatly improves the chance the device
        // actually produces audio (mismatched default voices can stay silent).
        const prefix = lang.split("-")[0];
        const voice =
          voicesRef.current.find((v) => v.lang === lang) ??
          voicesRef.current.find((v) => v.lang.startsWith(prefix)) ??
          voicesRef.current.find((v) => v.lang.startsWith("hi")) ??
          voicesRef.current.find((v) => v.lang.startsWith("en"));
        if (voice) utterance.voice = voice;
        utterance.onstart = () => {
          speakingIdRef.current = id;
          setSpeakingId(id);
          setError(null);
        };
        utterance.onend = () => {
          if (speakingIdRef.current === id) {
            speakingIdRef.current = null;
            setSpeakingId(null);
            onEndRef.current?.();
          }
        };
        utterance.onerror = () => {
          speakingIdRef.current = null;
          setSpeakingId(null);
          setError("Audio playback fail ho gaya. Reply padh sakte hain.");
        };
        synth.speak(utterance);
      } catch {
        setSpeakingId(null);
        setError("Audio playback fail ho gaya. Reply padh sakte hain.");
      }
    };

    try {
      if (synth.speaking || synth.pending) {
        // Chrome (notably Android) can silently drop a speak() that races a
        // cancel() — stop current playback, then speak on a short delay.
        synth.cancel();
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(doSpeak, 120);
      } else {
        doSpeak();
      }
    } catch {
      setSpeakingId(null);
      setError("Audio playback fail ho gaya. Reply padh sakte hain.");
    }
  }, []);

  return { supported, speakingId, error, speak, stop };
}
