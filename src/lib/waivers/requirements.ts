import type { WaiverLinkTargetType, WaiverRequirementEnforcement } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId, requireId } from "@/lib/ids";
import {
  assertMutableWaiverLocation,
  assertWaiversStaff,
  rejectClientOrgFields,
  requireActorVenueInScope,
  waiverListLocationWhere,
  type WaiversActor,
} from "@/lib/waivers/common";
import { requireTemplate } from "@/lib/waivers/templates";

const TARGETS = new Set([
  "guest",
  "booking",
  "party_guest",
  "pos_sale",
  "admission_product",
  "pos_product",
  "membership_plan",
  "party_package",
  "all_admissions",
  "other",
]);

export type WaiverRequirementDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  templateId: string;
  templateName: string;
  targetType: WaiverLinkTargetType;
  targetId: string | null;
  enforcement: WaiverRequirementEnforcement;
  required: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export async function listWaiverRequirements(
  actor: WaiversActor
): Promise<WaiverRequirementDto[]> {
  const orgId = await assertWaiversStaff(actor);
  const loc = await waiverListLocationWhere(actor);
  const rows = await prisma.waiverRequirement.findMany({
    where: { orgId, ...loc },
    include: { template: { select: { name: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    templateId: row.templateId,
    templateName: row.template.name,
    targetType: row.targetType,
    targetId: row.targetId,
    enforcement: row.enforcement,
    required: row.required,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createWaiverRequirement(
  actor: WaiversActor,
  body: unknown
): Promise<WaiverRequirementDto> {
  await assertWaiversStaff(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid requirement body");
  }
  const b = body as Record<string, unknown>;
  const template = await requireTemplate(actor, String(b.templateId ?? ""));
  let locationId: string | null = null;
  if (typeof b.locationId === "string" && b.locationId.trim()) {
    await requireActorVenueInScope(actor, b.locationId.trim());
    locationId = b.locationId.trim();
  }
  await assertMutableWaiverLocation(actor, locationId);
  if (template.locationId && locationId !== template.locationId) {
    throw new Error(
      "This template belongs to one venue. The requirement must use that same venue"
    );
  }
  if (
    template.status !== "published" ||
    template.archivedAt ||
    !template.currentPublishedVersionId
  ) {
    throw new Error("Publish the template before attaching a requirement");
  }
  const targetType = String(b.targetType ?? "");
  if (!TARGETS.has(targetType)) throw new Error("Invalid requirement target");
  if (targetType !== "all_admissions" && targetType !== "guest") {
    if (typeof b.targetId !== "string" || !b.targetId.trim()) {
      throw new Error("targetId is required for this target type");
    }
  }
  const targetId =
    typeof b.targetId === "string" && b.targetId.trim() ? b.targetId.trim() : null;
  if (targetId && !isValidId(targetId)) {
    throw new Error("targetId is not a valid id");
  }
  if (targetType === "admission_product" && targetId) {
    const product = await prisma.admissionProduct.findFirst({
      where: { id: targetId, orgId: template.orgId },
      select: { id: true, locationId: true, archivedAt: true },
    });
    if (!product) throw new ForbiddenError("Admission product not found");
    if (product.archivedAt) throw new Error("That admission product is archived");
    if (locationId && locationId !== product.locationId) {
      throw new Error("Requirement venue must match the admission product venue");
    }
    if (template.locationId && template.locationId !== product.locationId) {
      throw new Error("This template is not for the admission product's venue");
    }
  }
  if (targetType === "membership_plan" && targetId) {
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: targetId, orgId: template.orgId },
      select: { id: true, locationId: true, archivedAt: true },
    });
    if (!plan) throw new ForbiddenError("Membership plan not found");
    if (plan.archivedAt) throw new Error("That membership plan is archived");
    if (plan.locationId && locationId && locationId !== plan.locationId) {
      throw new Error("Requirement venue must match the membership plan venue");
    }
    if (template.locationId && plan.locationId && template.locationId !== plan.locationId) {
      throw new Error("This template is not for the membership plan's venue");
    }
  }
  const duplicate = await prisma.waiverRequirement.findFirst({
    where: {
      orgId: template.orgId,
      templateId: template.id,
      locationId,
      targetType: targetType as WaiverLinkTargetType,
      targetId,
    },
    select: { id: true },
  });
  if (duplicate) throw new Error("That waiver requirement already exists");
  const enforcement = b.enforcement === "warn" ? "warn" : "block";
  const sortOrder = Number.isInteger(b.sortOrder) ? Number(b.sortOrder) : 0;

  const row = await prisma.waiverRequirement.create({
    data: {
      orgId: template.orgId,
      locationId,
      templateId: template.id,
      targetType: targetType as WaiverLinkTargetType,
      targetId,
      enforcement,
      required: b.required !== false,
      sortOrder,
    },
    include: { template: { select: { name: true } } },
  });
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    templateId: row.templateId,
    templateName: row.template.name,
    targetType: row.targetType,
    targetId: row.targetId,
    enforcement: row.enforcement,
    required: row.required,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteWaiverRequirement(
  actor: WaiversActor,
  requirementId: string
): Promise<void> {
  const orgId = await assertWaiversStaff(actor);
  const id = requireId(requirementId, "requirementId");
  const row = await prisma.waiverRequirement.findFirst({
    where: { id, orgId },
  });
  if (!row) throw new ForbiddenError("Waiver requirement not found");
  await assertMutableWaiverLocation(actor, row.locationId);
  await prisma.waiverRequirement.delete({ where: { id: row.id } });
}
