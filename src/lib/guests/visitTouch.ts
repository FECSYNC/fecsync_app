import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { upsertGuestFromChannel } from "@/lib/guests/upsertFromChannel";

function parseGuestName(name?: string | null): {
  firstName: string;
  lastName: string;
} {
  const raw = (name ?? "").trim();
  if (!raw) return { firstName: "Guest", lastName: "Visitor" };
  const parts = raw.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "—" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

export async function touchGuestVisit(input: {
  orgId: string;
  guestProfileId: string;
  at?: Date;
}): Promise<{ firstVisit: boolean }> {
  const orgId = requireId(input.orgId, "orgId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const at = input.at ?? new Date();

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
    select: { id: true, firstVisitAt: true },
  });
  if (!guest) throw new Error("Guest not found");

  const firstVisit = !guest.firstVisitAt;
  await prisma.guestProfile.update({
    where: { id: guestProfileId },
    data: {
      firstVisitAt: guest.firstVisitAt ?? at,
      lastVisitAt: at,
    },
  });
  return { firstVisit };
}

export async function touchGuestVisitFromBookingContact(input: {
  orgId: string;
  locationId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  at?: Date;
}): Promise<{ guestProfileId: string; firstVisit: boolean }> {
  const orgId = requireId(input.orgId, "orgId");
  const email = input.email.trim();
  if (!email) throw new Error("email is required");

  const { firstName, lastName } = parseGuestName(input.name);
  const { guestProfileId } = await upsertGuestFromChannel({
    orgId,
    channel: "booking",
    email,
    phone: input.phone,
    firstName,
    lastName,
    locationId: input.locationId,
  });

  const { firstVisit } = await touchGuestVisit({
    orgId,
    guestProfileId,
    at: input.at,
  });

  return { guestProfileId, firstVisit };
}
