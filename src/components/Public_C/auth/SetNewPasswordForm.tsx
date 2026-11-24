"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";
import {
  PASSWORD_STRENGTH_MESSAGE,
  passwordMeetsStrengthRules,
} from "@/lib/passwordPolicy";

/**
 * Set a new password from a forgot-password email token.
 * Used by /forgot-password?token=… and /reset-password?token=….
 */
export default function SetNewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const getStrength = () => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^\w\s]/.test(password)) score++;
    return score;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    if (!token.trim()) {
      setError("Invalid or expired reset link. Request a new one from Forgot password.");
      setSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setSubmitting(false);
      return;
    }

    if (!passwordMeetsStrengthRules(password)) {
      setError(PASSWORD_STRENGTH_MESSAGE);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(
          data?.message || data?.error || "Something went wrong."
        );
      }

      setStatus("Reset successful! Redirecting to sign in…");
      setTimeout(() => router.push("/signin"), 2500);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = getStrength();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="absolute left-4 top-4">
        <FecSyncBrandLogo size="sm" variant="onLight" href="/home" />
      </div>

      <div className="absolute right-6 top-6 hidden text-sm md:block">
        <span className="text-[#1A1A1A]">Don&apos;t have an account? </span>
        <a
          href="/register-company"
          className="font-medium text-[#FDC713] hover:underline"
        >
          Register your company
        </a>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-md bg-white p-6 shadow"
      >
        <div className="mb-4 flex justify-center">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFE181]/40 text-lg font-bold text-[#3D3D3D]"
            aria-hidden
          >
            *
          </div>
        </div>
        <h2 className="text-center text-xl font-semibold text-[#3D3D3D]">
          Set new password
        </h2>
        <p className="mt-1 text-center text-sm text-[#5D5D5D]">
          Must be at least 8 characters. This link expires in 1 hour.
        </p>

        <div className="mt-6">
          <input
            type="password"
            placeholder="New password*"
            autoComplete="new-password"
            className="w-full rounded border-2 border-transparent bg-[#F2F2F2] p-3 text-[#1A1A1AB2] placeholder-[#1A1A1AB2] transition-colors duration-200 focus:border-[#FFE181] focus:outline-none"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error === "Passwords do not match.") setError("");
            }}
            required
            minLength={8}
          />

          {password && strength < 5 ? (
            <div className="mt-2">
              <div className="flex items-center justify-between">
                <div className="mr-3 h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full transition-all duration-300 ${
                      strength >= 3
                        ? "w-2/3 bg-[#FFCA37]"
                        : "w-1/3 bg-[#FF3E3E]"
                    }`}
                  />
                </div>
                <span
                  className={`text-xs font-medium ${
                    strength >= 3 ? "text-[#FFCA37]" : "text-[#FF3E3E]"
                  }`}
                >
                  {strength >= 3 ? "Almost there" : "Too weak"}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-[#5D5D5D]">
                <li className={password.length >= 8 ? "text-green-600" : ""}>
                  {password.length >= 8 ? "✓" : "✗"} minimum of 8 characters
                </li>
                <li className={/[A-Z]/.test(password) ? "text-green-600" : ""}>
                  {/[A-Z]/.test(password) ? "✓" : "✗"} any uppercase letter
                </li>
                <li className={/[a-z]/.test(password) ? "text-green-600" : ""}>
                  {/[a-z]/.test(password) ? "✓" : "✗"} any lowercase letter
                </li>
                <li className={/\d/.test(password) ? "text-green-600" : ""}>
                  {/\d/.test(password) ? "✓" : "✗"} any number
                </li>
                <li
                  className={/[^\w\s]/.test(password) ? "text-green-600" : ""}
                >
                  {/[^\w\s]/.test(password) ? "✓" : "✗"} any symbol
                </li>
              </ul>
            </div>
          ) : null}

          {password && strength >= 5 ? (
            <div className="mt-2 flex items-center justify-between">
              <div className="mr-3 h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full w-full bg-[#11E215] transition-all duration-300" />
              </div>
              <span className="text-xs font-medium text-[#11E215]">Great!</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          <input
            type="password"
            placeholder="Confirm password*"
            autoComplete="new-password"
            className="w-full rounded border-2 border-transparent bg-[#F2F2F2] p-3 text-[#1A1A1AB2] placeholder-[#1A1A1AB2] transition-colors duration-200 focus:border-[#FFE181] focus:outline-none"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (error === "Passwords do not match.") setError("");
            }}
            required
            minLength={8}
          />
          {confirmPassword && confirmPassword !== password ? (
            <p className="mt-1 text-xs text-red-600">Password does not match</p>
          ) : null}
        </div>

        {error && error !== "Passwords do not match." ? (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        ) : null}
        {status ? (
          <p className="mt-3 text-sm text-green-600">{status}</p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full cursor-pointer rounded bg-[#FFE181] py-3 text-sm font-semibold text-[#3D3D3D] transition-colors duration-300 hover:bg-[#D4AF37] hover:text-white disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Set new password"}
        </button>

        <p className="mt-4 text-center text-xs text-[#5D5D5D]">
          Link expired?{" "}
          <a href="/reset-password" className="text-[#D4AF37] hover:underline">
            Request a new reset email
          </a>
        </p>
      </form>
    </div>
  );
}
