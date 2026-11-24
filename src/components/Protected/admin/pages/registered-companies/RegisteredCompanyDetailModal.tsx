"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  getRegisteredCompanyClient,
  registeredCompaniesKeys,
  type RegisteredCompanyRow,
} from "@/services/registeredCompanies";
import {
  BILLING_DURATION_OPTIONS,
  formatSubscriptionTermLabel,
  getSubscriptionPlan,
} from "@/lib/subscriptionPlans";
import CompanyLoginLink from "@/components/Protected/admin/components/CompanyLoginLink";

function termLabel(company: {
  subscriptionInterval?: string | null;
  requestedDurationMonths?: number | null;
  subscriptionPlan?: string | null;
}): string | null {
  const months = company.requestedDurationMonths;
  if (typeof months === "number" && Number.isFinite(months) && months > 0) {
    const hit = BILLING_DURATION_OPTIONS.find((d) => d.months === months);
    if (hit) return hit.label;
  }
  if (company.subscriptionInterval) {
    return formatSubscriptionTermLabel(company.subscriptionInterval);
  }
  return null;
}

function statusBadgeClass(status: string, softHold?: boolean): string {
  if (softHold) return "bg-amber-50 text-amber-900 ring-amber-200";
  if (status === "pending") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (status === "active") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  if (status === "suspended") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-stone-100 text-stone-700 ring-stone-200";
}

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/60 px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium text-stone-900">{children}</div>
    </div>
  );
}

/**
 * Instant company workspace drawer — paints from list row data, then soft-loads
 * the staff roster without navigating to /admin/registered-companies/[id].
 */
export default function RegisteredCompanyDetailModal({
  company,
  onClose,
}: {
  company: RegisteredCompanyRow;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: registeredCompaniesKeys.detail(company.id),
    queryFn: () => getRegisteredCompanyClient(company.id),
    enabled: Boolean(company.id),
    staleTime: 60_000,
    // Paints from cache instantly; re-reads only when older than staleTime
    // (the staff login link must follow slug renames).
    refetchOnMount: true,
    retry: 0,
    meta: { suppressErrorBanner: true },
  });

  const c = q.data ?? company;
  const members = q.data?.members ?? [];
  const planMeta = c.subscriptionPlan
    ? getSubscriptionPlan(c.subscriptionPlan)
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-detail-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            {c.logoUrl?.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.logoUrl.trim()}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-stone-200"
              />
            ) : (
              <span
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-sm font-semibold text-stone-600 ring-1 ring-stone-200"
                aria-hidden
              >
                {c.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("") || "?"}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="company-detail-title"
                  className="truncate text-lg font-semibold tracking-tight text-stone-900"
                >
                  {c.name}
                </h2>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass(
                    c.status,
                    c.billingSoftHold
                  )}`}
                >
                  {c.billingSoftHold
                    ? "Soft hold"
                    : c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-stone-500">
                {c.slug}
              </p>
              <CompanyLoginLink slug={c.slug} variant="inline" label="Staff login link" />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailCard label="Plan">
              {planMeta?.name || c.subscriptionPlan || "—"}
              {c.requestedPlan ? (
                <span className="mt-1 block text-xs font-normal text-stone-500">
                  Interest: {c.requestedPlan}
                </span>
              ) : null}
            </DetailCard>
            <DetailCard label="Term">{termLabel(c) || "—"}</DetailCard>
            <DetailCard label="Ends">
              {c.subscriptionEndsAt
                ? new Date(c.subscriptionEndsAt).toLocaleString()
                : "—"}
            </DetailCard>
            <DetailCard label="Stripe">
              {c.hasStripeCustomer ? "Linked customer" : "—"}
            </DetailCard>
            <DetailCard label="Seats">{c.memberCount}</DetailCard>
            <DetailCard label="Active venues">{c.venuesActive ?? 0}</DetailCard>
            <DetailCard label="Created">
              {new Date(c.createdAt).toLocaleString()}
            </DetailCard>
            {"updatedAt" in c && c.updatedAt ? (
              <DetailCard label="Updated">
                {new Date(String(c.updatedAt)).toLocaleString()}
              </DetailCard>
            ) : null}
          </section>

          {c.enterpriseHqEligible ? (
            <p className="rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-3 text-sm text-stone-800">
              HQ console available for this workspace (Enterprise entitled).
            </p>
          ) : null}

          {(c.offboardRequestedAt || c.offboardedAt) && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Soft offboard
              {c.offboardRequestedAt
                ? ` requested ${new Date(c.offboardRequestedAt).toLocaleString()}`
                : ""}
              {c.offboardedAt
                ? ` · marked ${new Date(c.offboardedAt).toLocaleString()}`
                : ""}
              . Records are kept — no hard delete.
            </p>
          )}

          <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-stone-900">
                Staff seats
                {q.isFetched ? ` (${members.length})` : ""}
              </h3>
              <p className="mt-0.5 text-xs text-stone-500">
                Read-only roster for this company workspace.
              </p>
            </div>
            {q.isPending && !q.data ? (
              <p className="px-4 py-6 text-center text-sm text-stone-500">
                Loading staff…
              </p>
            ) : q.isError ? (
              <p className="px-4 py-6 text-center text-sm text-stone-500">
                Could not load staff roster right now. Company details above are
                still available.
              </p>
            ) : members.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-stone-500">
                No memberships on this workspace.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {members.map((m) => (
                  <li
                    key={m.membershipId}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-900">
                        {m.fullName}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {m.email || "—"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-stone-500">
                      <p className="font-medium capitalize text-stone-700">
                        {m.rolePreset.replace(/_/g, " ")}
                      </p>
                      <p className="capitalize">{m.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
