'use client';

import {
  groupPermissionsByFeature,
  permissionDescription,
  permissionLabel,
} from '@/lib/auth/permissions';

type PermissionGrantListProps = {
  permissions: readonly string[];
  /** When set, renders checkboxes; otherwise read-only list. */
  selected?: readonly string[];
  onToggle?: (permission: string) => void;
  /** Permissions that cannot be unchecked (base role grants). */
  locked?: ReadonlySet<string> | readonly string[];
  emptyMessage?: string;
  className?: string;
  maxHeightClass?: string;
};

function isLocked(
  permission: string,
  locked?: ReadonlySet<string> | readonly string[]
) {
  if (!locked) return false;
  if (locked instanceof Set) return locked.has(permission);
  return locked.includes(permission);
}

/**
 * Feature-grouped permission catalogue (Team & users / role templates matrix):
 * UPPERCASE feature heading, then Action + Feature checkboxes underneath.
 */
export default function PermissionGrantList({
  permissions,
  selected,
  onToggle,
  locked,
  emptyMessage = 'No permissions.',
  className = '',
  maxHeightClass = 'max-h-64',
}: PermissionGrantListProps) {
  const groups = groupPermissionsByFeature(permissions);
  const interactive = typeof onToggle === 'function' && selected !== undefined;

  if (groups.length === 0) {
    return (
      <p className={`text-sm text-gray-500 ${className}`}>{emptyMessage}</p>
    );
  }

  return (
    <div
      className={`${maxHeightClass} overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/80 ${className}`}
    >
      {groups.map(({ feature, items }, groupIndex) => (
        <div
          key={feature}
          className={
            groupIndex < groups.length - 1
              ? 'border-b border-gray-200 px-4 py-3'
              : 'px-4 py-3'
          }
        >
          <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
            {feature}
          </div>
          <ul className="space-y-2.5 pl-1">
            {items.map((perm) => {
              const lock = isLocked(perm, locked);
              const checked = interactive
                ? lock || selected.includes(perm)
                : true;
              const label = permissionLabel(perm);
              const help = permissionDescription(perm);

              if (!interactive) {
                return (
                  <li key={perm} className="pl-6" title={perm}>
                    <p className="text-sm text-slate-700">{label}</p>
                    {help ? (
                      <p className="text-xs text-slate-500 mt-0.5">{help}</p>
                    ) : null}
                  </li>
                );
              }

              return (
                <li key={perm}>
                  <label
                    className={`flex items-start gap-3 cursor-pointer ${
                      lock ? 'opacity-50 cursor-default' : ''
                    }`}
                    title={perm}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                      checked={checked}
                      disabled={lock}
                      onChange={() => {
                        if (!lock) onToggle(perm);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-700">{label}</span>
                      {help ? (
                        <span className="block text-xs text-slate-500 mt-0.5 leading-snug">
                          {help}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
