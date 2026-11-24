/** Short greetings — answered instantly without an AI round-trip. */
const GREETING_ONLY =
  /^(hi|hello|hey|hiya|howdy|yo|sup|good\s+(morning|afternoon|evening|day))[\s!.?,]*$/i;

const PRODUCT_INTENT =
  /\b(dress|shirt|fabric|aso|agbada|kaftan|shop|buy|price|product|wear|outfit|tailor|custom|search|find|show me|recommend|suggest|looking for|need a|want a|help me pick|what do you have|catalog|collection)\b/i;

export function isSimpleGreeting(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 48) return false;
  return GREETING_ONLY.test(trimmed);
}

/** Skip tool calls for greetings and small talk — much faster first reply. */
export function shouldEnableFashionTools(
  message: string,
  hasImage: boolean
): boolean {
  if (hasImage) return true;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (isSimpleGreeting(trimmed)) return false;
  if (trimmed.length <= 48 && !PRODUCT_INTENT.test(trimmed)) return false;
  return true;
}

export function buildInstantGreetingReply(botName: string): string {
  const name = botName.trim() || "StyleForge AI";
  return `Hello! I'm ${name}. I can help you find outfits, fabrics, and custom tailoring from FECSYNC. What are you looking for today?`;
}
