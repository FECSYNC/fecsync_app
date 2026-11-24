'use client';

/**
 * Instant paint shell for auth routes while client chunks hydrate.
 * Platform /signin stays brand-neutral; company /signin/[slug] paints its own logo after load.
 */
export default function AuthPageSkeleton({
  title = 'Sign in',
  subtitle = 'Enter your work email to continue to your company workspace',
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden lg:flex lg:flex-1 relative bg-gray-900">
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/30 to-black/30" />
        <div className="absolute bottom-8 left-8 text-white/80">
          <p className="text-sm">Secure sign-in portal</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 bg-white lg:px-8 py-8 min-h-screen">
        <div className="w-full max-w-md space-y-6">
          <div className="h-5 w-28 rounded bg-gray-100 animate-pulse" />
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-600">{subtitle}</p>
          </div>
          <div className="space-y-4">
            <div className="h-12 w-full rounded-lg bg-gray-100 animate-pulse" />
            <div className="h-12 w-full rounded-lg bg-gray-100 animate-pulse" />
            <div className="h-12 w-full rounded-full bg-[#D4AF37]/35 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
