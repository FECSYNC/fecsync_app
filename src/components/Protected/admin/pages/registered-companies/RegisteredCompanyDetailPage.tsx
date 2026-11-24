"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  getRegisteredCompanyClient,
  registeredCompaniesKeys,
} from "@/services/registeredCompanies";
import {
  BILLING_DURATION_OPTIONS,
  formatSubscriptionTermLabel,
  getSubscriptionPlan,
} from "@/lib/subscriptionPlans";
import { isStorefrontOrgSession } from "@/services/auth";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import { useAuthStore } from "@/store/authStore";
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

export default function RegisteredCompanyDetailPage() {
  const params = useParams();
  const orgId = typeof params?.orgId === "string" ? params.orgId : "";
  const user = useAuthStore((s) => s.user);
  const canView =
    isStorefrontOrgSession(user) && isPlatformAdminActor(user);

  const q = useQuery({
    queryKey: registeredCompaniesKeys.detail(orgId),
    queryFn: () => getRegisteredCompanyClient(orgId),
    enabled: Boolean(canView && orgId),
    staleTime: 30_000,
    refetchOnMount: "always",
  });

  if (!canView) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-8 text-sm text-stone-600">
        Company workspace details are only available to FECSYNC storefront
        platform admins.
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-8 text-sm text-stone-600">
        Missing company id.
      </div>
    );
  }

  if (q.isPending) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-stone-200 bg-white py-16">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {q.error instanceof Error ? q.error.message : "Company not found"}
        </div>
      </div>
    );
  }

  const c = q.data;
  const planMeta = c.subscriptionPlan
    ? getSubscriptionPlan(c.subscriptionPlan)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <Link
          href="/admin/registered-companies?status=active"
          className="text-sm font-medium text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline"
        >
          Back to list actions
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {c.logoUrl?.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logoUrl.trim()}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-xl object-cover ring-1 ring-stone-200"
            />
          ) : (
            <span
              className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-stone-100 text-sm font-semibold text-stone-600 ring-1 ring-stone-200"
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
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
                {c.name}
              </h1>
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
            <p className="font-mono text-sm text-stone-500">{c.slug}</p>
            <CompanyLoginLink slug={c.slug} variant="inline" label="Staff login link" />
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailCard label="Plan">
          {planMeta?.name || c.subscriptionPlan || "—"}
          {c.requestedPlan ? (
            <span className="mt-1 block text-xs text-stone-500">
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
        <DetailCard label="Updated">
          {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "—"}
        </DetailCard>
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

      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">
            Staff seats ({c.members.length})
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Read-only roster for this company workspace.
          </p>
        </div>
        {c.members.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            No memberships on this workspace.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {c.members.map((m) => (
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
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/registered-companies"
      className="inline-flex items-center text-sm font-medium text-stone-600 hover:text-stone-900"
    >
      ← Company workspaces
    </Link>
  );
}

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium text-stone-900">{children}</div>
    </div>
  );
}
