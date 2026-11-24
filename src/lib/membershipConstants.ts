/**
 * Membership role/status constants — safe for client and server.
 * Keep in lockstep with `prisma/schema.prisma` MembershipRolePreset /
 * MembershipStatus enums. Safe for browser bundles (no Prisma/mongoose).
 */

export const MEMBERSHIP_ROLE_PRESETS = [
  "platform_admin",
  "ops_manager",
  "catalog_editor",
  "finance",
  "custom",
  /** Provider — not staff; JWT preset tailor; pages under /tailor/*. */
  "tailor",
] as const;
export type MembershipRolePreset = (typeof MEMBERSHIP_ROLE_PRESETS)[number];

export const MEMBERSHIP_STATUSES = [
  "active",
  "invited",
  "suspended",
  "revoked",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
