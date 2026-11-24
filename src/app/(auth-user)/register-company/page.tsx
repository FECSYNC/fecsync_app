"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import FecSyncBrandLogo from "@/components/brand/FecSyncBrandLogo";
import { useAuthStore } from "@/store/authStore";
import { releaseIdleLogoutLatch, touchAdminLastActivity } from "@/lib/adminIdleTimeout";
import { getMe, normalizeSessionUser, isStorefrontOrgSession } from "@/services/auth";
import {
  isStaffPreset,
  isRolePresetId,
  isTailorProviderPreset,
} from "@/lib/auth/permissions";
import { isPlatformSoftwareOwner } from "@/lib/platformSoftwareOwner";
import { isSubscriptionPlanId, ORG_SUBSCRIPTION_PLANS, getSubscriptionPlan, BILLING_DURATION_OPTIONS, DEFAULT_BILLING_DURATION_MONTHS, computePlanTermTotalMajor, billingDurationLabel, normalizeBillingDurationMonths, formatPlanMonthlyDisplayPrice } from "@/lib/subscriptionPlans";
import { writeCompanyPlanHint } from "@/utils/companyPlanHint";
import CompanyAccountStatusPanel, {
  companyAccountSnapshotFromUser,
  type CompanyAccountSnapshot,
} from "@/components/billing/CompanyAccountStatusPanel";

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type FormState = {
  companyName: string;
  slug: string;
  fullName: string;
  email: string;
  password: string;
};

type ProbeState = "loading" | "public" | "session" | "blocked";

function RegisterCompanyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planHintRaw = searchParams.get("plan")?.trim().toLowerCase() ?? "";
  const urlPlanHint = isSubscriptionPlanId(planHintRaw) ? planHintRaw : null;
  const urlDuration = normalizeBillingDurationMonths(
    searchParams.get("months") ?? searchParams.get("duration")
  );
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState<FormState>({
    companyName: "",
    slug: "",
    fullName: "",
    email: "",
    password: "",
  });
  const [selectedPlan, setSelectedPlan] = useState<string>(urlPlanHint ?? "");
  const [durationMonths, setDurationMonths] = useState(urlDuration);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [probe, setProbe] = useState<ProbeState>("loading");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [companyStatus, setCompanyStatus] =
    useState<CompanyAccountSnapshot | null>(null);
  const submittingRef = useRef(false);

  // Pricing CTAs pass ?plan=demo|starter|growth|enterprise → pre-select that package.
  // Plain /register-company (Sign up) starts with an empty required dropdown.
  useEffect(() => {
    if (urlPlanHint) {
      writeCompanyPlanHint(urlPlanHint);
      setSelectedPlan(urlPlanHint);
      return;
    }
    setSelectedPlan("");
  }, [urlPlanHint]);

  useEffect(() => {
    setDurationMonths(urlDuration);
  }, [urlDuration]);

  useEffect(() => {
    const err = searchParams.get("error")?.trim();
    if (err === "UseCompanyRegistration") {
      setError(
        "Google sign-in is only for existing accounts. Register your company workspace below and choose a package."
      );
    }
  }, [searchParams]);

  const planHint = isSubscriptionPlanId(selectedPlan) ? selectedPlan : null;
  const planFromPricing = Boolean(urlPlanHint);
  const effectiveDuration =
    planHint === "demo" ? 1 : normalizeBillingDurationMonths(durationMonths);
  const termTotal =
    planHint && planHint !== "demo"
      ? computePlanTermTotalMajor(planHint, effectiveDuration)
      : null;

  function syncRegisterQuery(nextPlan: string, nextMonths: number) {
    const q = new URLSearchParams();
    if (isSubscriptionPlanId(nextPlan)) {
      q.set("plan", nextPlan);
      writeCompanyPlanHint(nextPlan);
    }
    if (
      isSubscriptionPlanId(nextPlan) &&
      nextPlan !== "demo" &&
      nextMonths !== DEFAULT_BILLING_DURATION_MONTHS
    ) {
      q.set("months", String(nextMonths));
    }
    const qs = q.toString();
    router.replace(qs ? `/register-company?${qs}` : "/register-company", {
      scroll: false,
    });
  }

  function onPlanChange(next: string) {
    setSelectedPlan(next);
    syncRegisterQuery(next, effectiveDuration);
  }

  function onDurationChange(next: number) {
    const months = normalizeBillingDurationMonths(next);
    setDurationMonths(months);
    syncRegisterQuery(selectedPlan, months);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { user, memberships } = await getMe({ force: true });
        if (cancelled || !user) {
          if (!cancelled) setProbe("public");
          return;
        }
        const preset =
          typeof user.preset === "string" && isRolePresetId(user.preset)
            ? user.preset
            : null;
        if (preset && isStaffPreset(preset)) {
          if (cancelled) return;
          if (urlPlanHint) writeCompanyPlanHint(urlPlanHint);
          setProbe("blocked");

          // FECSYNC super admin / storefront ops — no company subscription status UI.
          if (isPlatformSoftwareOwner(user) || isStorefrontOrgSession(user)) {
            setCompanyStatus(null);
            setError(
              "You are signed in as a platform operator. Sign out to register a new company workspace, or open Admin."
            );
            router.replace("/admin");
            return;
          }

          // Registered company admin only — live plan / pending status.
          setCompanyStatus(companyAccountSnapshotFromUser(user));
          setError(null);
          return;
        }
        if (isTailorProviderPreset(user.preset, user.membershipRole)) {
          if (!cancelled) {
            setProbe("blocked");
            setError(
              "Tailor studio accounts cannot register a company from this session. Sign out and use a separate email, or contact support."
            );
          }
          return;
        }
        // Match API / createOrganizationWithPlatformAdmin: any Membership row
        // (invited/suspended/revoked/active) blocks — not only JWT orgId+preset.
        if (Array.isArray(memberships) && memberships.length > 0) {
          if (!cancelled) {
            setProbe("blocked");
            setError(
              "You already have an organization membership. Company registration is for accounts without an existing org role."
            );
          }
          return;
        }
        if (!cancelled) {
          setSessionEmail(user.email || null);
          setProbe("session");
        }
      } catch {
        if (!cancelled) setProbe("public");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, urlPlanHint, urlDuration]);

  function onCompanyNameChange(value: string) {
    setForm((prev) => ({
      ...prev,
      companyName: value,
      slug: slugTouched ? prev.slug : normalizeSlug(value) || prev.slug,
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (probe === "loading" || probe === "blocked") return;
    if (submittingRef.current || loading) return;
    if (!planHint) {
      setError("Select a subscription package to continue.");
      return;
    }
    submittingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const body =
        probe === "session"
          ? {
              companyName: form.companyName.trim(),
              slug: form.slug.trim(),
              plan: planHint,
              durationMonths: effectiveDuration,
            }
          : {
              companyName: form.companyName.trim(),
              slug: form.slug.trim(),
              fullName: form.fullName.trim(),
              email: form.email.trim().toLowerCase(),
              password: form.password,
              plan: planHint,
              durationMonths: effectiveDuration,
            };

      const res = await fetch("/api/auth/register-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        data?: {
          redirectTo?: string;
          checkoutUrl?: string | null;
          checkoutError?: string | null;
          profile?: {
            user?: {
              email?: string;
              firstName?: string;
              lastName?: string;
            };
            email?: string;
            fullName?: string;
            name?: string;
            picture?: string;
          };
          userId?: string;
          role?: string;
          permissions?: string[];
          orgId?: string | null;
          membershipRole?: string | null;
          preset?: string | null;
          companyWideView?: boolean;
          storefrontOrgId?: string | null;
          orgStatus?: string | null;
          organizationName?: string | null;
          companyDisplayName?: string | null;
          legalName?: string | null;
          tradingName?: string | null;
          profileCompleteness?: number | null;
          hasLogo?: boolean;
          subscriptionPlan?: string | null;
          subscriptionStatus?: string | null;
          subscriptionEndsAt?: string | null;
          billingSoftHold?: boolean;
          billingGraceEndsAt?: string | null;
          enterpriseHqEnabled?: boolean;
          organization?: {
            status?: string | null;
            name?: string | null;
            companyDisplayName?: string | null;
            legalName?: string | null;
            tradingName?: string | null;
            profileCompleteness?: number | null;
            hasLogo?: boolean;
            subscriptionPlan?: string | null;
            subscriptionStatus?: string | null;
            subscriptionEndsAt?: string | null;
            billingSoftHold?: boolean;
            billingGraceEndsAt?: string | null;
            enterpriseHqEnabled?: boolean;
          };
        };
      };
      if (!res.ok) {
        const msg =
          json.error || json.message || "Could not register company";
        setError(msg);
        return;
      }

      const data = json.data;
      if (data) {
        const nested = data.profile?.user;
        const email =
          nested?.email ||
          data.profile?.email ||
          form.email ||
          sessionEmail ||
          "";
        const fullName =
          [nested?.firstName, nested?.lastName].filter(Boolean).join(" ").trim() ||
          data.profile?.fullName ||
          data.profile?.name ||
          form.fullName ||
          undefined;
        const sessionUser = normalizeSessionUser({
          id: String(data.userId || ""),
          email,
          fullName,
          name: fullName,
          role: data.role || "admin",
          avatar: data.profile?.picture,
          permissions: data.permissions,
          orgId: data.orgId ?? null,
          membershipRole: data.membershipRole ?? null,
          preset: data.preset ?? null,
          companyWideView: data.companyWideView,
          storefrontOrgId: data.storefrontOrgId ?? null,
          orgStatus:
            data.orgStatus ?? data.organization?.status ?? "pending",
          organizationName:
            data.organizationName ?? data.organization?.name ?? null,
          companyDisplayName:
            data.companyDisplayName ??
            data.organization?.companyDisplayName ??
            null,
          legalName: data.legalName ?? data.organization?.legalName ?? null,
          tradingName:
            data.tradingName ?? data.organization?.tradingName ?? null,
          profileCompleteness:
            data.profileCompleteness ??
            data.organization?.profileCompleteness ??
            null,
          hasLogo:
            typeof data.hasLogo === "boolean"
              ? data.hasLogo
              : typeof data.organization?.hasLogo === "boolean"
                ? data.organization.hasLogo
                : undefined,
          subscriptionPlan:
            data.subscriptionPlan ??
            data.organization?.subscriptionPlan ??
            null,
          subscriptionStatus:
            data.subscriptionStatus ??
            data.organization?.subscriptionStatus ??
            null,
          subscriptionEndsAt:
            data.subscriptionEndsAt ??
            data.organization?.subscriptionEndsAt ??
            null,
          billingSoftHold:
            data.billingSoftHold === true ||
            data.organization?.billingSoftHold === true,
          billingGraceEndsAt:
            data.billingGraceEndsAt ??
            data.organization?.billingGraceEndsAt ??
            null,
          enterpriseHqEnabled:
            data.enterpriseHqEnabled === true ||
            data.organization?.enterpriseHqEnabled === true,
          accountSuspended: false,
        });
        // Seed store, then await forced /me so AdminLayout does not race a
        // second setUser after navigation.
        releaseIdleLogoutLatch();
        touchAdminLastActivity();
        setUser(sessionUser, "localStorage");
        // Persist ?plan= as a Billing UI hint only (never entitles creates).
        if (planHint) writeCompanyPlanHint(planHint);
        try {
          localStorage.setItem(
            "auth-snapshot",
            JSON.stringify({ user: sessionUser, isAuthenticated: true })
          );
        } catch {
          /* ignore quota */
        }
        try {
          const { user: meUser } = await getMe({ force: true });
          const mePreset =
            typeof meUser.preset === "string" && isRolePresetId(meUser.preset)
              ? meUser.preset
              : null;
          if (mePreset && isStaffPreset(mePreset)) {
            const merged = normalizeSessionUser({
              ...sessionUser,
              ...meUser,
              avatar: meUser.avatar || sessionUser.avatar,
            });
            setUser(merged, "localStorage");
            localStorage.setItem(
              "auth-snapshot",
              JSON.stringify({ user: merged, isAuthenticated: true })
            );
          }
        } catch {
          /* cookies already set; AdminLayout can hydrate */
        }
      }

      const checkoutUrl =
        typeof data?.checkoutUrl === "string" && data.checkoutUrl.startsWith("http")
          ? data.checkoutUrl
          : null;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
      if (data?.checkoutError) {
        const q = new URLSearchParams();
        q.set("payError", data.checkoutError.slice(0, 240));
        router.replace(`/company-pending?${q.toString()}`);
        router.refresh();
        return;
      }

      router.replace(data?.redirectTo || "/company-pending");
      router.refresh();
    } catch {
      setError("Could not register company. Please try again.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  const sessionMode = probe === "session";
  const formReady = probe === "public" || probe === "session";
  const planLabel = planHint
    ? planHint.charAt(0).toUpperCase() + planHint.slice(1)
    : null;

  return (
    <div className="flex min-h-screen bg-white">
      <div className="hidden lg:flex lg:flex-1 relative">
        <Image
          src="/venueflow/img/launch.jpg"
          alt="Venue company workspace"
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-black/30" />
        <div className="absolute bottom-8 left-8 text-white max-w-sm">
          <p className="text-lg font-semibold">Register your company workspace</p>
          <p className="text-sm text-white/80 mt-1">
            Create a FECSYNC company workspace for venue and attraction
            operators. This is not a guest shopping account — staff admin only.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-10 lg:px-8">
        <div className="w-full max-w-md space-y-6">
          <Link
            href="/home"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-[#D4AF37] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>

          <div className="flex justify-center">
            <FecSyncBrandLogo size="lg" variant="onLight" href="/home" />
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Register your company workspace
            </h1>
            <p className="text-sm text-gray-600">
              {probe === "loading"
                ? "Checking your session…"
                  : sessionMode
                  ? `Continue as ${sessionEmail || "your account"} — you become the company admin.`
                  : "For venue / attraction operators. You become the company admin. Invite teammates later from Users (pending invites expire after about 14 days)."}
            </p>
            {planLabel ? (
              <p className="mt-3 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-xs text-stone-700">
                {planFromPricing ? (
                  <>
                    Package from pricing: <strong>{planLabel}</strong> is
                    selected. You can change it in the dropdown below.
                  </>
                ) : (
                  <>
                    Selected package: <strong>{planLabel}</strong>.
                  </>
                )}{" "}
                After you register, Starter/Growth go to Stripe Checkout to
                activate. Enterprise waits for FECSYNC sales /
                approval — entitled Enterprise then unlocks the HQ multi-venue
                control plane (venue switcher + cross-park dashboard). Nothing
                is charged until Checkout completes.
              </p>
            ) : (
              <p className="mt-3 text-xs text-stone-500">
                Select a subscription package below to continue. Starter and
                Growth pay in Checkout right after registration; Enterprise uses
                contact sales / FECSYNC approval (HQ control plane
                unlocks after entitlement).
              </p>
            )}
          </div>

          {probe === "blocked" && companyStatus ? (
            <CompanyAccountStatusPanel
              initial={companyStatus}
              continueLabel={
                companyStatus.orgStatus === "pending"
                  ? "Open waiting room"
                  : urlPlanHint
                    ? "Open Billing to upgrade"
                    : "Go to dashboard"
              }
              onContinue={() => {
                if (companyStatus.orgStatus === "pending") {
                  router.replace("/company-pending");
                  return;
                }
                const billingQs = new URLSearchParams();
                if (urlPlanHint) billingQs.set("plan", urlPlanHint);
                if (
                  urlPlanHint &&
                  urlPlanHint !== "demo" &&
                  urlDuration !== DEFAULT_BILLING_DURATION_MONTHS
                ) {
                  billingQs.set("months", String(urlDuration));
                }
                router.replace(
                  billingQs.toString()
                    ? `/admin/billing?${billingQs.toString()}`
                    : "/admin/billing"
                );
              }}
            />
          ) : probe === "blocked" && error ? (
            <div
              className="rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-center text-sm text-stone-700"
              role="status"
            >
              <p>{error}</p>
              <p className="mt-2">
                <Link
                  href="/signin"
                  className="font-medium text-[#D4AF37] hover:underline"
                >
                  Sign in with a different account
                </Link>
                {" · "}
                <Link
                  href="/admin"
                  className="font-medium text-[#D4AF37] hover:underline"
                >
                  Open Admin
                </Link>
              </p>
            </div>
          ) : null}

          {formReady ? (
            <form method="post" onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="register-plan"
                  className="mb-1.5 block text-xs font-medium text-stone-600"
                >
                  Subscription package <span className="text-red-600">*</span>
                </label>
                <select
                  id="register-plan"
                  name="plan"
                  value={selectedPlan}
                  required
                  onChange={(e) => onPlanChange(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-gray-300 bg-[#F2F2F2] px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                >
                  <option value="" disabled>
                    Select a package
                  </option>
                  {ORG_SUBSCRIPTION_PLANS.map((p) => {
                    const plan = getSubscriptionPlan(p);
                    const price = plan
                      ? formatPlanMonthlyDisplayPrice(plan).label
                      : "";
                    return (
                      <option key={p} value={p}>
                        {plan?.name ?? p}
                        {price ? ` — ${price}` : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-stone-500">
                  {planFromPricing
                    ? "Pre-filled from the package you chose. Change it here if needed."
                    : planHint === "demo"
                      ? "Demo uses free Stripe Checkout — no charge and no card required."
                      : "Required — pick Demo, Starter, Growth, or Enterprise to continue."}
                </p>
                {planHint ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-stone-600">
                    {(getSubscriptionPlan(planHint)?.features ?? []).map(
                      (f) => (
                        <li key={f}>{f}</li>
                      )
                    )}
                  </ul>
                ) : null}
              </div>
              {planHint && planHint !== "demo" ? (
                <div>
                  <label
                    htmlFor="register-duration"
                    className="mb-1.5 block text-xs font-medium text-stone-600"
                  >
                    Subscription length
                  </label>
                  <select
                    id="register-duration"
                    name="durationMonths"
                    value={effectiveDuration}
                    onChange={(e) =>
                      onDurationChange(Number(e.target.value))
                    }
                    className="w-full cursor-pointer rounded-lg border border-gray-300 bg-[#F2F2F2] px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                  >
                    {BILLING_DURATION_OPTIONS.map((d) => (
                      <option key={d.months} value={d.months}>
                        {d.label}
                        {computePlanTermTotalMajor(planHint, d.months) != null
                          ? ` — $${computePlanTermTotalMajor(planHint, d.months)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-stone-500">
                    {termTotal != null
                      ? `Checkout will charge $${termTotal} for ${billingDurationLabel(effectiveDuration)} (monthly rate × months), then renew on that term.`
                      : "Contact sales for Enterprise pricing."}
                  </p>
                </div>
              ) : null}
              <input
                type="text"
                name="companyName"
                value={form.companyName}
                onChange={(e) => onCompanyNameChange(e.target.value)}
                placeholder="Company name"
                required
                minLength={2}
                className="w-full px-4 py-3 bg-[#F2F2F2] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37] text-gray-900"
              />
              <div>
                <input
                  type="text"
                  name="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((prev) => ({
                      ...prev,
                      slug: normalizeSlug(e.target.value) || e.target.value,
                    }));
                  }}
                  placeholder="URL slug (e.g. acme-parks)"
                  required
                  minLength={2}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  className="w-full px-4 py-3 bg-[#F2F2F2] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37] text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Lowercase letters, numbers, hyphens. Cannot use the storefront
                  default slug.
                </p>
              </div>

              {!sessionMode ? (
                <>
                  <input
                    type="text"
                    name="fullName"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                    placeholder="Your full name"
                    required
                    className="w-full px-4 py-3 bg-[#F2F2F2] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37] text-gray-900"
                  />
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="Work email"
                    required
                    className="w-full px-4 py-3 bg-[#F2F2F2] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37] text-gray-900"
                  />
                  <input
                    type="password"
                    name="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, password: e.target.value }))
                    }
                    placeholder="Password (min 8 characters)"
                    required
                    minLength={8}
                    className="w-full px-4 py-3 bg-[#F2F2F2] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37] text-gray-900"
                  />
                </>
              ) : null}

              {error ? (
                <div
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                >
                  <p>{error}</p>
                  {/already registered|already has a registered company/i.test(
                    error
                  ) ? (
                    <p className="mt-2">
                      <Link
                        href="/signin"
                        className="font-medium text-[#D4AF37] hover:underline"
                      >
                        Sign in to your company workspace
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-[#D4AF37] text-white font-semibold hover:bg-[#c4a030] disabled:opacity-60 transition-colors"
              >
                {loading ? "Creating workspace…" : "Create company workspace"}
              </button>
            </form>
          ) : probe === "loading" ? (
            <p className="text-center text-sm text-gray-500">Please wait…</p>
          ) : null}

          <div className="text-center text-sm text-gray-600 space-y-2">
            <p>
              Already registered?{" "}
              <Link
                href="/signin"
                className="text-[#D4AF37] font-medium hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterCompanyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white text-sm text-stone-500">
          Loading…
        </div>
      }
    >
      <RegisterCompanyForm />
    </Suspense>
  );
}
