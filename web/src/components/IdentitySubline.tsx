interface IdentitySublineProps {
  username?: string | null;
  userId: number;
}

/**
 * Compact sub-row showing `@username · 123456789`. Shared between Usuarios and
 * Admins screens so the styling stays consistent. The ID is mono+tabular for
 * alignment when stacked.
 */
export function IdentitySubline({ username, userId }: IdentitySublineProps) {
  const handle = username?.trim().replace(/^@/, "");
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      {handle && <span>@{handle}</span>}
      {handle && <span style={{ color: "var(--ink-300)" }}>·</span>}
      <span
        className="yk-mono"
        style={{
          fontSize: 12,
          color: "var(--ink-400)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.01em",
        }}
      >
        {userId}
      </span>
    </span>
  );
}
