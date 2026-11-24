export {
  MEMBERSHIP_ROLE_PRESETS,
  MEMBERSHIP_STATUSES,
  type MembershipRolePreset,
  type MembershipStatus,
} from "@/lib/membershipConstants";

/** @deprecated Use Prisma `Membership` via `@/lib/prisma` — mongoose model removed. */
export type { Membership as IMembership } from "@prisma/client";
