# Custom Field Architecture

Status: **Implemented in Phase 3** for the `lead` entity (ADR 0031), trimmed
for V1: no `is_filterable`/`is_reportable` flags, no declarative `validation`
JSON (type coercion + `select` options cover it), and no filterable-value
indexes beyond an entity-id lookup index — added if/when custom-field
filtering in the CRM UI is actually needed. The typed-column value storage
below is exactly as designed.

**Phase 4 (ADR 0033)** extended the `entity` enum with `visit`, generalizing
every coercion/validation/persistence function in
`apps/api/src/crm/custom-fields.service.ts` to take an explicit `entity`
parameter (defaulting to `'lead'`, so no existing call site changed). A
tenant's site-survey questions are `visit` custom fields — the same engine,
not a second one. See `FIELD-OPERATIONS.md`.

## Requirement

Tenants must be able to define their own lead/customer fields. Those fields must
be **filterable and reportable**, so a single uncontrolled JSON blob is not
acceptable (decision 25). Custom fields must also be a valid target for provider
field mapping (decision 26).

## Model: typed definition + typed value

Three layers.

### 1. Definition

`custom_field_definitions`

```
id                uuid v7 (pk)
tenant_id         uuid  (RLS)
entity            enum: "lead" | "customer" | ... (extensible)
key               slug, unique per (tenant, entity)
label             text
data_type         enum: string | text | number | integer | boolean
                        | date | datetime | enum | multi_enum
                        | phone | email | url | money
is_required       bool
is_filterable     bool     // indexed for query
is_reportable     bool     // surfaced to reporting layer
default_value     jsonb null
validation        jsonb    // min/max/regex/precision, declarative
enum_options      jsonb    // for enum / multi_enum
status            enum: active | deprecated
created_at / updated_at
```

Definitions are versioned by `status`; a deprecated field keeps its stored
values and stops being offered for new input.

### 2. Value storage (typed columns, not one blob)

`custom_field_values` - one row per (entity record, field), value written into
the column matching the field's type:

```
id                uuid v7 (pk)
tenant_id         uuid  (RLS)
entity            enum
entity_id         uuid           // the lead/customer id
definition_id     uuid  (fk)
field_key         slug           // denormalised for query ergonomics
value_string      text     null
value_number      numeric  null
value_boolean     boolean  null
value_datetime    timestamptz null
value_json        jsonb    null  // multi_enum and structured only
created_at / updated_at

unique (tenant_id, entity, entity_id, definition_id)
```

Indexes:

- `(tenant_id, entity, field_key, value_string)` partial where `value_string` not null
- `(tenant_id, entity, field_key, value_number)` partial where `value_number` not null
- `(tenant_id, entity, field_key, value_datetime)` partial where `value_datetime` not null
- `(tenant_id, entity, field_key, value_boolean)` partial where `value_boolean` not null

This is the "narrow EAV with typed value columns" pattern: bounded column set,
real types, real indexes, straightforward filtering and aggregation, no schema
migration per tenant field.

### 3. Read projection (optional, later)

For heavy reporting a per-tenant materialised view or a periodically rebuilt
`lead_custom_wide` projection can pivot active filterable fields into columns.
Not required for V1; the typed-value indexes cover operational filtering.

## Why not alternatives

| Option                                  | Rejected because                                                      |
| --------------------------------------- | --------------------------------------------------------------------- |
| One `custom_fields jsonb` blob          | not reliably filterable/reportable; no typing; decision 25 forbids it |
| Column-per-field via runtime DDL        | migration risk, lock contention, unbounded schema, hard multi-tenant  |
| Fully generic EAV (single `value text`) | loses types; every filter is a cast; poor aggregation                 |

## Interaction with mapping

A mapping profile entry may target `canonical:<field>` or
`custom:<field_key>`. On ingest, the mapping engine resolves `custom:<key>`
against `custom_field_definitions` for the tenant, coerces the incoming value to
the definition's `data_type`, validates, and writes one `custom_field_values`
row. Unknown `custom:<key>` targets fail the mapping stage (DLQ), never silently
drop.

## Tenancy & audit

All tables carry `tenant_id`, RLS-protected, plus application tenant guards.
Definition changes (create/deprecate/alter validation) are audit-logged.
