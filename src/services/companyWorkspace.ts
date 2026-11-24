import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type CompanyWorkspaceExportPayload = {
  exportedAt: string;
  organization: Record<string, unknown>;
  companyProfile: unknown;
  members: unknown[];
  venues: unknown[];
  usage: unknown;
  billing: unknown;
  resourceCounts: Record<string, number | Record<string, number>>;
  /** Guest park Memberships — redacted (no Stripe guest ids / photos / QR). */
  membershipGuestProfiles?: unknown[];
  membershipPlansExport?: unknown[];
  guestMembershipsExport?: unknown[];
  membershipVenueEligibilityExport?: unknown[];
  membershipSettingsExport?: unknown[];
  /** World B — redacted Connect status (no acct_ / PI secrets). */
  marketplaceAccount?: Record<string, unknown> | null;
  bookingPackages?: unknown[];
  marketplaceBookings?: unknown[];
};

type ExportResponse = {
  export: CompanyWorkspaceExportPayload;
  message?: string;
};

export type OffboardResponse = {
  offboard: {
    orgId: string;
    offboardRequestedAt: string;
    created?: boolean;
  };
  message?: string;
};

/** Redacted actor-org workspace package (JSON). Storefront denied server-side. */
export async function downloadCompanyWorkspaceExport(): Promise<CompanyWorkspaceExportPayload> {
  const raw = await api<MaybeWrapped<ExportResponse>>(
    "/api/admin/company-export",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.export) {
    throw new Error("Export payload missing");
  }
  return data.export;
}

/** Soft offboard request — audit + ops notice; no hard-delete. */
export async function requestCompanyWorkspaceOffboard(
  reason?: string
): Promise<{ orgId: string; offboardRequestedAt: string }> {
  const raw = await api<MaybeWrapped<OffboardResponse>>(
    "/api/admin/company-offboard-request",
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        reason?.trim() ? { reason: reason.trim().slice(0, 500) } : {}
      ),
    }
  );
  const data = unwrap(raw);
  if (!data?.offboard) {
    throw new Error("Offboard response missing");
  }
  return data.offboard;
}

/** Browser download helper for the redacted JSON package. */
export function saveWorkspaceExportFile(
  payload: CompanyWorkspaceExportPayload,
  slugHint?: string | null
): void {
  const slug =
    (typeof payload.organization?.slug === "string" &&
      payload.organization.slug.trim()) ||
    slugHint?.trim() ||
    "workspace";
  const safe = slug.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "workspace";
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fecsync-workspace-export-${safe}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
