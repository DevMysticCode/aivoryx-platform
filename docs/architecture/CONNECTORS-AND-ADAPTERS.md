# Connector and Adapter Architecture

Status: Approved architecture. No application code exists yet.

This document defines the provider-neutral boundary that keeps the Lead
Ingestion Engine (and later, general integrations) free of provider-specific
branching.

## Two distinct concerns

| Concern    | Question it answers        | Knows about transport | Knows about a provider's fields |
|------------|----------------------------|-----------------------|--------------------------------|
| Connector  | *How did the payload get here?* | Yes              | No                             |
| Adapter    | *What shape is this payload?*    | No               | Yes (one provider each)        |

Keeping these separate means a new provider that arrives over an existing
transport needs only a new adapter + mapping profile, and a new transport
(e.g. a message queue) needs only a new connector.

## Connector types (extensible)

All connectors normalise their input into a single `InboundEnvelope`:

```
InboundEnvelope {
  source_id            // resolves tenant + provider config
  transport            // "webhook" | "email" | "rest_pull" | "pabbly_bridge" | "manual_csv"
  received_at
  transport_metadata   // headers, mailbox info, request id, sender, etc.
  raw_body             // bytes / string, untouched
  raw_attachments[]    // stored by reference in object storage
}
```

### webhook
Inbound HTTP endpoint per source or per provider family. Responsibilities:
- verify transport authentication (shared secret, HMAC signature) where the
  provider supports it - specifics deferred until real provider docs exist;
- enforce body size limits, content-type allow-list, rate limits;
- return fast (2xx) after the RawEvent is durably stored; processing is async.

### email
A generic mailbox consumer (IMAP/API-based inbox or inbound-email webhook from
the mail provider). Responsibilities:
- authenticate to the mailbox;
- deduplicate on Message-ID;
- capture headers, body parts, and attachments into the envelope;
- hand off to an adapter selected by tenant + matching rules
  (from-address / subject pattern). See `EMAIL-INGESTION.md`.

### rest_pull
Scheduled outbound fetch from a provider REST API (BullMQ repeatable job).
Responsibilities: credential storage, pagination cursor/state, incremental
windowing, rate-limit handling. No provider client is implemented yet - this is
an interface and a scheduler slot.

### pabbly_bridge
A constrained `webhook` specialisation for payloads relayed by Pabbly during
migration. See `PABBLY-BRIDGE.md`. Treated as temporary; no core dependency.

### manual_csv (later)
Operator-uploaded file mapped through the same mapping engine. Not in V1.

## Adapter contract

```
Adapter {
  key                 // e.g. "generic_json", "generic_form"
  parse(raw_body, envelope) -> ProviderDraft
}

ProviderDraft {
  provider_fields     // flat typed key/value using the PROVIDER's own names
  provider_record_id? // provider's identifier if present
  provider_timestamp? // provider's event time if present
  attachments[]       // references
  parse_warnings[]
}
```

Rules:
- Adapters are **pure functions**: no DB, no network, no clock beyond values in
  the envelope.
- One adapter understands exactly one provider's structure (or one generic
  structure). No `if (provider === "meta")` anywhere outside its own adapter.
- Adapter selection is configuration on the `source` (`adapter_key`), not code.
- Unknown/extra fields are preserved in `provider_fields`, never discarded.

## Planned V1 adapters

- `generic_json` - arbitrary JSON object; flattens one level, keeps types.
- `generic_form` - `application/x-www-form-urlencoded` / multipart form posts
  (covers typical website form and many webhook relays).

No provider-branded adapter is built until its real payload samples and API
documentation are in hand (`docs/integrations/samples/`, to be added).

## Adapter registry

A static in-process registry maps `adapter_key -> Adapter`. Adding a provider
later = add one adapter module + register it + create a mapping profile. No
change to connectors, pipeline, or the lead model.

## Relationship to the general Integration Engine

Lead ingestion is the first consumer of this connector/adapter layer. The same
contracts are intended to serve outbound REST actions and non-lead inbound
events later. Anything beyond lead ingestion is out of scope for V1.
