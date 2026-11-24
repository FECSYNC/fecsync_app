"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, unwrap, isTransientApiError, type MaybeWrapped } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { isStorefrontOrgSession } from "@/services/auth";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import {
  ORG_SUBSCRIPTION_PLANS,
  getSubscriptionPlan,
  BILLING_DURATION_OPTIONS,
  DEFAULT_BILLING_DURATION_MONTHS,
  formatSubscriptionTermLabel,
  billingDurationLabel,
  resolveBillingDurationMonthsInterest,
} from "@/lib/subscriptionPlans";
import { useToast } from "@/contexts/toast-context";
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults, isAdminListBlockingLoad } from "@/lib/adminListCache";
import {
  withAdminListSnapshot,
  writeAdminListSnapshot,
} from "@/lib/adminListSnapshot";
import {
  getRegisteredCompanyClient,
  listRegisteredCompaniesClient,
  registeredCompaniesKeys,
  type RegisteredCompanyRow,
  type RegisteredCompanyStatusFilter,
} from "@/services/registeredCompanies";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import RegisteredCompanyDetailModal from "@/components/Protected/admin/pages/registered-companies/RegisteredCompanyDetailModal";
import { useCompanyLoginUrl } from "@/components/Protected/admin/components/CompanyLoginLink";
import { browserPublicOrigin, companyLoginUrl } from "@/lib/tenantDomain";
import { copyToClipboard } from "@/lib/copyToClipboard";
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  REGISTERED_COMPANIES_GUIDE_STEPS,
} from "@/components/Protected/admin/components/AdminHowToGuideModal";

const PlatformAccountSuspendPanel = dynamic(
  () =>
    import(
      "@/components/Protected/admin/pages/registered-companies/PlatformAccountSuspendPanel"
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-24 animate-pulse rounded-xl border border-stone-200 bg-stone-50" />
    ),
  }
);

type StatusFilter = RegisteredCompanyStatusFilter;
type CompanyRow = RegisteredCompanyRow;

function companyTermLabel(c: CompanyRow): string | null {
  // Prefer stamped grant months (ops create / Set plan) over interval shorthand.
  if (
    typeof c.requestedDurationMonths === "number" &&
    Number.isFinite(c.requestedDurationMonths) &&
    c.requestedDurationMonths > 0
  ) {
    return billingDurationLabel(c.requestedDurationMonths);
  }
  const fromInterval = formatSubscriptionTermLabel(c.subscriptionInterval);
  if (fromInterval) return fromInterval;
  return null;
}

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "suspended", label: "Suspended" },
  { id: "offboard", label: "Offboard req" },
];

function statusBadgeClass(status: string, softHold?: boolean): string {
  if (softHold) return "bg-amber-50 text-amber-900 ring-amber-200";
  if (status === "pending") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (status === "active") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  if (status === "suspended") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-stone-100 text-stone-700 ring-stone-200";
}

