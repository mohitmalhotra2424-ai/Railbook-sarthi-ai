import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrainDetailsTabs } from "@/components/TrainDetailsTabs";
import { isNotConfigured } from "@/providers/envelope";
import type { LiveStatus, Timetable, TrainDetails, Fare, Availability } from "@/domain/schemas";
import { makeRequestId } from "@/lib/http";
import { executeCapability } from "@/providers/registry";
import type {
  FareProvider,
  LiveStatusProvider,
  QueryContext,
  SeatAvailabilityProvider,
  TimetableProvider,
  TrainDetailsProvider,
} from "@/providers/types";

export const metadata: Metadata = { title: "Train" };

/** Live-data page: always render at request time (requestId, retrievedAt, freshness). */
export const dynamic = "force-dynamic";

export default async function TrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params;
  const trainId = id.trim();
  if (!/^\d{4,6}$/.test(trainId)) notFound();

  const requestId = makeRequestId();
  const ctx: QueryContext = { locale: "en", requestId };
  const today = new Date().toISOString().slice(0, 10);

  const [details, timetable, live] = await Promise.all([
    executeCapability<TrainDetails>(
      "trainDetails",
      (p) => (p as TrainDetailsProvider).details(trainId, ctx),
      requestId,
    ),
    executeCapability<Timetable>(
      "timetable",
      (p) => (p as TimetableProvider).timetable(trainId, today, ctx),
      requestId,
    ),
    executeCapability<LiveStatus>(
      "liveStatus",
      (p) => (p as LiveStatusProvider).liveStatus(trainId, today, ctx),
      requestId,
    ),
  ]);

  // Availability + fares need a resolved route; only queried when details exist.
  const route = details.data;
  const availability = route
    ? await executeCapability<Availability>(
        "seatAvailability",
        (p) =>
          (p as SeatAvailabilityProvider).availability(
            { trainId, date: today, from: route.from.code, to: route.to.code },
            ctx,
          ),
        requestId,
      )
    : null;

  const fareClasses = route?.classes?.slice(0, 6) ?? [];
  const fares = route
    ? await Promise.all(
        fareClasses.map((c) =>
          executeCapability<Fare>(
            "fare",
            (p) =>
              (p as FareProvider).fare(
                { trainId, from: route.from.code, to: route.to.code, classCode: c, date: today },
                ctx,
              ),
            requestId,
          ),
        ),
      )
    : [];

  const fareRows = fareClasses
    .map((c, i) => ({ classCode: c, env: fares[i] }))
    .filter((r) => r.env.data !== null);
  const faresNotConfigured = fareClasses.length > 0 && fares.every((f) => isNotConfigured(f));

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-navy-900">
          Train {trainId} <span className="text-navy-400">· ट्रेन विवरण</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          Every section shows its own source, retrieval time and freshness.
        </p>
      </header>

      <TrainDetailsTabs
        today={today}
        details={details}
        timetable={timetable}
        live={live}
        availability={availability}
        fareRows={fareRows}
        faresNotConfigured={faresNotConfigured}
      />
    </div>
  );
}
