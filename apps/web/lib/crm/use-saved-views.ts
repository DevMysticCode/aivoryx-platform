'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSavedViewRequest, UpdateSavedViewRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/saved-views';

export { serializeViewConfig, parseViewConfig, type LeadViewConfig } from './lead-view-config';

export const savedViewKeys = { all: ['crm', 'saved-views'] as const };

export function useSavedViews() {
  return useQuery({ queryKey: savedViewKeys.all, queryFn: api.listSavedViews });
}

export function useCreateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSavedViewRequest) => api.createSavedView(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}

export function useUpdateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateSavedViewRequest }) =>
      api.updateSavedView(v.id, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}

export function useDeleteSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSavedView(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedViewKeys.all }),
  });
}
