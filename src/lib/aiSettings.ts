import type { AiSettings as AiSettingsRow } from "@prisma/client";
import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import { getStorefrontOrgId } from "@/lib/org";
import { assertActorOrgMatch, requireActorOrgId } from "@/lib/staffOrg";
import { fashionChatSessionMs } from "@/lib/fashionChatConversation";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENROUTER_MODEL,
  DASHBOARD_DEFAULT_PROVIDER,
  normalizeAiProviderId,
  isDashboardManagedProvider,
  type AiProviderId,
} from "@/lib/aiProviders";
import {
  defaultAiMaxTokens,
  previewFashionAiRuntime,
  resolveFashionAiRuntime,
  type AiRuntimeSettings,
} from "@/lib/aiRuntime";
import { encryptSecret, secretLast4 } from "@/lib/secretCrypto";
import type { AiSettingsView } from "@/lib/aiSettingsTypes";

export const DEFAULT_AI_BOT_NAME = "StyleForge AI";

export type PublicAiSettings = {
  botName: string;
  /** Storefront chat session length (minutes); matches FASHION_CHAT_SESSION_MINUTES env. */
  fashionChatSessionMinutes: number;
};

export type AiSettingsDraft = {
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string;
  maxTokens?: number | null;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type StaffAiSettings = AiSettingsView;

/**
 * Mutable AI settings row with Mongo-era aliases (`_id`, `createdBy`, `updatedBy`)
 * and a Prisma-backed `save()` so existing admin callers keep working.
 */
export type AiSettingsDocument = AiSettingsRow & {
  _id: string;
  createdBy: string | null;
  updatedBy: string | null;
  save(): Promise<AiSettingsDocument>;
};

export function toPublicAiSettings(botName?: string | null): PublicAiSettings {
  return {
    botName: botName?.trim() || DEFAULT_AI_BOT_NAME,
    fashionChatSessionMinutes: Math.max(
      1,
      Math.round(fashionChatSessionMs() / 60_000)
    ),
  };
}

function auditName(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isoDate(value?: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function wrapAiSettings(row: AiSettingsRow): AiSettingsDocument {
  const doc = {
    ...row,
    _id: row.id,
    createdBy: row.createdById,
    updatedBy: row.updatedById,
    async save(this: AiSettingsDocument): Promise<AiSettingsDocument> {
      const createdById =
        this.createdBy != null && String(this.createdBy).trim()
          ? String(this.createdBy)
          : this.createdById;
      const updatedById =
        this.updatedBy != null && String(this.updatedBy).trim()
          ? String(this.updatedBy)
          : this.updatedById;

      const updated = await prisma.aiSettings.update({
        where: { id: this.id },
        data: {
          botName: this.botName,
          usePublicData: this.usePublicData,
          provider: this.provider,
          model: this.model,
          baseUrl: this.baseUrl,
          apiKeyEncrypted: this.apiKeyEncrypted,
          apiKeyLast4: this.apiKeyLast4,
          maxTokens: this.maxTokens,
          createdById,
          createdByName: this.createdByName,
          updatedById,
          updatedByName: this.updatedByName,
        },
      });
      const next = wrapAiSettings(updated);
      Object.assign(this, next);
      return this;
    },
  };
  return doc as AiSettingsDocument;
}

export function toStaffAiSettings(settings: {
  botName?: string | null;
  usePublicData?: boolean;
  provider?: string | null;
  model?: string | null;
  apiKeyEncrypted?: string | null;
  apiKeyLast4?: string | null;
  baseUrl?: string | null;
  maxTokens?: number | null;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): StaffAiSettings {
  const provider = normalizeAiProviderId(settings.provider);
  const preview = previewFashionAiRuntime({
    provider,
    model: settings.model,
    apiKeyEncrypted: settings.apiKeyEncrypted,
    apiKeyLast4: settings.apiKeyLast4,
    baseUrl: settings.baseUrl,
    maxTokens: settings.maxTokens,
  });
  const last4 = settings.apiKeyLast4?.trim() || "";
  const envKeyPresent = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  return {
    botName: settings.botName?.trim() || DEFAULT_AI_BOT_NAME,
    usePublicData: Boolean(settings.usePublicData),
    provider,
    model: settings.model?.trim() || "",
    baseUrl: settings.baseUrl?.trim() || "",
    maxTokens:
      typeof settings.maxTokens === "number" &&
      Number.isFinite(settings.maxTokens)
        ? settings.maxTokens
        : null,
    apiKeyConfigured: preview.apiKeyConfigured,
    apiKeyLast4: last4 || null,
    usesServerEnvKey: preview.usesServerEnvKey,
    activeProviderId: preview.activeProviderId,
    activeProviderLabel: preview.activeProviderLabel,
    activeModel: preview.model,
    activeMaxTokens: preview.activeMaxTokens,
    activeBaseUrl: preview.activeBaseUrl,
    activeApiKeyLast4: preview.activeApiKeyLast4,
    activeApiKeySource: preview.activeApiKeySource,
    activeEnvKeyName: preview.activeEnvKeyName,
    followsServerEnv: preview.followsServerEnv,
    envImportAvailable:
      !preview.apiKeyConfigured && !preview.followsServerEnv && envKeyPresent,
    createdByName: auditName(settings.createdByName),
    updatedByName: auditName(settings.updatedByName),
    createdAt: isoDate(settings.createdAt ?? null),
    updatedAt: isoDate(settings.updatedAt ?? null),
  };
}

export async function getOrCreateAiSettings(
  orgId?: string | null
): Promise<AiSettingsDocument> {
  const fromArg = asIdString(orgId) ?? String(orgId ?? "").trim();
  const orgKey = fromArg || String(await getStorefrontOrgId());

  let settings = await prisma.aiSettings.findUnique({
    where: { orgId: orgKey },
  });

  if (!settings) {
    settings = await prisma.aiSettings.create({
      data: {
        orgId: orgKey,
        botName: DEFAULT_AI_BOT_NAME,
        usePublicData: false,
        provider: DASHBOARD_DEFAULT_PROVIDER,
        model: DEFAULT_OPENROUTER_MODEL,
        apiKeyEncrypted: "",
        apiKeyLast4: "",
        baseUrl: "",
        maxTokens: defaultAiMaxTokens(),
      },
    });
  } else {
    const patch: Partial<AiSettingsRow> = {};
    let legacy = false;

    if (!settings.provider) {
      patch.provider = DASHBOARD_DEFAULT_PROVIDER;
      legacy = true;
    }
    const storedProvider = normalizeAiProviderId(
      patch.provider ?? settings.provider
    );
    if (
      storedProvider === DASHBOARD_DEFAULT_PROVIDER &&
      !(patch.model ?? settings.model)?.trim()
    ) {
      patch.model = DEFAULT_OPENROUTER_MODEL;
      legacy = true;
    }
    if (
      isDashboardManagedProvider(storedProvider) &&
      (settings.maxTokens === null || settings.maxTokens === undefined) &&
      patch.maxTokens === undefined
    ) {
      patch.maxTokens = defaultAiMaxTokens();
      legacy = true;
    }
    if (settings.model == null && patch.model === undefined) {
      patch.model = "";
      legacy = true;
    }
    if (settings.baseUrl == null && patch.baseUrl === undefined) {
      patch.baseUrl = "";
      legacy = true;
    }
    if (settings.apiKeyLast4 == null && patch.apiKeyLast4 === undefined) {
      patch.apiKeyLast4 = "";
      legacy = true;
    }
    if (
      settings.apiKeyEncrypted == null &&
      patch.apiKeyEncrypted === undefined
    ) {
      patch.apiKeyEncrypted = "";
      legacy = true;
    }

    const nextProvider = normalizeAiProviderId(
      patch.provider ?? settings.provider
    );
    const nextModel = patch.model ?? settings.model;
    const nextBaseUrl = patch.baseUrl ?? settings.baseUrl;
    const nextMaxTokens =
      patch.maxTokens !== undefined ? patch.maxTokens : settings.maxTokens;
    const nextKey =
      patch.apiKeyEncrypted !== undefined
        ? patch.apiKeyEncrypted
        : settings.apiKeyEncrypted;
    const nextLast4 =
      patch.apiKeyLast4 !== undefined
        ? patch.apiKeyLast4
        : settings.apiKeyLast4;

    if (
      nextProvider === DEFAULT_AI_PROVIDER &&
      (nextKey?.trim() ||
        nextLast4?.trim() ||
        nextModel?.trim() ||
        nextBaseUrl?.trim() ||
        nextMaxTokens != null)
    ) {
      patch.model = "";
      patch.baseUrl = "";
      patch.maxTokens = null;
      patch.apiKeyEncrypted = "";
      patch.apiKeyLast4 = "";
      legacy = true;
    }

    if (legacy) {
      settings = await prisma.aiSettings.update({
        where: { id: settings.id },
        data: {
          provider: patch.provider,
          model: patch.model,
          baseUrl: patch.baseUrl,
          maxTokens: patch.maxTokens,
          apiKeyEncrypted: patch.apiKeyEncrypted,
          apiKeyLast4: patch.apiKeyLast4,
        },
      });
    }
  }

  const wrapped = wrapAiSettings(settings);
  const storedProvider = normalizeAiProviderId(wrapped.provider);
  if (
    isDashboardManagedProvider(storedProvider) &&
    !wrapped.apiKeyEncrypted?.trim() &&
    process.env.OPENROUTER_API_KEY?.trim()
  ) {
    const imported = applyOpenRouterEnvToDashboard(wrapped);
    if (imported.ok) {
      await wrapped.save();
    }
  }

  return wrapped;
}

/**
 * Storefront chatbot settings always live on the storefront org row — the same
 * document fashion-chat reads via getOrCreateAiSettings() without an org arg.
 */
export async function getAiSettingsForStorefrontStaff(actor: {
  orgId?: string | null;
}): Promise<AiSettingsDocument> {
  const actorOrgId = requireActorOrgId(actor);
  const storefrontOrgId = await getStorefrontOrgId();
  assertActorOrgMatch(
    actorOrgId,
    storefrontOrgId,
    "AI assistant settings apply to the storefront organization only"
  );
  return getOrCreateAiSettings(String(storefrontOrgId));
}

export function aiRuntimeSettingsFromDraft(
  settings: AiSettingsDocument,
  draft?: AiSettingsDraft | null
): AiRuntimeSettings {
  const provider = draft?.provider ?? normalizeAiProviderId(settings.provider);
  const plainKey = draft?.clearApiKey ? "" : draft?.apiKey?.trim() || "";
  const useSavedEncrypted =
    !draft?.clearApiKey && !plainKey && Boolean(settings.apiKeyEncrypted?.trim());

  return {
    provider,
    model: draft?.model !== undefined ? draft.model : settings.model,
    baseUrl: draft?.baseUrl !== undefined ? draft.baseUrl : settings.baseUrl,
    maxTokens:
      draft?.maxTokens !== undefined ? draft.maxTokens : settings.maxTokens,
    apiKeyEncrypted: useSavedEncrypted ? settings.apiKeyEncrypted : "",
    apiKeyLast4: settings.apiKeyLast4,
    apiKeyPlain: plainKey || undefined,
  };
}

export function fashionAiRuntimeFromSettings(settings: AiSettingsDocument) {
  return resolveFashionAiRuntime({
    provider: settings.provider,
    model: settings.model,
    apiKeyEncrypted: settings.apiKeyEncrypted,
    apiKeyLast4: settings.apiKeyLast4,
    baseUrl: settings.baseUrl,
    maxTokens: settings.maxTokens,
  });
}

/** Resolve runtime from saved settings plus optional unsaved admin form draft (POST test). */
export function fashionAiRuntimeFromDraft(
  settings: AiSettingsDocument,
  draft?: AiSettingsDraft | null
) {
  if (!draft) return fashionAiRuntimeFromSettings(settings);
  return resolveFashionAiRuntime(aiRuntimeSettingsFromDraft(settings, draft));
}

/** Copy OPENROUTER_* from server env into encrypted dashboard fields (caller saves). */
export function applyOpenRouterEnvToDashboard(
  settings: AiSettingsDocument
): { ok: true } | { ok: false; reason: "no_env_key" } {
  const key = process.env.OPENROUTER_API_KEY?.trim() || "";
  if (!key) {
    return { ok: false, reason: "no_env_key" };
  }
  settings.provider = DASHBOARD_DEFAULT_PROVIDER;
  settings.model =
    process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  settings.maxTokens = defaultAiMaxTokens();
  settings.baseUrl = "";
  settings.apiKeyEncrypted = encryptSecret(key);
  settings.apiKeyLast4 = secretLast4(key);
  return { ok: true };
}
