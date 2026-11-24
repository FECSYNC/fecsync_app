export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import dbConnect from "@/lib/db";
import { ok, badRequest, serverError } from "@/lib/response";
import { getStorefrontOrgId } from "@/lib/org";
import {
  normalizeContact,
  normalizeSessionId,
  serializeFashionChat,
} from "@/lib/fashionChatConversation";
import {
  findOpenChatsBySession,
  updateChatRow,
} from "@/lib/fashionChatStore";
import { apiRateLimited } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const limited = apiRateLimited(req, "fashion-chat-end", 30, 15 * 60 * 1000);
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

    if (!sessionId) {
      return badRequest("sessionId is required");
    }

    const orgId = await getStorefrontOrgId();
    const matches = await findOpenChatsBySession(sessionId, orgId);
    const chat = matches[0] ?? null;

    if (!chat) {
      return ok({ ended: false, chat: null });
    }

    const contactPatch = contact
      ? {
          name: contact.name,
          email: contact.email,
          phone:
            contact.phone ||
            (chat.contact &&
            typeof chat.contact === "object" &&
            "phone" in (chat.contact as object)
              ? String((chat.contact as { phone?: string }).phone ?? "")
              : ""),
        }
      : chat.contact;

    const updated = await updateChatRow(chat.id, {
      status: "resolved",
      handoffRequired: false,
      lastMessageAt: new Date(),
      contact: contactPatch as object,
    });

    return ok({
      ended: true,
      chat: updated ? serializeFashionChat(updated) : null,
    });
  } catch (err) {
    console.error("Fashion chat end error:", err);
    return serverError(
      "Failed to end chat: " + (err instanceof Error ? err.message : String(err))
    );
  }
}
