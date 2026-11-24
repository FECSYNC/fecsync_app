/**
 * Digital wallet membership passes (Feature 08 Phase 3 / Phase 5 honesty).
 *
 * NEVER return status "ready" until real .pkpass / Google Wallet JWT signing
 * ships. Env certs alone are not enough — JSON-only payloads are not wallet
 * success. On-screen QR still works via GuestMembership.qrPayload /
 * customMembershipId.
 */
import { requireId } from "@/lib/ids";
import prisma from "@/lib/prisma";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { ensureMembershipScanCodes } from "@/lib/memberships/entitlementEngine";
import { loadEffectiveMembershipSettingsRow } from "@/lib/memberships/settings";

export type WalletPassResult = {
  status: "not_configured";
  code: typeof MembershipErrorCodes.WALLET_NOT_CONFIGURED;
  message: string;
  /** Digital card QR still available without wallet signing. */
  digitalCard: {
    customMembershipId: string;
    barcodeOrCode: string | null;
    qrPayload: string | null;
    displayName: string;
  };
};

function appleEnvPresent(): boolean {
  return Boolean(
    process.env.APPLE_WALLET_PASS_TYPE_ID?.trim() &&
      process.env.APPLE_WALLET_TEAM_ID?.trim() &&
      process.env.APPLE_WALLET_PASS_CERT?.trim() &&
      process.env.APPLE_WALLET_PASS_KEY?.trim()
  );
}

function googleEnvPresent(): boolean {
  return Boolean(
    process.env.GOOGLE_WALLET_ISSUER_ID?.trim() &&
      process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_KEY?.trim()
  );
}

/**
 * True only when a signed pass can be issued.
 * Signing is not implemented — always false (honest residual).
 */
export function isWalletPassConfigured(
  _platform?: "apple" | "google" | "any"
): boolean {
  return false;
}

/**
 * Always honest not_configured until .pkpass / Google JWT signing ships.
 * Digital membership QR remains available on `digitalCard`.
 */
export async function generateMembershipWalletPass(input: {
  orgId: string;
  guestMembershipId: string;
  platform?: "apple" | "google" | "auto";
  /**
   * Reserved for future signed-pass download paths. Ignored while signing
   * is unimplemented (never advertise a ready download URL).
   */
  downloadBasePath?: string;
}): Promise<WalletPassResult> {
  const orgId = requireId(input.orgId, "orgId");
  const id = requireId(input.guestMembershipId, "guestMembershipId");

  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    include: {
      guestProfile: { select: { firstName: true, lastName: true } },
      plan: { select: { name: true } },
    },
  });
  if (!member) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "Guest membership not found"
    );
  }

  const ensured = await ensureMembershipScanCodes(member);
  const displayName =
    `${member.guestProfile.firstName} ${member.guestProfile.lastName}`.trim();
  const digitalCard = {
    customMembershipId: ensured.customMembershipId,
    barcodeOrCode: ensured.barcodeOrCode,
    qrPayload: ensured.qrPayload,
    displayName,
  };

  // Venue override → org default (same resolution as entitlement settings).
  const settings = await loadEffectiveMembershipSettingsRow(
    orgId,
    member.homeLocationId
  );
  if (settings && !settings.walletPassEnabled) {
    return {
      status: "not_configured",
      code: MembershipErrorCodes.WALLET_NOT_CONFIGURED,
      message:
        "Digital wallet passes are disabled in Memberships settings",
      digitalCard,
    };
  }

  const envPresent = appleEnvPresent() || googleEnvPresent();
  return {
    status: "not_configured",
    code: MembershipErrorCodes.WALLET_NOT_CONFIGURED,
    message: envPresent
      ? "Wallet pass signing is not implemented yet (Apple/Google env keys detected; use the digital membership QR until .pkpass / Google JWT issuance ships)."
      : "Wallet pass certificates are not configured (APPLE_WALLET_* / GOOGLE_WALLET_*). Digital membership QR is still available.",
    digitalCard,
  };
}

/** Always throws WALLET_NOT_CONFIGURED until signed-pass issuance ships. */
export async function requireMembershipWalletPass(
  input: Parameters<typeof generateMembershipWalletPass>[0]
): Promise<never> {
  const result = await generateMembershipWalletPass(input);
  throw new MembershipBillingError(
    MembershipErrorCodes.WALLET_NOT_CONFIGURED,
    result.message
  );
}
