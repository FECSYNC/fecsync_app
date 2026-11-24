"use client";

import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { subscribeUserErrors } from "@/lib/userErrorBus";

/** Full-width top banner — plain language, no stack traces. */
export default function UserErrorBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return subscribeUserErrors((next) => {
      setMessage(next);
    });
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 10000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="alert"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[300000] flex justify-center px-3 pt-3 md:px-6"
    >
      <div className="flex w-full max-w-3xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-stone-800 shadow-lg">
        <AlertCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
          aria-hidden
        />
        <p className="flex-1 text-sm font-medium leading-snug md:text-base">
          {message}
        </p>
        <button
          type="button"
          onClick={() => setMessage(null)}
          className="shrink-0 rounded p-1 text-stone-500 hover:bg-amber-100 hover:text-stone-800"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
