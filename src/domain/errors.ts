export type ProviderErrorCode =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED_SOURCE"
  | "BOOKING_DISABLED";

export interface ProviderError {
  code: ProviderErrorCode;
  /** UI-safe message. Must never contain credentials (enforced by redaction tests). */
  message: string;
  retryable: boolean;
  /** Opaque reference into server logs. Never the raw upstream body. */
  detailRef?: string;
}

export function providerError(
  code: ProviderErrorCode,
  message: string,
  opts: { retryable?: boolean; detailRef?: string } = {},
): ProviderError {
  return {
    code,
    message,
    retryable: opts.retryable ?? false,
    ...(opts.detailRef ? { detailRef: opts.detailRef } : {}),
  };
}

/**
 * Requirement 9: booking, payment, passenger submission and ticket issuance
 * stay disabled until an authorized booking integration is supplied.
 */
export const BOOKING_DISABLED_ERROR: ProviderError = providerError(
  "BOOKING_DISABLED",
  "Booking, payment and ticket issuance are disabled until an authorized booking integration is supplied.",
);
