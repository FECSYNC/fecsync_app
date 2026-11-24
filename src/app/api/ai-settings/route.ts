import { ok, serverError } from "@/lib/response";
import {
  getOrCreateAiSettings,
  toPublicAiSettings,
} from "@/lib/aiSettings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Step 4.4 — Public read-only for the storefront chatbot.
 * Payload is botName only (never provider, model, or API keys). Staff mutate is /api/admin/ai-settings (ai:manage).
 */
export async function GET() {
  try {
    const settings = await getOrCreateAiSettings();
    return ok({ settings: toPublicAiSettings(settings.botName) });
  } catch (err) {
    console.error("Error fetching public AI settings:", err);
    return serverError("Failed to fetch AI settings");
  }
}
