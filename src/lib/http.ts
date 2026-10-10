import { NextResponse } from "next/server";

/** Shared route helpers (no env access — safe outside server-only dirs). */

export function jsonResponse(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function badRequest(message: string): NextResponse {
  return jsonResponse(
    { error: { code: "VALIDATION_FAILED", message, retryable: false } },
    { status: 400 },
  );
}

export function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseBody<T>(raw: unknown, shape: (v: unknown) => T | null): T | null {
  return raw && typeof raw === "object" ? shape(raw) : null;
}
