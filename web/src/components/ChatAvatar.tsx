import { ReactNode, useState } from "react";

interface ChatAvatarProps {
  /** Used both for the deterministic colour and as a stable React key. */
  chatId: number;
  /** Telegram chat photo file_id. null/undefined → render the glyph fallback. */
  photoFileId?: string | null;
  /** Icon rendered when no photo is available (e.g. I.hash / I.group). */
  glyph: ReactNode;
  /** Square side in pixels. */
  size?: number;
  /** Border radius — defaults to the design's softer 18px for hero avatars. */
  radius?: number;
}

// Same 8-tone palette as user avatars (yk-av-1..8). Deterministic from chatId so
// repeated renders of the same chat stay on the same colour.
function chatAvClass(chatId: number): string {
  const n = (Math.abs(chatId) % 8) + 1;
  return `yk-av-${n}`;
}

export function ChatAvatar({ chatId, photoFileId, glyph, size = 44, radius = 14 }: ChatAvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  if (photoFileId && !photoFailed) {
    return (
      <div className="yk-avatar" style={{ ...base, padding: 0, overflow: "hidden" }} aria-hidden>
        <img
          src={`/api/photos/${encodeURIComponent(photoFileId)}`}
          alt=""
          onError={() => setPhotoFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  return (
    <div className={`yk-avatar ${chatAvClass(chatId)}`} style={base} aria-hidden>
      {glyph}
    </div>
  );
}
