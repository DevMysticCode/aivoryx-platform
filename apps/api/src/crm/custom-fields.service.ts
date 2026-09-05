import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';

const { customFieldDefinitions, customFieldValues } = schema;

export type CustomFieldInputValue = string | number | boolean | null;

export interface TenantScope {
  tenantId: string;
  userId: string;
}

export interface CustomFieldDefinitionView {
  id: string;
  key: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  options: string[] | null;
  status: string;
}

export interface CreateCustomFieldInput {
  key: string;
  label: string;
  dataType: 'text' | 'number' | 'boolean' | 'date' | 'select';
  isRequired?: boolean;
  options?: string[];
}

@Injectable()
export class CustomFieldsService {
  list(scope: TenantScope): Promise<CustomFieldDefinitionView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.tenantId, scope.tenantId),
            eq(customFieldDefinitions.entity, 'lead'),
          ),
        );
      return rows.map(toView);
    });
  }

  async create(
    scope: TenantScope,
    input: CreateCustomFieldInput,
  ): Promise<CustomFieldDefinitionView> {
    if (input.dataType === 'select' && (!input.options || input.options.length === 0)) {
      throw new AppError('VALIDATION_ERROR', {
        details: { field: 'options', reason: 'A select field needs at least one option.' },
      });
    }
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(customFieldDefinitions)
        .values({
          tenantId: scope.tenantId,
          entity: 'lead',
          key: input.key,
          label: input.label,
          dataType: input.dataType,
          isRequired: input.isRequired ?? false,
          options: input.options ?? null,
        })
        .returning();
      return toView(row!);
    });
  }

  async deprecate(scope: TenantScope, definitionId: string): Promise<CustomFieldDefinitionView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .update(customFieldDefinitions)
        .set({ status: 'deprecated', updatedAt: new Date() })
        .where(
          and(
            eq(customFieldDefinitions.id, definitionId),
            eq(customFieldDefinitions.tenantId, scope.tenantId),
          ),
        )
        .returning();
      if (!row) throw new AppError('CUSTOM_FIELD_NOT_FOUND');
      return toView(row);
    });
  }
}

function toView(row: typeof customFieldDefinitions.$inferSelect): CustomFieldDefinitionView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    dataType: row.dataType,
    isRequired: row.isRequired,
    options: (row.options as string[] | null) ?? null,
    status: row.status,
  };
}

export interface ActiveCustomFieldDef {
  id: string;
  key: string;
  dataType: string;
  options: string[] | null;
}

export async function loadActiveCustomFieldDefs(
  tx: Tx,
  tenantId: string,
): Promise<ActiveCustomFieldDef[]> {
  const rows = await tx
    .select({
      id: customFieldDefinitions.id,
      key: customFieldDefinitions.key,
      dataType: customFieldDefinitions.dataType,
      options: customFieldDefinitions.options,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.tenantId, tenantId),
        eq(customFieldDefinitions.entity, 'lead'),
        eq(customFieldDefinitions.status, 'active'),
      ),
    );
  return rows.map((r) => ({ ...r, options: r.options as string[] | null }));
}

export interface CoercedCustomFieldRow {
  definitionId: string;
  value: CoercedValue;
}

export type ValidateCustomFieldsResult =
  | { ok: true; rows: CoercedCustomFieldRow[] }
  | { ok: false; key: string; reason: 'unknown_field' | 'invalid_value' };

/**
 * Pure validation/coercion against a set of already-loaded definitions.
 * Unknown keys and values of the wrong shape are rejected (never silently
 * dropped) — mirrors the mapping-engine rule in FIELD-MAPPING.md. Used by both
 * the manual lead API and the inbound ingestion pipeline, which must validate
 * BEFORE deciding whether to create a lead at all.
 */
export function validateCustomFieldValues(
  defs: ActiveCustomFieldDef[],
  values: Record<string, CustomFieldInputValue>,
): ValidateCustomFieldsResult {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const rows: CoercedCustomFieldRow[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) return { ok: false, key, reason: 'unknown_field' };
    const coerced = coerce(def.dataType, def.options, raw);
    if (coerced === undefined) return { ok: false, key, reason: 'invalid_value' };
    rows.push({ definitionId: def.id, value: coerced });
  }
  return { ok: true, rows };
}

export async function persistCoercedCustomFieldValues(
  tx: Tx,
  tenantId: string,
  entityId: string,
  rows: CoercedCustomFieldRow[],
): Promise<void> {
  for (const row of rows) {
    await tx
      .insert(customFieldValues)
      .values({
        tenantId,
        entity: 'lead',
        entityId,
        definitionId: row.definitionId,
        valueText: row.value.text,
        valueNumber: row.value.number,
        valueBoolean: row.value.boolean,
        valueDate: row.value.date,
      })
      .onConflictDoUpdate({
        target: [
          customFieldValues.tenantId,
          customFieldValues.entity,
          customFieldValues.entityId,
          customFieldValues.definitionId,
        ],
        set: {
          valueText: row.value.text,
          valueNumber: row.value.number,
          valueBoolean: row.value.boolean,
          valueDate: row.value.date,
          updatedAt: new Date(),
        },
      });
  }
}

/**
 * Convenience wrapper for the manual lead API: load defs, validate, persist,
 * throwing the matching `AppError` on the first problem (unlike the ingestion
 * pipeline, an authenticated API call has no "store now, fix later" option).
 */
export async function writeCustomFieldValues(
  tx: Tx,
  tenantId: string,
  leadId: string,
  values: Record<string, CustomFieldInputValue>,
): Promise<void> {
  if (Object.keys(values).length === 0) return;
  const defs = await loadActiveCustomFieldDefs(tx, tenantId);
  const result = validateCustomFieldValues(defs, values);
  if (!result.ok) {
    throw new AppError(
      result.reason === 'unknown_field' ? 'CUSTOM_FIELD_NOT_FOUND' : 'CUSTOM_FIELD_INVALID_VALUE',
      { details: { key: result.key } },
    );
  }
  await persistCoercedCustomFieldValues(tx, tenantId, leadId, result.rows);
}

export interface CoercedValue {
  text: string | null;
  number: string | null;
  boolean: boolean | null;
  date: string | null;
}

const EMPTY: CoercedValue = { text: null, number: null, boolean: null, date: null };

/** Returns `undefined` when the raw value cannot be coerced to the field's type. */
function coerce(
  dataType: string,
  options: string[] | null,
  raw: CustomFieldInputValue,
): CoercedValue | undefined {
  if (raw === null) return EMPTY;
  switch (dataType) {
    case 'text':
      return typeof raw === 'string' ? { ...EMPTY, text: raw } : undefined;
    case 'select':
      return typeof raw === 'string' && (options ?? []).includes(raw)
        ? { ...EMPTY, text: raw }
        : undefined;
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? { ...EMPTY, number: String(n) } : undefined;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { ...EMPTY, boolean: raw } : undefined;
    case 'date': {
      if (typeof raw !== 'string') return undefined;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : { ...EMPTY, date: raw.slice(0, 10) };
    }
    default:
      return undefined;
  }
}
