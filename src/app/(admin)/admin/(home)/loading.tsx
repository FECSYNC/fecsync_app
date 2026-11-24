/** Instant dashboard-shaped shell while the /admin chunk compiles. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div>
        <div className="h-8 w-40 animate-pulse rounded bg-stone-200" />
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-stone-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-stone-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-stone-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-lg bg-stone-100" />
        <div className="h-72 animate-pulse rounded-lg bg-stone-100" />
      </div>
    </div>
  );
}
