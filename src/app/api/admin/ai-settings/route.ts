import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  aiRuntimeSettingsFromDraft,
  applyOpenRouterEnvToDashboard,
  fashionAiRuntimeFromDraft,
  fashionAiRuntimeFromSettings,
  getAiSettingsForStorefrontStaff,
  toStaffAiSettings,
  type AiSettingsDraft,
} from "@/lib/aiSettings";
import { requireActorOrgId } from "@/lib/staffOrg";
import { stampCreate, stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  isAiProviderId,
  isDashboardManagedProvider,
  isAllowedAiBaseUrl,
  isAllowedAiModelId,
} from "@/lib/aiProviders";
import {
  fashionAiRuntimeError,
  previewFashionAiRuntime,
} from "@/lib/aiRuntime";
import { encryptSecret, secretLast4 } from "@/lib/secretCrypto";
import {
  formatFashionAiError,
  pingFashionAiRuntime,
} from "@/lib/openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Step 5.3 — GET/PUT/POST /api/admin/ai-settings → ai:manage on actor.orgId.
 * Public chatbot copy is GET /api/ai-settings (storefront org).
 * Admin GET never returns API keys (last4 hint only). POST tests connectivity.
 * Not a payment path.
 */

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiManage);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    void requireActorOrgId(actor);
    const settings = await getAiSettingsForStorefrontStaff(actor);
    return ok({ settings: toStaffAiSettings(settings) });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Error fetching AI settings:", err);
    return serverError("Failed to fetch AI settings");
  }
}

function parseMaxTokens(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 4096) {
    return undefined;
  }
  return Math.floor(n);
}

