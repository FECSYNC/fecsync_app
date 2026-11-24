export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import dbConnect from "@/lib/db";
import { ok, badRequest, serverError } from "@/lib/response";
import {
  findOrCreateFashionConversation,
  normalizeContact,
  normalizeSessionId,
  serializeFashionChat,
} from "@/lib/fashionChatConversation";
import { apiRateLimited } from "@/lib/rateLimit";

/**
 * POST /api/fashion-chat/start
 * Persist contact + open shell conversation as soon as the customer submits the form
 * (before the first message), so admin inbox shows name/email/phone immediately.
 */
export async function POST(req: NextRequest) {
  const limited = apiRateLimited(req, "fashion-chat-start", 20, 15 * 60 * 1000);
  if (limited) return limited;

  try {
    await dbConnect();

    let body: { sessionId?: unknown; contact?: unknown };
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }

    const sessionId = normalizeSessionId(body.sessionId);
    const contact = normalizeContact(body.contact);

    if (!sessionId) return badRequest("sessionId is required");
    if (!contact) {
      return badRequest("Name and a valid email are required");
    }

    try {
      const { chat } = await findOrCreateFashionConversation({
        req,
        sessionId,
        contact,
      });
      return ok({ chat: serializeFashionChat(chat) });
    } catch (err) {
      return badRequest(
        err instanceof Error
          ? err.message
          : "Name and a valid email are required before chatting"
      );
    }
  } catch (err) {
    console.error("Fashion chat start error:", err);
    return serverError(
      "Failed to start chat: " +
        (err instanceof Error ? err.message : String(err))
    );
  }
}
