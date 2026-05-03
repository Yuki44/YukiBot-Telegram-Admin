import type { UserRecord } from "../types/api";
import { timeUntil } from "../lib/utils";

interface Props {
  user: UserRecord;
  compact?: boolean;
}

export function StatusPills({ user, compact = false }: Props) {
  const pills: { tone: "danger" | "info" | "warn" | "neutral"; label: string }[] = [];

  if (user.isBanned) pills.push({ tone: "danger", label: "Baneado" });
  else if (user.isMuted) {
    let label = "Silenciado";
    if (!compact && user.muteUntil) label = `Silenciado · ${timeUntil(user.muteUntil)}`;
    pills.push({ tone: "info", label });
  }
  if (user.warnings > 0) pills.push({ tone: "warn", label: `${user.warnings}/3 avisos` });

  if (pills.length === 0 && user.wasBanned) pills.push({ tone: "neutral", label: "Reincidente" });

  if (pills.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
      {pills.map((p, i) => (
        <span key={i} className={`yk-chip ${p.tone}`}>
          {p.label}
        </span>
      ))}
    </div>
  );
}
