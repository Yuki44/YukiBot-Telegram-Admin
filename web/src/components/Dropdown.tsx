import { useCallback, useEffect, useId, useRef, useState } from "react";
import { I } from "./Icon";

export interface DropdownOption<V> {
  value: V;
  label: string;
}

interface DropdownProps<V extends string | number> {
  value: V | undefined;
  options: DropdownOption<V>[];
  onChange: (next: V) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Aria label when there's no visible label. */
  ariaLabel?: string;
}

/**
 * Lightweight, dependency-free dropdown matching the YukiBot card aesthetic. Replaces
 * the native <select> for cases where the list itself needs to look nice (topic pickers,
 * action mode pickers). For very long lists prefer a search input — this menu doesn't
 * paginate or filter.
 */
export function Dropdown<V extends string | number>({
  value,
  options,
  onChange,
  placeholder = "Selecciona…",
  disabled = false,
  ariaLabel,
}: DropdownProps<V>) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Keep activeIdx synced when external value changes while open.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) setActiveIdx(idx);
  }, [value, options, open]);

  function pick(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    close();
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        className="yk-select"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          textAlign: "left",
          cursor: disabled ? "default" : "pointer",
          width: "100%",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected ? "var(--ink-900)" : "var(--ink-500)",
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <span
          style={{
            display: "inline-flex",
            color: "var(--ink-500)",
            transition: "transform 120ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          {I.chevD({ size: 18 })}
        </span>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          autoFocus
          onKeyDown={onListKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 40,
            background: "var(--bg-card)",
            border: "1.5px solid var(--ink-100)",
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
            padding: 4,
            maxHeight: 280,
            overflowY: "auto",
            outline: "none",
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: 12, color: "var(--ink-500)", fontSize: 14 }}>
              Sin opciones
            </div>
          ) : (
            options.map((o, idx) => {
              const isActive = idx === activeIdx;
              const isSelected = o.value === value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(idx)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    cursor: "pointer",
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: isActive ? "var(--brand-50)" : "transparent",
                    color: isSelected ? "var(--brand-700)" : "var(--ink-900)",
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.label}
                  </span>
                  {isSelected && I.check({ size: 16 })}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
