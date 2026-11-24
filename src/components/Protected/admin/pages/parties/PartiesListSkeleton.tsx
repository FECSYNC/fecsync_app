/** Page-shaped placeholder for /admin/parties (route loading + Suspense) — no hooks, server-safe. */
export default function PartiesListSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Opening parties">
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
        {['w-16', 'w-20', 'w-14', 'w-14', 'w-20', 'w-24'].map((w, i) => (
          <div key={i} className={`h-7 ${w} animate-pulse rounded-md bg-stone-100`} />
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900">Parties</h1>
          <div className="h-4 w-48 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-stone-100" />
          <div className="h-9 w-32 animate-pulse rounded-lg bg-[#D4AF37]/30" />
        </div>
      </div>
      <div className="h-[4.75rem] animate-pulse rounded-xl border border-stone-200 bg-white" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-[#D4AF37]/15" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-stone-200" />
              <div className="h-6 w-12 animate-pulse rounded bg-stone-200" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-[6.5rem] animate-pulse rounded-xl border border-stone-200 bg-white" />
      <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
            <div className="h-10 w-1 rounded-full bg-stone-200" />
            <div className="h-3.5 w-14 rounded bg-stone-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-48 max-w-full rounded bg-stone-200" />
              <div className="h-2.5 w-32 rounded bg-stone-100" />
            </div>
            <div className="hidden h-5 w-24 rounded-full bg-stone-100 md:block" />
            <div className="h-8 w-16 rounded-lg bg-stone-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
