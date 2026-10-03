/** Shared webhook/handshake URL helpers for the Integration Center (UC-3/UC-4) — one place, used
 *  by the connections list, the connection detail page, and generated developer snippets. */

export const API_BASE = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** The universal route works for every provider; the Pabbly alias remains supported but is no
 *  longer the only path — a signature-style source (Meta) has no bearer secret and uses its
 *  `publicLookupKey` instead. */
export const webhookUrlFor = (source: {
  connectorType: string;
  key: string;
  publicLookupKey: string | null;
}) =>
  source.connectorType === 'pabbly_bridge'
    ? `${API_BASE()}/api/v1/integrations/webhooks/pabbly/${source.key}`
    : `${API_BASE()}/api/v1/integrations/webhooks/${source.publicLookupKey ?? ''}`;

export const handshakeUrlFor = (publicLookupKey: string) =>
  `${API_BASE()}/api/v1/integrations/webhooks/${publicLookupKey}/handshake`;
