'use client';

import { Search } from 'lucide-react';
import CountrySearchSelect from '@/components/ui/CountrySearchSelect';

export type TailorFilterValues = {
  country: string;
  city: string;
  q: string;
  specialty: string;
};

type TailorFiltersProps = {
  values: TailorFilterValues;
  onChange: (next: TailorFilterValues) => void;
  onSubmit: () => void;
  onClear?: () => void;
};

export default function TailorFilters({
  values,
  onChange,
  onSubmit,
  onClear,
}: TailorFiltersProps) {
  return (
    <form
      className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 sm:p-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">
            Country{' '}
            <span className="font-normal text-gray-500">(optional)</span>
          </span>
          <CountrySearchSelect
            value={values.country}
            onChange={(country) =>
              onChange({ ...values, country, city: country ? values.city : '' })
            }
            placeholder="All countries"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">
            City <span className="font-normal text-gray-500">(optional)</span>
          </span>
          <input
            type="text"
            value={values.city}
            onChange={(e) => onChange({ ...values, city: e.target.value })}
            placeholder="e.g. Lagos"
            disabled={!values.country}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-50"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-gray-100">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={values.q}
            onChange={(e) => onChange({ ...values, q: e.target.value })}
            placeholder="Search by name or bio"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2.5 text-sm"
          />
        </label>
        <input
          type="text"
          value={values.specialty}
          onChange={(e) => onChange({ ...values, specialty: e.target.value })}
          placeholder="Specialty (e.g. Bridal)"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          className="inline-flex rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030] transition"
        >
          Apply filters
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
