import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { checklistTemplates } = schema;

type ChecklistKind = schema.ChecklistTemplateRow['kind'];

/**
 * Default checklist definitions (Phase 7, ADR 0036 §9/§11). Seeded per tenant
 * the first time execution or a QC inspection needs them; thereafter a tenant
 * can edit / add / deactivate templates. Checklist questions are never
 * hard-coded into the schema — this mirrors the Phase 3 custom-field
 * definition/value split.
 */
export const DEFAULT_CHECKLIST_TEMPLATES: Record<
  ChecklistKind,
  { label: string; required: boolean }[]
> = {
  installation: [
    { label: 'Site prepared', required: true },
    { label: 'Mounting structure installed', required: true },
    { label: 'Equipment installed', required: true },
    { label: 'Cabling completed', required: true },
    { label: 'Connections checked', required: true },
    { label: 'Labels installed', required: true },
    { label: 'Area cleaned', required: false },
    { label: 'Customer walkthrough completed', required: false },
  ],
  qc: [
    { label: 'Structural installation acceptable', required: true },
    { label: 'Equipment installation acceptable', required: true },
    { label: 'Cable routing acceptable', required: true },
    { label: 'Connections acceptable', required: true },
    { label: 'Labeling acceptable', required: true },
    { label: 'Safety requirements satisfied', required: true },
    { label: 'Installation photographs complete', required: true },
  ],
  handover: [
    { label: 'System demonstrated to customer', required: true },
    { label: 'Operation & maintenance guide provided', required: true },
    { label: 'Warranty documents provided', required: true },
    { label: 'Customer contact details confirmed', required: false },
  ],
};

/**
 * Ensure the tenant has the default template set for `kind`, then return the
 * active templates ordered by `sortOrder`. Idempotent.
 */
export async function ensureAndLoadTemplates(
  tx: Tx,
  tenantId: string,
  kind: ChecklistKind,
): Promise<schema.ChecklistTemplateRow[]> {
  const existing = await tx
    .select()
    .from(checklistTemplates)
    .where(and(eq(checklistTemplates.tenantId, tenantId), eq(checklistTemplates.kind, kind)));
  if (existing.length === 0) {
    await tx
      .insert(checklistTemplates)
      .values(
        DEFAULT_CHECKLIST_TEMPLATES[kind].map((t, i) => ({
          tenantId,
          kind,
          label: t.label,
          required: t.required,
          sortOrder: i,
        })),
      )
      .onConflictDoNothing();
    return tx
      .select()
      .from(checklistTemplates)
      .where(and(eq(checklistTemplates.tenantId, tenantId), eq(checklistTemplates.kind, kind)));
  }
  return existing;
}
