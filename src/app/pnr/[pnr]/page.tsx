import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnvelopePanel } from "@/components/EnvelopePanel";
import type { PnrStatus } from "@/domain/schemas";
import { makeRequestId } from "@/lib/http";
import { executeCapability } from "@/providers/registry";
import type { PnrProvider, QueryContext } from "@/providers/types";

export const metadata: Metadata = { title: "PNR status" };

/** Live-data page: always render at request time (requestId, retrievedAt, freshness). */
export const dynamic = "force-dynamic";

export default async function PnrPage({
  params,
}: {
  params: Promise<{ pnr: string }>;
}) {
  const { pnr } = await params;
  const pnrClean = pnr.trim();
  if (!/^\d{10}$/.test(pnrClean)) notFound();

  const requestId = makeRequestId();
  const ctx: QueryContext = { locale: "en", requestId };

  const envelope = await executeCapability<PnrStatus>(
    "pnr",
    (p) => (p as PnrProvider).pnr(pnrClean, ctx),
    requestId,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-lg font-bold text-navy-900">
          PNR {pnrClean} <span className="text-navy-400">· PNR स्थिति</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          PNR status is shown only as reported by an authorized provider —
          never predicted or estimated.
        </p>
      </header>

      <EnvelopePanel
        title="PNR status"
        envelope={envelope}
        renderData={(status) => (
          <div className="text-sm text-navy-900">
            <p className="font-semibold">
              {status.trainName ?? "Unknown train"}{" "}
              {status.trainNumber ? `(${status.trainNumber})` : ""}
            </p>
            <p className="text-xs text-navy-600">
              Journey: {status.journeyDate ?? "unknown"} · Chart prepared:{" "}
              {String(status.chartPrepared)}
            </p>
            <ul className="mt-2 space-y-1">
              {status.passengers.map((p) => (
                <li key={p.passengerNumber} className="flex justify-between gap-3 border-b border-cream-200 pb-1 text-xs">
                  <span>Passenger {p.passengerNumber}</span>
                  <span>
                    booking: <strong>{p.bookingStatus}</strong> · current:{" "}
                    <strong>{p.currentStatus}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      />
    </div>
  );
}
