import { describe, expect, it } from "vitest";
import { freshnessFor } from "@/lib/time";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("freshnessFor", () => {
  it("returns fresh inside the TTL window", () => {
    expect(freshnessFor("2026-10-10T11:59:30Z", 60, NOW)).toBe("fresh");
  });

  it("returns stale past the TTL window", () => {
    expect(freshnessFor("2026-10-10T11:58:00Z", 60, NOW)).toBe("stale");
  });

  it("returns unknown for ttl <= 0", () => {
    expect(freshnessFor("2026-10-10T11:59:30Z", 0, NOW)).toBe("unknown");
    expect(freshnessFor("2026-10-10T11:59:30Z", -5, NOW)).toBe("unknown");
  });

  it("returns unknown for invalid timestamps", () => {
    expect(freshnessFor("not-a-date", 60, NOW)).toBe("unknown");
  });

  it("refuses to claim freshness when retrievedAt is in the future (clock skew)", () => {
    expect(freshnessFor("2026-10-10T12:01:00Z", 60, NOW)).toBe("unknown");
  });
});
