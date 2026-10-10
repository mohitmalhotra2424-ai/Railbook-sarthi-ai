"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe detection of a browser capability. React renders with the server
 * snapshot (false) during hydration and re-renders with the real client
 * value afterwards — no effects, no render-phase ref writes.
 */
const neverChanges = () => () => {};

export function useBrowserCapability(detect: () => boolean): boolean {
  return useSyncExternalStore(neverChanges, detect, () => false);
}
