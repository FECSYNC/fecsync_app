/**
 * Phase 1 smoke (delegates to live helper smoke).
 * Do not inline Organization+Membership here — that drifts from
 * createOrganizationWithPlatformAdmin (authzVersion / JTI / transaction).
 *
 * Usage:
 *   node scripts/smoke-org-registration-phase1.mjs
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(scriptsDir, "..");
// Relative path + cwd avoids Windows path-with-spaces breaking npx/tsx argv.
const helperRel = path.join("scripts", "smoke-org-registration-helper.mts");

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", helperRel],
  {
    stdio: "inherit",
    shell: true,
    cwd: projectRoot,
  }
);

process.exit(result.status ?? 1);
