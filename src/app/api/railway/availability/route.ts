import { AvailabilitySchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { SeatAvailabilityProvider } from "@/providers/types";

/** GET /api/railway/availability?trainId=&date=&from=&to=&classCode= */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = {
    trainId: url.searchParams.get("trainId")?.trim() ?? "",
    date: url.searchParams.get("date")?.trim() ?? "",
    from: url.searchParams.get("from")?.trim() ?? "",
    to: url.searchParams.get("to")?.trim() ?? "",
    classCode: url.searchParams.get("classCode")?.trim() || undefined,
  };
  if (!/^\d{4,6}$/.test(query.trainId)) return badRequest("'trainId' must be the 4-6 digit train number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return badRequest("'date' must be YYYY-MM-DD.");
  if (!query.from || !query.to) return badRequest("'from' and 'to' station codes are required.");

  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "seatAvailability",
    async (provider) => {
      const env = await (provider as SeatAvailabilityProvider).availability(query, {
        locale,
        requestId,
      });
      if (env.data !== null && !AvailabilitySchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
