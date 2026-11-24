/**
 * Admin Memberships API client (guest park — Feature 08).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type {
  GuestMembershipDto,
  GuestMembershipListItem,
  GuestProfileDto,
  MembershipPlanDto,
  MembershipSettingsDto,
  MembershipVenueEligibilityDto,
} from "@/lib/memberships/types";
import type { MembershipCategoryDto } from "@/lib/memberships/categories";

export type {
  GuestMembershipDto,
  GuestMembershipListItem,
  GuestProfileDto,
  MembershipPlanDto,
  MembershipSettingsDto,
  MembershipVenueEligibilityDto,
  MembershipCategoryDto,
};

const BASE = "/api/admin/memberships";

export const membershipKeys = {
  all: ["admin", "memberships"] as const,
  plans: (includeArchived?: boolean) =>
    [...membershipKeys.all, "plans", includeArchived ? "all" : "active"] as const,
  categories: (includeArchived?: boolean) =>
    [
      ...membershipKeys.all,
      "categories",
      includeArchived ? "all" : "active",
    ] as const,
  settings: (locationId: string | null) =>
    [...membershipKeys.all, "settings", locationId ?? "org"] as const,
  eligibility: (planId: string | null) =>
    [...membershipKeys.all, "eligibility", planId ?? "all"] as const,
  guests: (q: string) => [...membershipKeys.all, "guests", q] as const,
  guestDetail: (id: string) => [...membershipKeys.all, "guest", id] as const,
  members: (q: string) => [...membershipKeys.all, "members", q] as const,
  member: (id: string) => [...membershipKeys.all, "member", id] as const,
  attachableForms: () => [...membershipKeys.all, "attachable-forms"] as const,
};

export async function listMembershipPlans(opts?: {
  includeArchived?: boolean;
}): Promise<MembershipPlanDto[]> {
  const qs = opts?.includeArchived ? "?includeArchived=1" : "";
  const raw = await api<MaybeWrapped<{ plans: MembershipPlanDto[] }>>(
    `${BASE}/plans${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.plans ?? [];
}

export async function createMembershipPlan(
  body: Record<string, unknown>
): Promise<MembershipPlanDto> {
  const raw = await api<MaybeWrapped<{ plan: MembershipPlanDto }>>(
    `${BASE}/plans`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.plan) throw new Error("Could not create plan");
  return data.plan;
}

export async function updateMembershipPlan(
  id: string,
  body: Record<string, unknown>
): Promise<MembershipPlanDto> {
  const raw = await api<MaybeWrapped<{ plan: MembershipPlanDto }>>(
    `${BASE}/plans/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.plan) throw new Error("Could not update plan");
  return data.plan;
}

export async function archiveMembershipPlan(
  id: string
): Promise<MembershipPlanDto> {
  const raw = await api<MaybeWrapped<{ plan: MembershipPlanDto }>>(
    `${BASE}/plans/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.plan) throw new Error("Could not archive plan");
  return data.plan;
}

export async function listMembershipCategories(opts?: {
  includeArchived?: boolean;
}): Promise<MembershipCategoryDto[]> {
  const qs = opts?.includeArchived ? "?includeArchived=1" : "";
  const raw = await api<MaybeWrapped<{ categories: MembershipCategoryDto[] }>>(
    `${BASE}/categories${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.categories ?? [];
}

export type AttachableFormDto = {
  id: string;
  name: string;
};

export async function listAttachableForms(): Promise<AttachableFormDto[]> {
  const raw = await api<MaybeWrapped<{ forms: AttachableFormDto[] }>>(
    `${BASE}/attachable-forms`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.forms ?? [];
}

export async function createMembershipCategory(body: {
  name: string;
  description?: string | null;
}): Promise<MembershipCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: MembershipCategoryDto }>>(
    `${BASE}/categories`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not create membership category");
  return data.category;
}

export async function updateMembershipCategory(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    slug?: string;
    layout?: "auto" | "grid" | "stack";
    embedEnabled?: boolean;
  }
): Promise<MembershipCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: MembershipCategoryDto }>>(
    `${BASE}/categories/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not update membership category");
  return data.category;
}

export async function archiveMembershipCategory(
  id: string
): Promise<MembershipCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: MembershipCategoryDto }>>(
    `${BASE}/categories/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not archive membership category");
  return data.category;
}

export async function getMembershipSettings(
  locationId?: string | null
): Promise<MembershipSettingsDto> {
  const qs =
    locationId && locationId.trim()
      ? `?locationId=${encodeURIComponent(locationId.trim())}`
      : "";
  const raw = await api<MaybeWrapped<{ settings: MembershipSettingsDto }>>(
    `${BASE}/settings${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not load settings");
  return data.settings;
}

export async function putMembershipSettings(
  body: Record<string, unknown>
): Promise<MembershipSettingsDto> {
  const raw = await api<MaybeWrapped<{ settings: MembershipSettingsDto }>>(
    `${BASE}/settings`,
    { method: "PUT", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not save settings");
  return data.settings;
}

export async function listMembershipEligibility(
  planId?: string | null
): Promise<MembershipVenueEligibilityDto[]> {
  const qs =
    planId && planId.trim()
      ? `?planId=${encodeURIComponent(planId.trim())}`
      : "";
  const raw = await api<
    MaybeWrapped<{ rows: MembershipVenueEligibilityDto[] }>
  >(`${BASE}/eligibility${qs}`, { method: "GET", credentials: "include" });
  return unwrap(raw)?.rows ?? [];
}

export async function putMembershipEligibility(body: {
  planId: string;
  rows: Array<{
    locationId: string;
    eligible: boolean;
    localPerksAdd?: unknown;
    localPerksRemove?: unknown;
  }>;
}): Promise<MembershipVenueEligibilityDto[]> {
  const raw = await api<
    MaybeWrapped<{ rows: MembershipVenueEligibilityDto[] }>
  >(`${BASE}/eligibility`, {
    method: "PUT",
    credentials: "include",
    body: JSON.stringify(body),
  });
  return unwrap(raw)?.rows ?? [];
}

export async function searchMembershipGuests(
  q?: string
): Promise<GuestProfileDto[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  const raw = await api<MaybeWrapped<{ guests: GuestProfileDto[] }>>(
    `${BASE}/guests${qs}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.guests ?? [];
}

export async function createMembershipGuest(
  body: Record<string, unknown>
): Promise<GuestProfileDto & { accountNote?: string }> {
  const raw = await api<
    MaybeWrapped<{ guest: GuestProfileDto; accountNote?: string }>
  >(`${BASE}/guests`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.guest) throw new Error("Could not create guest");
  return { ...data.guest, accountNote: data.accountNote };
}

/** Invite guest to online membership dashboard (link existing or invite-only create). */
export async function inviteMembershipGuestToDashboard(
  guestProfileId: string,
  body?: { createAccountIfMissing?: boolean; sendEmail?: boolean }
): Promise<{
  outcome: string;
  guestProfileId: string;
  userId: string;
  email: string;
  note: string;
}> {
  const raw = await api<
    MaybeWrapped<{
      outcome: string;
      guestProfileId: string;
      userId: string;
      email: string;
      note: string;
    }>
  >(`${BASE}/guests/${encodeURIComponent(guestProfileId)}/invite`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
  const data = unwrap(raw);
  if (!data?.guestProfileId) throw new Error("Could not invite guest");
  return data;
}

export async function listMembershipMembers(
  q?: string,
  opts?: { cursor?: string; take?: number }
): Promise<{
  members: GuestMembershipListItem[];
  note: string;
  nextCursor: string | null;
}> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.take != null) params.set("take", String(opts.take));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const raw = await api<
    MaybeWrapped<{
      members: GuestMembershipListItem[];
      note: string;
      nextCursor?: string | null;
    }>
  >(`${BASE}/members${qs}`, { method: "GET", credentials: "include" });
  const data = unwrap(raw);
  return {
    members: data?.members ?? [],
    note: data?.note ?? "",
    nextCursor: data?.nextCursor ?? null,
  };
}

