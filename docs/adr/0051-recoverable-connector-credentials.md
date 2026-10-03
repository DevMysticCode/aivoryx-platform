# ADR 0051 — Recoverable connector credentials

Status: accepted (UC-3). Builds on ADR 0032's connector secret model and ADR 0049/0050.

## Context

`lead_sources.secret_hash` is a one-way SHA-256 hash, by design (ADR 0032): Aivoryx never needs to recover a presented bearer secret, only to compare its hash. Meta needs the opposite shape of credential: an app secret (to verify an incoming signature) and a page access token (to call the Graph API afterward) — both of which Aivoryx must be able to read back in plaintext to use. No existing mechanism in the repository supports a recoverable secret; one-way hashing cannot be adapted to this purpose.

## Decisions

1. **A new table, `connector_credentials`**, additive, one row per source (`unique(source_id)`), composite FK to `lead_sources(id, tenant_id)` with cascade delete, `tenant_id` denormalized onto the row for RLS performance (the same pattern every other tenant-owned table in this schema already uses). Not a new column on `lead_sources`: a connector's credential is logically a distinct, more sensitive concern, and keeping it in its own table means a query that only needs `lead_sources` (the vast majority) never touches it.
2. **One encrypted blob per source, not one row per field.** The decrypted value is a small JSON object (`{ appSecret, pageAccessToken, verifyToken }` for Meta) — shaped per-provider, opaque to everything except the adapter that defined the shape. This avoids a `connector_credential_fields` table for a concept (how many fields, which names) that is entirely provider-specific and has exactly one provider today.
3. **AES-256-GCM, with the key from `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`** (64 hex chars / 32 bytes), following the EXACT pattern `SESSION_SECRET` already uses: a default that is an obvious placeholder (32 zero bytes), flagged by the same `superRefine` production check `SESSION_SECRET` already has. A fresh random IV per encryption (so identical plaintext never produces identical ciphertext); the GCM auth tag makes a tampered ciphertext fail to decrypt rather than silently decrypt to garbage. `encryptCredentialBlob`/`decryptCredentialBlob` are standalone, pure, directly unit-tested functions; `ConnectorCredentialsService` is a thin wrapper supplying the key and the persistence.
4. **Write-only at the API boundary.** `PUT /admin/integrations/sources/:id/credentials` (new) accepts a replacement blob and returns the ordinary `SourceDto` plus `hasCredentials: boolean` — never the decrypted value, never even whether a specific field is set, only whether ANY blob exists. There is no corresponding `GET` of the decrypted value anywhere; `ConnectorCredentialsService.get()`/`getResolvedCredential()` are called only from inside the ingestion path (`IngestionService`), never from an admin controller.
5. **Decryption happens only at the point of use**, inside an already tenant-scoped transaction (`resolveDraft`'s credential read, `run()`'s `verify()` call), for exactly as long as the `ResolvedCredential` object is in scope. Never logged: `IngestionService`'s structured log lines (UC-1) carry ids and error codes, never payloads or credentials, unchanged.
6. **Tenant isolation is enforced by RLS, not only by `SourcesService`'s own tenant-scoped queries.** `connector_credentials` gets the ordinary tenant-isolation policy (`FORCE ROW LEVEL SECURITY`, `WITH CHECK` on `app.tenant_id`) every other tenant-owned table already has — nothing new invented. Proven directly: a query under tenant A's RLS context against tenant B's `source_id` returns zero rows even though the superuser connection confirms the row exists.
7. **No OAuth.** The admin enters the page access token and app secret directly (obtained from Meta's own dashboard, out of band). Building an OAuth authorization flow is explicitly out of scope for this milestone.

## Consequences

- One additive migration (`connector_credentials` table + `lead_sources.public_lookup_key` column + enum value + RLS policies), no renamed or redesigned existing table.
- A future provider needing a recoverable credential of a different shape reuses this table unchanged — it is already provider-neutral at the schema level; only the adapter that reads `credential.data.<field>` needs to know the shape.
- `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` must be set to a real, randomly generated value before any production credential is stored; the placeholder default is intentionally unusable for real encryption (every environment shares the same all-zero key), by the same convention `SESSION_SECRET` already uses to force this choice before production.

## Deferred

Key rotation / versioned encryption keys; per-field (rather than whole-blob) credential updates; an OAuth authorization flow; credential expiry/refresh for a token type that needs it.
