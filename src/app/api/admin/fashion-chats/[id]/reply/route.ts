import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  notFound,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import dbConnect from "@/lib/db";
import {
  resolveFashionChatForAdmin,
  serializeFashionChat,
  assertFashionChatOwnScope,
} from "@/lib/fashionChatConversation";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  appendChatMessages,
  updateChatRow,
  auditToFashionChatUpdate,
} from "@/lib/fashionChatStore";
import prisma from "@/lib/prisma";
import { idWhere } from "@/lib/ids";
import { getStorefrontOrgId } from "@/lib/org";
import { stampUpdate, displayNameFromUser } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { scanFashionChatMessageForStaff } from "@/lib/fashionChatSecurity";
import { securityBlockedResponse } from "@/lib/fashionChatSecurityServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/fashion-chats/[id]/reply — staff message (ai:chats_reply)
 */
export async function POST(req: NextRequest, { params }: Params) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiChatsReply);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) return badRequest("Invalid JSON");

  const rawContent =
    typeof body.content === "string" ? body.content.trim() : "";
  if (!rawContent) return badRequest("Reply content is required");

  const security = scanFashionChatMessageForStaff({ content: rawContent });
  if (!security.allowed) {
    return securityBlockedResponse(security);
  }
  const content = security.content;

  try {
    await dbConnect();
    const orgId = requireActorOrgId(actor);
    const storefrontOrgId = await getStorefrontOrgId();
    const { id } = await params;
    let chat = await resolveFashionChatForAdmin(id, orgId, storefrontOrgId);
    if (!chat) return notFound("Chat not found");
    assertFashionChatOwnScope(actor, chat);
    if (chat.status === "resolved") {
      return badRequest(
        "This chat is resolved. Reopen it (Mark as open) before replying."
      );
    }

    let staffName = "Staff";
    try {
      const user = await prisma.user.findFirst({
        where: idWhere(actor.sub),
        select: { firstName: true, lastName: true, username: true, email: true },
      });
      staffName = displayNameFromUser(user);
      if (staffName === "Unknown") staffName = "Staff";
    } catch {
      /* keep default */
    }

    const audit = await stampUpdate(actor.sub);
    await appendChatMessages(chat.id, [
      {
        role: "staff",
        content,
        staffUserId: actor.sub,
        staffName,
        createdAt: new Date(),
      },
    ]);
    const updated = await updateChatRow(chat.id, {
      handoffRequired: false,
      status: "open",
      lastMessageAt: new Date(),
      ...auditToFashionChatUpdate(audit),
    });
    if (!updated) return notFound("Chat not found");
    chat = updated;

    logStaffActivityEntry(actor, {
      action: "Fashion Chat Reply",
      entityType: "FashionChat",
      entityId: chat._id,
      description: `Staff reply on fashion chat`,
      request: req,
    });

    return ok({
      message: "Reply sent",
      chat: serializeFashionChat(chat),
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chat reply error:", err);
    return serverError("Failed to send reply");
  }
}
