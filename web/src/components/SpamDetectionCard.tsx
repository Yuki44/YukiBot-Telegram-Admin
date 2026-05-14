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

function mediaIcon(text: string) {
  if (text.startsWith("[media:photo]")) return I.photo({ size: 20 });
  if (text.startsWith("[media:video]")) return I.video({ size: 20 });
  if (text.startsWith("[media:voice]") || text.startsWith("[media:audio]")) return I.mic({ size: 20 });
  if (text.startsWith("[media:sticker]")) return I.sticker({ size: 20 });
  return I.file({ size: 20 });
}

export function SpamDetectionCard({
  detection,
  onPermit,
  onDiscard,
  onOpenProfile,
}: SpamDetectionCardProps) {
  const [busy, setBusy] = useState<"permit" | "discard" | null>(null);
  const [slideReset, setSlideReset] = useState(0);

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

  const permitLabel =
    detection.kind === "link" ? "Desliza para permitir enlace" : "Desliza para permitir usuario";

  const triggerName =
    detection.triggeredByName?.trim() ||
    detection.triggeredByUsername?.trim() ||
    `ID ${detection.triggeredByUserId}`;
  const triggerHandle = detection.triggeredByUsername
    ? `@${detection.triggeredByUsername.replace(/^@/, "")}`
    : `ID ${detection.triggeredByUserId}`;

  let headIcon: React.ReactNode;
  let headTitle: React.ReactNode;
  let bodyText: string | null = null;

  if (detection.kind === "link") {
    headIcon = I.link({ size: 20 });
    headTitle = (
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
    bodyText = detection.fullText;
  } else if (detection.kind === "media") {
    headIcon = mediaIcon(detection.fullText);
    headTitle = MEDIA_LABEL[detection.fullText.trim()] ?? "Mensaje sospechoso";
  } else {
    headIcon = I.text({ size: 20 });
    headTitle = (
      <span style={{ fontStyle: "italic", color: "var(--ink-700)" }}>
        “{detection.preview}”
      </span>
    );
  }

  return (
    <div className="yk-card" style={{ padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div className="yk-row-icon" style={{ flexShrink: 0 }}>
          {headIcon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{headTitle}</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
            {timeAgo(detection.createdAt)}
          </div>
        </div>
      </div>

      {bodyText && detection.kind === "link" && bodyText.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "var(--surface-2)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--ink-600)",
            maxHeight: 80,
            overflow: "hidden",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {bodyText.length > 220 ? bodyText.slice(0, 219) + "…" : bodyText}
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenProfile(detection.triggeredByUserId)}
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <UserAvatar name={triggerName} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{triggerName}</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{triggerHandle}</div>
        </div>
        <div style={{ color: "var(--brand-700)" }}>{I.chevR()}</div>
      </button>

      <div style={{ marginTop: 12 }}>
        <SlideToConfirm
          label={busy === "permit" ? "Aplicando…" : permitLabel}
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
            {busy === "discard" ? "…" : "Descartar"}
          </button>
        </div>
      </div>
    </div>
  );
}
