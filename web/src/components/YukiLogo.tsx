interface YukiLogoProps {
  size?: number;
  radius?: number;
}

export function YukiLogo({ size = 64, radius }: YukiLogoProps) {
  const r = radius ?? Math.round(size * 0.31);
  return (
    <div
      aria-label="YukiBot"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: "linear-gradient(140deg, var(--brand-400), var(--brand-600))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 20px oklch(0.55 0.13 175 / 0.35)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 54 V30" />
        <path
          d="M32 30 C 22 28, 14 20, 14 12 C 22 12, 30 18, 32 30 Z"
          fill="rgba(255,255,255,0.35)"
        />
        <path
          d="M32 36 C 42 34, 50 26, 50 18 C 42 18, 34 24, 32 36 Z"
          fill="rgba(255,255,255,0.55)"
        />
        <circle cx="32" cy="48" r="2.4" fill="white" stroke="none" />
      </svg>
    </div>
  );
}
