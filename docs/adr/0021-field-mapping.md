# ADR 0021 — Provider-to-Canonical Field Mapping

Status: Accepted

## Context
Provider fields must reach canonical Aivoryx fields and tenant custom fields
without provider names leaking past the mapping boundary.

## Decision
Declarative **mapping profiles** per tenant per source:

- `lead_mapping_profiles` (versioned; old versions retained for replay) +
  ordered `lead_mapping_rules` (`source_path`, `target`, `transform`,
  `transform_args`, `on_missing`, `default_value`, `required`).
- `target` is `canonical:<field>` (from a stable, doc-governed canonical field
  set) or `custom:<field_key>` (resolved against `custom_field_definitions`).
- Transforms are a fixed enumerated set (trim, case, `e164_phone`, `parse_date`,
  `to_number`, `to_bool`, `split_multi`, `template`, …).
- Resolution is a pure function of `(ProviderDraft, profile version, custom-field
  defs)`; the pipeline persists its output. Unmapped provider fields are kept
  for review, not written onto the lead. A failed `required` rule or a `fail`
  on-missing dead-letters the event with a precise reason.
- A `default_website_form` profile ships as a template; no provider-branded
  profile ships until real payloads exist.

## Consequences
Mapping changes are configuration + review, not code. Historical events replay
against the exact profile version active when they arrived. Detail in
`docs/architecture/FIELD-MAPPING.md`.
