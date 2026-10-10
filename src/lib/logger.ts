/**
 * Redacting logger (requirement 8: never expose API keys in logs).
 *
 * This module is server-only (allow-listed in eslint.config.mjs). It redacts
 * (a) the VALUE of every env var whose name looks credential-like, and
 * (b) secret-shaped token patterns, from every line it emits.
 */

const SECRET_ENV_PATTERN = /(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i;

const SECRET_SHAPED_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_\-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_\-]{8,}\b/g,
  /\bAIza[0-9A-Za-z_\-]{16,}\b/g,
];

export function configuredSecretValues(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        SECRET_ENV_PATTERN.test(name) &&
        typeof value === "string" &&
        value.length >= 6,
    )
    .map(([, value]) => value as string);
}

export function redact(
  input: string,
  secrets: string[] = configuredSecretValues(),
): string {
  let out = input;
  for (const secret of secrets) {
    out = out.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_SHAPED_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

type Level = "info" | "warn" | "error";

function emit(level: Level, args: unknown[]): void {
  const line = args.map(safeStringify).join(" ");
  const sink =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(redact(line));
}

export const logger = {
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};
