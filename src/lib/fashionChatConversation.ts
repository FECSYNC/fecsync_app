import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  appendChatMessages,
  chatToDoc,
  createChatDoc,
  deleteChatById,
  deleteChatsWhere,
  findChatsWhere,
  findOpenChatForUser,
  findOpenChatsBySession,
  loadChatDoc,
  moveMessagesToChat,
  loadChatMessages,
  type FashionChatDoc,
} from "@/lib/fashionChatStore";
import { fashionChatIdentity } from "@/lib/fashionChatTools";
import { getStorefrontOrgId } from "@/lib/org";
import { ForbiddenError } from "@/lib/auth/http-error";
import { actorHasCompanyWideView } from "@/lib/staffOrg";
import {
  scanFashionChatContactName,
  normalizeFashionChatPhone,
} from "@/lib/fashionChatSecurity";

export type FashionContactInput = {
  name: string;
  email: string;
  phone?: string;
};

export function normalizeContact(
  raw: unknown
): FashionContactInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const email =
    typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  const phoneRaw = typeof obj.phone === "string" ? obj.phone.trim() : "";
  if (!name || !email) return null;
  if (!scanFashionChatContactName(name)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  let phone: string | undefined;
  if (phoneRaw) {
    const normalizedPhone = normalizeFashionChatPhone(phoneRaw);
    if (normalizedPhone === null) return null;
    phone = normalizedPhone || undefined;
  }
  return { name, email, phone };
}

export function resolveContact(
  incoming: unknown,
  existingChat?: { contact?: unknown } | null
): FashionContactInput | null {
  return normalizeContact(incoming) || normalizeContact(existingChat?.contact);
}

export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (id.length < 8 || id.length > 128) return null;
  return id;
}

function serializeContact(contact: unknown) {
  const normalized = normalizeContact(contact);
  if (normalized) {
    return {
      name: normalized.name,
      email: normalized.email,
      phone: normalized.phone || "",
    };
  }
  if (!contact || typeof contact !== "object") return null;
  const obj = contact as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const email = typeof obj.email === "string" ? obj.email.trim() : "";
  const phone = typeof obj.phone === "string" ? obj.phone.trim() : "";
  if (!name && !email && !phone) return null;
  const safeName =
    name && scanFashionChatContactName(name) ? name : name ? "" : "";
  return { name: safeName, email, phone };
}

function sortMessagesByTime(messages: FashionChatDoc["messages"]) {
  return [...(messages || [])].sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
}

function applyContactToChat(
  chat: FashionChatDoc,
  contact: FashionContactInput | null
) {
  if (!contact) return;
  chat.contact = {
    name: contact.name,
    email: contact.email,
    phone:
      contact.phone ||
      (chat.contact &&
      typeof chat.contact === "object" &&
      "phone" in (chat.contact as object)
        ? String((chat.contact as { phone?: string }).phone ?? "")
        : ""),
  };
}

async function mergeSessionDuplicates(
  primary: FashionChatDoc,
  duplicates: FashionChatDoc[]
): Promise<FashionChatDoc> {
  if (!duplicates.length) return primary;

  for (const dup of duplicates) {
    await moveMessagesToChat(dup.id, primary.id);
    if (!normalizeContact(primary.contact) && normalizeContact(dup.contact)) {
      primary.contact = dup.contact;
    }
    if (dup.handoffRequired) primary.handoffRequired = true;
    if (dup.status === "waiting_staff" && primary.status !== "resolved") {
      primary.status = "waiting_staff";
    }
    const dupLast = dup.lastMessageAt || dup.updatedAt;
    const primaryLast = primary.lastMessageAt || primary.updatedAt;
    if (
      dupLast &&
      (!primaryLast || new Date(dupLast) > new Date(primaryLast))
    ) {
      primary.lastMessageAt = dupLast;
    }
    primary.mergedFromChatIds.push(String(dup.id));
    await deleteChatById(dup.id);
  }

  primary.messages = sortMessagesByTime(await loadChatMessages(primary.id));
  await primary.save();
  return (await loadChatDoc(primary.id)) ?? primary;
}

