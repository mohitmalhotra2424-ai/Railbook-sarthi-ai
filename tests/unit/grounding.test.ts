import { describe, expect, it } from "vitest";
import { buildAssistantReply } from "@/assistant/grounding";
import { detectIntent } from "@/assistant/intents";
import type { PnrStatus } from "@/domain/schemas";
import { notConfiguredEnvelope, okEnvelope } from "@/providers/envelope";
import type { SourceInfo } from "@/providers/types";

const source: SourceInfo = {
  providerId: "fixture",
  kind: "official-api",
  termsRef: "docs/provider-terms.md#fixture",
  authorization: "configured",
};

describe("grounding (requirement 7)", () => {
  it("returns the honest not-configured message when no provider exists", () => {
    const reply = buildAssistantReply(
      detectIntent("PNR 1234567890 status"),
      [notConfiguredEnvelope("pnr", "r")],
      "en",
    );
    expect(reply.notConfigured).toBe(true);
    expect(reply.text).toContain("No authorized railway data provider is configured");
  });

  it("NEVER fabricates railway facts — temptation: PNR status without data", () => {
    const reply = buildAssistantReply(
      detectIntent("What is the status of PNR 1234567890?"),
      [notConfiguredEnvelope("pnr", "r")],
      "en",
    );
    expect(reply.text).not.toMatch(/\bCNF\b|\bRAC\b|\bWL\d*\b/i);
    expect(reply.text).not.toContain("1234567890");
    expect(reply.text).not.toMatch(/\b\d{4,6}\b/); // no invented train numbers
  });

  it("renders only fields present in provider data", () => {
    const pnr: PnrStatus = {
      pnr: "1234567890",
      trainNumber: "12951",
      trainName: "Mumbai Rajdhani",
      journeyDate: "2026-10-12",
      chartPrepared: false,
      passengers: [
        { passengerNumber: 1, bookingStatus: "3A/CNF", currentStatus: "CNF/B2" },
      ],
    };
    const env = okEnvelope({
      data: pnr,
      source,
      ttlSeconds: 120,
      requestId: "r",
    });
    const reply = buildAssistantReply(detectIntent("PNR 1234567890 status"), [env], "en");
    expect(reply.text).toContain("CNF/B2");
    expect(reply.text).toContain("Mumbai Rajdhani");
    expect(reply.notConfigured).toBe(false);
    expect(reply.sources[0]?.providerId).toBe("fixture");
  });

  it("asks for the PNR number when missing instead of guessing", () => {
    const reply = buildAssistantReply(detectIntent("mera pnr check karo"), [], "hinglish");
    expect(reply.text).toContain("10-digit PNR");
  });

  it("answers greetings deterministically in the detected locale", () => {
    const reply = buildAssistantReply(detectIntent("नमस्ते"), [], "hi");
    expect(reply.text).toContain("रेलसारथी");
    expect(reply.notConfigured).toBe(false);
  });

  it("adds an uncertainty notice when contradictions exist", () => {
    const env = {
      ...okEnvelope({
        data: {
          trainNumber: "12951",
          classCode: "3A",
          from: { code: "NDLS", name: "New Delhi" },
          to: { code: "BCT", name: "Mumbai Central" },
          baseFare: 1000,
          totalFare: 1100,
          currency: "INR",
        },
        source,
        ttlSeconds: 600,
        requestId: "r",
      }),
      contradictions: [
        {
          field: "totalFare",
          values: [
            { providerId: "prov-a", value: 1100 },
            { providerId: "prov-b", value: 1250 },
          ],
        },
      ],
    };
    const reply = buildAssistantReply(detectIntent("12951 3A fare"), [env], "en");
    expect(reply.text).toContain("Sources disagree");
    expect(reply.contradictions).toHaveLength(1);
  });
});
