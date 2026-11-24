/**
 * Drop legacy unique index on wallets.transactions.reference that blocks
 * wallet creation when multiple docs have null/missing references.
 * Backfills missing transaction references, then ensures sparse unique index.
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
const envFile = fs.readFileSync(envPath, "utf8");
const uri = envFile.match(/^MONGO_URI=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");

if (!uri) {
  console.warn(
    "Wallet index fix skipped (legacy Mongo helper; app uses Prisma/Postgres — DATABASE_URL)."
  );
  process.exit(0);
}

let mongoose;
try {
  mongoose = (await import("mongoose")).default;
} catch {
  console.warn("Wallet index fix skipped (mongoose not installed — Prisma-only dev)");
  process.exit(0);
}

function txnRef() {
  return `txn-${crypto.randomBytes(8).toString("hex")}`;
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
} catch (err) {
  console.warn("Wallet index fix skipped (Mongo unavailable):", err instanceof Error ? err.message : err);
  process.exit(0);
}
const db = mongoose.connection.db;
const wallets = db.collection("wallets");

const indexes = await wallets.indexes();
for (const idx of indexes) {
  const key = idx.key?.["transactions.reference"];
  if (key !== 1 || !idx.unique) continue;
  // Keep the intended sparse unique index; drop legacy non-sparse index only.
  if (idx.name === "transactions_reference_unique_sparse") continue;
  console.log(`Dropping legacy unique index: ${idx.name}`);
  await wallets.dropIndex(idx.name);
}

const cursor = wallets.find({});
let fixed = 0;
while (await cursor.hasNext()) {
  const doc = await cursor.next();
  if (!Array.isArray(doc.transactions) || doc.transactions.length === 0) continue;
  let dirty = false;
  for (const tx of doc.transactions) {
    if (!tx.reference) {
      tx.reference = txnRef();
      dirty = true;
      fixed++;
    }
  }
  if (dirty) {
    await wallets.updateOne({ _id: doc._id }, { $set: { transactions: doc.transactions } });
  }
}
console.log(`Backfilled ${fixed} transaction reference(s)`);

try {
  await wallets.createIndex(
    { "transactions.reference": 1 },
    { unique: true, sparse: true, name: "transactions_reference_unique_sparse" }
  );
  console.log("Sparse unique index ensured on transactions.reference");
} catch (err) {
  if (String(err).includes("already exists")) {
    console.log("Sparse unique index already present");
  } else {
    throw err;
  }
}

await mongoose.disconnect();
console.log("Wallet index fix complete.");
