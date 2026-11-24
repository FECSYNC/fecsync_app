/**
 * Restore RBAC matrix fixture memberships (after accidental platform_admin repair).
 * Usage: node scripts/restore-rbac-matrix-memberships.mjs
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
const envFile = fs.readFileSync(envPath, "utf8");
const uri = envFile
  .match(/^MONGO_URI=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

const restore = [
  ["rbac-matrix-catalog@test.local", "catalog_editor"],
  ["rbac-matrix-finance@test.local", "finance"],
  ["rbac-matrix-rolechange@test.local", "catalog_editor"],
  ["rbac-matrix-ops@test.local", "ops_manager"],
];

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
const users = db.collection("users");
const memberships = db.collection("memberships");

for (const [email, preset] of restore) {
  const u = await users.findOne({ email });
  if (!u) {
    console.log("skip missing", email);
    continue;
  }
  await memberships.updateOne(
    { userId: u._id },
    {
      $set: { rolePreset: preset, status: "active", updatedAt: new Date() },
      $unset: { roleTemplateId: "", permissionsOverride: "" },
    }
  );
  console.log("restored", email, "→", preset);
}

await mongoose.disconnect();
console.log("Done.");
