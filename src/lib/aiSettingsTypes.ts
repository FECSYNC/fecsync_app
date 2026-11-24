import type { AiProviderId } from "@/lib/aiProviders";

export type AiApiKeySource = "stored" | "env" | "none";

/** Shared admin/storefront-staff AI settings shape (client-safe). */
export type AiSettingsView = {
  botName: string;
  usePublicData: boolean;
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  maxTokens: number | null;
  apiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  usesServerEnvKey: boolean;
  activeProviderId: AiProviderId;
  activeProviderLabel: string;
  activeModel: string;
  activeMaxTokens: number;
  activeBaseUrl: string;
  activeApiKeyLast4: string | null;
  activeApiKeySource: AiApiKeySource;
  activeEnvKeyName: string | null;
  followsServerEnv: boolean;
  /** True when OPENROUTER_API_KEY exists in server env but dashboard has no stored key. */
  envImportAvailable?: boolean;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AiSettingsUpdatePayload = {
  botName?: string;
  usePublicData?: boolean;
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  maxTokens?: number | null;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type AiSettingsTestPayload = AiSettingsUpdatePayload;

export type AiConnectionTestResult = {
  message: string;
  provider: string;
  model: string;
};
