// src/services/fashionChat.ts
import { toCustomerChatMessage } from "@/lib/customerFacingErrors";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

/** ---------- Types ---------- */
export type FashionContact = {
  name: string;
  email: string;
  phone?: string;
};

export type FashionChatInput = {
  messages?: ChatMessage[];
  message?: string;
  image?: string;
  sessionId: string;
  contact: FashionContact;
};

export type ChatMessage = {
  _id?: string;
  id?: string;
  role: "user" | "assistant" | "staff";
  content: string;
  image?: string;
  timestamp?: string;
  createdAt?: string;
  staffName?: string;
  streaming?: boolean;
};

export type FashionConversation = {
  id: string;
  contact: FashionContact | null;
  status: string;
  handoffRequired: boolean;
  messages: ChatMessage[];
  lastMessageAt?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedByName?: string | null;
  sessionEndsAt?: string;
  preview?: string;
  sessionId?: string | null;
};

/** Must match server default FASHION_CHAT_SESSION_MINUTES (5). */
export const FASHION_CHAT_SESSION_MINUTES = 5;

export function sessionEndsAtFromCreated(
  createdAt: string | Date,
  sessionMinutes = FASHION_CHAT_SESSION_MINUTES
): number {
  return (
    new Date(createdAt).getTime() + sessionMinutes * 60_000
  );
}

export function isFashionSessionExpiredError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('conversation time has ended') ||
    lower.includes('chat was ended')
  );
}

export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type SendMessageResponse = {
  message: string;
  chat?: FashionConversation;
  handoffRequired?: boolean;
  reply: ChatMessage;
};

export type ChatHistoryResponse = ChatMessage[];

export type FashionStreamHandlers = {
  onStatus?: (message: string) => void;
  onDelta?: (content: string) => void;
  onReset?: () => void;
  onDone?: (
    reply: ChatMessage,
    meta?: { handoffRequired?: boolean; chat?: FashionConversation }
  ) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
};

const SESSION_KEY = "harewa_fashion_chat_session";
const CONTACT_KEY = "harewa_fashion_chat_contact";
const MESSAGES_KEY = "harewa_fashion_chat_messages";

export function getOrCreateChatSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = createChatSessionId();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** Always mint a fresh browser session (after End chat). */
export function rotateChatSessionId(): string {
  if (typeof window === "undefined") return "";
  const id = createChatSessionId();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function createChatSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function loadSavedContact(): FashionContact | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONTACT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FashionContact;
    if (!parsed?.name?.trim() || !parsed?.email?.trim()) return null;
    return {
      name: parsed.name.trim(),
      email: parsed.email.trim().toLowerCase(),
      phone: parsed.phone?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function saveContactLocally(contact: FashionContact) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    CONTACT_KEY,
    JSON.stringify({
      name: contact.name.trim(),
      email: contact.email.trim().toLowerCase(),
      phone: contact.phone?.trim() || "",
    })
  );
}

/** Cache transcript locally so reopen/navigation restores instantly. */
export function cacheChatMessages(
  sessionId: string,
  messages: ChatMessage[]
) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const durable = messages
      .filter((m) => !m.streaming)
      .map(({ role, content, image, timestamp, createdAt, staffName, id }) => ({
        role,
        content,
        image,
        timestamp,
        createdAt,
        staffName,
        id,
      }));
    localStorage.setItem(
      MESSAGES_KEY,
      JSON.stringify({ sessionId, messages: durable, savedAt: Date.now() })
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadCachedChatMessages(sessionId: string): ChatMessage[] {
  if (typeof window === "undefined" || !sessionId) return [];
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      messages?: ChatMessage[];
    };
    if (parsed.sessionId !== sessionId || !Array.isArray(parsed.messages)) {
      return [];
    }
    return parsed.messages;
  } catch {
    return [];
  }
}

/** End the current StyleForge session (new chat on next open). */
export function clearFashionChatSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(CONTACT_KEY);
  localStorage.removeItem(MESSAGES_KEY);
}

/**
 * Tell the server this customer session is finished.
 * Marks the open conversation resolved (with contact) for the admin inbox.
 */
