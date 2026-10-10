import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { configuredProviderIds } from "@/providers/config";
import { lookupStations } from "@/providers/adapters/confirmtkt-v1";
import { providerError } from "@/domain/errors";

/**
 * GET /api/railway/stations?q=<name or code>
 *
 * Deterministic UI data-access (station autocomplete) — not part of the
 * conversation layer. Served by confirmtkt-v1's live auto-suggestion
 * endpoint (owner-authorized, docs/provider-terms.md#confirmtkt-v1).
 * Returns an honest not-configured payload when the provider is not listed
 * in RAILWAY_PROVIDER_IDS, and an error payload (never fabricated stations)
 * when upstream fails.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = makeRequestId();
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return badRequest("Provide 'q' with at least 2 characters (station name or code).");
  }
  if (q.length > 60) {
    return badRequest("'q' is too long (max 60 characters).");
  }

  if (!configuredProviderIds().includes("confirmtkt-v1")) {
    return jsonResponse({
      requestId,
      stations: [],
      source: { providerId: "none", authorization: "not-configured" },
      errors: [providerError("NOT_CONFIGURED", "Station lookup provider not configured.")],
    });
  }

  try {
    const stations = await lookupStations(q);
    return jsonResponse({
      requestId,
      stations,
      source: { providerId: "confirmtkt-v1", authorization: "configured" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        requestId,
        stations: [],
        source: { providerId: "confirmtkt-v1", authorization: "configured" },
        errors: [providerError("UPSTREAM_ERROR", `Station lookup failed: ${message}`, { retryable: true })],
      },
      { status: 502 },
    );
  }
}
