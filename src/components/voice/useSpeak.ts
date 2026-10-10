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
  const onEndRef = useRef(opts.onEnd);

  useEffect(() => {
    onEndRef.current = opts.onEnd;
  }, [opts.onEnd]);

  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const stop = useCallback(() => {
    speakingIdRef.current = null;
    setSpeakingId(null);
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
    try {
      window.speechSynthesis.cancel(); // no overlapping playback
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = detectTtsLanguage(clean);
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
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeakingId(null);
      setError("Audio playback fail ho gaya. Reply padh sakte hain.");
    }
  }, []);

  return { supported, speakingId, error, speak, stop };
}
