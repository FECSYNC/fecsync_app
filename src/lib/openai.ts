// utils/openai.ts
import OpenAI from "openai";
import {
  fashionAiRuntimeError,
  mergeFashionAiHeaders,
  resolveFashionAiRuntime,
  fashionAiSupportsNativeTools,
  type FashionAiRuntime,
} from "@/lib/aiRuntime";

function createFashionAiClient(runtime: FashionAiRuntime) {
  return new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseURL,
    defaultHeaders: mergeFashionAiHeaders(runtime),
    timeout: 45_000,
    maxRetries: 1,
  });
}

function assertFashionAiRuntime(runtime: FashionAiRuntime) {
  const message = fashionAiRuntimeError(runtime);
  if (message) {
    throw new Error(message);
  }
}

function providerSaid(message: string): string {
  const trimmed = message.trim();
  return trimmed ? ` Provider said: ${trimmed.slice(0, 240)}` : "";
}

/** True when OpenAI/OpenRouter rejected the call for billing/quota (often HTTP 429). */
function isQuotaOrBillingError(lower: string): boolean {
  return (
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing_not_active") ||
    lower.includes("billing hard limit") ||
    (lower.includes("check your plan") && lower.includes("billing")) ||
    (lower.includes("insufficient") && lower.includes("quota")) ||
    lower.includes("402") ||
    lower.includes("requires more credits") ||
    lower.includes("can only afford") ||
    (lower.includes("insufficient") && lower.includes("credit"))
  );
}

/** User-safe message for provider failures (credits, auth, rate limits). */
export function formatFashionAiError(
  err: unknown,
  options?: { verbose?: boolean }
): string {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = message.toLowerCase();

  // OpenAI often returns HTTP 429 for exhausted quota — check billing before "busy".
  if (isQuotaOrBillingError(lower)) {
    if (options?.verbose) {
      return (
        "Your AI provider rejected the request due to billing or quota. " +
        "A ChatGPT Plus subscription does not include API credits — add payment " +
        "method and usage credits at platform.openai.com (Settings → Billing), " +
        "or use OpenRouter with credits at openrouter.ai." +
        providerSaid(message)
      );
    }
    return "Our style assistant is temporarily unavailable due to AI service limits. Please try again later or contact support.";
  }
  if (lower.includes("401") || lower.includes("invalid api key") || lower.includes("incorrect api key")) {
    if (options?.verbose) {
      return (
        "The API key was rejected by the provider. Check that you pasted the correct key " +
        "for the selected provider (OpenAI → platform.openai.com, Gemini → aistudio.google.com, etc.)." +
        providerSaid(message)
      );
    }
    return "Our style assistant is not configured correctly. Please contact support.";
  }
  if (
    lower.includes("does not exist") ||
    lower.includes("do not have access") ||
    (lower.includes("404") && lower.includes("model"))
  ) {
    if (options?.verbose) {
      return (
        "That model is not available on your provider plan. " +
        "On Groq free tier, pick GPT OSS 20B (openai/gpt-oss-20b). " +
        "Llama models on Groq are Enterprise-only." +
        providerSaid(message)
      );
    }
    return "Our style assistant model is unavailable. Please try again later or contact support.";
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    if (options?.verbose) {
      return (
        "The provider rate-limited this request (HTTP 429). Wait a minute and try again, " +
        "or check usage limits / free-tier caps in your OpenAI or OpenRouter dashboard." +
        providerSaid(message)
      );
    }
    return "Our style assistant is busy right now. Please wait a moment and try again.";
  }
  if (
    lower.includes("connection error") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("socket hang up") ||
    lower.includes("ssl") ||
    lower.includes("tls")
  ) {
    if (options?.verbose) {
      return (
        "Could not reach this provider’s API from the server (network/TLS). " +
        "Google Gemini’s direct endpoint is often blocked on some networks — " +
        "switch Provider to Groq (free tier) or OpenRouter (can run Gemini models), " +
        "paste that provider’s key, save, and test again." +
        providerSaid(message)
      );
    }
    return "Our style assistant could not reach the AI provider. Please try again later.";
  }
  if (options?.verbose && message.trim()) {
    return message.trim().slice(0, 400);
  }
  return message.trim() || "Failed to generate a reply. Please try again.";
}

