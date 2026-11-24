/**
 * OpenAI-compatible providers the admin can pick from Assistant settings.
 * Native-only APIs without an OpenAI-compatible endpoint are not listed.
 * Safe to import from client components (no secrets).
 */

export const AI_PROVIDER_IDS = [
  "env_default",
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "groq",
  "mistral",
  "deepseek",
  "custom",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Legacy: follow server .env (OpenRouter vars). Kept for existing rows only. */
export const DEFAULT_AI_PROVIDER: AiProviderId = "env_default";

/** New installs and the admin UI default to dashboard-stored OpenRouter. */
export const DASHBOARD_DEFAULT_PROVIDER: AiProviderId = "openrouter";

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

export type AiModelOption = {
  id: string;
  label: string;
};

export type AiProviderDef = {
  id: AiProviderId;
  label: string;
  description: string;
  /** Null for env_default (uses OpenRouter) and custom (admin types a URL). */
  baseURL: string | null;
  envKeyName: string | null;
  models: AiModelOption[];
  requiresBaseUrl: boolean;
  extraHeaders?: Record<string, string>;
};

const OPENROUTER_MODELS: AiModelOption[] = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
];

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDef> = {
  env_default: {
    id: "env_default",
    label: "Server default",
    description:
      "Keep the current working assistant (OpenRouter + the model in your server env). Nothing else is required.",
    baseURL: "https://openrouter.ai/api/v1",
    envKeyName: "OPENROUTER_API_KEY",
    models: OPENROUTER_MODELS,
    requiresBaseUrl: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    description:
      "Recommended. Paste your OpenRouter API key, pick a model, and save — everything is stored in the dashboard (no .env changes needed).",
    baseURL: "https://openrouter.ai/api/v1",
    envKeyName: "OPENROUTER_API_KEY",
    models: OPENROUTER_MODELS,
    requiresBaseUrl: false,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    description:
      "Paste a platform.openai.com API key (ChatGPT Plus alone is not enough — billing/credits required). Stored encrypted in the dashboard.",
    baseURL: "https://api.openai.com/v1",
    envKeyName: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "o4-mini", label: "o4-mini" },
    ],
    requiresBaseUrl: false,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    description: "Claude via Anthropic’s OpenAI-compatible Chat Completions API.",
    baseURL: "https://api.anthropic.com/v1",
    envKeyName: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
    ],
    requiresBaseUrl: false,
    extraHeaders: { "anthropic-version": "2023-06-01" },
  },
  google: {
    id: "google",
    label: "Google Gemini",
    description:
      "Paste a key from aistudio.google.com/api-keys. If Test connection fails with a network/connection error, your network is blocking Google’s API — use Groq (free) or OpenRouter with a google/… model instead.",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    envKeyName: "GEMINI_API_KEY",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
    requiresBaseUrl: false,
  },
  groq: {
    id: "groq",
    label: "Groq",
    description:
      "Recommended free option. Create a key at console.groq.com — use GPT OSS 20B on the free tier (Llama models are Enterprise-only).",
    baseURL: "https://api.groq.com/openai/v1",
    envKeyName: "GROQ_API_KEY",
    models: [
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B (free tier)" },
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
      { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Enterprise)" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Enterprise)" },
    ],
    requiresBaseUrl: false,
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    description: "Mistral Cloud Chat Completions API.",
    baseURL: "https://api.mistral.ai/v1",
    envKeyName: "MISTRAL_API_KEY",
    models: [
      { id: "mistral-small-latest", label: "Mistral Small" },
      { id: "mistral-large-latest", label: "Mistral Large" },
    ],
    requiresBaseUrl: false,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek Chat Completions API.",
    baseURL: "https://api.deepseek.com",
    envKeyName: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ],
    requiresBaseUrl: false,
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    description:
      "Any other Chat Completions endpoint (Together, Fireworks, Azure, Ollama, etc.). You provide the base URL, model id, and key.",
    baseURL: null,
    envKeyName: null,
    models: [],
    requiresBaseUrl: true,
  },
};

export const AI_PROVIDER_LIST: AiProviderDef[] = AI_PROVIDER_IDS.map(
  (id) => AI_PROVIDERS[id]
);

/** Admin picker — dashboard-managed providers only (no legacy .env mode). */
export const DASHBOARD_AI_PROVIDER_LIST: AiProviderDef[] =
  AI_PROVIDER_LIST.filter((p) => p.id !== "env_default");

/** True for every provider except legacy env_default. */
export function isDashboardManagedProvider(
  providerId: AiProviderId
): boolean {
  return providerId !== DEFAULT_AI_PROVIDER;
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return (
    typeof value === "string" &&
    (AI_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function normalizeAiProviderId(value: unknown): AiProviderId {
  return isAiProviderId(value) ? value : DEFAULT_AI_PROVIDER;
}

const CUSTOM_MODEL_VALUE = "__custom__";

export function isCustomModelSentinel(value: string): boolean {
  return value === CUSTOM_MODEL_VALUE;
}

export const CUSTOM_MODEL_SENTINEL = CUSTOM_MODEL_VALUE;

export function isAllowedAiBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedAiModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,199}$/.test(value);
}
