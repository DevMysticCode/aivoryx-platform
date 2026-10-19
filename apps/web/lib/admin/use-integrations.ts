'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSourceRequest, UpdateSourceRequest } from '@aivoryx/contracts';
import * as api from '@/lib/api/integrations';
import type { ListInboundEventsParams } from '@/lib/api/integrations';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

/** TanStack Query hooks for the Universal Connector Integration Center (ADR 0032, UC-3, UC-4). */

const keys = {
  sources: ['integrations', 'sources'] as const,
  source: (id: string) => ['integrations', 'sources', id] as const,
  providers: ['integrations', 'providers'] as const,
  events: (params: ListInboundEventsParams = {}) => ['integrations', 'events', params] as const,
  event: (id: string) => ['integrations', 'events', 'detail', id] as const,
};

export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: api.listSources });
}

export function useSource(sourceId: string) {
  return useQuery({
    queryKey: keys.source(sourceId),
    queryFn: () => api.getSource(sourceId),
    enabled: !!sourceId,
  });
}

export function useProviders() {
  // Safe, server-driven metadata (display name, auth method, credential field names) — stable
  // across the session, no need to poll.
  return useQuery({ queryKey: keys.providers, queryFn: api.listProviders, staleTime: Infinity });
}

export function useInboundEvents(params: ListInboundEventsParams = {}) {
  return useQuery({
    queryKey: keys.events(params),
    queryFn: () => api.listInboundEvents(params),
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

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({ sourceId, body }: { sourceId: string; body: UpdateSourceRequest }) =>
      api.updateSource(sourceId, body),
    onSuccess: (_data, { sourceId }) => {
      qc.invalidateQueries({ queryKey: keys.sources });
      qc.invalidateQueries({ queryKey: keys.source(sourceId) });
    },
    successMessage: 'Connection updated',
  });
}

export function useRotateSourceSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => api.rotateSourceSecret(sourceId),
    onSuccess: (_data, sourceId) => {
      qc.invalidateQueries({ queryKey: keys.sources });
      qc.invalidateQueries({ queryKey: keys.source(sourceId) });
    },
  });
}

export function useRevokeSource() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (sourceId: string) => api.revokeSource(sourceId),
    onSuccess: (_data, sourceId) => {
      qc.invalidateQueries({ queryKey: keys.sources });
      qc.invalidateQueries({ queryKey: keys.source(sourceId) });
    },
    successMessage: 'Integration source revoked',
  });
}

export function useReactivateSource() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (sourceId: string) => api.reactivateSource(sourceId),
    onSuccess: (_data, sourceId) => {
      qc.invalidateQueries({ queryKey: keys.sources });
      qc.invalidateQueries({ queryKey: keys.source(sourceId) });
    },
    successMessage: 'Integration source reactivated',
  });
}

export function useSetSourceCredentials() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({ sourceId, data }: { sourceId: string; data: Record<string, string> }) =>
      api.setSourceCredentials(sourceId, data),
    onSuccess: (_data, { sourceId }) => {
      qc.invalidateQueries({ queryKey: keys.sources });
      qc.invalidateQueries({ queryKey: keys.source(sourceId) });
    },
    successMessage: 'Connector credentials saved',
  });
}

export function useReplayInboundEvent() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (id: string) => api.replayInboundEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'events'] }),
    successMessage: 'Event replay queued',
  });
}
