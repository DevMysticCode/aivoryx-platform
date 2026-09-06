'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  UpdateNotificationPreferencesRequest,
  UpdateNotificationRuleRequest,
  UpdateNotificationTemplateRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/notifications';

/** TanStack Query hooks for the Notifications & Communications Engine (ADR 0037). */

export const notificationKeys = {
  list: (unreadOnly: boolean) => ['notifications', 'list', unreadOnly] as const,
  unread: ['notifications', 'unread'] as const,
  preferences: ['notifications', 'preferences'] as const,
  rules: ['notifications', 'admin', 'rules'] as const,
  templates: ['notifications', 'admin', 'templates'] as const,
  template: (key: string) => ['notifications', 'admin', 'template', key] as const,
  deliveries: (status: string, page: number) =>
    ['notifications', 'admin', 'deliveries', status, page] as const,
};

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: api.notificationUnreadCount,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: notificationKeys.list(unreadOnly),
    queryFn: () => api.listNotifications({ unreadOnly, pageSize: 20 }),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: api.getNotificationPreferences,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationPreferencesRequest) =>
      api.updateNotificationPreferences(body),
    onSuccess: (data) => {
      qc.setQueryData(notificationKeys.preferences, data);
    },
  });
}

// ---- admin -----------------------------------------------------

export function useNotificationRules() {
  return useQuery({ queryKey: notificationKeys.rules, queryFn: api.listNotificationRules });
}

export function useUpdateNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: UpdateNotificationRuleRequest }) =>
      api.updateNotificationRule(key, body),
    onSuccess: (data) => qc.setQueryData(notificationKeys.rules, data),
  });
}

export function useNotificationTemplates() {
  return useQuery({ queryKey: notificationKeys.templates, queryFn: api.listNotificationTemplates });
}

export function useNotificationTemplate(key: string) {
  return useQuery({
    queryKey: notificationKeys.template(key),
    queryFn: () => api.getNotificationTemplate(key),
    enabled: !!key,
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: UpdateNotificationTemplateRequest }) =>
      api.updateNotificationTemplate(key, body),
    onSuccess: (data, vars) => {
      qc.setQueryData(notificationKeys.template(vars.key), data);
      void qc.invalidateQueries({ queryKey: notificationKeys.templates });
    },
  });
}

export function useResetNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.resetNotificationTemplate(key),
    onSuccess: (data, key) => {
      qc.setQueryData(notificationKeys.template(key), data);
      void qc.invalidateQueries({ queryKey: notificationKeys.templates });
    },
  });
}

export function useNotificationDeliveries(status: string, page: number) {
  return useQuery({
    queryKey: notificationKeys.deliveries(status, page),
    queryFn: () =>
      api.listNotificationDeliveries({ status: status || undefined, page, pageSize: 25 }),
  });
}
