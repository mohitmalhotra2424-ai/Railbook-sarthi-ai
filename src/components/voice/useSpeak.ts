"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserCapability } from "./useBrowserCapability";
import { detectTtsLanguage, speakableText } from "./lang";

/**
 * Text-to-speech with a server-first path (Prompt 34 addendum): the exact
 * assistant response is synthesized server-side via the configured
 * OpenAI-compatible endpoint and played as returned audio. If the server
 * path is unavailable (not configured, upstream error, timeout, invalid
 * audio) we fall back to the browser's speechSynthesis. We speak ONLY the
 * actual assistant response (cleaned of markdown), never a new answer, and
 * never autoplay: playback starts from an explicit user action (speaker
 * button or a user-enabled conversation mode). A generation counter makes
 * obsolete audio/fetches unable to overtake a newer turn.
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
  const browserSupported = useBrowserCapability(hasSpeechSynthesis);
  const [serverSupported, setServerSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  const genRef = useRef(0);
  const fetchCtrlRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const onEndRef = useRef(opts.onEnd);

  useEffect(() => {
    onEndRef.current = opts.onEnd;
  }, [opts.onEnd]);

  // Capability probe: server TTS configured? (no credential ever leaves server)
  useEffect(() => {
    let alive = true;
    fetch("/api/voice/speech")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean } | null) => {
        if (alive && d?.configured) setServerSupported(true);
      })
      .catch(() => {
        /* server TTS simply unavailable — browser fallback remains */
      });
    return () => {
      alive = false;
    };
  }, []);

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
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);

  const cleanupPlayback = useCallback(() => {
    if (fetchCtrlRef.current) {
      fetchCtrlRef.current.abort();
      fetchCtrlRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(
    () => () => {
      genRef.current += 1;
      cleanupPlayback();
    },
    [cleanupPlayback],
  );

  const stop = useCallback(() => {
    genRef.current += 1;
    speakingIdRef.current = null;
    setSpeakingId(null);
    cleanupPlayback();
  }, [cleanupPlayback]);

  /** Browser fallback (unchanged behaviour, language-matched voice). */
  const speakLocal = useCallback((id: string, clean: string, gen: number) => {
    if (typeof window === "undefined" || typeof window.speechSynthesis?.speak !== "function") {
      setError("Audio playback available nahi hai.");
      return;
    }
    const synth = window.speechSynthesis;
    const doSpeak = () => {
      pendingTimerRef.current = null;
      try {
        const utterance = new SpeechSynthesisUtterance(clean);
        const lang = detectTtsLanguage(clean);
        utterance.lang = lang;
        const prefix = lang.split("-")[0];
        const voice =
          voicesRef.current.find((v) => v.lang === lang) ??
          voicesRef.current.find((v) => v.lang.startsWith(prefix)) ??
          voicesRef.current.find((v) => v.lang.startsWith("hi")) ??
          voicesRef.current.find((v) => v.lang.startsWith("en"));
        if (voice) utterance.voice = voice;
        utterance.onstart = () => {
          if (genRef.current !== gen) return;
          speakingIdRef.current = id;
          setSpeakingId(id);
          setError(null);
        };
        utterance.onend = () => {
          if (genRef.current === gen && speakingIdRef.current === id) {
            speakingIdRef.current = null;
            setSpeakingId(null);
            onEndRef.current?.();
          }
        };
        utterance.onerror = () => {
          if (genRef.current === gen) {
            speakingIdRef.current = null;
            setSpeakingId(null);
            setError("Audio playback fail ho gaya. Reply padh sakte hain.");
          }
        };
        synth.speak(utterance);
      } catch {
        setSpeakingId(null);
        setError("Audio playback fail ho gaya. Reply padh sakte hain.");
      }
    };
    try {
      if (synth.speaking || synth.pending) {
        synth.cancel();
        pendingTimerRef.current = setTimeout(doSpeak, 120);
      } else {
        doSpeak();
      }
    } catch {
      setSpeakingId(null);
      setError("Audio playback fail ho gaya. Reply padh sakte hain.");
    }
  }, []);

  const speak = useCallback(
    (id: string, text: string) => {
      const clean = speakableText(text);
      if (!clean) return;
      genRef.current += 1;
      const gen = genRef.current;
      cleanupPlayback();
      speakingIdRef.current = id;
      setSpeakingId(id);
      setError(null);

      const ctrl = new AbortController();
      fetchCtrlRef.current = ctrl;
      fetch("/api/voice/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: clean }),
        signal: ctrl.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`tts http ${r.status}`);
          const ct = r.headers.get("content-type") ?? "";
          if (!ct.startsWith("audio/")) throw new Error("tts non-audio");
          return r.blob();
        })
        .then((blob) => {
          if (genRef.current !== gen || !blob) return; // obsolete — never overtake
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            if (genRef.current === gen && speakingIdRef.current === id) {
              speakingIdRef.current = null;
              setSpeakingId(null);
              onEndRef.current?.();
            }
          };
          audio.onerror = () => {
            if (genRef.current !== gen) return;
            // server audio unusable — browser fallback for this same turn
            speakLocal(id, clean, gen);
          };
          void audio.play().catch(() => {
            if (genRef.current === gen) speakLocal(id, clean, gen);
          });
        })
        .catch(() => {
          if (genRef.current !== gen) return; // superseded — no duplicate playback
          speakLocal(id, clean, gen);
        });
    },
    [cleanupPlayback, speakLocal],
  );

  return { supported: browserSupported || serverSupported, speakingId, error, speak, stop };
}
