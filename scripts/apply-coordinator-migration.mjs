/**
 * Apply campaign coordinator hierarchy migration SQL (idempotent).
 * Prefer: yarn db:sync-campaign-schema (includes this + other participant columns).
 * Usage: node scripts/apply-coordinator-migration.mjs
 */
import { execSync } from "node:child_process";

execSync("node scripts/sync-campaign-participant-schema.mjs", {
  stdio: "inherit",
});
