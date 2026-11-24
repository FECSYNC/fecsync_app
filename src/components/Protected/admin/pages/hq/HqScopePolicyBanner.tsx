'use client';

/**
 * Step 3 honesty banner — HQ location scope vs company-wide surfaces.
 * Prefer server `scopePolicy.note` when present (single source with API/smokes).
 */
export default function HqScopePolicyBanner({
  locationScoped,
  locationName,
  policyNote,
}: {
  locationScoped: boolean;
  locationName?: string | null;
  policyNote?: string | null;
}) {
  const note = policyNote?.trim();
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700">
      {note ? (
        <p>
          {locationScoped && locationName?.trim() ? (
            <>
              Scope is set to{' '}
              <span className="font-medium text-stone-900">
                {locationName.trim()}
              </span>
              .{' '}
            </>
          ) : null}
          {note}
        </p>
      ) : locationScoped ? (
        <p>
          Scope is set to{' '}
          <span className="font-medium text-stone-900">
            {locationName?.trim() || 'one venue'}
          </span>
          . The venues list and selected-park venue items are filtered to that park.
          Park-stamped ticketing (catalog, bookings, payments, invoices)
          follows the same scope. Park-stamped products/orders filter when
          venueLocationId is set. Members roster and plan meters stay
          company-wide. Company-wide view (CWV) still controls who
          sees owned records — it does not assign a park.
        </p>
      ) : (
        <p>
          Scope is{' '}
          <span className="font-medium text-stone-900">All locations</span>.
          Venue rollups and meters are company-wide. Selecting a park in the
          header filters venue lists and park-stamped modules (ticketing;
          stamped products/orders) — members roster stays company-wide.
        </p>
      )}
    </div>
  );
}
