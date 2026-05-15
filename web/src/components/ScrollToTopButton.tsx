import { RefObject, useEffect, useState } from "react";

interface ScrollToTopButtonProps {
  containerRef: RefObject<HTMLElement | null>;
  /** Threshold in px before the button appears. Default 600. */
  threshold?: number;
}

/**
 * Floating chevron-up button that appears when the scroll container is past the
 * threshold. Positioned bottom-left (away from the typical right-hand thumb
 * zone on mobile) and well above the bottom nav. The container ref is required
 * because each screen has its own .yk-scroll element — we can't rely on the
 * window scroll.
 */
export function ScrollToTopButton({ containerRef, threshold = 600 }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf: number | null = null;
    function onScroll() {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        setVisible(el!.scrollTop > threshold);
      });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    // Sync initial state in case the user lands on a restored scroll position.
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [containerRef, threshold]);

  function scrollToTop() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Volver arriba"
      style={{
        position: "fixed",
        left: 16,
        bottom: 88,
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: 0,
        background: "var(--brand-700)",
        color: "#fff",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 40,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}
