"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccountingCustomerSearchQuery,
  useAccountingLookupsQuery,
  useAccountingSuppliersQuery,
} from "@/hooks/useAccounting";

export type PartyKind = "customer" | "supplier" | "employee";

type PartyOption = { key: string; label: string; kind: PartyKind };

export default function PartyPicker({
  value,
  onChange,
  kinds = ["customer", "supplier"],
  label = "Party",
  disabled,
  className = "",
}: {
  value: string;
  onChange: (partyKey: string, option?: PartyOption | null) => void;
  kinds?: PartyKind[];
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PartyKind>(kinds[0] ?? "customer");
  const customerSearch = useAccountingCustomerSearchQuery(
    q,
    !disabled && kind === "customer" && kinds.includes("customer")
  );
  const suppliersQuery = useAccountingSuppliersQuery(
    { q: q.trim() || undefined },
    !disabled && kind === "supplier" && kinds.includes("supplier")
  );
  const lookups = useAccountingLookupsQuery(
    !disabled && kind === "employee" && kinds.includes("employee")
  );

  useEffect(() => {
    if (!kinds.includes(kind)) setKind(kinds[0] ?? "customer");
  }, [kinds, kind]);

  const options: PartyOption[] = useMemo(() => {
    if (kind === "customer") {
      const rows =
        ((customerSearch.data as { parties?: { partyKey: string; name: string }[] })
          ?.parties ??
          (customerSearch.data as { items?: { partyKey: string; name: string }[] })
            ?.items ??
          []) as { partyKey: string; name: string }[];
      return rows.map((r) => ({
        key: r.partyKey,
        label: r.name,
        kind: "customer" as const,
      }));
    }
    if (kind === "supplier") {
      const rows =
        ((suppliersQuery.data as { suppliers?: { id: string; name: string; code?: string }[] })
          ?.suppliers ??
          (suppliersQuery.data as { items?: { id: string; name: string; code?: string }[] })
            ?.items ??
          []) as { id: string; name: string; code?: string }[];
      return rows.map((r) => ({
        key: `supplier:${r.id}`,
        label: r.code ? `${r.code} — ${r.name}` : r.name,
        kind: "supplier" as const,
      }));
    }
    const members =
      ((lookups.data as { members?: { userId: string; name: string }[] })?.members ??
        []) as { userId: string; name: string }[];
    return members
      .filter((m) =>
        q.trim()
          ? m.name.toLowerCase().includes(q.trim().toLowerCase())
          : true
      )
      .map((m) => ({
        key: `employee:${m.userId}`,
        label: m.name,
        kind: "employee" as const,
      }));
  }, [kind, customerSearch.data, suppliersQuery.data, lookups.data, q]);

  return (
    <div className={`space-y-2 text-sm ${className}`}>
      <span className="block font-medium text-gray-700">{label}</span>
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => {
                setKind(k);
                onChange("", null);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                kind === k
                  ? "bg-[#D4AF37] text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${kind}…`}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-gray-50"
      />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const key = e.target.value;
          onChange(key, options.find((o) => o.key === key) ?? null);
        }}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-gray-50"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
