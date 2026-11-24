"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import {
  SUSPENDED_DIALOG_MESSAGE,
  ACCOUNT_SUSPENDED_EVENT,
  isOpsCompanyHold,
  isSuspendedAccessMessage,
} from "@/lib/accountSuspendMessages";

export { emitAccountSuspendedEvent } from "@/lib/accountSuspendMessages";
export { ACCOUNT_SUSPENDED_EVENT };

type SuspendedAccountDialogProps = {
  open: boolean;
  message?: string;
  onDismiss?: () => void;
  /** When true, user can only acknowledge / sign out — cannot dismiss to use the app. */
  blocking?: boolean;
};

export function SuspendedAccountDialog({
  open,
  message = SUSPENDED_DIALOG_MESSAGE,
  onDismiss,
  blocking = true,
}: SuspendedAccountDialogProps) {
  const logout = useAuthStore((s) => s.logout);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-stone-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspended-account-title"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-lg">
        <p className="text-xs uppercase tracking-[0.2em] text-[#D4AF37]">
          Account locked
        </p>
        <h2
          id="suspended-account-title"
          className="mt-2 text-xl font-semibold text-stone-900"
        >
          Account suspended
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">{message}</p>
        <p className="mt-2 text-xs text-stone-500">
          Your records are kept. After the suspension is removed, everything
          will appear as it did before.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {!blocking && onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50"
            >
              Close
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Global gate:
 * - User.accountSuspended → blocking dialog on every surface
 * - Company ops_hold → blocking dialog only on /admin|/tailor (waiting room stays usable)
 * - Explicit API lock messages → dialog when trying a feature
 */
export default function SuspendedAccountGate() {
  const pathname = usePathname() || "";
  const user = useAuthStore((s) => s.user);
  const hasHydratedAuth = useAuthStore((s) => s.hasHydratedAuth);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventMessage, setEventMessage] = useState(SUSPENDED_DIALOG_MESSAGE);

  const onFeatureSurface =
    pathname.startsWith("/admin") || pathname.startsWith("/tailor");
  const onWaitingRoom = pathname.startsWith("/company-pending");
  const opsHold = isOpsCompanyHold({
    status: user?.orgStatus,
    subscriptionStatus: user?.subscriptionStatus,
  });
  const accountLocked =
    hasHydratedAuth && Boolean(user) && user?.accountSuspended === true;
  const opsFeatureLocked =
    hasHydratedAuth && Boolean(user) && opsHold && onFeatureSurface;
  const sessionLocked = accountLocked || opsFeatureLocked;

  useEffect(() => {
    const onEvent = (ev: Event) => {
      // Waiting room already explains company ops hold — overlay only for
      // User.accountSuspended (or when still on admin/tailor features).
      if (onWaitingRoom && user?.accountSuspended !== true) {
        return;
      }
      const detail = (ev as CustomEvent<{ message?: string }>).detail;
      const msg =
        typeof detail?.message === "string" && detail.message.trim()
          ? detail.message.trim()
          : SUSPENDED_DIALOG_MESSAGE;
      if (!isSuspendedAccessMessage(msg)) return;
      setEventMessage(SUSPENDED_DIALOG_MESSAGE);
      setEventOpen(true);
    };
    window.addEventListener(ACCOUNT_SUSPENDED_EVENT, onEvent);
    return () => window.removeEventListener(ACCOUNT_SUSPENDED_EVENT, onEvent);
  }, [onWaitingRoom, user?.accountSuspended]);

  // Leaving admin/tailor (e.g. waiting room) clears sticky API-event dialog
  // unless the user account itself is soft-locked.
  useEffect(() => {
    if (accountLocked) return;
    if (onWaitingRoom || !onFeatureSurface) {
      setEventOpen(false);
    }
  }, [accountLocked, onWaitingRoom, onFeatureSurface, pathname]);

  const open = sessionLocked || eventOpen;
  const message = sessionLocked ? SUSPENDED_DIALOG_MESSAGE : eventMessage;

  const onDismiss = useCallback(() => {
    if (sessionLocked) return;
    setEventOpen(false);
  }, [sessionLocked]);

  return (
    <SuspendedAccountDialog
      open={open}
      message={message}
      blocking={sessionLocked}
      onDismiss={onDismiss}
    />
  );
}
