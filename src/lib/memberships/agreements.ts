/**
 * Membership agreements — minimal accept/store (Feature 08 Phase 4).
 * Staff Digital Waivers templates are live on Growth+. This record is not a WaiverRecord
 * and does not capture a guest waiver signature.
 * When plan.agreementRequired or settings.requireAgreementBeforeActive,
 * sell leaves membership pending until signed.
 */
import type { MembershipAgreement } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  type MembershipsActor,
} from "@/lib/memberships/common";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { assertMembershipTransition } from "@/lib/memberships/statusMachine";
import { sendGuestMembershipAgreementEmail } from "@/lib/memberships/mail";
import { assertOwnGuestMembership } from "@/lib/memberships/guestAuth";
import { membershipRequiresAgreementGate } from "@/lib/memberships/activationGates";
import {
  sanitizeMembershipHtml,
  toMembershipRichTextEditorHtml,
} from "@/lib/memberships/richText";

/** Snapshot plan terms into agreement storage (HTML-safe; legacy plain kept readable). */
function agreementBodyFromPlanTerms(
  termsAndConditions: string | null | undefined
): string {
  const raw = termsAndConditions?.trim();
  if (!raw) return DEFAULT_AGREEMENT_TEXT;
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeMembershipHtml(raw) || DEFAULT_AGREEMENT_TEXT;
  }
  return toMembershipRichTextEditorHtml(raw) || DEFAULT_AGREEMENT_TEXT;
}

const AGREEMENT_BODY_VERSION = "membership_agreement_v1";

const DEFAULT_AGREEMENT_TEXT =
  "I agree to the park membership terms, house rules, and recurring billing (if applicable). " +
  "This is an electronic acceptance record for the membership. A Digital Waivers contract, when your park uses one, is signed separately and is not created by this acceptance.";

/** Shown on membership agreement rows. Staff waiver templates exist; this path is not that signature. */
export const AGREEMENT_HONESTY_NOTE =
  "Membership acceptance is stored on this membership. The contract can be signed through Digital Waivers. This sale does not create that signature.";

export type AgreementDto = {
  id: string;
  orgId: string;
  guestMembershipId: string | null;
  guestProfileId: string;
  planId: string | null;
  status: string;
  signedAt: string | null;
  bodyVersion: string | null;
  storageRef: string | null;
  honestyNote: string;
};

function toDto(row: MembershipAgreement): AgreementDto {
  return {
    id: row.id,
    orgId: row.orgId,
    guestMembershipId: row.guestMembershipId,
    guestProfileId: row.guestProfileId,
    planId: row.planId,
    status: row.status,
    signedAt: row.signedAt?.toISOString() ?? null,
    bodyVersion: row.bodyVersion,
    storageRef: row.storageRef,
    honestyNote: AGREEMENT_HONESTY_NOTE,
  };
}

/** Same gate as activationGates — single source for sell / sign / redeem. */
export async function membershipRequiresAgreement(input: {
  orgId: string;
  planId: string;
  locationId: string;
}): Promise<boolean> {
  return membershipRequiresAgreementGate(input);
}

/**
 * Create draft agreement + optional email. Staff or sell path.
 */
