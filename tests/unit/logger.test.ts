import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredSecretValues, logger, redact } from "@/lib/logger";

const SECRET = "super-secret-value-xyz";

describe("redacting logger (requirement 8)", () => {
  afterEach(() => {
    delete process.env.FAKE_TEST_API_KEY;
    vi.restoreAllMocks();
  });

  it("redacts configured secret values from log lines", () => {
    process.env.FAKE_TEST_API_KEY = SECRET;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info(`leaked key: ${SECRET}`);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain(SECRET);
    expect(line).toContain("[REDACTED]");
  });

  it("redacts secret-shaped tokens even when not configured", () => {
    const out = redact(
      "token sk-abcdefghijklmnop1234 and AIzaSyABCDEFGHIJKLMNOPQRSTUV here",
      [],
    );
    expect(out).not.toContain("sk-abcdefghijklmnop1234");
    expect(out).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUV");
    expect(out).toContain("[REDACTED]");
  });

  it("collects credential-like env values only", () => {
    const values = configuredSecretValues({
      NODE_ENV: "test",
      PATH: "/usr/bin",
      FAKE_TEST_API_KEY: SECRET,
      OPENAI_API_KEY: "",
      SHORT_TOKEN: "abc",
    } as NodeJS.ProcessEnv);
    expect(values).toContain(SECRET);
    expect(values).not.toContain("/usr/bin");
    expect(values).not.toContain("abc"); // too short to be a real secret
  });

  it("redacts inside structured (object) log arguments", () => {
    process.env.FAKE_TEST_API_KEY = SECRET;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("failure", { authorization: `Bearer ${SECRET}` });
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain(SECRET);
    expect(line).toContain("[REDACTED]");
  });
});
