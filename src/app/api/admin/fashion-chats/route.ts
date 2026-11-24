import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId, actorHasCompanyWideView } from "@/lib/staffOrg";
import dbConnect from "@/lib/db";
import { isValidId } from "@/lib/ids";
import {
  countChatsWhere,
  findChatsWhere,
} from "@/lib/fashionChatStore";
import {
  fashionChatOrgListFilter,
  fashionChatOwnScopeFilter,
  serializeFashionChatListItem,
  consolidateFashionChatFragments,
  fashionChatRelatedGroupKey,
  deleteFashionChatsRelated,
  assertFashionChatOwnScope,
} from "@/lib/fashionChatConversation";
import { getStorefrontOrgId } from "@/lib/org";
import { isPlainObject } from "@/lib/catalogWrite";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 5;

function buildListWhere(input: {
  orgId: string;
  storefrontOrgId: string;
  actorSub: string;
  companyWide: boolean;
  handoff?: string | null;
  status?: string | null;
  q?: string;
}): Prisma.FashionChatWhereInput {
  const parts: Prisma.FashionChatWhereInput[] = [
    fashionChatOrgListFilter(input.orgId, input.storefrontOrgId),
  ];
  if (!input.companyWide) {
    parts.push(fashionChatOwnScopeFilter(input.actorSub));
  }
  if (input.handoff === "1" || input.handoff === "true") {
    parts.push({ handoffRequired: true });
  }
  if (
    input.status &&
    ["open", "waiting_staff", "resolved"].includes(input.status)
  ) {
    parts.push({ status: input.status as "open" | "waiting_staff" | "resolved" });
  }
  return parts.length === 1 ? parts[0] : { AND: parts };
}

function matchesSearch(
  chat: {
    sessionId?: string | null;
    contact?: unknown;
  },
  q: string
): boolean {
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (chat.sessionId && rx.test(chat.sessionId)) return true;
  if (!chat.contact || typeof chat.contact !== "object") return false;
  const c = chat.contact as Record<string, unknown>;
  return (
    (typeof c.name === "string" && rx.test(c.name)) ||
    (typeof c.email === "string" && rx.test(c.email)) ||
    (typeof c.phone === "string" && rx.test(c.phone))
  );
}

export async function GET(req: NextRequest) {
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
    const url = req.nextUrl;
    const handoff = url.searchParams.get("handoff");
    const status = url.searchParams.get("status");
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(
      Math.max(
        Number(url.searchParams.get("limit") || DEFAULT_PAGE_SIZE) ||
          DEFAULT_PAGE_SIZE,
        1
      ),
      50
    );
    const page = Math.max(Number(url.searchParams.get("page") || 1) || 1, 1);

    try {
      await consolidateFashionChatFragments(orgId, storefrontOrgId);
    } catch (mergeErr) {
      console.warn("Fashion chat consolidate skipped:", mergeErr);
    }

    const baseWhere = buildListWhere({
      orgId,
      storefrontOrgId,
      actorSub: actor.sub,
      companyWide: actorHasCompanyWideView(actor),
      handoff,
      status,
    });

    let chats = await findChatsWhere(baseWhere, {
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      messages: true,
    });

    if (q) {
      chats = chats.filter((chat) => matchesSearch(chat, q));
    }

    const total = chats.length;
    const skip = (page - 1) * limit;
    const pageChats = chats.slice(skip, skip + limit);

    const orgFilter = fashionChatOrgListFilter(orgId, storefrontOrgId);
    const statsScope: Prisma.FashionChatWhereInput =
      actorHasCompanyWideView(actor)
        ? orgFilter
        : {
            AND: [orgFilter, fashionChatOwnScopeFilter(actor.sub)],
          };
    const [handoffCount, waitingCount] = await Promise.all([
      countChatsWhere({ AND: [statsScope, { handoffRequired: true }] }),
      countChatsWhere({ AND: [statsScope, { status: "waiting_staff" }] }),
    ]);

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return ok({
      chats: pageChats.map(serializeFashionChatListItem),
      stats: {
        handoffCount,
        waitingCount,
        returned: pageChats.length,
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chats list error:", err);
    return serverError("Failed to list fashion chats");
  }
}

export async function DELETE(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.AiChatsDelete);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body) || !Array.isArray(body.ids)) {
    return badRequest("ids array is required");
  }

  const ids = [
    ...new Set(
      body.ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ),
  ].filter(isValidId);
  if (ids.length === 0) return badRequest("Provide at least one chat id");
  if (ids.length > 100) return badRequest("Cannot delete more than 100 chats at once");

  try {
    await dbConnect();
    const orgId = requireActorOrgId(actor);
    const storefrontOrgId = await getStorefrontOrgId();
    const orgFilter = fashionChatOrgListFilter(orgId, storefrontOrgId);
    const findWhere: Prisma.FashionChatWhereInput = actorHasCompanyWideView(actor)
      ? { AND: [orgFilter, { id: { in: ids } }] }
      : {
          AND: [
            orgFilter,
            fashionChatOwnScopeFilter(actor.sub),
            { id: { in: ids } },
          ],
        };

    const chats = await findChatsWhere(findWhere, { messages: true });
    const groupKeys = new Set<string>();
    let deletedCount = 0;

    for (const chat of chats) {
      assertFashionChatOwnScope(actor, chat);
      const key = fashionChatRelatedGroupKey(chat);
      if (groupKeys.has(key)) continue;
      groupKeys.add(key);
      deletedCount += await deleteFashionChatsRelated(
        chat,
        orgId,
        storefrontOrgId
      );
    }

    logStaffActivityEntry(actor, {
      action: "Fashion Chats Bulk Deleted",
      entityType: "FashionChat",
      description: `Bulk deleted ${deletedCount} fashion chat(s)`,
      request: req,
      metadata: {
        deletedCount,
        requested: ids.length,
        ids,
      },
    });

    return ok({
      deleted: true,
      deletedCount,
      requested: ids.length,
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Admin fashion-chats bulk delete error:", err);
    return serverError("Failed to delete fashion chats");
  }
}
