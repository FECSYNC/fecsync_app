import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { PrismaClient } = await import("@prisma/client");
const wallet = await import("../src/lib/memberships/walletPass.ts");
const p = new PrismaClient();

process.env.APPLE_WALLET_PASS_TYPE_ID = "x";
process.env.APPLE_WALLET_TEAM_ID = "x";
process.env.APPLE_WALLET_PASS_CERT = "x";
process.env.APPLE_WALLET_PASS_KEY = "x";

if (wallet.isWalletPassConfigured() !== false) {
  console.error("FAIL isWalletPassConfigured");
  process.exit(1);
}

const m = await p.guestMembership.findFirst({
  select: { id: true, orgId: true },
});
if (!m) {
  console.log("PASS wallet-static-only (no member row to exercise generate)");
  await p.$disconnect();
  process.exit(0);
}

const r = await wallet.generateMembershipWalletPass({
  orgId: m.orgId,
  guestMembershipId: m.id,
});
const ok =
  r.status === "not_configured" &&
  !("downloadUrl" in r) &&
  !("payload" in r);
console.log(ok ? "PASS generate-never-ready" : "FAIL", r.status);
await p.$disconnect();
process.exit(ok ? 0 : 1);
