/**
 * Rebuild AccountBalance rows for an org.
 *   yarn accounting:rebuild-balances --org=<orgId|slug>
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const orgArg = arg("org");
  if (!orgArg) {
    console.error("Usage: yarn accounting:rebuild-balances --org=<orgId|slug>");
    process.exitCode = 1;
    return;
  }

  const prisma = (await import("../src/lib/prisma.ts")).default;
  const { rebuildBalances } = await import("../src/lib/accounting/balances.ts");
  const { add, D, toApiString } = await import("../src/lib/accounting/money.ts");

  try {
    const org = await prisma.organization.findFirst({
      where: { OR: [{ id: orgArg }, { slug: orgArg }] },
      select: { id: true, slug: true, isDefault: true, name: true },
    });
    if (!org) {
      console.error(`[accounting:rebuild-balances] Organization not found: ${orgArg}`);
      process.exitCode = 1;
      return;
    }
    if (org.isDefault) {
      console.error("[accounting:rebuild-balances] Refuses the storefront (DEFAULT_ORG / isDefault).");
      process.exitCode = 1;
      return;
    }

    const settings = await prisma.accountingSettings.findUnique({ where: { orgId: org.id } });
    if (!settings?.enabled) {
      console.error("[accounting:rebuild-balances] Accounting is not initialized for this organization.");
      process.exitCode = 1;
      return;
    }

    const beforeRows = await prisma.accountBalance.findMany({
      where: { orgId: org.id },
      select: { debitTotal: true, creditTotal: true },
    });
    let beforeDebit = D(0);
    let beforeCredit = D(0);
    for (const r of beforeRows) {
      beforeDebit = add(beforeDebit, r.debitTotal);
      beforeCredit = add(beforeCredit, r.creditTotal);
    }

    console.log(
      `[accounting:rebuild-balances] org=${org.slug ?? org.id} before rows=${beforeRows.length} debit=${toApiString(beforeDebit)} credit=${toApiString(beforeCredit)}`
    );

    const result = await rebuildBalances(org.id);

    const afterRows = await prisma.accountBalance.findMany({
      where: { orgId: org.id },
      select: { debitTotal: true, creditTotal: true },
    });
    let afterDebit = D(0);
    let afterCredit = D(0);
    for (const r of afterRows) {
      afterDebit = add(afterDebit, r.debitTotal);
      afterCredit = add(afterCredit, r.creditTotal);
    }

    console.log(
      `[accounting:rebuild-balances] done periods=${result.periods} rows=${result.rows} after debit=${toApiString(afterDebit)} credit=${toApiString(afterCredit)}`
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[accounting:rebuild-balances] fatal:", err);
  process.exitCode = 1;
});
