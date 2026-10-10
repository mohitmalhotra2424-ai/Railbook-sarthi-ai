import type { Freshness } from "@/providers/types";

/**
 * Structured result of a tool execution (requirement 5).
 *
 * Status semantics:
 *  - "ok"                 provider returned usable data. NOTE: RAC / WL(n) /
 *                         REGRET / "no seats available" are VALID railway
 *                         outcomes and arrive here — never as errors.
 *  - "not_configured"     no authorized provider is configured (honest gap).
 *  - "unavailable"        provider configured but returned no usable data.
 *  - "stale"              data returned but flagged stale by freshness rules.
 *  - "invalid_arguments"  model arguments failed schema validation (never executed).
 *  - "timeout"            provider exceeded its deadline.
 *  - "error"              provider/technical failure.
 */
export type ToolResultStatus =
  | "ok"
  | "not_configured"
  | "unavailable"
  | "stale"
  | "invalid_arguments"
  | "timeout"
  | "error";

export interface ToolResult {
  tool: string;
  /** Ties this result to the request/turn/tool-call that initiated it. */
  correlationId: string;
  status: ToolResultStatus;
  /** What the model should tell the user, in honest terms. */
  note: string;
  source?: { providerId: string; authorization: "configured" | "not-configured" };
  /** Actual retrieval timestamp when a provider answered. */
  retrievedAt?: string;
  freshness?: Freshness;
  journeyDate?: string;
  classCode?: string;
  data?: unknown;
  errors?: { code: string; message: string; retryable: boolean }[];
}

/**
 * The JSON payload handed back to the model as the tool message. Compact and
 * grounding-focused: status + note first so honesty rules bind immediately.
 */
export function toModelPayload(result: ToolResult): string {
  return JSON.stringify(result);
}

export function summarizeForUi(result: ToolResult): string {
  switch (result.status) {
    case "ok":
      return result.freshness === "stale" ? "ok (data may be stale)" : "ok";
    case "not_configured":
      return "no live provider configured";
    case "unavailable":
      return "no data available";
    case "stale":
      return "stale data";
    case "invalid_arguments":
      return "invalid arguments";
    case "timeout":
      return "timed out";
    case "error":
      return "failed";
  }
}
