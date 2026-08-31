# Generic Email Ingestion Architecture

Status: Approved architecture. No application code exists yet.

Covers decision 28: Tata email leads are ingested via a **generic email
connector plus provider/template-specific parsing configuration**. No Tata
business rules are hard-coded into the CRM core.

## Components

```
Mailbox / inbound-email webhook
  --> email connector (transport)
  --> template matcher (config)
  --> email adapter (generic_email_* )
  --> mapping profile
  --> canonical event --> ... --> lead
```

### 1. Email connector (transport)

- Consumes a mailbox via IMAP/API poll (BullMQ repeatable job) or an
  inbound-email webhook from the mail provider.
- Authenticates to the mailbox; secrets in the secret store, never in config
  rows.
- Deduplicates on `Message-ID` at transport level.
- Builds an `InboundEnvelope`:
  `from`, `to`, `subject`, `date`, `message_id`, `spf/dkim` results,
  `text_body`, `html_body`, `attachments[]` (to object storage).
- Stores the full raw MIME in `raw_events` (`raw_body_ref`).
- One mailbox can feed many tenants/sources; routing is by matching rule, and
  the resolved `source` fixes the tenant. The tenant is **never** taken from the
  email body.

### 2. Template matcher (configuration)

`email_ingest_rules`
```
id            uuid v7
tenant_id     uuid  (RLS)
source_id     uuid  (fk)
priority      int
match_from    text/regex null      // e.g. sender domain
match_subject text/regex null
match_header  jsonb null
parser_key    text                 // which email adapter/parser config to use
status        enum: active | disabled
```

First matching rule (by `priority`) selects the `source` and `parser_key`.
No match -> event stored and routed to `NEEDS_REVIEW` (unclassified mail), never
dropped.

### 3. Email adapter (generic, config-driven)

Generic parser strategies, each **driven by declarative config**, selected by
`parser_key`:

- `generic_email_kv` - "Label: value" lines in the text body; config lists the
  labels to capture and their target keys.
- `generic_email_table` - key/value HTML table extraction; config gives
  row-label -> key.
- `generic_email_regex` - ordered named-capture patterns over the body; config
  holds the patterns.
- `generic_email_attachment` - pull a structured attachment (CSV/JSON) and hand
  it to `generic_json` / a CSV reader.

The parser produces a `ProviderDraft` using the **captured labels as provider
field names**. It contains no company-, provider-, or template-specific literals
in code - all of that lives in the parser config row and the mapping profile.

### 4. Mapping + downstream

Standard `FIELD-MAPPING.md` flow: captured labels -> `canonical:` / `custom:`
fields, then validation, dedup, lead, assignment.

## Configuration lives in data, not code

For "Tata via email" the setup is entirely configuration:
1. a `source` (provider key `tata`, connector `email`);
2. an `email_ingest_rule` matching Tata's sender/subject;
3. a `parser_key` pointing at a `generic_email_*` strategy + its capture config;
4. a `lead_mapping_profile` for the captured fields.

The exact sender address, subject pattern, and body labels are **not invented
here** - they are filled in from a real captured `raw_events` sample once
available.

## Idempotency & failure

- Transport: `Message-ID`.
- Business: identity hash (no provider record id in most email leads).
- Parse failure -> `MAPPING_FAILED`/`INVALID` -> dead-letter with the raw MIME
  reference for edit-and-replay.
- Unclassified mail -> `NEEDS_REVIEW` queue with the option to create/adjust an
  `email_ingest_rule` and replay.

## Security

- Enforce SPF/DKIM checks; low-trust results can be quarantined per policy.
- Attachment type allow-list + size limit + AV scan hook before object storage.
- Never execute or render HTML bodies; parse as data only.