export type GuestMembershipDetail = GuestMembershipDto & {
  cancelReason: string | null;
  agreementSignedAt: string | null;
  dunningFailCount: number;
  dunningNextAt: string | null;
  remainingEntries?: number | null;
  visitStatus?: string | null;
  homeLocation?: { id: string; name: string } | null;
  plan: {
    id: string;
    name: string;
    billing: string;
    price: string;
    currency: string;
    upgradeGroupKey: string | null;
    pauseAllowed: boolean;
    familyAllowed: boolean;
    membershipType?: string;
    imageUrl?: string | null;
    instructions?: string | null;
    termsAndConditions?: string | null;
    cancellationTerms?: string | null;
    reportingCategory?: string | null;
    hideFromOnlineSales?: boolean;
    archivedAt: string | null;
  };
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    hasStripeCustomer: boolean;
  };
  paymentAttempts: Array<{
    id: string;
    amount: string;
    currency: string;
    status: string;
    attemptNumber: number;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  familyLinks: Array<{
    id: string;
    guestProfileId: string;
    role: string;
    firstName: string;
    lastName: string;
  }>;
};

export async function getMembershipMember(
  id: string
): Promise<GuestMembershipDetail> {
  const raw = await api<MaybeWrapped<{ member: GuestMembershipDetail }>>(
    `${BASE}/members/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.member) throw new Error("Could not load member");
  return data.member;
}

export async function sellMembership(
  body: Record<string, unknown>
): Promise<{
  membership: GuestMembershipDto;
  note?: string;
  paymentAttemptId?: string;
  stripeConfigured?: boolean;
}> {
  const raw = await api<
    MaybeWrapped<{
      membership: GuestMembershipDto;
      note?: string;
      paymentAttemptId?: string;
      stripeConfigured?: boolean;
    }>
  >(`${BASE}/members`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.membership) throw new Error("Could not sell membership");
  return data;
}

export async function membershipMemberAction(
  id: string,
  body: Record<string, unknown>
): Promise<{ membership?: GuestMembershipDto; note?: string; paymentMethod?: unknown }> {
  const raw = await api<
    MaybeWrapped<{
      membership?: GuestMembershipDto;
      note?: string;
      paymentMethod?: unknown;
    }>
  >(`${BASE}/members/${encodeURIComponent(id)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  return unwrap(raw) ?? {};
}

export async function verifyMembershipBenefits(body: {
  guestMembershipId?: string;
  query?: string;
  customMembershipId?: string;
  locationId: string;
  amountMajor?: number;
}): Promise<{ verify: Record<string, unknown>; discount: unknown }> {
  const raw = await api<
    MaybeWrapped<{ verify: Record<string, unknown>; discount: unknown }>
  >(`${BASE}/verify`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.verify) throw new Error("Could not verify membership");
  return data;
}

export async function redeemMembership(body: Record<string, unknown>): Promise<{
  redeem?: Record<string, unknown>;
  undo?: Record<string, unknown>;
}> {
  const raw = await api<
    MaybeWrapped<{
      redeem?: Record<string, unknown>;
      undo?: Record<string, unknown>;
    }>
  >(`${BASE}/redeem`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  return unwrap(raw) ?? {};
}

export async function patchMembershipMedia(
  id: string,
  body: Record<string, unknown>
): Promise<{
  member?: GuestMembershipDto;
  familyLinks?: unknown[];
  beta?: boolean;
}> {
  const raw = await api<
    MaybeWrapped<{
      member?: GuestMembershipDto;
      familyLinks?: unknown[];
      beta?: boolean;
    }>
  >(`${BASE}/members/${encodeURIComponent(id)}/media`, {
    method: "PATCH",
    credentials: "include",
    body: JSON.stringify(body),
  });
  return unwrap(raw) ?? {};
}

export async function getMembershipCard(id: string): Promise<Record<string, unknown>> {
  const raw = await api<MaybeWrapped<{ card: Record<string, unknown> }>>(
    `${BASE}/members/${encodeURIComponent(id)}/card`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.card) throw new Error("Could not load card");
  return data.card;
}

export async function getMembershipWallet(
  id: string
): Promise<Record<string, unknown>> {
  const raw = await api<MaybeWrapped<{ wallet: Record<string, unknown> }>>(
    `${BASE}/members/${encodeURIComponent(id)}/wallet`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.wallet) throw new Error("Could not load wallet");
  return data.wallet;
}

// ── Phase 4 admin: reports, dunning queue, cancel alternatives, agreements ──

export type MembershipReports = {
  orgId: string;
  range: { from: string; to: string };
  soldInRange: number;
  activeMembers: number;
  churnCancelledInRange: number;
  pastDueCount: number;
  failedPayments: { count: number; amountMajor: number };
  scope: "company" | "park" | "hq_rollup";
  locationId: string | null;
};

export type DunningQueue = {
  advanced: boolean;
  retryDays: number[];
  items: Array<{
    id: string;
    customMembershipId: string;
    status: string;
    dunningFailCount: number;
    dunningNextAt: string | null;
    cancelAtPeriodEnd: boolean;
    planName: string;
    guestEmail: string | null;
    guestName: string;
  }>;
};

export type CancelAlternativeKind =
  | "pause_offer"
  | "discount"
  | "downgrade"
  | "message";

export type CancelAlternative = {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  kind: CancelAlternativeKind;
  config: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
};

export const membershipP4Keys = {
  reports: (from: string, to: string, locationId: string, hq: boolean) =>
    [...membershipKeys.all, "reports", from, to, locationId, hq ? "hq" : "org"] as const,
  dashboardKpis: () => [...membershipKeys.all, "dashboard-kpis"] as const,
  dunningQueue: () => [...membershipKeys.all, "dunning-queue"] as const,
  alternatives: () => [...membershipKeys.all, "cancel-alternatives"] as const,
  guestDetail: (id: string) => [...membershipKeys.all, "guest", id] as const,
};

export async function getMembershipReports(opts: {
  from?: string;
  to?: string;
  locationId?: string;
  hqRollup?: boolean;
}): Promise<MembershipReports> {
  const qs = new URLSearchParams();
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  if (opts.locationId) qs.set("locationId", opts.locationId);
  if (opts.hqRollup) qs.set("hqRollup", "1");
  const raw = await api<MaybeWrapped<{ report: MembershipReports }>>(
    `${BASE}/reports${qs.toString() ? `?${qs}` : ""}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.report) throw new Error("Could not load reports");
  return data.report;
}

export async function getMembershipDashboardKpis(): Promise<{
  soldLast30d: number;
  activeMembers: number;
}> {
  const raw = await api<
    MaybeWrapped<{ kpis: { soldLast30d: number; activeMembers: number } }>
  >(`${BASE}/reports?kpis=1`, { method: "GET", credentials: "include" });
  const data = unwrap(raw);
  if (!data?.kpis) throw new Error("Could not load membership KPIs");
  return data.kpis;
}

export async function getMembershipDunningQueue(): Promise<DunningQueue> {
  const raw = await api<MaybeWrapped<DunningQueue>>(`${BASE}/dunning-queue`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return {
    advanced: Boolean(data?.advanced),
    retryDays: data?.retryDays ? [...data.retryDays] : [],
    items: data?.items ?? [],
  };
}

export async function listCancelAlternatives(): Promise<CancelAlternative[]> {
  const raw = await api<MaybeWrapped<{ alternatives: CancelAlternative[] }>>(
    `${BASE}/cancel-alternatives`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.alternatives ?? [];
}

export async function upsertCancelAlternative(
  body: Partial<Omit<CancelAlternative, "orgId">> & {
    name: string;
    kind: CancelAlternativeKind;
  }
): Promise<CancelAlternative> {
  const raw = await api<MaybeWrapped<{ alternative: CancelAlternative }>>(
    `${BASE}/cancel-alternatives`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.alternative) throw new Error("Could not save alternative");
  return data.alternative;
}

export async function signMembershipAgreementAsStaff(
  id: string
): Promise<{ membershipStatus: string }> {
  const raw = await api<MaybeWrapped<{ membershipStatus: string }>>(
    `${BASE}/members/${encodeURIComponent(id)}/agreement`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ accepted: true }),
    }
  );
  const data = unwrap(raw);
  if (!data?.membershipStatus) throw new Error("Could not record agreement");
  return data;
}

export type GuestProfileDetail = {
  guest: GuestProfileDto;
  memberships: Array<{
    id: string;
    customMembershipId: string;
    status: string;
    planId: string;
    planName: string;
    homeLocation: { id: string; name: string } | null;
    cancelAtPeriodEnd: boolean;
    cancelReason: string | null;
    currentPeriodEnd: string | null;
    remainingEntries: number | null;
    visitStatus: string | null;
    dunningFailCount: number;
    agreementSignedAt: string | null;
  }>;
};

export async function getMembershipGuestDetail(
  id: string
): Promise<GuestProfileDetail> {
  const raw = await api<MaybeWrapped<GuestProfileDetail>>(
    `${BASE}/guests/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.guest) throw new Error("Could not load guest");
  return data;
}

// ── Phase 4 guest self-serve (/api/me/memberships) ──

const ME = "/api/me/memberships";

export type MyMembershipSummary = {
  id: string;
  orgId: string;
  status: string;
  customMembershipId: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  homeLocation: { id: string; name: string } | null;
  plan: {
    id: string;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    membershipType?: string;
    billing: string;
    currency: string;
    price: string | number;
    intervalUnit: string | null;
    intervalCount: number | null;
  };
  guestProfileId: string;
  remainingEntries: number | null;
  visitStatus: string | null;
  discountPercent: number;
  dunningFailCount: number;
};

export type MyMembershipDetail = {
  membership: {
    id: string;
    orgId: string;
    status: string;
    customMembershipId: string;
    barcodeOrCode: string | null;
    homeLocationId: string;
    cancelAtPeriodEnd: boolean;
    cancelReason: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    startsAt: string | null;
    endsAt: string | null;
    agreementSignedAt: string | null;
    hasLiveStripeSubscription?: boolean;
    plan: {
      id: string;
      name: string;
      description?: string | null;
      detailedDescription?: string | null;
      imageUrl?: string | null;
      membershipType?: string;
      billing: string;
      currency: string;
      price: number;
      pauseAllowed: boolean;
      familyAllowed?: boolean;
      instructions?: string | null;
      termsAndConditions?: string | null;
      cancellationTerms?: string | null;
      customRedemptionDescription?: string | null;
    };
    homeLocation?: { id: string; name: string | null } | null;
  };
  verify: {
    remainingEntries: number | null;
    visitStatus: string;
    discountPercent: number;
    [key: string]: unknown;
  };
  agreement?: {
    id: string | null;
    status: string;
    storageRef: string | null;
    honestyNote: string;
    signedAt: string | null;
  } | null;
  clickToCancelEnabled: boolean;
  cancelAlternativesEnabled: boolean;
  alternatives: CancelAlternative[];
  settingsGraceDays: number;
  upgradePlans?: Array<{
    id: string;
    name: string;
    price: number;
    currency: string;
    billing: string;
  }>;
  paymentAttempts?: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    attemptNumber: number;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  activity?: Array<{
    id: string;
    kind: string;
    qty: number;
    remainingAfter: number | null;
    source: string;
    locationName: string | null;
    createdAt: string;
  }>;
};

export type MyCancelResult =
  | {
      requiresAlternatives: true;
      alternatives: CancelAlternative[];
      membershipId: string;
    }
  | {
      requiresAlternatives: false;
      alternativeApplied?: { kind: string; membershipId: string; note?: string };
      membership?: GuestMembershipDto;
      note?: string;
    };

export type MyMembershipCard = {
  card: {
    guestMembershipId: string;
    customMembershipId: string;
    barcodeOrCode: string | null;
    qrPayload: string | null;
    memberName: string;
    photoUrl: string | null;
    planName: string;
    status: string;
    homeLocationName: string | null;
    orgBrand: { companyName: string | null; logoUrl: string | null };
  };
  wallet: Record<string, unknown>;
};

export const meMembershipKeys = {
  all: ["me", "memberships"] as const,
  list: () => [...meMembershipKeys.all, "list"] as const,
  detail: (id: string) => [...meMembershipKeys.all, "detail", id] as const,
  card: (id: string) => [...meMembershipKeys.all, "card", id] as const,
};

function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`.slice(0, 120);
}

/** Sticky per-action key so double-submit while in-flight replays, not double-charges. */
const stickyIdemKeys = new Map<string, string>();

function stickyIdempotencyKey(scope: string): string {
  const existing = stickyIdemKeys.get(scope);
  if (existing) return existing;
  const key = newIdempotencyKey(scope);
  stickyIdemKeys.set(scope, key);
  return key;
}

function clearStickyIdempotencyKey(scope: string): void {
  stickyIdemKeys.delete(scope);
}

export async function listMyMemberships(): Promise<{
  linked: boolean;
  memberships: MyMembershipSummary[];
}> {
  const raw = await api<
    MaybeWrapped<{ linked: boolean; memberships: MyMembershipSummary[] }>
  >(ME, { method: "GET", credentials: "include" });
  const data = unwrap(raw);
  return {
    linked: data?.linked ?? false,
    memberships: data?.memberships ?? [],
  };
}

export async function linkMyGuestProfile(body: {
  guestProfileId: string;
  orgId: string;
}): Promise<void> {
  await api(`${ME}/link`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
}

export async function getMyMembership(id: string): Promise<MyMembershipDetail> {
  const raw = await api<MaybeWrapped<MyMembershipDetail>>(
    `${ME}/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.membership) throw new Error("Membership not found");
  return data;
}

export async function cancelMyMembership(
  id: string,
  body: {
    when: "end_of_period" | "immediate";
    reason?: string;
    confirm: true;
    declineAlternatives?: boolean;
    alternativeId?: string | null;
  }
): Promise<MyCancelResult> {
  const scope = `self_cancel:${id}`;
  const raw = await api<MaybeWrapped<MyCancelResult>>(
    `${ME}/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        ...body,
        idempotencyKey: stickyIdempotencyKey(scope),
      }),
    }
  );
  const data = unwrap(raw);
  if (!data) throw new Error("Could not cancel membership");
  // Keep sticky until a terminal cancel succeeds (not alternatives prompt).
  if (!data.requiresAlternatives) clearStickyIdempotencyKey(scope);
  return data;
}

async function postMyAction<T>(
  id: string,
  action: "renew" | "upgrade" | "reactivate" | "update-card" | "sign-agreement",
  body: Record<string, unknown> = {}
): Promise<T> {
  const scope = `self_${action}:${id}`;
  try {
    const raw = await api<MaybeWrapped<T>>(
      `${ME}/${encodeURIComponent(id)}/${action}`,
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          ...body,
          idempotencyKey: stickyIdempotencyKey(scope),
        }),
      }
    );
    const data = unwrap(raw);
    if (!data) throw new Error("Membership action failed");
    clearStickyIdempotencyKey(scope);
    return data;
  } catch (err) {
    // Keep sticky key on failure so a retry uses the same idempotency key.
    throw err;
  }
}

export function renewMyMembership(id: string) {
  return postMyAction<{
    membership: GuestMembershipDto;
    note?: string;
    stripeConfigured?: boolean;
  }>(id, "renew");
}

export function upgradeMyMembership(id: string, newPlanId: string) {
  return postMyAction<{
    membership: GuestMembershipDto;
    note?: string;
    stripeConfigured?: boolean;
  }>(id, "upgrade", { newPlanId });
}

export function reactivateMyMembership(id: string) {
  return postMyAction<{
    membership: GuestMembershipDto;
    note?: string;
    stripeConfigured?: boolean;
  }>(id, "reactivate");
}

export function updateMyMembershipCard(id: string) {
  return postMyAction<{
    paymentMethod: { clientSecret: string | null; setupIntentId: string };
    note: string;
  }>(id, "update-card");
}

export function signMyMembershipAgreement(id: string) {
  return postMyAction<{ membershipStatus: string }>(id, "sign-agreement", {
    accepted: true,
  });
}

export async function getMyMembershipCard(id: string): Promise<MyMembershipCard> {
  const raw = await api<MaybeWrapped<MyMembershipCard>>(
    `${ME}/${encodeURIComponent(id)}/card`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.card) throw new Error("Could not load card");
  return data;
}

