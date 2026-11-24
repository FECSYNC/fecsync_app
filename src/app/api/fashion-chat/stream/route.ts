export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import dbConnect from "@/lib/db";
import { appendMessageIfChatOpen } from "@/lib/fashionChatStore";
import {
  buildInstantGreetingReply,
  isSimpleGreeting,
  shouldEnableFashionTools,
} from "@/lib/fashionChatFastPath";
import { fashionAiRuntimeError, fashionAiSupportsNativeTools } from "@/lib/aiRuntime";
import {
  streamFashionRecommendations,
  generateFashionRecommendations,
  formatFashionAiError,
} from "@/lib/openai";
import {
  fashionAiRuntimeFromSettings,
  getOrCreateAiSettings,
} from "@/lib/aiSettings";
import { storefrontOrgFilter } from "@/lib/org";
import {
  finalizeRecommendations,
  prefetchFashionCatalog,
  runFashionToolCalls,
} from "@/lib/fashionChatTools";
import {
  findOrCreateFashionConversation,
  messagesForAi,
  normalizeContact,
  normalizeSessionId,
  serializeFashionChat,
  closeFashionChatIfSessionExpired,
  fashionChatSessionMs,
  isConversationSessionExpired,
} from "@/lib/fashionChatConversation";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  enforceFashionChatMessageSecurity,
  securityBlockedResponse,
} from "@/lib/fashionChatSecurityServer";

function sseEncode(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Keep waiting_staff unless we're escalating; never demote handoff threads to open. */
function liveStatus(
  current: string | undefined,
  handoffRequired: boolean
): "open" | "waiting_staff" {
  if (handoffRequired) return "waiting_staff";
  if (current === "waiting_staff") return "waiting_staff";
  return "open";
}

function extractUserTurn(body: {
  message?: unknown;
  messages?: unknown;
  image?: unknown;
}): { content: string; image?: string } | null {
  if (typeof body.message === "string" && body.message.trim()) {
    return {
      content: body.message.trim(),
      image: typeof body.image === "string" ? body.image : undefined,
    };
  }
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1] as {
      role?: string;
      content?: string;
      image?: string;
    };
    if (last?.role === "user" && typeof last.content === "string") {
      return {
        content: last.content,
        image:
          typeof body.image === "string"
            ? body.image
            : typeof last.image === "string"
              ? last.image
              : undefined,
      };
    }
  }
  // Allow image-only turns
  if (typeof body.image === "string" && body.image) {
    return { content: "Please analyze this outfit image.", image: body.image };
  }
  return null;
}

/**
 * POST /api/fashion-chat/stream — SSE token stream for StyleForge.
 * Events: status | delta | reset | done | error
 */
