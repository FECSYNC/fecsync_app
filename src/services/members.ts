import { api, unwrap, type MaybeWrapped } from "@/utils/api";

/**
 * Client for /api/admin/members (Steps 6.1–6.2).
 * Always scoped to the actor's Membership.orgId on the server — never send orgId.
 * Not a payment/checkout path (Cart/Wishlist/Wallet stay user===sub;
 * PAYMENT_POLICY unchanged).
 */

export type MembershipStatus =
  | "active"
  | "invited"
  | "suspended"
  | "revoked";

export type MembershipRolePreset =
  | "platform_admin"
  | "ops_manager"
  | "catalog_editor"
  | "finance"
  | "custom"
  | "tailor";

export type OrgMember = {
  _id: string;
  userId: string;
  orgId: string;
  rolePreset: MembershipRolePreset | string;
  roleTemplateId: string | null;
  roleTemplate: {
    _id: string;
    name: string;
    permissions: string[];
  } | null;
  permissionsOverride: string[];
  permissions: string[];
  /** When true, feature permissions apply to all org records. */
  companyWideView: boolean;
  /** Franchise park manager — park-locked seat may invite park-local staff. */
  franchiseParkManager?: boolean;
  /** Active MembershipVenueAssignment location ids (empty = not park-locked). */
  assignedLocationIds?: string[];
  /** True when seat is park-locked to assignedLocationIds. */
  parkLocked?: boolean;
  status: MembershipStatus | string;
  /** ISO expiry for pending invites (null when active / legacy). */
  inviteExpiresAt?: string | null;
  invitedBy: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  /** Only returned to software-owner viewers. */
  isPlatformSoftwareOwner?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  user: {
    _id: string;
    email: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string | null;
    lastLoginAt?: string | Date | null;
    lastLogoutAt?: string | Date | null;
    lastLoginIp?: string | null;
  } | null;
};

type MembersListResponse = {
  members: OrgMember[];
  orgId: string;
};

type MemberResponse = {
  member: OrgMember;
};

const BASE = "/api/admin/members";

export async function listOrgMembers(params?: {
  status?: MembershipStatus;
}): Promise<{ members: OrgMember[]; orgId: string }> {
  const qs =
    params?.status != null
      ? `?status=${encodeURIComponent(params.status)}`
      : "";
  const raw = await api<MaybeWrapped<MembersListResponse>>(`${BASE}${qs}`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return {
    members: Array.isArray(data?.members) ? data.members : [],
    orgId: data?.orgId ? String(data.orgId) : "",
  };
}

export async function inviteOrgMember(payload: {
  email?: string;
  userId?: string;
  rolePreset: MembershipRolePreset;
  roleTemplateId?: string | null;
  status?: Exclude<MembershipStatus, "revoked">;
  permissionsOverride?: string[];
  companyWideView?: boolean;
  /** Franchise manager invite: parks inside actor assignment (server-enforced). */
  locationIds?: string[];
  assignedLocationIds?: string[];
}): Promise<OrgMember> {
  const raw = await api<MaybeWrapped<MemberResponse>>(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.member) throw new Error("Failed to invite member");
  return data.member;
}

export async function updateOrgMember(
  id: string,
  payload: {
    rolePreset?: MembershipRolePreset;
    roleTemplateId?: string | null;
    status?: MembershipStatus;
    permissionsOverride?: string[];
    companyWideView?: boolean;
    franchiseParkManager?: boolean;
  }
): Promise<OrgMember> {
  const raw = await api<MaybeWrapped<MemberResponse>>(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.member) throw new Error("Failed to update member");
  return data.member;
}

export async function revokeOrgMember(id: string): Promise<OrgMember> {
  const raw = await api<
    MaybeWrapped<{ revoked: boolean; member: OrgMember }>
  >(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.member) throw new Error("Failed to revoke member");
  return data.member;
}

/** Permanently delete the user account (platform_admin). Removes login credentials. */
export async function hardDeleteOrgMember(id: string): Promise<{
  deleted: boolean;
  purgedUser: boolean;
  userId: string;
  membershipId: string;
  blacklisted?: { emails: number; phones: number };
}> {
  const raw = await api<
    MaybeWrapped<{
      deleted: boolean;
      purgedUser: boolean;
      userId: string;
      membershipId: string;
      blacklisted?: { emails: number; phones: number };
    }>
  >(`${BASE}/${id}?hard=1`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.deleted) throw new Error("Failed to delete user account");
  return data;
}

export async function createAdminUser(payload: {
  fullName: string;
  email: string;
  password: string;
  rolePreset: MembershipRolePreset;
  roleTemplateId?: string | null;
  status?: Exclude<MembershipStatus, "revoked">;
  permissionsOverride?: string[];
  companyWideView?: boolean;
  locationIds?: string[];
}): Promise<{ member: OrgMember; parkAssignError?: string }> {
  const raw = await api<
    MaybeWrapped<MemberResponse & { parkAssignError?: string }>
  >("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.member) throw new Error("Failed to create user");
  return {
    member: data.member,
    ...(typeof data.parkAssignError === "string" && data.parkAssignError
      ? { parkAssignError: data.parkAssignError }
      : {}),
  };
}

export type MemberVenueAssignmentsDto = {
  membershipId: string;
  assignedLocationIds: string[];
  assignedLocations: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
  }>;
};

/** Replace-set park assignments (company-wide actor only). */
export async function setMemberVenueAssignments(
  membershipId: string,
  locationIds: string[]
): Promise<MemberVenueAssignmentsDto> {
  const raw = await api<MaybeWrapped<MemberVenueAssignmentsDto>>(
    `${BASE}/${membershipId}/venue-assignments`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationIds }),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.membershipId) {
    throw new Error("Failed to update venue assignments");
  }
  return data;
}

/** Desk-assist password reset for another staff user (users:reset_password). */
export async function resetOrgMemberPassword(
  userId: string,
  body: {
    password: string;
    confirmPassword?: string;
    sendEmail?: boolean;
  }
): Promise<{ userId: string; email: string; note: string }> {
  const raw = await api<
    MaybeWrapped<{ userId: string; email: string; note: string }>
  >(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.userId) {
    throw new Error("Failed to reset password");
  }
  return data;
}
