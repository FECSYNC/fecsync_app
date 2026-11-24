/**
 * Migrate legacy base64 product/fabric images to Cloudinary URLs.
 *
 * Usage:
 *   node scripts/migrate-base64-images.mjs
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");

function envValue(key) {
  const match = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const uri = envValue("MONGO_URI");
const cloudName = envValue("CLOUDINARY_CLOUD_NAME");
const apiKey = envValue("CLOUDINARY_API_KEY");
const apiSecret = envValue("CLOUDINARY_API_SECRET");

if (!uri || !cloudName || !apiKey || !apiSecret) {
  console.error("Missing MONGO_URI or Cloudinary env in .env.local");
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl).trim());
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return null;
    return buffer;
  } catch {
    return null;
  }
}

function uploadBuffer(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result?.secure_url || null);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

async function resolveUrl(src, folder, tag) {
  if (typeof src !== "string") return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  if (!trimmed.startsWith("data:")) return null;
  const buffer = parseDataUrl(trimmed);
  if (!buffer) return null;
  const publicId = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`  uploading ${folder}/${publicId} (${Math.round(buffer.length / 1024)}KB)`);
  return uploadBuffer(buffer, folder, publicId);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;

const products = db.collection("products");
const productCursor = products.find({
  images: { $elemMatch: { $regex: "^data:" } },
});

let productUpdated = 0;
while (await productCursor.hasNext()) {
  const doc = await productCursor.next();
  console.log(`Product: ${doc.name} (${doc._id})`);
  const nextImages = [];
  for (const img of doc.images || []) {
    if (nextImages.length >= 3) break;
    try {
      const url = await resolveUrl(img, "products", "migrated");
      if (url) nextImages.push(url);
    } catch (err) {
      console.error(`  failed image upload:`, err.message || err);
    }
  }
  if (nextImages.length === 0) {
    console.warn(`  skipped — no usable images`);
    continue;
  }
  await products.updateOne({ _id: doc._id }, { $set: { images: nextImages } });
  productUpdated += 1;
  console.log(`  saved ${nextImages.length} Cloudinary URL(s)`);
}

const fabrics = db.collection("fabrics");
const fabricCursor = fabrics.find({ image: { $regex: "^data:" } });
let fabricUpdated = 0;
while (await fabricCursor.hasNext()) {
  const doc = await fabricCursor.next();
  console.log(`Fabric: ${doc.name} (${doc._id})`);
  try {
    const url = await resolveUrl(doc.image, "fabrics", "migrated");
    if (!url) {
      console.warn(`  skipped — no usable image`);
      continue;
    }
    await fabrics.updateOne({ _id: doc._id }, { $set: { image: url } });
    fabricUpdated += 1;
    console.log(`  saved Cloudinary URL`);
  } catch (err) {
    console.error(`  failed:`, err.message || err);
  }
}

console.log(`Done. products=${productUpdated} fabrics=${fabricUpdated}`);
await mongoose.disconnect();