export function serializeFashionChat(chat: FashionChatDoc) {
  return {
    id: String(chat.id),
    orgId: chat.orgId ? String(chat.orgId) : null,
    user: chat.user ? String(chat.user) : null,
    sessionId: chat.sessionId || null,
    contact: serializeContact(chat.contact),
    status: chat.status || "open",
    handoffRequired: Boolean(chat.handoffRequired),
    lastMessageAt: chat.lastMessageAt || chat.updatedAt || chat.createdAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    updatedByName:
      typeof chat.updatedByName === "string" && chat.updatedByName.trim()
        ? chat.updatedByName.trim()
        : null,
    sessionEndsAt: sessionEndsAtIso(chat.createdAt),
    messages: sortMessagesByTime(chat.messages || []).map((m) => ({
      id: m.id ? String(m.id) : undefined,
      role: m.role,
      content: m.content,
      image: m.image || undefined,
      staffName: m.staffName || undefined,
      timestamp: m.createdAt
        ? new Date(m.createdAt).toISOString()
        : undefined,
    })),
    preview:
      [...sortMessagesByTime(chat.messages || [])]
        .reverse()
        .find((m) => m?.content)?.content?.slice(0, 140) || "",
  };
}

export function serializeFashionChatListItem(chat: FashionChatDoc) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const last = [...messages].reverse().find((m) => m?.content);

  return {
    id: String(chat.id),
    orgId: chat.orgId ? String(chat.orgId) : null,
    user: chat.user ? String(chat.user) : null,
    sessionId: chat.sessionId || null,
    contact: serializeContact(chat.contact),
    status: chat.status || "open",
    handoffRequired: Boolean(chat.handoffRequired),
    lastMessageAt: chat.lastMessageAt || chat.updatedAt || chat.createdAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    updatedByName:
      typeof chat.updatedByName === "string" && chat.updatedByName.trim()
        ? chat.updatedByName.trim()
        : null,
    messages: [] as ReturnType<typeof serializeFashionChat>["messages"],
    preview: last?.content?.slice(0, 140) || "",
  };
}

export async function findOrCreateFashionConversation(opts: {
  req: NextRequest;
  sessionId: string | null;
  contact?: FashionContactInput | null;
}) {
  const { userId, ip } = await fashionChatIdentity(opts.req);
  const orgId = await getStorefrontOrgId();

  let chat: FashionChatDoc | null = null;

  if (opts.sessionId) {
    const matches = await findOpenChatsBySession(opts.sessionId, orgId);
    if (matches.length > 0) {
      chat = matches[0];
      if (matches.length > 1) {
        chat = await mergeSessionDuplicates(chat, matches.slice(1));
      }
    }
  } else if (userId) {
    chat = await findOpenChatForUser(userId, orgId);
  }

  const incomingContact = opts.contact || null;
  const contact =
    incomingContact || normalizeContact(chat?.contact) || null;

  if (!chat) {
    if (!contact) {
      throw new Error("Name and a valid email are required before chatting");
    }
    chat = await createChatDoc({
      orgId,
      userId: userId || null,
      ip: userId ? null : ip || null,
      sessionId: opts.sessionId || null,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone || "",
      },
    });
  } else {
    if (!chat.orgId) chat.orgId = orgId;
    if (userId && !chat.user) chat.user = userId;
    if (opts.sessionId) chat.sessionId = opts.sessionId;
    applyContactToChat(chat, contact);
    if (!normalizeContact(chat.contact)) {
      throw new Error("Name and a valid email are required before chatting");
    }
    await chat.save();
  }

  const reloaded = (await loadChatDoc(chat.id)) ?? chat;
  return {
    chat: reloaded,
    userId,
    ip,
    orgId,
    contact: normalizeContact(reloaded.contact)!,
  };
}

export function messagesForAi(chat: {
  messages?: Array<{ role: string; content: string; staffName?: string | null }>;
}) {
  const mapped = (chat.messages || [])
    .filter(
      (m) =>
        m.role === "user" || m.role === "assistant" || m.role === "staff"
    )
    .map((m) => {
      if (m.role === "staff") {
        const who = m.staffName?.trim() || "staff stylist";
        return {
          role: "assistant" as const,
          content: `[Message from ${who}]: ${m.content}`,
        };
      }
      return { role: m.role, content: m.content };
    });

  const raw = process.env.FASHION_CHAT_AI_HISTORY_MESSAGES?.trim();
  const limit = raw ? Number.parseInt(raw, 10) : 24;
  if (Number.isFinite(limit) && limit > 0 && mapped.length > limit) {
    return mapped.slice(-limit);
  }
  return mapped;
}

