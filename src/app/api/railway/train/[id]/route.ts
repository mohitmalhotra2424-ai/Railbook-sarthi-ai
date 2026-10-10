import { TrainDetailsSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapabilityFailover } from "@/providers/registry";
import type { TrainDetailsProvider } from "@/providers/types";

/** GET /api/railway/train/:id */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const trainId = id.trim();
  if (!/^\d{4,6}$/.test(trainId)) {
    return badRequest("Train id must be the 4-6 digit train number.");
  }
  const requestId = makeRequestId();
  const locale = parseLocale(new URL(request.url).searchParams.get("locale"));

  const envelope = await executeCapabilityFailover(
    "trainDetails",
    async (provider) => {
      const env = await (provider as TrainDetailsProvider).details(trainId, { locale, requestId });
      if (env.data !== null && !TrainDetailsSchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
