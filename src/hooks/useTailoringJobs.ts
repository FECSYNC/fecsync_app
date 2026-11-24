'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMyTailoringJobs,
  getTailorJobs,
  getAdminTailoringJobs,
  getTailoringJob,
  getAdminTailoringJob,
  createTailoringJob,
  patchTailoringJob,
  patchAdminTailoringJob,
  cancelTailoringCheckout,
  initiateTailoringPayment,
} from '@/services/tailoringJobs';
import type {
  CreateTailoringJobInput,
  PatchTailoringJobInput,
  TailoringJobStatus,
} from '@/lib/tailoringJobs.shared';

import { notificationKeys } from '@/hooks/useNotifications';
import { dashboardKeys } from '@/hooks/useDashboard';
import { measurementKeys } from '@/hooks/useMeasurements';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';

export const jobKeys = {
  all: ['tailoring-jobs'] as const,
  adminCount: () => ['tailoring-jobs', 'admin', 'count'] as const,
  mine: (status?: string) =>
    ['tailoring-jobs', 'mine', status ?? ''] as const,
  tailor: (status?: string) =>
    ['tailoring-jobs', 'tailor', status ?? ''] as const,
  admin: (q?: string, status?: string) =>
    ['tailoring-jobs', 'admin', q ?? '', status ?? ''] as const,
  detail: (id: string) => ['tailoring-jobs', 'detail', id] as const,
  adminDetail: (id: string) => ['tailoring-jobs', 'admin', 'detail', id] as const,
};

export function invalidateTailoringQueryCaches(
  qc: ReturnType<typeof useQueryClient>
) {
  void qc.invalidateQueries({ queryKey: jobKeys.all });
  void qc.invalidateQueries({ queryKey: jobKeys.adminCount() });
  void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
  void qc.invalidateQueries({ queryKey: dashboardKeys.analytics() });
  // Booking creates a measurement profile first — keep profile lists in sync.
  void qc.invalidateQueries({ queryKey: measurementKeys.all });
}

function invalidateTailoringQueries(qc: ReturnType<typeof useQueryClient>) {
  invalidateTailoringQueryCaches(qc);
}

export function useMyTailoringJobsQuery(
  opts?: { status?: TailoringJobStatus; enabled?: boolean }
) {
  return useQuery({
    queryKey: jobKeys.mine(opts?.status),
    queryFn: () => getMyTailoringJobs({ status: opts?.status }),
    staleTime: 10_000,
    enabled: opts?.enabled !== false,
  });
}

export function useTailorJobsQuery(
  opts?: { status?: TailoringJobStatus; enabled?: boolean }
) {
  return useQuery({
    queryKey: jobKeys.tailor(opts?.status),
    queryFn: () => getTailorJobs({ status: opts?.status }),
    staleTime: 10_000,
    enabled: opts?.enabled !== false,
  });
}

export function useAdminTailoringJobsQuery(opts?: {
  q?: string;
  status?: TailoringJobStatus | '';
  enabled?: boolean;
}) {
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const key = jobKeys.admin(opts?.q, opts?.status);
  return useQuery({
    queryKey: key,
    queryFn: () =>
      getAdminTailoringJobs({ q: opts?.q, status: opts?.status }),
    enabled: opts?.enabled !== false && Boolean(orgId),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

export function useTailoringJobQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => getTailoringJob(id),
    staleTime: 10_000,
    enabled: enabled && Boolean(id),
    retry: false,
  });
}

export function useAdminTailoringJobQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.adminDetail(id),
    queryFn: () => getAdminTailoringJob(id),
    staleTime: 10_000,
    enabled: enabled && Boolean(id),
    retry: false,
  });
}

export function useCreateTailoringJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTailoringJobInput) =>
      createTailoringJob(payload),
    onSuccess: () => {
      invalidateTailoringQueries(qc);
    },
  });
}

export function usePatchTailoringJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: PatchTailoringJobInput;
    }) => patchTailoringJob(id, payload),
    onSuccess: (job) => {
      qc.setQueryData(jobKeys.detail(job._id), job);
      invalidateTailoringQueries(qc);
    },
  });
}

export function usePatchAdminTailoringJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: PatchTailoringJobInput;
    }) => patchAdminTailoringJob(id, payload),
    onSuccess: (job) => {
      qc.setQueryData(jobKeys.adminDetail(job._id), job);
      invalidateTailoringQueries(qc);
    },
  });
}

export function useCancelTailoringCheckoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => cancelTailoringCheckout(jobId),
    onSuccess: () => {
      invalidateTailoringQueries(qc);
    },
  });
}

export function useInitiateTailoringPaymentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => initiateTailoringPayment(jobId),
    onSuccess: () => {
      invalidateTailoringQueries(qc);
    },
  });
}
