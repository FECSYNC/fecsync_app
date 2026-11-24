export function BrandMark({
  variant = "header",
  size = 34,
}: {
  variant?: "header" | "footer";
  size?: number;
}) {
  const bg = variant === "footer" ? "#1DB8A0" : "#0B1F2A";
  const mark = variant === "footer" ? "#0B1F2A" : "#1DB8A0";

  return (
    <span
      className="brand-mark"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        flex: `0 0 ${size}px`,
        overflow: "hidden",
        lineHeight: 0,
        display: "block",
      }}
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: size,
          height: size,
          maxWidth: size,
          maxHeight: size,
          minWidth: size,
          minHeight: size,
          aspectRatio: "1 / 1",
          display: "block",
          transform: "none",
        }}
      >
        <rect width="32" height="32" rx="8" fill={bg} />
        <path
          d="M9 8h14v3.2H12.4V14h8.8v3.2H12.4V24H9V8z"
          fill={mark}
        />
        <circle cx="23.5" cy="22.5" r="3.5" fill="#F4B942" />
      </svg>
    </span>
  );
}
