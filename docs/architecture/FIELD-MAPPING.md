# Field Mapping Architecture

Status: Approved architecture. No application code exists yet.

## Purpose

Translate a provider's fields (from a `ProviderDraft`) into canonical Aivoryx
lead fields and tenant custom fields (decision 26), declaratively, per tenant
per source.

## Mapping profile

`lead_mapping_profiles`
```
id            uuid v7 (pk)
tenant_id     uuid  (RLS)
source_id     uuid  (fk)          // one active profile per source
name          text
version       int
status        enum: draft | active | archived
created_at / updated_at
```

`lead_mapping_rules` (ordered, belongs to a profile)
```
id              uuid v7 (pk)
profile_id      uuid  (fk)
order_index     int
source_path     text        // dot path into provider_fields, or "$const"
target          text        // "canonical:<field>" | "custom:<field_key>"
transform       enum: none | trim | lower | upper | digits_only
                       | e164_phone | parse_date | to_number | to_bool
                       | split_multi | template
transform_args  jsonb       // e.g. date format, template string, delimiter
on_missing      enum: skip | default | fail
default_value   jsonb null
required        bool
```

Profiles are configuration. Editing a profile creates a new `version`; the old
version is retained so historical `RawEvent`s can be replayed against the exact
profile that was active when they arrived.

## Canonical lead field set (system + standard CRM)

The mapping **target** vocabulary. Stable, provider-neutral.

System (engine-managed, not mapping targets):
`id, tenant_id, source_id, raw_event_id, idempotency_key, status,
created_at, updated_at`.

Standard CRM (valid `canonical:` targets):
```
full_name, first_name, last_name,
primary_phone, alt_phone, primary_email,
company_name,
address_line, city, state, postal_code, country,
product_interest, budget_amount, currency,
message, campaign, ad_id, referrer_url,
provider_record_id, provider_created_at,
consent_marketing (bool), language
```

This list is extended only by an ADR/doc update, never ad hoc in code. Anything
a provider sends that is not in this list is either mapped to a `custom:` field
or retained untouched in the `RawEvent`.

## Resolution algorithm (per inbound event)

1. Load the **active** mapping profile for the source (or the profile version
   pinned by a replay request).
2. For each rule in `order_index`:
   a. read `source_path` from `provider_fields` (or use `$const`);
   b. if absent -> apply `on_missing` (`skip` / `default` / `fail`);
   c. apply `transform` with `transform_args`;
   d. resolve `target`:
      - `canonical:<f>` -> must be in the canonical set; coerce to that
        field's type;
      - `custom:<k>` -> look up `custom_field_definitions`; coerce to its
        `data_type`; validate;
   e. write into the `CanonicalLeadEvent` draft (canonical map + custom map).
3. Collect unmapped provider fields into `draft.unmapped` (kept for review, not
   persisted onto the lead).
4. If any `required` rule failed or any `fail` fired -> stage result
   `MAPPING_FAILED` -> dead-letter with a precise reason and reference id.

Mapping is pure given (ProviderDraft, profile version, custom-field defs); it
performs no writes itself - the pipeline persists its output.

## Defaults and bootstrapping

A built-in `default_website_form` profile ships as a starting template
(maps common `name/email/phone/message` keys). Tenants clone and adjust it.
No provider-branded profile ships until real payloads exist.

## Testing

Profiles are testable offline: feed a stored `RawEvent` + profile version, get a
`CanonicalLeadEvent` draft, assert on canonical/custom output. This is the
primary Vitest surface for the mapping engine.
