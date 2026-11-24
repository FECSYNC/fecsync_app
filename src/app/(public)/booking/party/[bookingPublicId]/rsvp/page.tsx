import { redirect } from 'next/navigation';

/** Legacy RSVP links (?token=) forward to the canonical invitation page. */
export default async function PartyRsvpRoute({
  searchParams,
}: {
  params: Promise<{ bookingPublicId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token?.trim()) redirect(`/party/invite/${encodeURIComponent(token.trim())}`);
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Party invitation</h1>
      <p className="mt-2 text-sm text-stone-600">This invitation link is missing its code. Open the link from your invitation message.</p>
    </main>
  );
}
