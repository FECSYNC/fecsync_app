/**
 * POS → party engine. The saleEngine party_package_proxy branch and
 * /api/pos/bookings party creates call this — there is no second party
 * create path. POS terminal PARTY button UI is not part of this module.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { createParty, editParty, parseEditPartyBody } from "@/lib/parties/partyEngine";
import { effectivePackageConfig, requireBookablePackage } from "@/lib/parties/packages";
import { resolvePartySettings } from "@/lib/parties/settings";
import type { PartyActor } from "@/lib/parties/gate";

function modifierObject(modifiers: unknown): Record<string, unknown> {
  return modifiers && typeof modifiers === "object" && !Array.isArray(modifiers)
    ? (modifiers as Record<string, unknown>)
    : {};
}

function count(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function isPartyPackageProduct(orgId: string, admissionProductId: string | null | undefined) {
  if (!admissionProductId || !isValidId(admissionProductId)) return false;
  const p = await prisma.admissionProduct.findFirst({
    where: { id: admissionProductId, orgId },
    select: { type: true },
  });
  return p?.type === "party_package";
}

/**
 * Party from a POS cart line. Counts / names ride on line modifiers
 * (`partyKidCount`, `partyAdultCount`, `partyName`, `honoreeName`); missing
 * counts default to the package's included heads.
 */
export async function createPartyFromPos(
  actor: PartyActor,
  opts: {
    locationId: string;
    admissionProductId: string;
    sessionId?: string | null;
    modifiers?: unknown;
    guestName?: string | null;
    guestEmail?: string | null;
    guestPhone?: string | null;
    holdIds?: string[];
  }
) {
  const orgId = String(actor.orgId ?? "");
  const pkg = await requireBookablePackage(orgId, opts.locationId, opts.admissionProductId);
  const settings = await resolvePartySettings(orgId, opts.locationId);
  const effective = effectivePackageConfig(pkg, settings);
  const m = modifierObject(opts.modifiers);
  const kidCount = count(m.partyKidCount) ?? effective.includedKids;
  const adultCount = count(m.partyAdultCount) ?? effective.includedAdults;
  const name = opts.guestName?.trim() || "POS guest";
  return createParty(actor, {
    channel: "pos",
    locationId: opts.locationId,
    productId: pkg.id,
    sessionId: opts.sessionId ?? null,
    kidCount,
    adultCount,
    partyName: typeof m.partyName === "string" && m.partyName.trim() ? m.partyName.trim() : `${name} party`,
    honoreeName: typeof m.honoreeName === "string" && m.honoreeName.trim() ? m.honoreeName.trim() : null,
    contact: {
      name,
      email: opts.guestEmail?.trim().toLowerCase() || null,
      phone: opts.guestPhone?.trim() || null,
    },
    notes: "POS sale",
    holdIds: opts.holdIds,
  });
}

/** POS booking edit on a party booking → party engine edit (same validation as staff). */
export async function editPartyFromPos(actor: PartyActor, bookingId: string, body: unknown) {
  return editParty(actor, bookingId, parseEditPartyBody(body));
}
