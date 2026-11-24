"use client";

import { useMemo, useState } from "react";
import {
  useAccountingAccountQuery,
  useAccountingAccountsQuery,
} from "@/hooks/useAccounting";
import type { LedgerAccountDto } from "@/services/accounting";

export default function AccountPicker({
  value,
  onChange,
  label = "Account",
  types,
  subtypes,
  postableOnly = true,
  hideArchived = true,
  locationId,
  disabled,
  required,
  className = "",
  /** When true, do not fetch the full chart until the user focuses the control. */
  lazy = false,
}: {
  value: string;
  onChange: (accountId: string, account?: LedgerAccountDto | null) => void;
  label?: string;
  types?: string[];
  subtypes?: string[];
  postableOnly?: boolean;
  hideArchived?: boolean;
  locationId?: string | null;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  lazy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState(!lazy);

  const accountsQuery = useAccountingAccountsQuery(
    {
      includeArchived: !hideArchived,
      locationId: locationId ?? undefined,
      q: q.trim() || undefined,
    },
    !disabled && opened
  );

  // Deep-linked value: resolve a single account without loading the whole chart.
  const selectedQuery = useAccountingAccountQuery(
    value,
    Boolean(value) && !disabled && (!opened || !(accountsQuery.data?.length))
  );

  const options = useMemo(() => {
    let rows = accountsQuery.data ?? [];
    if (types?.length) rows = rows.filter((a) => types.includes(a.type));
    if (subtypes?.length) {
      rows = rows.filter((a) => subtypes.includes(a.subtype));
    }
    if (postableOnly) {
      rows = rows.filter(
        (a) => a.isActive && !a.isHeader && a.allowManualPosting && !a.archivedAt
      );
    } else if (hideArchived) {
      rows = rows.filter((a) => a.isActive && !a.archivedAt);
    }
    if (
      value &&
      selectedQuery.data &&
      !rows.some((a) => a.id === value)
    ) {
      rows = [selectedQuery.data, ...rows];
    }
    return rows;
  }, [
    accountsQuery.data,
    types,
    subtypes,
    postableOnly,
    hideArchived,
    value,
    selectedQuery.data,
  ]);

  const selectedLabel = selectedQuery.data
    ? `${selectedQuery.data.code} — ${selectedQuery.data.name}`
    : value
      ? "Selected account"
      : null;

  const loadingChart =
    opened && accountsQuery.isLoading && options.length === 0;

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 flex items-center justify-between gap-2 font-medium text-stone-700">
        <span>
          {label}
          {required ? <span className="text-red-600"> *</span> : null}
        </span>
        {loadingChart ? (
          <span className="text-[11px] font-normal text-stone-500">
            Loading accounts…
          </span>
        ) : null}
      </span>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/20">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpened(true)}
          placeholder="Search code or name…"
          disabled={disabled}
          className="w-full border-0 border-b border-stone-100 bg-transparent px-3 py-2 text-sm outline-none disabled:bg-stone-50"
        />
        <select
          value={value}
          required={required}
          disabled={disabled || loadingChart}
          onFocus={() => setOpened(true)}
          onClick={() => setOpened(true)}
          onChange={(e) => {
            const id = e.target.value;
            const hit = options.find((a) => a.id === id) ?? null;
            onChange(id, hit);
          }}
          className="w-full border-0 bg-transparent px-3 py-2 text-sm outline-none disabled:bg-stone-50"
        >
          <option value="">
            {loadingChart ? "Loading accounts…" : "Select account…"}
          </option>
          {!opened && value && selectedLabel ? (
            <option value={value}>{selectedLabel}</option>
          ) : null}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
              {a.systemKey ? " (system)" : ""}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
