"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import WaiverGuestFlow from "@/components/waivers/WaiverGuestFlow";
import type { GuestFlowSession, GuestSignBody } from "@/components/waivers/guestFlowTypes";
import { coerceExtracted, type ExtractedGuest } from "@/lib/waivers/extractGuestDocument";

type Template = { id: string; name: string; kind: string };

export default function KioskWaiverScreen({ deviceToken }: { deviceToken: string }) {
  const [pinRequired, setPinRequired] = useState(true);
  const [minutes, setMinutes] = useState(5);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [venueName, setVenueName] = useState("");
  const [brand, setBrand] = useState("");
  const [pin, setPin] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [session, setSession] = useState<GuestFlowSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    refs: string[];
    status: "signed" | "declined";
    passId?: string | null;
    passExpires?: string | null;
  } | null>(null);
  const [coveredUntil, setCoveredUntil] = useState<string | null>(null);
  const [activePassId, setActivePassId] = useState<string | null>(null);
  const sending = useRef(false);

  function reset() {
    setSession(null);
    setReceipt(null);
    setError("");
    setPin("");
    setCoveredUntil(null);
    setActivePassId(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}`)
      .then(async (res) => {
        const json = (await res.json()) as {
          data?: {
            pinRequired: boolean;
            sessionMinutes: number;
            templates: Template[];
            venueName: string;
            brand: { name: string };
          };
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "This kiosk is not available.");
        return json.data;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setPinRequired(data.pinRequired);
        setMinutes(data.sessionMinutes || 5);
        setTemplates(data.templates);
        setVenueName(data.venueName);
        setBrand(data.brand.name);
        if (data.templates[0]) setTemplateId(data.templates[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "This kiosk is not available.");
      });
    return () => {
      cancelled = true;
    };
  }, [deviceToken]);

  useEffect(() => {
    if (!session || receipt) return;
    const timer = window.setTimeout(() => {
      setSession(null);
      setError("");
    }, Math.max(1, minutes) * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [session, receipt, minutes]);

  useEffect(() => {
    if (!receipt || receipt.passId) return;
    const timer = window.setTimeout(reset, 8000);
    return () => window.clearTimeout(timer);
  }, [receipt]);

  useEffect(() => {
    const until = coveredUntil ?? (receipt?.passId ? receipt.passExpires : null);
    if (!until) return;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) {
      reset();
      return;
    }
    const timer = window.setTimeout(reset, ms);
    return () => window.clearTimeout(timer);
  }, [coveredUntil, receipt?.passId, receipt?.passExpires]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session", pin, templateId }),
      });
      const json = (await res.json()) as { data?: { session: GuestFlowSession }; error?: string };
      if (!res.ok) throw new Error(json.error || "Could not open this agreement");
      const loaded = json.data?.session;
      if (loaded) {
        setSession({
          ...loaded,
          signingContext: loaded.signingContext ?? {
            lockedEmail: null,
            bookingLabel: null,
            productLabel: null,
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this agreement");
    } finally {
      setBusy(false);
    }
  }

  async function extractBackup(image: string): Promise<ExtractedGuest | null> {
    try {
      const res = await fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ image, templateId, pin }),
      });
      const json = (await res.json().catch(() => null)) as { data?: { fields?: unknown } } | null;
      if (!res.ok || !json) return null;
      return coerceExtracted(json.data?.fields);
    } catch {
      return null;
    }
  }

  async function continuePass() {
    if (!receipt?.passId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "walkin-continue", pin, templateId, passId: receipt.passId }),
      });
      const json = (await res.json()) as {
        data?: { session?: { walkinPass?: { expiresAt: string } | null } };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "This walk-in pass is no longer valid.");
      setCoveredUntil(json.data?.session?.walkinPass?.expiresAt ?? receipt.passExpires ?? null);
      setActivePassId(receipt.passId);
      setReceipt(null);
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This walk-in pass is no longer valid.");
    } finally {
      setBusy(false);
    }
  }

  async function newGuest() {
    const passId = activePassId || receipt?.passId;
    if (passId) {
      try {
        const res = await fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}/walkin/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passId }),
        });
        if (!res.ok) {
          setError("Could not end this walk-in pass. Try New guest again.");
          return;
        }
      } catch {
        setError("Could not end this walk-in pass. Try New guest again.");
        return;
      }
    }
    reset();
  }

  async function submitBody(body: GuestSignBody) {
    if (!session || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/waivers/kiosk/${encodeURIComponent(deviceToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          templateId,
          ...body,
        }),
      });
      const json = (await res.json()) as {
        data?: {
          publicRefs?: string[];
          status?: "signed" | "declined";
          walkinPass?: { id: string; expiresAt: string } | null;
        };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Could not save this waiver");
      setReceipt({
        refs: json.data?.publicRefs ?? [],
        status: json.data?.status === "declined" ? "declined" : "signed",
        passId: json.data?.walkinPass?.id ?? null,
        passExpires: json.data?.walkinPass?.expiresAt ?? null,
      });
      setActivePassId(json.data?.walkinPass?.id ?? null);
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this waiver");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 overflow-auto bg-stone-950 text-stone-50">
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-10 [&_.waiver-guest-flow]:text-stone-100 [&_input]:bg-stone-900 [&_select]:bg-stone-900 [&_textarea]:bg-stone-900 [&_.prose]:text-stone-200">
        <p className="text-sm text-[#D4AF37]">{brand || venueName}</p>
        <h1 className="mt-1 text-3xl font-semibold">Sign a waiver</h1>
        <p className="mt-1 text-sm text-stone-400">{venueName}</p>
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
        {receipt ? (
          <div className="mt-8">
            <p className="text-xl">{receipt.status === "declined" ? "Declined." : "Saved."}</p>
            <p className="mt-2 font-mono text-sm">{receipt.refs.join(", ")}</p>
            <p className="mt-4 text-sm text-stone-400">
              {receipt.passId && receipt.passExpires
                ? `This guest can continue at this park until ${new Date(receipt.passExpires).toLocaleTimeString()}. New guest ends that pass.`
                : "This screen resets for the next guest."}
            </p>
            {receipt.passId && receipt.status === "signed" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="rounded bg-[#D4AF37] px-3 py-2 text-stone-950" onClick={() => void continuePass()}>
                  Continue
                </button>
                <button type="button" className="rounded border border-stone-500 px-3 py-2" onClick={() => void newGuest()}>
                  New guest
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {coveredUntil && !session && !receipt ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm">
              No second signature is required at this park until {new Date(coveredUntil).toLocaleTimeString()}.
            </p>
            <button type="button" className="rounded border border-stone-500 px-3 py-2" onClick={() => void newGuest()}>
              New guest
            </button>
          </div>
        ) : null}
        {!session && !receipt && !coveredUntil ? (
          <form onSubmit={(e) => void unlock(e)} className="mt-8 space-y-4">
            <label className="block text-sm">
              Agreement
              <select
                className="mt-1 w-full rounded bg-stone-900 px-3 py-3"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {pinRequired ? (
              <input
                className="w-full rounded bg-stone-900 px-3 py-3"
                inputMode="numeric"
                placeholder="Staff PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            ) : null}
            <button
              disabled={busy || !templateId}
              className="rounded bg-[#D4AF37] px-4 py-3 font-semibold text-stone-950 disabled:opacity-50"
            >
              Start
            </button>
          </form>
        ) : null}
        {session && !receipt ? (
          <div className="mt-8">
            <h2 className="mb-4 text-xl">{session.template.title}</h2>
            <WaiverGuestFlow
              session={session}
              busy={busy}
              error={error}
              onSubmit={submitBody}
              onDecline={submitBody}
              onExtractBackup={extractBackup}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
