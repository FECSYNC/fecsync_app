import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import type { AuditUpdateStamp } from "@/lib/audit/recordAudit";
import type {
  FashionChatRole,
  FashionChatStatus,
  Prisma,
} from "@prisma/client";

export type FashionChatMessageDoc = {
  _id: string;
  id: string;
  role: FashionChatRole;
  content: string;
  image?: string | null;
  staffUser?: string | null;
  staffUserId?: string | null;
  staffName?: string | null;
  createdAt: Date;
};

export type FashionChatDoc = {
  _id: string;
  id: string;
  orgId: string | null;
  user: string | null;
  userId: string | null;
  ip: string | null;
  sessionId: string | null;
  contact: { email?: string; name?: string; phone?: string } | null;
  context: unknown;
  recommendations: unknown;
  handoffRequired: boolean;
  status: FashionChatStatus;
  lastMessageAt: Date | null;
  mergedFromChatIds: string[];
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: FashionChatMessageDoc[];
  save: () => Promise<FashionChatDoc>;
  markModified: (_path: string) => void;
  isModified: (_path: string) => boolean;
};

function messageToDoc(row: {
  id: string;
  role: FashionChatRole;
  content: string;
  image?: string | null;
  staffUserId?: string | null;
  staffName?: string | null;
  createdAt: Date;
}): FashionChatMessageDoc {
  return {
    _id: row.id,
    id: row.id,
    role: row.role,
    content: row.content,
    image: row.image,
    staffUser: row.staffUserId,
    staffUserId: row.staffUserId,
    staffName: row.staffName,
    createdAt: row.createdAt,
  };
}

function pendingUpdates(chat: FashionChatDoc): Partial<{
  orgId: string | null;
  userId: string | null;
  ip: string | null;
  sessionId: string | null;
  contact: Prisma.InputJsonValue;
  context: Prisma.InputJsonValue;
  recommendations: Prisma.InputJsonValue;
  handoffRequired: boolean;
  status: FashionChatStatus;
  lastMessageAt: Date | null;
  mergedFromChatIds: string[];
  updatedById: string | null;
  updatedByName: string | null;
}> {
  return {
    orgId: chat.orgId,
    userId: chat.user,
    ip: chat.ip,
    sessionId: chat.sessionId,
    contact: chat.contact as Prisma.InputJsonValue,
    context: chat.context as Prisma.InputJsonValue,
    recommendations: chat.recommendations as Prisma.InputJsonValue,
    handoffRequired: chat.handoffRequired,
    status: chat.status,
    lastMessageAt: chat.lastMessageAt,
    mergedFromChatIds: chat.mergedFromChatIds,
    updatedByName: chat.updatedByName,
  };
}

