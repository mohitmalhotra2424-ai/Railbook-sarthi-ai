import type { ResultBlock, TrainCard } from "@/assistant/orchestrator";
import { availabilityKind, KIND_LABEL } from "../results/status";

export interface SpeakableMessage {
  text?: string;
  cards?: TrainCard[];
  blocks?: ResultBlock[];
}

/** Concise spoken summary built ONLY from verified structured data in the
 *  message (cards/blocks). Never invents availability, fare or status; the
 *  exact provider status category is spoken via the existing honest label. */
export function speechSummary(m: SpeakableMessage): string {
  const bits: string[] = [];
  if (m.text) bits.push(m.text);
  for (const c of m.cards ?? []) {
    const av = (c.availability ?? [])
      .map((a) => `${a.classCode} ${KIND_LABEL[availabilityKind(a.status)]}`)
      .join(", ");
    bits.push(`${c.trainNumber} mein ${av || "abhi availability verify nahi hui"}.`);
  }
  for (const b of m.blocks ?? []) {
    if (b.kind === "availability") {
      bits.push(
        `${b.data.trainNumber}: ` +
          b.data.classes.map((x) => `${x.classCode} ${KIND_LABEL[availabilityKind(x.status)]}`).join(", ") +
          ".",
      );
    } else if (b.kind === "fare") {
      bits.push(`${b.data.trainNumber} ${b.data.classCode} fare ${b.data.totalFare} rupees hai.`);
    } else if (b.kind === "live") {
      bits.push(
        b.data.running === null
          ? `${b.data.trainNumber} ki live position verify nahi hui.`
          : `${b.data.trainNumber} ${
              b.data.running ? "running hai" : "running nahi hai"
            }, last report ${b.data.lastStation?.name ?? "unknown"}.`,
      );
    }
  }
  return bits.join(" ");
}
