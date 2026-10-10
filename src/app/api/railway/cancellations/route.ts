import { DisruptionSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { CancellationsProvider } from "@/providers/types";
import { z } from "zod";

/** GET /api/railway/cancellations?date=&zone=&trainId= */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = {
    date: url.searchParams.get("date")?.trim() || undefined,
    zone: url.searchParams.get("zone")?.trim() || undefined,
    trainId: url.searchParams.get("trainId")?.trim() || undefined,
  };
  if (query.date && !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    return badRequest("'date' must be YYYY-MM-DD.");
  }

  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "cancellations",
    async (provider) => {
      const env = await (provider as CancellationsProvider).cancellations(query, {
        locale,
        requestId,
      });
      if (env.data !== null && !z.array(DisruptionSchema).safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
