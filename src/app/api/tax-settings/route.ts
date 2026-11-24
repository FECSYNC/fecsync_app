import { ok, serverError } from "@/lib/response";
import {
  getOrCreateTaxSettings,
  toTaxSettingsLike,
} from "@/lib/taxSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Step 4.4 — Public read-only for checkout/cart tax display.
 * Payload is enabled/rate/label only (toTaxSettingsLike). No secrets, no _id.
 * Admin mutate is PUT /api/admin/tax-settings (tax:manage).
 */
export async function GET() {
  try {
    const settings = await getOrCreateTaxSettings();
    return ok({ settings: toTaxSettingsLike(settings) });
  } catch (err) {
    console.error("Error fetching public tax settings:", err);
    return serverError("Failed to fetch tax settings");
  }
}
