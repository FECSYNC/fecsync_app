/**
 * SMS adapter for waiver links. Missing Twilio env is an honest 400 — never "sent".
 */

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("SMS is not configured");
    this.name = "Error";
  }
}

function twilioFrom(): string {
  return (
    process.env.TWILIO_FROM?.trim() ||
    process.env.TWILIO_PHONE_NUMBER?.trim() ||
    ""
  );
}

export function smsIsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      twilioFrom()
  );
}

export async function sendSms(
  to: string,
  body: string
): Promise<{ providerId: string }> {
  if (!smsIsConfigured()) throw new SmsNotConfiguredError();
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from = twilioFrom();
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body.slice(0, 640) });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
  };
  if (!res.ok || !json.sid) {
    throw new Error(json.message || "SMS send failed");
  }
  return { providerId: json.sid };
}
