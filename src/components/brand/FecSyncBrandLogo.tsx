export function FecSyncMark({
  size = 34,
  variant = "default",
  className = "",
}: {
  size?: number;
  variant?: "default" | "onDark" | "onLight";
  className?: string;
}) {
  const bg =
    variant === "onDark" ? "#1DB8A0" : variant === "onLight" ? "#0B1F2A" : "#0B1F2A";
  const mark =
    variant === "onDark" ? "#0B1F2A" : variant === "onLight" ? "#1DB8A0" : "#1DB8A0";

  return (
    <svg
      className={`fecsync-mark ${className}`.trim()}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: size,
        height: size,
        maxWidth: size,
        flexShrink: 0,
        display: "block",
        aspectRatio: "1 / 1",
      }}
    >
      <rect width="32" height="32" rx="8" fill={bg} />
      <path
        d="M9 8h14v3.2H12.4V14h8.8v3.2H12.4V24H9V8z"
        fill={mark}
      />
      <circle cx="23.5" cy="22.5" r="3.5" fill="#F4B942" />
    </svg>
  );
}

type FecSyncBrandLogoProps = {
  href?: string | null;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "onDark" | "onLight";
  showWordmark?: boolean;
  className?: string;
};

const sizeMap = {
  sm: { mark: 32, text: "text-[0.95rem]", gap: "gap-2" },
  md: { mark: 34, text: "text-[1.05rem]", gap: "gap-2.5" },
  lg: { mark: 40, text: "text-xl", gap: "gap-3" },
} as const;

/**
 * FECSYNC lockup — icon + single-line wordmark (no stretch).
 * FECSYNC = Family Entertainment Center Synchronization.
 */
export default function FecSyncBrandLogo({
  href = "/home",
  size = "md",
  variant = "onLight",
  showWordmark = true,
  className = "",
}: FecSyncBrandLogoProps) {
  const s = sizeMap[size];
  const textColor =
    variant === "onDark" ? "text-white" : "text-[#0B1F2A]";

  const inner = (
    <span
      className={`inline-flex items-center ${s.gap} max-w-full ${className}`}
    >
      <FecSyncMark size={s.mark} variant={variant} />
      {showWordmark ? (
        <span
          className={`${s.text} font-extrabold tracking-tight leading-[1.15] whitespace-nowrap ${textColor}`}
          style={{
            fontFamily: "Manrope, var(--font-mulish), system-ui, sans-serif",
            fontStretch: "100%",
            transform: "none",
            scale: "none",
          }}
        >
          FECSYNC
        </span>
      ) : null}
    </span>
  );

  if (!href) return inner;

  return (
    <a
      href={href}
      className="inline-flex items-center no-underline hover:opacity-90 transition-opacity max-w-full"
      aria-label="FECSYNC home"
    >
      {inner}
    </a>
  );
}
