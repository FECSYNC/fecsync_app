export class ShippingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ShippingError";
    this.code = code;
  }
}

export class ShippingProviderError extends ShippingError {
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    options?: { code?: string; statusCode?: number; retryable?: boolean }
  ) {
    super(options?.code ?? "provider_error", message);
    this.name = "ShippingProviderError";
    this.provider = provider;
    this.statusCode = options?.statusCode;
    const status = options?.statusCode;
    this.retryable =
      options?.retryable ??
      (status != null ? status >= 500 || status === 429 : false);
  }
}

export class ShippingRateExpiredError extends ShippingError {
  constructor(message = "Shipping rate has expired. Please select a new method.") {
    super("rate_expired", message);
    this.name = "ShippingRateExpiredError";
  }
}

export class ShippingRateInvalidError extends ShippingError {
  constructor(message = "Invalid or unknown shipping rate token.") {
    super("rate_invalid", message);
    this.name = "ShippingRateInvalidError";
  }
}

export class ShippingNotConfiguredError extends ShippingError {
  constructor(message = "Shipping is not configured for this organization.") {
    super("not_configured", message);
    this.name = "ShippingNotConfiguredError";
  }
}

export function isShippingError(error: unknown): error is ShippingError {
  return error instanceof ShippingError;
}
