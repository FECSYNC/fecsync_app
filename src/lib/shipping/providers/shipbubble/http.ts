import { ShippingNotConfiguredError, ShippingProviderError } from "../../errors";
import {
  SHIPBUBBLE_API_BASE_URL,
  SHIPBUBBLE_ENV_KEYS,
} from "./constants";

function getApiKey(): string {
  const key = process.env[SHIPBUBBLE_ENV_KEYS.apiKey]?.trim();
  if (!key) {
    throw new ShippingNotConfiguredError(
      `${SHIPBUBBLE_ENV_KEYS.apiKey} is not set`
    );
  }
  return key;
}

/** Low-level Shipbubble HTTP client — used by rate/book implementations. */
export async function shipbubbleFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const apiKey = getApiKey();
  const url = `${SHIPBUBBLE_API_BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network request failed";
    throw new ShippingProviderError("shipbubble", message, {
      code: "network_error",
      retryable: true,
    });
  }

  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    status?: string;
  };
  if (!response.ok) {
    throw new ShippingProviderError(
      "shipbubble",
      typeof body.message === "string"
        ? body.message
        : `Shipbubble API error (${response.status})`,
      {
        statusCode: response.status,
        retryable: response.status >= 500 || response.status === 429,
      }
    );
  }
  if (
    typeof body.status === "string" &&
    body.status.toLowerCase() === "failed"
  ) {
    throw new ShippingProviderError(
      "shipbubble",
      typeof body.message === "string"
        ? body.message
        : "Shipbubble request failed",
      { statusCode: response.status, code: "provider_failed" }
    );
  }
  return body;
}

export function getShipbubbleWebhookSecret(): string | null {
  const secret = process.env[SHIPBUBBLE_ENV_KEYS.webhookSecret]?.trim();
  return secret || null;
}
