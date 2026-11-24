import Link from 'next/link';

type Surface = 'catalog' | 'sessions' | 'bookings' | 'new-booking' | 'create-product';

const COPY: Record<
  Surface,
  { title: string; body: string; nextHref?: string; nextLabel?: string }
> = {
  catalog: {
    title: 'This is the menu — not a guest visit',
    body: 'Create products and prices here. Guests (and walk-in staff) later book those products. Reservations live under Bookings.',
    nextHref: '/admin/bookings',
    nextLabel: 'Open bookings',
  },
  'create-product': {
    title: 'You are setting up what can be sold',
    body: 'Saving this product does not book a guest. After it exists, add a schedule, then guests book online — or staff sell a walk-in.',
  },
  sessions: {
    title: 'This fills the calendar for a product',
    body: 'Named slots and dates are still catalog setup. A booking is created only when someone (guest or staff) chooses a slot.',
    nextHref: '/admin/bookings/new',
    nextLabel: 'Create booking',
  },
  bookings: {
    title: 'These are real visits',
    body: 'Each row is a reservation of a ticket product. Online rows come from your public book page. Staff create walk-in, phone, or POS sales here — they do not create products.',
    nextHref: '/admin/ticketing',
    nextLabel: 'Ticket products',
  },
  'new-booking': {
    title: 'Sell an existing product at the desk',
    body: 'Start with origin and Guest or Company holder, then product, session, guests, and options. Payments and staff assign stay on the booking after create — same ticket a guest would buy online.',
    nextHref: '/admin/ticketing',
    nextLabel: 'Need a product first?',
  },
};

export default function CatalogVsBookingHint({ surface }: { surface: Surface }) {
  const c = COPY[surface];
  return (
    <aside className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
      <p>
        <span className="font-semibold text-stone-800">{c.title}.</span> {c.body}{' '}
        {c.nextHref && c.nextLabel ? (
          <Link href={c.nextHref} className="font-medium text-[#D4AF37] hover:underline">
            {c.nextLabel}
          </Link>
        ) : null}
      </p>
    </aside>
  );
}
