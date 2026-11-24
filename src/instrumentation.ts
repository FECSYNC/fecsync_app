export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    // Some local networks fail mongodb+srv SRV lookups on the router DNS.
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    dns.setDefaultResultOrder("ipv4first");
    // Pin DATABASE_URL to IPv4 before any Prisma import (engine ignores ipv4first).
    const { pinProcessDatabaseUrlsToIpv4 } = await import(
      "@/lib/pinDatabaseUrlIpv4"
    );
    await pinProcessDatabaseUrlsToIpv4();

    // Phase 1 / STEP 6 — ensure ShippingSettings for DEFAULT_ORG_ID (Lagos placeholder).
    // Fire-and-forget: a slow/unreachable DB must not hang the Next.js request loop
    // (symptoms: Ready banner, then blank pages because /home + CSS never finish).
    void import("@/lib/shipping/seedDefaults")
      .then(({ seedDefaultShippingSettings }) => seedDefaultShippingSettings())
      .catch((err) => {
        console.warn(
          "[shipping] ensureDefaultShippingSettings on boot failed:",
          err instanceof Error ? err.message : err
        );
      });
  }
}
