/**
 * Availability status classification — deterministic labelling of the exact
 * status text a provider published. Colour is ALWAYS paired with a text
 * label (never colour-alone), and unknown text stays "as reported".
 */
export type AvailabilityKind = "available" | "rac" | "waitlist" | "unavailable" | "unknown";

export function availabilityKind(status: string): AvailabilityKind {
  const s = status.toUpperCase();
  if (/(AVAILABLE|AVL|CNF|CONFIRM)/.test(s)) return "available";
  if (/RAC/.test(s)) return "rac";
  if (/(REGRET|^NR\b|CANCEL)/.test(s)) return "unavailable";
  if (/(WL|WAITLIST)/.test(s)) return "waitlist";
  return "unknown";
}

export const KIND_LABEL: Record<AvailabilityKind, string> = {
  available: "Available",
  rac: "RAC",
  waitlist: "Waitlist",
  unavailable: "Not available",
  unknown: "As reported",
};

export const KIND_PILL: Record<AvailabilityKind, string> = {
  available: "border-signal-500/40 bg-signal-500/10 text-signal-700",
  rac: "border-saffron-500/40 bg-saffron-500/10 text-saffron-600",
  waitlist: "border-alert-500/40 bg-alert-500/10 text-alert-500",
  unavailable: "border-alert-500/40 bg-alert-500/10 text-alert-500",
  unknown: "border-navy-200 bg-navy-50 text-navy-700",
};

/** Extract a trailing station code like "Amritsar Jn (ASR)" → "ASR". */
export function stationCode(label: string): string {
  const m = /\(([A-Z0-9]{1,5})\)\s*$/.exec(label.trim());
  return m ? m[1] : "";
}

export function inr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
