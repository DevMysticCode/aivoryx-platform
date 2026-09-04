# Integrations

Provider-facing integration notes and captured payload samples for the Lead
Ingestion Engine (`docs/architecture/LEAD-INGESTION.md`).

Empty until real provider discovery is done. Nothing that depends on an external
API is built before its notes + samples land here (`CLAUDE.md §11`,
`docs/owner/PRE-CODE-CHECKLIST.md §C–E`).

- `samples/<provider>/` — sanitized real payloads (never real customer PII)
- `<provider>.md` — auth, transport, fields, rate limits, failure behaviour,
  record ids, attachments, business owner