export async function endFashionChatSession(input: {
  sessionId: string;
  contact: FashionContact | null;
}): Promise<{ ended: boolean; chat: FashionConversation | null }> {
  try {
    const res = await fetch("/api/fashion-chat/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sessionId: input.sessionId,
        contact: input.contact || undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to end chat (${res.status})`);
    }
    const raw = (await res.json()) as MaybeWrapped<{
      ended?: boolean;
      chat?: FashionConversation | null;
    }>;
    const data = unwrap(raw) as {
      ended?: boolean;
      chat?: FashionConversation | null;
    } | null;
    return {
      ended: Boolean(data?.ended),
      chat: data?.chat || null,
    };
  } catch (error) {
    console.warn("Failed to end fashion chat on server:", error);
    return { ended: false, chat: null };
  }
}

/** Persist contact + open shell chat as soon as the form is submitted. */
export async function startFashionChatSession(input: {
  sessionId: string;
  contact: FashionContact;
}): Promise<FashionConversation | null> {
  try {
    const res = await fetch("/api/fashion-chat/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sessionId: input.sessionId,
        contact: input.contact,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to start chat (${res.status})`);
    }
    const raw = (await res.json()) as MaybeWrapped<{
      chat?: FashionConversation | null;
    }>;
    const data = unwrap(raw) as { chat?: FashionConversation | null } | null;
    return data?.chat || null;
  } catch (error) {
    console.warn("Failed to start fashion chat on server:", error);
    return null;
  }
}

/** ---------- API Functions ---------- */

