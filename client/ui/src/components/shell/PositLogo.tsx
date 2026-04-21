interface PositLogoProps {
  size?: number;
  /** Render just the mark, not the wordmark. */
  markOnly?: boolean;
  className?: string;
}

/**
 * Posit brand mark: two overlapping circles — a solid indigo "posited point"
 * and a lighter outline circle offset behind it, suggesting a coordinate and
 * its reference frame. The wordmark sits on the right in Inter Medium.
 *
 * The mark is sized relative to `size` (the wordmark's cap-height); pass a
 * bigger `size` for splash, default for nav contexts.
 */
export function PositLogo({ size = 20, markOnly = false, className }: PositLogoProps) {
  // Mark is 1.15 * cap-height so it reads as bolder than the letterforms.
  const markSize = Math.round(size * 1.15);
  const strokeWidth = Math.max(1, Math.round(size * 0.07));
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.35 }}
    >
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        {/* Offset reference circle — hollow, lighter. */}
        <circle
          cx="9"
          cy="9"
          r="6"
          stroke="#4f5bd5"
          strokeOpacity="0.35"
          strokeWidth={strokeWidth}
        />
        {/* Posited point — solid indigo. */}
        <circle cx="15" cy="15" r="5" fill="#4f5bd5" />
      </svg>
      {!markOnly && (
        <span
          style={{
            fontSize: size,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#1a1a2e",
            fontFamily: 'Inter, "Public Sans", system-ui, sans-serif',
            lineHeight: 1,
          }}
        >
          Posit
        </span>
      )}
    </span>
  );
}
