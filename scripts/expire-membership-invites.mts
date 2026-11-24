import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

async function main() {
  const { expireOverdueMembershipInvites } = await import(
    "../src/lib/membershipInvites.ts"
  );
  const prisma = (await import("../src/lib/prisma.ts")).default;
  try {
    const summary = await expireOverdueMembershipInvites();
    console.log("[expire-invites] summary", summary);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[expire-invites] fatal:", err);
  process.exit(1);
});