export function fashionChatSessionMs(): number {
  const raw = process.env.FASHION_CHAT_SESSION_MINUTES?.trim();
  const mins = raw ? Number.parseInt(raw, 10) : 5;
  if (!Number.isFinite(mins) || mins <= 0) return 5 * 60_000;
  return mins * 60_000;
}

export function sessionEndsAtMs(
  createdAt: Date | string | null | undefined
): number {
  const started = createdAt ? new Date(createdAt).getTime() : Date.now();
  return started + fashionChatSessionMs();
}

export function sessionEndsAtIso(
  createdAt: Date | string | null | undefined
): string {
  return new Date(sessionEndsAtMs(createdAt)).toISOString();
}

export function conversationRemainingMs(
  createdAt: Date | string | null | undefined
): number {
  return Math.max(0, sessionEndsAtMs(createdAt) - Date.now());
}

export function isConversationSessionExpired(chat: {
  status?: string;
  createdAt?: Date | string | null;
} | null): boolean {
  if (!chat || chat.status === "resolved") return true;
  return conversationRemainingMs(chat.createdAt) <= 0;
}

export async function closeFashionChatIfSessionExpired(
  chat: FashionChatDoc | null
): Promise<FashionChatDoc | null> {
  if (!chat) return null;
  if (chat.status === "resolved") return null;
  if (!isConversationSessionExpired(chat)) return chat;

  chat.status = "resolved";
  await chat.save();
  return null;
}

export function fashionChatIdleMs(): number {
  return fashionChatSessionMs();
}

export async function closeFashionChatIfIdle(
  chat: FashionChatDoc | null
): Promise<FashionChatDoc | null> {
  return closeFashionChatIfSessionExpired(chat);
}

export function fashionChatOrgListFilter(
  orgId: string,
  storefrontOrgId: string
): Prisma.FashionChatWhereInput {
  if (orgId === storefrontOrgId) {
    return { OR: [{ orgId }, { orgId: null }] };
  }
  return { orgId };
}

export function fashionChatOwnScopeFilter(
  actorSub: string
): Prisma.FashionChatWhereInput {
  return {
    OR: [
      { messages: { some: { staffUserId: actorSub } } },
      { handoffRequired: true },
      { status: "waiting_staff" },
    ],
  };
}

export function assertFashionChatOwnScope(
  actor: {
    sub: string;
    companyWideView?: boolean | null;
    preset?: string | null;
    membershipRole?: string | null;
  },
  chat: {
    status?: string;
    handoffRequired?: boolean;
    messages?: { staffUser?: unknown; staffUserId?: unknown }[];
  }
): void {
  if (actorHasCompanyWideView(actor)) return;
  const touched = (chat.messages ?? []).some(
    (m) =>
      (m.staffUserId != null && String(m.staffUserId) === actor.sub) ||
      (m.staffUser != null && String(m.staffUser) === actor.sub)
  );
  if (touched) return;
  if (chat.handoffRequired || chat.status === "waiting_staff") return;
  throw new ForbiddenError("Forbidden");
}

export async function assertChatInOrg(
  chatId: string,
  orgId: string,
  storefrontOrgId?: string | null
): Promise<FashionChatDoc | null> {
  const chat = await loadChatDoc(chatId);
  if (!chat) return null;
  const chatOrg = chat.orgId ? String(chat.orgId) : null;
  const actorOrg = String(orgId);
  if (chatOrg === actorOrg) return chat;
  if (!chatOrg && storefrontOrgId && actorOrg === String(storefrontOrgId)) {
    chat.orgId = orgId;
    await chat.save();
    return chat;
  }
  return null;
}

export async function resolveFashionChatForAdmin(
  chatId: string,
  orgId: string,
  storefrontOrgId?: string | null
): Promise<FashionChatDoc | null> {
  let chat = await assertChatInOrg(chatId, orgId, storefrontOrgId);
  if (chat) return chat;

  try {
    await consolidateFashionChatFragments(orgId, storefrontOrgId);
  } catch (mergeErr) {
    console.warn("Fashion chat consolidate skipped:", mergeErr);
  }

  chat = await assertChatInOrg(chatId, orgId, storefrontOrgId);
  if (chat) return chat;

  const orgFilter = fashionChatOrgListFilter(orgId, storefrontOrgId || orgId);
  const redirected = await findChatsWhere({
    AND: [orgFilter, { mergedFromChatIds: { has: chatId } }],
  });
  if (!redirected[0]) return null;
  return assertChatInOrg(redirected[0].id, orgId, storefrontOrgId);
}

