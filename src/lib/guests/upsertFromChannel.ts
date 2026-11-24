/**
 * Shared GuestProfile upsert for marketing, bookings, waivers, POS, surveys.
 */
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { setEmailOptIn } from "@/lib/marketing/consent";

export type GuestChannel =
  | "newsletter"
  | "booking"
  | "waiver"
  | "pos"
  | "survey"
  | "manual";

export async function assertVenueInOrg(
  orgId: string,
  locationId: string
): Promise<void> {
  const venue = await prisma.venueLocation.findFirst({
    where: { id: locationId, orgId },
    select: { id: true },
  });
  if (!venue) throw new Error("Venue not found in this company");
}

async function findExistingGuest(
  orgId: string,
  email?: string | null,
  phone?: string | null
) {
  const normalizedEmail = email?.trim().toLowerCase() || null;
  const normalizedPhone = phone?.trim() || null;
  if (normalizedEmail) {
    const byEmail = await prisma.guestProfile.findFirst({
      where: { orgId, email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (byEmail) return byEmail;
  }
  if (normalizedPhone) {
    return prisma.guestProfile.findFirst({
      where: { orgId, phone: normalizedPhone },
    });
  }
  return null;
}

export async function upsertGuestFromChannel(input: {
  orgId: string;
  channel: GuestChannel;
  email?: string | null;
  phone?: string | null;
  firstName: string;
  lastName: string;
  locationId?: string | null;
  dateOfBirth?: Date | null;
  setMarketingOptIn?: boolean;
}): Promise<{ guestProfileId: string; created: boolean }> {
  const orgId = requireId(input.orgId, "orgId");
  const firstName = input.firstName.trim().slice(0, 100);
  const lastName = input.lastName.trim().slice(0, 100);
  if (!firstName || !lastName) {
    throw new Error("firstName and lastName are required");
  }

  let locationId: string | null = input.locationId ?? null;
  if (locationId) {
    if (!isValidId(locationId)) throw new Error("locationId is invalid");
    await assertVenueInOrg(orgId, locationId);
  }

  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  const existing = await findExistingGuest(orgId, email, phone);

  if (existing) {
    await prisma.guestProfile.update({
      where: { id: existing.id },
      data: {
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        dateOfBirth: input.dateOfBirth ?? existing.dateOfBirth,
        locationId: locationId ?? existing.locationId,
      },
    });
    if (input.setMarketingOptIn) {
      await setEmailOptIn({
        orgId,
        guestProfileId: existing.id,
        optedIn: true,
        source: input.channel,
      });
    }
    return { guestProfileId: existing.id, created: false };
  }

  const created = await prisma.guestProfile.create({
    data: {
      orgId,
      locationId,
      firstName,
      lastName,
      email,
      phone,
      dateOfBirth: input.dateOfBirth ?? null,
      ...(input.setMarketingOptIn
        ? {
            marketingEmailOptIn: true,
            marketingOptInAt: new Date(),
            marketingOptInSource: input.channel,
            ...(input.channel === "newsletter"
              ? { newsletterSubscribedAt: new Date() }
              : {}),
          }
        : {}),
    },
  });

  if (input.setMarketingOptIn) {
    await prisma.guestMarketingConsent.create({
      data: {
        orgId,
        guestProfileId: created.id,
        channel: "email",
        optedIn: true,
        source: input.channel,
      },
    });
  }

  return { guestProfileId: created.id, created: true };
}
