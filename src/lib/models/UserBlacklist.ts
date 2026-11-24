/**
 * Thin Prisma re-export — prefer `prisma.userBlacklist` in new code.
 */
export type {
  UserBlacklist,
  UserBlacklistType,
  UserBlacklistSource,
} from "@prisma/client";

export const USER_BLACKLIST_TYPES = ["email", "phone"] as const;
export const USER_BLACKLIST_SOURCES = ["manual", "hard_delete"] as const;