/** Client preview of Organization.slug (server still uniquifies on create). */
function previewOrgSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function CompanyLogoThumb({
  name,
  logoUrl,
  size = 36,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  if (logoUrl?.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Cloudinary profile URLs; avoid layout shift
      <img
        src={logoUrl.trim()}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs font-semibold text-stone-600 ring-1 ring-stone-200"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function formatStatusLabel(
  status: string,
  subscriptionStatus: string | null
): string {
  const workspace = (status || "").trim().toLowerCase();
  const sub = (subscriptionStatus || "").trim().toLowerCase();
  // Same value twice (e.g. active · active) is noise — show once.
  if (!sub || sub === "none" || sub === workspace) return status;
  return `${status} · ${sub.replace(/_/g, " ")}`;
}

/**
 * FECSYNC storefront-only: approve, suspend, clear offboard, or
 * emergency Set plan for registered companies.
 * Approve unlocks /admin. Set plan stamps Demo|Starter|Growth|Enterprise
 * without altering company records. Suspend revokes operational access.
 */
export default function RegisteredCompaniesPage() {
  const { addToast } = useToast();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get("status");
  const initialStatus: StatusFilter =
    statusFromUrl === "pending" ||
    statusFromUrl === "active" ||
    statusFromUrl === "suspended" ||
    statusFromUrl === "offboard" ||
    statusFromUrl === "all"
      ? statusFromUrl
      : "all";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [planById, setPlanById] = useState<Record<string, string>>({});
  const [durationById, setDurationById] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  /** Defer secondary panel so the companies table owns first paint. */
  const [showSuspendPanel, setShowSuspendPanel] = useState(false);
  const [createForm, setCreateForm] = useState({
    companyName: "",
    slug: "",
    adminEmail: "",
    adminPassword: "",
    adminFullName: "",
    subscriptionPlan: "starter",
    durationMonths: DEFAULT_BILLING_DURATION_MONTHS as number,
    activate: true,
  });
  /** When true, stop syncing slug from company name (user typed their own). */
  const [slugManual, setSlugManual] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  /** Sync lock so double-clicks cannot fire two creates before React re-renders. */
  const createInFlightRef = useRef(false);
  /** Escape hatch when the list request hangs — stop infinite skeleton. */
  const [loadStuck, setLoadStuck] = useState(false);
  const [viewCompany, setViewCompany] = useState<CompanyRow | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const raw = searchParams.get("status");
    if (
      raw === "pending" ||
      raw === "active" ||
      raw === "suspended" ||
      raw === "offboard" ||
      raw === "all"
    ) {
      setStatusFilter((prev) => (prev === raw ? prev : raw));
    }
  }, [searchParams]);

  useEffect(() => {
    const t = window.setTimeout(() => setShowSuspendPanel(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  const setFilter = (next: StatusFilter) => {
    setStatusFilter(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const storefrontOnly = isStorefrontOrgSession(user);
  const platformAdminOnly = isPlatformAdminActor(user);
  const canManageCompanies = storefrontOnly && platformAdminOnly;

  const companiesKey = registeredCompaniesKeys.list(statusFilter);
  const companiesQ = useInfiniteQuery({
    queryKey: companiesKey,
    queryFn: ({ pageParam }) =>
      listRegisteredCompaniesClient(statusFilter, {
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.hasMore && last.nextCursor ? last.nextCursor : undefined,
    enabled: canManageCompanies,
    ...adminListQueryDefaults,
    // Soft-refresh when snapshot is stale; do not block first paint on network.
    refetchOnMount: true,
    ...withAdminListSnapshot(companiesKey),
    placeholderData: (previous) => previous,
    meta: { suppressErrorBanner: true },
    retry: (failureCount, error) => {
      if (isTransientApiError(error) && failureCount < 1) return true;
      return false;
    },
  });

  const companies =
    companiesQ.data?.pages.flatMap((page) => page.companies) ?? [];
  const loading = isAdminListBlockingLoad(
    companiesQ.isPending,
    companies.length
  );
  const refreshing =
    companiesQ.isFetching && !loading && companies.length > 0;
  const loadError =
    companiesQ.error instanceof Error
      ? companiesQ.error.message
      : companiesQ.isError
        ? "Failed to load companies"
        : null;
  const loadErrorIsTimeout =
    Boolean(loadError) &&
    /timed out|timeout/i.test(loadError || "");

  useEffect(() => {
    if (!loading) {
      setLoadStuck(false);
      return;
    }
    const t = window.setTimeout(() => setLoadStuck(true), 12_000);
    return () => window.clearTimeout(t);
  }, [loading, companiesKey]);

  useEffect(() => {
    // Timeouts are transient under Turbopack/DB cold start — keep retrying quietly.
    if (!loadError || loadErrorIsTimeout) {
      if (companiesQ.isSuccess || loadErrorIsTimeout) setError(null);
      return;
    }
    setError(loadError);
  }, [loadError, loadErrorIsTimeout, companiesQ.isSuccess]);

  // Persist first page so the next visit paints rows before the network returns.
  useEffect(() => {
    if (!companiesQ.isSuccess || !companiesQ.data || !user?.orgId) return;
    writeAdminListSnapshot(user.orgId, companiesKey, companiesQ.data);
  }, [companiesQ.isSuccess, companiesQ.data, user?.orgId, companiesKey]);

  useEffect(() => {
    if (!companies.length) return;
    setPlanById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const row of companies) {
        if (next[row.id]) continue;
        const current = row.subscriptionPlan?.trim().toLowerCase() || "";
        if (
          current &&
          ORG_SUBSCRIPTION_PLANS.includes(
            current as (typeof ORG_SUBSCRIPTION_PLANS)[number]
          )
        ) {
          next[row.id] = current;
          changed = true;
          continue;
        }
        const interest = row.requestedPlan?.trim().toLowerCase() || "";
        if (
          interest &&
          ORG_SUBSCRIPTION_PLANS.includes(
            interest as (typeof ORG_SUBSCRIPTION_PLANS)[number]
          )
        ) {
          next[row.id] = interest;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setDurationById((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const row of companies) {
        if (next[row.id] != null) continue;
        next[row.id] = resolveBillingDurationMonthsInterest({
          requestedDurationMonths: row.requestedDurationMonths,
          subscriptionInterval: row.subscriptionInterval,
        });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [companies]);

  const reload = async (filter: StatusFilter = statusFilter) => {
    await queryClient.invalidateQueries({
      queryKey: registeredCompaniesKeys.all,
    });
    if (filter !== statusFilter) {
      await queryClient.fetchInfiniteQuery({
        queryKey: registeredCompaniesKeys.list(filter),
        queryFn: ({ pageParam }) =>
          listRegisteredCompaniesClient(filter, { cursor: pageParam }),
        initialPageParam: null as string | null,
        staleTime: ADMIN_LIST_STALE_MS,
      });
    }
  };

  const patch = async (
    orgId: string,
    action: "approve" | "suspend" | "clear_offboard" | "set_plan",
    subscriptionPlan?: string
  ) => {
    if (busyId) return;
    if (action === "set_plan" && !subscriptionPlan?.trim()) {
      addToast("Choose a plan before Set plan", "error");
      return;
    }
    setBusyId(orgId);
    setError(null);
    try {
      const durationMonths =
        durationById[orgId] ?? DEFAULT_BILLING_DURATION_MONTHS;
      const raw = await api<
        MaybeWrapped<{
          company: {
            id: string;
            status: string;
            subscriptionPlan: string | null;
          };
        }>
      >("/api/admin/registered-companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          action,
          ...(subscriptionPlan ? { subscriptionPlan } : {}),
          ...((action === "approve" || action === "set_plan") &&
          subscriptionPlan &&
          subscriptionPlan !== "demo"
            ? { durationMonths }
            : {}),
        }),
      });
      const data = unwrap(raw);
      const nextStatus = data?.company?.status;

      if (action === "approve") {
        addToast(
          nextStatus === "active"
            ? `Approved${
                data?.company?.subscriptionPlan
                  ? ` · ${data.company.subscriptionPlan} ops grant`
                  : " · creates stay locked until Billing Checkout"
              }`
            : "Approve completed",
          "success"
        );
        // Leave Pending filter so ops see the active row (approve was easy to miss).
        setFilter("active");
        await reload("active");
      } else if (action === "set_plan") {
        addToast(
          `Plan set to ${data?.company?.subscriptionPlan || subscriptionPlan} — company records unchanged`,
          "success"
        );
        setFilter("active");
        await reload("active");
      } else if (action === "suspend") {
        addToast("Company suspended", "success");
        await reload();
      } else {
        addToast("Offboard request cleared", "success");
        await reload();
      }
      void queryClient.invalidateQueries({
        queryKey: ["registered-companies-metrics"],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      setError(message);
      addToast(message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const createCompany = async () => {
    if (createBusy || createInFlightRef.current) return;
    if (!createForm.companyName.trim() || !createForm.adminEmail.trim()) {
      addToast("Company name and admin email are required", "error");
      return;
    }
    if (!createForm.subscriptionPlan.trim()) {
      addToast("Choose a plan", "error");
      return;
    }
    createInFlightRef.current = true;
    setCreateBusy(true);
    setError(null);
    try {
      const raw = await api<
        MaybeWrapped<{
          company: {
            id: string;
            status: string;
            subscriptionPlan: string | null;
            name: string;
            slug: string;
            adminEmail: string;
            createdAdminUser: boolean;
            activated: boolean;
          };
        }>
      >("/api/admin/registered-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: createForm.companyName.trim(),
          slug: createForm.slug.trim() || undefined,
          adminEmail: createForm.adminEmail.trim(),
          adminPassword: createForm.adminPassword || undefined,
          adminFullName: createForm.adminFullName.trim() || undefined,
          subscriptionPlan: createForm.subscriptionPlan,
          durationMonths:
            createForm.subscriptionPlan === "demo"
              ? 1
              : createForm.durationMonths,
          activate: createForm.activate,
        }),
      });
      const data = unwrap(raw);
      const c = data?.company;
      const slugNote = c?.slug ? ` · slug ${c.slug}` : "";
      addToast(
        c?.activated
          ? `Created and activated ${c.name} (${c.subscriptionPlan || "plan"})${slugNote}`
          : `Created pending workspace ${c?.name || ""}${slugNote}`,
        "success"
      );
      setCreateForm({
        companyName: "",
        slug: "",
        adminEmail: "",
        adminPassword: "",
        adminFullName: "",
        subscriptionPlan: "starter",
        durationMonths: DEFAULT_BILLING_DURATION_MONTHS,
        activate: true,
      });
      setSlugManual(false);
      setShowAdminPassword(false);
      setCreateOpen(false);
      setCreateBusy(false);
      createInFlightRef.current = false;
      if (c?.activated) setFilter("active");
      else setFilter("pending");
      // Refresh list in the background — do not hold the submit button on SMTP/list.
      void reload(c?.activated ? "active" : "pending");
      void queryClient.invalidateQueries({
        queryKey: ["registered-companies-metrics"],
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create company";
      setError(message);
      addToast(message, "error");
      setCreateBusy(false);
      createInFlightRef.current = false;
    }
  };

  if (!canManageCompanies) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-8 text-sm text-stone-600">
        Company approvals are only available to FECSYNC storefront platform
        admins.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Company workspaces
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Approve tenants, stamp plans, and soft-lock accounts. Open the guide
            if you are doing this for the first time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          <button
            type="button"
            onClick={() => setCreateOpen((o) => !o)}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#D4AF37] px-3.5 text-sm font-semibold text-stone-900 hover:bg-[#c4a030]"
          >
            {createOpen ? "Close" : "Create company"}
          </button>
        </div>
      </header>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Company workspaces"
        subtitle="Follow these steps in order — written for FECSYNC storefront ops."
        steps={REGISTERED_COMPANIES_GUIDE_STEPS}
      />

      {createOpen ? (
        <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Create company (skip public registration / Checkout)
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Provisions a workspace + company admin. With Activate on, stamps
              the plan and unlocks /admin the same way as Approve + Set plan.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-stone-600">
              Company name
              <input
                value={createForm.companyName}
                onChange={(e) => {
                  const companyName = e.target.value;
                  setCreateForm((f) => ({
                    ...f,
                    companyName,
                    slug: slugManual ? f.slug : previewOrgSlug(companyName),
                  }));
                }}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                placeholder="Acme Parks Ltd"
                disabled={createBusy}
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Slug (auto-filled — editable)
              <input
                value={createForm.slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setCreateForm((f) => ({ ...f, slug: e.target.value }));
                }}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                placeholder="acme-parks"
                disabled={createBusy}
              />
              <span className="mt-1 block text-[11px] font-normal text-stone-500">
                Fills from the company name as you type. Edit freely, or clear
                it to let the server pick one. Collisions get -2, -3, …. Company
                admins can rename it later under Company Profile.
              </span>
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Admin email
              <input
                type="email"
                value={createForm.adminEmail}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, adminEmail: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                placeholder="admin@company.com"
                disabled={createBusy}
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Admin password (new users)
              <div className="relative mt-1">
                <input
                  type={showAdminPassword ? "text" : "password"}
                  value={createForm.adminPassword}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      adminPassword: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 pr-10 text-sm text-stone-900"
                  placeholder="Min 8 characters"
                  disabled={createBusy}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword((v) => !v)}
                  disabled={createBusy}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700 disabled:opacity-50"
                  aria-label={
                    showAdminPassword ? "Hide password" : "Show password"
                  }
                >
                  {showAdminPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Admin full name (optional)
              <input
                value={createForm.adminFullName}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    adminFullName: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                disabled={createBusy}
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Plan
              <select
                value={createForm.subscriptionPlan}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    subscriptionPlan: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                disabled={createBusy}
              >
                {ORG_SUBSCRIPTION_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {getSubscriptionPlan(p)?.name || p}
                  </option>
                ))}
              </select>
            </label>
            {createForm.subscriptionPlan !== "demo" ? (
              <label className="block text-xs font-medium text-stone-600">
                Grant length
                <select
                  value={createForm.durationMonths}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      durationMonths: Number(e.target.value) || 1,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900"
                  disabled={createBusy}
                >
                  {BILLING_DURATION_OPTIONS.map((d) => (
                    <option key={d.months} value={d.months}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={createForm.activate}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, activate: e.target.checked }))
              }
              disabled={createBusy}
            />
            Activate now (Approve + plan stamp — no Checkout)
          </label>
          <button
            type="button"
            disabled={createBusy}
            onClick={() => void createCompany()}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {createBusy ? "Creating…" : "Create company"}
          </button>
        </section>
      ) : null}

      {showSuspendPanel ? <PlatformAccountSuspendPanel /> : null}

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Filter workspaces"
      >
        {FILTERS.map((f) => {
          const active = statusFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.id)}
              className={`cursor-pointer rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 ${
                active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {loadErrorIsTimeout && companies.length === 0 && !loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Still connecting to the database —{" "}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => void companiesQ.refetch()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {refreshing ? (
        <p className="text-xs text-stone-400" aria-live="polite">
          Updating…
        </p>
      ) : null}

      {loading && !loadStuck ? (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-100 bg-stone-50/80 px-4 py-3.5">
            <div className="h-3 w-40 animate-pulse rounded bg-stone-200" />
          </div>
          <div className="divide-y divide-stone-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-4"
                aria-hidden
              >
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-stone-100" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-48 max-w-full animate-pulse rounded bg-stone-100" />
                  <div className="h-3 w-28 max-w-full animate-pulse rounded bg-stone-50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading && loadStuck ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-10 text-center text-sm text-amber-950">
          <p>This is taking longer than usual (dev compile or database).</p>
          <button
            type="button"
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800"
            onClick={() => {
              setLoadStuck(false);
              void companiesQ.refetch();
            }}
          >
            Retry now
          </button>
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white px-5 py-12 text-center text-sm text-stone-500">
          No companies in this filter.
        </div>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {companies.map((c, index) => (
              <li
                key={c.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <CompanyCard
                  serial={index + 1}
                  company={c}
                  planValue={planById[c.id] || ""}
                  durationValue={
                    durationById[c.id] ?? DEFAULT_BILLING_DURATION_MONTHS
                  }
                  busy={busyId === c.id}
                  onPlanChange={(value) =>
                    setPlanById((prev) => ({ ...prev, [c.id]: value }))
                  }
                  onDurationChange={(value) =>
                    setDurationById((prev) => ({ ...prev, [c.id]: value }))
                  }
                  onView={() => setViewCompany(c)}
                  onApprove={() =>
                    void patch(c.id, "approve", planById[c.id])
                  }
                  onSetPlan={() =>
                    void patch(c.id, "set_plan", planById[c.id])
                  }
                  onSuspend={() => void patch(c.id, "suspend")}
                  onClearOffboard={() => void patch(c.id, "clear_offboard")}
                />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/80 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <th className="w-12 px-4 py-3.5 font-semibold">#</th>
                    <th className="px-4 py-3.5 font-semibold">Company</th>
                    <th className="px-4 py-3.5 font-semibold">Status</th>
                    <th className="px-4 py-3.5 font-semibold">Plan</th>
                    <th className="px-4 py-3.5 font-semibold">Term</th>
                    <th className="px-4 py-3.5 font-semibold">Ends</th>
                    <th className="px-4 py-3.5 font-semibold">Stripe</th>
                    <th className="px-4 py-3.5 font-semibold">Seats</th>
                    <th className="px-4 py-3.5 font-semibold">Venues</th>
                    <th className="px-4 py-3.5 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {companies.map((c, index) => {
                    const busy = busyId === c.id;
                    const canApprove = c.status !== "active";
                    const canSuspend =
                      c.status !== "suspended" ||
                      Boolean(c.billingSoftHold) ||
                      (c.subscriptionStatus || "").trim().toLowerCase() ===
                        "expired";
                    return (
                      <tr
                        key={c.id}
                        className="align-middle transition-colors hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-4 tabular-nums text-stone-500">
                          {index + 1}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <CompanyLogoThumb
                              name={c.name}
                              logoUrl={c.logoUrl}
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-stone-900">
                                {c.name}
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-stone-500">
                                {c.slug}
                              </div>
                              <CompanyLoginUrlText slug={c.slug} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <StatusCell company={c} />
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-1.5">
                            {c.status === "active" && c.subscriptionPlan ? (
                              <p className="text-xs text-stone-500">
                                Current:{" "}
                                <span className="font-medium capitalize text-stone-800">
                                  {c.subscriptionPlan}
                                </span>
                              </p>
                            ) : null}
                            {c.requestedPlan ? (
                              <p className="text-xs text-stone-500">
                                Interest:{" "}
                                <span className="font-medium capitalize text-stone-800">
                                  {c.requestedPlan}
                                </span>
                              </p>
                            ) : null}
                            <PlanSelect
                              value={planById[c.id] || ""}
                              disabled={busy}
                              onChange={(value) =>
                                setPlanById((prev) => ({
                                  ...prev,
                                  [c.id]: value,
                                }))
                              }
                            />
                            {(planById[c.id] || "") !== "demo" &&
                            (planById[c.id] || "").trim() ? (
                              <DurationSelect
                                value={
                                  durationById[c.id] ??
                                  DEFAULT_BILLING_DURATION_MONTHS
                                }
                                disabled={busy}
                                onChange={(value) =>
                                  setDurationById((prev) => ({
                                    ...prev,
                                    [c.id]: value,
                                  }))
                                }
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-stone-600">
                          {companyTermLabel(c) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-stone-600">
                          {c.subscriptionEndsAt
                            ? new Date(
                                c.subscriptionEndsAt
                              ).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-4 text-stone-600">
                          {c.hasStripeCustomer ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-800">
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                                aria-hidden
                              />
                              Linked
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-4 tabular-nums text-stone-700">
                          {c.memberCount}
                        </td>
                        <td className="px-4 py-4 text-stone-700">
                          <div className="tabular-nums">
                            {typeof c.venuesActive === "number"
                              ? c.venuesActive
                              : "—"}
                          </div>
                          <HqEligibilityBadge company={c} />
                        </td>
                        <td className="px-4 py-4">
                          <ActionButtons
                            companyId={c.id}
                            slug={c.slug}
                            companyName={c.name}
                            canApprove={canApprove}
                            canSetPlan={Boolean(planById[c.id]?.trim())}
                            canSuspend={canSuspend}
                            hasOffboard={Boolean(c.offboardRequestedAt)}
                            isSuspended={c.status === "suspended"}
                            busy={busy}
                            onView={() => setViewCompany(c)}
                            onApprove={() =>
                              void patch(c.id, "approve", planById[c.id])
                            }
                            onSetPlan={() =>
                              void patch(c.id, "set_plan", planById[c.id])
                            }
                            onSuspend={() => void patch(c.id, "suspend")}
                            onClearOffboard={() =>
                              void patch(c.id, "clear_offboard")
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {companies.length > 0 && companiesQ.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void companiesQ.fetchNextPage()}
            disabled={companiesQ.isFetchingNextPage}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {companiesQ.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}

      {viewCompany ? (
        <RegisteredCompanyDetailModal
          company={viewCompany}
          onClose={() => setViewCompany(null)}
        />
      ) : null}
    </div>
  );
}

function StatusCell({ company: c }: { company: CompanyRow }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span
        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${statusBadgeClass(
          c.status,
          c.billingSoftHold
        )}`}
      >
        {formatStatusLabel(c.status, c.subscriptionStatus)}
      </span>
      {c.billingSoftHold ? (
        <span
          className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950"
          title="DB may still be active; Fresh soft-denies until Approve or emergency Set plan."
        >
          Soft-hold
        </span>
      ) : null}
      {c.offboardRequestedAt ? (
        <span
          className="inline-flex rounded-md bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-800"
          title={`Offboard requested ${new Date(c.offboardRequestedAt).toLocaleString()}. Soft request only — no hard-delete.`}
        >
          Offboard req
        </span>
      ) : null}
    </div>
  );
}

function PlanSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="w-full min-w-[10.5rem] max-w-[14rem] cursor-pointer rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm text-stone-800 shadow-sm transition-colors hover:border-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/35 disabled:cursor-not-allowed disabled:opacity-60"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Plan for approve or emergency set"
    >
      <option value="">Select plan…</option>
      {ORG_SUBSCRIPTION_PLANS.map((p) => (
        <option key={p} value={p}>
          {p === "demo"
            ? "Demo (1-month trial)"
            : getSubscriptionPlan(p)?.name ?? p}
        </option>
      ))}
    </select>
  );
}

function DurationSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <select
      className="w-full min-w-[8rem] max-w-[14rem] cursor-pointer rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm text-stone-800 shadow-sm transition-colors hover:border-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/35 disabled:cursor-not-allowed disabled:opacity-60"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value) || 1)}
      aria-label="Ops grant length"
    >
      {BILLING_DURATION_OPTIONS.map((d) => (
        <option key={d.months} value={d.months}>
          {d.label}
        </option>
      ))}
    </select>
  );
}

/** The company's staff sign-in link, shown so ops can read it out or spot-check it. */
function CompanyLoginUrlText({ slug }: { slug: string }) {
  const url = useCompanyLoginUrl(slug);
  if (!url) return null;
  const display = url.replace(/^https?:\/\//, "");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Staff login link: ${url}`}
      className="mt-0.5 block max-w-[16rem] truncate text-xs text-sky-700 hover:underline"
    >
      {display}
    </a>
  );
}

const LOGIN_LINK_CHECK_TIMEOUT_MS = 8_000;

function loginUrlForSlug(slug: string): string {
  const { protocol, port } = window.location;
  return companyLoginUrl(slug, browserPublicOrigin(), { protocol, port });
}

/**
 * Copies a company's staff sign-in link on click (clipboard writes must happen
 * inside the click), then re-reads the company: the list is cached for minutes
 * and a renamed slug would make the copied link dead.
 */
function CopyLoginLinkButton({ companyId, slug, companyName }: {
  companyId: string;
  slug: string;
  companyName: string;
}) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    },
    []
  );

  const flashCopied = () => {
    setCopied(true);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const confirmSlug = async () => {
    let freshSlug: string;
    let timer: number | undefined;
    try {
      const fresh = await Promise.race([
        queryClient.fetchQuery({
          queryKey: registeredCompaniesKeys.detail(companyId),
          queryFn: () => getRegisteredCompanyClient(companyId),
          staleTime: 0,
          retry: false,
        }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("timeout")), LOGIN_LINK_CHECK_TIMEOUT_MS);
        }),
      ]);
      freshSlug = fresh.slug;
    } catch {
      return;
    } finally {
      window.clearTimeout(timer);
    }
    if (!freshSlug || freshSlug === slug) return;
    void queryClient.invalidateQueries({
      queryKey: [...registeredCompaniesKeys.all, "list"],
    });
    const freshUrl = loginUrlForSlug(freshSlug);
    if (await copyToClipboard(freshUrl)) {
      addToast(`${companyName} changed its login link — the new link is now copied.`, "success");
    } else {
      addToast(
        `${companyName} changed its login link to ${freshUrl}. Click "Copy login link" again.`,
        "error"
      );
    }
  };

  const copy = async () => {
    const url = loginUrlForSlug(slug);
    if (await copyToClipboard(url)) {
      flashCopied();
      addToast(`Login link for ${companyName} copied.`, "success");
    } else {
      window.prompt(`Copy ${companyName}'s login link`, url);
    }
    void confirmSlug();
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : "Copy login link"}
    </button>
  );
}

