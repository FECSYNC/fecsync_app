'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

export type HowToGuideStep = {
  title: string;
  body: string;
  /** Optional deep link shown as a button on this step */
  href?: string;
  hrefLabel?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  steps: HowToGuideStep[];
};

/**
 * Plain-language, stepped setup tutorial for admin surfaces.
 * Portaled so fixed layout is not clipped by page overflow.
 */
export default function AdminHowToGuideModal({
  open,
  onClose,
  title,
  subtitle,
  steps,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep(0);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open || steps.length === 0) return null;

  const index = Math.min(Math.max(step, 0), steps.length - 1);
  const current = steps[index]!;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const node: ReactNode = (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-howto-guide-title"
    >
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        className="relative z-[1] flex max-h-[min(92vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
              Setup guide
            </p>
            <h2
              id="admin-howto-guide-title"
              className="mt-1 text-lg font-semibold text-stone-900"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-stone-600">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            aria-label="Close guide"
            onClick={onClose}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 min-w-[1.5rem] rounded-full ${
                  i <= index ? 'bg-[#D4AF37]' : 'bg-stone-200'
                }`}
              />
            ))}
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Step {index + 1} of {steps.length}
          </p>
          <h3 className="mt-2 text-base font-semibold text-stone-900">
            {current.title}
          </h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-700">
            {current.body}
          </p>
          {current.href && current.hrefLabel ? (
            <Link
              href={current.href}
              className="mt-4 inline-flex rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-medium text-stone-900 hover:brightness-95"
              onClick={onClose}
            >
              {current.hrefLabel}
            </Link>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-200 px-5 py-3">
          <button
            type="button"
            className="rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40"
            disabled={isFirst}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          <div className="flex gap-2">
            {!isLast ? (
              <button
                type="button"
                className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-medium text-stone-900 hover:brightness-95"
                onClick={() =>
                  setStep((s) => Math.min(steps.length - 1, s + 1))
                }
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-medium text-stone-900 hover:brightness-95"
                onClick={onClose}
              >
                Got it
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
export {
  MEMBERSHIPS_PLANS_GUIDE_STEPS,
  MEMBERSHIPS_ELIGIBILITY_GUIDE_STEPS,
  MEMBERSHIPS_SETTINGS_GUIDE_STEPS,
  MEMBERSHIPS_MEMBERS_GUIDE_STEPS,
  MEMBERSHIPS_REDEEM_GUIDE_STEPS,
  MEMBERSHIPS_REPORTS_GUIDE_STEPS,
} from '@/components/Protected/admin/pages/memberships/membershipsGuides';

export const BOOKING_PACKAGES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Booking packages is for',
    body: 'Booking packages are simple online offers guests buy and pay for on a public link — for example a day-pass bundle, special event package, or fixed-price promo.\n\nHow it is used:\n• You create and publish a package on this admin page.\n• Guests open your Public book link, see the offer, enter email/name, and tap Book & pay (Stripe Checkout).\n• Paid sales appear under Recent marketplace bookings on this same page (refunds when you have permission).\n\nThis is different from Ticketing sessions (calendar slots) and from Today’s Parties (party run sheets). Here you sell a packaged offer with card payment.',
  },
  {
    title: 'Parks and “All locations”',
    body: 'If you see “All locations”, you are viewing the whole company.\n\nChoosing a park in the header filters venue lists and park-stamped modules (like ticketing). Your members list and plan meters stay company-wide.\n\nPackages themselves are company marketplace offers. If your seat is park-locked, a new package may be stamped with that park — finish payouts first, then create on this page.',
  },
  {
    title: 'Before you create a package',
    body: '1) Sign into a registered company workspace (not the FECSYNC storefront ops host).\n2) Your plan must allow booking packages (usage meter on this page).\n3) Online card pay needs Connect Ready: company Payouts for null-location / non-franchise packages; park Payouts (/admin/payouts?locationId=…) for packages stamped to a franchise park.\n\nYou can draft packages before payouts are ready — guests cannot complete card checkout until the matching Connect account shows Ready.',
    href: '/admin/payouts',
    hrefLabel: 'Open Payouts',
  },
  {
    title: 'Set up payouts (so guests can pay)',
    body: 'Go to Online Booking → Payouts (or use the button below).\n\nCompany Connect — packages with no park stamp / non-franchise catalog.\nFranchise park Connect — stamp the package to a franchise venue, then finish that park’s Connect until Ready. Sister parks stay separate.\n\nUntil then, this page shows an amber banner: you may still Publish, but Book & pay on the guest page stays blocked for that destination.',
    href: '/admin/payouts',
    hrefLabel: 'Go to Payouts',
  },
  {
    title: 'Create package — Title & Slug',
    body: 'Title * — guest-facing name at the top of the public page (large headline). Example: “Family Fun Saturday Bundle”. Keep it clear; guests see this first.\n\nSlug * — short URL piece (lowercase, hyphens). Auto-fills from the title until you edit it by hand. Used in the public link:\n/book/{your-company-slug}/{package-slug}\n\nChanging slug later changes the public URL — update any links you already shared.',
  },
  {
    title: 'Create package — Price & Currency',
    body: 'Price (major units) * — what guests pay, in normal money (e.g. 50.00). The system stores it as cents (×100) for Stripe.\n\nCurrency — fixed to USD in v1 (read-only). Matches Connect payouts. Guests see a formatted price like $50.00 under the title on the public page.\n\nEnter a value greater than zero. Wrong decimals = wrong charge.',
  },
  {
    title: 'Create package — Capacity & sale window',
    body: 'Capacity (optional) — max number of purchases for this package. Blank = unlimited. If set, use at least 1.\n\nSale starts / Sale ends (optional) — when the offer is buyable. Leave blank for always-on (while Active + Published). End must be on or after start.\n\nOutside the sale window (or when sold out), the public page shows Unavailable instead of checkout.',
  },
  {
    title: 'Create package — Publish, Active, Description',
    body: 'Publish — when on, the package can appear on the public book link (and “Public book link” shows in your Packages list). Draft = Publish off.\n\nActive — master on/off. Uncheck to take the offer offline without deleting it (shows “Inactive” in the list). Guests need both Published and Active (plus sale window / capacity / payouts) to buy.\n\nDescription — optional longer copy under the title on the guest page (what’s included, rules, ages). Plain text; line breaks are kept.\n\nTypical path: save as Active + not Published while drafting → Publish when ready.',
  },
  {
    title: 'After you create — where to use it',
    body: '1) Packages list on this page — Edit, Delete, see Draft/Published/Inactive, price, cap, slug, sale dates.\n2) Public book link — appears on each Published row when your company public key/slug is known. Open it in a new tab to preview as a guest.\n3) Share that link (email, social, QR) — there is no separate “ticket product” step for this marketplace flow.\n4) Recent marketplace bookings — paid checkouts land here for review and Refund (if your role allows).\n\nThis package does not auto-appear on Ticketing Calendar or Create booking — those use Ticket products / Sessions. Booking packages are their own pay link.',
  },
  {
    title: 'Guest preview — how the public page looks',
    body: 'URL shape: /book/{company-slug}/{package-slug}\n\nWhat guests see (top to bottom):\n• Small company name (uppercase label)\n• Large package Title\n• Description (if you wrote one)\n• Big price (currency formatted)\n• A white card form: Email (required), Name (optional), gold Book & pay button\n\nBook & pay sends them to Stripe Checkout, then back to a success/cancel page.\n\nIf the package is draft, inactive, outside the sale window, sold out, or missing — they see “Unavailable” instead of the form.\n\nTip: fill Title, Description, and Price the way you want the guest page to read, Publish, then open Public book link to verify.',
  },
  {
    title: 'Sales, refunds & plan limits',
    body: 'Each successful pay creates a marketplace booking row (package title, email, amount, status).\n\nRefund — available on paid / partially refunded rows when you have refund permission; confirms amount and refunds the application fee with the charge.\n\nPlan limit — if Create package is blocked, your booking-packages meter is full; upgrade or delete unused packages.\n\nSoft-hold / suspended companies cannot take new payments even if the package stays published.',
    href: '/admin/payouts',
    hrefLabel: 'Check Payouts status',
  },
];

export const BOOKING_ACCOUNTS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What B2B companies is for',
    body: 'B2B companies (booking accounts) are corporate / school / group clients you book for — not your SaaS company workspace, and they cannot sign in to Admin.\n\nHow it is used:\n• Create a company here with billing details.\n• Optionally add people (contacts) on View / Edit.\n• On Create booking → Details, choose Booking holder = Company and pick this account.\n• Bookings, invoices, and stored cards then roll up on the company detail page.\n\nGuest holders still type a name/email on Create booking — use Company when the visit belongs to a saved corporate client.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are working across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nWhen creating a company you can leave Park / venue as “Company-shared (all parks)” or stamp it to one park. Park-locked staff seats auto-stamp to their assigned park.',
  },
  {
    title: 'What you need before creating',
    body: '1) Permission booking_accounts:write (Create company form).\n2) Optional: venues if you want to stamp the account to one park.\n3) Ticket products (and sessions when timed) before you Create booking for that company.\n\nYou do not need contacts first — you can add people after the company exists. You do not create a SaaS login for the client.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Add company — Name & Park',
    body: 'Legal / trading name * — required. This is what staff see in the companies table and in the Create booking Company account dropdown. Example: “Acme Corp Events” or “Lincoln High PTA”.\n\nPark / venue (optional) — “Company-shared (all parks)” keeps the account usable company-wide. Pick a park to stamp it to that venue (useful for park-specific corporate clients). Park-locked seats skip this dropdown and stamp automatically.\n\nAfter Create company, the row appears in the table below.',
  },
  {
    title: 'Add company — Billing, phone, tax, notes',
    body: 'Billing email — optional default invoice / billing address for the company. Useful when finance sends invoices without picking a person each time.\n\nPhone — optional main company phone.\n\nTax ID — optional VAT / tax registration for invoices and finance.\n\nNotes — internal staff notes (PO requirements, contract terms). Not shown to the guest on public book pages.\n\nDefault tax exempt — when on, new bookings for this company can start tax-exempt (staff with permission can still override on the booking). Leave off for normal taxed corporate sales.',
  },
  {
    title: 'Reading the companies table',
    body: 'Name — company title.\n\nBilling email — from the create/edit form (— if blank).\n\nContacts — how many people saved on the company detail page.\n\nBookings — how many bookings are linked to this account.\n\nView / Edit — opens the company detail page (profile, contacts, bookings, stored cards, invoices).\n\nThere is no public guest “preview” URL for a B2B company itself — the preview of using it is on Create booking and on the company detail page.',
  },
  {
    title: 'After create — company detail (preview)',
    body: 'Open View / Edit. You will see:\n\n• Header with the company name and ← Companies.\n• Company details card — same fields as create; Save to update.\n• Contacts table — people at that company (empty until you add some).\n• Bookings card — linked visits + Create booking for company.\n• Stored cards — cards saved on the company (empty until charged/saved from a booking).\n• Invoices — invoices tied to this account.\n\nThis detail page is the “home” for that corporate client.',
    href: '/admin/booking-accounts',
    hrefLabel: 'Back to B2B companies list',
  },
  {
    title: 'Add contacts — each field',
    body: 'On the company detail page, under Contacts:\n\nFirst name / Last name — person at the company (trip leader, admin).\n\nEmail / Phone — optional contact channels for that person.\n\nTitle — job title (e.g. Events Manager).\n\nPrimary contact — mark the main person; helpful when several contacts exist.\n\nAdd contact — saves the row into the Contacts table. Contacts are not SaaS users; they do not get Admin logins.',
  },
  {
    title: 'Where to use the company when booking',
    body: '1) Create booking (from Bookings, or Create booking on the company detail page — pre-fills accountId).\n2) Details tab → Booking holder → select Company.\n3) Company account dropdown → pick the company you created.\n4) Optional contact name / email / phone for this visit (or rely on account defaults).\n5) Continue → Product & session → Guests → Options → Review & create.\n\nReview shows holder as Company plus the company name. The new booking counts under that company’s Bookings column and detail card.\n\nIf Company is missing in the holder toggle, your role may lack booking-accounts access.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings / Create booking',
  },
  {
    title: 'Create booking preview (what staff see)',
    body: 'With holder = Company and an account selected, Details looks like:\n• Channel (walk-in / phone / POS)\n• Holder toggle: Guest | Company (Company selected)\n• Company account dropdown showing your company name\n• Optional contact fields for this visit\n\nOn Review: “Company · venue …” and the account name appear in the summary before you Hold / Reserve / Confirm.\n\nAfter create, open the booking — it links back to this B2B company. From the company page, Create booking / View all on bookings list keep you in that client’s context.\n\nRemember: this is staff desk flow — not the public marketplace Booking packages pay link.',
  },
];

export const BOOKING_INVOICES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Booking invoices is for',
    body: 'This page is the company-wide list of invoices created from bookings — amounts due, send/cancel status, and links back to the visit.\n\nYou do NOT create an invoice on this list. Open a booking detail page and use Invoice (header) / the Invoices tab. New rows then appear here.\n\nDifferent from marketplace Booking packages (card pay links) and from Booking payments (payment records).',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing invoices across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nInvoices follow the booking they were created from (guest or B2B company holder).',
  },
  {
    title: 'What you need BEFORE invoices exist',
    body: '1) A booking (Create booking or an online booking) — invoices always hang off a booking.\n2) Permission booking_invoices:manage (or equivalent) to create from the booking.\n3) booking_invoices:send to Send a draft; manage rights to Cancel / edit due date.\n\nIf this list is empty: open a booking → Invoice in the header (or Invoices tab) → then return here.',
    href: '/admin/bookings',
    hrefLabel: 'Go create or open a booking',
  },
  {
    title: 'How to create an invoice (from a booking)',
    body: '1) Open All bookings → open one booking.\n2) In the booking header, click Invoice (needs invoice manage permission).\n3) The system creates a draft invoice with a number and amount from the booking totals, switches you toward the Invoices tab, and the row appears on this Booking invoices list.\n\nYou can also open existing invoices from the booking’s Invoices tab → View.\n\nThere is no “Create invoice” button on this list page on purpose — always start from the booking.',
  },
  {
    title: 'Show cancelled (filter on this page)',
    body: 'Show cancelled — checkbox under the page title.\n\nOff (default): cancelled invoices are hidden so the list stays operational.\n\nOn: cancelled invoices reappear (status cancelled) for audit / history.\n\nCancelling an invoice (when Show cancelled is off) removes it from the visible list; turn the filter on if you need to find it again.',
  },
  {
    title: 'Reading the invoices table',
    body: 'Number — invoice ID guests/staff recognize (e.g. INV-…).\n\nBooking — Open jumps to the source booking detail.\n\nCompany/guest — Company if the booking holder is a B2B account; Guest otherwise.\n\nStatus — typically draft (not sent), sent, cancelled (and similar lifecycle values).\n\nTotal — invoice amount and currency.\n\nDue — due date if set (— if none).\n\nSent — when it was marked sent (— if still draft).\n\nActions — View, Send (draft + send permission), Cancel (draft/sent + manage), Download.',
  },
  {
    title: 'Actions — Send, Cancel, Download, View',
    body: 'View — opens the invoice detail page (number, status, total, due, sent, link to booking).\n\nSend — available on draft when you have send permission. Marks the invoice sent and records Sent time (email/delivery depends on your configured invoice send path).\n\nCancel — available on draft or sent with manage permission. Confirms first; status becomes cancelled. Hidden from this list unless Show cancelled is on.\n\nDownload — saves a simple text file (number, status, amount, due, sent, booking id) for offline share or records.',
  },
  {
    title: 'Invoice detail preview (what you see)',
    body: 'Open View. Preview layout:\n• ← Invoices back link\n• Large invoice Number as the title\n• Subline: status · formatted total\n• Due / Sent / Open booking rows\n• If draft or sent and you can manage: Due date picker + Staff notes (download only) + Save due date\n• Buttons: Download, Send (if draft), Cancel invoice\n\nStaff notes are for internal / download context — not a full PDF designer. Amount comes from the booking at create time.',
    href: '/admin/booking-invoices',
    hrefLabel: 'Back to invoice list',
  },
  {
    title: 'Where invoices show up elsewhere',
    body: 'Booking detail → Invoices tab — invoices for that visit only.\n\nB2B company detail → Invoices card — invoices tied to that corporate account.\n\nThis Booking invoices page — company-wide operational list.\n\nGuest-facing “preview” is not a public storefront page; finance/staff use View + Download / Send. Payments against the booking still live under Booking payments / the booking’s payment tools.',
    href: '/admin/booking-accounts',
    hrefLabel: 'Open B2B companies',
  },
];

export const BOOKING_PAYMENTS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Payments is for',
    body: 'This page is your company venue booking payment ledger — every recorded payment against a booking (cash, card, gift card, links, etc.).\n\nIt is a read/filter ledger. You do NOT take a payment on this page. Record money from a booking: open the booking (or Bookings list / Parties) → Take payment.\n\nDifferent from Booking invoices (bill documents) and from marketplace Booking packages (public card checkout).',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing payments across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nUse the Venue filter on this page (or the header park) to narrow the ledger to one park’s bookings.',
  },
  {
    title: 'What you need BEFORE payments appear',
    body: '1) A booking that exists (Create booking or online).\n2) Staff take payment on that booking (Take payment modal) — or a guest pays a payment link / online flow that records a payment row.\n3) Permission to view booking payments for this admin page.\n\nEmpty list usually means no payments recorded yet — not a broken ledger. Create or open a booking and Take payment first.',
    href: '/admin/bookings',
    hrefLabel: 'Go take a payment on a booking',
  },
  {
    title: 'How to record a payment (where to go)',
    body: '1) Open All bookings → open a booking (or use Take payment from the list/actions when shown).\n2) Click Take payment — modal shows booking public ID and amount due.\n3) Choose tender (Cash, Card/Stripe, Gift card, Stored card if allowed, Invoice marker, Split cash + card).\n4) Enter amount (or split amounts) → Record payment.\n\nOptional in the same modal: Send payment link (email/phone + optional SMS), Create invoice, Refund (if permitted).\n\nAfter success, the row appears on this Payments ledger and on the booking’s Payments tab.',
  },
  {
    title: 'Filters on this page',
    body: 'Search — guest name, email, booking public id, or payment intent (PI) text. Narrows the ledger as you type/filter.\n\nFrom / To dates — payment created date range (inclusive calendar days).\n\nVenue — All venues, or one park. Park-locked / HQ-scoped seats may lock this dropdown.\n\nClear search and dates, set Venue to All venues, to see the full company ledger again.',
  },
  {
    title: 'Reading the payments table',
    body: 'When — date/time the payment was recorded (venue time format).\n\nBooking — public id (or id); gold link opens that booking detail.\n\nGuest — holder name; email underneath when present.\n\nVenue — park stamped on the booking.\n\nAmount — money recorded (formatted currency).\n\nTender — how it was taken (cash, card, gift_card, stored_card, invoice, split, etc.).\n\nStatus — payment lifecycle (e.g. succeeded / recorded status from the payment engine).\n\nClick the booking link to see the full Payments tab, refunds, and Take payment again.',
  },
  {
    title: 'Take payment preview (what staff see)',
    body: 'Modal title: Take payment · booking publicId · due $X.XX.\n\nFields:\n• Tender dropdown (Cash, Card, Gift card, Stored card, Invoice marker, Split)\n• Amount (or Cash + Card boxes for Split)\n• Gift card code / Stored payment method ID when those tenders are selected\n• Record payment (primary)\n• Payment link block: Send to email or phone, Also SMS, Send payment link\n• Invoice / refund block when allowed\n\nAfter Record payment, Close returns you to the booking; this Payments page lists the new ledger row when you refresh or revisit.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings to try Take payment',
  },
  {
    title: 'Where payments show up elsewhere',
    body: 'Booking detail → Payments tab — payments for that visit only + refund form when allowed.\n\nBookings list / Parties — Take payment action on eligible rows.\n\nThis Payments page — company-wide searchable ledger.\n\nB2B company stored cards are charged via Take payment (Stored card), not created here.\n\nMarketplace Booking package card sales appear under Booking packages → marketplace bookings — not always this venue ledger.',
    href: '/admin/booking-packages',
    hrefLabel: 'Marketplace packages (separate)',
  },
];

export const PARTIES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Today’s Parties is for',
    body: 'This page is your daily party run sheet — who is coming today (or another date you pick), which room, how many kids, balance due, and print/open actions.\n\nIt only lists party package bookings, not every regular ticket booking.',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are looking across every venue in the company.\n\nPick a venue in the filter (or a park in the header) when you only want one site’s parties. Members and plan limits stay company-wide.',
  },
  {
    title: 'What you need before the first party',
    body: 'You need, at the same venue:\n1) A venue (park) already created.\n2) A capacity resource typed as Room or Party room.\n3) A Ticket product typed Party package, linked to that room.\n4) Sessions (date/time slots) for that product.',
    href: '/admin/ticketing/resources',
    hrefLabel: 'Open Capacity resources',
  },
  {
    title: 'Create the party product',
    body: 'Go to Online Booking → Ticket products → Add product.\n\nChoose your venue, type Party package, attach your party room, set prices, and publish.\n\nThen add sessions so the calendar has bookable slots.',
    href: '/admin/ticketing/products/new?type=party_package',
    hrefLabel: 'Create party product',
  },
  {
    title: 'Book a party',
    body: 'Click Create party booking on this page (or Create booking and choose Party package).\n\nPick the venue, the party product, a session slot, guest details, then create.\n\nThat booking becomes a party record with a run sheet. Open the party and use the Waivers tab to see which listed guests are still missing a current waiver and to send a signing link to the booking contact. That party link is separate from the booking confirmation link. A named guest stays missing until a record is stored for that guest. The other party tabs are unchanged. This is not a check-in scanner.',
    href: '/admin/bookings/new?party=1',
    hrefLabel: 'Create party booking',
  },
  {
    title: 'Find it on the run sheet table',
    body: 'Set the date picker to the party’s visit day and choose the venue (or All venues).\n\nOnly parties for that date show under “Run sheets for …”.\n\nIf the table is empty, the party is on another day, another venue, or it was not created as a Party package product.',
  },
];

export const BOOKINGS_LIST_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What this page is for',
    body: 'This is your master list of real visits — each row is a booking of a ticket product (or party package).\n\nIt is not where you invent products. Products live under Ticket products; this page is where reserved visits appear.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Online vs staff bookings',
    body: 'Online = a guest booked from home on your public book page. The system stamps that channel automatically.\n\nAt venue / Phone / POS = your staff created the booking here. Staff never pick “Online” when creating a booking in admin — Online is only for guest self-serve checkouts.',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are looking across every venue in the company.\n\nChoosing a park in the header (or a venue filter on this page) narrows venue lists and park-stamped modules like ticketing and bookings. Members roster and plan meters stay company-wide.',
  },
  {
    title: 'Before staff can create a booking',
    body: 'You need at least:\n1) A venue.\n2) A published ticket product for that venue.\n3) Sessions (for timed / party / group products) so there is a slot to pick.\n\nWithout those, Create booking will show “no products” or an empty calendar.',
    href: '/admin/ticketing/products/new',
    hrefLabel: 'Create a ticket product',
  },
  {
    title: 'Create a booking from here',
    body: 'Click Create booking (or press Alt+Shift+N). A modal opens so you stay on this list.\n\nFill Details → Product & session → Guests → Options → Review, then create.\n\nPayments, invoices, tickets, and staff assign stay on the booking detail after create. When Digital Waivers is enabled, that detail also shows whether the booking contact still needs a waiver. The confirmation email can include a signing link for that contact. It does not clear named party guests. Check-in does not block on it.',
  },
  {
    title: 'Calendar, filters, and opening a row',
    body: 'Use Calendar to see sessions and bookings by day/month, then jump back to this list filtered by a session.\n\nUse the filters (status, channel, dates, venue) to find visits.\n\nClick a booking row (or Open) to manage payment, cancel, confirm, notes, and more.',
  },
];

export const CREATE_BOOKING_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Create booking is for',
    body: 'Use this wizard when YOUR STAFF take a booking — not when a guest already booked online.\n\nYou sell an existing ticket product (or party package) to a guest or company. You do not create products here; those live under Ticket products.\n\nTabs go in order: Details → Product & session → Guests & add-ons → Options → Review.',
    href: '/admin/ticketing',
    hrefLabel: 'Need a product first?',
  },
  {
    title: 'Do not re-enter Online bookings',
    body: 'If a guest booked on your public book page, that visit already shows under All bookings with channel Online.\n\nNever create a second booking here for the same online checkout. Online is stamped by the system only — staff cannot (and should not) pick Online in this wizard.',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are looking across the whole company.\n\nAlways pick the correct Venue in Product & session (or use the park switcher in the header) so you only see that park’s products and capacity.\n\nMembers and plan meters stay company-wide.',
  },
  {
    title: 'How was this booking taken? — overview',
    body: 'This is the first question on Details. It records HOW staff took the sale so reports and filters stay honest.\n\nThere are three staff choices only:\n• At venue (walk-in)\n• Phone\n• POS / front desk\n\nPick the one that matches the real situation. The next three guide steps explain each choice.',
  },
  {
    title: 'At venue (walk-in) — meaning & use',
    body: 'Meaning: The guest is physically at your park or front desk right now, and you are creating the booking for them in person.\n\nUse when: Someone walks up without a prior staff booking (or you are finishing a desk sale that is not on a till).\n\nDetails: Channel is saved as walk-in. Name is usually enough at the desk; add email/phone if you will send a confirmation or payment link later.\n\nDo not use this for phone calls or till/POS terminal sales.',
  },
  {
    title: 'Phone — meaning & use',
    body: 'Meaning: The guest is not on site; they called (or you called them) and you are taking the booking for them.\n\nUse when: Reservations over the phone, follow-up calls, or remote staff entry.\n\nDetails: Channel is saved as phone. Email or phone contact is more important here so you can send confirmations or payment links.\n\nDo not use this if the guest is standing at your desk (use At venue) or you are ringing them up on a till (use POS).',
  },
  {
    title: 'POS / front desk — meaning & use',
    body: 'Meaning: This is a counter / till sale — the booking is created as part of a front-desk or POS terminal workflow.\n\nUse when: Staff are selling on a POS or dedicated front-desk till flow, even if the guest is also on site.\n\nDetails: Channel is saved as pos. Like walk-in, a name may be enough; add contact details if you need receipts or links.\n\nDifference from walk-in: Walk-in = general at-venue entry. POS = explicitly marked as a till/counter sale for ops reporting.',
  },
  {
    title: 'Booking holder — what this section does',
    body: 'Booking holder answers: “Who is this booking for?”\n\nIt stores the customer (or B2B company) on the visit — for the bookings list, confirmations, payment links, invoices, and support.\n\nImportant: These fields are NEVER your staff login. Always enter the guest or corporate client.\n\nYou fill this on the Details tab, after choosing how the booking was taken (walk-in / phone / POS).',
  },
  {
    title: 'Booking holder — Guest vs Company',
    body: 'Guest: An individual customer (family, visitor, private buyer). Most walk-in and phone sales use Guest.\n\nCompany: A corporate / B2B client linked to a booking company account (not your SaaS company workspace). Use this for invoiced groups, school/corporate accounts, or clients you already saved under Companies.\n\nWhat you need:\n• Guest — nothing set up beforehand; just type their details.\n• Company — at least one company account must already exist under Online Booking → Companies. If the Company option is missing, your role may not include booking-accounts access.',
    href: '/admin/booking-accounts',
    hrefLabel: 'Open Companies (create account first)',
  },
  {
    title: 'Booking holder — Guest fields (how to fill)',
    body: '1) Select Guest.\n2) Guest name — primary name on the booking. For walk-in / POS, name alone is usually enough to Continue.\n3) Email — optional at the desk; add it if you will send a confirmation, receipt, or payment link.\n4) Phone — optional at the desk; useful for SMS/call-back or when email is missing.\n\nPhone channel tip: Phone bookings need an email OR phone number (or switch to Company with an account). The form will warn you if contact is too thin.\n\nHow to go about it: Ask the guest their name first, then only collect email/phone if they want digital follow-up or you need to send a pay link.',
  },
  {
    title: 'Booking holder — Company fields (how to fill)',
    body: '1) Select Company.\n2) Company account — required. Choose the corporate client from the dropdown. If the list is empty, create the company under Companies first, then return and refresh.\n3) Contact name (optional) — a person at that company for this visit (e.g. trip leader). Leave blank to rely on the account’s default contacts.\n4) Email / Phone (optional) — override contact for this booking only. Billing can still sit on the company account when these are blank.\n\nRemember: Company account = B2B booking client, not your own company workspace.',
    href: '/admin/booking-accounts',
    hrefLabel: 'Add a company account',
  },
  {
    title: 'Booking holder — checklist before Continue',
    body: 'Before you leave Details:\n✓ Channel matches how you took the booking (walk-in / phone / POS).\n✓ Holder is Guest or Company (customer, not staff).\n✓ Guest: name filled; email/phone if phone channel or you need links.\n✓ Company: company account selected; optional contact only if needed.\n\nThen click Continue to Product & session.',
  },
  {
    title: 'Product & session — what to pick',
    body: '1) Venue — which park this visit is for.\n2) Product type — e.g. Timed session, Party package, Day pass.\n3) Product — the specific sellable item for that venue/type.\n\nIf the list says no products of this type, create that Ticket product (and for parties: a room resource + sessions) first, then return here.\n\nTimed / party / group / camp products need a session slot. Day pass / open products may only need a visit date.',
    href: '/admin/ticketing/products/new',
    hrefLabel: 'Create ticket product',
  },
  {
    title: 'Product & session — Availabilities',
    body: 'The Availabilities panel (right side on larger screens) is the same capacity engine as Calendar.\n\nPick guests count, then a date with open seats, then a session block. Selecting a slot fills product & session on the booking.\n\nColors/status show Open, Limited, or Full. Sold-out slots cannot be taken unless you have overbook permission later in Options.',
  },
  {
    title: 'Guests & add-ons',
    body: 'Set how many guests (respects product min/max when set).\n\nChoose a price band if the product has bands (e.g. adult/child) — that sets the ticket rate.\n\nAdd optional add-ons with quantities if your catalog offers them.\n\nYou still do not take payment on this step — payment happens on the booking after create.',
  },
  {
    title: 'Options',
    body: 'Add staff notes or POS notes if useful for the team.\n\nTax exempt and overbook only appear if your role allows them. Overbook is for rare capacity overrides when a session is full — use carefully.\n\nSkip anything you do not need; most desk sales leave Options mostly empty.',
  },
  {
    title: 'Review & create',
    body: 'Check holder, channel, product, session, guests, and totals.\n\nChoose how to activate:\n• Hold — soft hold with expiry\n• Reserve — firmer hold\n• Confirm — finalise now (needs bookings:write)\n\nAfter create you land on (or open) the booking for payments, invoices, tickets, and staff assign. Those tools are intentionally not in this wizard.',
  },
];

export const BOOKINGS_CALENDAR_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What the Calendar is for',
    body: 'This page shows live sessions and bookings for your venues on a month, week, or day grid.\n\nUse it to see who is coming, which product/slot is running, and how much capacity is left — without digging through the full bookings table first.',
  },
  {
    title: 'What you need before it shows data',
    body: 'The calendar only lights up when catalog setup exists:\n1) A venue.\n2) Ticket products for that venue.\n3) Sessions (date/time + capacity) for timed / party / group products.\n4) Optional: real bookings already created (named guest chips).\n\nEmpty days usually mean no sessions that day — not a broken calendar.',
    href: '/admin/ticketing/sessions',
    hrefLabel: 'Open Sessions',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing across the whole company.\n\nSelecting a park in the header filters venue lists and park-stamped modules (ticketing, stamped products/orders, and bookings scoped to that park). Venue rollups and plan meters stay company-wide. The members roster also stays company-wide.\n\nIf you only want one park’s calendar, pick that park (or venue filter) first.',
  },
  {
    title: 'Monthly / Week / Daily views',
    body: 'Monthly (default): full month grid — best overview.\n\nWeek: seven days in more detail.\n\nDaily: one day with larger event chips.\n\nUse ‹ › to move between months/weeks/days. Use the Today button to jump back to the current date.',
  },
  {
    title: 'The gold circle = today',
    body: 'The date number with a gold circle (and a small “Today” label) is today’s date — not a special “selected event”.\n\nIt does not mean only that day has bookings. Other days show chips when they have sessions or bookings too.',
  },
  {
    title: 'Click a date number → see that day’s events',
    body: 'Click the date number (e.g. 21) to open Daily view for that day.\n\nYou will see every session and booking for that date, with full titles and capacity.\n\nThis is the main way to “zoom in” from the month grid. Hover the number to see a tip: “click to see that day’s events”.',
  },
  {
    title: 'Click a colored chip → open that item',
    body: 'Each pink/colored chip under a date is one item:\n• Booking chip → opens that booking (or filters the list if Calendar was opened from Bookings).\n• Session chip → shows remaining seats (e.g. 20/20 left) and opens bookings for that session.\n\nSo: date number = whole day. Chip = one specific booking or session.',
  },
  {
    title: 'Crowded days (+ N more)',
    body: 'If a day has many items, only a few chips show. Click “+ N more” to expand that day in the month grid, or click the date number to open Daily view for the full list.\n\nUse Week or Daily when the month grid feels too tight.',
  },
  {
    title: 'Products legend (colors & filters)',
    body: 'The Products bar lists every product that appears in the current range, each with a color dot.\n\nClick a product name to hide or show only that product’s events — useful when many products share the same month.\n\nOpen · Limited · Full describes session availability on the chips.',
  },
  {
    title: 'How capacity stays up to date',
    body: 'Remaining seats update when bookings are created, confirmed, cancelled, or edited elsewhere in admin.\n\nThe calendar also refreshes about every minute while open, and again when you come back after taking a booking.\n\nIf numbers look stale, change month/week or reopen the page after creating a booking.',
  },
  {
    title: 'Create booking from here',
    body: 'Use Create booking (top right) to sell a slot without leaving calendar context.\n\nFrom the Bookings list modal, Create booking hands off to the create wizard. From the full calendar page, it opens Create booking (optionally with the current venue).\n\nTip: click a session chip first if you want the list filtered to that slot after you close the calendar.',
  },
];

export const TICKETING_PRODUCTS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Ticket products is for',
    body: 'This page is your sellable menu — timed tickets, day passes, groups, camps, party packages, add-ons, and passes.\n\nYou create products and prices here. You do NOT create a guest visit here. Guests (and walk-in staff) later book these products; reservations appear under Bookings.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing products across the whole company.\n\nSelecting a park in the header (or a venue filter on this page) narrows ticketing to that park. Venue rollups and plan meters stay company-wide. The members roster also stays company-wide.\n\nAlways create a product on the correct venue so staff and the public book the right park.',
  },
  {
    title: 'What you need before the first product',
    body: '1) At least one venue under Venues.\n2) For party packages: a Room / Party room capacity resource for that venue.\n3) Optional: categories if you organize the catalog.\n4) Permission to write ticketing products (Create product button).\n\nWithout a venue, you cannot finish Create product.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Product types (what each means)',
    body: 'Timed session — guests pick a date and a named time slot (needs Sessions).\nDay pass — valid for a calendar day; no time slot required.\nGroup — group admission with min/max guests (sessions if timed).\nCamp / event — multi-day or event capacity (needs Sessions).\nParty package — birthday/party offer tied to a party room (needs resource + Sessions).\nAdd-on — extras sold with a main product.\nPass — multi-visit or season-style product.',
  },
  {
    title: 'How to create a product',
    body: 'Click Create product.\n\nChoose venue and type, then name, prices, images (optional), and any room/resource the type requires.\n\nSave as draft first if you want. Publishing comes next — a draft is not sold online yet.',
    href: '/admin/ticketing/products/new',
    hrefLabel: 'Create product',
  },
  {
    title: 'Sessions (when you need them)',
    body: 'Timed session, group (if timed), camp/event, and party package need Sessions — the dates and times with capacity.\n\nGo to Sessions (or open the product and add sessions) after the product exists.\n\nDay pass / many pass products may not need session slots. Without sessions, Calendar and Create booking will look empty for that product.',
    href: '/admin/ticketing/sessions',
    hrefLabel: 'Open Sessions',
  },
  {
    title: 'Publish so guests can buy online',
    body: 'Two switches must both be on:\n1) The product is Published on this list / product editor.\n2) The venue has “Publish for online booking” turned on under Venues.\n\nIf either is off, the public booking wizard will not list the product. Staff can still create desk bookings for published or draft products depending on your setup — online guests only see published + venue online.',
    href: '/admin/venues',
    hrefLabel: 'Check venue online booking',
  },
  {
    title: 'Using this list day to day',
    body: 'Filter by type, category, venue, or published status to find products.\n\nOpen a row to edit. Use Actions for publish / archive / delete (when allowed).\n\nArchived products leave the active menu. Reservations already taken still live under Bookings.',
  },
];

export const CREATE_TICKET_PRODUCT_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Create product is for',
    body: 'This wizard builds one sellable ticket product for a venue — the item guests buy online and staff sell at the desk.\n\nSaving here does NOT book a guest. After the product exists, guests (or staff on Create booking) pick it and create a visit under Bookings.\n\nNothing is saved until you tap Create product on the final Review step. Use Continue between steps; you can go back to earlier steps anytime before create.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings (after products exist)',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are working across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nAlways choose the correct Venue on the Venue step so this product belongs to the right park.',
  },
  {
    title: 'What to set up BEFORE this wizard',
    body: 'You need these first, or the form will block you:\n\n1) At least one Venue under Venues — required on every product.\n2) For Party packages: a Room / Party room capacity resource for that venue (you can also create one inside this wizard on the Venue step).\n3) Optional: Booking category under Online Booking → Booking category if you want to group products in filters.\n4) Optional: Add-on products if you will link extras on Options.\n5) Permission ticketing:write (or products write) so Create product is allowed.\n\nIf the Venue dropdown is empty, stop here and create a venue first — then come back.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues (create one first)',
  },
  {
    title: 'How the steps work',
    body: 'The gold stepper at the top is your map:\n\n1) Basics — type, name, category, description, images\n2) Venue — which park (+ room/resource when needed)\n3) Pricing — price bands guests choose\n4) Options — tax, waiver, publish, guest limits, add-ons, pass expiry\n5) Schedule — only for timed / group / camp / party types (dates + times)\n6) Review — summary, then Create product once\n\nDay pass and some pass types skip Schedule. Follow Continue; Review is the only place that writes the product.',
  },
  {
    title: 'Basics — Product type (what each means)',
    body: 'Type * decides the whole flow:\n\n• Timed session — guests pick a date and a named time slot (needs Schedule / Sessions).\n• Day pass — valid for a calendar day; usually no time slot.\n• Group — group admission with min/max guests (sessions if timed).\n• Camp / event — multi-day or event capacity (needs Schedule).\n• Party package — birthday/party offer tied to a party room (needs room resource + Schedule).\n• Add-on — extras sold with a main product (create main products first if you plan to link them later).\n• Pass — multi-visit or season-style product.\n\nPick the type that matches how guests will book. Changing type later resets schedule assumptions — choose carefully on first create.',
  },
  {
    title: 'Basics — Name, category, description, images',
    body: 'Name * — guest-facing title (e.g. “Weekend trampoline session”). Required; keep it clear for staff and the public book page.\n\nCategory — optional Booking category folder for filters on Ticket products. If the list is empty, create folders under Online Booking → Booking category, then return and refresh.\n\nDescription — optional plain text: what guests get, age rules, what to bring. Helps online booking and staff.\n\nImages — optional. Upload from your device or paste a public URL. Large phone photos can take a minute or two; you can finish without a photo and add images later on the product page.',
    href: '/admin/ticketing/categories',
    hrefLabel: 'Create booking categories first',
  },
  {
    title: 'Venue — pick the park',
    body: 'Venue * — which physical park/site this product belongs to. Required.\n\nHow to go about it: If you already selected a park in the header, the list may be limited to that park. If the dropdown is empty, create a venue under Venues, then reopen Create product.\n\nWrong venue = wrong capacity and wrong public listing. Double-check before Continue.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Venue — Room / capacity resource',
    body: 'Some types reserve a physical resource (party room, attraction, etc.).\n\nParty package: Room / party room is REQUIRED. Pick an existing resource for that venue, or use “Create resource” on this step (name + capacity) without leaving the wizard.\n\nTimed / group / camp: a resource may be optional — use it when capacity should follow a shared room/attraction.\n\nDay pass / many passes: often no resource field.\n\nIf the list is empty and the type requires a room: create the resource here or under Ticketing → Resources for that venue, then select it.',
    href: '/admin/ticketing/resources',
    hrefLabel: 'Open Resources',
  },
  {
    title: 'Pricing — price bands',
    body: 'Amounts use your workspace currency (shown on the Pricing step).\n\nEach band is one guest choice (adult, child, …):\n• Label / code * — short code staff and reports use (e.g. adult). Must be unique per product.\n• Amount * — price in workspace currency (must be greater than zero).\n• Min age / Max age — optional hints for who the band is for.\n\nUse “+ adult / child …” chips for common bands, or + Add price band for custom ones. Keep at least one band. Tax is applied from Tax settings unless you mark the product tax-exempt on Options.',
    href: '/admin/tax-settings',
    hrefLabel: 'Open Tax settings',
  },
  {
    title: 'Options — tax, waiver, publish',
    body: 'Tax exempt (default) — when on, bookings of this product skip tax even if Tax settings are enabled. Leave off for normal taxed sales.\n\nWaiver required — marks that guests should complete a waiver before entry. A booking confirmation can include a signing link when a published template exists. The waiver desk reports the product missing until Waivers has a requirement for it. Guests also sign from a QR, on-site, or kiosk. Check-in does not block on it yet.\n\nPublished — when on, the product can appear for online booking IF the venue also has “Publish for online booking” under Venues. Leave off to keep a staff-only / draft menu item while you finish Schedule.\n\nTip: many teams save unpublished first, add sessions, then publish.',
    href: '/admin/venues',
    hrefLabel: 'Check venue online booking',
  },
  {
    title: 'Options — guest limits, pass expiry, add-ons',
    body: 'Min / Max guests — optional limits enforced when booking (especially useful for Group / Party).\n\nDefault pass expiry (days) — only for Pass type; how long a new pass lasts from issue unless overridden later.\n\nAdd-ons — optional links to existing Add-on products at the SAME venue. Create add-on products first (type Add-on on this wizard or Ticket products), then return and tick them here. You can change links anytime on the product editor.',
    href: '/admin/ticketing',
    hrefLabel: 'Ticket products (create add-ons)',
  },
  {
    title: 'Schedule — when this step appears',
    body: 'Schedule appears for Timed session, Group (when timed), Camp / event, and Party package.\n\nYou create named session groups (e.g. “Morning”) with start/end time and default capacity, then attach the calendar days those times run. Guests later book one day at that time.\n\nYou can add several groups (morning + afternoon). Capacity should match the room or what you can safely sell.\n\nIf you skip sessions now, Calendar and Create booking will look empty for this product until you add Sessions later.',
    href: '/admin/ticketing/sessions',
    hrefLabel: 'Open Sessions (after create)',
  },
  {
    title: 'Schedule — how to fill each session group',
    body: 'For each group:\n1) Name — label guests see (Morning, 10:00 slot, …).\n2) Start time / End time — end must be after start.\n3) Default capacity — seats per occurrence (≥ 0).\n4) Days — tick the dates this time runs (or use the day-of-week helpers if shown).\n\nAdd another group for a second daily time. Remove groups you do not need.\n\nOn Review, Create product will also create these timeslots in one go when the type needs them.',
  },
  {
    title: 'Review & Create product',
    body: 'Read the summary: type, name, venue, prices, publish flag, and any sessions.\n\nThen tap Create product once. Wait for success — do not close the window while it shows busy.\n\nAfter create: Open product to edit, Manage schedule if you need more dates, or Create booking to sell a desk visit. Publishing online still needs Published + venue online booking.\n\nRemember: this product is the menu item — the guest visit only appears when someone books it.',
    href: '/admin/bookings',
    hrefLabel: 'Go to Bookings when ready to sell',
  },
];

export const TICKETING_SESSIONS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Sessions is for',
    body: 'This page is the schedule board for ticket products that need date/time slots.\n\nYou name timeslots and attach them to calendar days. That fills Calendar and lets guests (or staff) pick a time when booking.\n\nSessions are still catalog setup — not a guest visit. A booking is created only when someone chooses a slot under Bookings or online.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing sessions across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nFilter by product (or create sessions on a product for the right venue) so you do not mix parks by accident.',
  },
  {
    title: 'What you need BEFORE adding sessions',
    body: '1) At least one Venue.\n2) A ticket product of a timed type: Timed session, Group, Camp / event, or Party package.\n3) For Party packages: a Room / party room resource on that product (set when you created the product, or under Resources).\n4) Permission to write sessions (Add sessions button).\n\nDay pass and many Pass products usually do not use this page. If the product dropdown is empty, create a timed product first, then return here.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'How to navigate this page',
    body: 'Top: Add sessions opens the schedule tools (wizard + manual form). Hide them when you are done creating.\n\nBelow: filter by product and optionally include closed slots.\n\nMonth calendar: click a date to focus that day in the table; badges show how many slots and capacity pressure.\n\nTable: products → days → individual timeslots. Expand a product or day to edit, close, or add more sessions for that product.',
  },
  {
    title: 'Add sessions — Schedule wizard (bulk)',
    body: 'Prefer the wizard when you want many days at once (e.g. every Saturday morning for two months).\n\nTypical flow:\n1) Pick the ticket product.\n2) Name each daily time (Morning Adventure, …) with start/end and capacity.\n3) Choose which calendar days those times run.\n4) Generate — the system creates all timeslots in one go.\n\nUse this for recurring patterns. Use the manual form below for a single one-off slot.',
  },
  {
    title: 'Add sessions — Manual form fields',
    body: 'Ticket product * — which sellable item these times belong to. Only timed-type products appear.\n\nResource (optional) — room/attraction for capacity. Leave blank to inherit the product’s resource. Create resources under Ticketing → Resources if the list is empty.\n\nSlot name (optional) — guest-facing label (e.g. Morning Adventure). Helps when several times share a day.\n\nStarts at / Ends at * — date and time; end must be after start.\n\nCapacity * — seats for this slot (≥ 0). Often matches the room default.\n\nTimeslot price override (optional) — special price for this slot only. Leave blank to use the product’s normal price bands.',
    href: '/admin/ticketing/resources',
    hrefLabel: 'Open Resources',
  },
  {
    title: 'Create series (repeat weekdays)',
    body: 'On the manual form, tick “Create series (repeat weekdays until date)” when one start/end time should repeat across many days.\n\n1) Set Starts at to the first occurrence (time matters).\n2) Tick weekdays (Mon–Sun) that should get a copy.\n3) Set Until date — last day to generate.\n4) Create — one session per matching weekday through that date.\n\nExample: Saturday 10:00–12:00 until end of month creates every Saturday in that range.\n\nPrefer the Schedule wizard if you need named multi-slot daily patterns with a visual day picker.',
  },
  {
    title: 'Filters, calendar, and the board',
    body: 'Product filter — show sessions for one product or leave open for all timed products in the month.\n\nShow closed — include slots you closed (no longer bookable).\n\nMonth calendar — ‹ › change month. Colored badges = slot count / capacity pressure that day. Click a date to filter the table to that day; Clear day removes the filter.\n\nSeats shown as remaining/capacity update when bookings are held or confirmed elsewhere.',
  },
  {
    title: 'Editing, closing, and remaining seats',
    body: 'Expand a product → day → slot to Edit:\n• Starts / Ends — change the window.\n• Capacity — total seats for the slot.\n• Remaining — seats still available (adjust carefully if bookings already exist).\n• Label / resource / price override — same meanings as create.\n\nClose session — stops new bookings for that slot; existing bookings stay under Bookings.\n\nDo not delete history casually — closed + unpublished products keep ops clean without erasing past visits.',
  },
  {
    title: 'After sessions exist — sell and publish',
    body: 'Calendar and Create booking light up once sessions exist for that product.\n\nOnline guests also need: product Published + venue “Publish for online booking”.\n\nStaff can sell walk-in / phone / POS under Create booking by picking the product and an open slot.\n\nIf a day looks empty on Calendar: check you created sessions for that date, the product filter, and that the slot is not closed.',
    href: '/admin/bookings',
    hrefLabel: 'Create a booking when ready',
  },
];

export const TICKETING_ADD_ONS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Add-ons is for',
    body: 'Add-ons are upsell SKUs — socks, food, photos, grip socks, meal deals, and similar extras.\n\nYou create them here as their own catalog items (type Add-on). Guests and staff can only pick them when a parent ticket product has linked that add-on.\n\nCreating an add-on does not book a guest. Linking + publishing is what makes it appear during Create booking and online checkout.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing add-ons across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nAlways create each add-on on the correct Venue so stock and parent links stay park-correct.',
  },
  {
    title: 'What to set up BEFORE add-ons',
    body: '1) At least one Venue under Venues — required when you create an add-on.\n2) Permission to write add-ons / ticketing.\n3) Optional later: parent Timed / Day pass / Party products to link this add-on onto (Create product → Options → Add-ons, or the product editor).\n\nIf the Venue dropdown is empty, create a venue first, then return here.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Recommended order (novice path)',
    body: '1) Create the add-on SKU on this page (name, venue, price).\n2) Leave Publish off until you are happy with price and stock rules.\n3) Open the parent Ticket product → Options / Add-ons → link this SKU (same venue).\n4) Optional: Create a stock period here if quantity or blocked windows matter.\n5) Publish the add-on (and parent product + venue online booking) when ready for guests.\n\nParent links show in the catalog table — if Parent links is 0, staff and online booking will not offer this upsell yet.',
    href: '/admin/ticketing',
    hrefLabel: 'Link from a parent product',
  },
  {
    title: 'Create add-on — each field',
    body: 'Name * — guest-facing title (e.g. Grip socks).\n\nDescription — optional details (size, allergens, what is included).\n\nVenue * — which park owns this SKU. Required. Park-locked seats may lock this to one venue.\n\nPrice * — standard amount in workspace currency (one “standard” price band is created for you).\n\nPublish for online booking — when on, the add-on can appear online IF a parent product that links it is also published and the venue allows online booking. Keep off while testing.',
  },
  {
    title: 'Create stock period — what it does',
    body: 'Stock periods limit when (and how many) of an add-on can be sold — useful for limited merch, food runs, or blackout windows.\n\nAttach an add-on product for real enforcement. Leaving product empty is only a venue-wide note and does not gate bookings the same way.\n\nCreate the add-on SKU first if the Add-on product dropdown is empty for that venue.',
  },
  {
    title: 'Stock period — each field',
    body: 'Venue * — park this window applies to.\n\nAdd-on product (recommended) — which SKU is limited. Filter follows the venue you picked.\n\nStock starts / Stock ends * — date and time window; end must be after start.\n\nKind — Available = sellable in this window (optionally with a remaining qty). Blocked = do not sell this add-on in this window.\n\nRemaining qty — optional count for Available windows. Disabled when Kind is Blocked.\n\nDelete a period from the Stock periods table when it is no longer needed.',
  },
  {
    title: 'Reading the Add-on catalog table',
    body: 'Name / Price / Venue — the SKU itself.\n\nStatus — Published vs Draft (use Actions to toggle).\n\nParent links — how many parent ticket products have attached this add-on. Zero means nothing offers it yet — open those parents and link it.\n\nStock — Unlimited, or a summary of attached stock periods (kind + qty).\n\nUse this table day to day to confirm park, publish state, and whether linking/stock are done.',
  },
  {
    title: 'After setup — selling add-ons',
    body: 'Once linked to a parent product, staff see the add-on on Create booking → Guests & add-ons. Online guests see it when the parent is booked online (and publish rules pass).\n\nIf an add-on never appears:\n• Parent product must link it (same venue).\n• Add-on Published (for online) + parent Published + venue online booking.\n• Stock period must not Block the visit time; Available qty must not be exhausted.\n\nRemember: this page is catalog + stock — visits still live under Bookings.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
];

export const TICKETING_PASSES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Passes is for',
    body: 'This page lists Pass-type ticket products — multi-visit or season-style offers — and lets you set each product’s default expiry in days.\n\nIt is a focused view of the same catalog as Ticket products (filtered to type Pass). You do not issue a guest’s pass here; selling/issuing happens when someone books or buys that product under Bookings / online.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing pass products across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nCreate each pass on the correct venue so staff and guests buy the right park’s pass.',
  },
  {
    title: 'What to set up BEFORE using Passes',
    body: '1) At least one Venue under Venues.\n2) Permission to write ticketing / passes.\n3) Create a product with type Pass (Create pass product on this page, or Create product on Ticket products and choose Pass).\n\nWithout a venue and a Pass product, this list stays empty. Day tickets and timed sessions are not managed here — use Ticket products / Sessions for those.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'How to create a pass product',
    body: 'Click Create pass product (top right). That opens the Create product wizard with type Pass preselected.\n\nFill Basics (name, description, images), Venue, Pricing, then Options — including Default pass expiry (days) if you want a default length from issue.\n\nPasses usually skip the Sessions schedule step. Publish only when the venue also allows online booking if guests should buy online.\n\nAfter save, the pass appears in this table.',
    href: '/admin/ticketing/products/new?type=pass',
    hrefLabel: 'Create pass product',
  },
  {
    title: 'Reading this table',
    body: 'Name — guest-facing pass title.\n\nVenue — which park owns the product.\n\nDefault expiry (days) — how many days a newly issued pass lasts from issue unless overridden later. Blank (—) means no default on the product; ops may set length elsewhere when issuing.\n\nPublished — Yes means eligible for online listing (still needs venue online booking). No = draft / staff-focused.\n\nActions — Edit product opens the full product editor. Edit expiry changes only the default days column without leaving this page.',
  },
  {
    title: 'Edit expiry — how to use it',
    body: '1) Click Edit expiry on a row.\n2) Enter a whole number of days (≥ 0), or clear the field to remove the default (saves as none).\n3) Save — or Cancel to discard.\n\nThis updates defaultPassExpiryDays on the product only. It does not change passes already issued to guests; those keep the expiry they were given at issue time.',
  },
  {
    title: 'Edit product vs this page',
    body: 'Use Edit product when you need name, prices, publish, images, tax/waiver flags, or venue changes — the full product page.\n\nUse this Passes page when you mainly need a quick list of all passes and a fast expiry tweak.\n\nParent/add-on linking and sessions are rare for Pass type; if you need timed entry instead, create a Timed session product, not a Pass.',
  },
  {
    title: 'After a pass exists — selling it',
    body: 'Staff sell a pass under Create booking by choosing product type Pass and the product (visit date rules depend on your booking setup).\n\nOnline guests see it when Published + venue “Publish for online booking” are both on.\n\nIssued/guest visits still appear under Bookings — this page stays catalog configuration only.\n\nIf the list is empty after create: check you used type Pass, the park filter in the header, and that the product is not archived.',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
];

export const TICKETING_RESOURCES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Capacity resources is for',
    body: 'Resources are the physical spaces at a venue — rooms, party rooms, attractions, lanes, and similar capacity pools.\n\nWhen you create (or edit) an admission Ticket product, you can attach one resource as its default space. That does not create a second product — it only tells bookings and sessions which space to hold capacity against.\n\nYou manage the space catalog here. Selling still happens under Bookings after a product + (when needed) sessions exist.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Where resources are used in the app',
    body: 'Create / edit Ticket product (Venue step) — pick a resource as the product’s default space (required for Party package).\n\nSessions — optional override per timeslot; often inherits the product’s resource.\n\nCreate booking / Calendar / availability — remaining seats follow the session capacity, which is often seeded from the resource’s default capacity.\n\nParties / party packages — need a Room or Party room before you can finish the product.\n\nNot used by: Day pass, Pass, and Add-on products (those types hide the resource field).',
    href: '/admin/ticketing/sessions',
    hrefLabel: 'Open Sessions',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing resources across the whole company.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nAlways create each resource on the correct Venue. A Party Room at Park A cannot be attached to a product at Park B.',
  },
  {
    title: 'What to create BEFORE resources',
    body: '1) At least one Venue under Venues — every resource belongs to a venue.\n2) Permission to write ticketing resources.\n3) Optional: know which Ticket products will need the space (Party packages need Room / Party room first).\n\nYou do not need products before creating resources — many teams create rooms first, then Create product and attach them.\n\nIf the Venue dropdown is empty, create a venue first, then return here.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Which product types need a resource',
    body: 'Party package — MUST attach a Room or Party room. Create that resource here (or inline on Create product) before you can finish the party offer.\n\nTimed session, Group, Camp / event — MAY attach any resource type, or none. Attach when capacity should follow a shared space (e.g. one attraction shared by several products).\n\nDay pass, Pass, Add-on — do NOT use a resource. Skip this page for those types.\n\nTip: wrong type on the resource (e.g. Attraction instead of Party room) may hide it from the Party package picker — use Room or Party room for parties.',
    href: '/admin/ticketing/products/new?type=party_package',
    hrefLabel: 'Create a party package product',
  },
  {
    title: 'Add resource — Name & Venue',
    body: 'Name * — staff-facing label (e.g. Party Room A, Lane 3, Main trampoline). Guests may see related labels via sessions/products; keep names clear for the desk.\n\nVenue * — which park owns this space. Required. Park-locked seats may lock this dropdown to one venue.\n\nHow to go about it: invent one resource per bookable space you need to track. Do not create a resource for every product — multiple products can share one resource when they share the same physical room.',
  },
  {
    title: 'Add resource — Type (what each means)',
    body: 'Type * is a space category — not a Ticket product type:\n\n• Attraction — ride, exhibit, or activity area; optional on timed/group/camp.\n• Session space — named program space (not a timed ticket itself).\n• Room — bookable room; allowed for Party packages.\n• Party room — party-specific room; allowed for Party packages.\n• Lane — split capacity (bowling, kart, climbing lanes).\n• Other — any other capacity pool you need.\n\nParty packages only list Room and Party room. Pick those when building birthday packages.',
  },
  {
    title: 'Add resource — Default capacity',
    body: 'Default capacity * — how many seats/people this space holds by default (≥ 0).\n\nWhen you create a product or session that uses this resource, capacity often pre-fills from this number. You can still override capacity on individual sessions.\n\nExample: Party Room A default 20 → new party sessions start at 20 unless you change them.\n\nSet this to the safe operating limit for the space, not a marketing max.',
  },
  {
    title: 'The list — filters, edit, archive',
    body: 'Include archived — show spaces you archived (soft-retired).\n\nTable columns: Name, Type, Venue, Default capacity, Archived, Actions.\n\nEdit — change name, type, or default capacity in place, then Save / Cancel.\n\nArchive — retires the resource from new pickers without deleting history. Use when a room is closed or replaced.\n\nUnarchive (when shown) — bring an archived resource back for new products/sessions.',
  },
  {
    title: 'Recommended setup path (novice)',
    body: '1) Create Venues for each park.\n2) On this page, Add resource for each room/attraction/lane (correct venue + type + capacity).\n3) Create Ticket products and attach the resource on the Venue step (Party package requires Room/Party room).\n4) Add Sessions for timed/party products so Calendar and Create booking have slots.\n5) Sell under Bookings or publish for online booking.\n\nIf Create product says no matching room: come back here, create Room/Party room for that venue, then reopen Create product.',
    href: '/admin/ticketing',
    hrefLabel: 'Go to Ticket products next',
  },
];

export const TICKETING_SETTINGS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Ticketing settings is for',
    body: 'This page sets company (and optional per-venue) defaults for how bookings are created and how times are shown — hold/reserve Time To Live (TTL), create mode, clock format, online pay-later, SMS, and tax defaults.\n\nThese are not Ticket products. Products and sessions are the sellable menu; settings control desk/online booking behavior once products exist.\n\nSave settings here → Create booking, Calendar, Sessions, and public booking flows pick them up for that venue (or the Org default).',
    href: '/admin/bookings',
    hrefLabel: 'Open Bookings',
  },
  {
    title: 'Parks and “All locations”',
    body: '“All locations” means you are viewing company-wide context.\n\nVenue rollups and plan meters stay company-wide. Selecting a park in the header filters venue lists and park-stamped modules (ticketing; stamped products/orders) — the members roster stays company-wide.\n\nOn this page, use Venue = Org default for company-wide defaults, or pick a park to override settings for that venue only.',
  },
  {
    title: 'Venue selector (Org default vs park)',
    body: 'Venue — which settings document you are editing.\n\n• Org default — applies when a booking/session has no venue-specific override (or as the base for the company).\n• A named park — settings saved only for that venue; Create booking / calendars for that park use these values (including time format).\n\nPark-locked seats may lock the dropdown to one venue. Always Save after switching venue if you edited fields — switching reloads that venue’s saved values.',
  },
  {
    title: 'Default create mode',
    body: 'Controls what happens when staff finish Create booking (and related create flows):\n\n• Hold — soft hold with expiry after Hold TTL (Time To Live in minutes). Seats held briefly while guest pays or staff finishes.\n• Reserve — firmer hold lasting Reserve TTL (Time To Live in hours).\n• Prompt — on Review, staff choose Hold / Reserve / Confirm for that booking.\n\nWhere you see it: Create booking → Review. In Prompt mode, Hold/Reserve/Confirm buttons appear. In Hold or Reserve mode, create uses that mode automatically (Confirm still needs bookings:write when chosen in Prompt).',
    href: '/admin/bookings',
    hrefLabel: 'Try Create booking Review',
  },
  {
    title: 'Time format',
    body: '12-hour (AM / PM) or 24-hour.\n\nWhere it is used: Calendars, Sessions times, date/time pickers, Create booking wizards, Payments “When” column (and similar) for this venue or the org default.\n\nPreview: with 12-hour, session start shows like 9:00 AM; with 24-hour, like 09:00. Change → Save → open Sessions or Create booking to see the new clock.',
    href: '/admin/ticketing/sessions',
    hrefLabel: 'Open Sessions (clock preview)',
  },
  {
    title: 'What TTL means (Time To Live)',
    body: 'TTL means Time To Live — how long something is allowed to stay valid before the system automatically expires it.\n\nIn ticketing, TTL is the countdown on a Hold or Reserve booking: seats stay blocked for that booking only until the TTL runs out. If the guest has not paid / the booking has not been confirmed or progressed in time, the hold/reserve expires and those seats go back into the pool for someone else.\n\nThink of it like a parking meter for reserved seats — not a product expiry and not a pass length.',
  },
  {
    title: 'Hold TTL & Reserve TTL (fields)',
    body: 'Hold TTL (minutes) — Time To Live for a Hold booking, measured in minutes (minimum 1). Example: 15 means the soft hold keeps capacity for 15 minutes, then expires if not progressed.\n\nReserve TTL (hours) — Time To Live for a Reserve booking, measured in hours (minimum 1). Example: 24 means the firmer reserve keeps capacity for 24 hours (about one day).\n\nWhere used: Create booking when staff choose Hold or Reserve (or when Default create mode is Hold/Reserve). Calendar/availability treat expired holds as free again.\n\nHow to choose: too short → guests lose seats while paying at the desk; too long → inventory stays blocked and other guests cannot book those seats.',
  },
  {
    title: 'Past-edit grace & Cancel cutoff',
    body: 'Past-edit grace (minutes) — after a session start time has passed, how many extra minutes staff may still edit the booking (0 = no grace).\n\nCancel cutoff (minutes) — optional. Minutes before visit/session start after which cancel is restricted (blank = no cutoff from this setting).\n\nWhere used: booking edit/cancel rules on booking detail and related APIs. Leave cutoff blank until you have a clear cancel policy.',
  },
  {
    title: 'Checkboxes — review, pay later, SMS, tax',
    body: 'Require review before confirm — when on, Confirm (especially after Prompt + Confirm) may need an explicit review step before the booking is fully confirmed.\n\nAllow online pay later — guests on public online booking may defer card pay (venue must also support online booking).\n\nPay later marks confirmed — when on, choosing pay-later can mark the booking confirmed without immediate payment (use carefully).\n\nSMS enable — allows SMS paths (e.g. payment link “Also SMS”) when a provider is configured; if unset, SMS is skipped.\n\nDefault tax exempt — new bookings may start tax-exempt by default for this venue/org (staff can still override when permitted). Product-level tax exempt and B2B company defaults can also apply.',
  },
  {
    title: 'Where settings show up (preview map)',
    body: 'After Save settings:\n\n• Create booking Review — Hold / Reserve / Prompt buttons and TTL behavior.\n• Create product Options — may show “Venue booking mode: hold|reserve|…” from these settings.\n• Sessions / Calendar / Payments — times use Time format.\n• Public online book — pay-later options when Allow online pay later is on and the venue is published online.\n• Take payment → Also SMS — respects SMS enable (+ provider env).\n\nThere is no separate public “settings preview” page — the preview is those live admin/guest screens after save.',
    href: '/admin/ticketing',
    hrefLabel: 'Back to Ticket products',
  },
  {
    title: 'How to go about first-time setup',
    body: '1) Pick Venue = Org default (or your main park).\n2) Set Default create mode (Prompt is friendliest for new staff).\n3) Set Time format for your region.\n4) Set Hold TTL (Time To Live in minutes, e.g. 15) and Reserve TTL (Time To Live in hours, e.g. 24).\n5) Leave advanced checkboxes off until you need them; turn Allow online pay later only if guests may pay later online.\n6) Save settings.\n7) Create a test booking and confirm Review matches your mode; check a session time shows the right clock.\n\nNeeds ticketing:manage (or settings write) to Save — otherwise the form is read-only.',
  },
];

export const MENU_ITEMS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Menu items is for',
    body: 'Menu items are food and drinks you sell from your park restaurant or food vendors — guests browse and order them online (shop / checkout).\n\nThis lives under Food sales (not Online Booking ticket products). Ticket products are timed sessions and passes; Menu items are catalog dishes and drinks with price and stock.\n\nHow it is used: create items here → guests see them in the public shop → they add to cart and checkout. Staff manage stock, price, tax, and photos from this list.',
    href: '/shop',
    hrefLabel: 'Open public shop (guest preview)',
  },
  {
    title: 'Where menu items appear after you create them',
    body: 'Admin → Food sales → Menu items — this list (count, table, Edit / Delete).\n\nAdmin → item detail (/admin/products/…) — full row when you click the item name/thumbnail.\n\nAdmin → Categories — optional folders; filter this list with ?category=…\n\nGuest → /shop (and related product pages) — name, photo, price, description for online order.\n\nGuest → cart / checkout — price, tax rules, and stock availability apply when they buy.\n\nPark-locked staff only see items stamped to their assigned park (plus messaging on this page). Company-shared items stay visible to company-wide admins.',
    href: '/admin/categories',
    hrefLabel: 'Open Categories',
  },
  {
    title: 'What to set up BEFORE Add menu item',
    body: '1) Permission products:write (Add menu item button).\n2) Optional: create Menu categories under Food sales → Categories so you can group burgers, drinks, etc.\n3) Optional: Venues if you will stamp an item to one park.\n4) Plan capacity — the modal shows “Menu: X items (unlimited)” or used/limit; upgrade in Billing if at limit.\n5) Images need uploads:write for Photos step.\n\nYou can create an item with minimal fields; empty category is allowed.',
    href: '/admin/categories',
    hrefLabel: 'Create categories first (optional)',
  },
  {
    title: 'How to add an item (wizard overview)',
    body: 'Click Add menu item → modal “Food item details”.\n\nTwo steps:\n1) Item info — name, description, price, stock, location text, park/venue, category, tax.\n2) Photos — upload images to the cloud.\n\nFooter: Next (to Photos), Previous, then Save menu item. Esc or X closes without saving.\n\nMeter under the title shows how many menu items your plan allows. At limit, Save is blocked until you upgrade or delete unused items.',
  },
  {
    title: 'Item info — name, description, price',
    body: 'Item name — guest-facing title on the shop card and detail page (e.g. Park burger, lemonade). Saved as “Untitled item” only if left blank but other fields are filled.\n\nDescription — ingredients, allergens, sizes, what’s included. Shows under the title for guests.\n\nPrice ($) — sell price in major currency units (e.g. 12.50). Guests see this as the item price in shop and cart.\n\nPreview: shop card typically shows first photo + name + price; opening the item shows description.',
  },
  {
    title: 'Item info — quantity, stock, location text',
    body: 'Quantity — total / catalog quantity for the item (ops inventory figure).\n\nRemaining in Stock — how many are left to sell. When this hits 0, guests generally cannot buy more until you restock (edit the item).\n\nLocation (text) — free-text note (e.g. “North concession”, “Food court stall 2”). This is not the park stamp; it is a display/ops note on the product.\n\nUse Remaining in Stock for day-to-day sellable count; keep Quantity as your reference total if useful.',
  },
  {
    title: 'Item info — Park / venue & Menu category',
    body: 'Park / venue — which park owns this menu item.\n• Company-shared (all parks) — visible to company-wide staff; park-locked seats do not manage these.\n• A named park — stamps the item to that venue (required for park-locked seats).\n\nMenu category — optional folder from Categories. Helps filter on this admin list and organize the shop. If the dropdown is empty, create categories under Food sales → Categories, then return.\n\nWrong park stamp = wrong park staff cannot see/edit the item.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Item info — Tax fields',
    body: 'Tax exempt — when on, this item charges no tax at checkout (rate override is disabled).\n\nTax rate override (%) — optional percent for this item only. Leave blank to use global Tax settings. Disabled while Tax exempt is on.\n\nWhere used: guest checkout tax line and admin order totals. Configure company tax under Tax settings if you rely on the global rate.',
    href: '/admin/tax-settings',
    hrefLabel: 'Open Tax settings',
  },
  {
    title: 'Photos step — how to use it',
    body: 'Product Images — upload slots (count shown as uploaded/max). JPG, PNG, WebP, HEIC, and similar.\n\nImages upload to the cloud as soon as you pick them (you may see Uploading…). Wait until uploads finish before Save.\n\nUpdate replaces a slot; Remove clears it. First image is usually the shop thumbnail and list thumbnail in admin.\n\nYou can Save without photos (placeholder image), then Edit later to add pictures.\n\nPreview: guests see the first image on /shop cards; extra images on the product detail gallery when supported.',
  },
  {
    title: 'After save — list, edit, delete, guest preview',
    body: 'The item appears in the Menu items table: thumbnail, name, category, price, tax, stock, status, created/updated.\n\nClick the item → admin detail page. Actions: Edit (modal), Delete (with permission).\n\nGuest preview: open /shop (or your storefront home that lists products). Look for the item name, price, and photo. Add to cart to confirm tax/stock behave as expected.\n\nFilter by category from Categories, or clear the category chip on this page. Plan meter updates when you create/delete items.',
    href: '/shop',
    hrefLabel: 'Preview in shop',
  },
];

export const CATEGORIES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Product Categories is for',
    body: 'Categories are Food sales Catalog folders that group menu items in the shop.\n\nOnline Booking ticket products use a separate folder list: Online Booking → Booking category.\n\nCreating a category here does not create food by itself. It only makes a named group you can pick when adding a menu item.\n\nHow it is used: Add category here → pick it on Menu items (Item info → Menu category) → guests and staff can filter by that group in the shop.',
    href: '/admin/products',
    hrefLabel: 'Open Menu items',
  },
  {
    title: 'Where categories show up after you create them',
    body: 'This list — name, how many shop products use it, View / Edit / Delete.\n\nCategory detail (/admin/categories/…) — full name, description, linked products overview.\n\nMenu items → Add / Edit → Menu category dropdown.\n\nMenu items list — filter chip when opened with ?category=… (from the product count link).\n\nGuest shop — categories help organize / filter food items when the storefront uses them.\n\nTicket products use Online Booking → Booking category — not this Catalog list.',
    href: '/admin/ticketing/categories',
    hrefLabel: 'Open Booking category',
  },
  {
    title: 'What you need BEFORE Add category',
    body: '1) Permission categories:write (ADD CATEGORY button).\n2) Plan capacity — the Add modal shows Categories: used/limit (or unlimited). Upgrade in Billing if at limit.\n3) You do not need menu items first — create the folder first, then attach items.\n\nName must be unique. Duplicate names are rejected.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing (if at plan limit)',
  },
  {
    title: 'Add New Category — each field',
    body: 'Category Name * — required. Staff-facing (and shop-facing) label, e.g. “Burgers”, “Drinks”. Keep it short and clear.\n\nDescription * — required. Short explanation of what belongs in this group (for staff; may also help shop browsing). Example: “Hot drinks and sodas from the north concession.”\n\nSlug (automatic) — the shop slug, stored as the category id for menu links. Created from the name. Renaming keeps that shop slug unless it was missing.\n\nPublic link — a separate slug for the company category URL. It is also created once from the name. Two catalogs in this company that would share it get -2, then -3. Renaming the category does not change it. Edit Public link and choose Save public page to change it. Reserved words such as book, admin, and shop are rejected.\n\nPlan meter under the modal title shows how many categories your plan allows.',
  },
  {
    title: 'Reading the categories table',
    body: 'Categories column — avatar initial + name. Renaming the category does not change its public slug.\n\nProduct count under the name links to Menu items filtered to this category.\n\nCreated by / Updated by / Created / Updated — audit columns.\n\nActions:\n• Copy — choose Copy link (the public URL) or Copy iframe embed (the snippet for your website). Greyed out when the public page is inactive; Copy iframe embed is greyed out when embedding is off.\n• Public link — writers open a small dialog to change the public slug, layout, and Embed enabled, then choose Save public page.\n• View — category detail page, including the same public link, Copy link, layout, and Copy embed controls.\n• Edit — change name/description. The shop slug stays. The public slug stays unless you change it with Public link.\n• Delete — remove the category (needs delete permission; check linked products first). That also turns off its public page.\n\nCount (N) in the page title is how many categories exist.',
  },
  {
    title: 'After create — how to use the category (preview)',
    body: 'Food: Food sales → Menu items → Add menu item → Item info → Menu category → pick your new category → Save. Preview: item appears under that category filter; guest /shop shows it with other items in that group when browsing by category.\n\nFrom this table, click the product count to jump to the filtered Menu items list — that is the fastest “where is it used?” preview.\n\nFor ticket products, open Online Booking → Booking category instead.',
    href: '/admin/products',
    hrefLabel: 'Attach to a menu item',
  },
  {
    title: 'Edit, detail page & delete',
    body: 'Edit — same Name * and Description * fields; Save updates the row everywhere the category is shown.\n\nDetail page — name, description, dates, and links to related shop products when counts > 0.\n\nDelete — use only when you no longer need the folder. Items may need a new category afterward; prefer reassigning products before delete when possible.\n\nTip: keep Catalog names for food (e.g. “Burgers”) and use Online Booking → Booking category for ticket folders so staff do not mix food with ticketing.',
  },
];

export const USERS_PERMISSIONS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Users & permissions is for',
    body: 'This page manages who can sign in to YOUR company Admin workspace — memberships (staff seats), roles, custom role templates, permission overrides, park-lock seats, and (when allowed) the signup blacklist.\n\nPermission matrix includes a Memberships feature group for guest park Memberships: read/write (catalog + reports), sell, billing, cancel (staff lifecycle), redeem (Redeem desk + adapters). Guest Profile → Memberships uses client memberships:read_own / write_own (not assigned here). That is separate from this Users roster.\n\nIt is org-scoped: seats here belong to this organization only. Soft-locking a user across the whole platform, or suspending a company workspace, is done under Company workspaces (storefront ops) — not from this page.\n\nAfter you invite or create a user, they use Admin with the sidebar/features their role + overrides allow. Park-locked seats only see assigned venues.',
    href: '/admin/registered-companies',
    hrefLabel: 'Company workspaces (platform soft-lock)',
  },
  {
    title: 'Tabs overview',
    body: 'Members — list of people on this org (filters: All / Active / Invited / Suspended / Revoked). Invite Member, Create User, open a row to edit.\n\nRole templates — reusable custom permission packs you invent (Name, Description, permission checklist). Assign them on Invite / Create / Edit instead of a built-in preset.\n\nBlacklist — block emails/phones from signing up or signing in again (hard-delete flow also adds entries). Needs users:blacklist; park-locked actors usually cannot manage it.\n\nInvite/Create buttons need company-wide view (not park-locked) plus invite/create permissions.',
  },
  {
    title: 'What to set up BEFORE inviting',
    body: '1) You are a company-wide admin (or platform_admin) with users:invite / users:manage_roles as needed.\n2) Plan team seats (and tailor seats if assigning Tailor) — meters show on Invite/Create.\n3) Optional: create Role templates first if you want custom packs.\n4) Optional: create Venues first if you will park-lock the seat.\n5) Invite member: the person must already have an account on this platform with that email.\n6) Create user: creates a brand-new account + membership (name, email, password).',
    href: '/admin/venues',
    hrefLabel: 'Open Venues (for park-lock)',
  },
  {
    title: 'Invite member — each field',
    body: 'Email * — email of an existing account on this platform. Pending invites expire (~14 days); expired invites free the seat — resend from Users if needed.\n\nAssignment — Preset (built-in role) or Role template (custom pack). You can only assign roles/templates whose permissions you yourself hold.\n\nActivate immediately — if checked (and you can manage roles), membership becomes Active now; otherwise stays Invited until they accept / you activate.\n\nCompany-wide view — see all org records for assigned features. Unchecked = mostly own-records. platform_admin always company-wide. Admins granting CWV must have CWV themselves.\n\nPark venues — tick one or more parks to park-lock the seat (Growth/Starter OK). Leave empty for company-wide / no park lock. platform_admin stays company-wide (no park lock).\n\nAdvanced permission overrides — extra permissions beyond the preset/template (only ones you can grant).\n\nTeam seats meter — blocks invite when full.',
  },
  {
    title: 'Create user — each field',
    body: 'Full name * — display name in Admin.\n\nEmail * — new login email.\n\nPassword * — at least 8 characters.\n\nAssignment — same Preset vs Role template choice as Invite.\n\nActivate immediately — Active vs Invited status on create.\n\nCompany-wide view / Park venues / Advanced overrides — same meanings as Invite.\n\nPreview after create: the person appears in Members; they sign in and see only the Admin sidebar items their effective permissions allow. Park-locked seats get a park filter / limited venue lists.',
  },
  {
    title: 'Role presets vs Role templates',
    body: 'Role preset — built-in packs (e.g. platform_admin, catalog_editor, tailor, …). Fast default. platform_admin is restricted to platform admins granting it.\n\nRole template — you create under Role templates tab: Name *, Description, then tick permissions. Assign later as “Role template” on Invite/Create/Edit.\n\nEffective permissions = preset OR template permissions ∪ overrides. The Members table shows a short permission preview and override count.\n\nYou cannot grant permissions you do not have.',
  },
  {
    title: 'Members list & Edit membership',
    body: 'Filters — All / Active / Invited / Suspended / Revoked.\n\nRow — name, email, role, status, park assignment summary, effective permissions chips.\n\nOpen / Edit — change status, role/template, company-wide view, park venues, overrides; Save. Revoke removes org access (membership). Hard delete (when allowed) removes the account and blacklists email/phone.\n\nReset password — users:reset_password (Admin preset has it; grant via override/template for trusted seats, together with View Users and company-wide view). Desk-assist sets a temporary password, signs out their other sessions, and can email login details. FECSYNC software owners never appear in this list for other staff — only another software owner can see or reset them.\n\nWhere it is used: as soon as status is Active, that person can sign in to THIS org’s Admin. Sidebar, Ticket products, Bookings, Menu items, etc. appear only if their permissions include those features.\n\nPark-lock preview: switcher / venue lists limited to assigned parks; company-shared catalog rows may stay hidden from park-locked seats.',
  },
  {
    title: 'Role templates tab — fields',
    body: 'New template → Name * (label on Invite/Create dropdowns), Description (optional staff note), permission checklist (only grantable features).\n\nCreate / Save — template appears in the Role templates list and in assignable dropdowns for people you can manage.\n\nEdit — change name, description, permissions; Delete removes the template (reassign members first if still in use).\n\nPlan may limit how many role templates you can create — Billing shows the meter.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing',
  },
  {
    title: 'Blacklist tab',
    body: 'Type — email or phone.\n\nValue — the identity to block.\n\nReason — optional note for ops.\n\nAdd — blocks signup/sign-in with that identity until removed.\n\nRemove — confirm to allow that identity again.\n\nHard-delete on Members also blacklists so the person cannot return with the same email/phone until you clear Blacklist.\n\nThis is not the same as Revoke (org membership only) or Company workspaces suspend (whole tenant).',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Create Venues if you need park-locked desk staff.\n2) (Optional) Role templates → New template for a custom pack.\n3) Invite Member (existing account) or Create User (new login).\n4) Choose Preset or Template; set Company-wide view; assign Park venues if locking.\n5) Send invite / Create → confirm they appear under Members as Invited or Active.\n6) Have them sign in — preview = Admin sidebar matches their role.\n7) Edit later for overrides, park changes, or revoke.\n\nOrg id under the title is this workspace’s identifier (support/debug) — not a field you edit.',
  },
];

export const REGISTERED_COMPANIES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Company workspaces is for',
    body: 'This is the FECSYNC storefront ops console for registered company tenants — not a single company’s Users page.\n\nWho can use it: storefront platform admins only. Tenant company admins do not manage other companies here.\n\nWhat you do here:\n• See every registered company (All / Active / Pending / Suspended / Offboard req).\n• Approve pending signups so they can open /admin.\n• Emergency Set plan (Demo|Starter|Growth|Enterprise) without changing venues/catalog/orders/memberships.\n• Suspend a company workspace (ops access off; records kept).\n• Create a company manually (skip public /register-company + Checkout).\n• Soft-suspend any user account across the platform (Suspend a user account panel).\n\nNever deletes org data, memberships, orders, or venues.',
  },
  {
    title: 'Status tabs — what each means',
    body: 'All — every registered company (default tab).\n\nActive — entitled / operational workspaces that can use Admin (subject to plan and soft-hold).\n\nPending — signed up or created but not yet approved / activated for full Admin.\n\nSuspended — ops revoked operational access; company records stay.\n\nOffboard req — company asked to leave (soft request from their Company profile); clear the request when handled — no hard-delete.\n\nDashboard cards may deep-link with ?status=pending etc.; otherwise All is selected.',
  },
  {
    title: 'Public registration path (where companies come from)',
    body: 'Normal path: someone uses /register-company (with a package). That creates User + Organization (pending) + platform_admin Membership, then Stripe Checkout when available (Demo can be $0).\n\nThey appear here under Pending until you Approve (and/or they finish Checkout entitlement).\n\nOps Create company on this page skips that public flow and can Activate immediately (Approve + plan stamp without Checkout).',
    href: '/register-company',
    hrefLabel: 'Open public company registration',
  },
  {
    title: 'Create company — each field',
    body: 'Open Create company (gold button).\n\nCompany name * — legal/trading name shown in the list and tenant Admin.\n\nSlug — URL/workspace key (auto from name until you edit). Keep lowercase-hyphen style.\n\nAdmin email * — login for the new company platform_admin.\n\nAdmin password * — min 8 characters (show/hide eye toggle).\n\nAdmin full name — optional display name for that admin.\n\nPlan — Demo | Starter | Growth | Enterprise to stamp on activate.\n\nDuration — grant length for paid plans (hidden for Demo); used with Activate / Set plan.\n\nActivate now — when on, stamps plan + unlocks /admin like Approve + Set plan. When off, creates a pending workspace you approve later.\n\nPreview: new row in the table (Active if activated, else Pending) with plan badge.',
  },
  {
    title: 'Row actions — Approve, Set plan, Suspend',
    body: 'Plan dropdown on the row — choose Demo/Starter/Growth/Enterprise before Approve or Set plan.\n\nDuration — months for non-Demo grants.\n\nApprove / Reactivate — unlocks Admin for pending or suspended companies (uses selected plan when granting). After Approve, list jumps to Active so you see the row.\n\nSet plan — emergency stamp of Demo|Starter|Growth|Enterprise on entitlement fields only — never alters venues, catalog, orders, memberships, or history. Use when Checkout/webhook missed or Demo expired.\n\nSuspend — company cannot operate Admin apps; records kept. Reactivate later via Approve.\n\nClear offboard — removes Offboard req flag after you handled their leave request.\n\nView — detail modal/page for contacts and workspace info (ops do not browse tenant HQ data here).',
  },
  {
    title: 'Reading the list (preview of company state)',
    body: 'Logo / name / slug — identity of the tenant.\n\nStatus badge — Pending, Active, Suspended, soft-hold hints, Offboard req chip.\n\nPlan — stamped subscriptionPlan (and term label when set).\n\nEnterprise badge — entitled Enterprise unlocks that tenant’s /admin/hq; pending enterprise stamp without entitlement shows a warning until Approve/Set plan/renew.\n\nAfter Set plan Demo on an expired company: they return Active but Demo-locked (dashboard + profile + Billing) until they upgrade — same as product Demo lock rules.',
  },
  {
    title: 'Suspend a user account (platform soft-lock)',
    body: 'Separate from suspending a whole company.\n\nSearch — email or name (min 2 characters) → Search.\n\nResults show name, email, Suspended badge, and memberships (org + role).\n\nSuspend — soft-locks that user across the platform; they cannot use app features until Unsuspend. Orders, memberships, and company data are never deleted.\n\nUnsuspend — restores sign-in / app use.\n\nUse this for abusive or compromised accounts. Use company Suspend for whole-tenant ops lock. Use Users & permissions inside a tenant only for that org’s memberships.',
    href: '/admin/users',
    hrefLabel: 'Tenant Users & permissions',
  },
  {
    title: 'Where the company goes next (tenant preview)',
    body: 'After Active + entitled plan, the company admin signs in to THEIR Admin (not this storefront ops console).\n\nThey see Venues, Ticket products, Bookings, Billing, Users, etc. per plan. Demo stays locked to dashboard/profile/Billing until upgrade.\n\nEnterprise entitled → /admin/hq company HQ tools inside that tenant.\n\nYou stay on Company workspaces for Approve / Set plan / Suspend / user soft-lock — you do not operate their parks from this page.',
  },
  {
    title: 'Recommended ops path',
    body: '1) Leave filter on All (or Pending when clearing the queue).\n2) For a new public signup: pick plan + duration → Approve → confirm they land on Active.\n3) If Checkout failed: Set plan to the correct package (records untouched).\n4) Demo expired without upgrade: Set plan Demo (or paid) to reactivate so they can upgrade in Billing.\n5) Misbehaving person (not whole company): Suspend a user account panel.\n6) Whole tenant off: Suspend company; Reactivate later.\n7) Offboard req: contact them, then Clear offboard when done — never hard-delete from this UI.',
  },
];

export const VENUES_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Venues is for',
    body: 'Venues are parks, sites, and locations under THIS company (VenueLocation). Plan meter resource: venues.\n\nWho uses this page: company admins with venue write permission (sidebar → Venues). Park-locked seats can edit assigned venues but cannot create, archive, or restore.\n\nWhy create them:\n• Stamp ticket products, bookings, sessions, and future modules to a park (orgId + locationId).\n• Park-lock staff seats under Users & permissions.\n• Enterprise HQ / header park switcher filters lists to one venue.\n• Public online booking path /book/{slug} when published.\n\nSoft-archive (Delete) frees the venues quota without deleting history — Restore later via Show archived.',
    href: '/admin/users',
    hrefLabel: 'Users & permissions (park-lock seats)',
  },
  {
    title: 'Plan quota & who can create',
    body: 'Plan usage line under Add venue — used / limit / remaining (or unlimited).\n\nAt limit — Create is blocked until you soft-archive a venue or upgrade in Billing.\n\nNot entitled — subscribe in Billing (or ask FECSYNC for an ops plan stamp) before creates unlock.\n\nPark-locked actors — no Add venue form; ask a company-wide admin.\n\nDemo plan may lock most admin apps; Venues follows demo / entitlement rules like other company apps.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing',
  },
  {
    title: 'Add venue — each field',
    body: 'Venue name * — display name (e.g. Downtown Trampoline Park). Min 2 characters.\n\nURL slug — auto from name until you edit. Public path preview: /book/{slug}. Reset from name undoes a manual slug.\n\nCity — search suggestions (type 2+ letters) or Use my location (GPS if allowed, else network).\n\nTimezone — IANA zone (browser may prefill). Filter box narrows the list; picking a city often sets timezone too.\n\nFranchise park — optional. Same company Organization; not a second SaaS subscription. Assign franchise park managers under Users.\n\nCreate venue — new Active row appears in Locations immediately; meters refresh.\n\nPreview: table shows name, /slug, /book/… path, status Active, city/timezone, Online booking Off until you Publish.',
  },
  {
    title: 'Franchise parks (same company)',
    body: 'Franchise parks are VenueLocation rows under one Organization. Billing, company profile, and plan meters stay company-wide. Franchise park managers invite park-local staff only; park-lock remains the isolation boundary.\n\nPark payouts: open Payouts (or Park payouts on a franchise venue) to complete Stripe Connect for that park. Guests pay into the park’s connected account when charge-ready. Sister parks stay separate. SaaS software billing stays under Billing (company-wide only).',
    href: '/admin/payouts',
    hrefLabel: 'Park / company payouts',
  },
  {
    title: 'Locations list — reading the preview',
    body: '# — row number in the current filtered list.\n\nVenue — name, mono slug, and book path when available.\n\nStatus — Active (counts toward plan) or Archived (soft-deleted; hidden unless Show archived).\n\nCity / timezone — place fields used for scheduling and display.\n\nOnline booking — Published (public wizard can list this venue) or Off. Franchise park badge when marked.\n\nShow archived — checkbox (company-wide admins) to list soft-deleted venues for Restore.\n\nHeader park filter — when a park is selected, this list narrows to that venue; park-stamped modules follow the same scope. Members roster stays company-wide (franchise managers see a park-local roster on Users).',
  },
  {
    title: 'Actions menu — Edit, Publish, links',
    body: 'Edit — opens modal: Name, Slug, Address, City & timezone, Publish, Franchise park flag, and franchise profile fields. Save updates the row everywhere.\n\nPublish / Unpublish — toggles publicBookingEnabled. Publish does NOT publish catalog products; those stay separate on Ticket products / sessions.\n\nCopy slug — clipboard for URLs and integrations.\n\nCopy book link / Open booking — only when Published; opens /book/{slug} for guests.\n\nGuest preview after Publish: public booking wizard can list this venue; products must still be published and attached to the venue.',
  },
  {
    title: 'Delete (soft-archive) & Restore',
    body: 'Delete — confirm soft-archive. Venue leaves the Active list, frees one venues quota slot, history kept. Not a hard-delete.\n\nShow archived → Restore — brings it back Active if plan room allows (blocked at venues limit).\n\nPark-locked seats cannot Delete or Restore.\n\nUse archive when a site closes seasonally or you need quota for a new park — not for temporary hide of booking (use Unpublish instead).',
  },
  {
    title: 'Where a venue is used next',
    body: 'Ticket products / sessions / add-ons / passes / resources — attach or stamp locationId so sales and capacity belong to that park.\n\nBookings & calendar — park-scoped when a venue is selected.\n\nUsers & permissions — Park venues checklist to park-lock a seat to one or more locations.\n\nEnterprise HQ (/admin/hq) — cross-park dashboard + header venue switcher (entitled Enterprise). Selecting a park filters venue lists and park-stamped modules; rollups/meters and members stay company-wide.\n\nPublic guests — /book/{slug} when Online booking is Published.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Scope & Enterprise HQ (quick rules)',
    body: 'All locations — full company venue list (default).\n\nOne park selected in header — venues list + park-stamped ticketing/bookings filter to that park.\n\nPark-locked seat — only assigned venues (narrowed further if a park is selected).\n\nMembers roster and plan meters stay company-wide even when a park is selected.\n\nNeed the HQ switcher? Enterprise entitled → /admin/hq, or upgrade in Billing.',
    href: '/admin/hq',
    hrefLabel: 'Open Enterprise HQ',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm Billing entitlement and venues remaining on the plan meter.\n2) Add venue — name, check slug, set city/timezone (or Use my location).\n3) Create venue → confirm Active row in Locations.\n4) Actions → Edit address if needed → Publish when ready for guests.\n5) Create Ticket products stamped to this venue; publish those products.\n6) (Optional) Invite park-locked staff with this venue checked under Users.\n7) Guest check: Open booking from Actions — wizard shows the park when Published.\n8) Later: Unpublish to hide booking, or Delete (archive) to free quota.',
  },
];

export const ENTERPRISE_HQ_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Enterprise HQ is for',
    body: 'This is YOUR company’s multi-venue control plane — not FECSYNC Company workspaces (which manages other tenants).\n\nWho can use rollups: entitled Enterprise plan + company workspace + settings:manage. Demo is locked out. Park-locked seats do not get the All-locations HQ switcher.\n\nWhat you see here:\n• Venue health (Active / Archived / Total) and a scoped venue list.\n• Plan meters (Venues, Team seats, Tailor seats, POS terminals when entitled) — always company-wide.\n• Venue modules honesty chips (ticketing and memberships when entitled; Digital Waivers enabled after a published template, with a real signed-record count for the selected parks; POS terminal live with real device/sale counts for the selected park scope when entitled).\n\nPreview: Scope chip shows All locations or the selected park name; change it from the header venue switcher.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing (upgrade)',
  },
  {
    title: 'Header venue switcher (the main control)',
    body: 'Location: admin header — HQ venue switcher (visible when Enterprise HQ is entitled).\n\nAll locations — company-wide view; HQ list shows every active venue in the rollup.\n\nOne park — persists Membership.hqSelectedLocationId. Scope chip updates to that park name. Venue list on this page filters to that park; park-stamped modules elsewhere follow the same filter.\n\nThis is a VIEW preference for company-wide seats — not the same as park-locking a staff seat under Users (MembershipVenueAssignment).\n\nGrowth/Starter without Enterprise: no HQ rollups; they may still use a park filter via park-context where available, and manage venues under Venues.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Scope rules — what filters vs stays company-wide',
    body: 'When a park is selected:\n• Filtered — HQ venue items, Venues list, park-stamped ticketing (products, sessions, resources, stock), bookings, payments, invoices (when venueLocationId is set).\n• Always company-wide — Members roster, plan meters on this page, Billing usage.\n\nCompany-wide view (CWV) on a membership controls ownership Layer-2 (whose records you see) — it does NOT assign a park by itself.\n\nPark-lock (Users → Park venues) limits authority to assigned parks independently of Enterprise.',
    href: '/admin/users',
    hrefLabel: 'Users & permissions',
  },
  {
    title: 'Venue health section — reading the preview',
    body: 'Active / Archived / Total — company-wide counts (even when the list below is filtered).\n\nVenue rows — name, /slug · city, status badge (Active / Archived). With a park selected you usually see one row; All locations shows the full set.\n\nEmpty state — no venues yet, or selected venue missing from rollup (archived) → switch to All locations or Open Venues.\n\nManage venues link — create, edit, soft-archive, Publish for booking.',
  },
  {
    title: 'Plan usage meters',
    body: 'Venues — how many active parks count toward the plan cap.\n\nTeam seats — memberships / invite capacity.\n\nTailor seats — tailor module seats when your package includes them.\n\nUnlimited shows used count only. These meters never shrink to the selected park.\n\nLinks: Team → Users; Billing → upgrade or see full usage.\n\nPreview after creating a venue or inviting staff: used counts bump here without leaving HQ.',
  },
  {
    title: 'Venue modules chips',
    body: 'Honesty labels from the server — not fake ticket/member/revenue figures.\n\nenabled — package includes that module and, for Digital Waivers, at least one template is published (Online Ticketing / Bookings on Starter+; guest park Memberships on Growth+; Digital Waivers guest signing and desk on Growth+ after publish; POS terminal on Growth+ with real device/sale counts).\n\nnot enabled — not on this package, or Waivers is entitled but no template is published yet. Access Control, Surveys, Loyalty, and Dynamic Pricing are not shipped. The separate check-in scanner product and ticket-purchase kiosk are not shipped. Do not treat Enterprise alone as unlocking those apps.\n\nWhere to use enabled modules: Ticket products, Sessions, Bookings, Payments, Invoices, Memberships → Plans / Members / Redeem / Reports, Waivers → Waivers / Template / Forms / Signage / Kiosk / Settings, POS → Terminal / Check-in / Tills / Tabs / Capacity / Admin, Profile → Memberships for guests, plus public /book/{slug} when a venue is Published. Guest waiver signing, desk verify, import/export, expiry reminders, and a booking confirmation link when a ticket requires a waiver are live on Growth+. A published version can allow document reading; the photo is not stored. On the waiver kiosk, Continue skips another signature at that park for 90 minutes, and New guest ends that pass. An emailed link does not create one. Booking and membership checks still require a signed waiver record. Check-in blocking is not.',
    href: '/admin/memberships/plans',
    hrefLabel: 'Open Memberships plans',
  },
  {
    title: 'If you see Enterprise required (upsell)',
    body: 'Non-Enterprise plans can open /admin/hq but APIs stay fail-closed — no rollup leak. You get a soft-upsell with Open Billing and Manage venues.\n\nUnlock: upgrade to Enterprise in Billing, or FECSYNC Set plan → Enterprise on Company workspaces (ops).\n\nAfter entitlement, reload — header switcher appears and this guide’s Venue health + meters load.',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm Enterprise entitlement (Billing or ops Set plan).\n2) Create at least one venue under Venues; Publish when ready for guests.\n3) Open /admin/hq — confirm Scope: All locations and Active count.\n4) Use header switcher → pick one park — Scope chip + list narrow; meters stay company-wide.\n5) Switch back to All locations when comparing parks.\n6) Stamp Ticket products / bookings to venues; use the same header scope while operating those apps.\n7) Park-lock desk staff under Users only if they should never see All locations.',
  },
];

export const COMPANY_PROFILE_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Company profile is for',
    body: 'Legal identity and brand for THIS company workspace — invoices, receipts, order emails, booking documents, and printed order views.\n\nWho can edit: staff with company profile write permission (typically platform_admin / settings). Pending companies cannot edit until FECSYNC Approve. Hard-suspended / ops-hold locks editing. Soft billing-hold locks form edits but company platform admins can still export / request offboard.\n\nDemo plan: this page stays available (with Billing) so you can finish brand setup while other apps are locked. The public category switches and embed-origin list on this page stay locked on Demo, the same way other company apps are locked.\n\nProfile completeness % — progress toward legal name, logo, support email, address, and bank details. Dashboard cards may link here when incomplete.',
  },
  {
    title: 'Identity — logo, names, workspace slug',
    body: 'Logo — Upload JPEG/PNG/WebP (max 5MB). Preview tile updates immediately. Remove logo clears it. Used on order print headers, emails, and document letterheads.\n\nStaff sign-in page — Upload a landscape photo (JPEG/PNG/WebP, max 8MB, ideally 1600×1000 px or larger) to show behind your logo on your team’s sign-in page. The live preview shows the result; a soft tint in your brand colour keeps the logo and name readable. Replace or Remove anytime — without a photo the page uses your brand colour. Open sign-in page checks the real page.\n\nLegal name — formal entity name on invoices/receipts.\n\nTrading name — public/display name when different from legal (documents use legal || trading || org name).\n\nWorkspace slug — unique lowercase company key (e.g. acme-parks). Generated on create; change anytime if still unique. App words such as shop, admin, book, and embed are reserved. Storefront host cannot change slug here. Public category links use this slug, so links and embeds already shared with the old slug stop working. After Save, booking, menu, and membership category screens load the new link.\n\nPreview after Save: logo + display name appear on printed orders and customer-facing docs that pull company brand.',
  },
  {
    title: 'Contact fields',
    body: 'Support email — primary guest/support contact on documents and emails.\n\nBilling email — finance/billing correspondence for this company.\n\nReply-to email — where customer replies to automated messages should go (when the mailer uses it).\n\nPhone / Website — shown on letterheads and footers when set.\n\nWhere used: order emails, print headers/footers, invoice/receipt brand blocks. Incomplete contact → guests see missing or platform-fallback brand.',
  },
  {
    title: 'Address & Tax ID',
    body: 'Address line 1 / 2, City, State / region, Country, Postal code — registered or operating address printed on invoices and receipts.\n\nTax ID (VAT / TIN) — tax registration shown on financial documents when required in your region.\n\nPreview: address lines stack under the company name on document letterheads. Completeness meter rises when address is filled.',
  },
  {
    title: 'Bank details (document display only)',
    body: 'These fields print on invoices/documents for offline payment instructions — they do NOT move live card payouts.\n\nBank name, Account name, Account number, Routing / IBAN, Currency.\n\nSecrets are encrypted. GET never returns full account/routing — form stays blank after save; “On file: •••• last4” confirms storage. Leave New account number / New routing blank to keep existing values.\n\nClear bank — wipes stored bank fields.\n\nFor online booking card payouts use Payouts (Stripe Connect) — separate from this section.',
    href: '/admin/payouts',
    hrefLabel: 'Open Payouts (Stripe Connect)',
  },
  {
    title: 'Document footers & letterhead',
    body: 'Invoice footer note — free text under invoices (payment terms, thanks, legal line).\n\nReceipt footer note — free text under receipts.\n\nLetterhead accent (hex) — brand color for print/PDF accents (e.g. #D4AF37).\n\nPreview: open an order print view or booking invoice after Save — footer notes and accent color apply to that company’s documents.',
    href: '/admin/orders',
    hrefLabel: 'Open Orders (print preview)',
  },
  {
    title: 'Public category pages',
    body: 'Trading name is always shown on a company category link. Use the switches to show or hide the logo, phone, support email, website, and address.\n\nBank name, account, routing, tax id, and billing email have no public switch and are never included in that link.\n\nEmbed origins — one https website per line, no path and no wildcard. Only these sites, plus your Website when it starts with https://, may show the category page in an iframe. Every other site is blocked by the browser, and an embedded checkout from any other site is refused. Save public fields stores the switches and the origin list. That save is separate from Save company profile, and Demo cannot use it.\n\nThe company category link is live for active companies on a paid plan: guests see your header and that category, and booking categories take payment on the page. The Copy button in the Actions column of each booking, membership, and menu category row gives you the URL or the iframe snippet. Changes to these switches, origins, and the category layout apply on the next page load, including snippets already pasted on your site.',
  },
  {
    title: 'Workspace export & offboard',
    body: 'Visible to company platform admins only (not storefront).\n\nDownload workspace export — redacted JSON package (profile, members, venues, HQ prefs, redacted Connect/booking summaries, counts). Save a copy before leaving.\n\nRequest offboard — soft request to FECSYNC ops (shows under Company workspaces Offboard req). Orders, payments, and users are never hard-deleted from this screen.\n\nOn soft-hold: edits locked; export/offboard still allowed.',
    href: '/admin/registered-companies',
    hrefLabel: 'Company workspaces (ops)',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Upload logo → set Legal name (and Trading name if different).\n2) Confirm Workspace slug is the key you want.\n3) Fill Support email + Address (+ Tax ID if needed).\n4) Add Bank details only if invoices should show account instructions; else skip and use Payouts for card money.\n5) Write Invoice / Receipt footer notes; set letterhead hex if desired.\n6) Save company profile — watch completeness % climb.\n7) Preview: print an order or open a booking invoice — brand should match.\n8) Optional: Download workspace export for your records.',
  },
];

export const BILLING_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Billing is for',
    body: 'Choose and manage the FECSYNC package for THIS company workspace. Entitlement (what Admin apps and plan caps unlock) comes from Stripe Checkout / Portal success or a FECSYNC ops Set plan stamp — never from picking a card alone or from ?plan= URL hints.\n\nWho can change plans: company platform_admin only. Other settings staff may view. Pending / hard-suspended / ops-hold lock self-serve Billing until reactivation.\n\nStripe Checkout handles money. Company profile brands invoices/receipts you send to customers — separate from Stripe’s own billing emails.\n\nDemo stays available here (with Company profile) while other admin apps stay locked.',
    href: '/admin/company-profile',
    hrefLabel: 'Open Company profile',
  },
  {
    title: 'Current subscription card — each field',
    body: 'Plan · status — stamped package (Demo / Starter / Growth / Enterprise) and subscription status (active, trialing, past_due, …). May show “cancels at period end”.\n\nRenewal / ends — subscriptionEndsAt date and days remaining.\n\nStripe customer — Linked after first Checkout creates a Stripe customer; Not linked means ops stamp or no Checkout yet (Manage billing may be hidden).\n\nOrg status — Organization status (active, etc.). Soft-hold can keep org active while apps soft-deny.\n\nManage billing — opens Stripe Customer Portal (payment method, invoices, cancel) when Linked.\n\nRenew package — appears near end of term or during grace; Portal if Linked, else Checkout for the current plan.',
  },
  {
    title: 'Soft-hold, grace, past due, Demo demotion',
    body: 'Unpaid paid-plan end → soft-hold + grace countdown (default 7 days). Renew before grace ends to keep entitlements.\n\nAfter grace without renew → demote to Demo (active but Demo-locked apps). Records (venues, catalog, orders, memberships) are never deleted.\n\nPast due on live Stripe — update card via Manage billing; unresolved failure leads to soft-hold then Demo.\n\nOps Set plan or Approve on Company workspaces can reactivate when self-serve is stuck.',
    href: '/admin/registered-companies',
    hrefLabel: 'Company workspaces (ops)',
  },
  {
    title: 'Plan usage meters',
    body: 'Live used / limit (or ∞) for capped resources: Venues, Team members, Role templates, Menu items, Catalog fabrics/categories, Tailor seats, Campaigns, Tailor clients, Tickets / month, Booking packages (as entitled).\n\nCreating or inviting in those apps bumps used. At limit → new creates soft-blocked until you archive/remove or upgrade.\n\nNot entitled — meters show 0 remaining; creates stay locked until Checkout or ops stamp.\n\nPreview: after Create venue or Invite member, refresh Billing — the matching meter rises.',
    href: '/admin/venues',
    hrefLabel: 'Open Venues',
  },
  {
    title: 'Packages — Demo, Starter, Growth, Enterprise',
    body: 'Demo — free Checkout ($0, card not required). Unlocks company dashboard + Company profile + Billing only; other apps Demo-locked (incl. Memberships). Trial length via COMPANY_DEMO_DAYS.\n\nStarter — paid Checkout; unlocks ticketing/bookings and plan caps. Guest park Memberships stay Growth+.\n\nGrowth — more parks + park-lock seats + guest Memberships (plans, eligibility, settings, CRM, admin sell/lifecycle billing, redeem/verify desk, guest self-serve, reports, advanced dunning on Enterprise).\n\nEnterprise — HQ control plane (venue switcher + /admin/hq) plus Memberships with HQ report rollup. Contact sales if no Price configured; otherwise Checkout when available.\n\n?plan= or registration hint only highlights a card — entitlement still requires Checkout/webhook or ops stamp.',
  },
  {
    title: 'Subscription length & package buttons',
    body: 'Subscription length — months for paid Checkout term total (monthly rate × months). Hidden when you already have a live paid Stripe sub (use Manage billing to change). Demo ignores length.\n\nChoose plan / Upgrade plan / Start free Checkout — starts Stripe Checkout for that package (platform admin only).\n\nCurrent plan — disabled; you are already on it.\n\nUse Manage billing — shown on other cards when a live paid sub exists (plan changes go through Portal, not a new Checkout).\n\nContact sales — Enterprise without checkout Price.\n\nPrice not configured — env Price ID missing; ask FECSYNC.\n\nPreview after success return (?billing=success): Current subscription updates; meters unlock; toast confirms.',
  },
  {
    title: 'Enterprise HQ banner & where entitlement shows',
    body: 'When Enterprise is entitled — gold banner → Open HQ for cross-park dashboard + header venue switcher.\n\nEnterprise stamped but not entitled — renew or clear hold first.\n\nStarter/Growth — HQ locked; Venues within caps; Growth CWV seats may get a park filter; park-lock seats work without HQ.\n\nGuest/shop brand is unrelated. Module unlock (ticketing, bookings) follows package entitlement on Starter+ — see each app’s guide.',
    href: '/admin/hq',
    hrefLabel: 'Open Enterprise HQ',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm you are company platform_admin and org is Active.\n2) Fill Company profile brand (invoices/receipts).\n3) Pick Subscription length (paid plans).\n4) Demo: Start free Checkout → return → Dashboard/Profile only.\n5) Or Choose Starter/Growth/Enterprise → complete Stripe → return to Billing.\n6) Check Current subscription (plan · active, Linked, renewal date).\n7) Confirm Plan usage meters show remaining room.\n8) Create a Venue / invite a seat — meters update; locked apps unlock per plan.\n9) Later: Manage billing for card/invoices; Renew when the banner appears.',
  },
];

export const PAYOUTS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Payouts is for',
    body: 'Stripe Connect (Express) so guest online card payments settle to YOUR company or franchise park bank.\n\nCompany Connect — non-franchise catalog and packages with no park stamp.\nFranchise park Connect — each franchise VenueLocation can onboard its own connected account; guests for that park settle there when park charge-ready.\n\nThis is NOT FECSYNC SaaS Billing (paying for your software package). It is also NOT Company profile Bank details (those print on invoices only and never move live card money).\n\nWho can run company onboarding: company platform_admin with payouts manage. Franchise park managers may onboard only their assigned franchise parks (never sister parks, never Billing).\n\nSoft billing-hold locks Connect refresh and marketplace checkout until you renew under Billing.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing (SaaS package)',
  },
  {
    title: 'Franchise park payouts',
    body: '1) Mark the venue as Franchise park under Venues (company admin).\n2) Grant franchise park manager + park assignment under Users (saving also grants users:read|invite|park_assign|manage_roles and payouts:read|manage for park staff + park Connect).\n3) Open /admin/payouts?locationId=… (or Park payouts from Venues).\n4) Set up park Connect → finish Stripe Express → Sync until Ready.\n5) Publish ticket products / packages stamped to that park.\n6) Guest card checkout for that park fails closed until park Ready — it does not silently use company Connect.\n7) Sister parks never receive another park’s charges.',
    href: '/admin/payouts',
  },
  {
    title: 'Status pill & charge-ready',
    body: 'Not started — no Connect account yet. Use Set up payouts.\n\nPending — onboarding started; finish Stripe forms or wait for verification.\n\nRestricted — Stripe needs more info; use Refresh link / Open Express Dashboard.\n\nDisabled — account blocked; read disabled reason; contact Stripe/FECSYNC.\n\nReady — onboarding complete.\n\nOnline pay ready vs Not charge-ready yet — chargeReady means charges + payouts are enabled so guests can pay by card. Until then, card checkout is blocked even if packages are published.\n\nDashboard may nudge “Set up payouts” when packages are published but not charge-ready. Franchise managers see park-scoped status only.',
  },
  {
    title: 'Status fields — each meaning',
    body: 'Charges enabled — Yes when Stripe can take card payments for this Connect account.\n\nPayouts enabled — Yes when Stripe can send funds to your bank.\n\nPayout bank — bank name + •••• last4 from Connect (or — until linked). Set inside Stripe Express, not on this form.\n\nCurrency — default Connect currency (e.g. USD).\n\nDisabled reason — Stripe/platform message when the account is blocked.\n\nPreview when Ready: pill Ready, Online pay ready, Charges Yes, Payouts Yes, bank last4 shown.',
  },
  {
    title: 'Buttons — Set up, Refresh, Dashboard, Sync',
    body: 'Set up payouts — first-time redirect to Stripe Express onboarding. Return URL syncs status automatically.\n\nRefresh link — continue incomplete onboarding (new Stripe link when the old one expired).\n\nOpen Express Dashboard — manage bank, tax, payouts schedule after Ready (login link).\n\nSync status — pull latest charges/payouts flags from Stripe without leaving Admin.\n\nView-only seats see status but cannot start Connect — ask the company platform admin.',
  },
  {
    title: 'Where it is used (guest & staff preview)',
    body: 'Guest public booking (/book/…) — card checkout succeeds only when the right Connect is charge-ready: company Connect for non-franchise / null-location catalog; park Connect for venue_booking and staff take-payment stamped to a franchise park.\n\nStaff booking payments / invoices — franchise parks use that park’s Connect when charge-ready; company Connect covers non-franchise parks.\n\nBooking packages / ticket products / membership plans — publish anytime; online card pay stays blocked for a franchise park until its park Connect is Ready on /admin/payouts.\n\nCompany profile bank fields — invoice text only; do not replace Connect.\n\nSaaS Billing — your FECSYNC subscription; unrelated to guest booking deposits.',
    href: '/admin/booking-packages',
    hrefLabel: 'Open Booking packages',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm entitled company plan (Billing) and you are platform_admin (or franchise manager for park Connect only).\n2) Company catalog: open /admin/payouts → Set up company payouts → finish Stripe Express. Franchise park: mark Franchise under Venues → open /admin/payouts?locationId=… → Set up park Connect.\n3) Return to Payouts — Sync until Ready + Online pay ready for that destination.\n4) Confirm Charges Yes, Payouts Yes, bank last4.\n5) Publish packages / ticket products / plans stamped to that park.\n6) Guest preview: book with card — settlement uses park Connect when the park is franchise + Ready.\n7) Later: Open Express Dashboard for bank updates; Sync after Stripe changes.\n8) Soft-hold: renew Billing first — Connect actions stay locked until hold clears.',
  },
];

export const TAX_SETTINGS_GUIDE_STEPS: HowToGuideStep[] = [
  {
    title: 'What Tax Settings is for',
    body: 'Workspace-wide default tax for THIS company — applied at shop checkout and on new orders that use the global rate.\n\nWho can edit: staff with tax manage permission. Others may see the page read-only.\n\nThis is a percentage added on top of listed prices (not included in the sticker price). It does not change SaaS Billing or Stripe Connect Payouts.\n\nCatalog menu items and fabrics can override the rate or be marked tax-exempt. Ticket products can set tax-exempt default. Staff bookings may toggle tax exempt per booking when allowed.',
  },
  {
    title: 'Enable tax — the master switch',
    body: 'Enable tax (toggle) — when ON, Global tax rate applies to every product/fabric that does not set its own override and is not tax-exempt.\n\nWhen OFF — checkout adds $0.00 tax even if a rate is filled in. The Example checkout box shows $0.00 until you turn Enable on.\n\nSave tax settings — persists enabled + rate + label. Toast confirms checkout and new orders will use these rates.',
  },
  {
    title: 'Label on checkout & Global tax rate',
    body: 'Label on checkout — name guests see on the tax line (VAT, Sales Tax, GST…). Default “Tax” if blank.\n\nGlobal tax rate (%) — 0–100, percentage not dollars. Example: 7.5 means 7.5% of taxable subtotal.\n\nProduct prices stay as listed; tax is calculated at checkout from the effective rate (global or item override).\n\nPreview on this page: Example checkout uses a sample $80 cart — Subtotal, Label (rate%), tax amount, Total. Change rate/label/enable and watch the sample update before Save.',
  },
  {
    title: 'Where overrides live (use this rate elsewhere)',
    body: 'Menu items (Products) — Tax exempt checkbox or Tax rate override (%). Empty override = use global rate from this page.\n\nFabrics — same Tax exempt / override when the fabric is sellable.\n\nTicket products — Tax exempt default (and related tax fields on create/edit) so admissions can skip tax when needed.\n\nStaff New booking — optional tax exempt toggle when the actor can manage tax.\n\nOrders / print — tax line shows the label + rate; exempt bookings/items show no tax or exempt note.\n\nGuest shop checkout — taxable lines use global or per-item rate; exempt lines skip tax.',
    href: '/admin/products',
    hrefLabel: 'Open Menu items',
  },
  {
    title: 'Audit block',
    body: 'Created by / Updated by — who last changed tax settings.\n\nCreated / Updated — timestamps.\n\nRead-only history for ops; not fields you edit. Completing Save refreshes Updated by/at.',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Decide your region’s rate and label (e.g. VAT 7.5).\n2) Turn Enable tax ON.\n3) Set Label on checkout and Global tax rate (%).\n4) Confirm Example checkout math looks right.\n5) Save tax settings.\n6) Guest preview: add a catalog item to cart → checkout shows the tax line with your label.\n7) For special items: edit product/fabric → Tax exempt or override % → Save.\n8) Leave rate empty on normal items so they keep following this global rate when you change it later.',
  },
];
