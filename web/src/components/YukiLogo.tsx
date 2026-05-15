interface YukiLogoProps {
  size?: number;
  radius?: number;
}

export function YukiLogo({ size = 64, radius }: YukiLogoProps) {
  const r = radius ?? Math.round(size * 0.22);
  return (
    <div
      aria-label="YukiBot"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: "var(--ink-900)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 20px rgba(28, 26, 23, 0.25)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 512 512"
        width={size * 0.78}
        height={size * 0.78}
        aria-hidden
      >
        <path
          fill="var(--ink-100)"
          d="M 148 112 L 220 112 L 256 204 L 292 112 L 364 112 L 296 252 L 296 380 A 28 28 0 0 1 268 408 L 244 408 A 28 28 0 0 1 216 380 L 216 252 Z"
        />
      </svg>
    </div>
  );
}
