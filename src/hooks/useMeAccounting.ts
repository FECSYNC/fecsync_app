"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getMeAccountingInvoice,
  getMeAccountingStatement,
  getMeAccountingSummary,
  listMeAccountingInvoices,
} from "@/services/meAccounting";

export const meAccountingKeys = {
  all: ["me", "accounting"] as const,
  summary: () => [...meAccountingKeys.all, "summary"] as const,
  invoices: (filters: { cursor?: string; status?: string } = {}) =>
    [...meAccountingKeys.all, "invoices", filters] as const,
  invoice: (id: string) => [...meAccountingKeys.all, "invoice", id] as const,
  statement: (filters: { from: string; to: string; orgId?: string }) =>
    [...meAccountingKeys.all, "statement", filters] as const,
};

export function useMeAccountingSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: meAccountingKeys.summary(),
    queryFn: getMeAccountingSummary,
    enabled,
    staleTime: 30_000,
  });
}

export function useMeAccountingInvoicesQuery(
  filters: { cursor?: string; status?: string } = {},
  enabled = true
) {
  return useQuery({
    queryKey: meAccountingKeys.invoices(filters),
    queryFn: () => listMeAccountingInvoices(filters),
    enabled,
    staleTime: 30_000,
  });
}

export function useMeAccountingInvoiceQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: meAccountingKeys.invoice(id),
    queryFn: () => getMeAccountingInvoice(id),
    enabled: enabled && Boolean(id),
  });
}

export function useMeAccountingStatementQuery(
  filters: { from: string; to: string; orgId?: string },
  enabled = true
) {
  return useQuery({
    queryKey: meAccountingKeys.statement(filters),
    queryFn: () => getMeAccountingStatement(filters),
    enabled: enabled && Boolean(filters.from) && Boolean(filters.to),
  });
}
