"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { subscribePublicNewsletter } from "@/services/marketing";

export default function CompanyNewsletterPage() {
  const params = useParams();
  const orgSlug = String(params?.orgSlug ?? "");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("idle");
    if (!consent) {
      setStatus("err");
      setMessage("Please confirm you agree to receive marketing emails.");
      return;
    }
    try {
      await subscribePublicNewsletter({
        orgSlug,
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        consent: true,
      });
      setStatus("ok");
      setMessage("You’re subscribed. Watch your inbox for updates from this park.");
      setEmail("");
      setConsent(false);
    } catch (err) {
      setStatus("err");
      setMessage(err instanceof Error ? err.message : "Could not subscribe");
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold text-stone-900">Newsletter</h1>
      <p className="mt-2 text-sm text-stone-600">
        Get park news and offers. No waiver required — we only email you if you opt in.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
        <label className="block text-sm">
          First name (optional)
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          <span>
            I agree to receive marketing emails about this park. See our{" "}
            <Link href="/privacy" className="text-[#9a7b1a] underline">
              privacy policy
            </Link>
            .
          </span>
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-[#D4AF37] py-2.5 text-sm font-semibold text-stone-900"
        >
          Subscribe
        </button>
        {status !== "idle" ? (
          <p className={`text-sm ${status === "ok" ? "text-green-700" : "text-red-600"}`}>
            {message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
