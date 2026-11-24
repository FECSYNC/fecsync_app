import { api, unwrap, type MaybeWrapped } from '@/utils/api';

export type RegisteredCompanyStatusFilter =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'offboard'
  | 'all';

export type RegisteredCompanyRow = {
  id: string;
  name: string;
  slug: string;
  /** Company Profile logo URL when uploaded. */
  logoUrl?: string | null;
  status: string;
  billingSoftHold?: boolean;
  subscriptionPlan: string | null;
  requestedPlan?: string | null;
  requestedDurationMonths?: number | null;
  subscriptionInterval?: string | null;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  hasStripeCustomer: boolean;
  offboardRequestedAt?: string | null;
  offboardedAt?: string | null;
  memberCount: number;
  venuesActive?: number;
  enterpriseHqEligible?: boolean;
  createdAt: string;
};

export type RegisteredCompanyListPage = {
  companies: RegisteredCompanyRow[];
  nextCursor: string | null;
  hasMore: boolean;
  limit?: number;
};

export type RegisteredCompanyMemberSummary = {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string;
  rolePreset: string;
  status: string;
  createdAt: string;
};

export type RegisteredCompanyDetail = RegisteredCompanyRow & {
  approvedAt?: string | null;
  updatedAt?: string;
  members: RegisteredCompanyMemberSummary[];
};

export const registeredCompaniesKeys = {
  all: ['registered-companies'] as const,
  list: (status: RegisteredCompanyStatusFilter) =>
    [...registeredCompaniesKeys.all, 'list', status] as const,
  detail: (orgId: string) =>
    [...registeredCompaniesKeys.all, 'detail', orgId] as const,
};

export async function listRegisteredCompaniesClient(
  status: RegisteredCompanyStatusFilter,
  opts?: { cursor?: string | null; limit?: number }
): Promise<RegisteredCompanyListPage> {
  const params = new URLSearchParams();
  params.set('status', status);
  if (opts?.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
    params.set('limit', String(Math.floor(opts.limit)));
  }
  if (opts?.cursor) {
    params.set('cursor', opts.cursor);
  }
  const raw = await api<
    MaybeWrapped<{
      companies: RegisteredCompanyRow[];
      nextCursor?: string | null;
      hasMore?: boolean;
      limit?: number;
    }>
  >(`/api/admin/registered-companies?${params.toString()}`, undefined, {
    // Fail before the global 90s ceiling — hard refresh under Turbopack must not
    // spin the table skeleton forever while the compiler/DB catch up.
    timeout: 45_000,
  });
  const data = unwrap(raw);
  return {
    companies: Array.isArray(data?.companies) ? data.companies : [],
    nextCursor: data?.nextCursor ?? null,
    hasMore: Boolean(data?.hasMore),
    limit: data?.limit,
  };
}

export async function getRegisteredCompanyClient(
  orgId: string
): Promise<RegisteredCompanyDetail> {
  const raw = await api<MaybeWrapped<{ company: RegisteredCompanyDetail }>>(
    `/api/admin/registered-companies/${encodeURIComponent(orgId)}`,
    undefined,
    { timeout: 30_000 }
  );
  const data = unwrap(raw);
  if (!data?.company?.id) {
    throw new Error('Company not found');
  }
  return {
    ...data.company,
    members: Array.isArray(data.company.members) ? data.company.members : [],
  };
}
