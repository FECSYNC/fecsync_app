"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearLegacySessionStorage } from "@/lib/clientSync";
import { clearPersistedAuthStorage, useAuthStore } from "@/store/authStore";

export default function ClearSessionPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Clearing old session…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });
      } catch {
        // Still clear client storage even if the request fails.
      }

      clearLegacySessionStorage();
      clearPersistedAuthStorage({ broadcast: false });
      useAuthStore.getState().clearAuth();

      if (cancelled) return;
      setStatus("Session cleared. Redirecting…");
      router.replace("/signin");
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-lg font-medium">{status}</p>
      <p className="max-w-md text-sm text-neutral-500">
        Removing old login cookies and local storage. You normally should not
        need this page — logout and automatic client sync handle it.
      </p>
    </main>
  );
}
