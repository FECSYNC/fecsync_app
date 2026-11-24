"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

export default function CompanySignInError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Sign-in is temporarily unavailable</h1>
        <p className="text-sm text-gray-600">
          We couldn&apos;t load this company&apos;s sign-in page. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-[#D4AF37] px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
