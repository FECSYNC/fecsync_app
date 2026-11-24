"use client";

import { useAccountingTaxCodesQuery } from "@/hooks/useAccounting";

export default function TaxCodePicker({
  value,
  onChange,
  label = "Tax code",
  allowEmpty = true,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (taxCodeId: string) => void;
  label?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useAccountingTaxCodesQuery({}, !disabled);
  const codes = (data ?? []).filter((t) => t.isActive);

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 flex items-center justify-between gap-2 font-medium text-stone-700">
        <span>{label}</span>
        {isLoading ? (
          <span className="text-[11px] font-normal text-stone-500">
            Loading…
          </span>
        ) : null}
      </span>
      <select
        value={value}
        disabled={disabled || isLoading}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
      >
        {allowEmpty ? (
          <option value="">{isLoading ? "Loading tax codes…" : "No tax"}</option>
        ) : null}
        {codes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.code} — {t.name} ({t.rate}%)
          </option>
        ))}
      </select>
    </label>
  );
}
