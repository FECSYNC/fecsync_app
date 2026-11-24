'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  MeasurementProfileDto,
  MeasurementProfileInput,
  MeasurementProfileUpdateInput,
  MeasurementCategoryPatchInput,
  MeasurementAiScanInput,
} from '@/lib/measurements.shared';
import {
  getMyMeasurementProfiles,
  createMeasurementProfile,
  updateMeasurementProfile,
  deleteMeasurementProfile,
  setDefaultMeasurementProfile,
  patchMeasurementProfileCategory,
  runMeasurementAiScan,
} from '@/services/measurements';

export const measurementKeys = {
  all: ['measurements'] as const,
  mine: ['measurements', 'mine'] as const,
};

export function useMyMeasurementProfilesQuery(enabled = true) {
  return useQuery({
    queryKey: measurementKeys.mine,
    queryFn: getMyMeasurementProfiles,
    staleTime: 15_000,
    enabled,
  });
}

export function useCreateMeasurementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MeasurementProfileInput) =>
      createMeasurementProfile(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
    },
  });
}

export function useUpdateMeasurementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: MeasurementProfileUpdateInput;
    }) => updateMeasurementProfile(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
    },
  });
}

export function useDeleteMeasurementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMeasurementProfile(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
    },
  });
}

export function useSetDefaultMeasurementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => setDefaultMeasurementProfile(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
    },
  });
}

export function usePatchMeasurementCategoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: MeasurementCategoryPatchInput;
    }) => patchMeasurementProfileCategory(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
    },
  });
}

export function useMeasurementAiScanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: MeasurementAiScanInput;
    }) => runMeasurementAiScan(id, payload),
    onSuccess: (_result, variables) => {
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
      if (variables.payload.campaignSlug) {
        void qc.invalidateQueries({ queryKey: ['measurement-campaigns'] });
      }
    },
  });
}