export function chatToDoc(
  row: {
    id: string;
    orgId: string | null;
    userId: string | null;
    ip: string | null;
    sessionId: string | null;
    contact: unknown;
    context: unknown;
    recommendations: unknown;
    handoffRequired: boolean;
    status: FashionChatStatus;
    lastMessageAt: Date | null;
    mergedFromChatIds: string[];
    updatedByName: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  messages: FashionChatMessageDoc[] = []
): FashionChatDoc {
  const doc: FashionChatDoc = {
    _id: row.id,
    id: row.id,
    orgId: row.orgId,
    user: row.userId,
    userId: row.userId,
    ip: row.ip,
    sessionId: row.sessionId,
    contact: row.contact as { email?: string; name?: string; phone?: string } | null,
    context: row.context,
    recommendations: row.recommendations,
    handoffRequired: row.handoffRequired,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    mergedFromChatIds: row.mergedFromChatIds ?? [],
    updatedByName: row.updatedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages,
    markModified: () => {},
    isModified: () => false,
    save: async () => {
      const updated = await prisma.fashionChat.update({
        where: { id: row.id },
        data: pendingUpdates(doc),
      });
      return chatToDoc(updated, doc.messages);
    },
  };
  return doc;
}

export async function loadChatMessages(
  chatId: string
): Promise<FashionChatMessageDoc[]> {
  const rows = await prisma.fashionChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(messageToDoc);
}

export async function loadChatDoc(
  chatId: string,
  withMessages = true
): Promise<FashionChatDoc | null> {
  if (!isValidId(chatId)) return null;
  const row = await prisma.fashionChat.findFirst({
    where: idWhere(chatId),
  });
  if (!row) return null;
  const messages = withMessages ? await loadChatMessages(row.id) : [];
  return chatToDoc(row, messages);
}

export async function createChatDoc(input: {
  orgId: string;
  userId?: string | null;
  ip?: string | null;
  sessionId?: string | null;
  contact?: unknown;
  status?: FashionChatStatus;
  handoffRequired?: boolean;
  lastMessageAt?: Date;
}): Promise<FashionChatDoc> {
  const row = await prisma.fashionChat.create({
    data: {
      orgId: input.orgId,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      sessionId: input.sessionId ?? null,
      contact: input.contact as Prisma.InputJsonValue,
      status: input.status ?? "open",
      handoffRequired: input.handoffRequired ?? false,
      lastMessageAt: input.lastMessageAt ?? new Date(),
    },
  });
  return chatToDoc(row, []);
}

export async function findOpenChatsBySession(
  sessionId: string,
  orgId: string
): Promise<FashionChatDoc[]> {
  const rows = await prisma.fashionChat.findMany({
    where: {
      sessionId,
      status: { in: ["open", "waiting_staff"] },
      OR: [{ orgId }, { orgId: null }],
    },
    orderBy: { updatedAt: "desc" },
  });
  const docs: FashionChatDoc[] = [];
  for (const row of rows) {
    docs.push(chatToDoc(row, await loadChatMessages(row.id)));
  }
  return docs;
}

export async function findOpenChatForUser(
  userId: string,
  orgId: string
): Promise<FashionChatDoc | null> {
  const row = await prisma.fashionChat.findFirst({
    where: {
      userId,
      status: { in: ["open", "waiting_staff"] },
      OR: [{ orgId }, { orgId: null }],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  return chatToDoc(row, await loadChatMessages(row.id));
}

export async function appendChatMessages(
  chatId: string,
  items: Array<{
    role: FashionChatRole;
    content: string;
    image?: string | null;
    staffUserId?: string | null;
    staffName?: string | null;
    createdAt?: Date;
  }>
): Promise<FashionChatMessageDoc[]> {
  if (!items.length) return [];
  await prisma.fashionChatMessage.createMany({
    data: items.map((item) => ({
      chatId,
      role: item.role,
      content: item.content,
      image: item.image ?? null,
      staffUserId: item.staffUserId ?? null,
      staffName: item.staffName ?? null,
      createdAt: item.createdAt ?? new Date(),
    })),
  });
  return loadChatMessages(chatId);
}

export async function updateChatRow(
  chatId: string,
  data: Parameters<typeof prisma.fashionChat.update>[0]["data"]
): Promise<FashionChatDoc | null> {
  try {
    const row = await prisma.fashionChat.update({
      where: { id: chatId },
      data,
    });
    return chatToDoc(row, await loadChatMessages(chatId));
  } catch {
    return null;
  }
}

export async function deleteChatById(chatId: string): Promise<void> {
  await prisma.fashionChat.delete({ where: { id: chatId } }).catch(() => {});
}

export async function deleteChatsWhere(
  where: Prisma.FashionChatWhereInput
): Promise<number> {
  const result = await prisma.fashionChat.deleteMany({ where });
  return result.count;
}

export async function findChatsWhere(
  where: Prisma.FashionChatWhereInput,
  opts?: {
    orderBy?:
      | Prisma.FashionChatOrderByWithRelationInput
      | Prisma.FashionChatOrderByWithRelationInput[];
    take?: number;
    skip?: number;
    messages?: boolean;
  }
): Promise<FashionChatDoc[]> {
  const rows = await prisma.fashionChat.findMany({
    where,
    orderBy: opts?.orderBy,
    take: opts?.take,
    skip: opts?.skip,
  });
  const docs: FashionChatDoc[] = [];
  for (const row of rows) {
    const messages =
      opts?.messages === false ? [] : await loadChatMessages(row.id);
    docs.push(chatToDoc(row, messages));
  }
  return docs;
}

export async function countChatsWhere(
  where: Prisma.FashionChatWhereInput
): Promise<number> {
  return prisma.fashionChat.count({ where });
}

export async function moveMessagesToChat(
  fromChatId: string,
  toChatId: string
): Promise<void> {
  await prisma.fashionChatMessage.updateMany({
    where: { chatId: fromChatId },
    data: { chatId: toChatId },
  });
}

export function auditToFashionChatUpdate(audit?: Record<string, unknown>) {
  if (audit && "updatedBy" in audit) {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {};
}

/** Append a message and update chat metadata when still open/waiting. */
export async function appendMessageIfChatOpen(
  chatId: string,
  message: {
    role: FashionChatRole;
    content: string;
    image?: string | null;
    staffUserId?: string | null;
    staffName?: string | null;
    createdAt?: Date;
  },
  meta: Parameters<typeof prisma.fashionChat.update>[0]["data"]
): Promise<FashionChatDoc | null> {
  const open = await prisma.fashionChat.findFirst({
    where: {
      id: chatId,
      status: { in: ["open", "waiting_staff"] },
    },
  });
  if (!open) return null;
  await appendChatMessages(chatId, [message]);
  return updateChatRow(chatId, meta);
}

export async function findResolvedChatBySession(
  sessionId: string,
  orgId: string
): Promise<FashionChatDoc | null> {
  const row = await prisma.fashionChat.findFirst({
    where: {
      sessionId,
      status: "resolved",
      OR: [{ orgId }, { orgId: null }],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  return chatToDoc(row, await loadChatMessages(row.id));
}

export async function findGuestChatsByIp(
  ip: string,
  orgId: string
): Promise<FashionChatDoc[]> {
  const rows = await prisma.fashionChat.findMany({
    where: {
      ip,
      userId: null,
      status: { in: ["open", "waiting_staff"] },
      OR: [{ orgId }, { orgId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
  const docs: FashionChatDoc[] = [];
  for (const row of rows) {
    docs.push(chatToDoc(row, await loadChatMessages(row.id)));
  }
  return docs;
}

export async function resolveChatBySession(
  sessionId: string,
  orgId: string
): Promise<FashionChatDoc | null> {
  const row = await prisma.fashionChat.findFirst({
    where: {
      sessionId,
      status: { in: ["open", "waiting_staff"] },
      OR: [{ orgId }, { orgId: null }],
    },
  });
  if (!row) return null;
  const updated = await prisma.fashionChat.update({
    where: { id: row.id },
    data: { status: "resolved", handoffRequired: false },
  });
  return chatToDoc(updated, await loadChatMessages(updated.id));
}
