"use client";

function formatMoney(value: string | number | null | undefined, currency = "USD") {
  if (value == null || value === "") return "—";
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export default function MoneyCell({
  value,
  currency = "USD",
  className = "",
  align = "right",
}: {
  value: string | number | null | undefined;
  currency?: string;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <span
      className={`tabular-nums ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {formatMoney(value, currency)}
    </span>
  );
}

export { formatMoney };
