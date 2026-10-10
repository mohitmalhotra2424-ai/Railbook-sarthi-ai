import { PnrStatusSchema } from "@/domain/schemas";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { parseLocale } from "@/lib/i18n";
import { executeCapability } from "@/providers/registry";
import type { PnrProvider } from "@/providers/types";

/** GET /api/railway/pnr/:pnr — PNR must be exactly 10 digits (validated, never guessed). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pnr: string }> },
): Promise<Response> {
  const { pnr } = await params;
  const pnrClean = pnr.trim();
  if (!/^\d{10}$/.test(pnrClean)) {
    return badRequest("PNR must be exactly 10 digits.");
  }
  const requestId = makeRequestId();
  const locale = parseLocale(new URL(request.url).searchParams.get("locale"));

  const envelope = await executeCapability(
    "pnr",
    async (provider) => {
      const env = await (provider as PnrProvider).pnr(pnrClean, { locale, requestId });
      if (env.data !== null && !PnrStatusSchema.safeParse(env.data).success) {
        return { ...env, data: null };
      }
      return env;
    },
    requestId,
  );
  return jsonResponse(envelope);
}
