"use client";

import { useId } from "react";

/** Decimal-string money input — never parses with float math for storage. */
export default function MoneyInput({
  value,
  onChange,
  currency = "USD",
  label,
  disabled,
  required,
  placeholder = "0.00",
  id: idProp,
  name,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  currency?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;

  const sanitize = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.-]/g, "");
    const parts = cleaned.split(".");
    if (parts.length <= 1) return cleaned;
    return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
  };

  return (
    <label className={`block text-sm ${className}`} htmlFor={id}>
      {label ? (
        <span className="mb-1 block font-medium text-gray-700">{label}</span>
      ) : null}
      <span className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-xs font-semibold text-gray-400">
          {currency}
        </span>
        <input
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(sanitize(e.target.value))}
          className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-14 pr-3 text-sm tabular-nums text-gray-900 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-gray-50"
        />
      </span>
    </label>
  );
}
