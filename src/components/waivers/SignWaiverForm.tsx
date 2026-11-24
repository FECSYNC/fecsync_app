"use client";

import { useEffect, useRef, useState } from "react";
import WaiverGuestFlow from "@/components/waivers/WaiverGuestFlow";
import type { GuestFlowSession, GuestSignBody } from "@/components/waivers/guestFlowTypes";
import { coerceExtracted, type ExtractedGuest } from "@/lib/waivers/extractGuestDocument";

type Receipt = {
  state: "receipt";
  status: "signed" | "declined";
  publicRefs: string[];
  signedAt: string;
  expiresAt: string | null;
  replay?: boolean;
};

export default function SignWaiverForm({
  token,
  orgSlug,
  venueSlug,
}: {
  token: string;
  orgSlug?: string;
  venueSlug?: string;
}) {
  const [session, setSession] = useState<GuestFlowSession | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState("");
  const sending = useRef(false);

  const query = new URLSearchParams();
  if (orgSlug) query.set("orgSlug", orgSlug);
  if (venueSlug) query.set("venueSlug", venueSlug);
  if (locale) query.set("locale", locale);
  const qs = query.toString();
  const url = `/api/public/waivers/sign/${encodeURIComponent(token)}${qs ? `?${qs}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        const json = (await res.json()) as { data?: GuestFlowSession | Receipt; error?: string };
        if (!res.ok) throw new Error(json.error || "This waiver link is not available.");
        return json.data;
      })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.state === "receipt") {
          setReceipt(data);
          setSession(null);
        } else {
          setSession({
            ...(data as GuestFlowSession),
            signingContext: (data as GuestFlowSession).signingContext ?? {
              lockedEmail: null,
              bookingLabel: null,
              productLabel: null,
            },
          });
          setReceipt(null);
          setLocale((current) => current || data.locale);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open this waiver");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function extractBackup(image: string): Promise<ExtractedGuest | null> {
    try {
      const res = await fetch(`/api/public/waivers/sign/${encodeURIComponent(token)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = (await res.json().catch(() => null)) as { data?: { fields?: ExtractedGuest | null } } | null;
      if (!res.ok || !json) return null;
      return coerceExtracted(json.data?.fields);
    } catch {
      return null;
    }
  }

  async function postBody(body: GuestSignBody) {
    if (!session || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: Receipt; error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save this waiver");
      if (json.data) setReceipt(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this waiver");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="p-8 text-sm text-stone-600">Loading agreement…</p>;
  }
  if (receipt) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-2xl font-semibold text-stone-900">
          {receipt.status === "declined" ? "Waiver declined" : "Waiver signed"}
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          {receipt.replay ? "This link was already completed." : "A copy of this reference was saved."}
        </p>
        {receipt.publicRefs.length ? (
          <p className="mt-4 font-mono text-sm text-stone-800">{receipt.publicRefs.join(", ")}</p>
        ) : null}
      </main>
    );
  }
  if (!session) {
    return <p className="p-8 text-sm text-red-700">{error || "This waiver link is not available."}</p>;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        {session.brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.brand.logoUrl} alt="" className="mb-3 h-10 w-auto" />
        ) : null}
        <p className="text-sm text-stone-500">{session.brand.name}</p>
        <h1 className="text-2xl font-semibold text-stone-900">{session.template.title}</h1>
      </header>
      <WaiverGuestFlow
        session={session}
        busy={busy}
        error={error}
        onLocaleChange={setLocale}
        onSubmit={postBody}
        onDecline={postBody}
        onExtractBackup={extractBackup}
      />
    </main>
  );
}
