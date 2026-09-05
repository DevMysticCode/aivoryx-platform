import { API_V1_PREFIX, type ApiErrorResponse, type HealthReport } from '@aivoryx/contracts';
import { CORRELATION_ID_HEADER } from '@aivoryx/shared';
import { webEnv } from '../env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorResponse | undefined,
  ) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body?.error.code ?? 'INTERNAL_ERROR';
  }

  get correlationId(): string | undefined {
    return this.body?.error.correlationId;
  }
}

/** Generate a client-side correlation id so the whole call chain is traceable. */
function newClientCorrelationId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()
      : Math.random().toString(36).slice(2).toUpperCase().padEnd(20, '0');
  return `AIV-${rand}`;
}

export interface ApiFetchOptions extends RequestInit {
  /** Reuse an existing correlation id instead of minting one. */
  correlationId?: string;
}

/**
 * Typed fetch wrapper for the Aivoryx API. Always sends credentials (the
 * HTTP-only session cookie, ADR 0010) and a correlation id. Errors are parsed
 * into `ApiError` with the stable code + reference id.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { correlationId, headers, ...init } = options;
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}${path}`;

  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      [CORRELATION_ID_HEADER]: correlationId ?? newClientCorrelationId(),
      ...headers,
    },
  });

  if (!res.ok) {
    let body: ApiErrorResponse | undefined;
    try {
      body = (await res.json()) as ApiErrorResponse;
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, body);
  }

  // 204 No Content (and any empty body) has nothing to parse.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function getHealth(options?: ApiFetchOptions): Promise<HealthReport> {
  return apiFetch<HealthReport>('/health', { cache: 'no-store', ...options });
}
