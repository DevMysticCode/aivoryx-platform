'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSourceRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/integrations';

/** TanStack Query hooks for the Pabbly connector admin surface (ADR 0032). */

const keys = {
  sources: ['integrations', 'sources'] as const,
  events: ['integrations', 'events'] as const,
  event: (id: string) => ['integrations', 'events', id] as const,
};

export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: api.listSources });
}

export function useInboundEvents() {
  return useQuery({
    queryKey: keys.events,
    queryFn: api.listInboundEvents,
    refetchInterval: 10_000,
  });
}

export function useInboundEvent(id: string) {
  return useQuery({
    queryKey: keys.event(id),
    queryFn: () => api.getInboundEvent(id),
    enabled: !!id,
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSourceRequest) => api.createSource(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useRotateSourceSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.rotateSourceSecret(sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useRevokeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.revokeSource(sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useReactivateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.reactivateSource(sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useReplayInboundEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.replayInboundEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.events }),
  });
}
