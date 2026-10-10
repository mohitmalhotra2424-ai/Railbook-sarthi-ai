import type { Metadata } from "next";
import { EnvelopePanel } from "@/components/EnvelopePanel";
import type { Disruption } from "@/domain/schemas";
import { makeRequestId } from "@/lib/http";
import { executeCapability } from "@/providers/registry";
import type { CancellationsProvider, QueryContext } from "@/providers/types";

export const metadata: Metadata = { title: "Disruptions" };

/** Live-data page: always render at request time (requestId, retrievedAt, freshness). */
export const dynamic = "force-dynamic";

export default async function DisruptionsPage() {
  const requestId = makeRequestId();
  const ctx: QueryContext = { locale: "en", requestId };
  const today = new Date().toISOString().slice(0, 10);

  const envelope = await executeCapability<Disruption[]>(
    "cancellations",
    (p) => (p as CancellationsProvider).cancellations({ date: today }, ctx),
    requestId,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-bold text-navy-900">
          Cancellations &amp; diversions{" "}
          <span className="text-navy-400">· रद्द ट्रेनें</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          Today ({today}). Only authorized-provider notices are listed.
        </p>
      </header>

      <EnvelopePanel
        title="Disruptions"
        envelope={envelope}
        renderData={(rows) => (
          <ul className="space-y-2 text-sm text-navy-900">
            {rows.map((d) => (
              <li key={`${d.trainNumber}-${d.date}`} className="rounded-xl border border-cream-300 bg-white p-3">
                <p className="font-semibold">
                  {d.trainNumber} — {d.trainName}{" "}
                  <span className="ml-1 rounded-full bg-alert-500/10 px-2 py-0.5 text-[10px] font-bold text-alert-500">
                    {d.kind}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-navy-600">
                  {d.date}
                  {d.notice ? ` · ${d.notice}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
