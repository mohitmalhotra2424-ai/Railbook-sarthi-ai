import { FareSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { FareProvider } from "@/providers/types";

/** GET /api/railway/fare?trainId=&from=&to=&classCode=&quota= */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = {
    trainId: url.searchParams.get("trainId")?.trim() ?? "",
    from: url.searchParams.get("from")?.trim() ?? "",
    to: url.searchParams.get("to")?.trim() ?? "",
    classCode: url.searchParams.get("classCode")?.trim() ?? "",
    quota: url.searchParams.get("quota")?.trim() || undefined,
  };
  if (!/^\d{4,6}$/.test(query.trainId)) return badRequest("'trainId' must be the 4-6 digit train number.");
  if (!query.from || !query.to) return badRequest("'from' and 'to' station codes are required.");
  if (!query.classCode) return badRequest("'classCode' is required.");

  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "fare",
    async (provider) => {
      const env = await (provider as FareProvider).fare(query, { locale, requestId, refresh: url.searchParams.get("refresh") === "1" });
      if (env.data !== null && !FareSchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