export async function sendFashionConsultation(
  input: FashionChatInput
): Promise<SendMessageResponse> {
  const payload = {
    message: input.message,
    messages: input.messages?.map(({ role, content }) => ({ role, content })),
    ...(input.image ? { image: input.image } : {}),
    sessionId: input.sessionId,
    contact: input.contact,
  };
  const response = await api<MaybeWrapped<SendMessageResponse>>(
    "/api/fashion-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap<SendMessageResponse>(response);
  if (!data) throw new Error("Invalid response format");
  return data;
}

export async function streamFashionConsultation(
  input: FashionChatInput,
  handlers: FashionStreamHandlers = {}
): Promise<ChatMessage> {
  const payload = {
    message:
      input.message ||
      input.messages?.[input.messages.length - 1]?.content ||
      "",
    ...(input.image ? { image: input.image } : {}),
    sessionId: input.sessionId,
    contact: input.contact,
  };

  const res = await fetch("/api/fashion-chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
    credentials: "include",
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    let message = `Chat stream failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = String(errBody.error);
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalReply: ChatMessage | null = null;
  let streamError: string | null = null;

  const handleEvent = (raw: string) => {
    const dataLine = raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!dataLine) return;
    const json = dataLine.replace(/^data:\s*/, "");
    if (!json || json === "[DONE]") return;

    let event: any;
    try {
      event = JSON.parse(json);
    } catch {
      return;
    }

    switch (event.type) {
      case "status":
        if (typeof event.message === "string") handlers.onStatus?.(event.message);
        break;
      case "delta":
        if (typeof event.content === "string") handlers.onDelta?.(event.content);
        break;
      case "reset":
        handlers.onReset?.();
        break;
      case "done":
        finalReply = event.reply as ChatMessage;
        handlers.onDone?.(finalReply, {
          handoffRequired: event.handoffRequired,
          chat: event.chat,
        });
        break;
      case "error":
        streamError = toCustomerChatMessage(
          event.error || "Stream error"
        );
        handlers.onError?.(streamError);
        break;
      default:
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (chunk.trim()) handleEvent(chunk);
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  if (streamError) throw new Error(streamError);
  if (!finalReply) throw new Error("Chat stream ended without a reply");
  return finalReply;
}

export async function getChatHistory(
  sessionId?: string
): Promise<{ messages: ChatMessage[]; chat: FashionConversation | null }> {
  try {
    // Use raw fetch so guest history is never blocked by the auth refresh pipeline.
    const qs = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : "";
    const res = await fetch(`/api/fashion-chat${qs}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to load chat history (${res.status})`);
    }
    const raw = (await res.json()) as MaybeWrapped<{
      messages?: ChatMessage[];
      chat?: FashionConversation | null;
    }>;
    const data = unwrap(raw) as {
      messages?: ChatMessage[];
      chat?: FashionConversation | null;
    } | null;
    const messages = Array.isArray(data?.messages) ? data!.messages! : [];
    if (sessionId && messages.length > 0) {
      cacheChatMessages(sessionId, messages);
    }
    return {
      messages,
      chat: data?.chat || null,
    };
  } catch (error) {
    console.warn("Failed to get chat history:", error);
    // Fall back to local cache so leaving/reopening the widget still works offline.
    if (sessionId) {
      const cached = loadCachedChatMessages(sessionId);
      if (cached.length > 0) {
        return { messages: cached, chat: null };
      }
    }
    return { messages: [], chat: null };
  }
}

/** ---------- Admin ---------- */

export type AdminFashionChatsResponse = {
  chats: FashionConversation[];
  stats: {
    handoffCount: number;
    waitingCount: number;
    returned: number;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export async function listAdminFashionChats(params?: {
  handoff?: boolean;
  status?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<AdminFashionChatsResponse> {
  const sp = new URLSearchParams();
  if (params?.handoff) sp.set("handoff", "1");
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  sp.set("page", String(params?.page && params.page > 0 ? params.page : 1));
  sp.set("limit", String(params?.limit && params.limit > 0 ? params.limit : 5));
  const qs = `?${sp}`;
  const raw = await api<MaybeWrapped<AdminFashionChatsResponse>>(
    `/api/admin/fashion-chats${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw) as AdminFashionChatsResponse | null;
  return {
    chats: data?.chats || [],
    stats: data?.stats || {
      handoffCount: 0,
      waitingCount: 0,
      returned: 0,
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 1,
    },
  };
}

export async function getAdminFashionChat(
  id: string
): Promise<FashionConversation> {
  const raw = await api<MaybeWrapped<{ chat: FashionConversation }>>(
    `/api/admin/fashion-chats/${id}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw) as { chat: FashionConversation } | null;
  if (!data?.chat) throw new Error("Chat not found");
  return data.chat;
}

export async function replyAdminFashionChat(
  id: string,
  content: string
): Promise<FashionConversation> {
  const raw = await api<MaybeWrapped<{ chat: FashionConversation }>>(
    `/api/admin/fashion-chats/${id}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      credentials: "include",
    }
  );
  const data = unwrap(raw) as { chat: FashionConversation } | null;
  if (!data?.chat) throw new Error("Failed to send reply");
  return data.chat;
}

export async function patchAdminFashionChat(
  id: string,
  patch: { status?: string; handoffRequired?: boolean }
): Promise<FashionConversation> {
  const raw = await api<MaybeWrapped<{ chat: FashionConversation }>>(
    `/api/admin/fashion-chats/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      credentials: "include",
    }
  );
  const data = unwrap(raw) as { chat: FashionConversation } | null;
  if (!data?.chat) throw new Error("Failed to update chat");
  return data.chat;
}

export async function deleteAdminFashionChat(
  id: string
): Promise<{ deleted: boolean; id: string }> {
  const raw = await api<MaybeWrapped<{ deleted: boolean; id: string }>>(
    `/api/admin/fashion-chats/${id}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw) as { deleted: boolean; id: string } | null;
  if (!data?.deleted) throw new Error("Failed to delete chat");
  return data;
}

export async function deleteAdminFashionChats(
  ids: string[]
): Promise<{ deleted: boolean; deletedCount: number; requested: number }> {
  const raw = await api<
    MaybeWrapped<{ deleted: boolean; deletedCount: number; requested: number }>
  >(`/api/admin/fashion-chats`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
    credentials: "include",
  });
  const data = unwrap(raw) as {
    deleted: boolean;
    deletedCount: number;
    requested: number;
  } | null;
  if (!data?.deleted) throw new Error("Failed to delete chats");
  return data;
}
