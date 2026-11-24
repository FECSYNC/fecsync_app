"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPublicAccountingInvoice,
  getPublicAccountingStatement,
  payPublicAccountingInvoice,
} from "@/services/publicAccounting";
import { meAccountingKeys } from "@/hooks/useMeAccounting";

export const publicAccountingKeys = {
  all: ["public", "accounting"] as const,
  invoice: (token: string) =>
    [...publicAccountingKeys.all, "invoice", token] as const,
  statement: (token: string) =>
    [...publicAccountingKeys.all, "statement", token] as const,
};

export function usePublicAccountingInvoiceQuery(token: string, enabled = true) {
  return useQuery({
    queryKey: publicAccountingKeys.invoice(token),
    queryFn: () => getPublicAccountingInvoice(token),
    enabled: enabled && Boolean(token),
    retry: false,
  });
}

export function usePublicAccountingStatementQuery(
  token: string,
  enabled = true
) {
  return useQuery({
    queryKey: publicAccountingKeys.statement(token),
    queryFn: () => getPublicAccountingStatement(token),
    enabled: enabled && Boolean(token),
    retry: false,
  });
}

export function usePayPublicAccountingInvoiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      body,
    }: {
      token: string;
      body?: Record<string, unknown>;
    }) => payPublicAccountingInvoice(token, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({
        queryKey: publicAccountingKeys.invoice(v.token),
      });
      void qc.invalidateQueries({ queryKey: meAccountingKeys.all });
    },
  });
}
