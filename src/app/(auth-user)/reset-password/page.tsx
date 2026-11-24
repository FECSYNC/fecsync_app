"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthPageSkeleton from "@/components/Public_C/auth/AuthPageSkeleton";
import SetNewPasswordForm from "@/components/Public_C/auth/SetNewPasswordForm";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";

/**
 * /reset-password — request a reset email.
 * /reset-password?token=… — set a new password (preferred email link target).
 */
function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  if (token) {
    return <SetNewPasswordForm token={token} />;
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!email) {
      setError("Please enter your email address");
      setIsLoading(false);
      return;
    }

    if (!email.includes("@")) {
      setError("Please enter a valid email address");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => {
          router.push(`/check-email?email=${encodeURIComponent(email)}`);
        }, 2000);
      } else {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        setError(
          data?.message ||
            data?.error ||
            "Email not found. Please check your email address."
        );
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex items-center justify-between p-6 lg:px-8">
        <FecSyncBrandLogo size="sm" variant="onLight" href="/home" />
        <div className="flex items-center space-x-2 text-sm">
          <span className="hidden text-[#1A1A1A] md:block">
            Don&apos;t have an account?
          </span>
          <button
            type="button"
            onClick={() => router.push("/register-company")}
            className="cursor-pointer font-medium text-[#FDC713] transition-colors duration-200 hover:text-[#D4AF37]"
          >
            Sign up
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#FFE181]/30">
              <Image
                src="/brand/fecsync-mark.svg"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10"
              />
            </div>
          </div>

          <h1 className="mb-3 text-center text-2xl font-semibold text-[#3D3D3D] lg:text-3xl">
            Forgot password?
          </h1>
          <p className="mb-8 text-center text-sm text-[#5D5D5D] lg:text-base">
            Enter your email to recover your password. The link we send is valid
            for 1 hour.
          </p>

          {success ? (
            <div className="mb-4 text-center text-green-600">
              Email sent! Redirecting you to check your email…
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Enter email"
                className={`w-full rounded-lg border-2 bg-[#F2F2F2] px-4 py-3 text-[#1A1A1A] placeholder-[#1A1A1AB2] transition-all duration-200 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FFE181] ${
                  error ? "border-red-500" : "border-transparent"
                }`}
                disabled={isLoading}
                autoComplete="email"
                required
              />
              {error ? (
                <div className="absolute -bottom-6 left-0 text-xs text-red-500">
                  {error}
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-8 w-full cursor-pointer rounded-lg bg-[#FFE181] px-4 py-3 font-medium text-[#1A1A1A] transition-all duration-200 hover:bg-[#D4AF37] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthPageSkeleton title="Forgot password" subtitle="Loading…" />
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
