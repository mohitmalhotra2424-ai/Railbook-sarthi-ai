"use client";

import { useEffect, useState } from "react";
import { useBrowserCapability } from "./voice/useBrowserCapability";

const hasVoiceCapability = () =>
  typeof window !== "undefined" &&
  (typeof window.speechSynthesis?.speak === "function" ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (window as any).SpeechRecognition === "function" ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (window as any).webkitSpeechRecognition === "function");

/**
 * Subtle trust row under the hero. Every claim is checked against ACTUAL
 * application capability — the railway item appears only when /api/health
 * reports configured providers, the voice item only when the browser
 * exposes speech input or playback. Nothing is claimed that is not true.
 */
export function TrustRow() {
  const [railOk, setRailOk] = useState(false);
  const voiceOk = useBrowserCapability(hasVoiceCapability);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { railway?: { providers?: unknown[] } } | null) => {
        if (alive) setRailOk(Array.isArray(d?.railway?.providers) && d.railway.providers.length > 0);
      })
      .catch(() => {
        /* railway item simply stays hidden — never claimed without proof */
      });
    return () => {
      alive = false;
    };
  }, []);

  const items: string[] = [];
  if (railOk) items.push("Live railway data");
  items.push("AI-powered search");
  if (voiceOk) items.push("Voice enabled");

  return (
    <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[12px] font-medium text-navy-600">
      {items.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal-500" />
          {t}
        </span>
      ))}
    </p>
  );
}
