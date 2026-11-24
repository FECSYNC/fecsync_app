/**
 * Env-gated SMS adapter. Unset BOOKING_SMS_PROVIDER → no-op (sms_skipped).
 * Party messages prefer PARTY_SMS_PROVIDER and fall back to BOOKING_SMS_PROVIDER.
 */
export type SmsSendResult =
  | { sent: true; providerId: string }
  | { sent: false; skipped: true; reason: string };

export type SmsScope = "booking" | "party";

function smsProvider(scope: SmsScope): string | null {
  const party = scope === "party" ? process.env.PARTY_SMS_PROVIDER?.trim() : "";
  return party || process.env.BOOKING_SMS_PROVIDER?.trim() || null;
}

export function smsProviderConfigured(scope: SmsScope = "booking"): boolean {
  return Boolean(smsProvider(scope));
}

export async function sendBookingSms(opts: {
  to: string;
  body: string;
  orgId?: string;
  scope?: SmsScope;
}): Promise<SmsSendResult> {
  const provider = smsProvider(opts.scope ?? "booking");
  if (!provider) {
    return { sent: false, skipped: true, reason: "sms_skipped" };
  }
  // External SMS provider adapters are residual — fail soft when configured.
  console.info("[booking sms] provider configured but adapter is stub", {
    provider,
    to: opts.to.slice(0, 4) + "…",
    orgId: opts.orgId,
    bodyLen: opts.body.length,
  });
  return { sent: false, skipped: true, reason: "sms_adapter_stub" };
}
