/** Neutral 404 for company category links — no platform branding. */
export default function CompanySiteNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">Page not found</h1>
      <p className="mt-2 text-sm text-stone-600">
        This link is not available. Check the address or contact the venue.
      </p>
    </main>
  );
}
