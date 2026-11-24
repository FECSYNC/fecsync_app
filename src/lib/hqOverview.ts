/**
 * Enterprise HQ overview rollup — real VenueLocation + plan meters only.
 * No fake revenue. POS device/sale counts are real when entitled. Signed waiver count is a real query. Unbuilt modules → explicit hooks.
 *
 * Step 3: `locationScope` filters venue *items* when HQ context is set; company-wide
 * counts + meters stay org-wide. Park-stamped ticketing/Product/Order filter by
 * actorLocationScope (incl. MembershipVenueAssignment park lock); members list
 * and plan meters are not park-filtered.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { requireActorOrgId, actorHasCompanyWideView } from "@/lib/staffOrg";
import { assertEnterpriseHqEnabled } from "@/lib/enterpriseHq";
import { assertRegisteredCompanyVenueOrg } from "@/lib/venueLocations";
import { getPlanUsageSnapshot, type UsageSnapshot } from "@/lib/planLimits";
import { getSubscriptionPlan } from "@/lib/subscriptionPlans";
import { actorLocationScope } from "@/lib/actorLocationScope";
import { planAllowsModule } from "@/lib/moduleEntitlement";
import { getAccountingDashboard } from "@/lib/accounting/dashboard";
import { systemCtx } from "@/lib/accounting/types";

export type HqOverviewActor = {
  orgId?: string | null;
  sub?: string;
  companyWideView?: boolean | null;
  preset?: string | null;
  membershipRole?: string | null;
  storefrontOrgId?: string | null;
};

export type HqOverviewVenueRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  city: string | null;
  timezone: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

export type HqOverviewDto = {
  orgId: string;
  plan: string | null;
  enterpriseHq: true;
  locationScope: {
    locationId: string | null;
    locationScoped: boolean;
    companyWideView: boolean;
  };
  /**
   * Honest Step 3 policy — what the switcher does / does not filter.
   * Park-stamped Product/Order filter when venueLocationId is set; members/meters stay company-wide.
   */
  scopePolicy: {
    venuesListFiltered: boolean;
    metersCompanyWide: true;
    /** @deprecated Prefer note — fashion null rows stay CWV-visible; stamped rows park-filter. */
    catalogCompanyWide: true;
    membersCompanyWide: true;
    /** @deprecated Prefer note — stamped orders park-filter for park-locked. */
    ordersCompanyWide: true;
    note: string;
  };
  venues: {
    /** Company-wide counts (not narrowed by location scope). */
    active: number;
    archived: number;
    total: number;
    /** Items may be narrowed to the selected venue when locationScoped. */
    items: HqOverviewVenueRow[];
  };
  /** Reused billing usage meters (honest caps / used) — always company-wide. */
  usage: UsageSnapshot;
  /** Present when Accounting is initialized for the org; scoped to HQ location when set. */
  accounting?: {
    revenue: string;
    expenses: string;
    netProfit: string;
    cashAndBank: string;
    receivables: string;
  } | null;
  /** Module entitlement honesty — ticketing may be package-enabled; others stay hooks. */
  moduleHints: readonly string[];
  modules: {
    id: string;
    status: "enabled" | "not_enabled";
    note: string;
  }[];
};

const FUTURE_MODULE_IDS = [
  "ticketing",
  "memberships",
  "pos",
  "waivers",
  "marketing",
  "access",
  "surveys",
  "loyalty",
  "dynamicPricing",
] as const;

const SCOPE_POLICY_NOTE =
  "HQ location scope filters venue list + HQ venue items, and park-stamped modules (ticketing products/sessions/resources/stock/bookings/payments/invoices; guest memberships; digital waivers; POS devices/sales; Product/Order when venueLocationId is stamped). Members roster and plan meters stay company-wide. MembershipVenueAssignment park-locks seats independently of Enterprise. companyWideView still gates ownership Layer 2 independently.";

