'use client';

export const CREATE_BOOKING_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'product', label: 'Product & session' },
  { id: 'guests', label: 'Guests & add-ons' },
  { id: 'options', label: 'Options' },
  { id: 'review', label: 'Review' },
] as const;

export type CreateBookingTabId = (typeof CREATE_BOOKING_TABS)[number]['id'];

type Props = {
  active: CreateBookingTabId;
  /** Highest tab index the user may jump to (completed through this index). */
  maxReachableIndex: number;
  onSelect: (id: CreateBookingTabId) => void;
};

/**
 * Horizontal domain tabs for staff Create booking (replaces 12 micro-steps).
 */
export default function CreateBookingTabs({
  active,
  maxReachableIndex,
  onSelect,
}: Props) {
  const activeIndex = CREATE_BOOKING_TABS.findIndex((t) => t.id === active);

  return (
    <nav
      className="-mx-1 flex gap-1 overflow-x-auto pb-1"
      aria-label="Create booking sections"
    >
      {CREATE_BOOKING_TABS.map((tab, i) => {
        const selected = tab.id === active;
        const reachable = i <= maxReachableIndex;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={!reachable}
            onClick={() => reachable && onSelect(tab.id)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              selected
                ? 'bg-[#D4AF37]/15 text-stone-900 ring-1 ring-[#D4AF37]'
                : reachable
                  ? 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                  : 'cursor-not-allowed text-stone-300'
            }`}
            aria-current={selected ? 'step' : undefined}
          >
            <span className="mr-1.5 text-xs text-stone-400">{i + 1}.</span>
            {tab.label}
          </button>
        );
      })}
      <span className="sr-only">
        Step {activeIndex + 1} of {CREATE_BOOKING_TABS.length}
      </span>
    </nav>
  );
}