export type FashionAiParams = {
  messages: any[];
  image?: string; // base64 or URL
  userId?: string;
  botName?: string;
  usePublicData?: boolean;
  /** When false, skip tools (used after tool results for the final reply). */
  enableTools?: boolean;
  /** Pre-fetched catalog lines injected into the system prompt (server-side search). */
  catalogContext?: string;
  /** Dashboard/env-resolved client. Omit to keep the server OpenRouter default. */
  runtime?: FashionAiRuntime;
};

/** OpenAI/OpenRouter only accept role + content (+ tool fields). Strip UI-only fields. */
function sanitizeMessagesForModel(messages: any[]): any[] {
  return (messages || [])
    .filter((m) => m && typeof m === "object" && m.role)
    .map((m) => {
      const out: Record<string, unknown> = {
        role: m.role,
        content: m.content ?? "",
      };
      if (m.name) out.name = m.name;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      return out;
    });
}

function buildSystemPrompt(botName: string, usePublicData: boolean) {
  const publicDataInstruction = usePublicData
    ? "- You may use your general fashion knowledge freely (trends, history, brands, styling tips)."
    : "- Stick to culturally grounded fashion advice relevant to this marketplace (African / native wear, fabrics, occasions, tailoring). Do not invent unrelated brands or claim external retailers stock items here.";

  return `
You are ${botName} — an intelligent fashion assistant for an online fashion marketplace (FECSYNC).

Your purpose is to help users with styling advice, discover catalog items, recreate outfits from images, draft custom orders, and escalate to a human when needed.

You are a friendly, knowledgeable fashion expert — especially strong on African prints and native wear (aso-ebi, senator, agbada, kaftan, lace, ankara, etc.) and wedding / occasion dressing.

BEHAVIORAL GUIDELINES:
- Be conversational and helpful. Give concrete styling suggestions when asked (e.g. native wear for a wedding).
- Keep responses short but informative (a few clear bullets or short paragraphs).
- Prefer answering with your best recommendation; ask at most one clarifying question only if needed.
- NEVER invent specific in-stock product names, prices, or availability. Only cite products that appear in search_products results.
- When the user asks for ideas/advice (not only "show me products"), answer with styling guidance even if the catalog search is empty.
- If search_products returns no items, still give useful advice and offer custom tailoring — do not only say you found nothing.
- Prioritize platform inventory when search returns matches; include Markdown product image links from results: [![Product Name](image_url)](/shop/[id])
${publicDataInstruction}
- Encourage custom tailoring when nothing in stock fits.
- Support both male and female styles.

IMAGE ANALYSIS (If image provided):
When analyzing outfit images, respond using this format:
Outfit Analysis:
- Style:
- Primary Colors: primary colors and palette
- Fabric Type: e.g. Cotton, Lace, Silk, Aso Oke
- Clothing Components: e.g. Kaftan, Trousers, Cap
- Suggested Occasion: e.g. Wedding, Corporate
- Similar Products: [List similar items from platform search results only]
- Custom Tailoring Option: [Suggested approach for a custom order]

CUSTOM ORDERS:
If a user asks "Make something similar to this" or similar:
Return this format:
Custom Order Draft:
Outfit Description:
Fabric Suggestion:
Color Options:
Estimated Complexity:
Estimated Price Range:
Tailoring Notes:
Next Information Needed: [Ask for Size, Budget, Timeline, etc.]

HUMAN ESCALATION:
If user requests help with complaints, disputes, or complex tailoring, say:
"Let me connect you with a fashion consultant." 
(This will trigger a handoff flag).
`;
}

function fashionTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: "search_products",
        description:
          "Search the FECSYNC product catalog. Use when the user wants to browse, buy, or see items in stock. For pure styling/advice questions you may answer directly; call this when catalog matches would help. If results are empty, still give fashion advice in your next reply.",
        parameters: {
          type: "object",
          properties: {
            search: { type: "string", description: "Search query" },
            category: { type: "string", description: "Category ID or name" },
            gender: { type: "string", enum: ["male", "female", "unisex"] },
            minPrice: { type: "number" },
            maxPrice: { type: "number" },
            fabricType: {
              type: "string",
              description: "Fabric type name (e.g. Cotton, Lace, Silk)",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "escalate_to_human",
        description: "Escalate the conversation to a human fashion consultant.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Reason for escalation" },
          },
        },
      },
    },
  ];
}

function hasFashionToolContext(messages: any[]): boolean {
  return (messages || []).some(
    (m) =>
      m &&
      typeof m === "object" &&
      (m.role === "tool" ||
        (m.role === "assistant" &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls.length > 0))
  );
}