export async function POST(req: NextRequest) {
  const limited = apiRateLimited(req, "fashion-chat-ai", 40, 10 * 60 * 1000);
  if (limited) return limited;

  let body: {
    message?: unknown;
    messages?: unknown;
    image?: unknown;
    sessionId?: unknown;
    contact?: unknown;
    user?: unknown;
    userId?: unknown;
    usePublicData?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  void body.user;
  void body.userId;
  void body.usePublicData;

  const sessionId = normalizeSessionId(body.sessionId);
  const contact = normalizeContact(body.contact);
  const turn = extractUserTurn(body);

  if (!turn) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "A message or image is required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!sessionId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "sessionId is required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const security = enforceFashionChatMessageSecurity(req, {
    content: turn.content,
    image: turn.image,
  });
  if (!security.allowed) {
    return securityBlockedResponse(security);
  }
  turn.content = security.content;
  turn.image = security.image;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseEncode(payload)));
      };
      const clientGone = () => req.signal.aborted;

      try {
        if (clientGone()) return;

        send({ type: "status", message: "Connecting…" });

        await dbConnect();
        const settings = await getOrCreateAiSettings();
        const aiRuntime = fashionAiRuntimeFromSettings(settings);
        const configError = fashionAiRuntimeError(aiRuntime);
        if (configError) {
          send({ type: "error", error: configError });
          return;
        }

        const orgFilter = await storefrontOrgFilter();

        let chat;
        let userId: string | null | undefined;
        try {
          const resolved = await findOrCreateFashionConversation({
            req,
            sessionId,
            contact,
          });
          chat = resolved.chat;
          userId = resolved.userId;
        } catch (err) {
          send({
            type: "error",
            error:
              err instanceof Error
                ? err.message
                : "Name and a valid email are required before chatting",
          });
          return;
        }

        if (isConversationSessionExpired(chat)) {
          const sessionMins = Math.max(
            1,
            Math.round(fashionChatSessionMs() / 60_000)
          );
          send({
            type: "error",
            error: `Your ${sessionMins}-minute conversation time has ended. Please download your chat or start a new conversation.`,
          });
          return;
        }

        const userTurn = {
          role: "user" as const,
          content: turn.content,
          image: turn.image,
          createdAt: new Date(),
        };
        const afterUser = await appendMessageIfChatOpen(
          chat.id,
          {
            role: "user",
            content: turn.content,
            image: turn.image,
            createdAt: userTurn.createdAt,
          },
          {
            lastMessageAt: new Date(),
            status: liveStatus(chat.status, Boolean(chat.handoffRequired)),
            contact: chat.contact as object,
            orgId: chat.orgId ?? undefined,
            sessionId: chat.sessionId ?? undefined,
          }
        );
        if (!afterUser) {
          send({
            type: "error",
            error: "This chat was ended. Please start a new conversation.",
          });
          return;
        }
        chat = afterUser;

        const activeChat = await closeFashionChatIfSessionExpired(chat);
        if (!activeChat) {
          const sessionMins = Math.max(
            1,
            Math.round(fashionChatSessionMs() / 60_000)
          );
          send({
            type: "error",
            error: `Your ${sessionMins}-minute conversation time has ended. Please download your chat or start a new conversation.`,
          });
          return;
        }
        chat = activeChat;

        const useTools = shouldEnableFashionTools(turn.content, Boolean(turn.image));
        const nativeTools =
          useTools && fashionAiSupportsNativeTools(aiRuntime);
        const instantGreeting =
          !turn.image && isSimpleGreeting(turn.content);

        if (instantGreeting) {
          const recommendations = buildInstantGreetingReply(
            settings?.botName || "StyleForge AI"
          );
          send({ type: "delta", content: recommendations });

          const stillOpen = await appendMessageIfChatOpen(
            chat.id,
            {
              role: "assistant",
              content: recommendations,
              createdAt: new Date(),
            },
            {
              recommendations,
              handoffRequired: Boolean(chat.handoffRequired),
              status: liveStatus(chat.status, Boolean(chat.handoffRequired)),
              lastMessageAt: new Date(),
              contact: chat.contact as object,
            }
          );

          if (!stillOpen) {
            send({
              type: "error",
              error: "This chat was ended. Please start a new conversation.",
            });
            return;
          }

          send({
            type: "done",
            handoffRequired: Boolean(chat.handoffRequired),
            chatId: String(stillOpen._id),
            chat: serializeFashionChat(stillOpen),
            reply: {
              role: "assistant",
              content: recommendations,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        send({ type: "status", message: "Thinking…" });

        let handoffRequired = Boolean(chat.handoffRequired);
        let foundProducts: Awaited<
          ReturnType<typeof runFashionToolCalls>
        >["foundProducts"] = [];
        let recommendations = "";
        const historyForAi = messagesForAi(chat);

        let catalogContext = "";
        if (useTools && !nativeTools) {
          send({ type: "status", message: "Looking up products…" });
          const prefetched = await prefetchFashionCatalog(turn.content, orgFilter);
          foundProducts = prefetched.products;
          catalogContext = prefetched.catalogContext;
        }

        let aiMessage: any = null;
        for await (const event of streamFashionRecommendations({
          messages: historyForAi,
          image: turn.image,
          userId: userId || undefined,
          botName: settings?.botName,
          usePublicData: settings?.usePublicData,
          enableTools: nativeTools,
          catalogContext,
          runtime: aiRuntime,
        })) {
          if (clientGone()) return;
          if (event.type === "delta") {
            recommendations += event.content;
            send({ type: "delta", content: event.content });
          } else if (event.type === "message") {
            aiMessage = event.message;
          }
        }

        if (clientGone()) return;

        if (aiMessage?.tool_calls?.length && nativeTools) {
          recommendations = "";
          send({ type: "status", message: "Looking up products…" });
          send({ type: "reset" });

          const {
            toolResults,
            handoffRequired: escalated,
            foundProducts: products,
          } = await runFashionToolCalls(aiMessage.tool_calls, orgFilter);
          if (escalated) {
            handoffRequired = true;
            chat.status = "waiting_staff";
          }
          foundProducts = products;

          if (clientGone()) return;

          try {
            const followUpMessages = [...historyForAi, aiMessage, ...toolResults];
            for await (const event of streamFashionRecommendations({
              messages: followUpMessages,
              userId: userId || undefined,
              botName: settings?.botName,
              usePublicData: settings?.usePublicData,
              enableTools: false,
              runtime: aiRuntime,
            })) {
              if (clientGone()) return;
              if (event.type === "delta") {
                recommendations += event.content;
                send({ type: "delta", content: event.content });
              } else if (event.type === "message") {
                aiMessage = event.message;
                if (typeof event.message?.content === "string") {
                  recommendations = event.message.content;
                }
              }
            }
          } catch (err) {
            console.error("Second AI stream failed:", err);
            try {
              const followUpMessages = [...historyForAi, aiMessage, ...toolResults];
              const fallback = await generateFashionRecommendations({
                messages: followUpMessages,
                userId: userId || undefined,
                botName: settings?.botName,
                usePublicData: settings?.usePublicData,
                enableTools: false,
                runtime: aiRuntime,
              });
              aiMessage = fallback;
              recommendations =
                typeof fallback?.content === "string" ? fallback.content : "";
              if (recommendations) {
                send({ type: "reset" });
                send({ type: "delta", content: recommendations });
              }
            } catch (fallbackErr) {
              console.error("Second AI fallback failed:", fallbackErr);
              aiMessage = { content: "", role: "assistant" };
              recommendations = "";
            }
          }
        } else if (aiMessage && typeof aiMessage.content === "string") {
          recommendations = aiMessage.content;
        }

        if (clientGone()) return;

        const streamed = recommendations;
        recommendations = finalizeRecommendations(recommendations, foundProducts);

        if (recommendations && recommendations !== streamed) {
          send({ type: "reset" });
          send({ type: "delta", content: recommendations });
        }

        const stillOpen = await appendMessageIfChatOpen(
          chat.id,
          {
            role: "assistant",
            content: recommendations,
            createdAt: new Date(),
          },
          {
            recommendations,
            handoffRequired,
            status: liveStatus(chat.status, handoffRequired),
            lastMessageAt: new Date(),
            contact: chat.contact as object,
            orgId: chat.orgId ?? undefined,
            sessionId: chat.sessionId ?? undefined,
          }
        );

        if (!stillOpen) {
          send({
            type: "error",
            error: "This chat was ended. Please start a new conversation.",
          });
          return;
        }

        send({
          type: "done",
          handoffRequired,
          chatId: String(stillOpen._id),
          chat: serializeFashionChat(stillOpen),
          reply: {
            role: "assistant",
            content: recommendations,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.error("Chat stream error:", err);
        send({
          type: "error",
          error: formatFashionAiError(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
