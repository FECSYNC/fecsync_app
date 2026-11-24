"use client";

export default function DateRangePicker({
  from,
  to,
  onChange,
  label = "Date range",
  disabled,
  className = "",
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={`space-y-2 ${className}`} disabled={disabled}>
      <legend className="text-sm font-medium text-gray-700">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
          aria-label="From date"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
          aria-label="To date"
        />
      </div>
      <p className="text-xs text-gray-500">
        Dates use your company accounting timezone.
      </p>
    </fieldset>
  );
}
