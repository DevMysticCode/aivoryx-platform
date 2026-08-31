# ADR 0020 — Typed Tenant-Configurable Custom Fields

Status: Accepted

## Context
Tenants need their own lead/customer fields, and those must be **filterable and
reportable**. A single uncontrolled JSON blob cannot deliver that.

## Decision
A three-layer model:

1. **`custom_field_definitions`** — per tenant, per entity: `key`, `label`,
   `data_type` (string/text/number/integer/boolean/date/datetime/enum/
   multi_enum/phone/email/url/money), `is_required`, `is_filterable`,
   `is_reportable`, declarative `validation`, `enum_options`, `status`.
2. **`custom_field_values`** — one row per (record, field); the value is written
   into the typed column matching the definition (`value_string` / `value_number`
   / `value_boolean` / `value_datetime` / `value_json` for multi_enum), with
   partial indexes per `(tenant_id, entity, field_key, value_*)`.
3. Optional per-tenant **wide read projection** later for heavy reporting.

Mapping targets are `canonical:<field>` or `custom:<field_key>`; an unknown
`custom:` target fails the mapping stage (dead-letter), never silently drops.

## Consequences
Real types, real indexes, real aggregation, no per-tenant DDL. Explicitly
rejects: one JSON blob, runtime column-per-field DDL, and single-`value text`
EAV. Detail in `docs/architecture/CUSTOM-FIELDS.md`.
