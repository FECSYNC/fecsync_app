"use client";

import DateRangePicker from "./DateRangePicker";
import LocationPicker from "./LocationPicker";

export type ReportFilterValues = {
  from: string;
  to: string;
  asOf?: string;
  locationId: string;
  compare?: boolean;
  columns?: "location" | "month" | "none";
};

export default function ReportFilters({
  value,
  onChange,
  mode = "range",
  showCompare = false,
  showColumns = false,
  className = "",
}: {
  value: ReportFilterValues;
  onChange: (next: ReportFilterValues) => void;
  mode?: "range" | "asOf";
  showCompare?: boolean;
  showColumns?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-end gap-3 rounded-2xl border border-gray-100 bg-white p-4 ${className}`}
    >
      {mode === "asOf" ? (
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">As of</span>
          <input
            type="date"
            value={value.asOf ?? value.to}
            onChange={(e) =>
              onChange({ ...value, asOf: e.target.value, to: e.target.value })
            }
            className="rounded-xl border border-gray-200 px-3 py-2"
          />
        </label>
      ) : (
        <DateRangePicker
          from={value.from}
          to={value.to}
          onChange={({ from, to }) => onChange({ ...value, from, to })}
        />
      )}
      <LocationPicker
        value={value.locationId}
        onChange={(locationId) => onChange({ ...value, locationId })}
        syncHqPreference
        className="min-w-[12rem]"
      />
      {showCompare ? (
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value.compare)}
            onChange={(e) => onChange({ ...value, compare: e.target.checked })}
          />
          Compare prior period
        </label>
      ) : null}
      {showColumns ? (
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Columns</span>
          <select
            value={value.columns ?? "none"}
            onChange={(e) =>
              onChange({
                ...value,
                columns: e.target.value as ReportFilterValues["columns"],
              })
            }
            className="rounded-xl border border-gray-200 px-3 py-2"
          >
            <option value="none">None</option>
            <option value="location">Per location</option>
            <option value="month">Per month</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
