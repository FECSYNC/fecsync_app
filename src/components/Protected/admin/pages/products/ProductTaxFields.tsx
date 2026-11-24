'use client';

type ProductTaxFieldsProps = {
  taxRate: string;
  taxExempt: boolean;
  onChange: (patch: { taxRate?: string; taxExempt?: boolean }) => void;
  disabled?: boolean;
  className?: string;
};

/** Shared tax controls for product create/edit forms. */
export default function ProductTaxFields({
  taxRate,
  taxExempt,
  onChange,
  disabled,
  className = '',
}: ProductTaxFieldsProps) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-4 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Tax</h3>
        <p className="text-xs text-gray-500 mt-1">
          Leave rate empty to use the global Tax Settings rate. Mark exempt to charge no tax on this item.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={taxExempt}
          disabled={disabled}
          onChange={(e) => onChange({ taxExempt: e.target.checked })}
          className="rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
        />
        Tax exempt
      </label>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Tax rate override (%)
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={taxRate}
          disabled={disabled || taxExempt}
          onChange={(e) => onChange({ taxRate: e.target.value })}
          placeholder="Use global rate"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37] disabled:bg-gray-100 disabled:text-gray-400"
        />
      </div>
    </div>
  );
}

/** Normalize form tax fields for API payloads. */
export function taxFieldsToPayload(taxRate: string, taxExempt: boolean) {
  const trimmed = taxRate.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  return {
    taxExempt: Boolean(taxExempt),
    taxRate:
      taxExempt || trimmed === '' || !Number.isFinite(parsed as number)
        ? null
        : Math.min(100, Math.max(0, parsed as number)),
  };
}
