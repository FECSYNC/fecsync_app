/**
 * Step 5.3 — create a second Organization fixture for cross-tenant regression.
 *
 * Idempotent: upserts slug `other-org` (not default). Does not change
 * DEFAULT_ORG_ID or migrate catalog. Use with a Membership on that org to
 * verify admin of org A cannot read org B products/orders (403).
 *
 * Alongside self-serve `/register-company` (Phase 4): this script remains a
 * quick ops fixture for cross-tenant checks. `yarn verify-rbac` block L also
 * registers two companies via HTTP `POST /api/auth/register-company` (real cookies).
 *
 * Usage:
 *   yarn ensure-second-org
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

const OTHER_NAME = "Other Org";
const OTHER_SLUG = "other-org";

let org = await prisma.organization.findUnique({ where: { slug: OTHER_SLUG } });
if (!org) {
  org = await prisma.organization.create({
    data: {
      name: OTHER_NAME,
      slug: OTHER_SLUG,
      status: "active",
      isDefault: false,
    },
  });
  console.log(`Created Organization ${OTHER_NAME} (${org.id})`);
} else {
  console.log(`Reused Organization ${OTHER_NAME} (${org.id})`);
}

console.log(`
Cross-tenant checklist (manual):
1. Keep DEFAULT_ORG_ID on the Harewa/default org (org A).
2. Create a product on org A via admin (Membership on A).
3. Set that product.orgId to ${org.id} (org B) OR create a Membership for a second admin on org B and create a product there.
4. As admin of org A: GET /api/product/<org-B-id>?scope=staff → 403 Cross-tenant access denied.
5. Same for GET /api/order/<org-B-order-id> as staff → 403.
6. Public GET /api/product (no scope) still lists DEFAULT_ORG_ID only.
`);

await prisma.$disconnect();
