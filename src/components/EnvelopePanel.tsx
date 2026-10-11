import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { tr } from "@/lib/i18n";
import { isNotConfigured } from "@/providers/envelope";
import type { ResultEnvelope } from "@/providers/types";
import { FreshnessPill } from "./FreshnessPill";
import { NotConfiguredBanner } from "./NotConfiguredBanner";
import { SourceBadge } from "./SourceBadge";

/**
 * Universal result frame (requirements 5, 6, 7): source badge, freshness
 * pill, error list, uncertainty notice, and the not-configured empty state.
 * Data rendering is injected via `renderData`.
 */
export function EnvelopePanel<T>({
  title,
  envelope,
  renderData,
  locale = "en",
}: {
  title: string;
  envelope: ResultEnvelope<T | null>;
  renderData: (data: T) => ReactNode;
  locale?: Locale;
}) {
  const notConfigured = isNotConfigured(envelope);
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-cream-300 bg-white p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-navy-900">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={envelope.source} />
          <FreshnessPill freshness={envelope.freshness} retrievedAt={envelope.retrievedAt} providerTimestamp={envelope.providerTimestamp} />
        </div>
      </header>

      {notConfigured ? (
        <NotConfiguredBanner locale={locale} />
      ) : (
        <>
          {envelope.errors.length > 0 && (
            <ul className="mb-3 space-y-1 text-xs text-alert-500" data-testid="error-list">
              {envelope.errors.map((e, i) => (
                <li key={i}>
                  [{e.code}] {e.message}
                </li>
              ))}
            </ul>
          )}

          {envelope.contradictions && envelope.contradictions.length > 0 && (
            <div
              data-testid="uncertainty-notice"
              className="mb-3 rounded-xl border border-alert-500/30 bg-alert-500/5 p-3 text-xs text-navy-800"
            >
              <p className="font-semibold">{tr("uncertaintyNotice", locale)}</p>
              <ul className="mt-1 space-y-0.5">
                {envelope.contradictions.map((c) => (
                  <li key={c.field}>
                    <span className="font-mono">{c.field}</span>:{" "}
                    {c.values.map((v) => `${v.providerId}=${JSON.stringify(v.value)}`).join(" vs ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {envelope.data !== null ? (
            <div data-testid="result-data">{renderData(envelope.data)}</div>
          ) : (
            envelope.errors.length === 0 && (
              <p className="text-xs text-navy-600">No data returned.</p>
            )
          )}
        </>
      )}
    </section>
  );
}
