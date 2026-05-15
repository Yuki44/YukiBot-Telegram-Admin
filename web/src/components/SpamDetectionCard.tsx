import { useState } from "react";
import { I } from "./Icon";
import { SlideToConfirm } from "./SlideToConfirm";
import { UserAvatar } from "./UserAvatar";
import { timeAgo } from "../lib/utils";
import type { SpamDetection } from "../types/api";

interface SpamDetectionCardProps {
  detection: SpamDetection;
  onPermit: (patternId: string) => Promise<void>;
  onDiscard: (patternId: string) => Promise<void>;
  onOpenProfile: (userId: number) => void;
}

const MEDIA_LABEL: Record<string, string> = {
  "[media:photo]": "Foto sospechosa",
  "[media:video]": "Vídeo sospechoso",
  "[media:document]": "Documento sospechoso",
  "[media:audio]": "Audio sospechoso",
  "[media:voice]": "Nota de voz sospechosa",
  "[media:sticker]": "Sticker sospechoso",
  "[media:other]": "Mensaje sospechoso",
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function SpamDetectionCard({
  detection,
  onPermit,
  onDiscard,
  onOpenProfile,
}: SpamDetectionCardProps) {
  const [busy, setBusy] = useState<"permit" | "discard" | null>(null);
  const [slideReset, setSlideReset] = useState(0);
  const [expanded, setExpanded] = useState(false);

  async function handle(action: "permit" | "discard") {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "permit") await onPermit(detection.patternId);
      else await onDiscard(detection.patternId);
    } catch {
      // Bump reset so the slider snaps back if the parent fails.
      setSlideReset((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  const triggerName =
    detection.triggeredByName?.trim() ||
    detection.triggeredByUsername?.trim() ||
    `ID ${detection.triggeredByUserId}`;
  const triggerHandle = detection.triggeredByUsername
    ? `@${detection.triggeredByUsername.replace(/^@/, "")}`
    : `ID ${detection.triggeredByUserId}`;

  // Better swipe label — descriptive enough to read on a small screen, and
  // truncates with ellipsis via .yk-slide-label CSS if the name is very long.
  const permitLabel =
    busy === "permit"
      ? "Aplicando…"
      : detection.kind === "link"
        ? "Permitir este enlace →"
        : `Permitir a ${triggerName} →`;

  // Title row content — depends on detection kind. Issue #8: drop the
  // separate icon column; for link/text the content speaks for itself, for
  // media we show the typed label without a redundant glyph.
  let titleNode: React.ReactNode;
  if (detection.kind === "link") {
    titleNode = (
      <span
        className="yk-mono"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          wordBreak: "break-all",
        }}
      >
        {detection.linkDomain ?? detection.preview}
      </span>
    );
  } else if (detection.kind === "media") {
    titleNode = MEDIA_LABEL[detection.fullText.trim()] ?? "Mensaje sospechoso";
  } else {
    titleNode = (
      <span style={{ fontStyle: "italic", color: "var(--ink-700)" }}>
        “{detection.preview}”
      </span>
    );
  }

  // Detail body shown when expanded. For text/link spam this is the verbatim
  // fullText; for media we show whatever non-marker content is attached
  // (caption, filename) if any.
  const hasDetail = detection.fullText && detection.fullText.trim().length > 0
    && !detection.fullText.trim().startsWith("[media:");

  // Show an expandable detail block whenever there's something extra to display:
  // text/link spam carries fullText, media spam may carry a mediaFileId preview.
  const isMedia = detection.kind === "media";
  const hasMediaPreview = isMedia && !!detection.mediaFileId;
  const showDetail = hasDetail || hasMediaPreview || isMedia;

  return (
    <div className="yk-card" style={{ padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35, color: "var(--ink-500)" }}>
            {titleNode}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            {timeAgo(detection.createdAt)}
          </div>
        </div>
      </div>

      {showDetail && (
        <div style={{ marginTop: 10 }}>
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color: "var(--brand-700)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {I.chevR({ size: 14 })}
              Ver detalle
              {hasDetail && (
                <span
                  style={{
                    color: "var(--ink-500)",
                    fontWeight: 400,
                    marginLeft: 4,
                    fontStyle: "italic",
                  }}
                >
                  {truncate(detection.fullText.replace(/\s+/g, " "), 60)}
                </span>
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--brand-700)",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {I.chevD({ size: 14 })}
                Ocultar detalle
              </button>
              {hasMediaPreview && (
                <img
                  src={`/api/photos/${detection.mediaFileId}`}
                  alt="Contenido detectado"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: 12,
                    background: "var(--bg-sunken)",
                    marginBottom: hasDetail || (isMedia && !hasMediaPreview) ? 8 : 0,
                    display: "block",
                  }}
                />
              )}
              {hasDetail && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-sunken)",
                    borderRadius: 12,
                    fontSize: 13,
                    color: "var(--ink-700)",
                    maxHeight: 200,
                    overflow: "auto",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {detection.fullText}
                </div>
              )}
              {isMedia && !hasMediaPreview && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-sunken)",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "var(--ink-500)",
                    fontStyle: "italic",
                  }}
                >
                  Detalle no disponible para detecciones anteriores a la versión 2.0.2.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenProfile(detection.triggeredByUserId)}
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <UserAvatar name={triggerName} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {triggerName}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
            {triggerHandle}
          </div>
        </div>
        <div style={{ color: "var(--brand-700)" }}>{I.chevR()}</div>
      </button>

      <div style={{ marginTop: 14 }}>
        <SlideToConfirm
          label={permitLabel}
          disabled={busy !== null}
          resetKey={slideReset}
          onConfirm={() => handle("permit")}
        />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => handle("discard")}
            disabled={busy !== null}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: 0,
              color: "var(--ink-500)",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy === "discard" ? "…" : "Marcar como no spam"}
          </button>
        </div>
      </div>
    </div>
  );
}
