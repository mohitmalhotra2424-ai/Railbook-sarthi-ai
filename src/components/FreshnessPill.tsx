import type { Freshness } from "@/providers/types";

const STYLES: Record<Freshness, string> = {
  fresh: "border-signal-500/30 bg-signal-500/10 text-signal-700",
  stale: "border-alert-500/30 bg-alert-500/10 text-alert-500",
  unknown: "border-cream-300 bg-cream-200 text-navy-600",
};

/** Requirement 6: retrieval timestamp + freshness on every result. */
export function FreshnessPill({
  freshness,
  retrievedAt,
  providerTimestamp,
}: {
  freshness: Freshness;
  retrievedAt: string;
  /** Documented upstream timestamp; `null` = provider gave none. */
  providerTimestamp?: string | null;
}) {
  const time = new Date(retrievedAt);
  const label = Number.isNaN(time.getTime())
    ? retrievedAt
    : time.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span
        data-testid="freshness-pill"
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STYLES[freshness]}`}
      >
        {freshness} · {label}
      </span>
      {providerTimestamp === null && (
        <span
          data-testid="provider-timestamp-note"
          className="text-[10px] text-navy-400"
        >
          Provider timestamp unavailable — freshness cannot be verified.
        </span>
      )}
      {typeof providerTimestamp === "string" && providerTimestamp && (
        <span className="text-[10px] text-navy-400">Provider timestamp: {providerTimestamp}</span>
      )}
    </span>
  );
}
