/**
 * CLI / GitHub reminder run. The daily Vercel cron stays on
 * /api/cron/remind-company-subscriptions, which calls the same function.
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

const { remindExpiringWaivers } = await import("../src/lib/waivers/remindExpiring.ts");

const summary = await remindExpiringWaivers();
console.log(JSON.stringify(summary));
