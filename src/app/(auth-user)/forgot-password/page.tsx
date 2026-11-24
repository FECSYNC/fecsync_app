"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthPageSkeleton from "@/components/Public_C/auth/AuthPageSkeleton";
import SetNewPasswordForm from "@/components/Public_C/auth/SetNewPasswordForm";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";

/**
 * Email reset links historically hit /forgot-password?token=…
 * Without a token, send people to the request form.
 */
function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";

  if (token) {
    return <SetNewPasswordForm token={token} />;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="absolute left-4 top-4">
        <FecSyncBrandLogo size="sm" variant="onLight" href="/home" />
      </div>
      <div className="w-full max-w-md rounded-md bg-white p-6 text-center shadow">
        <h1 className="text-xl font-semibold text-[#3D3D3D]">
          Reset link missing or incomplete
        </h1>
        <p className="mt-2 text-sm text-[#5D5D5D]">
          Open the full link from your email, or request a new password reset.
        </p>
        <a
          href="/reset-password"
          className="mt-6 inline-block w-full rounded bg-[#FFE181] py-3 text-sm font-semibold text-[#3D3D3D] hover:bg-[#D4AF37] hover:text-white"
        >
          Request a new reset email
        </a>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthPageSkeleton title="Reset password" subtitle="Loading…" />
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
