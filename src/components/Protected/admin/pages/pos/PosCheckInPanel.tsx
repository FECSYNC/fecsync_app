"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  assignPosCustomIds,
  lookupPosMembership,
  redeemPosCheckIn,
  searchPosWaivers,
} from "@/services/pos";
import PosPinModal from "./PosPinModal";
import PosCheckInGuideModal from "./PosCheckInGuideModal";
import { emitPosEvent } from "./posEvents";

type Props = {
  locationId: string;
  compact?: boolean;
  parkName?: string;
  /** Fired after a successful ticket/membership redeem so the terminal can refresh capacity. */
  onRedeemed?: (result: { kind: string; raw: unknown }) => void;
};

type WaiverRow = {
  id?: string;
  status?: string;
  templateName?: string;
  guestName?: string;
  expiresAt?: string | null;
};

const field =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";
const primaryBtn =
  "rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-45";
const softBtn =
  "rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60 disabled:opacity-45";
const darkBtn =
  "rounded-xl bg-stone-900 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800";

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm shadow-stone-900/5"
    >
      <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-wide text-stone-900">{title}</h2>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </motion.section>
  );
}

function friendlyStatus(raw: string): string {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.kind === "ticket") {
      const cred = data.credential as { status?: string; id?: string } | undefined;
      return `Ticket ${cred?.status === "redeemed" ? "redeemed" : "updated"}${
        cred?.id ? ` · ${cred.id.slice(0, 10)}…` : ""
      }`;
    }
    if (data.kind === "membership") {
      const result = (data.result ?? data) as Record<string, unknown>;
      const remaining = result.remainingEntries;
      const parts = ["Membership visit redeemed"];
      if (typeof remaining === "number") parts.push(`${remaining} visits left`);
      return parts.join(" · ");
    }
    const parts: string[] = [];
    if (data.ok === true || data.redeemed === true) parts.push("Redeemed");
    if (typeof data.message === "string") parts.push(data.message);
    if (typeof data.status === "string") parts.push(String(data.status));
    if (typeof data.publicId === "string") parts.push(`Ref ${data.publicId}`);
    if (typeof data.remaining === "number") parts.push(`${data.remaining} remaining`);
    if (parts.length) return parts.join(" · ");
  } catch {
    /* keep raw */
  }
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
}