function ActionButtons({
  companyId,
  slug,
  companyName,
  canApprove,
  canSetPlan,
  canSuspend,
  hasOffboard,
  isSuspended,
  busy,
  onView,
  onApprove,
  onSetPlan,
  onSuspend,
  onClearOffboard,
}: {
  companyId: string;
  slug: string;
  companyName: string;
  canApprove: boolean;
  canSetPlan: boolean;
  canSuspend: boolean;
  hasOffboard: boolean;
  isSuspended: boolean;
  busy: boolean;
  onView: () => void;
  onApprove: () => void;
  onSetPlan: () => void;
  onSuspend: () => void;
  onClearOffboard: () => void;
}) {
  return (
    <div className="flex flex-col items-stretch justify-end gap-2 sm:items-end">
      <button
        type="button"
        disabled={busy}
        onClick={onView}
        className="inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        View
      </button>
      <CopyLoginLinkButton companyId={companyId} slug={slug} companyName={companyName} />
      {canApprove ? (
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg bg-[#D4AF37] px-3.5 text-xs font-semibold text-stone-900 shadow-sm transition hover:bg-[#c4a030] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : isSuspended ? "Reactivate" : "Approve"}
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy || !canSetPlan}
        onClick={onSetPlan}
        title="Emergency: stamp plan only — company records are never deleted or rewritten"
        className="inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-[#D4AF37]/60 bg-[#D4AF37]/10 px-3 text-xs font-semibold text-stone-900 shadow-sm transition hover:bg-[#D4AF37]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Working…" : "Set plan"}
      </button>
      {hasOffboard ? (
        <button
          type="button"
          disabled={busy}
          title="Dismiss soft offboard request (no status change)"
          onClick={onClearOffboard}
          className="inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear offboard
        </button>
      ) : null}
      {canSuspend ? (
        <button
          type="button"
          disabled={busy}
          onClick={onSuspend}
          className="inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suspend
        </button>
      ) : null}
    </div>
  );
}

function HqEligibilityBadge({ company }: { company: CompanyRow }) {
  if (company.enterpriseHqEligible) {
    return (
      <span
        className="mt-1 inline-flex rounded-md bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-800"
        title="Entitled Enterprise — tenant HQ control plane (venue switcher + cross-park dashboard) at their /admin/hq. Ops do not browse tenant HQ data here; use contact-sales + Approve / Set plan."
      >
        HQ console available
      </span>
    );
  }
  const plan = (company.subscriptionPlan || "").trim().toLowerCase();
  if (plan === "enterprise") {
    return (
      <span
        className="mt-1 inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200"
        title="Plan stamped enterprise but not entitled yet (pending, soft-hold, expired, or suspended). Approve / Set plan / renew / clear hold to unlock HQ."
      >
        HQ locked
      </span>
    );
  }
  return null;
}

function CompanyCard({
  serial,
  company: c,
  planValue,
  durationValue,
  busy,
  onPlanChange,
  onDurationChange,
  onView,
  onApprove,
  onSetPlan,
  onSuspend,
  onClearOffboard,
}: {
  serial: number;
  company: CompanyRow;
  planValue: string;
  durationValue: number;
  busy: boolean;
  onPlanChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onView: () => void;
  onApprove: () => void;
  onSetPlan: () => void;
  onSuspend: () => void;
  onClearOffboard: () => void;
}) {
  const canApprove = c.status !== "active";
  const canSuspend =
    c.status !== "suspended" ||
    Boolean(c.billingSoftHold) ||
    (c.subscriptionStatus || "").trim().toLowerCase() === "expired";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CompanyLogoThumb name={c.name} logoUrl={c.logoUrl} size={40} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-stone-900">
              <span className="mr-2 tabular-nums text-stone-400">{serial}.</span>
              {c.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-stone-500">
              {c.slug}
            </p>
            <CompanyLoginUrlText slug={c.slug} />
          </div>
        </div>
        <StatusCell company={c} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Ends
          </dt>
          <dd className="mt-0.5 text-stone-800">
            {c.subscriptionEndsAt
              ? new Date(c.subscriptionEndsAt).toLocaleDateString()
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Term
          </dt>
          <dd className="mt-0.5 text-stone-800">
            {companyTermLabel(c) || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Stripe
          </dt>
          <dd className="mt-0.5 text-stone-800">
            {c.hasStripeCustomer ? "Linked" : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Seats
          </dt>
          <dd className="mt-0.5 tabular-nums text-stone-800">
            {c.memberCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Plan
          </dt>
          <dd className="mt-0.5 capitalize text-stone-800">
            {c.subscriptionPlan ||
              (c.requestedPlan ? `Interest: ${c.requestedPlan}` : "—")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Venues
          </dt>
          <dd className="mt-0.5 tabular-nums text-stone-800">
            {typeof c.venuesActive === "number" ? c.venuesActive : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
            HQ
          </dt>
          <dd className="mt-0.5 text-stone-800">
            <HqEligibilityBadge company={c} />
            {!c.enterpriseHqEligible &&
            (c.subscriptionPlan || "").trim().toLowerCase() !== "enterprise" ? (
              <span className="text-xs text-stone-500">—</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <PlanSelect
        value={planValue}
        disabled={busy}
        onChange={onPlanChange}
      />
      {planValue !== "demo" && planValue.trim() ? (
        <DurationSelect
          value={durationValue}
          disabled={busy}
          onChange={onDurationChange}
        />
      ) : null}

      <ActionButtons
        companyId={c.id}
        slug={c.slug}
        companyName={c.name}
        canApprove={canApprove}
        canSetPlan={Boolean(planValue.trim())}
        canSuspend={canSuspend}
        hasOffboard={Boolean(c.offboardRequestedAt)}
        isSuspended={c.status === "suspended"}
        busy={busy}
        onView={onView}
        onApprove={onApprove}
        onSetPlan={onSetPlan}
        onSuspend={onSuspend}
        onClearOffboard={onClearOffboard}
      />
    </div>
  );
}
