import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

export async function setEmailOptIn(input: {
  orgId: string;
  guestProfileId: string;
  optedIn: boolean;
  source?: string;
}): Promise<void> {
  const orgId = requireId(input.orgId, "orgId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const now = new Date();

  await prisma.$transaction([
    prisma.guestProfile.updateMany({
      where: { id: guestProfileId, orgId },
      data: {
        marketingEmailOptIn: input.optedIn,
        marketingOptInAt: input.optedIn ? now : null,
        marketingOptInSource: input.optedIn
          ? (input.source?.trim().slice(0, 120) ?? null)
          : null,
        ...(input.optedIn && input.source === "newsletter"
          ? { newsletterSubscribedAt: now }
          : {}),
      },
    }),
    prisma.guestMarketingConsent.upsert({
      where: {
        orgId_guestProfileId_channel: {
          orgId,
          guestProfileId,
          channel: "email",
        },
      },
      create: {
        orgId,
        guestProfileId,
        channel: "email",
        optedIn: input.optedIn,
        source: input.source?.trim().slice(0, 120) ?? null,
        capturedAt: now,
      },
      update: {
        optedIn: input.optedIn,
        source: input.source?.trim().slice(0, 120) ?? null,
      },
    }),
  ]);
}

export function isPromotionalEmailAllowed(guest: {
  marketingEmailOptIn: boolean;
  bannedAt: Date | null;
  email?: string | null;
}): boolean {
  if (guest.bannedAt) return false;
  if (!guest.marketingEmailOptIn) return false;
  return Boolean(guest.email?.trim());
}
