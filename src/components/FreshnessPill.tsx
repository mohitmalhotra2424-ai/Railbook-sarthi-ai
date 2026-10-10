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
}: {
  freshness: Freshness;
  retrievedAt: string;
}) {
  const time = new Date(retrievedAt);
  const label = Number.isNaN(time.getTime())
    ? retrievedAt
    : time.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return (
    <span
      data-testid="freshness-pill"
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STYLES[freshness]}`}
    >
      {freshness} · {label}
    </span>
  );
}
