import { tr, type Locale } from "@/lib/i18n";

/**
 * Requirement 5: the canonical empty state. Shown wherever a data surface
 * has no authorized live provider. Never replaced by mock data.
 */
export function NotConfiguredBanner({ locale = "en" }: { locale?: Locale }) {
  return (
    <div
      role="status"
      data-testid="not-configured-banner"
      className="rounded-2xl border border-saffron-500/30 bg-saffron-500/10 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <span aria-hidden className="text-saffron-600">●</span>
        {tr("notConfiguredBanner", locale)}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-navy-700">
        {tr("notConfiguredDetail", locale)}
      </p>
    </div>
  );
}
