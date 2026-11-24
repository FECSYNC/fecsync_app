"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";
import AuthPageSkeleton from "@/components/Public_C/auth/AuthPageSkeleton";

function ActivateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("");
    if (!token) {
      setError("Invalid or missing invite link.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/memberships/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        dashboardUrl?: string;
      };
      if (!res.ok) {
        setError(data.message || "Could not activate invite.");
        return;
      }
      setStatus(data.message || "Password set.");
      const returnTo = encodeURIComponent(
        data.dashboardUrl || "/profile?tab=memberships"
      );
      setTimeout(() => {
        router.push(`/signin?returnTo=${returnTo}`);
      }, 1200);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 via-white to-amber-50/40 flex flex-col">
      <header className="flex justify-between items-center p-6 lg:px-8">
        <FecSyncBrandLogo size="sm" variant="onLight" href="/home" />
        <Link
          href="/signin"
          className="text-sm font-medium text-[#D4AF37] hover:underline"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
              Membership
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-stone-900">
              Activate your membership dashboard
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              Set a password for your invite-only account. Then sign in to track
              visits, plan details, renewals, and payment history.
            </p>
          </div>

          {!token ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This page needs a valid invite link from your park. Ask the desk to
              resend your membership dashboard invite.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
              <label className="block text-sm">
                <span className="text-stone-700">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
              {error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : null}
              {status ? (
                <p className="text-sm text-emerald-700">{status}</p>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Set password & continue"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

export default function MembershipActivatePage() {
  return (
    <Suspense fallback={<AuthPageSkeleton />}>
      <ActivateContent />
    </Suspense>
  );
}
