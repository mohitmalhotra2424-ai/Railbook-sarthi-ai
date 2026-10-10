import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { TrainSearchProvider } from "@/providers/types";
import { TrainSummarySchema } from "@/domain/schemas";
import { z } from "zod";

/** GET /api/railway/search?text=&from=&to=&date=&locale= */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const query = {
    text: url.searchParams.get("text")?.trim() || undefined,
    from: url.searchParams.get("from")?.trim() || undefined,
    to: url.searchParams.get("to")?.trim() || undefined,
    date: url.searchParams.get("date")?.trim() || undefined,
  };

  if (!query.text && !(query.from && query.to)) {
    return badRequest("Provide 'text', or both 'from' and 'to'.");
  }
  if (query.date && !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    return badRequest("'date' must be YYYY-MM-DD.");
  }

  const envelope = await executeCapabilityFailover(
    "trainSearch",
    async (provider) => {
      const env = await (provider as TrainSearchProvider).search(query, { locale, requestId });
      // Defense-in-depth: even adapter output is re-validated at the boundary.
      if (env.data !== null && !z.array(TrainSummarySchema).safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
