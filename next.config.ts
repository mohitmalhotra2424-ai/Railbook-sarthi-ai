import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * cacheComponents (Cache Components / PPR) is disabled in Phase 1:
   * live-data pages opt into request-time rendering with
   * `export const dynamic = "force-dynamic"`, which cacheComponents forbids.
   * Revisit when Phase 2 adopts Suspense-boundary caching per section.
   */
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
