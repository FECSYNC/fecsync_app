"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openWaiverPanel } from "@/components/Protected/admin/pages/waivers/waiverPanel";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { btnPrimaryClass, fieldClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import {
  bulkResendWaiverRecords,
  cancelWaiverRequests,
  listWaiverRecords,
  listWaiverTemplates,
  resendWaiverRecord,
  voidWaiverRecord,
  waiverDeskQueryOptions,
  waiverKeys,
} from "@/services/waivers";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";

export default function WaiversHomePage() {
  const router = useRouter();
  const params = useSearchParams();
  const {
    scopedLocationId,
    parkLocked,
  } = useHqLocationFilter();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const email = params.get("email") ?? "";
  const phone = params.get("phone") ?? "";
  const templateId = params.get("templateId") ?? "";
  const locationIdParam = params.get("locationId") ?? "";
  const locationId =
    parkLocked && scopedLocationId
      ? scopedLocationId
      : scopedLocationId && !locationIdParam
        ? scopedLocationId
        : locationIdParam;
  const channel = params.get("channel") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const expiringWithin = params.get("expiringWithin") ?? "";
  const [draftQ, setDraftQ] = useState(q);
  const [draftEmail, setDraftEmail] = useState(email);
  const [draftPhone, setDraftPhone] = useState(phone);
  const [draftExpiring, setDraftExpiring] = useState(expiringWithin);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState("");
  const [rowNote, setRowNote] = useState("");
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.WaiversWrite);
  const canExport = can(P.WaiversExport);
  const canVoid = can(P.WaiversVoid);
  const canVerify = can(P.WaiversVerify);
  const canAdmin = can(P.WaiversAdmin);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: waiverKeys.records(
      `${q}|${email}|${phone}|${templateId}|${locationId}|${channel}|${from}|${to}|${expiringWithin}`,
      status
    ),
    queryFn: () =>
      listWaiverRecords({
        q,
        status,
        email,
        phone,
        templateId,
        locationId,
        channel,
        from,
        to,
        expiringWithin,
      }),
    ...waiverDeskQueryOptions,
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates("all"),
    queryFn: () => listWaiverTemplates("all"),
    ...waiverDeskQueryOptions,
  });
  const venues = useQuery({
    queryKey: venueLocationKeys.list(),
    queryFn: () => listAdminVenueLocations(),
    ...waiverDeskQueryOptions,
  });

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const current = params.get(key) ?? "";
      if (current === value) return;
      router.replace(`/admin/waivers?${next.toString()}`);
    },
    [params, router]
  );

  useEffect(() => {
    setDraftQ(q);
  }, [q]);
  useEffect(() => {
    setDraftEmail(email);
  }, [email]);
  useEffect(() => {
    setDraftPhone(phone);
  }, [phone]);
  useEffect(() => {
    setDraftExpiring(expiringWithin);
  }, [expiringWithin]);

  // Header park / HQ preference → keep records filter in sync without full reload.
  const prevScopedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevScopedRef.current;
    prevScopedRef.current = scopedLocationId ?? null;

    if (parkLocked || scopedLocationId) {
      if (scopedLocationId && locationIdParam !== scopedLocationId) {
        setFilter("locationId", scopedLocationId);
      }
      return;
    }

    // CWV All: clear sticky filter only when it still equals the park we just left
    // (do not wipe an intentional manual venue filter after All was already selected).
    if (prev && locationIdParam === prev) {
      setFilter("locationId", "");
    }
  }, [parkLocked, scopedLocationId, locationIdParam, setFilter]);

  useEffect(() => {
    if (draftQ === q) return;
    const timer = window.setTimeout(() => setFilter("q", draftQ.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [draftQ, q, setFilter]);
  useEffect(() => {
    if (draftEmail === email) return;
    const timer = window.setTimeout(() => setFilter("email", draftEmail.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [draftEmail, email, setFilter]);
  useEffect(() => {
    if (draftPhone === phone) return;
    const timer = window.setTimeout(() => setFilter("phone", draftPhone.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [draftPhone, phone, setFilter]);
  useEffect(() => {
    if (draftExpiring !== "" && !/^\d+$/.test(draftExpiring)) return;
    const days =
      draftExpiring === "" || Number(draftExpiring) < 1
        ? ""
        : String(Math.min(365, Number(draftExpiring)));
    if (days === expiringWithin) return;
    if (draftExpiring !== "" && Number(draftExpiring) < 1) return;
    const timer = window.setTimeout(() => setFilter("expiringWithin", days), 300);
    return () => window.clearTimeout(timer);
  }, [draftExpiring, expiringWithin, setFilter]);

  const records = (query.data ?? []) as {
    id: string;
    publicRef: string;
    status: string;
    guestName: string;
    templateName: string;
    version?: number | null;
    signedAt: string | null;
    expiresAt: string | null;
    channel?: string;
    fillMethod?: string | null;
    minorCount?: number;
  }[];
  const filtersActive = Boolean(
    q || email || phone || templateId || locationId || channel || from || to || expiringWithin || status
  );
  const exportHref = (() => {
    const next = new URLSearchParams();
    next.set("type", "records");
    for (const [key, value] of [
      ["q", q],
      ["email", email],
      ["phone", phone],
      ["templateId", templateId],
      ["locationId", locationId],
      ["channel", channel],
      ["from", from],
      ["to", to],
      ["expiringWithin", expiringWithin],
      ["status", status],
    ] as const) {
      if (value) next.set(key, value);
    }
    return `/api/admin/waivers/export?${next.toString()}`;
  })();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Waivers</h1>
          <p className="mt-1 text-sm text-stone-600">
            Create a waiver for this company, then publish it. Guests sign from a link, QR, on-site, or the waiver kiosk.
          </p>
        </div>
        {canWrite ? (
          <button type="button" className={btnPrimaryClass} onClick={() => openWaiverPanel("template")}>
            Create a waiver
          </button>
        ) : null}
      </div>
      <WaiverSubnav />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className={`${fieldClass} max-w-xs`}
          placeholder="Search name, email, phone, or reference"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
        />
        <input
          className={`${fieldClass} max-w-[140px]`}
          placeholder="Email"
          value={draftEmail}
          onChange={(e) => setDraftEmail(e.target.value)}
        />
        <input
          className={`${fieldClass} max-w-[140px]`}
          placeholder="Phone"
          value={draftPhone}
          onChange={(e) => setDraftPhone(e.target.value)}
        />
        <select className={`${fieldClass} max-w-[180px]`} value={templateId} onChange={(e) => setFilter("templateId", e.target.value)}>
          <option value="">All templates</option>
          {(templates.data ?? [])
            .filter((row) => (row.status === "published" || row.publishedVersion != null) && !row.archivedAt)
            .map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select
          className={`${fieldClass} max-w-[180px]`}
          value={locationId}
          disabled={parkLocked && Boolean(scopedLocationId)}
          onChange={(e) => setFilter("locationId", e.target.value)}
        >
          {!parkLocked ? <option value="">All parks in scope</option> : null}
          {(venues.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <input
          className={`${fieldClass} max-w-[140px]`}
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => setFilter("from", e.target.value)}
        />
        <input
          className={`${fieldClass} max-w-[140px]`}
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => setFilter("to", e.target.value)}
        />
        <input
          className={`${fieldClass} max-w-[120px]`}
          placeholder="Expiring days"
          inputMode="numeric"
          value={draftExpiring}
          onChange={(e) => setDraftExpiring(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
        />
        <select
          className={`${fieldClass} max-w-[180px]`}
          value={status}
          onChange={(e) => setFilter("status", e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="signed">Signed</option>
          <option value="expired">Expired</option>
          <option value="declined">Declined</option>
          <option value="voided">Voided</option>
        </select>
        <select className={`${fieldClass} max-w-[140px]`} value={channel} onChange={(e) => setFilter("channel", e.target.value)}>
          <option value="">All channels</option>
          <option value="online">Online</option>
          <option value="email_link">Email</option>
          <option value="sms_link">SMS</option>
          <option value="qr">QR</option>
          <option value="kiosk">Kiosk</option>
          <option value="onsite">On-site</option>
          <option value="import">Import</option>
        </select>
      </div>
      {templates.isError || venues.isError ? (
        <p className="mb-2 text-sm text-red-700">
          Template and park lists could not refresh. The waiver rows below still use the last successful load.
        </p>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Could not load waivers"}
        </p>
      ) : null}
      {query.isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
      {bulkNote || rowNote ? <p className="mb-3 text-sm text-stone-600">{rowNote || bulkNote}</p> : null}
      {!query.isLoading && records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
          <div className="mb-3 flex justify-center">
            <WaiverToolsMenu
              canWrite={canWrite}
              canExport={canExport}
              canVerify={canVerify}
              canAdmin={canAdmin}
              canRead
              selectedCount={picked.length}
              exportHref={exportHref}
              onResendSelected={() => resendSelected()}
            />
          </div>
          <p className="font-medium text-stone-800">
            {filtersActive ? "No waivers match these filters" : "No signed waivers yet"}
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {filtersActive
              ? "Clear a filter or wait — this list refreshes on its own when a guest signs."
              : "Create a waiver from Template, publish it from Forms, then guests can sign from Sign on-site, a standing sign, or the waiver kiosk."}
          </p>
        </div>
      ) : null}
      {records.length > 0 ? (
        <div className="rounded-lg border border-stone-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-stone-500">
              <th className="px-2 py-2" />
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Reference</th>
              <th className="px-2 py-2">Guest</th>
              <th className="px-2 py-2">Template</th>
              <th className="px-2 py-2">Version</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Channel</th>
              <th className="px-2 py-2">Fill</th>
              <th className="px-2 py-2">Minors</th>
              <th className="px-2 py-2">Signed</th>
              <th className="px-2 py-2">Expires</th>
              <th className="px-2 py-2">Signature</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row, index) => (
              <tr key={row.id} className="border-b border-stone-100">
                <td className="px-2 py-2">
                  {canWrite ? (
                    <input
                      type="checkbox"
                      checked={picked.includes(row.id)}
                      onChange={(e) => {
                        setPicked((current) =>
                          e.target.checked
                            ? [...current, row.id].slice(0, 50)
                            : current.filter((id) => id !== row.id)
                        );
                      }}
                      aria-label={`Select ${row.publicRef}`}
                    />
                  ) : null}
                </td>
                <td className="px-2 py-2 text-stone-500">{index + 1}</td>
                <td className="px-2 py-2 font-mono text-xs">
                  <AdminPendingLink href={`/admin/waivers/records/${row.id}`} cornerSpinner={false} className="underline">
                    {row.publicRef}
                  </AdminPendingLink>
                </td>
                <td className="px-2 py-2">{row.guestName}</td>
                <td className="px-2 py-2">{row.templateName}</td>
                <td className="px-2 py-2">{row.version ?? "—"}</td>
                <td className="px-2 py-2">{row.status}</td>
                <td className="px-2 py-2">{row.channel ?? "—"}</td>
                <td className="px-2 py-2">{row.fillMethod ?? "—"}</td>
                <td className="px-2 py-2">{row.minorCount ?? 0}</td>
                <td className="px-2 py-2">{row.signedAt ? new Date(row.signedAt).toLocaleString() : "—"}</td>
                <td className="px-2 py-2">{row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="px-2 py-2">
                  <ActionMenu label="Signature">
                    <AdminPendingLink
                      href={`/admin/waivers/records/${row.id}`}
                      cornerSpinner={false}
                      className={menuItemClass}
                    >
                      Open
                    </AdminPendingLink>
                    {canWrite && row.status !== "voided" ? (
                      <button type="button" className={menuItemClass} onClick={() => resendOne(row.id)}>
                        Resend link
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button type="button" className={menuItemClass} onClick={() => cancelLinks(row.id)}>
                        Cancel outstanding links
                      </button>
                    ) : null}
                    {canVoid && row.status !== "voided" ? (
                      <button type="button" className={menuItemClass} onClick={() => voidOne(row)}>
                        Void
                      </button>
                    ) : null}
                  </ActionMenu>
                </td>
                {index === 0 ? (
                  <td className="px-2 py-2 align-top" rowSpan={records.length}>
                    <WaiverToolsMenu
                      canWrite={canWrite}
                      canExport={canExport}
                      canVerify={canVerify}
                      canAdmin={canAdmin}
                      canRead
                      selectedCount={picked.length}
                      exportHref={exportHref}
                      onResendSelected={() => resendSelected()}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </div>
  );

  function resendSelected() {
    const ids = picked.slice(0, 50);
    if (!ids.length) {
      setBulkNote("Select waivers with the checkboxes, then choose Resend selected.");
      setRowNote("");
      return;
    }
    setBulkNote("");
    setRowNote("");
    void bulkResendWaiverRecords(ids)
      .then((data) => {
        const failed = data?.results.filter((entry) => !entry.ok).length ?? 0;
        setBulkNote(`Resent ${ids.length - failed} of ${ids.length}${picked.length > 50 ? " (50 at a time)" : ""}.`);
      })
      .catch((err: unknown) => {
        setBulkNote(err instanceof Error ? err.message : "Could not resend");
      });
  }

  function resendOne(id: string) {
    setRowNote("");
    setBulkNote("");
    void resendWaiverRecord(id)
      .then((result) => {
        setRowNote(result?.url ? "New signing link is ready." : "Link resent.");
        if (result?.url) window.prompt("New signing link", result.url);
        return qc.invalidateQueries({ queryKey: waiverKeys.all });
      })
      .catch((err: unknown) => {
        setRowNote(err instanceof Error ? err.message : "Could not resend");
      });
  }

  function cancelLinks(id: string) {
    setRowNote("");
    setBulkNote("");
    void cancelWaiverRequests(id)
      .then((result) => {
        setRowNote(
          result
            ? `Cancelled ${result.cancelled} outstanding link${result.cancelled === 1 ? "" : "s"}.`
            : "Could not cancel"
        );
      })
      .catch((err: unknown) => {
        setRowNote(err instanceof Error ? err.message : "Could not cancel");
      });
  }

  function voidOne(row: { id: string; publicRef: string }) {
    const reason = window.prompt(`Reason for voiding ${row.publicRef}`);
    if (!reason?.trim()) return;
    setRowNote("");
    setBulkNote("");
    void voidWaiverRecord(row.id, reason.trim())
      .then(() => {
        setRowNote(`${row.publicRef} voided.`);
        return qc.invalidateQueries({ queryKey: waiverKeys.all });
      })
      .catch((err: unknown) => {
        setRowNote(err instanceof Error ? err.message : "Could not void");
      });
  }
}

const menuItemClass = "block w-full px-3 py-1.5 text-left text-xs text-stone-800 hover:bg-stone-50";

function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-800 [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
        {children}
      </div>
    </details>
  );
}

function WaiverToolsMenu({
  canWrite,
  canExport,
  canVerify,
  canAdmin,
  canRead,
  selectedCount,
  exportHref,
  onResendSelected,
}: {
  canWrite: boolean;
  canExport: boolean;
  canVerify: boolean;
  canAdmin: boolean;
  canRead: boolean;
  selectedCount: number;
  exportHref: string;
  onResendSelected: () => void;
}) {
  return (
    <ActionMenu label="Actions">
      {canVerify ? (
        <AdminPendingLink href="/admin/waivers/verify" cornerSpinner={false} className={menuItemClass}>
          Verify
        </AdminPendingLink>
      ) : null}
      {canRead ? (
        <AdminPendingLink href="/admin/waivers/forms/responses" cornerSpinner={false} className={menuItemClass}>
          Responses
        </AdminPendingLink>
      ) : null}
      {canExport ? (
        <a className={menuItemClass} href={exportHref}>
          Export CSV
        </a>
      ) : null}
      {canWrite ? (
        <AdminPendingLink href="/admin/waivers/new" cornerSpinner={false} className={menuItemClass}>
          Sign on-site
        </AdminPendingLink>
      ) : null}
      {canAdmin ? (
        <AdminPendingLink href="/admin/waivers/import" cornerSpinner={false} className={menuItemClass}>
          Import
        </AdminPendingLink>
      ) : null}
      {canRead ? (
        <AdminPendingLink href="/admin/waivers/compliance" cornerSpinner={false} className={menuItemClass}>
          Compliance
        </AdminPendingLink>
      ) : null}
      {canWrite ? (
        <button type="button" className={menuItemClass} onClick={onResendSelected}>
          Resend selected{selectedCount ? ` (${selectedCount})` : ""}
        </button>
      ) : null}
    </ActionMenu>
  );
}
