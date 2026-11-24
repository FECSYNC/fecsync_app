/**
 * Accounting history backfill CLI.
 *   yarn accounting:backfill --org=<orgId|slug> [--from=YYYY-MM-DD] [--sources=booking,pos,...] [--dry-run]
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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const orgArg = arg("org");
  if (!orgArg) {
    console.error("Usage: yarn accounting:backfill --org=<orgId|slug> [--from=YYYY-MM-DD] [--sources=...] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const prisma = (await import("../src/lib/prisma.ts")).default;
  const { BACKFILL_SOURCES, backfillOrgHistory } = await import("../src/lib/accounting/backfill.ts");

  try {
    const org = await prisma.organization.findFirst({
      where: {
        OR: [{ id: orgArg }, { slug: orgArg }],
      },
      select: { id: true, slug: true, isDefault: true, name: true },
    });
    if (!org) {
      console.error(`[accounting:backfill] Organization not found: ${orgArg}`);
      process.exitCode = 1;
      return;
    }
    if (org.isDefault) {
      console.error("[accounting:backfill] Refuses the storefront (DEFAULT_ORG / isDefault).");
      process.exitCode = 1;
      return;
    }

    const settings = await prisma.accountingSettings.findUnique({
      where: { orgId: org.id },
      select: { enabled: true },
    });
    if (!settings?.enabled) {
      console.error(
        "[accounting:backfill] Refuses uninitialized orgs (AccountingSettings missing or disabled). Run setup first."
      );
      process.exitCode = 1;
      return;
    }

    const fromRaw = arg("from");
    const from = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : undefined;
    if (fromRaw && from && Number.isNaN(from.getTime())) {
      console.error(`[accounting:backfill] Invalid --from date: ${fromRaw}`);
      process.exitCode = 1;
      return;
    }

    const sourcesRaw = arg("sources");
    const sources = sourcesRaw
      ? sourcesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    if (sources) {
      const bad = sources.filter((s) => !(BACKFILL_SOURCES as readonly string[]).includes(s));
      if (bad.length) {
        console.error(`[accounting:backfill] Unknown sources: ${bad.join(", ")}. Allowed: ${BACKFILL_SOURCES.join(",")}`);
        process.exitCode = 1;
        return;
      }
    }

    const dryRun = hasFlag("dry-run");
    console.log(
      `[accounting:backfill] org=${org.slug ?? org.id} (${org.name}) dryRun=${dryRun} from=${from?.toISOString() ?? "(go-live)"} sources=${(sources ?? BACKFILL_SOURCES).join(",")}`
    );

    const result = await backfillOrgHistory(org.id, {
      from,
      sources: sources as typeof BACKFILL_SOURCES[number][] | undefined,
      dryRun,
    });
    console.log(`[accounting:backfill] ${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[accounting:backfill] fatal:", err);
  process.exitCode = 1;
});
