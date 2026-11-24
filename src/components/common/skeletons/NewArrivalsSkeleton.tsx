// New Arrivals Section Skeleton Loader
// Matches the responsive New Arrivals layouts

export function NewArrivalsSkeleton() {
  return (
    <div className="bg-white px-4 py-10 sm:py-12 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8 sm:mb-10 md:mb-12">
          <div className="mx-auto h-10 md:h-14 w-48 md:w-72 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Mobile / tablet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-[4/5] min-h-[280px] rounded-2xl bg-gray-200 animate-pulse"
            />
          ))}
        </div>

        {/* Desktop masonry */}
        <div
          className="hidden md:grid grid-cols-3 gap-3 h-[480px] lg:h-[560px] xl:h-[600px]"
          style={{
            gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr)',
          }}
        >
          <div className="row-span-3 rounded-2xl bg-gray-200 animate-pulse" />
          <div className="row-span-2 rounded-2xl bg-gray-200 animate-pulse" />
          <div className="row-span-2 rounded-2xl bg-gray-200 animate-pulse" />
          <div className="row-span-1 rounded-2xl bg-gray-200 animate-pulse" />
          <div className="row-span-1 rounded-2xl bg-gray-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
