/**
 * Map internal / provider errors to short, customer-safe copy.
 * Never expose HTTP codes, stack traces, or provider names in the storefront UI.
 */
export function toCustomerChatMessage(raw: unknown): string {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : "Something went wrong.";
  const lower = message.toLowerCase();

  if (
    lower.includes("session") &&
    (lower.includes("expired") || lower.includes("ended"))
  ) {
    return "Your conversation time has ended. Please start a new chat.";
  }
  if (lower.includes("temporarily unavailable") || lower.includes("try again")) {
    return message.trim();
  }
  if (lower.includes("contact support") || lower.includes("not configured")) {
    return "Our style assistant is temporarily unavailable. Please try again in a moment.";
  }
  if (lower.includes("rate limit") || lower.includes("busy")) {
    return "Our style assistant is busy right now. Please wait a moment and try again.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "That took too long. Please try again.";
  }
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("connection")
  ) {
    return "We couldn't reach the assistant. Check your connection and try again.";
  }

  return "I'm sorry — something went wrong on our side. Please try again in a moment.";
}

/** Log handled client issues without triggering the Next.js dev error badge. */
export function logHandledClientIssue(context: string, detail: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  const msg =
    detail instanceof Error
      ? detail.message
      : typeof detail === "string"
        ? detail
        : String(detail);
  console.warn(`[${context}]`, msg);
}
