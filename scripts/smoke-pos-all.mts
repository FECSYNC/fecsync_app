/**
 * Runs step1 then step2 in-process with a cooldown so Supabase pooler recovers.
 *   yarn smoke:pos:all
 */
import { spawn } from "node:child_process";
import { loadDatabaseUrl, root } from "./prisma-env.mjs";

process.env.POS_SMOKE = "1";
if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";
loadDatabaseUrl();

function run(script: string) {
  return new Promise<number>((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", script],
      {
        cwd: root,
        env: {
          ...process.env,
          POS_SMOKE: "1",
          NODE_ENV:
            process.env.NODE_ENV === "production" ? "test" : process.env.NODE_ENV || "test",
        },
        stdio: "inherit",
        shell: true,
      }
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const step1 = await run("scripts/smoke-pos-step1.mts");
if (step1 !== 0) process.exit(step1);
console.log("… cooldown before step2 (pooler) …");
await sleep(20_000);
const step2 = await run("scripts/smoke-pos-step2-fast.mts");
if (step2 !== 0) process.exit(step2);
console.log("… cooldown before audit-fixes (card confirm) …");
await sleep(15_000);
const audit = await run("scripts/smoke-pos-audit-fixes.mts");
if (audit !== 0) process.exit(audit);
console.log("PASS smoke:pos:all");
process.exit(0);
