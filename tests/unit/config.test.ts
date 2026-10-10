import { describe, expect, it } from "vitest";
import {
  bookingEnabled,
  configuredProviderIds,
  describeProviderConfig,
  isProviderCredentialPresent,
  providerKeyEnvName,
} from "@/providers/config";

const ENV = {
  NODE_ENV: "test",
  RAILWAY_PROVIDER_IDS: " acme-rail-v1 , ,beta-rail ",
  RAILWAY_PROVIDER_ACME_RAIL_V1_KEY: "super-secret-value-xyz",
} as NodeJS.ProcessEnv;

describe("provider config", () => {
  it("parses and trims ids", () => {
    expect(configuredProviderIds(ENV)).toEqual(["acme-rail-v1", "beta-rail"]);
    expect(configuredProviderIds({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("maps ids to the credential env naming convention", () => {
    expect(providerKeyEnvName("acme-rail-v1")).toBe("RAILWAY_PROVIDER_ACME_RAIL_V1_KEY");
  });

  it("reports credential presence without ever exposing values", () => {
    expect(isProviderCredentialPresent("acme-rail-v1", ENV)).toBe(true);
    expect(isProviderCredentialPresent("beta-rail", ENV)).toBe(false);

    const described = JSON.stringify(describeProviderConfig(ENV));
    expect(described).not.toContain("super-secret-value-xyz");
    expect(described).toContain('"credentialPresent":true');
    expect(described).toContain('"credentialPresent":false');
  });

  it("keeps booking disabled unless explicitly enabled (requirement 9)", () => {
    expect(bookingEnabled(ENV)).toBe(false);
    expect(bookingEnabled({ ...ENV, BOOKING_ENABLED: "true" })).toBe(true);
    expect(bookingEnabled({ ...ENV, BOOKING_ENABLED: "1" })).toBe(false);
    expect(bookingEnabled({ ...ENV, BOOKING_ENABLED: "TRUE" })).toBe(false);
  });
});
