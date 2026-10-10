import { TimetableSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { TimetableProvider } from "@/providers/types";

/** GET /api/railway/timetable/:id?date=YYYY-MM-DD */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const trainId = id.trim();
  if (!/^\d{4,6}$/.test(trainId)) {
    return badRequest("Train id must be the 4-6 digit train number.");
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return badRequest("'date' must be YYYY-MM-DD.");
  }
  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "timetable",
    async (provider) => {
      const env = await (provider as TimetableProvider).timetable(trainId, date, {
        locale,
        requestId,
      });
      if (env.data !== null && !TimetableSchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
