import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * RailSaarthi AI — ESLint config.
 *
 * GUARDRAIL (product requirement 8): `process.env` is server-only.
 * Env access is allowed exclusively in the server-module directories listed
 * below; anywhere else (pages, components, client code) it is a hard error.
 */
const SERVER_ONLY_PATTERNS = [
  "src/app/api/**",
  "src/providers/**",
  "src/assistant/**",
  "src/lib/logger.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: SERVER_ONLY_PATTERNS,
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "process.env is server-only in RailSaarthi AI. Environment access belongs in src/app/api/**, src/providers/**, src/assistant/** or src/lib/logger.ts (requirement 8: never expose keys in client code).",
        },
      ],
    },
  },
]);

export default eslintConfig;
