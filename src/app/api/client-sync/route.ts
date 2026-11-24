import { ok } from "@/lib/response";
import { CLIENT_SYNC_VERSION } from "@/lib/clientSync/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Changes whenever `yarn dev` / production server starts — used for soft auto-sync in dev. */
const DEV_EPOCH =
  process.env.NODE_ENV === "development"
    ? `${process.pid}-${Date.now()}`
    : null;

export async function GET() {
  return ok({
    syncVersion: CLIENT_SYNC_VERSION,
    devEpoch: DEV_EPOCH,
    isDev: process.env.NODE_ENV === "development",
  });
}
