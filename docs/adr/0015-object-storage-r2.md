# ADR 0015 — Object Storage: S3-Compatible, Cloudflare R2 Initially

Status: Accepted

## Context

Raw integration payload bodies, email MIME, survey photos and HR documents need
durable blob storage. Railway has no native object store.

## Decision

Use **S3-compatible** object storage, **Cloudflare R2** initially (revisit by a
later ADR if needed).

- Access via the S3 API with scoped tokens held in the secret manager.
- Private buckets; browser upload/download uses short-TTL presigned URLs.
- Tenant-scoped key prefixes; bucket versioning + lifecycle rules for raw-event
  bodies and attachments.
- Attachment type allow-list, size limits, and an AV-scan hook before an object
  is considered usable.
- Code depends on an internal storage interface, not R2 directly, so the
  provider can change without touching callers.

## Consequences

No egress lock-in beyond the S3 API. A storage abstraction is required from day
one. Separate buckets per environment.
