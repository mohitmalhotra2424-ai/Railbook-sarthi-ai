import { LiveStatusSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { LiveStatusProvider } from "@/providers/types";

/** GET /api/railway/live-status?trainId=&date=YYYY-MM-DD */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const trainId = url.searchParams.get("trainId")?.trim() ?? "";
  const date = url.searchParams.get("date")?.trim() ?? "";
  if (!/^\d{4,6}$/.test(trainId)) return badRequest("'trainId' must be the 4-6 digit train number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("'date' must be YYYY-MM-DD.");

  const requestId = makeRequestId();
  const locale = parseLocale(url.searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "liveStatus",
    async (provider) => {
      const env = await (provider as LiveStatusProvider).liveStatus(trainId, date, {
        locale,
        requestId,
      });
      if (env.data !== null && !LiveStatusSchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
