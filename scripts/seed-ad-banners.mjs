/**
 * Reset Trending Fashion ad banners to 3 clean demo slides.
 * Usage: node scripts/seed-ad-banners.mjs
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.local");

function readEnvFile() {
  if (!fs.existsSync(envPath)) {
    console.error(".env.local not found");
    process.exit(1);
  }
  return fs.readFileSync(envPath, "utf8");
}

function envValue(file, key) {
  const match = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const envFile = readEnvFile();
const uri = envValue(envFile, "MONGO_URI");
if (!uri) {
  console.error("MONGO_URI not found in .env.local");
  process.exit(1);
}

const DEFAULT_SLUG = "harewa";

const BANNERS = [
  {
    image: "/fast/h2.webp",
    heading: "New Season Prints",
    paragraph:
      "Explore vibrant Ankara and ready-to-wear looks crafted for every celebration.",
    href: "/shop",
    order: 0,
    active: true,
  },
  {
    image: "/fast/w1.webp",
    heading: "Custom Tailoring",
    paragraph:
      "Bring your fabric — we'll style, fit, and finish a look that's uniquely yours.",
    href: "/customize",
    order: 1,
    active: true,
  },
  {
    image: "/fast/w3.webp",
    heading: "Premium Fabrics",
    paragraph:
      "Shop exclusive Woodin and signature prints with free styling tips in-store.",
    href: "/fabrics",
    order: 2,
    active: true,
  },
];

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;

const orgs = db.collection("organizations");
let org =
  (await orgs.findOne({ isDefault: true })) ||
  (await orgs.findOne({ slug: DEFAULT_SLUG })) ||
  (await orgs.findOne({}));

if (!org?._id) {
  console.error("No organization found. Run yarn ensure-default-org first.");
  process.exit(1);
}

const banners = db.collection("adbanners");
const locks = db.collection("adbannerseedlocks");
const deleted = await banners.deleteMany({ orgId: org._id });
const now = new Date();
await banners.insertMany(
  BANNERS.map((b) => ({
    orgId: org._id,
    ...b,
    createdAt: now,
    updatedAt: now,
  }))
);
await locks.updateOne(
  { orgId: org._id },
  { $setOnInsert: { orgId: org._id, createdAt: now, updatedAt: now } },
  { upsert: true }
);

const count = await banners.countDocuments({ orgId: org._id });
console.log(
  `Reset ad banners for org ${org.name || org.slug}: removed ${deleted.deletedCount}, now ${count}`
);
await mongoose.disconnect();
