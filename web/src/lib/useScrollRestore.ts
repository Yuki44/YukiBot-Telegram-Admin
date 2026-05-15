import { RefObject, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Persist and restore the scroll position of a scrollable container across
 * navigations. Keyed by an arbitrary string so the same screen can have
 * multiple distinct lists (e.g. filtered users tabs) with independent
 * positions.
 *
 * Storage is sessionStorage so it survives back/forward navigations in the
 * same tab but resets when the user closes the tab — appropriate for a
 * moderation dashboard, where multi-day "remember where I was" is overkill.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useScrollRestore(ref, `users:${chatId}:${filter}`, ready);
 *   return <div ref={ref} className="yk-scroll">…</div>;
 *
 * `ready` should flip from false → true once the list content has rendered
 * (so the scroll container is tall enough to scroll). Restoration happens
 * synchronously at the layout-effect tick after `ready` becomes true.
 */
export function useScrollRestore(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean
): void {
  const storageKey = `scroll:${key}`;
  const restored = useRef(false);

  // Restore on first ready render. useLayoutEffect avoids the visible flash
  // that useEffect would cause (paint at 0, then jump to saved position).
  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    const el = ref.current;
    if (!el) return;
    const raw = sessionStorage.getItem(storageKey);
    const top = raw ? Number(raw) : 0;
    if (Number.isFinite(top) && top > 0) {
      el.scrollTop = top;
    }
    restored.current = true;
  }, [ready, ref, storageKey]);

  // Persist scrollTop while the user scrolls — debounced to avoid hammering
  // sessionStorage on momentum scrolls.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let handle: ReturnType<typeof setTimeout> | null = null;
    function onScroll() {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => {
        sessionStorage.setItem(storageKey, String(el!.scrollTop));
      }, 80);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (handle) clearTimeout(handle);
    };
  }, [ref, storageKey]);

  // Reset the "already restored" flag when key changes (user switched filter
  // tab, etc.) so the next ready→true triggers a fresh restoration.
  useEffect(() => {
    restored.current = false;
  }, [storageKey]);
}