/**
 * Groq GPT-OSS models hallucinate built-in tools (web.run_code) and break chat.
 * Catalog search is run server-side for those providers instead.
 */
function fashionCompletionToolOptions(
  messages: any[],
  enableTools: boolean,
  runtime: FashionAiRuntime
) {
  if (!fashionAiSupportsNativeTools(runtime) || !enableTools) {
    if (
      fashionAiSupportsNativeTools(runtime) &&
      !enableTools &&
      hasFashionToolContext(messages)
    ) {
      return { tools: fashionTools(), tool_choice: "none" as const };
    }
    return {};
  }
  return { tools: fashionTools(), tool_choice: "auto" as const };
}

function buildChatMessages(params: FashionAiParams) {
  const {
    messages,
    image,
    botName = "StyleForge AI",
    usePublicData = false,
    catalogContext,
    runtime,
  } = params;

  let systemPrompt = buildSystemPrompt(botName, usePublicData);
  const resolvedRuntime = runtime ?? resolveFashionAiRuntime(null);
  if (!fashionAiSupportsNativeTools(resolvedRuntime)) {
    systemPrompt +=
      "\n\nIMPORTANT: Reply in plain text only. Do not call tools, run code, or use web search.";
  }
  if (catalogContext?.trim()) {
    systemPrompt += `\n\n${catalogContext.trim()}`;
  }

  const chatMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...sanitizeMessagesForModel(messages),
  ];

  if (image) {
    chatMessages.push({
      role: "user",
      content: [
        { type: "text", text: "Please analyze this outfit image." },
        {
          type: "image_url",
          image_url: {
            url: image.startsWith("data:")
              ? image
              : `data:image/jpeg;base64,${image}`,
          },
        },
      ],
    });
  }

  return chatMessages;
}

/**
 * Generates fashion recommendations and handles StyleForge AI logic (non-streaming).
 */
export async function generateFashionRecommendations(params: FashionAiParams) {
  const enableTools = params.enableTools !== false;
  const chatMessages = buildChatMessages(params);
  const runtime = params.runtime ?? resolveFashionAiRuntime(null);
  assertFashionAiRuntime(runtime);
  const openai = createFashionAiClient(runtime);

  try {
    const aiResponse = await openai.chat.completions.create({
      model: runtime.model,
      messages: chatMessages,
      ...fashionCompletionToolOptions(
        chatMessages,
        enableTools,
        runtime
      ),
      temperature: 0.5,
      max_tokens: runtime.maxTokens,
    });
    return aiResponse.choices[0]?.message || null;
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    console.error("Fashion AI provider error:", raw);
    throw new Error(formatFashionAiError(err));
  }
}

export type FashionStreamEvent =
  | { type: "delta"; content: string }
  | { type: "message"; message: any };

/**
 * Streams StyleForge completions token-by-token.
 * Yields content deltas, then a final assembled message (may include tool_calls).
 */
export async function* streamFashionRecommendations(
  params: FashionAiParams
): AsyncGenerator<FashionStreamEvent> {
  const enableTools = params.enableTools !== false;
  const chatMessages = buildChatMessages(params);
  const runtime = params.runtime ?? resolveFashionAiRuntime(null);
  assertFashionAiRuntime(runtime);
  const openai = createFashionAiClient(runtime);

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await openai.chat.completions.create({
      model: runtime.model,
      messages: chatMessages,
      ...fashionCompletionToolOptions(
        chatMessages,
        enableTools,
        runtime
      ),
      temperature: 0.5,
      max_tokens: runtime.maxTokens,
      stream: true,
    });
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    console.error("Fashion AI stream error:", raw);
    throw new Error(formatFashionAiError(err));
  }
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  let content = "";

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      yield { type: "delta", content: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || "",
            type: "function",
            function: { name: "", arguments: "" },
          };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) {
          toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const message: any = {
    role: "assistant",
    content: content || null,
  };
  const completedTools = toolCalls.filter((t) => t && t.function.name);
  if (completedTools.length > 0) {
    message.tool_calls = completedTools;
  }

  yield { type: "message", message };
}

/** Minimal completion to verify provider credentials from Assistant settings. */
export async function pingFashionAiRuntime(runtime: FashionAiRuntime) {
  assertFashionAiRuntime(runtime);
  const openai = createFashionAiClient(runtime);
  await openai.chat.completions.create({
    model: runtime.model,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: 8,
    temperature: 0,
  });
}
