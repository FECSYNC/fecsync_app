/**
 * Accounting maintenance CLI (posting queue, revenue recognition, reminders, digests).
 *   yarn accounting:maintenance
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

async function main() {
  const { runAccountingMaintenance } = await import("../src/lib/accounting/maintenance.ts");
  const prisma = (await import("../src/lib/prisma.ts")).default;
  try {
    const summary = await runAccountingMaintenance();
    console.log(`[accounting] ${JSON.stringify(summary)}`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[accounting] fatal:", err);
  process.exitCode = 1;
});
