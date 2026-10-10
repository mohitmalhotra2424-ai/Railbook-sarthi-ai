import { describeLlmConfigs } from "@/assistant/llm/config";
import { bookingEnabled, describeProviderConfig } from "@/providers/config";
import { capabilityStatus, registeredAdapters } from "@/providers/registry";
import { jsonResponse } from "@/lib/http";

/**
 * GET /api/health — configuration status WITHOUT secret values.
 * LLM section exposes provider/model/baseUrl only — never key material.
 */
export async function GET(): Promise<Response> {
  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    llm: describeLlmConfigs(),
    railway: {
      providers: describeProviderConfig(),
      registeredAdapters: registeredAdapters().map((a) => a.id),
      capabilities: capabilityStatus(),
    },
    booking: {
      // Requirement: booking stays disabled until an authorized integration
      // exists AND is explicitly enabled. Phase status: interface-only.
      enabled: bookingEnabled(),
      integrationPresent: false,
    },
  });
}
