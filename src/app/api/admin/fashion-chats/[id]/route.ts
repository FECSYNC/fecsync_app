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
import prisma from "@/lib/prisma";
import { idWhere } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import {
  updateChatRow,
  auditToFashionChatUpdate,
} from "@/lib/fashionChatStore";
import {
  resolveFashionChatForAdmin,
  serializeFashionChat,
  assertFashionChatOwnScope,
  deleteFashionChatsRelated,
} from "@/lib/fashionChatConversation";
import { isPlainObject } from "@/lib/catalogWrite";
import { getStorefrontOrgId } from "@/lib/org";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/fashion-chats/[id]
 */
export async function GET(req: NextRequest, { params }: Params) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiChatsRead);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    await dbConnect();
    const orgId = requireActorOrgId(actor);
    const storefrontOrgId = await getStorefrontOrgId();
    const { id } = await params;
    const chat = await resolveFashionChatForAdmin(id, orgId, storefrontOrgId);
    if (!chat) return notFound("Chat not found");
    assertFashionChatOwnScope(actor, chat);
    if (chat.isModified?.("orgId")) await chat.save();
    return ok({ chat: serializeFashionChat(chat) });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chat detail error:", err);
    return serverError("Failed to load fashion chat");
  }
}

/**
 * PATCH /api/admin/fashion-chats/[id] — status / handoff (ai:chats_reply)
 */
export async function PATCH(req: NextRequest, { params }: Params) {
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

  try {
    await dbConnect();
    const orgId = requireActorOrgId(actor);
    const storefrontOrgId = await getStorefrontOrgId();
    const { id } = await params;
    let chat = await resolveFashionChatForAdmin(id, orgId, storefrontOrgId);
    if (!chat) return notFound("Chat not found");
    assertFashionChatOwnScope(actor, chat);

    const audit = await stampUpdate(actor.sub);
    if (typeof body.status === "string") {
      if (!["open", "waiting_staff", "resolved"].includes(body.status)) {
        return badRequest("Invalid status");
      }
      chat.status = body.status as typeof chat.status;
      if (body.status === "resolved") {
        chat.handoffRequired = false;
      }
    }
    if (typeof body.handoffRequired === "boolean") {
      chat.handoffRequired = body.handoffRequired;
      if (body.handoffRequired) chat.status = "waiting_staff";
    }

    const updated = await updateChatRow(chat.id, {
      status: chat.status,
      handoffRequired: chat.handoffRequired,
      ...auditToFashionChatUpdate(audit),
    });
    if (!updated) return notFound("Chat not found");
    chat = updated;

    logStaffActivityEntry(actor, {
      action: "Fashion Chat Updated",
      entityType: "FashionChat",
      entityId: chat._id,
      description: `Updated fashion chat status to "${chat.status}"`,
      request: req,
      metadata: {
        status: chat.status,
        handoffRequired: chat.handoffRequired,
      },
    });

    return ok({ chat: serializeFashionChat(chat) });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chat patch error:", err);
    return serverError("Failed to update fashion chat");
  }
}

/**
 * DELETE /api/admin/fashion-chats/[id] — permanently remove chat (ai:chats_delete)
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiChatsDelete);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    await dbConnect();
    const orgId = requireActorOrgId(actor);
    const storefrontOrgId = await getStorefrontOrgId();
    const { id } = await params;
    const chat = await resolveFashionChatForAdmin(id, orgId, storefrontOrgId);
    if (!chat) return notFound("Chat not found");
    assertFashionChatOwnScope(actor, chat);

    const deletedCount = await deleteFashionChatsRelated(
      chat,
      orgId,
      storefrontOrgId
    );
    logStaffActivityEntry(actor, {
      action: "Fashion Chat Deleted",
      entityType: "FashionChat",
      entityId: chat._id,
      description: "Deleted fashion chat",
      request: req,
      metadata: { deletedCount },
    });
    return ok({ deleted: true, id: String(chat._id), deletedCount });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chat delete error:", err);
    return serverError("Failed to delete fashion chat");
  }
}
