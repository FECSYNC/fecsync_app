/**
 * Attachable guest-info forms for Membership plan merchandising.
 * The starter catalog in MembershipSettings.other.formsCatalog stays on the picker.
 * Published Digital Waivers form templates are added when that module is enabled.
 */
import { Prisma as PrismaNS } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertMembershipsStaff,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import { FORM_KINDS } from "@/lib/waivers/common";

export type AttachableFormDto = {
  id: string;
  name: string;
};

/** Starter catalog kept on the membership plan picker, including when waiver forms are added. */
export const DEFAULT_ATTACHABLE_FORMS: readonly AttachableFormDto[] = [
  { id: "form_party_booking_details", name: "Party Booking Details" },
  { id: "form_guest_information", name: "Guest information" },
  { id: "form_emergency_contact", name: "Emergency contact" },
] as const;

function parseCatalog(raw: unknown): AttachableFormDto[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachableFormDto[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: id.slice(0, 80), name: name.slice(0, 120) });
  }
  return out;
}

function formsFromEntitlements(entitlements: unknown): AttachableFormDto[] {
  if (
    !entitlements ||
    typeof entitlements !== "object" ||
    Array.isArray(entitlements)
  ) {
    return [];
  }
  const e = entitlements as Record<string, unknown>;
  return parseCatalog(e.attachedForms);
}

async function ensureOrgFormsCatalog(
  orgId: string
): Promise<AttachableFormDto[]> {
  const settings = await prisma.membershipSettings.findFirst({
    where: { orgId, locationId: null },
    select: { id: true, other: true },
  });

  const other =
    settings?.other &&
    typeof settings.other === "object" &&
    !Array.isArray(settings.other)
      ? ({ ...(settings.other as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : ({} as Record<string, unknown>);

  if (Array.isArray(other.formsCatalog)) {
    return parseCatalog(other.formsCatalog);
  }

  const seeded = DEFAULT_ATTACHABLE_FORMS.map((f) => ({ ...f }));
  other.formsCatalog = seeded;

  if (settings?.id) {
    await prisma.membershipSettings.update({
      where: { id: settings.id },
      data: { other: other as PrismaNS.InputJsonValue },
    });
  } else {
    await prisma.membershipSettings.create({
      data: {
        orgId,
        locationId: null,
        other: other as PrismaNS.InputJsonValue,
      },
    });
  }

  return seeded;
}

/**
 * Forms operators can attach to a membership plan.
 * The starter catalog stays available. When Digital Waivers is enabled, published
 * form templates are added beside it. Plan rows already saved stay labeled.
 */
export async function listAttachableForms(
  actor: MembershipsActor
): Promise<AttachableFormDto[]> {
  assertMembershipsStaff(actor, "read");
  const orgId = actor.orgId!;

  const plans = await prisma.membershipPlan.findMany({
    where: { orgId, archivedAt: null },
    select: { entitlements: true },
    take: 200,
  });

  let waiversLive = false;
  try {
    await assertWaiversEnabled(orgId);
    waiversLive = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const byId = new Map<string, AttachableFormDto>();
  for (const form of await ensureOrgFormsCatalog(orgId)) {
    byId.set(form.id, form);
  }
  if (waiversLive) {
    const templates = await prisma.waiverTemplate.findMany({
      where: {
        orgId,
        status: "published",
        archivedAt: null,
        kind: { in: [...FORM_KINDS] },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    for (const row of templates) {
      if (!byId.has(row.id)) byId.set(row.id, { id: row.id, name: row.name });
    }
  }

  for (const plan of plans) {
    for (const form of formsFromEntitlements(plan.entitlements)) {
      if (!byId.has(form.id)) byId.set(form.id, form);
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/**
 * Fail-closed: every formId must appear in the org attachable catalog
 * (starter catalog + published waiver form templates + already-attached labels).
 * Returns deduped ids + denormalized { id, name } rows for entitlements.
 */
export async function resolveAndValidateAttachedForms(
  actor: MembershipsActor,
  formIds: string[] | undefined | null
): Promise<{ formIds: string[]; attachedForms: AttachableFormDto[] }> {
  if (!formIds?.length) return { formIds: [], attachedForms: [] };
  const catalog = await listAttachableForms(actor);
  const byId = new Map(catalog.map((f) => [f.id, f]));
  const unique = Array.from(
    new Set(
      formIds
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);

  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(
      `Form(s) not found in the attachable catalog: ${missing
        .slice(0, 5)
        .join(", ")}`
    );
  }

  const attachedForms = unique.map((id) => byId.get(id)!);
  return { formIds: unique, attachedForms };
}
