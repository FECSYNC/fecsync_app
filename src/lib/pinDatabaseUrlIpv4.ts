import { lookup } from "node:dns/promises";

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const URL_KEYS = ["DATABASE_URL", "DIRECT_URL"] as const;

/**
 * Rewrite a Postgres URL so Prisma connects to an A record.
 * Prisma's engine ignores Node ipv4first and can hang on NAT64 AAAA (64:ff9b::).
 * Keep the original hostname in `host` so TLS SNI / cert checks still work
 * (required for Supabase pooler when the URL host is rewritten to an IP).
 */
export async function pinPostgresUrlToIpv4(databaseUrl: string): Promise<string> {
  try {
    const url = new URL(databaseUrl);
    const hostname = url.hostname;
    if (!hostname || IPV4_RE.test(hostname) || hostname.startsWith("[")) {
      return databaseUrl;
    }
    const { address } = await lookup(hostname, { family: 4 });
    if (!IPV4_RE.test(address)) return databaseUrl;
    url.hostname = address;
    if (!url.searchParams.has("host")) {
      url.searchParams.set("host", hostname);
    }
    if (!url.searchParams.has("sslmode")) {
      url.searchParams.set("sslmode", "require");
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

/** Mutate process env before PrismaClient is constructed. */
export async function pinProcessDatabaseUrlsToIpv4(): Promise<void> {
  for (const key of URL_KEYS) {
    const raw = process.env[key];
    if (!raw) continue;
    process.env[key] = await pinPostgresUrlToIpv4(raw);
  }
}
