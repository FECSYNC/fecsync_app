import { upsertGuestFromChannel } from "@/lib/guests/upsertFromChannel";
import { setEmailOptIn } from "@/lib/marketing/consent";
import { requireId } from "@/lib/ids";

export async function upsertNewsletterLead(input: {
  orgId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  locationId?: string | null;
  source: string;
}): Promise<{ guestProfileId: string; created: boolean }> {
  const orgId = requireId(input.orgId, "orgId");
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid email is required");

  const firstName = (input.firstName?.trim() || "Newsletter").slice(0, 100);
  const lastName = (input.lastName?.trim() || "Subscriber").slice(0, 100);

  const result = await upsertGuestFromChannel({
    orgId,
    channel: "newsletter",
    email,
    phone: input.phone,
    firstName,
    lastName,
    locationId: input.locationId,
    dateOfBirth: input.dateOfBirth,
    setMarketingOptIn: true,
  });

  await setEmailOptIn({
    orgId,
    guestProfileId: result.guestProfileId,
    optedIn: true,
    source: input.source?.trim().slice(0, 120) || "newsletter",
  });

  return result;
}
