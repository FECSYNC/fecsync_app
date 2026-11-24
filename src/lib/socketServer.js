/**
 * Socket.IO bridge for realtime notifications.
 *
 * This module never imports `socket.io`. Missing that package previously
 * crashed Turbopack App Routes (notificationService → socketServer).
 * Notifications still persist to Mongo; realtime emit is a no-op here.
 *
 * Wire a custom server + socket.io separately if realtime is required.
 */

let ioInstance = null;

/**
 * @param {import("http").Server} [_server]
 */
export function initSocket(_server) {
  if (ioInstance) {
    console.warn("⚠️ Socket.IO already initialized.");
    return ioInstance;
  }
  // Realtime disabled in the Next App Router bundle (no socket.io dependency).
  return null;
}

/**
 * Returns the Socket.IO instance when a custom server has attached one.
 * Throws when unset so callers can catch and skip emit.
 */
export function getIO() {
  if (!ioInstance) {
    throw new Error(
      "❌ Socket.IO not initialized. Call initSocket(server) first."
    );
  }
  return ioInstance;
}

/** Test / custom-server helper — attach an external io instance. */
export function setIO(io) {
  ioInstance = io;
  return ioInstance;
}