export function fashionChatRelatedGroupKey(chat: {
  _id?: unknown;
  id?: unknown;
  sessionId?: string | null;
  contact?: { email?: string } | null;
}): string {
  const sessionId =
    typeof chat.sessionId === "string" && chat.sessionId.trim()
      ? chat.sessionId.trim()
      : "";
  if (sessionId) return `session:${sessionId}`;
  const email =
    chat.contact &&
    typeof chat.contact.email === "string" &&
    chat.contact.email.trim()
      ? chat.contact.email.trim().toLowerCase()
      : "";
  if (email) return `email:${email}`;
  return `id:${String(chat._id ?? chat.id)}`;
}

function relatedDeleteWhere(
  chat: {
    _id?: unknown;
    id?: unknown;
    sessionId?: string | null;
    contact?: { email?: string } | null;
  },
  orgFilter: Prisma.FashionChatWhereInput
): Prisma.FashionChatWhereInput {
  const sessionId =
    typeof chat.sessionId === "string" && chat.sessionId.trim()
      ? chat.sessionId.trim()
      : "";
  if (sessionId) {
    return { AND: [orgFilter, { sessionId }] };
  }
  const email =
    chat.contact &&
    typeof chat.contact.email === "string" &&
    chat.contact.email.trim()
      ? chat.contact.email.trim().toLowerCase()
      : "";
  if (email) {
    return {
      AND: [
        orgFilter,
        {
          contact: {
            path: ["email"],
            equals: email,
          },
        },
      ],
    };
  }
  return {
    AND: [orgFilter, { id: String(chat._id ?? chat.id) }],
  };
}

export async function deleteFashionChatsRelated(
  chat: {
    _id?: unknown;
    id?: unknown;
    sessionId?: string | null;
    contact?: { email?: string } | null;
  },
  orgId: string,
  storefrontOrgId?: string | null
): Promise<number> {
  const orgFilter = fashionChatOrgListFilter(orgId, storefrontOrgId || orgId);
  const filter = relatedDeleteWhere(chat, orgFilter);
  const chatId = String(chat._id ?? chat.id);
  const related = await deleteChatsWhere({
    OR: [filter, { AND: [orgFilter, { mergedFromChatIds: { has: chatId } }] }],
  });
  return related;
}

export async function consolidateFashionChatFragments(
  orgId: string,
  storefrontOrgId?: string | null
) {
  const filter = fashionChatOrgListFilter(orgId, storefrontOrgId || orgId);
  const chats = await findChatsWhere(
    { AND: [filter, { status: { in: ["open", "waiting_staff"] } }] },
    { orderBy: { updatedAt: "desc" }, messages: false }
  );

  const bySession = new Map<string, FashionChatDoc[]>();
  const byEmail = new Map<string, FashionChatDoc[]>();

  for (const c of chats) {
    const sid =
      typeof c.sessionId === "string" && c.sessionId.trim()
        ? c.sessionId.trim()
        : "";
    if (sid) {
      const list = bySession.get(sid) || [];
      list.push(c);
      bySession.set(sid, list);
      continue;
    }
    const email =
      c.contact && typeof (c.contact as { email?: unknown }).email === "string"
        ? String((c.contact as { email: string }).email).trim().toLowerCase()
        : "";
    if (email) {
      const list = byEmail.get(email) || [];
      list.push(c);
      byEmail.set(email, list);
    }
  }

  let mergedGroups = 0;

  const mergeGroup = async (group: FashionChatDoc[]) => {
    if (group.length < 2) return;
    const primary = (await loadChatDoc(group[0].id)) ?? group[0];
    if (!primary) return;
    const dups: FashionChatDoc[] = [];
    for (const g of group.slice(1)) {
      const doc = await loadChatDoc(g.id);
      if (doc) dups.push(doc);
    }
    await mergeSessionDuplicates(primary, dups);
    mergedGroups += 1;
  };

  for (const group of bySession.values()) {
    await mergeGroup(group);
  }
  for (const group of byEmail.values()) {
    await mergeGroup(group);
  }

  return { mergedGroups };
}

export type { FashionChatDoc };
