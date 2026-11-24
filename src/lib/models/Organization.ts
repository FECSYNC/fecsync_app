/** Organization (= Account). Statuses: pending | active | suspended. */
export type { Organization, OrgStatus } from "@prisma/client";

export const ORG_STATUSES = ["pending", "active", "suspended"] as const;
export type OrgStatusLiteral = (typeof ORG_STATUSES)[number];
