/** Instant paint while an admin route's client chunk streams in. */
export default function AdminRouteLoading({
  label = 'Opening…',
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-12"
      aria-busy="true"
      aria-label={label}
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-[#D4AF37]"
        aria-hidden
      />
      <p className="text-sm text-stone-500">{label}</p>
    </div>
  );
}
