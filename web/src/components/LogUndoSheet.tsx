import { useState } from "react";
import { I } from "./Icon";
import { SlideToConfirm } from "./SlideToConfirm";
import type { ActivityLogEntry, ActivityLogType } from "../types/api";

interface Props {
  log: ActivityLogEntry;
  onClose: () => void;
  /** Throws to surface server errors back to this sheet for inline display. */
  onConfirm: () => Promise<void>;
}

interface UndoCopy {
  title: string;
  desc: string;
  slideLabel: string;
  icon: React.ReactNode;
  danger?: boolean;
}

function targetLabel(log: ActivityLogEntry): string {
  if (log.targetName?.trim()) return log.targetName;
  if (log.targetUsername?.trim()) return `@${log.targetUsername.replace(/^@/, "")}`;
  if (log.targetId !== null && log.targetId !== undefined) return `ID ${log.targetId}`;
  if (log.targetRef) return log.targetRef;
  return "—";
}

function copyFor(log: ActivityLogEntry): UndoCopy {
  const target = targetLabel(log);
  switch (log.type as ActivityLogType) {
    case "warn":
      return {
        title: `Deshacer aviso · ${target}`,
        desc: "Resta uno al contador de avisos de este usuario. Si tenía 3/3, también se le quita el ban automático.",
        slideLabel: "Desliza para deshacer aviso",
        icon: I.refresh({ size: 20 }),
      };
    case "silence":
      return {
        title: `Deshacer silencio · ${target}`,
        desc: "Quita el silencio en Telegram y limpia el estado en YukiBot.",
        slideLabel: "Desliza para quitar silencio",
        icon: I.silence({ size: 20 }),
      };
    case "ban":
    case "autoban":
      return {
        title: `Deshacer ban · ${target}`,
        desc: "Quita el ban en Telegram. El usuario podrá volver al grupo si tiene un enlace de invitación.",
        slideLabel: "Desliza para quitar ban",
        icon: I.check({ size: 20 }),
        danger: true,
      };
    case "feature_toggle":
      return {
        title: `Deshacer cambio · ${log.targetRef ?? "función"}`,
        desc: "Vuelve la función a su estado anterior. Solo el propietario del chat puede deshacer cambios de configuración.",
        slideLabel: "Desliza para revertir",
        icon: I.toggle({ size: 20 }),
      };
    case "whitelist_add":
      return {
        title: `Deshacer · ${log.targetRef ?? target}`,
        desc:
          log.reason === "enlace"
            ? "Quita este dominio de la lista de enlaces permitidos."
            : "Quita a este usuario de la lista de usuarios permitidos.",
        slideLabel: "Desliza para quitar",
        icon: I.shield({ size: 20 }),
      };
    case "combo_add":
      return {
        title: `Deshacer permiso mixto`,
        desc: `Quita el dominio ${log.targetRef ?? ""} del permiso de ${target}.`,
        slideLabel: "Desliza para quitar",
        icon: I.shield({ size: 20 }),
      };
    case "banned_word_add":
      return {
        title: `Deshacer palabra · ${log.targetRef ?? ""}`,
        desc: "Quita esta palabra prohibida.",
        slideLabel: "Desliza para quitar",
        icon: I.word({ size: 20 }),
      };
    case "owner_delegate":
      return {
        title: `Revocar delegación`,
        desc: `Quita los poderes de propietario delegados a ${target}. Solo el creador del chat puede revocar.`,
        slideLabel: "Desliza para revocar",
        icon: I.star({ size: 20 }),
        danger: true,
      };
    default:
      return {
        title: "Deshacer",
        desc: "Revierte esta acción.",
        slideLabel: "Desliza para confirmar",
        icon: I.refresh({ size: 20 }),
      };
  }
}

const ERROR_COPY: Record<string, string> = {
  no_inverse: "Esta acción no se puede deshacer.",
  already_undone: "Ya se había deshecho.",
  forbidden: "Solo el propietario puede deshacer esto.",
  log_not_found: "El registro ya no existe.",
  user_not_found: "El usuario ya no está en YukiBot.",
  chat_not_found: "El chat ya no existe.",
  banned_word_not_found: "La palabra ya había sido eliminada.",
};

function friendlyError(raw: string): string {
  // ApiError.message looks like "409 already_undone" — pull off the code.
  const match = raw.match(/\b(\w+)$/);
  const code = match ? match[1] : raw;
  return ERROR_COPY[code] ?? raw;
}

export function LogUndoSheet({ log, onClose, onConfirm }: Props) {
  const cfg = copyFor(log);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "error"));
      setBusy(false);
      setResetKey((k) => k + 1);
    }
  }

  return (
    <div className="yk-sheet-overlay" onClick={onClose}>
      <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yk-sheet-handle" />
        <div style={{ padding: "8px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div
              className="yk-row-icon"
              style={
                cfg.danger
                  ? { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                  : undefined
              }
            >
              {cfg.icon}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{cfg.title}</div>
          </div>
          <div
            style={{
              color: "var(--ink-500)",
              fontSize: 14,
              marginBottom: 16,
              whiteSpace: "normal",
            }}
          >
            {cfg.desc}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                background: "var(--danger-bg)",
                color: "var(--danger-fg)",
                padding: "8px 12px",
                borderRadius: 12,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <SlideToConfirm
            label={busy ? "Deshaciendo…" : cfg.slideLabel}
            danger={cfg.danger}
            disabled={busy}
            resetKey={resetKey}
            onConfirm={confirm}
            icon={cfg.icon}
          />

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              marginTop: 12,
              width: "100%",
              padding: 12,
              background: "transparent",
              border: 0,
              color: "var(--ink-500)",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
