import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { DEFAULT_OPENROUTER_MODEL, isAiProviderId } from "@/lib/aiProviders";
import type {
  AiConnectionTestResult,
  AiSettingsTestPayload,
  AiSettingsUpdatePayload,
  AiSettingsView,
} from "@/lib/aiSettingsTypes";

export type AdminAiSettings = AiSettingsView;
export type UpdateAiSettingsPayload = AiSettingsUpdatePayload;
export type TestAiSettingsPayload = AiSettingsTestPayload;
export type { AiConnectionTestResult };

/** Whether the storefront assistant can call an AI provider right now. */
export function isAssistantConfigured(
  settings?: Pick<
    AdminAiSettings,
    "apiKeyConfigured" | "followsServerEnv"
  > | null
): boolean {
  if (!settings) return false;
  return Boolean(settings.apiKeyConfigured || settings.followsServerEnv);
}

/** Label for dashboard cards when settings are loaded. */
export function formatActiveProviderSummary(
  settings?: Pick<
    AdminAiSettings,
    | "activeProviderLabel"
    | "activeModel"
    | "followsServerEnv"
    | "apiKeyConfigured"
  > | null
): string {
  if (!settings) return "Assistant";
  const parts: (string | null)[] = [];
  if (settings.followsServerEnv) {
    parts.push("Server default (.env)");
  }
  parts.push(
    settings.activeProviderLabel ||
      (settings.followsServerEnv ? "OpenRouter" : "Unknown"),
    settings.activeModel || null,
    !isAssistantConfigured(settings) ? "needs API key" : null
  );
  return parts.filter(Boolean).join(" · ");
}

type AiSettingsResponse = {
  settings: AdminAiSettings;
};

const FALLBACK: AdminAiSettings = {
  botName: "StyleForge AI",
  usePublicData: false,
  provider: "openrouter",
  model: DEFAULT_OPENROUTER_MODEL,
  baseUrl: "",
  maxTokens: 512,
  apiKeyConfigured: false,
  apiKeyLast4: null,
  usesServerEnvKey: false,
  activeProviderId: "openrouter",
  activeProviderLabel: "OpenRouter",
  activeModel: DEFAULT_OPENROUTER_MODEL,
  activeMaxTokens: 512,
  activeBaseUrl: "https://openrouter.ai/api/v1",
  activeApiKeyLast4: null,
  activeApiKeySource: "none",
  activeEnvKeyName: null,
  followsServerEnv: false,
  envImportAvailable: false,
};

function validateAdminAiSettings(settings: AdminAiSettings): boolean {
  return (
    typeof settings.usePublicData === "boolean" &&
    typeof settings.provider === "string" &&
    typeof settings.activeProviderLabel === "string" &&
    typeof settings.activeProviderId === "string" &&
    typeof settings.activeMaxTokens === "number" &&
    typeof settings.followsServerEnv === "boolean"
  );
}

function mapSettings(settings: AdminAiSettings): AdminAiSettings {
  return {
    botName: settings.botName?.trim() || FALLBACK.botName,
    usePublicData: Boolean(settings.usePublicData),
    provider: isAiProviderId(settings.provider)
      ? settings.provider
      : FALLBACK.provider,
    model: settings.model?.trim() || "",
    baseUrl: settings.baseUrl?.trim() || "",
    maxTokens:
      typeof settings.maxTokens === "number" ? settings.maxTokens : null,
    apiKeyConfigured: Boolean(settings.apiKeyConfigured),
    apiKeyLast4: settings.apiKeyLast4 ?? null,
    usesServerEnvKey:
      typeof settings.usesServerEnvKey === "boolean"
        ? settings.usesServerEnvKey
        : FALLBACK.usesServerEnvKey,
    activeProviderId: isAiProviderId(settings.activeProviderId)
      ? settings.activeProviderId
      : FALLBACK.activeProviderId,
    activeProviderLabel:
      settings.activeProviderLabel?.trim() || FALLBACK.activeProviderLabel,
    activeModel: settings.activeModel?.trim() || "",
    activeMaxTokens:
      typeof settings.activeMaxTokens === "number"
        ? settings.activeMaxTokens
        : FALLBACK.activeMaxTokens,
    activeBaseUrl: settings.activeBaseUrl?.trim() || FALLBACK.activeBaseUrl,
    activeApiKeyLast4: settings.activeApiKeyLast4 ?? null,
    activeApiKeySource:
      settings.activeApiKeySource === "stored" ||
      settings.activeApiKeySource === "env" ||
      settings.activeApiKeySource === "none"
        ? settings.activeApiKeySource
        : FALLBACK.activeApiKeySource,
    activeEnvKeyName: settings.activeEnvKeyName ?? null,
    followsServerEnv: Boolean(settings.followsServerEnv),
    envImportAvailable: Boolean(settings.envImportAvailable),
    createdByName: settings.createdByName ?? null,
    updatedByName: settings.updatedByName ?? null,
    createdAt: settings.createdAt ?? null,
    updatedAt: settings.updatedAt ?? null,
  };
}

export async function getAdminAiSettings(): Promise<AdminAiSettings> {
  const raw = await api<MaybeWrapped<AiSettingsResponse>>(
    "/api/admin/ai-settings",
    {
      method: "GET",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!validateAdminAiSettings(data?.settings)) {
    throw new Error("Failed to load AI settings");
  }
  return mapSettings(data.settings);
}

export async function updateAiSettings(
  payload: UpdateAiSettingsPayload
): Promise<AdminAiSettings> {
  const raw = await api<MaybeWrapped<AiSettingsResponse>>(
    "/api/admin/ai-settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!validateAdminAiSettings(data?.settings)) {
    throw new Error("Failed to update AI settings");
  }
  return mapSettings(data.settings);
}

export async function testAdminAiConnection(
  payload?: TestAiSettingsPayload
): Promise<AiConnectionTestResult> {
  const raw = await api<
    MaybeWrapped<AiConnectionTestResult & { message?: string }>
  >("/api/admin/ai-settings", {
    method: "POST",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.provider || !data?.model) {
    throw new Error("Connection test failed");
  }
  return {
    message: data.message || "AI provider connection successful",
    provider: data.provider,
    model: data.model,
  };
}

/** One-time: copy OPENROUTER_* from server env into encrypted dashboard storage. */
export async function importAdminAiFromEnv(): Promise<AdminAiSettings> {
  const raw = await api<
    MaybeWrapped<AiSettingsResponse & { message?: string }>
  >("/api/admin/ai-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "importFromEnv" }),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!validateAdminAiSettings(data?.settings)) {
    throw new Error("Failed to import AI settings from server environment");
  }
  return mapSettings(data.settings);
}
