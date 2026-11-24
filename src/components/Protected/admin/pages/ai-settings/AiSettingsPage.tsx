'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { isAssistantConfigured } from '@/services/aiSettings';
import {
  useAdminAiSettingsQuery,
  useImportAiFromEnvMutation,
  useTestAiConnectionMutation,
  useUpdateAiSettingsMutation,
} from '@/hooks/useAiSettings';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import {
  AI_PROVIDERS,
  CUSTOM_MODEL_SENTINEL,
  DASHBOARD_AI_PROVIDER_LIST,
  DASHBOARD_DEFAULT_PROVIDER,
  DEFAULT_AI_PROVIDER,
  isAiProviderId,
  type AiProviderId,
} from '@/lib/aiProviders';

const inputClass =
  'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60';

export default function AiSettingsPage() {
  const { addToast } = useToast();
  const { canManageAi, canReadAiChats } = useCatalogActionPermissions();
  const { data, isLoading, isError } = useAdminAiSettingsQuery();
  const updateMutation = useUpdateAiSettingsMutation();
  const testMutation = useTestAiConnectionMutation();
  const importMutation = useImportAiFromEnvMutation();

  const [botName, setBotName] = useState('StyleForge AI');
  const [usePublicData, setUsePublicData] = useState(false);
  const [provider, setProvider] = useState<AiProviderId>(DASHBOARD_DEFAULT_PROVIDER);
  const [modelChoice, setModelChoice] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [providerFieldsDirty, setProviderFieldsDirty] = useState(false);

  const providerDef = AI_PROVIDERS[provider];
  const isServerDefault = provider === DEFAULT_AI_PROVIDER;
  const touchesProviderConfig = providerDirty || providerFieldsDirty;

  const presetModelIds = useMemo(
    () => new Set(providerDef.models.map((m) => m.id)),
    [providerDef]
  );

  useEffect(() => {
    if (!data) return;
    setBotName(data.botName?.trim() || 'StyleForge AI');
    setUsePublicData(Boolean(data.usePublicData));

    const storedProvider = isAiProviderId(data.provider)
      ? data.provider
      : DEFAULT_AI_PROVIDER;
    const displayProvider =
      storedProvider === DEFAULT_AI_PROVIDER &&
      isAiProviderId(data.activeProviderId)
        ? data.activeProviderId
        : storedProvider;
    setProvider(displayProvider);

    const savedModel = data.model?.trim() || '';
    const effectiveModel =
      savedModel ||
      (data.followsServerEnv ? data.activeModel?.trim() || '' : '');
    const nextDef = AI_PROVIDERS[displayProvider];
    if (
      effectiveModel &&
      !nextDef.models.some((m) => m.id === effectiveModel)
    ) {
      setModelChoice(CUSTOM_MODEL_SENTINEL);
      setCustomModel(effectiveModel);
    } else {
      setModelChoice(
        effectiveModel || nextDef.models[0]?.id || CUSTOM_MODEL_SENTINEL
      );
      setCustomModel('');
    }

    setBaseUrl(data.baseUrl?.trim() || '');
    const effectiveMaxTokens =
      typeof data.maxTokens === 'number'
        ? data.maxTokens
        : data.followsServerEnv && typeof data.activeMaxTokens === 'number'
          ? data.activeMaxTokens
          : null;
    setMaxTokens(
      typeof effectiveMaxTokens === 'number' ? String(effectiveMaxTokens) : ''
    );
    setApiKey('');
    setClearApiKey(false);
    setProviderDirty(false);
    setProviderFieldsDirty(false);
  }, [data]);

  const markProviderFieldsDirty = () => {
    setProviderFieldsDirty(true);
  };

  const resolveFormModel = () =>
    isServerDefault
      ? ''
      : modelChoice === CUSTOM_MODEL_SENTINEL
        ? customModel.trim()
        : modelChoice.trim();

  const parseFormMaxTokens = (): number | null | 'invalid' => {
    if (!maxTokens.trim()) return null;
    const n = Number(maxTokens);
    if (!Number.isFinite(n) || n < 1 || n > 4096) return 'invalid';
    return Math.floor(n);
  };

  const providerForPayload = (): AiProviderId => {
    if (providerDirty) return provider;
    if (providerFieldsDirty && data?.followsServerEnv) return provider;
    return isAiProviderId(data?.provider)
      ? data.provider
      : DEFAULT_AI_PROVIDER;
  };

  const buildProviderPayload = () => {
    const providerToSave = providerForPayload();
    const savingServerDefault = providerToSave === DEFAULT_AI_PROVIDER;
    const resolvedModel = savingServerDefault ? '' : resolveFormModel();
    const parsedMax = parseFormMaxTokens();
    if (parsedMax === 'invalid') return null;

    return {
      provider: providerToSave,
      model: resolvedModel,
      baseUrl: providerToSave === 'custom' ? baseUrl.trim() : '',
      maxTokens: savingServerDefault ? null : parsedMax,
      ...(clearApiKey
        ? { clearApiKey: true }
        : apiKey.trim()
          ? { apiKey: apiKey.trim() }
          : {}),
    };
  };

  const handleProviderChange = (next: AiProviderId) => {
    setProviderDirty(true);
    setProviderFieldsDirty(true);
    setProvider(next);
    const def = AI_PROVIDERS[next];
    setModelChoice(def.models[0]?.id || CUSTOM_MODEL_SENTINEL);
    setCustomModel('');
    if (!def.requiresBaseUrl) setBaseUrl('');
    setApiKey('');
    setClearApiKey(false);
  };

  const handleTestConnection = async () => {
    if (!canManageAi) {
      addToast('You do not have permission to test AI settings', 'error');
      return;
    }

    const resolvedModel = resolveFormModel();
    const parsedMax = parseFormMaxTokens();
    if (parsedMax === 'invalid') {
      addToast('Max tokens must be between 1 and 4096', 'error');
      return;
    }

    const savingServerDefault = providerForPayload() === DEFAULT_AI_PROVIDER;
    if (!savingServerDefault && !resolvedModel) {
      addToast('Choose a model or enter a model id before testing', 'error');
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      addToast('Custom provider requires a base URL before testing', 'error');
      return;
    }

    try {
      const testSavedOnly =
        !touchesProviderConfig && !apiKey.trim() && !clearApiKey;
      let testPayload: ReturnType<typeof buildProviderPayload> | undefined;
      if (!testSavedOnly) {
        testPayload = buildProviderPayload();
        if (!testPayload) {
          addToast('Max tokens must be between 1 and 4096', 'error');
          return;
        }
        const hasDraftKey = 'apiKey' in testPayload;
        if (
          !hasDraftKey &&
          !data?.apiKeyConfigured &&
          !testPayload.clearApiKey
        ) {
          addToast('Paste your API key before testing', 'error');
          return;
        }
      }
      const result = await testMutation.mutateAsync(testPayload);
      addToast(
        `${result.message} (${result.provider} · ${result.model})`,
        'success'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Connection test failed';
      addToast(message, 'error');
    }
  };

  const handleImportFromEnv = async () => {
    if (!canManageAi) return;
    try {
      await importMutation.mutateAsync();
      addToast(
        'Assistant saved to the dashboard. You can remove OPENROUTER_* from .env.local when ready.',
        'success'
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not import from server environment';
      addToast(message, 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAi) {
      addToast('You do not have permission to save AI settings', 'error');
      return;
    }
    const name = botName.trim();
    if (!name) {
      addToast('Assistant name cannot be empty', 'error');
      return;
    }

    const resolvedModel = resolveFormModel();

    if (providerForPayload() !== DEFAULT_AI_PROVIDER && !resolvedModel) {
      addToast('Choose a model or enter a model id', 'error');
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      addToast('Custom provider requires a base URL', 'error');
      return;
    }

    const parsedMax = parseFormMaxTokens();
    if (parsedMax === 'invalid') {
      addToast('Max tokens must be between 1 and 4096', 'error');
      return;
    }

    const providerPayload = touchesProviderConfig
      ? buildProviderPayload()
      : null;
    if (touchesProviderConfig && !providerPayload) {
      addToast('Max tokens must be between 1 and 4096', 'error');
      return;
    }

    const needsNewKey =
      touchesProviderConfig &&
      providerPayload &&
      providerPayload.provider !== DEFAULT_AI_PROVIDER &&
      !('apiKey' in providerPayload) &&
      !providerPayload.clearApiKey &&
      !data?.apiKeyConfigured;
    if (needsNewKey) {
      addToast('Paste your API key below, then save', 'error');
      return;
    }
    if (
      touchesProviderConfig &&
      providerPayload?.clearApiKey &&
      !('apiKey' in providerPayload)
    ) {
      addToast('Paste a new API key before removing the saved one', 'error');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        botName: name,
        usePublicData,
        ...(providerPayload ?? {}),
      });
      setApiKey('');
      setClearApiKey(false);
      addToast(
        'AI settings saved. The storefront chatbot will use this assistant on the next message.',
        'success'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save AI settings';
      addToast(message, 'error');
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load AI settings. Please refresh and try again.
      </div>
    );
  }

  const savedKeyHint = (() => {
    if (clearApiKey) {
      return 'The saved dashboard key will be removed on save; the server environment key will be used instead.';
    }
    if (apiKey.trim()) {
      return 'A new key will be saved encrypted when you click Save.';
    }
    if (data?.apiKeyLast4 && data.activeApiKeySource === 'stored') {
      return `Saved dashboard key ending in ${data.apiKeyLast4}`;
    }
    if (data?.activeApiKeyLast4 && data.activeApiKeySource === 'env') {
      const envName = data.activeEnvKeyName || 'server environment';
      return `Using ${envName} (ending in ${data.activeApiKeyLast4})`;
    }
    if (data?.activeApiKeyLast4 && data.activeApiKeySource === 'stored') {
      return `Saved dashboard key ending in ${data.activeApiKeyLast4}`;
    }
    if (data?.apiKeyConfigured && data?.usesServerEnvKey) {
      const envName = data.activeEnvKeyName || 'server environment';
      return `Using the ${envName} key from your server environment`;
    }
    if (data?.apiKeyConfigured) {
      return 'API key configured';
    }
    return 'Paste your API key above and save — it is stored encrypted in the dashboard';
  })();

  const activeKeyLabel = (() => {
    if (!data?.activeApiKeyLast4) {
      return data?.apiKeyConfigured ? 'Configured' : 'Not configured';
    }
    if (data.activeApiKeySource === 'env') {
      const envName = data.activeEnvKeyName || 'server env';
      return `${envName} ····${data.activeApiKeyLast4}`;
    }
    return `Dashboard key ····${data.activeApiKeyLast4}`;
  })();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assistant settings</h1>
        <p className="text-sm text-gray-600 mt-2">
          Configure the storefront chatbot here — provider, model, and API key
          are all saved in the dashboard. You do not need to edit{' '}
          <code className="text-xs">.env.local</code> for the assistant.
        </p>
      </div>

      {data?.followsServerEnv && canManageAi && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 space-y-3">
          <p>
            Your assistant still reads OpenRouter from{' '}
            <code className="text-xs">.env.local</code>. Move it into the
            dashboard so everything is managed here.
          </p>
          <button
            type="button"
            disabled={importMutation.isPending}
            onClick={handleImportFromEnv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-900 text-amber-50 font-semibold hover:bg-amber-950 disabled:opacity-60"
          >
            {importMutation.isPending && <ButtonSpinner />}
            Move current setup to dashboard
          </button>
        </div>
      )}

      {data?.envImportAvailable && !data.followsServerEnv && canManageAi && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 space-y-3">
          <p>
            OpenRouter credentials were found in{' '}
            <code className="text-xs">.env.local</code> but are not saved in the
            dashboard yet. Import them with one click.
          </p>
          <button
            type="button"
            disabled={importMutation.isPending}
            onClick={handleImportFromEnv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-900 text-amber-50 font-semibold hover:bg-amber-950 disabled:opacity-60"
          >
            {importMutation.isPending && <ButtonSpinner />}
            Move current setup to dashboard
          </button>
        </div>
      )}

      {data &&
        !data.followsServerEnv &&
        !data.apiKeyConfigured &&
        !data.envImportAvailable &&
        canManageAi && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            Paste your provider API key below, pick a model, then click{' '}
            <strong>Save AI settings</strong> and{' '}
            <strong>Test connection</strong>.
          </div>
        )}

      {canReadAiChats && (
        <div className="rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 px-4 py-3 text-sm text-gray-700 flex flex-wrap items-center justify-between gap-3">
          <span>
            Customer conversations, contacts, and handoffs are in Conversations.
          </span>
          <Link
            href="/admin/ai-chats"
            className="font-semibold text-[#8B6914] hover:text-[#6B5010] whitespace-nowrap"
          >
            Open Conversations →
          </Link>
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6"
      >
        <div>
          <label
            htmlFor="botName"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Assistant name
          </label>
          <input
            id="botName"
            type="text"
            value={botName}
            disabled={!canManageAi}
            onChange={(e) => setBotName(e.target.value)}
            placeholder="StyleForge AI"
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1.5">
            Shown in the chatbot header on the storefront.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Allow general fashion knowledge
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              Recommended on. Off: still allows styling tips, but stays closer to
              your products and tailoring. On: broader fashion knowledge beyond
              the catalog.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={usePublicData}
            disabled={!canManageAi}
            onClick={() => setUsePublicData((v) => !v)}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              usePublicData ? 'bg-[#D4AF37]' : 'bg-gray-200'
            } ${canManageAi ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ${
                usePublicData ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="border-t border-gray-100 pt-6 space-y-5">
          {data && (data.activeProviderLabel || data.followsServerEnv) && (
            <div
              className={`rounded-xl border p-4 space-y-2 ${
                isAssistantConfigured(data)
                  ? 'border-emerald-200/80 bg-emerald-50/80'
                  : 'border-amber-200/80 bg-amber-50/80'
              }`}
            >
              <h2
                className={`text-sm font-semibold ${
                  isAssistantConfigured(data)
                    ? 'text-emerald-950'
                    : 'text-amber-950'
                }`}
              >
                {isAssistantConfigured(data)
                  ? 'Currently in use'
                  : 'Setup required'}
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Provider</dt>
                  <dd className="font-medium text-gray-900">
                    {data.activeProviderLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Model</dt>
                  <dd className="font-medium text-gray-900">
                    {data.activeModel || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">API key</dt>
                  <dd className="font-medium text-gray-900">{activeKeyLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Max tokens</dt>
                  <dd className="font-medium text-gray-900">
                    {data.activeMaxTokens}
                  </dd>
                </div>
                {data.activeBaseUrl && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-gray-500">API base URL</dt>
                    <dd className="font-medium text-gray-900 break-all">
                      {data.activeBaseUrl}
                    </dd>
                  </div>
                )}
              </dl>
              {!isAssistantConfigured(data) && !data.followsServerEnv && (
                <p className="text-xs text-amber-900/90">
                  Paste your API key below, then save and test connection to
                  activate the storefront chatbot.
                </p>
              )}
              {data.followsServerEnv && (
                <p className="text-xs text-emerald-800/90">
                  Still using <code className="text-[11px]">.env.local</code>{' '}
                  — click <strong>Move current setup to dashboard</strong> above
                  to store everything here instead.
                </p>
              )}
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              AI provider
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              Pick a provider, paste your API key, choose a model, and save.
              Changes apply to the storefront chatbot on the next message.
            </p>
          </div>

          <div>
            <label
              htmlFor="aiProvider"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Provider
            </label>
            <select
              id="aiProvider"
              value={provider}
              disabled={!canManageAi}
              onChange={(e) =>
                handleProviderChange(e.target.value as AiProviderId)
              }
              className={inputClass}
            >
              {DASHBOARD_AI_PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1.5">
              {providerDef.description}
            </p>
          </div>

          {!isServerDefault && (
            <>
              <div>
                <label
                  htmlFor="aiModel"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Model
                </label>
                <select
                  id="aiModel"
                  value={
                    modelChoice &&
                    (modelChoice === CUSTOM_MODEL_SENTINEL ||
                      presetModelIds.has(modelChoice))
                      ? modelChoice
                      : CUSTOM_MODEL_SENTINEL
                  }
                  disabled={!canManageAi}
                  onChange={(e) => {
                    setModelChoice(e.target.value);
                    markProviderFieldsDirty();
                  }}
                  className={inputClass}
                >
                  {providerDef.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_SENTINEL}>
                    Other (type a model id)
                  </option>
                </select>
                {(modelChoice === CUSTOM_MODEL_SENTINEL ||
                  providerDef.models.length === 0) && (
                  <input
                    type="text"
                    value={customModel}
                    disabled={!canManageAi}
                    onChange={(e) => {
                      setCustomModel(e.target.value);
                      markProviderFieldsDirty();
                    }}
                    placeholder="e.g. gpt-4o-mini"
                    className={`${inputClass} mt-2`}
                    autoComplete="off"
                  />
                )}
              </div>

              {providerDef.requiresBaseUrl && (
                <div>
                  <label
                    htmlFor="aiBaseUrl"
                    className="block text-sm font-medium text-gray-700 mb-1.5"
                  >
                    API base URL
                  </label>
                  <input
                    id="aiBaseUrl"
                    type="url"
                    value={baseUrl}
                    disabled={!canManageAi}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      markProviderFieldsDirty();
                    }}
                    placeholder="https://api.example.com/v1"
                    className={inputClass}
                    autoComplete="off"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="aiApiKey"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  API key
                </label>
                <input
                  id="aiApiKey"
                  type="password"
                  value={apiKey}
                  disabled={!canManageAi || clearApiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    markProviderFieldsDirty();
                  }}
                  placeholder="Paste your API key here"
                  className={inputClass}
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500 mt-1.5">{savedKeyHint}</p>
                <label className="mt-2 flex items-start gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    disabled={!canManageAi}
                    onChange={(e) => {
                      setClearApiKey(e.target.checked);
                      markProviderFieldsDirty();
                      if (e.target.checked) setApiKey('');
                    }}
                    className="mt-0.5"
                  />
                  Remove the saved dashboard key (you will need to paste a new
                  one for the chatbot to work)
                </label>
              </div>

              <div>
                <label
                  htmlFor="aiMaxTokens"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Max tokens per reply (optional)
                </label>
                <input
                  id="aiMaxTokens"
                  type="number"
                  min={1}
                  max={4096}
                  value={maxTokens}
                  disabled={!canManageAi}
                  onChange={(e) => {
                    setMaxTokens(e.target.value);
                    markProviderFieldsDirty();
                  }}
                  placeholder="512"
                  className={inputClass}
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Leave blank to keep the safe default. Raise this only if the
                  provider account has enough credit.
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-gray-500">
          This does not change Stripe checkout, tax, or payments. Product and
          fabric images still upload from their create/edit forms. The public
          chatbot never receives your API key.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canManageAi || updateMutation.isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-gray-900 font-semibold hover:bg-[#B8941F] disabled:opacity-60"
          >
            {updateMutation.isPending && <ButtonSpinner />}
            Save AI settings
          </button>
          <button
            type="button"
            disabled={!canManageAi || testMutation.isPending}
            onClick={handleTestConnection}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:border-[#D4AF37]/40 disabled:opacity-60"
          >
            {testMutation.isPending && <ButtonSpinner />}
            Test connection
          </button>
        </div>
        <p className="text-xs text-gray-500 -mt-3">
          Test connection uses the values currently shown in this form (it does
          not save them).
        </p>
      </form>

      {data && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900 mb-3">Audit</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500">Created by</div>
              <div>{formatAuditName(data.createdByName)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Updated by</div>
              <div>{formatAuditName(data.updatedByName)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Created</div>
              <div>{formatAuditDate(data.createdAt, 'datetime')}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Updated</div>
              <div>{formatAuditDate(data.updatedAt, 'datetime')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
