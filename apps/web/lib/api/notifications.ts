import type {
  MarkAllReadResult,
  Notification,
  NotificationDeliveryList,
  NotificationList,
  NotificationPreferences,
  NotificationRule,
  NotificationTemplate,
  NotificationUnreadCount,
  UpdateNotificationPreferencesRequest,
  UpdateNotificationRuleRequest,
  UpdateNotificationTemplateRequest,
} from '@aivoryx/contracts';
import { apiFetch } from './client';

/** Notifications & Communications Engine API calls (ADR 0037). Auth is server-side. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- user ---------------------------------------------------------

export const listNotifications = (opts: {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}) => apiFetch<NotificationList>(`/notifications${qs(opts)}`, { cache: 'no-store' });

export const notificationUnreadCount = () =>
  apiFetch<NotificationUnreadCount>('/notifications/unread-count', { cache: 'no-store' });

export const markNotificationRead = (id: string) =>
  apiFetch<NotificationUnreadCount>(`/notifications/${id}/read`, json({}));

export const markAllNotificationsRead = () =>
  apiFetch<MarkAllReadResult>('/notifications/read-all', json({}));

export const getNotificationPreferences = () =>
  apiFetch<NotificationPreferences>('/notifications/preferences', { cache: 'no-store' });

export const updateNotificationPreferences = (body: UpdateNotificationPreferencesRequest) =>
  apiFetch<NotificationPreferences>('/notifications/preferences', json(body, 'PUT'));

// ---- admin -------------------------------------------------------

export const listNotificationRules = () =>
  apiFetch<NotificationRule[]>('/admin/notifications/rules', { cache: 'no-store' });

export const updateNotificationRule = (key: string, body: UpdateNotificationRuleRequest) =>
  apiFetch<NotificationRule[]>(
    `/admin/notifications/rules/${encodeURIComponent(key)}`,
    json(body, 'PATCH'),
  );

export const listNotificationTemplates = () =>
  apiFetch<NotificationTemplate[]>('/admin/notifications/templates', { cache: 'no-store' });

export const getNotificationTemplate = (key: string) =>
  apiFetch<NotificationTemplate>(`/admin/notifications/templates/${encodeURIComponent(key)}`, {
    cache: 'no-store',
  });

export const updateNotificationTemplate = (key: string, body: UpdateNotificationTemplateRequest) =>
  apiFetch<NotificationTemplate>(
    `/admin/notifications/templates/${encodeURIComponent(key)}`,
    json(body, 'PUT'),
  );

export const resetNotificationTemplate = (key: string) =>
  apiFetch<NotificationTemplate>(`/admin/notifications/templates/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });

export const listNotificationDeliveries = (opts: {
  status?: string;
  page?: number;
  pageSize?: number;
}) =>
  apiFetch<NotificationDeliveryList>(`/admin/notifications/deliveries${qs(opts)}`, {
    cache: 'no-store',
  });

export type { Notification };
