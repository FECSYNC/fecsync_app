import type { NotificationType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withMongoIdAlias } from "@/lib/ids";

/**
 * Notification Type Enum
 */
export type { NotificationType };

/**
 * Notification Metadata Type
 */
export interface NotificationMetadata {
  [key: string]: unknown;
}

/**
 * Create a notification (persisted). Realtime emit is best-effort when Socket.IO
 * is initialized; missing socket.io never fails the API route.
 */
export async function createNotification(
  userId: string | { toString(): string },
  title: string,
  message: string,
  type: NotificationType = "system",
  metadata: NotificationMetadata = {}
) {
  const uid = String(userId);
  const row = await prisma.notification.create({
    data: {
      userId: uid,
      title,
      message,
      type,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });

  const notification = withMongoIdAlias({
    ...row,
    user: row.userId,
  });

  try {
    const { getIO } = await import("@/lib/socketServer");
    const io = getIO();
    io.to(uid).emit("new-notification", notification);
  } catch {
    // Socket optional — DB row is the source of truth.
  }

  return notification;
}
