/**
 * Client-safe fashion chat scanners / sanitizers.
 * Do NOT import next/server, rateLimit, db, or other Node-only modules here —
 * this file is used by ChatWindow, ChatInput, and admin AI Chats UI.
 */

export const FASHION_CHAT_MAX_MESSAGE_LENGTH = 2000;
export const FASHION_CHAT_MAX_STAFF_MESSAGE_LENGTH = 4000;
export const FASHION_CHAT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const FASHION_CHAT_SECURITY_CODE = "SECURITY_BLOCKED";
export const FASHION_CHAT_SECURITY_RATE_CODE = "SECURITY_RATE_LIMITED";

export const FASHION_CHAT_SECURITY_WARNING =
  "Your message was blocked for security reasons. Scripts, code injection, and harmful content are not allowed in this chat. Repeated attempts may lead to temporary restrictions.";

export const FASHION_CHAT_SECURITY_BAN_MESSAGE =
  "Too many blocked messages. Chat access from your connection is temporarily restricted. Please try again later.";

export type FashionChatSecurityScanResult =
  | { allowed: true; content: string; image?: string }
  | {
      allowed: false;
      reason: string;
      code:
        | typeof FASHION_CHAT_SECURITY_CODE
        | typeof FASHION_CHAT_SECURITY_RATE_CODE;
    };

/**
 * Always block — clear XSS / executable payloads regardless of message topic.
 */
const CRITICAL_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /<\s*\/?\s*(script|iframe|object|embed|svg|math|link|style|meta|base|form|input|button|textarea|template|marquee)\b/i,
    label: "HTML markup",
  },
  {
    re: /<\s*img\b[^>]*(on(?:click|error|load|mouseover|focus|blur|submit|change|input|keydown|keyup)\s*=|src\s*=)/i,
    label: "HTML event handler",
  },
  {
    re: /\b(on(?:click|error|load|mouseover|focus|blur|submit|change|input|keydown|keyup))\s*=/i,
    label: "DOM event handler",
  },
  { re: /\bjavascript\s*:/i, label: "javascript URL" },
  { re: /\bvbscript\s*:/i, label: "vbscript URL" },
  { re: /data\s*:\s*text\/html/i, label: "HTML data URL" },
  {
    re: /data\s*:\s*application\/(?:javascript|x-javascript)/i,
    label: "script data URL",
  },
  {
    re: /\bdocument\s*\.\s*(cookie|write|domain|location)/i,
    label: "document access",
  },
  { re: /\bwindow\s*\.\s*(location|open|eval)/i, label: "window access" },
  { re: /\beval\s*\(/i, label: "eval()" },
  { re: /\bnew\s+Function\s*\(/i, label: "Function constructor" },
  {
    re: /\.(?:innerHTML|outerHTML|insertAdjacentHTML)\b/i,
    label: "HTML injection API",
  },
  { re: /<%[\s\S]*?%>/, label: "server template tag" },
  {
    re: /\[\s*[^\]]*?\]\s*\(\s*(?:javascript|data|vbscript)\s*:/i,
    label: "markdown script link",
  },
  {
    re: /!\[[^\]]*]\(\s*(?:javascript|data|vbscript)\s*:/i,
    label: "markdown script image",
  },
  { re: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, label: "control characters" },
];

/**
 * Block only when the message does NOT look like normal shopping / fashion chat.
 */
const SECONDARY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(import\s*\(|XMLHttpRequest|ActiveXObject)\b/i, label: "remote code pattern" },
  { re: /\$\{\s*[^}]+\s*\}/, label: "template injection" },
  {
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)\b/i,
    label: "prompt injection",
  },
  {
    re: /\b(?:reveal|print|dump|leak)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?)\b/i,
    label: "prompt extraction",
  },
  { re: /\b(jailbreak|DAN\s+mode|developer\s+mode\s+enabled)\b/i, label: "jailbreak attempt" },
  { re: /\bunion\s+(?:all\s+)?select\b/i, label: "SQL injection pattern" },
  { re: /\bdrop\s+table\b/i, label: "SQL injection pattern" },
  { re: /\binsert\s+into\s+[`'"\w]/i, label: "SQL injection pattern" },
  { re: /\bdelete\s+from\s+[`'"\w]/i, label: "SQL injection pattern" },
  { re: /'\s*or\s+'?1'?\s*=\s*'?1/i, label: "SQL injection pattern" },
  { re: /;\s*(?:drop|delete|insert|update|select)\b/i, label: "SQL injection pattern" },
];

const FASHION_SHOPPING_KEYWORDS =
  /\b(dress|dresses|shirt|shirts|fabric|fabrics|color|colour|colors|colours|size|sizes|product|products|wedding|outfit|outfits|price|prices|budget|cart|shop|shopping|store|collection|style|styles|wear|ankara|lace|trouser|trousers|pants|skirt|blouse|gown|tailor|custom|customi[sz]e|order|buy|find|show|recommend|suggest|looking|look|need|want|help|hello|hi|hey|thanks|thank|please|affordable|formal|casual|party|occasion|fit|measurement|sleeve|neckline|pattern|material|cotton|silk|chiffon|denim|leather|shoe|shoes|bag|bags|accessory|accessories|men|women|kid|kids|child|children|naira|ngn|under|above|between|compare|similar|match|pair|coordinate|available|stock|delivery|ship|return|refund|discount|sale|new|arrival|catalogue|catalog|browse|search|filter|category|categories|ready|made|bespoke|sew|stitch|hem|length|waist|hip|bust|shoulder|collar|button|zip|print|floral|plain|striped|checked|elegant|classy|simple|traditional|modern|vintage|bridal|groom|asoebi|agbada|senator|kaftan|boubou|wrapper|george|hollandais|net|sequin|bead|embellish)\b/i;

const SIMPLE_CONVERSATION =
  /^[\p{L}\p{N}\s.,!?'"()\-–—₦$€£%&+/:@#*]+$/u;

export function isFashionChatSecurityBlockedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("blocked for security") ||
    lower.includes("temporarily restricted") ||
    message.includes(FASHION_CHAT_SECURITY_CODE) ||
    message.includes(FASHION_CHAT_SECURITY_RATE_CODE)
  );
}

