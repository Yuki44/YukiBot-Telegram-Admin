import { useState } from "react";
import { avClass, initials } from "../lib/utils";

interface UserAvatarProps {
  /** Display name used for the initials/colour fallback. */
  name: string;
  /** Telegram profile photo file_id. null/undefined → render initials. */
  photoFileId?: string | null;
  /** Optional fixed pixel size. Falls back to whatever `.yk-avatar` provides. */
  size?: number;
  /** Override the auto-classed avatar tone — e.g. force "yk-av-3" for the Telegram owner. */
  avatarClassName?: string;
  /** Shown instead of initials when name is empty. */
  emptyGlyph?: string;
}

export function UserAvatar({
  name,
  photoFileId,
  size,
  avatarClassName,
  emptyGlyph = "?",
}: UserAvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const sizeStyle = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  const cls = `yk-avatar ${avatarClassName ?? avClass(name)}`;

  const trimmed = name.trim();
  const fallbackText = trimmed ? initials(trimmed) : emptyGlyph;

  if (photoFileId && !photoFailed) {
    return (
      <div className={cls} style={{ ...sizeStyle, padding: 0, overflow: "hidden" }}>
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
    <div className={cls} style={sizeStyle}>
      {fallbackText}
    </div>
  );
}
