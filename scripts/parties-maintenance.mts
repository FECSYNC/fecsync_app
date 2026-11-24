/**
 * Party maintenance CLI (holds, invitation expiry, balance reminders, no-shows).
 *   yarn parties:maintenance
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

async function main() {
  const { runPartyMaintenance } = await import("../src/lib/parties/maintenance.ts");
  const prisma = (await import("../src/lib/prisma.ts")).default;
  try {
    const summary = await runPartyMaintenance();
    console.log(`[parties] ${JSON.stringify(summary)}`);
    if (Object.values(summary).some((p) => "error" in p)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[parties] fatal:", err);
  process.exitCode = 1;
});
