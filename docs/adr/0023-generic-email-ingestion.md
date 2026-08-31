# ADR 0023 — Generic Email Ingestion

Status: Accepted

## Context
"Tata via email" must not hard-code Tata business rules into the CRM core
(decision 28). Other providers will also send leads by email.

## Decision
A **generic email connector** plus **provider/template parsing configuration**:

- The connector consumes a mailbox (IMAP/API poll or inbound-email webhook),
  authenticates, dedups on `Message-ID`, stores full raw MIME in `raw_events`,
  and builds an `InboundEnvelope`. One mailbox can serve many tenants/sources.
- `email_ingest_rules` (per tenant, ordered) match on from-address / subject /
  header and select the `source` and a `parser_key`. No match →
  `NEEDS_REVIEW`, never dropped.
- Email **adapters are generic, config-driven** strategies —
  `generic_email_kv`, `generic_email_table`, `generic_email_regex`,
  `generic_email_attachment` — with no company-, provider-, or template-specific
  literals in code. Captured labels become provider field names for mapping.
- Setting up "Tata via email" is entirely configuration: a `source`, an
  `email_ingest_rule`, a `parser_key` + capture config, and a mapping profile —
  all filled from a real captured sample, not invented here.
- Enforce SPF/DKIM; attachment allow-list + size limit + AV scan; never render
  HTML bodies, parse as data only.

## Consequences
Any email-delivered lead source is onboarded without core code changes. Detail
in `docs/architecture/EMAIL-INGESTION.md`.