function normalizeContent(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/** True when the message reads like normal fashion / product chat. */
export function isLikelyLegitimateShoppingMessage(content: string): boolean {
  const text = content.trim();
  if (!text) return false;

  if (/[<>]/.test(text)) return false;
  if (/^\s*(function|const|let|var|class)\b/i.test(text)) return false;

  const codeLikeChars = (text.match(/[{}[\]();\\=`$]/g) || []).length;
  if (codeLikeChars >= 6 && codeLikeChars / text.length > 0.06) return false;

  if (FASHION_SHOPPING_KEYWORDS.test(text)) return true;

  if (text.length <= 160 && SIMPLE_CONVERSATION.test(text)) return true;

  return false;
}

function detectBlockedPattern(content: string): string | null {
  for (const { re, label } of CRITICAL_PATTERNS) {
    if (re.test(content)) return label;
  }

  if (isLikelyLegitimateShoppingMessage(content)) {
    return null;
  }

  for (const { re, label } of SECONDARY_PATTERNS) {
    if (re.test(content)) return label;
  }

  return null;
}

export function validateFashionChatImage(
  image?: string
): { allowed: true; image?: string } | { allowed: false; reason: string } {
  if (!image || !image.trim()) return { allowed: true };

  const trimmed = image.trim();

  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(trimmed)) {
    const base64 = trimmed.slice(trimmed.indexOf(",") + 1);
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > FASHION_CHAT_MAX_IMAGE_BYTES) {
      return { allowed: false, reason: "Image is too large" };
    }
    if (!/^[\w+/=\s-]+$/i.test(base64)) {
      return { allowed: false, reason: "Invalid image encoding" };
    }
    return { allowed: true, image: trimmed };
  }

  if (/^https:\/\//i.test(trimmed)) {
    return { allowed: false, reason: "External image URLs are not allowed" };
  }

  return { allowed: false, reason: "Unsupported image format" };
}

export function scanFashionChatMessage(input: {
  content: string;
  image?: string;
  maxLength?: number;
}): FashionChatSecurityScanResult {
  const content = normalizeContent(input.content || "");
  const maxLength = input.maxLength ?? FASHION_CHAT_MAX_MESSAGE_LENGTH;
  if (!content && !input.image?.trim()) {
    return { allowed: false, reason: "Message is empty", code: FASHION_CHAT_SECURITY_CODE };
  }

  if (content.length > maxLength) {
    return {
      allowed: false,
      reason: `Message is too long (max ${maxLength} characters)`,
      code: FASHION_CHAT_SECURITY_CODE,
    };
  }

  if (content.split("\n").length > 80) {
    return {
      allowed: false,
      reason: "Message has too many lines",
      code: FASHION_CHAT_SECURITY_CODE,
    };
  }

  const blocked = detectBlockedPattern(content);
  if (blocked) {
    return {
      allowed: false,
      reason: FASHION_CHAT_SECURITY_WARNING,
      code: FASHION_CHAT_SECURITY_CODE,
    };
  }

  const imageCheck = validateFashionChatImage(input.image);
  if (!imageCheck.allowed) {
    return {
      allowed: false,
      reason: FASHION_CHAT_SECURITY_WARNING,
      code: FASHION_CHAT_SECURITY_CODE,
    };
  }

  return {
    allowed: true,
    content: content || (input.image ? "Please analyze this outfit image." : ""),
    image: imageCheck.image,
  };
}

/** Staff replies: same content rules, higher length cap, no IP strike counter. */
export function scanFashionChatMessageForStaff(input: {
  content: string;
}): FashionChatSecurityScanResult {
  return scanFashionChatMessage({
    content: input.content,
    maxLength: FASHION_CHAT_MAX_STAFF_MESSAGE_LENGTH,
  });
}

export function sanitizeFashionChatUrl(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.includes("\0")) return null;

  if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")) {
    return href;
  }

  try {
    const parsed = new URL(href);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeFashionChatImageSrc(raw: string): string | null {
  const src = raw.trim();
  if (!src) return null;
  if (src.startsWith("/")) return sanitizeFashionChatUrl(src);
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(src)) {
    const base64 = src.slice(src.indexOf(",") + 1);
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > FASHION_CHAT_MAX_IMAGE_BYTES) return null;
    if (!/^[\w+/=\s-]+$/i.test(base64)) return null;
    return src;
  }
  return sanitizeFashionChatUrl(src);
}

export function normalizeFashionChatPhone(raw: string): string | null {
  const phone = raw.trim();
  if (!phone) return "";
  if (phone.length > 32) return null;
  if (!/^[\d\s+\-().#xX]+$/.test(phone)) return null;
  return phone;
}

export function scanFashionChatContactName(name: string): boolean {
  const normalized = normalizeContent(name);
  if (!normalized || normalized.length > 120) return false;
  return !detectBlockedPattern(normalized);
}
