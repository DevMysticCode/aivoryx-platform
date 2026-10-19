import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const access = vi.hoisted(() => ({
  current: { isLoading: false, can: (_p: string | undefined) => true } as {
    isLoading: boolean;
    can: (p: string | undefined) => boolean;
  },
}));
interface EventRow {
  id: string;
  rawEventId: string;
  sourceId: string;
  status: string;
  leadId: string | null;
  dedupeOutcome: string | null;
  processingAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
}

const hooks = vi.hoisted(() => ({
  useSources: vi.fn((): { isLoading: boolean; data: unknown[]; error: unknown } => ({
    isLoading: false,
    data: [],
    error: null,
  })),
  useInboundEvents: vi.fn(
    (): {
      isLoading: boolean;
      error: unknown;
      data: { items: EventRow[]; total: number; page: number; pageSize: number };
    } => ({
      isLoading: false,
      error: null,
      data: { items: [], total: 0, page: 1, pageSize: 25 },
    }),
  ),
  useInboundEvent: vi.fn(() => ({ isLoading: false, error: null, data: undefined })),
  useReplayInboundEvent: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/lib/navigation/use-access', () => ({ useAccess: () => access.current }));
vi.mock('@/lib/admin/use-integrations', () => ({
  useSources: hooks.useSources,
  useInboundEvents: hooks.useInboundEvents,
  useInboundEvent: hooks.useInboundEvent,
  useReplayInboundEvent: hooks.useReplayInboundEvent,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/integrations/events' }));

import IntegrationEventsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Integration events page', () => {
  it('without crm.integrations.manage: explains, never calls the events API', () => {
    access.current = { isLoading: false, can: () => false };
    render(<IntegrationEventsPage />);
    expect(screen.getByText(/don't have access to integrations/i)).toBeTruthy();
    expect(hooks.useInboundEvents).not.toHaveBeenCalled();
  });

  it('with permission: renders an empty state when there are no events', () => {
    access.current = { isLoading: false, can: () => true };
    render(<IntegrationEventsPage />);
    expect(screen.getByText(/no inbound events yet/i)).toBeTruthy();
  });

  it('shows real counts, never a fabricated success rate or health score', () => {
    access.current = { isLoading: false, can: () => true };
    hooks.useInboundEvents.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        items: [
          {
            id: 'evt-1',
            rawEventId: 'raw-1',
            sourceId: 'src-1',
            status: 'DONE',
            leadId: 'lead-1',
            dedupeOutcome: 'new',
            processingAttempts: 1,
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    render(<IntegrationEventsPage />);
    expect(screen.getByText(/1 event · page 1 of 1/i)).toBeTruthy();
    expect(screen.queryByText(/success rate/i)).toBeNull();
    expect(screen.queryByText(/health/i)).toBeNull();
  });
});