export async function createDraftAgreement(input: {
  orgId: string;
  guestMembershipId: string;
  actorUserId?: string | null;
  notifyGuest?: boolean;
}): Promise<AgreementDto> {
  const orgId = requireId(input.orgId, "orgId");
  const guestMembershipId = requireId(
    input.guestMembershipId,
    "guestMembershipId"
  );
  const member = await prisma.guestMembership.findFirst({
    where: { id: guestMembershipId, orgId },
    include: {
      guestProfile: { select: { email: true, firstName: true } },
      plan: { select: { name: true, agreementRequired: true, termsAndConditions: true } },
    },
  });
  if (!member) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "Guest membership not found"
    );
  }

  const agreementBody = agreementBodyFromPlanTerms(
    member.plan.termsAndConditions
  );

  const existing = await prisma.membershipAgreement.findFirst({
    where: {
      orgId,
      guestMembershipId,
      status: { in: ["draft", "signed"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.status === "signed") return toDto(existing);

  const row =
    existing ??
    (await prisma.membershipAgreement.create({
      data: {
        orgId,
        guestMembershipId,
        guestProfileId: member.guestProfileId,
        planId: member.planId,
        status: "draft",
        bodyVersion: AGREEMENT_BODY_VERSION,
        storageRef: agreementBody,
      },
    }));

  if (input.notifyGuest && member.guestProfile.email) {
    void sendGuestMembershipAgreementEmail({
      to: member.guestProfile.email,
      guestName: member.guestProfile.firstName,
      planName: member.plan.name,
    }).catch((err) =>
      console.warn("[memberships] agreement email failed", err)
    );
  }

  if (input.actorUserId) {
    logStaffActivityEntry(
      { sub: input.actorUserId, orgId },
      {
        action: "memberships.agreement.draft",
        entityType: "MembershipAgreement",
        entityId: row.id,
        description: "Created membership agreement draft",
      }
    );
  }

  return toDto(row);
}

export async function signAgreementAsGuest(input: {
  actor: { sub: string };
  guestMembershipId: string;
  accepted: boolean;
  bodyVersion?: string;
}): Promise<{ agreement: AgreementDto; membershipStatus: string }> {
  if (!input.accepted) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AGREEMENT_REQUIRED,
      "Agreement acceptance is required"
    );
  }
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );

  let agreement = await prisma.membershipAgreement.findFirst({
    where: {
      orgId: member.orgId,
      guestMembershipId: member.id,
      status: { in: ["draft", "signed"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!agreement) {
    const terms = agreementBodyFromPlanTerms(member.plan.termsAndConditions);
    agreement = await prisma.membershipAgreement.create({
      data: {
        orgId: member.orgId,
        guestMembershipId: member.id,
        guestProfileId: member.guestProfileId,
        planId: member.planId,
        status: "draft",
        bodyVersion: AGREEMENT_BODY_VERSION,
        storageRef: terms,
      },
    });
  }

  if (agreement.status === "signed" && member.agreementSignedAt) {
    return { agreement: toDto(agreement), membershipStatus: member.status };
  }

  const now = new Date();
  const signed = await prisma.membershipAgreement.update({
    where: { id: agreement.id },
    data: {
      status: "signed",
      signedAt: now,
      bodyVersion: input.bodyVersion?.slice(0, 64) || AGREEMENT_BODY_VERSION,
    },
  });

  let nextStatus = member.status;
  // Activate pending only when payment is settled — unsigned→signed must not
  // activate Stripe incomplete / unpaid pending memberships.
  if (member.status === "pending") {
    const { membershipPaymentSettled } = await import(
      "@/lib/memberships/activationGates"
    );
    const paid = await membershipPaymentSettled({
      orgId: member.orgId,
      guestMembershipId: member.id,
    });
    if (paid) {
      assertMembershipTransition("pending", "active");
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          agreementSignedAt: now,
          agreementRecordId: signed.id,
          status: "active",
          // Pending cannot schedule EOP cancel via API; clear any stale flag
          // left by older past_due→pending recoveries.
          cancelAtPeriodEnd: false,
          cancelReason: null,
        },
      });
      nextStatus = "active";
    } else {
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          agreementSignedAt: now,
          agreementRecordId: signed.id,
        },
      });
    }
  } else {
    await prisma.guestMembership.update({
      where: { id: member.id },
      data: {
        agreementSignedAt: now,
        agreementRecordId: signed.id,
      },
    });
  }

  logStaffActivityEntry(
    { sub: input.actor.sub, orgId: member.orgId },
    {
      action: "memberships.agreement.sign",
      entityType: "MembershipAgreement",
      entityId: signed.id,
      description: "Guest accepted membership agreement",
    }
  );

  return { agreement: toDto(signed), membershipStatus: nextStatus };
}

/** Staff can record acceptance at the desk (in-person). */
export async function signAgreementAsStaff(
  actor: MembershipsActor,
  guestMembershipId: string,
  body: unknown
): Promise<{ agreement: AgreementDto; membershipStatus: string }> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(guestMembershipId, "guestMembershipId");
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (rec.accepted !== true) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AGREEMENT_REQUIRED,
      "accepted:true is required"
    );
  }

  const member = await prisma.guestMembership.findFirst({
    where: { id, orgId },
  });
  if (!member) throw new ForbiddenError("Guest membership not found");

  const draft = await createDraftAgreement({
    orgId,
    guestMembershipId: id,
    actorUserId: actor.sub,
  });

  const now = new Date();
  const signed = await prisma.membershipAgreement.update({
    where: { id: draft.id },
    data: {
      status: "signed",
      signedAt: now,
      bodyVersion: AGREEMENT_BODY_VERSION,
    },
  });

  let nextStatus = member.status;
  if (member.status === "pending") {
    const { membershipPaymentSettled } = await import(
      "@/lib/memberships/activationGates"
    );
    const paid = await membershipPaymentSettled({
      orgId: member.orgId,
      guestMembershipId: member.id,
    });
    if (paid) {
      assertMembershipTransition("pending", "active");
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          agreementSignedAt: now,
          agreementRecordId: signed.id,
          status: "active",
          cancelAtPeriodEnd: false,
          cancelReason: null,
        },
      });
      nextStatus = "active";
    } else {
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          agreementSignedAt: now,
          agreementRecordId: signed.id,
        },
      });
    }
  } else {
    await prisma.guestMembership.update({
      where: { id: member.id },
      data: {
        agreementSignedAt: now,
        agreementRecordId: signed.id,
      },
    });
  }

  logStaffActivityEntry(actor, {
    action: "memberships.agreement.sign_staff",
    entityType: "MembershipAgreement",
    entityId: signed.id,
    description: "Staff recorded membership agreement acceptance",
  });

  return { agreement: toDto(signed), membershipStatus: nextStatus };
}

export async function getAgreementForMembership(
  orgId: string,
  guestMembershipId: string
): Promise<AgreementDto | null> {
  if (!isValidId(guestMembershipId)) return null;
  const row = await prisma.membershipAgreement.findFirst({
    where: { orgId, guestMembershipId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toDto(row) : null;
}

export { DEFAULT_AGREEMENT_TEXT, AGREEMENT_BODY_VERSION };
