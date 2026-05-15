import { useEffect, useState } from "react";

/**
 * Tiny ref-counted loading store. Every in-flight network request increments
 * the counter via begin(), every settled request decrements via end(). The
 * GlobalLoadingOverlay subscribes to the boolean derived from count > 0.
 *
 * Designed so the api.ts request() wrapper is the only producer — individual
 * screens never need to know about loading state.
 */

let counter = 0;
const listeners = new Set<(active: boolean) => void>();

function emit(): void {
  const active = counter > 0;
  for (const fn of listeners) fn(active);
}

export const loading = {
  begin(): void {
    counter += 1;
    if (counter === 1) emit();
  },
  end(): void {
    counter = Math.max(0, counter - 1);
    if (counter === 0) emit();
  },
  /** Current state — useful for tests, not used in production code. */
  isActive(): boolean {
    return counter > 0;
  },
  subscribe(fn: (active: boolean) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/**
 * React hook returning a debounced view of the loading state. Requests faster
 * than `graceMs` (default 200) never flip the hook to true, avoiding a
 * 100ms-flash overlay on snappy responses.
 */
export function useGlobalLoading(graceMs = 200): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = loading.subscribe((active) => {
      if (active) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setVisible(true), graceMs);
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        setVisible(false);
      }
    });
    // Sync once on mount in case requests started before subscription.
    if (loading.isActive()) {
      timer = setTimeout(() => setVisible(true), graceMs);
    }
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [graceMs]);

  return visible;
}
