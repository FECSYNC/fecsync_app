/**
 * Load DATABASE_URL (and DIRECT_URL) from .env.local for standalone scripts.
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, "..");
export const envPath = path.join(root, ".env.local");

export function readEnvFile() {
  if (!fs.existsSync(envPath)) {
    console.error(".env.local not found");
    process.exit(1);
  }
  return fs.readFileSync(envPath, "utf8");
}

export function envValue(file, key) {
  const match = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export function loadDatabaseUrl() {
  const envFile = readEnvFile();
  let url = envValue(envFile, "DATABASE_URL");
  if (!url) {
    console.error("DATABASE_URL not found in .env.local");
    process.exit(1);
  }
  // Smoke scripts share the Supabase pooler with yarn dev — keep client pools tiny.
  if (process.env.POS_SMOKE === "1") {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "2");
      }
      if (!parsed.searchParams.has("pool_timeout")) {
        parsed.searchParams.set("pool_timeout", "60");
      }
      url = parsed.toString();
    } catch {
      /* keep raw url */
    }
  }
  process.env.DATABASE_URL = url;
  const direct = envValue(envFile, "DIRECT_URL");
  if (direct) process.env.DIRECT_URL = direct;
  return url;
}
