import { useGlobalLoading } from "../lib/loading";

/**
 * Centered, non-blocking loading indicator. Appears whenever there's an in-flight
 * API request slower than ~200ms (see useGlobalLoading grace period). The outer
 * wrapper has pointer-events: none so the user can keep tapping through to UI
 * underneath — this is a status indicator, not a blocker.
 *
 * Visual: warm-cream spinner on a small translucent dark disc. The disc is only
 * there so the spinner stays readable on white/light backgrounds; it isn't a
 * "dialog frame" by intent.
 */
export function GlobalLoadingOverlay() {
  const visible = useGlobalLoading();
  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(28, 26, 23, 0.55)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "3px solid rgba(244, 239, 229, 0.25)",
            borderTopColor: "#f4efe5",
            animation: "yk-spin 0.8s linear infinite",
          }}
        />
      </div>
      <style>{`@keyframes yk-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
