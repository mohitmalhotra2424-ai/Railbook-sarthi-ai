// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FreshnessPill } from "@/components/FreshnessPill";
import { NotConfiguredBanner } from "@/components/NotConfiguredBanner";
import { SourceBadge } from "@/components/SourceBadge";

// Vitest globals are off, so RTL cannot auto-register cleanup.
beforeEach(cleanup);

describe("NotConfiguredBanner (requirement 5)", () => {
  it("shows the canonical english copy", () => {
    render(<NotConfiguredBanner />);
    expect(screen.getByTestId("not-configured-banner").textContent).toContain(
      "Live data provider not configured.",
    );
  });

  it("supports hindi", () => {
    render(<NotConfiguredBanner locale="hi" />);
    expect(screen.getByTestId("not-configured-banner").textContent).toContain("कॉन्फ़िगर");
  });

  it("supports hinglish", () => {
    render(<NotConfiguredBanner locale="hinglish" />);
    expect(screen.getByTestId("not-configured-banner").textContent).toContain(
      "configure nahi hai",
    );
  });
});

describe("SourceBadge (requirement 6)", () => {
  it("shows the provider id when configured", () => {
    render(
      <SourceBadge
        source={{
          providerId: "prov-a",
          kind: "official-api",
          termsRef: "docs#prov-a",
          authorization: "configured",
        }}
      />,
    );
    expect(screen.getByTestId("source-badge").textContent).toContain("prov-a");
  });

  it("shows 'source: none' when unconfigured", () => {
    render(
      <SourceBadge
        source={{ providerId: "none", kind: "none", termsRef: "", authorization: "not-configured" }}
      />,
    );
    expect(screen.getByTestId("source-badge").textContent).toContain("source: none");
  });
});

describe("FreshnessPill (requirement 6)", () => {
  it("renders the freshness state", () => {
    render(<FreshnessPill freshness="stale" retrievedAt="2026-10-10T08:00:00Z" />);
    expect(screen.getByTestId("freshness-pill").textContent).toContain("stale");
  });

  it("renders unknown freshness without a bogus time claim", () => {
    render(<FreshnessPill freshness="unknown" retrievedAt="2026-10-10T08:00:00Z" />);
    expect(screen.getByTestId("freshness-pill").textContent).toContain("unknown");
  });
});
