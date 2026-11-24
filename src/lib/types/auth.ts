import type { RolePresetId } from "@/lib/auth/permissions";


export interface VerifiedAdmin {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    phoneNumber: string;
    joinedAt: Date;
    username: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface JwtAdminPayload {
  id: string;
  email: string;
}

export interface JwtAccessTokenPayload {
  sub: string;
  email: string;
  /** Live DB role (`admin` | `client`). Archived `seller` normalizes to `client`. */
  role?: string;
  /** Catalog permission strings. Omitted only if token-size fallback is on. */
  permissions?: string[];
  /** Primary Membership.orgId when present; null for legacy client sessions. */
  orgId?: string | null;
  /** Membership.rolePreset when present. */
  membershipRole?: string | null;
  preset?: RolePresetId;
  /**
   * Membership.companyWideView compact claim.
   * Omitted on legacy tokens → normalize treats as true.
   */
  cwv?: boolean;
  /**
   * User.authzVersion at sign time (Step 6.1). Bumped on membership change;
   * refresh tokens are cleared so the user re-logins after access TTL.
   */
  av?: number;
  type: "access";
  iat?: number;
  exp?: number;
}

export interface JwtRefreshTokenPayload {
  sub: string;
  jti: string; // unique token ID, helpful for revoking/rotation
  type: "refresh";
  iat?: number;
  exp?: number;
}

export interface JwtValidatorTokenPayload {
  sub: string;
  type: "access";
  iat?: number;
  exp?: number;
  email?: string;
}

/** Self-service password reset only. Must not be accepted as a session JWT. */
export interface JwtPasswordResetTokenPayload {
  sub: string;
  email?: string;
  type: "password_reset";
  iat?: number;
  exp?: number;
}

export interface Iuser {
  _id: string;
  email: string;
  [key: string]: unknown;
};
