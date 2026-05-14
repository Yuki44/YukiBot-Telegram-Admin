import { ReactNode, useEffect, useRef, useState } from "react";
import { I } from "./Icon";

interface Props {
  label?: string;
  danger?: boolean;
  /** Disabled — slider freezes. Use during async confirm work. */
  disabled?: boolean;
  /** Reset signal — bumping this number snaps the thumb back to the start. */
  resetKey?: number;
  onConfirm: () => void;
  icon?: ReactNode;
}

export function SlideToConfirm({
  label = "Desliza para confirmar",
  danger = false,
  disabled = false,
  resetKey,
  onConfirm,
  icon,
}: Props) {
  const [fill, setFill] = useState(0);
  const [done, setDone] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const fillRef = useRef(0);

  // Keep a ref of the latest fill so the global mouseup handler reads the final value.
  useEffect(() => {
    fillRef.current = fill;
  }, [fill]);

  // External reset: parent bumps `resetKey` to restart the slider after an error.
  useEffect(() => {
    setFill(0);
    setDone(false);
    dragging.current = false;
  }, [resetKey]);

  useEffect(() => {
    function maxTravel() {
      const w = trackRef.current?.offsetWidth ?? 320;
      return w - 56;
    }
    function move(e: MouseEvent | TouchEvent) {
      if (!dragging.current || done || disabled) return;
      const x =
        "touches" in e
          ? e.touches[0]?.clientX ?? 0
          : (e as MouseEvent).clientX;
      const max = maxTravel();
      const dx = Math.max(0, Math.min(max, x - startX.current));
      setFill(dx);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      const max = maxTravel();
      const cur = fillRef.current;
      if (cur > max * 0.85) {
        setFill(max);
        setDone(true);
        setTimeout(() => onConfirm(), 250);
      } else {
        setFill(0);
      }
    }
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
    };
  }, [done, disabled, onConfirm]);

  function down(e: React.MouseEvent | React.TouchEvent) {
    if (done || disabled) return;
    dragging.current = true;
    const x =
      "touches" in e
        ? e.touches[0]?.clientX ?? 0
        : (e as React.MouseEvent).clientX;
    startX.current = x;
    if ("preventDefault" in e) e.preventDefault();
  }

  const style: React.CSSProperties & Record<string, string | number> = {
    "--fill": fill + 56 + "px",
    "--thumb": fill + 4 + "px",
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <div ref={trackRef} className={`yk-slide ${danger ? "danger" : ""}`} style={style}>
      <div className="yk-slide-track-fill" />
      <div className="yk-slide-label" style={{ opacity: 1 - Math.min(1, fill / 80) }}>
        {done ? "✓ Confirmado" : label}
      </div>
      <div className="yk-slide-thumb" onMouseDown={down} onTouchStart={down}>
        {icon ?? I.arrowR({ size: 22 })}
      </div>
    </div>
  );
}
