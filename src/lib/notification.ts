import moment from "moment";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ok, notFound, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuth, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import { isValidId, withMongoIdAlias } from "@/lib/ids";

/**
 * Unused by UI — live create path is src/services/notificationService.ts.
 * Kept aligned with Notification schema (user + read) so it cannot leak if wired later.
 * Live HTTP handlers: src/app/api/notification/route.ts.
 */

interface FormattedNotification {
  _id: string;
  user: string;
  title: string;
  message: string;
  type?: string;
  read?: boolean;
  createdAt: string;
  updatedAt?: string;
  __v?: number;
}

function formatNotification(notification: {
  id?: string;
  _id?: unknown;
  userId?: string;
  user?: unknown;
  title?: string;
  message?: string;
  type?: string | null;
  read?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): FormattedNotification {
  const id = notification.id ?? notification._id;
  const user = notification.userId ?? notification.user;
  return {
    _id: String(id),
    user: String(user),
    title: String(notification.title ?? ""),
    message: String(notification.message ?? ""),
    type: notification.type ?? undefined,
    read: notification.read,
    createdAt: moment(notification.createdAt).format(),
    updatedAt: notification.updatedAt
      ? moment(notification.updatedAt).format()
      : undefined,
  };
}

/** Create notification for a recipient user id (schema: user, title, message). */
export const createNotification = async (
  content: string,
  userId: string,
  createdAt?: Date
): Promise<void> => {
  try {
    await prisma.notification.create({
      data: {
        userId: String(userId),
        title: "Notification",
        message: content,
        type: "system",
        createdAt: createdAt || new Date(),
      },
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

export const getUserNotification = async (request: NextRequest) => {
  try {
    const actor = requireAuth(request);

    const notifications = await prisma.notification.findMany({
      where: { userId: actor.sub },
      orderBy: { id: "desc" },
    });

    const formattedNotifications = notifications.map(formatNotification);

    return ok({
      success: true,
      message: "Notifications retrieved successfully",
      data: formattedNotifications,
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error getting user notifications:", error);
    return serverError("Failed to retrieve notifications: " + error);
  }
};

export const getUserNotificationsPaginated = async (
  request: NextRequest,
  page: number = 1,
  limit: number = 10
) => {
  try {
    const actor = requireAuth(request);
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: actor.sub },
        orderBy: { id: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId: actor.sub } }),
    ]);

    const formattedNotifications = notifications.map(formatNotification);

    return ok({
      success: true,
      message: "Notifications retrieved successfully",
      data: {
        notifications: formattedNotifications,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error getting user notifications:", error);
    return serverError("Failed to retrieve notifications: " + error);
  }
};

export const markNotificationAsRead = async (
  request: NextRequest,
  notificationId: string
) => {
  try {
    const actor = requireAuth(request);

    if (!isValidId(notificationId)) {
      return notFound("Notification not found");
    }

    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });
    if (!existing) {
      return notFound("Notification not found");
    }
    try {
      assertOwnedDocument(actor, { user: existing.userId });
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const notification = await prisma.notification.updateMany({
      where: { id: notificationId, userId: actor.sub },
      data: { read: true },
    });

    if (notification.count === 0) {
      return notFound("Notification not found");
    }

    const updated = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    return ok({
      success: true,
      message: "Notification marked as read",
      data: updated
        ? withMongoIdAlias({ ...updated, user: updated.userId })
        : null,
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error marking notification as read:", error);
    return serverError("Failed to mark notification as read: " + error);
  }
};

export const deleteNotification = async (
  request: NextRequest,
  notificationId: string
) => {
  try {
    const actor = requireAuth(request);

    if (!isValidId(notificationId)) {
      return notFound("Notification not found");
    }

    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });
    if (!existing) {
      return notFound("Notification not found");
    }
    try {
      assertOwnedDocument(actor, { user: existing.userId });
    } catch (err) {
      return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const result = await prisma.notification.deleteMany({
      where: { id: notificationId, userId: actor.sub },
    });

    if (result.count === 0) {
      return notFound("Notification not found");
    }

    return ok({
      success: true,
      message: "Notification deleted successfully",
      data: null,
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error deleting notification:", error);
    return serverError("Failed to delete notification: " + error);
  }
};

export const getUnreadNotificationsCount = async (request: NextRequest) => {
  try {
    const actor = requireAuth(request);

    const count = await prisma.notification.count({
      where: { userId: actor.sub, read: false },
    });

    return ok({
      success: true,
      message: "Unread notifications count retrieved successfully",
      data: { count },
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error getting unread notifications count:", error);
    return serverError("Failed to get unread notifications count: " + error);
  }
};

export const markAllNotificationsAsRead = async (request: NextRequest) => {
  try {
    const actor = requireAuth(request);

    const result = await prisma.notification.updateMany({
      where: { userId: actor.sub, read: false },
      data: { read: true },
    });

    return ok({
      success: true,
      message: "All notifications marked as read",
      data: { modifiedCount: result.count },
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes) return authRes;
    console.error("Error marking all notifications as read:", error);
    return serverError("Failed to mark all notifications as read: " + error);
  }
};

export const bulkCreateNotifications = async (
  content: string,
  userIds: string[],
  createdAt?: Date
): Promise<void> => {
  try {
    const at = createdAt || new Date();
    const data: Prisma.NotificationCreateManyInput[] = userIds.map(
      (userId) => ({
        userId: String(userId),
        title: "Notification",
        message: content,
        type: "system" as const,
        createdAt: at,
      })
    );

    await prisma.notification.createMany({ data });
  } catch (error) {
    console.error("Error bulk creating notifications:", error);
    throw error;
  }
};
