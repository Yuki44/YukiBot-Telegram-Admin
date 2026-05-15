import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Reset the active .yk-scroll container to scrollTop=0 on every route change,
 * except on routes that explicitly opt out (Usuarios and Registro use
 * useScrollRestore to preserve their scroll across detail-page navigation).
 *
 * Why a separate component instead of per-screen useEffect: the .yk-scroll
 * container is sometimes the same DOM node across screens with similar layouts,
 * so React doesn't unmount/remount it and the scroll position lingers. This
 * component forces a reset on the *previous* container before the new screen
 * paints.
 */
const PRESERVE_PATTERNS: RegExp[] = [
  /^\/chats\/[^/]+\/users(?:\?|$)/,
  /^\/chats\/[^/]+\/logs(?:\?|$)/,
];

function shouldPreserve(path: string): boolean {
  return PRESERVE_PATTERNS.some((rx) => rx.test(path));
}

export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (shouldPreserve(pathname + search)) return;
    // Reset all .yk-scroll elements — there's usually only one on screen, but
    // being defensive is cheap.
    const els = document.querySelectorAll<HTMLElement>(".yk-scroll");
    els.forEach((el) => {
      el.scrollTop = 0;
    });
  }, [pathname, search]);

  return null;
}
