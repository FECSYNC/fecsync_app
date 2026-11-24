'use client';

import {
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { navigateAdminRoute } from '@/lib/adminInstantNav';

export type TableActionIntent =
  | 'view'
  | 'edit'
  | 'delete'
  | 'update'
  | 'track'
  | 'open';

const PENDING_LABELS: Record<TableActionIntent, string> = {
  view: 'Opening…',
  edit: 'Opening…',
  delete: 'Deleting…',
  update: 'Updating…',
  track: 'Opening…',
  open: 'Opening…',
};

function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-3.5 w-3.5 shrink-0 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export type TableActionProps = {
  children: ReactNode;
  /** Visual + default pending copy */
  intent?: TableActionIntent;
  /** Navigate to this path (shows Opening… until transition settles) */
  href?: string;
  /** Sync or async handler. Keep pending until the promise resolves. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  title?: string;
  /** Override pending text (e.g. Opening… when Delete only opens a modal) */
  pendingLabel?: string;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  stopPropagation?: boolean;
};

/**
 * Table row action with a lock + spinner so admins cannot multi-click
 * while a view/edit/delete/navigation is in flight.
 */
export default function TableAction({
  children,
  intent = 'view',
  href,
  onClick,
  className = '',
  disabled = false,
  title,
  pendingLabel,
  onMouseEnter,
  onFocus,
  stopPropagation = true,
}: TableActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const loading = busy;

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (loading || disabled) return;

    setBusy(true);
    try {
      if (onClick) {
        await onClick(event);
      }
      if (href) {
        navigateAdminRoute(router, href);
      }
    } catch {
      // Parent/toast handles errors; unlock so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  const label = loading
    ? pendingLabel ?? PENDING_LABELS[intent]
    : children;

  return (
    <button
      type="button"
      title={title}
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={`inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors ${className}`}
    >
      {loading ? <InlineSpinner /> : null}
      <span>{label}</span>
    </button>
  );
}