export async function PUT(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiManage);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  try {
    const botNameRaw = body.botName;
    const botName =
      typeof botNameRaw === "string" ? botNameRaw.trim() : undefined;
    if (typeof botNameRaw === "string" && !botName) {
      return badRequest("botName cannot be empty");
    }
    const usePublicData =
      typeof body.usePublicData === "boolean" ? body.usePublicData : undefined;

    const providerRaw = body.provider;
    const provider =
      typeof providerRaw === "string" ? providerRaw.trim() : undefined;
    if (provider !== undefined && !isAiProviderId(provider)) {
      return badRequest("Unsupported AI provider");
    }
    if (provider === DEFAULT_AI_PROVIDER) {
      return badRequest(
        "Configure the assistant in the dashboard — pick a provider and paste your API key."
      );
    }

    const modelRaw = body.model;
    const model =
      typeof modelRaw === "string" ? modelRaw.trim() : undefined;
    if (model !== undefined && model && !isAllowedAiModelId(model)) {
      return badRequest("Invalid model id");
    }

    const baseUrlRaw = body.baseUrl;
    const baseUrl =
      typeof baseUrlRaw === "string" ? baseUrlRaw.trim() : undefined;
    if (baseUrl !== undefined && baseUrl && !isAllowedAiBaseUrl(baseUrl)) {
      return badRequest("Base URL must be https (or http://localhost)");
    }

    const maxTokens = parseMaxTokens(body.maxTokens);
    if (
      body.maxTokens !== undefined &&
      body.maxTokens !== null &&
      body.maxTokens !== "" &&
      maxTokens === undefined
    ) {
      return badRequest("maxTokens must be between 1 and 4096");
    }

    const apiKeyRaw = body.apiKey;
    const apiKey =
      typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : undefined;
    const clearApiKey = body.clearApiKey === true;

    if (
      provider !== undefined &&
      provider !== DEFAULT_AI_PROVIDER &&
      model !== undefined &&
      !model
    ) {
      return badRequest("Choose a model for this provider");
    }

    const hasDisplayUpdate =
      botName !== undefined || usePublicData !== undefined;
    const hasProviderUpdate =
      provider !== undefined ||
      model !== undefined ||
      baseUrl !== undefined ||
      maxTokens !== undefined ||
      apiKey !== undefined ||
      clearApiKey;

    if (!hasDisplayUpdate && !hasProviderUpdate) {
      return badRequest("Provide at least one AI setting to update");
    }

    // Never trust client audit fields or encrypted-key fields.
    void body.createdBy;
    void body.createdByName;
    void body.updatedBy;
    void body.updatedByName;
    void body.apiKeyEncrypted;
    void body.apiKeyLast4;

    const settings = await getAiSettingsForStorefrontStaff(actor);
    const previousProvider = isAiProviderId(settings.provider)
      ? settings.provider
      : DEFAULT_AI_PROVIDER;

    if (botName) settings.botName = botName;
    if (usePublicData !== undefined) settings.usePublicData = usePublicData;

    if (provider !== undefined && provider !== previousProvider) {
      settings.provider = provider;
      settings.model = model !== undefined ? model : "";
      settings.baseUrl = baseUrl !== undefined ? baseUrl : "";
      if (!apiKey && !clearApiKey) {
        settings.apiKeyEncrypted = "";
        settings.apiKeyLast4 = "";
      }
    } else {
      if (provider !== undefined) settings.provider = provider;
      if (model !== undefined) settings.model = model;
      if (baseUrl !== undefined) settings.baseUrl = baseUrl;
    }

    if (maxTokens !== undefined) settings.maxTokens = maxTokens;

    if (clearApiKey) {
      settings.apiKeyEncrypted = "";
      settings.apiKeyLast4 = "";
    } else if (apiKey) {
      try {
        settings.apiKeyEncrypted = encryptSecret(apiKey);
        settings.apiKeyLast4 = secretLast4(apiKey);
      } catch {
        return serverError("Could not store API key securely");
      }
    }

    const nextProvider = isAiProviderId(settings.provider)
      ? settings.provider
      : DEFAULT_AI_PROVIDER;

    if (nextProvider === "custom" && !settings.baseUrl?.trim()) {
      return badRequest("Custom provider requires a base URL");
    }

    if (nextProvider !== DEFAULT_AI_PROVIDER && !settings.model?.trim()) {
      const fallback = AI_PROVIDERS[nextProvider].models[0]?.id || "";
      if (!fallback) {
        return badRequest("Choose a model for this provider");
      }
      settings.model = fallback;
    }

    if (nextProvider === DEFAULT_AI_PROVIDER) {
      settings.model = "";
      settings.baseUrl = "";
      settings.maxTokens = null;
      settings.apiKeyEncrypted = "";
      settings.apiKeyLast4 = "";
    }

    const runtime = fashionAiRuntimeFromSettings(settings);
    const runtimeError = fashionAiRuntimeError(runtime);
    if (isDashboardManagedProvider(nextProvider) && runtimeError) {
      if (!runtime.apiKey?.trim()) {
        return badRequest(
          "Paste your API key in Assistant settings and save — dashboard storage is required for this provider."
        );
      }
      return badRequest(runtimeError);
    }

    if (!settings.createdBy) {
      const audit = await stampCreate(actor.sub);
      settings.createdBy = audit.createdBy;
      settings.createdByName = audit.createdByName;
      settings.updatedBy = audit.updatedBy;
      settings.updatedByName = audit.updatedByName;
    } else {
      const audit = await stampUpdate(actor.sub);
      settings.updatedBy = audit.updatedBy;
      settings.updatedByName = audit.updatedByName;
    }
    await settings.save();

    logStaffActivityEntry(actor, {
      action: "AI Settings Updated",
      entityType: "Settings",
      entityId: settings._id,
      description:
        provider !== undefined && provider !== previousProvider
          ? `Updated AI settings (provider → ${nextProvider})`
          : "Updated AI settings",
      request: req,
    });

    return ok({
      message: "AI Settings updated successfully",
      settings: toStaffAiSettings(settings),
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Error updating AI settings:", err);
    return serverError("Failed to update AI settings");
  }
}

function parseDraftBody(body: Record<string, unknown>): AiSettingsDraft | null {
  if (body.action !== undefined) return null;

  const hasDraft =
    body.provider !== undefined ||
    body.model !== undefined ||
    body.baseUrl !== undefined ||
    body.maxTokens !== undefined ||
    body.apiKey !== undefined ||
    body.clearApiKey === true;
  if (!hasDraft) return null;

  const providerRaw = body.provider;
  const provider =
    typeof providerRaw === "string" && isAiProviderId(providerRaw.trim())
      ? (providerRaw.trim() as AiSettingsDraft["provider"])
      : undefined;
  if (provider === DEFAULT_AI_PROVIDER) {
    throw new Error("Configure the assistant in the dashboard, not server .env mode");
  }

  const modelRaw = body.model;
  const model =
    typeof modelRaw === "string" ? modelRaw.trim() : undefined;
  if (model && !isAllowedAiModelId(model)) {
    throw new Error("Invalid model id");
  }

  const baseUrlRaw = body.baseUrl;
  const baseUrl =
    typeof baseUrlRaw === "string" ? baseUrlRaw.trim() : undefined;
  if (baseUrl && !isAllowedAiBaseUrl(baseUrl)) {
    throw new Error("Base URL must be https (or http://localhost)");
  }

  const maxTokens = parseMaxTokens(body.maxTokens);
  if (
    body.maxTokens !== undefined &&
    body.maxTokens !== null &&
    body.maxTokens !== "" &&
    maxTokens === undefined
  ) {
    throw new Error("maxTokens must be between 1 and 4096");
  }

  const apiKeyRaw = body.apiKey;
  const apiKey =
    typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : undefined;

  return {
    provider,
    model,
    baseUrl,
    maxTokens,
    apiKey,
    clearApiKey: body.clearApiKey === true,
  };
}

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiManage);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  try {
    void requireActorOrgId(actor);
    const settings = await getAiSettingsForStorefrontStaff(actor);

    if (isPlainObject(body) && body.action === "importFromEnv") {
      const imported = applyOpenRouterEnvToDashboard(settings);
      if (!imported.ok) {
        return badRequest(
          "No OpenRouter key was found in the server environment. Paste your API key in the form below and save instead."
        );
      }
      if (!settings.createdBy) {
        const createAudit = await stampCreate(actor.sub);
        settings.createdBy = createAudit.createdBy;
        settings.createdByName = createAudit.createdByName;
        settings.updatedBy = createAudit.updatedBy;
        settings.updatedByName = createAudit.updatedByName;
      } else {
        const audit = await stampUpdate(actor.sub);
        settings.updatedBy = audit.updatedBy;
        settings.updatedByName = audit.updatedByName;
      }
      await settings.save();

      const runtime = fashionAiRuntimeFromSettings(settings);
      const configError = fashionAiRuntimeError(runtime);
      if (configError) {
        return serverError(
          "Imported settings could not be validated. Check your OpenRouter key and try again."
        );
      }
      try {
        await pingFashionAiRuntime(runtime);
      } catch (err) {
        return badRequest(formatFashionAiError(err, { verbose: true }));
      }

      logStaffActivityEntry(actor, {
        action: "AI Settings Updated",
        entityType: "Settings",
        entityId: settings._id,
        description:
          "Moved OpenRouter credentials from server env into dashboard storage",
        request: req,
      });

      return ok({
        message:
          "Assistant is now managed from the dashboard. You can remove OPENROUTER_* keys from .env.local when ready.",
        settings: toStaffAiSettings(settings),
      });
    }

    let draft: AiSettingsDraft | null = null;
    if (isPlainObject(body)) {
      try {
        draft = parseDraftBody(body);
      } catch (err) {
        return badRequest(
          err instanceof Error ? err.message : "Invalid test payload"
        );
      }
    }

    const runtime = fashionAiRuntimeFromDraft(settings, draft);
    const configError = fashionAiRuntimeError(runtime);
    if (configError) {
      // Prefer the specific config hint (e.g. wrong Google AI Studio key) for admins.
      return badRequest(configError);
    }

    try {
      await pingFashionAiRuntime(runtime);
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : String(err);
      console.error("AI connection test failed:", raw);
      return badRequest(formatFashionAiError(err, { verbose: true }));
    }

    const preview = previewFashionAiRuntime(
      aiRuntimeSettingsFromDraft(settings, draft)
    );
    return ok({
      message: "AI provider connection successful",
      provider: preview.activeProviderLabel,
      model: runtime.model,
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Error testing AI settings:", err);
    return serverError("Failed to test AI connection");
  }
}
