/** Neutral placeholder — the parent auth skeleton carries the platform logo. */
export default function CompanySignInLoading() {
  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden flex-1 animate-pulse bg-gray-200 lg:block" />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md space-y-5">
          <div className="mx-auto h-16 w-16 animate-pulse rounded-xl bg-gray-200" />
          <div className="mx-auto h-8 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-12 animate-pulse rounded-full bg-gray-200" />
        </div>
      </div>
    </div>
  );
}
