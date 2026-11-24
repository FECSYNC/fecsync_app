import prisma from "@/lib/prisma";
import { getStorefrontOrgId } from "@/lib/org";
import { assertMarketingEnabled } from "@/lib/marketing/assert";

export async function resolvePublicMarketingOrgId(orgSlug: string): Promise<string> {
  const slug = orgSlug.trim().toLowerCase();
  if (!slug) throw new Error("Company not found");

  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, isDefault: true, status: true },
  });
  if (!org || org.isDefault) {
    throw new Error("Company not found");
  }
  if (org.status !== "active") {
    throw new Error("Company is not accepting signups");
  }

  const storefrontId = await getStorefrontOrgId();
  if (org.id === storefrontId) {
    throw new Error("Company not found");
  }

  await assertMarketingEnabled(org.id);
  return org.id;
}
