import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { configuredProviderIds } from "@/providers/config";
import { lookupStations } from "@/providers/adapters/confirmtkt-v1";
import { lookupStationsErail } from "@/providers/adapters/erail-v1";
import { providerError } from "@/domain/errors";

/**
 * GET /api/railway/stations?q=<name or code>
 *
 * Deterministic UI data-access (station autocomplete) — not part of the
 * conversation layer. Primary: confirmtkt-v1 live auto-suggestion. Fallback:
 * erail-v1's local station table (stations.js, ~9000 stations, 6 h cache).
 * Returns an honest not-configured payload when neither provider is listed
 * in RAILWAY_PROVIDER_IDS, and an error payload (never fabricated stations)
 * when upstreams fail.
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

  const ids = new Set(configuredProviderIds());
  const ctkt = ids.has("confirmtkt-v1");
  const erail = ids.has("erail-v1");
  if (!ctkt && !erail) {
    return jsonResponse({
      requestId,
      stations: [],
      source: { providerId: "none", authorization: "not-configured" },
      errors: [providerError("NOT_CONFIGURED", "Station lookup provider not configured.")],
    });
  }

  if (ctkt) {
    try {
      const stations = await lookupStations(q);
      if (stations.length > 0) {
        return jsonResponse({
          requestId,
          stations,
          source: { providerId: "confirmtkt-v1", authorization: "configured" },
        });
      }
      // No match upstream — fall through to the eRail table before giving up.
    } catch {
      // fall through to the eRail fallback
    }
  }

  if (erail) {
    try {
      const stations = await lookupStationsErail(q);
      return jsonResponse({
        requestId,
        stations,
        source: { providerId: "erail-v1", authorization: "configured" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse(
        {
          requestId,
          stations: [],
          source: { providerId: "erail-v1", authorization: "configured" },
          errors: [providerError("UPSTREAM_ERROR", `Station lookup failed: ${message}`, { retryable: true })],
        },
        { status: 502 },
      );
    }
  }

  // confirmtkt configured but returned nothing / failed, and no eRail fallback.
  return jsonResponse(
    {
      requestId,
      stations: [],
      source: { providerId: "confirmtkt-v1", authorization: "configured" },
      errors: [providerError("NOT_FOUND", `No station matched "${q}".`, { retryable: false })],
    },
    { status: 404 },
  );
}
