import { getLlmAdapter, selectedLlmProviderId } from "@/assistant/llm/client";
import { bookingEnabled, describeProviderConfig } from "@/providers/config";
import { capabilityStatus, registeredAdapters } from "@/providers/registry";
import { jsonResponse } from "@/lib/http";

/**
 * GET /api/health — configuration status WITHOUT secret values.
 * Lists every capability and whether an authorized provider serves it.
 */
export async function GET(): Promise<Response> {
  const selected = selectedLlmProviderId();
  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    llm: {
      selectedProvider: selected ?? "none",
      configured: getLlmAdapter() !== null,
    },
    railway: {
      providers: describeProviderConfig(),
      registeredAdapters: registeredAdapters().map((a) => a.id),
      capabilities: capabilityStatus(),
    },
    booking: {
      // Requirement 9: enabled flag AND a registered integration are both
      // required; Phase 1 has no BookingProvider implementation at all.
      enabled: bookingEnabled(),
      integrationPresent: false,
    },
  });
}