export async function getHqOverview(
  actor: HqOverviewActor
): Promise<HqOverviewDto> {
  const orgId = requireActorOrgId(actor);
  await assertEnterpriseHqEnabled(orgId, actor);
  await assertRegisteredCompanyVenueOrg(orgId, actor);

  const scope = await actorLocationScope(actor);

  const [rows, usage, org] = await Promise.all([
    prisma.venueLocation.findMany({
      where: { orgId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        city: true,
        timezone: true,
        archivedAt: true,
        updatedAt: true,
      },
    }),
    getPlanUsageSnapshot(orgId),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { subscriptionPlan: true },
    }),
  ]);

  const plan = org?.subscriptionPlan?.trim().toLowerCase() || null;
  const planDef = getSubscriptionPlan(plan);
  const active = rows.filter((r) => r.status === "active").length;
  const archived = rows.filter((r) => r.status === "archived").length;

  // Prefer active scoped row only — archived/missing id after TOCTOU archive
  // must not keep HQ items filtered to a dead park.
  const scopedRow = scope.locationId
    ? rows.find((r) => r.id === scope.locationId) ?? null
    : null;
  const scopedActive =
    scopedRow != null && scopedRow.status === "active" ? scopedRow : null;
  const itemsSource = scope.locationId
    ? scopedActive
      ? [scopedActive]
      : []
    : rows;

  // Race: pref looked active in actorLocationScope but row set drifted (hard
  // delete / archive / org move mid-flight). Heal Membership like location-context
  // GET so Venues list + header switcher do not keep a ghost filter.
  if (scope.locationId && itemsSource.length === 0) {
    const userId = typeof actor.sub === "string" ? actor.sub.trim() : "";
    if (userId && isValidId(userId)) {
      await prisma.membership.updateMany({
        where: {
          userId,
          orgId,
          hqSelectedLocationId: scope.locationId,
        },
        data: { hqSelectedLocationId: null },
      });
    }
  }

  // Race: pref healed as active in actorLocationScope but row set drifted —
  // treat as All locations for items (meters stay company-wide from `rows`).
  const locationScoped =
    scope.locationScoped && itemsSource.length > 0;
  const locationIdOut = locationScoped ? scope.locationId : null;

  // Align venues meter with the same row set as the rollup (avoid TOCTOU
  // drift vs a parallel getPlanUsageSnapshot count). Strip seat occupant ids.
  const usageSafe: UsageSnapshot = {
    ...usage,
    tailorSeatOccupantUserIds: [],
    meters: usage.meters.map((m) => {
      if (m.resource !== "venues") return m;
      const unlimited = m.unlimited || m.limit == null;
      return {
        ...m,
        used: active,
        remaining: unlimited || m.limit == null ? null : Math.max(0, m.limit - active),
      };
    }),
  };
  usageSafe.overLimitResources = usageSafe.meters
    .filter((m) => m.limit != null && !m.unlimited && m.used > m.limit)
    .map((m) => m.resource);

  const publishedWaiverTemplates = await prisma.waiverTemplate.count({
    where: { orgId, status: "published" },
  });
  const signedWaiverRecords = await prisma.waiverRecord.count({
    where: {
      orgId,
      status: "signed",
      ...(locationIdOut ? { locationId: locationIdOut } : {}),
    },
  });
  const posParkWhere = {
    orgId,
    ...(locationIdOut ? { locationId: locationIdOut } : {}),
  };
  const [posDeviceCount, posSaleCount] = await Promise.all([
    prisma.posDevice.count({ where: { ...posParkWhere, archivedAt: null } }),
    prisma.posSale.count({ where: posParkWhere }),
  ]);

  let accounting: HqOverviewDto["accounting"] = null;
  try {
    const acct = await prisma.accountingSettings.findUnique({
      where: { orgId },
      select: { enabled: true, initializedAt: true },
    });
    if (acct?.enabled && acct.initializedAt) {
      const ctx = systemCtx(orgId);
      const dash = await getAccountingDashboard(ctx, {
        locationIds: locationIdOut ? [locationIdOut] : undefined,
      });
      accounting = {
        revenue: String(dash.kpis.revenue),
        expenses: String(dash.kpis.expenses),
        netProfit: String(dash.kpis.netProfit),
        cashAndBank: String(dash.kpis.cashAndBank),
        receivables: String(dash.kpis.receivables),
      };
    }
  } catch {
    accounting = null;
  }

  return {
    orgId,
    plan,
    enterpriseHq: true,
    locationScope: {
      locationId: locationIdOut,
      locationScoped,
      companyWideView:
        scope.companyWideView || actorHasCompanyWideView(actor),
    },
    scopePolicy: {
      venuesListFiltered: locationScoped,
      metersCompanyWide: true,
      catalogCompanyWide: true,
      membersCompanyWide: true,
      ordersCompanyWide: true,
      note: SCOPE_POLICY_NOTE,
    },
    venues: {
      active,
      archived,
      total: rows.length,
      items: (locationScoped ? itemsSource : rows).map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        city: r.city,
        timezone: r.timezone,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
    },
    usage: usageSafe,
    accounting,
    moduleHints: planDef ? [...planDef.moduleHints] : [],
    modules: FUTURE_MODULE_IDS.map((id) => {
      if (id === "ticketing" && planAllowsModule(plan, "ticketing")) {
        return {
          id,
          status: "enabled" as const,
          note: "Staff catalog, B2B accounts, booking ops (list/create/calendar/detail/payments/invoices), HQ search, bookings CSV/JSON export, and public guest wizards are live. Party Management (packages, rooms, deposits, guests, invitations, food, balances) rides this module under Parties. Digital Waivers and POS are separate modules on this card.",
        };
      }
      if (id === "pos") {
        const entitled = planAllowsModule(plan, "pos");
        if (!entitled) {
          return {
            id,
            status: "not_enabled" as const,
            note: "POS is not included on this package (Growth and Enterprise).",
          };
        }
        return {
          id,
          status: "enabled" as const,
          note: `POS terminal live for this park scope: ${posDeviceCount} active device(s), ${posSaleCount} sale(s). Card settles via in-browser Elements or payment link (Stripe Terminal reader collect not wired). Does not invent revenue. Check-in scanner product and ticket-purchase kiosk are not shipped.`,
        };
      }
      if (id === "memberships" && planAllowsModule(plan, "memberships")) {
        return {
          id,
          status: "enabled" as const,
          note: "Guest park Memberships live: catalog, eligibility, CRM, sell/lifecycle billing, redeem/verify, family beta, card/wallet honesty, guest self-serve (Profile → Memberships), click-to-cancel + alternatives (beta), agreements, reports, and plan-dependent dunning. Sold/active/churn KPIs live under Memberships → Reports (Enterprise HQ rollup there only — not fake KPIs on this HQ card).",
        };
      }
      if (id === "waivers") {
        const entitled = planAllowsModule(plan, "waivers");
        if (!entitled) {
          return {
            id,
            status: "not_enabled" as const,
            note: "Digital Waivers is not included on this package.",
          };
        }
        return {
          id,
          status: publishedWaiverTemplates > 0 ? ("enabled" as const) : ("not_enabled" as const),
          note:
            publishedWaiverTemplates > 0
              ? `Digital Waivers entitled. Published templates: ${publishedWaiverTemplates}. Signed records in this scope: ${signedWaiverRecords}. Guests sign from a link, QR, on-site, or kiosk. Staff verify, void, import, and export under Waivers. Expiry reminders run on the daily schedule. Check-in blocking is not live.`
              : "Digital Waivers is entitled. Publish a template before the module shows as available. After publish, guests can sign and staff can verify, import, and export. This card does not count signed waivers.",
        };
      }
      if (id === "marketing") {
        const entitled = planAllowsModule(plan, "marketing");
        if (!entitled) {
          return {
            id,
            status: "not_enabled" as const,
            note: "Guest Marketing Automation is Growth+ (newsletter, welcome, birthday, re-engagement, post-visit surveys).",
          };
        }
        return {
          id,
          status: "enabled" as const,
          note: "Guest Marketing Automation live: newsletter capture without waiver, promotional automations (opt-in only), survey invites, admin /admin/marketing. Membership dunning and waiver expiry reminders stay on Memberships/Waivers engines. No live Campaign Monitor / Salesforce / ROLLER Connect sync; ESP integrations remain not_configured.",
        };
      }
      return {
        id,
        status: "not_enabled" as const,
        note: "Module not enabled — schema/hooks only until the module epic ships.",
      };
    }),
  };
}
