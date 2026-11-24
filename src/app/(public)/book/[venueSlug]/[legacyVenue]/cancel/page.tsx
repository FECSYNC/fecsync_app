import Link from 'next/link';

export default async function MarketplaceBookCancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ venueSlug: string; legacyVenue: string }>;
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const { venueSlug: orgSlug, legacyVenue: packageSlug } = await params;
  const { bookingId } = await searchParams;
  const backHref = `/book/${encodeURIComponent(orgSlug)}/${encodeURIComponent(packageSlug)}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
      <h1 className="text-2xl font-bold text-stone-900">Checkout cancelled</h1>
      <p className="text-sm text-stone-600">
        No charge was completed. You can return to the package and try again when
        you are ready.
      </p>
      {bookingId ? (
        <p className="text-xs text-stone-400 font-mono break-all">
          Booking reference: {bookingId}
        </p>
      ) : null}
      <Link
        href={backHref}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
      >
        Return to package
      </Link>
    </div>
  );
}
