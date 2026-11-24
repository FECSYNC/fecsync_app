import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  /** Bump the key so hot-reload drops a client built before the waiver form columns. */
  prismaFormClient: PrismaClient | undefined;
  prismaDatabaseUrl: string | undefined;
  prismaIpv4ByHost: Record<string, string> | undefined;
};

const databaseUrl = process.env.DATABASE_URL;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Prisma's Rust engine does its own DNS and ignores Node's ipv4first.
 * Windows/DNS64 often returns NAT64 AAAA records (64:ff9b::…) that time out,
 * so admin auth waits on connect_timeout instead of using the working A record.
 *
 * Node 24 on this machine has no dns.lookupSync — resolve IPv4 in a short
 * child process so client creation can stay synchronous.
 */
function lookupIpv4Address(hostname: string): string | null {
  const cached = globalForPrisma.prismaIpv4ByHost?.[hostname];
  if (cached) return cached;
  try {
    const script = `
      const dns = require("node:dns");
      dns.setDefaultResultOrder("ipv4first");
      dns.lookup(${JSON.stringify(hostname)}, { family: 4 }, (err, address) => {
        if (err || !address) process.exit(2);
        process.stdout.write(address);
      });
    `;
    const address = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!IPV4_RE.test(address)) return null;
    globalForPrisma.prismaIpv4ByHost = {
      ...globalForPrisma.prismaIpv4ByHost,
      [hostname]: address,
    };
    return address;
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[prisma] IPv4 DNS pin failed; Prisma may hang on NAT64 IPv6 for",
        hostname
      );
    }
    return null;
  }
}

function pinHostnameToIpv4(url: URL): void {
  const hostname = url.hostname;
  if (!hostname || IPV4_RE.test(hostname) || hostname.startsWith("[")) return;
  const address = lookupIpv4Address(hostname);
  if (!address) return;
  // Preserve original hostname for TLS SNI / cert verification (Supabase pooler).
  if (!url.searchParams.has("host")) {
    url.searchParams.set("host", hostname);
  }
  url.hostname = address;
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
}

/**
 * Dev-only pool defaults for Supabase session pooler.
 * Cap low — session mode max is often ~15 project-wide; Next hot-reload +
 * parallel admin APIs easily blow past a connection_limit of 10.
 */
function prismaDatasourceUrl(): string | undefined {
  if (!databaseUrl) return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (process.env.NODE_ENV !== "production") {
      const isTransactionPooler =
        url.port === "6543" || url.searchParams.get("pgbouncer") === "true";
      // Session pooler: keep Prisma pool tiny. Transaction pooler can share more.
      // Session pooler: slightly higher than 5 so list pages can resolve a few
  // parallel GETs without sitting on pool_timeout (sidebar tables).
  const targetLimit = isTransactionPooler ? 10 : 8;
      const limit = parseInt(url.searchParams.get("connection_limit") ?? "0", 10);
      if (!Number.isFinite(limit) || limit < 1 || limit > targetLimit) {
        url.searchParams.set("connection_limit", String(targetLimit));
      }
      const poolTimeout = parseInt(url.searchParams.get("pool_timeout") ?? "0", 10);
      if (!Number.isFinite(poolTimeout) || poolTimeout < 20) {
        url.searchParams.set("pool_timeout", "20");
      }
      const connectTimeout = parseInt(
        url.searchParams.get("connect_timeout") ?? "0",
        10
      );
      if (!Number.isFinite(connectTimeout) || connectTimeout < 5) {
        url.searchParams.set("connect_timeout", "10");
      }
      // Transaction pooler (6543) requires pgbouncer mode for Prisma.
      if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
        url.searchParams.set("pgbouncer", "true");
      }
    }
    pinHostnameToIpv4(url);
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function createPrismaClient(datasourceUrl?: string): PrismaClient {
  return new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    // Remote Supabase RTT routinely exceeds Prisma's 5s interactive default
    // (memberships redeem/family, venue archive, etc.). Fail closed later, not flaky.
    transactionOptions: {
      maxWait: 10_000,
      timeout: 20_000,
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
}

const resolvedDatabaseUrl = prismaDatasourceUrl();

// Dev hot-reload can change DATABASE_URL — drop stale pool (e.g. 6543 → 5432).
if (
  globalForPrisma.prismaFormClient &&
  globalForPrisma.prismaDatabaseUrl &&
  resolvedDatabaseUrl &&
  globalForPrisma.prismaDatabaseUrl !== resolvedDatabaseUrl
) {
  void globalForPrisma.prismaFormClient.$disconnect();
  globalForPrisma.prismaFormClient = undefined;
}

export const prisma =
  globalForPrisma.prismaFormClient ?? createPrismaClient(resolvedDatabaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaFormClient = prisma;
  globalForPrisma.prismaDatabaseUrl = resolvedDatabaseUrl;
}

export default prisma;
