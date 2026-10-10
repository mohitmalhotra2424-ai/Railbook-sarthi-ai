import type { SourceInfo } from "@/providers/types";

/** Requirement 6: every result visibly tracks its source. */
export function SourceBadge({ source }: { source: SourceInfo }) {
  const configured = source.authorization === "configured";
  return (
    <span
      data-testid="source-badge"
      title={`kind: ${source.kind}${source.termsRef ? ` · terms: ${source.termsRef}` : ""}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        configured
          ? "border-navy-200 bg-navy-50 text-navy-700"
          : "border-cream-300 bg-cream-200 text-navy-600"
      }`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-signal-500" : "bg-cream-400"}`} />
      {configured ? `source: ${source.providerId}` : "source: none"}
    </span>
  );
}
