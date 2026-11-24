/**
 * Shared park venue multi-select for staff invite / create / edit.
 */
"use client";

export const PARK_ASSIGNMENT_REQUIRED_COPY =
  "Park admins must be assigned to at least one venue.";

export function VenueParkAssignmentField({
  venues,
  selectedIds,
  onChange,
  disabled,
  loading,
  franchiseScoped,
}: {
  venues: Array<{ id: string; name: string; status: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Franchise park manager invite/edit — parks required; no company-wide unlock. */
  franchiseScoped?: boolean;
  /** @deprecated Ignored — empty always means no park lock (CWV or own-records). */
  companyWideUnlockAllowed?: boolean;
}) {
  const active = venues.filter((v) => v.status === "active");
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2.5 space-y-2">
      <div>
        <p className="text-sm font-medium text-gray-800">Park venues</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {franchiseScoped
            ? "Assign at least one of your franchise parks. Sister parks and company-wide unlock are not available."
            : "Assign one or more parks to park-lock this seat (Growth/Starter OK — no Enterprise required). Leave empty for company-wide view (when enabled) or own-records seats (no park lock). platform_admin seats stay company-wide."}
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-gray-500">Loading venues…</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-amber-800">
          No active venues yet — create parks under Venues first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
          {active.map((v) => {
            const checked = selectedIds.includes(v.id);
            return (
              <label
                key={v.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${
                  checked
                    ? "border-[#D4AF37]/50 bg-[#D4AF37]/10 text-stone-900"
                    : "border-stone-200 bg-white text-stone-700"
                } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(v.id)}
                />
                {v.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