export default function PosCheckInPanel({ locationId, compact, parkName, onRedeemed }: Props) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const [membershipPreview, setMembershipPreview] = useState<{
    name: string;
    photoUrl?: string | null;
    id: string;
    customId?: string;
    blocked?: boolean;
    blockReason?: string | null;
    remainingEntries?: number | null;
    warnings?: string[];
  } | null>(null);
  const [waiverQ, setWaiverQ] = useState("");
  const [waivers, setWaivers] = useState<WaiverRow[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [customTicketId, setCustomTicketId] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<number | null>(null);

  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

  useEffect(() => {
    inputRef.current?.focus();
  }, [locationId]);

  const stopCamera = useCallback(() => {
    if (scanTimer.current != null) {
      window.clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!nfcSupported) return;
    let cancelled = false;
    let reader: { scan: () => Promise<void>; addEventListener: Function; removeEventListener: Function } | null =
      null;
    const onReading = (event: { message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => {
      const record = event.message?.records?.[0];
      if (!record?.data) return;
      const bytes = new Uint8Array(record.data.buffer);
      const text = new TextDecoder().decode(bytes).trim();
      if (text) setCode(text);
    };
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const NDEFReader = (window as any).NDEFReader;
        if (!NDEFReader) return;
        reader = new NDEFReader();
        await reader!.scan();
        if (cancelled) return;
        reader!.addEventListener("reading", onReading);
      } catch {
        // Permission denied or hardware unavailable — keyboard/camera remain available.
      }
    })();
    return () => {
      cancelled = true;
      try {
        reader?.removeEventListener("reading", onReading);
      } catch {
        /* ignore */
      }
    };
  }, [nfcSupported]);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector;
      if (Detector && videoRef.current) {
        const detector = new Detector({ formats: ["qr_code", "code_128", "ean_13"] });
        scanTimer.current = window.setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          detector
            .detect(video)
            .then((codes: Array<{ rawValue?: string }>) => {
              const value = codes[0]?.rawValue?.trim();
              if (value) {
                setCode(value);
                stopCamera();
              }
            })
            .catch(() => undefined);
        }, 600);
      } else {
        setError("Camera is on. This browser has no BarcodeDetector — type or wedge-scan the code.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera unavailable");
    }
  }

  async function redeem(body: Record<string, unknown>) {
    if (!locationId) {
      setError("Select a park first.");
      return;
    }
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const result = await redeemPosCheckIn({ locationId, ...body });
      setStatus(JSON.stringify(result));
      setCode("");
      emitPosEvent("pos:checkin", { locationId });
      onRedeemed?.({ kind: result.kind, raw: result });
      inputRef.current?.focus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Redeem failed";
      if (/past|PIN|override|late/i.test(msg)) {
        setPendingBody(body);
        setPinOpen(true);
        setError(msg);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    if (membershipPreview) {
      await redeem({ guestMembershipId: membershipPreview.id, qty: 1 });
      setMembershipPreview(null);
      return;
    }
    await redeem({ code: trimmed });
  }

  async function lookupMembership() {
    setError("");
    if (!locationId) {
      setError("Select a park first.");
      return;
    }
    try {
      const { membership } = await lookupPosMembership(locationId, code.trim());
      const m = membership as Record<string, unknown> | null | undefined;
      if (!m) {
        setError("Membership not found for this park.");
        return;
      }
      const id = String(m.id ?? m.guestMembershipId ?? "");
      if (!id) {
        setError("Membership not found for this park.");
        return;
      }
      setMembershipPreview({
        id,
        name: String(m.displayName ?? m.guestName ?? "Member"),
        photoUrl: (m.photoUrl as string) ?? (m.guestPhotoUrl as string) ?? null,
        customId: m.customMembershipId ? String(m.customMembershipId) : undefined,
        blocked: Boolean(m.blocked),
        blockReason: m.blockReason ? String(m.blockReason) : null,
        remainingEntries:
          typeof m.remainingEntries === "number" ? m.remainingEntries : null,
        warnings: Array.isArray(m.warnings) ? (m.warnings as string[]) : [],
      });
      if (m.blocked) {
        setError(
          `Membership blocked${m.blockReason ? ` (${String(m.blockReason)})` : ""} — confirm before redeeming.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    }
  }

  function printMembershipCard() {
    if (!membershipPreview) return;
    const id = membershipPreview.customId ?? membershipPreview.id;
    const win = window.open("", "_blank", "width=400,height=520");
    if (!win) return;
    win.document.write(`
      <html><head><title>Membership</title></head><body style="font-family:sans-serif;text-align:center;padding:24px">
      <h1>${membershipPreview.name}</h1>
      <p>ID: ${id}</p>
      <img alt="QR" width="160" height="160" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(id)}" />
      </body></html>`);
    win.document.close();
    win.print();
  }

  return (
    <div className={compact ? "space-y-3" : "mx-auto max-w-2xl space-y-4 px-4 py-6"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
              Gate
            </p>
            <h1 className="font-serif text-2xl text-stone-900">Check-in</h1>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {parkName ? (
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">
                {parkName}
              </span>
            ) : null}
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
                nfcSupported
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : "bg-stone-100 text-stone-500 ring-stone-200"
              }`}
            >
              {nfcSupported ? "NFC ready" : "Keyboard / camera"}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25"
        >
          Guide
        </button>
      </div>

      <AnimatePresence mode="wait">
        {status ? (
          <motion.p
            key={status}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"
          >
            {friendlyStatus(status)}
          </motion.p>
        ) : null}
        {error ? (
          <motion.p
            key={error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Section title="Scan & redeem">
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-[11px] font-medium text-stone-500">
            Ticket or membership code
            <input
              ref={inputRef}
              className={`${field} mt-1 font-mono tracking-wide`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              placeholder="Scan or type code"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !code.trim()} className={primaryBtn}>
              {busy ? "Redeeming…" : "Redeem"}
            </button>
            <button
              type="button"
              className={softBtn}
              onClick={() => lookupMembership().catch(() => undefined)}
            >
              Membership lookup
            </button>
            <button
              type="button"
              className={softBtn}
              onClick={() => (cameraOn ? stopCamera() : startCamera())}
            >
              {cameraOn ? "Stop camera" : "Camera QR"}
            </button>
          </div>
        </form>
        <AnimatePresence>
          {cameraOn ? (
            <motion.video
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              ref={videoRef}
              className="max-h-48 w-full rounded-xl border border-stone-200 bg-black"
              muted
              playsInline
            />
          ) : null}
        </AnimatePresence>
      </Section>

      <AnimatePresence>
        {membershipPreview ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="overflow-hidden rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-br from-[#D4AF37]/10 to-white shadow-sm"
          >
            <div className="flex gap-4 p-4">
              {membershipPreview.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={membershipPreview.photoUrl}
                  alt=""
                  className="h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-stone-200"
                />
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs text-stone-500 ring-1 ring-stone-200">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-serif text-xl text-stone-900">{membershipPreview.name}</p>
                <p className="mt-1 text-xs text-stone-500">
                  Confirm the guest matches before redeeming.
                  {membershipPreview.remainingEntries != null
                    ? ` · ${membershipPreview.remainingEntries} visits left`
                    : ""}
                </p>
                {membershipPreview.warnings?.length ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {membershipPreview.warnings.join(" · ")}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={darkBtn}
                    disabled={membershipPreview.blocked}
                    title={
                      membershipPreview.blocked
                        ? membershipPreview.blockReason ?? "Membership blocked"
                        : undefined
                    }
                    onClick={() => redeem({ guestMembershipId: membershipPreview.id, qty: 1 })}
                  >
                    Confirm & redeem
                  </button>
                  <button type="button" className={softBtn} onClick={printMembershipCard}>
                    Print card
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-500 underline"
                    onClick={() => setMembershipPreview(null)}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Section title="Waivers" delay={0.04}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={`${field} flex-1`}
            placeholder="Guest email or booking id"
            value={waiverQ}
            onChange={(e) => setWaiverQ(e.target.value)}
          />
          <button
            type="button"
            className={softBtn}
            onClick={() =>
              searchPosWaivers(waiverQ, locationId)
                .then((r) => setWaivers(r.waivers ?? []))
                .catch((e: Error) => setError(e.message))
            }
          >
            Search
          </button>
        </div>
        {waivers.length ? (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl ring-1 ring-stone-200/70">
            {waivers.map((w, i) => (
              <li key={w.id ?? i} className="px-3 py-2.5 text-sm text-stone-700">
                <span className="font-medium text-stone-900">{w.guestName ?? "Guest"}</span>
                <span className="text-stone-400"> · </span>
                {w.templateName ?? "Waiver"}
                <span className="ml-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                  {w.status ?? "unknown"}
                </span>
                {w.expiresAt ? (
                  <span className="mt-0.5 block text-[11px] text-stone-500">
                    Expires {new Date(w.expiresAt).toLocaleDateString()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-stone-400">No waiver results yet.</p>
        )}
        <Link href="/admin/waivers" className="inline-flex text-xs font-semibold text-[#8a7320] underline">
          Open waiver desk
        </Link>
      </Section>

      <Section title="Custom ticket IDs" delay={0.06}>
        <input
          className={field}
          placeholder="Credential id"
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
        />
        <input
          className={field}
          placeholder="Custom ticket id"
          value={customTicketId}
          onChange={(e) => setCustomTicketId(e.target.value)}
        />
        <button
          type="button"
          className={primaryBtn}
          disabled={!credentialId.trim() || !customTicketId.trim()}
          onClick={() =>
            assignPosCustomIds({
              locationId,
              assignments: [{ credentialId, customTicketId }],
              credentialId,
              customTicketId,
            })
              .then((r) => setStatus(JSON.stringify(r)))
              .catch((e: Error) => setError(e.message))
          }
        >
          Save custom ticket id
        </button>
      </Section>

      <PosPinModal
        open={pinOpen}
        locationId={locationId}
        title="Manager override"
        onClose={() => setPinOpen(false)}
        onVerified={(managerPin) => {
          if (pendingBody) {
            redeem({ ...pendingBody, managerOverride: true, managerPin }).catch(() => undefined);
          }
          setPendingBody(null);
        }}
      />

      <PosCheckInGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
