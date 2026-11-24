export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import dbConnect from "@/lib/db";
import { NextRequest } from "next/server";
import { ok, badRequest, serverError } from "@/lib/response";
import { generateFashionRecommendations, formatFashionAiError } from "@/lib/openai";
import { fashionAiRuntimeError, fashionAiSupportsNativeTools } from "@/lib/aiRuntime";
import {
  buildInstantGreetingReply,
  isSimpleGreeting,
  shouldEnableFashionTools,
} from "@/lib/fashionChatFastPath";
import {
  fashionAiRuntimeFromSettings,
  getOrCreateAiSettings,
} from "@/lib/aiSettings";
import { storefrontOrgFilter, getStorefrontOrgId } from "@/lib/org";
import {
  finalizeRecommendations,
  fashionChatIdentity,
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
import {
  appendMessageIfChatOpen,
  findGuestChatsByIp,
  findOpenChatsBySession,
  findOpenChatForUser,
  findResolvedChatBySession,
  loadChatDoc,
  type FashionChatDoc,
} from "@/lib/fashionChatStore";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  enforceFashionChatMessageSecurity,
  securityBlockedResponse,
} from "@/lib/fashionChatSecurityServer";

export async function POST(req: NextRequest) {
  const limited = apiRateLimited(req, "fashion-chat-ai", 40, 10 * 60 * 1000);
  if (limited) return limited;

  try {
    await dbConnect();

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
      return badRequest("Invalid JSON");
    }

    void body.user;
    void body.userId;
    void body.usePublicData;

    const sessionId = normalizeSessionId(body.sessionId);
    const contact = normalizeContact(body.contact);

    let turnContent = "";
    let turnImage: string | undefined;
    if (typeof body.message === "string" && body.message.trim()) {
      turnContent = body.message.trim();
      turnImage = typeof body.image === "string" ? body.image : undefined;
    } else if (Array.isArray(body.messages) && body.messages.length > 0) {
      const last = body.messages[body.messages.length - 1] as {
        role?: string;
        content?: string;
        image?: string;
      };
      if (last?.role === "user" && typeof last.content === "string") {
        turnContent = last.content;
      }
      turnImage =
        typeof body.image === "string"
          ? body.image
          : typeof last?.image === "string"
            ? last.image
            : undefined;
    } else if (typeof body.image === "string" && body.image) {
      turnContent = "Please analyze this outfit image.";
      turnImage = body.image;
    }

    if (!turnContent && !turnImage) {
      return badRequest("A message or image is required");
    }
    if (!sessionId) {
      return badRequest("sessionId is required");
    }

    const security = enforceFashionChatMessageSecurity(req, {
      content: turnContent || (turnImage ? "Please analyze this outfit image." : ""),
      image: turnImage,
    });
    if (!security.allowed) {
      return securityBlockedResponse(security);
    }
    turnContent = security.content;
    turnImage = security.image;

    const settings = await getOrCreateAiSettings();
    const orgFilter = await storefrontOrgFilter();
    let chat;
    let userId: string | null;
    try {
      const resolved = await findOrCreateFashionConversation({
        req,
        sessionId,
        contact,
      });
      chat = resolved.chat;
      userId = resolved.userId;
    } catch (err) {
      return badRequest(
        err instanceof Error
          ? err.message
          : "Name and a valid email are required before chatting"
      );
    }

    if (isConversationSessionExpired(chat)) {
      const sessionMins = Math.max(
        1,
        Math.round(fashionChatSessionMs() / 60_000)
      );
      return badRequest(
        `Your ${sessionMins}-minute conversation time has ended. Please download your chat or start a new conversation.`
      );
    }

    const afterUser = await appendMessageIfChatOpen(
      chat.id,
      {
        role: "user",
        content: turnContent || "Please analyze this outfit image.",
        image: turnImage,
        createdAt: new Date(),
      },
      {
        lastMessageAt: new Date(),
        contact: chat.contact as object,
      }
    );
    if (!afterUser) {
      return badRequest("This chat was ended. Please start a new conversation.");
    }
    chat = afterUser;

    const activeBeforeAi = await closeFashionChatIfSessionExpired(chat);
    if (!activeBeforeAi) {
      const sessionMins = Math.max(
        1,
        Math.round(fashionChatSessionMs() / 60_000)
      );
      return badRequest(
        `Your ${sessionMins}-minute conversation time has ended. Please download your chat or start a new conversation.`
      );
    }
    chat = activeBeforeAi;

    const aiRuntime = fashionAiRuntimeFromSettings(settings);
    const configError = fashionAiRuntimeError(aiRuntime);
    if (configError) {
      return badRequest(configError);
    }

    const turnText = turnContent || "";
    if (!turnImage && isSimpleGreeting(turnText)) {
      const recommendations = buildInstantGreetingReply(
        settings?.botName || "StyleForge AI"
      );
      const stillOpen = await appendMessageIfChatOpen(
        chat.id,
        {
          role: "assistant",
          content: recommendations,
          createdAt: new Date(),
        },
        {
          recommendations,
          lastMessageAt: new Date(),
        }
      );
      if (!stillOpen) {
        return badRequest("This chat was ended. Please start a new conversation.");
      }
      return ok({
        message: "Style recommendations generated",
        chat: serializeFashionChat(stillOpen),
        handoffRequired: Boolean(stillOpen.handoffRequired),
        reply: {
          role: "assistant",
          content: recommendations,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const useTools = shouldEnableFashionTools(turnText, Boolean(turnImage));
    const nativeTools =
      useTools && fashionAiSupportsNativeTools(aiRuntime);

    let foundProducts: Awaited<
      ReturnType<typeof runFashionToolCalls>
    >["foundProducts"] = [];
    let catalogContext = "";
    if (useTools && !nativeTools) {
      const prefetched = await prefetchFashionCatalog(turnText, orgFilter);
      foundProducts = prefetched.products;
      catalogContext = prefetched.catalogContext;
    }

    let aiMessage = await generateFashionRecommendations({
      messages: messagesForAi(chat),
      image: turnImage,
      userId: userId || undefined,
      botName: settings?.botName,
      usePublicData: settings?.usePublicData,
      enableTools: nativeTools,
      catalogContext,
      runtime: aiRuntime,
    });

    let handoffRequired = Boolean(chat.handoffRequired);

    if (aiMessage?.tool_calls && nativeTools) {
      const result = await runFashionToolCalls(aiMessage.tool_calls, orgFilter);
      handoffRequired = handoffRequired || result.handoffRequired;
      foundProducts = result.foundProducts;

      try {
        const secondResponse = await generateFashionRecommendations({
          messages: [
            ...messagesForAi(chat),
            aiMessage,
            ...result.toolResults,
          ],
          userId: userId || undefined,
          botName: settings?.botName,
          usePublicData: settings?.usePublicData,
          enableTools: false,
          runtime: aiRuntime,
        });
        aiMessage = secondResponse;
      } catch (err) {
        console.error("Second AI call failed:", err);
        aiMessage = { content: "", role: "assistant" as const } as any;
      }
    }

    const recommendations = finalizeRecommendations(
      aiMessage?.content,
      foundProducts
    );

    const nextStatus = handoffRequired
      ? "waiting_staff"
      : chat.status === "waiting_staff"
        ? "waiting_staff"
        : "open";

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
        status: nextStatus,
        lastMessageAt: new Date(),
        contact: chat.contact as object,
      }
    );

    if (!stillOpen) {
      return badRequest("This chat was ended. Please start a new conversation.");
    }

    return ok({
      message: "Style recommendations generated",
      chat: serializeFashionChat(stillOpen),
      handoffRequired,
      reply: {
        role: "assistant",
        content: recommendations,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Chat Error:", err);
    return serverError(formatFashionAiError(err));
  }
}

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    void req.nextUrl.searchParams.get("userId");
    const sessionId = normalizeSessionId(
      req.nextUrl.searchParams.get("sessionId")
    );
    const { userId, ip } = await fashionChatIdentity(req);
    const orgId = await getStorefrontOrgId();

    let chats: FashionChatDoc[] = [];
    if (sessionId) {
      chats = await findOpenChatsBySession(sessionId, orgId);
    } else if (userId) {
      const one = await findOpenChatForUser(userId, orgId);
      chats = one ? [one] : [];
    } else if (ip) {
      chats = await findGuestChatsByIp(ip, orgId);
    } else {
      chats = [];
    }

    let activeDoc: FashionChatDoc | null = chats[0] ?? null;
    if (activeDoc && !activeDoc.orgId) {
      activeDoc.orgId = orgId;
      await activeDoc.save();
    }
    if (activeDoc) {
      const docId = activeDoc.id;
      const sessionTimedOut = isConversationSessionExpired(activeDoc);
      activeDoc = await closeFashionChatIfSessionExpired(activeDoc);
      if (!activeDoc && sessionTimedOut && docId) {
        activeDoc = await loadChatDoc(docId);
      }
    } else if (sessionId) {
      activeDoc = await findResolvedChatBySession(sessionId, orgId);
    }

    const primary = activeDoc ? serializeFashionChat(activeDoc) : null;

    return ok({
      chats: chats.map(serializeFashionChat),
      chat: primary,
      messages: primary?.messages || [],
      ended: !primary,
    });
  } catch (err) {
    return serverError("Failed to fetch chats: " + err);
  }
}
