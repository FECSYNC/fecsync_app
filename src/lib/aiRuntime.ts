import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAiProviderId,
  type AiProviderId,
} from "@/lib/aiProviders";
import { secretLast4, tryDecryptSecret } from "@/lib/secretCrypto";

export type AiRuntimeSettings = {
  provider?: string | null;
  model?: string | null;
  apiKeyEncrypted?: string | null;
  /** Hint from MongoDB; used for admin display only. */
  apiKeyLast4?: string | null;
  /** Test-only plain key from the admin form; never persisted. */
  apiKeyPlain?: string | null;
  baseUrl?: string | null;
  maxTokens?: number | null;
};

export type FashionAiRuntime = {
  providerId: AiProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
  headers?: Record<string, string>;
};

import type { AiApiKeySource } from "@/lib/aiSettingsTypes";

export type FashionAiRuntimePreview = {
  /** Value stored in MongoDB. */
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  apiKeyConfigured: boolean;
  usesServerEnvKey: boolean;
  /** Effective provider the chatbot uses (OpenRouter when stored is env_default). */
  activeProviderId: AiProviderId;
  activeProviderLabel: string;
  activeMaxTokens: number;
  activeBaseUrl: string;
  activeApiKeyLast4: string | null;
  activeApiKeySource: AiApiKeySource;
  activeEnvKeyName: string | null;
  /** True when MongoDB provider is env_default (follows server .env). */
  followsServerEnv: boolean;
};

function effectiveProviderId(storedProviderId: AiProviderId): AiProviderId {
  if (storedProviderId === DEFAULT_AI_PROVIDER) {
    return "openrouter";
  }
  return storedProviderId;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function defaultAiMaxTokens(): number {
  const raw = process.env.OPENROUTER_MAX_TOKENS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, 4096);
  }
  return 512;
}

function clampMaxTokens(value?: number | null): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 4096);
  }
  return defaultAiMaxTokens();
}

function envKey(name: string | null): string {
  if (!name) return "";
  return process.env[name]?.trim() || "";
}

function defaultOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

/**
 * Server-only. Legacy env_default uses OPENROUTER_* from server env.
 * Dashboard providers (openrouter, openai, …) use encrypted keys saved in MongoDB only.
 */
export function resolveFashionAiRuntime(
  settings?: AiRuntimeSettings | null
): FashionAiRuntime {
  const providerId = normalizeAiProviderId(settings?.provider);

  if (providerId === DEFAULT_AI_PROVIDER) {
    return {
      providerId,
      apiKey: envKey("OPENROUTER_API_KEY"),
      baseURL: OPENROUTER_BASE,
      model: defaultOpenRouterModel(),
      maxTokens: defaultAiMaxTokens(),
    };
  }

  const def = AI_PROVIDERS[providerId];
  const plainKey = settings?.apiKeyPlain?.trim() || "";
  const storedKey = plainKey || tryDecryptSecret(settings?.apiKeyEncrypted);
  const apiKey = storedKey || "";
  const model =
    settings?.model?.trim() ||
    def.models[0]?.id ||
    defaultOpenRouterModel();
  const baseURL =
    (def.requiresBaseUrl
      ? settings?.baseUrl?.trim()
      : def.baseURL?.trim()) || OPENROUTER_BASE;

  return {
    providerId,
    apiKey,
    baseURL,
    model,
    maxTokens: clampMaxTokens(settings?.maxTokens),
    headers: def.extraHeaders,
  };
}

export function previewFashionAiRuntime(
  settings?: AiRuntimeSettings | null
): FashionAiRuntimePreview {
  const providerId = normalizeAiProviderId(settings?.provider);
  const def = AI_PROVIDERS[providerId];
  const followsServerEnv = providerId === DEFAULT_AI_PROVIDER;
  const activeProviderId = effectiveProviderId(providerId);
  const activeDef = AI_PROVIDERS[activeProviderId];
  const hasStoredKey =
    Boolean(settings?.apiKeyEncrypted?.trim()) ||
    Boolean(settings?.apiKeyPlain?.trim());
  const storedPlainKey =
    settings?.apiKeyPlain?.trim() ||
    tryDecryptSecret(settings?.apiKeyEncrypted) ||
    "";
  const runtime = resolveFashionAiRuntime(settings);

  let activeApiKeySource: AiApiKeySource = "none";
  let activeApiKeyLast4: string | null = null;
  let activeEnvKeyName: string | null = null;

  const dashboardLast4 = followsServerEnv
    ? ""
    : settings?.apiKeyLast4?.trim() || "";
  if (dashboardLast4) {
    activeApiKeyLast4 = dashboardLast4;
    activeApiKeySource = "stored";
  } else if (!followsServerEnv && storedPlainKey) {
    activeApiKeyLast4 = secretLast4(storedPlainKey) || null;
    activeApiKeySource = "stored";
  } else if (runtime.apiKey) {
    activeApiKeyLast4 = secretLast4(runtime.apiKey) || null;
    activeApiKeySource = "env";
    activeEnvKeyName = followsServerEnv
      ? "OPENROUTER_API_KEY"
      : activeDef.envKeyName;
  }

  const usesEnvKey = followsServerEnv && Boolean(runtime.apiKey);

  return {
    providerId,
    providerLabel: def.label,
    model: runtime.model,
    apiKeyConfigured: hasStoredKey || Boolean(runtime.apiKey),
    usesServerEnvKey: usesEnvKey,
    activeProviderId,
    activeProviderLabel: activeDef.label,
    activeMaxTokens: runtime.maxTokens,
    activeBaseUrl: runtime.baseURL,
    activeApiKeyLast4,
    activeApiKeySource,
    activeEnvKeyName,
    followsServerEnv,
  };
}

/** User-safe message when dashboard/env AI is not ready for chat. */
export function fashionAiRuntimeError(runtime: FashionAiRuntime): string | null {
  if (!runtime.apiKey?.trim()) {
    return "Our style assistant is not configured correctly. Please contact support.";
  }
  if (!runtime.model?.trim()) {
    return "Our style assistant model is not configured. Please contact support.";
  }
  if (!runtime.baseURL?.trim()) {
    return "Our style assistant endpoint is not configured. Please contact support.";
  }
  return null;
}

/** Groq GPT-OSS models break OpenAI-style tool calling — use server-side catalog search. */
export function fashionAiSupportsNativeTools(runtime: FashionAiRuntime): boolean {
  if (runtime.providerId === "groq") return false;
  if (/gpt-oss/i.test(runtime.model)) return false;
  return true;
}

function openRouterOptionalHeaders(): Record<string, string> {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (!site) return {};
  const referer = site.startsWith("http") ? site : `https://${site}`;
  return {
    "HTTP-Referer": referer,
    "X-Title": "FECSYNC Style Assistant",
  };
}

export function mergeFashionAiHeaders(
  runtime: FashionAiRuntime
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...(runtime.headers ?? {}) };
  if (
    runtime.providerId === DEFAULT_AI_PROVIDER ||
    runtime.providerId === "openrouter"
  ) {
    Object.assign(merged, openRouterOptionalHeaders());
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
