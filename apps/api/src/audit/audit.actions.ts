/**
 * The central, strongly-typed audit action catalogue (Phase 11, ADR 0040).
 *
 * Every `AuditService.record` call references a key from here — never a bare
 * string literal scattered through a service. Keys are stable once shipped
 * (they are queried and filtered on). Format: `module.entity.verb` (lower
 * snake, dot separated), matching the DB CHECK `audit_logs_action_format`.
 *
 * Each key maps to the `module` it belongs to so callers cannot drift a key
 * and its module apart, and the query API can validate a `module` filter.
 */

export const AUDIT_MODULES = [
  'auth',
  'identity',
  'crm',
  'integrations',
  'field',
  'supply',
  'commercial',
  'execution',
  'notifications',
  'finance',
  'settings',
] as const;

export type AuditModule = (typeof AUDIT_MODULES)[number];

/** action key -> owning module. Add new actions here, nowhere else. */
export const AUDIT_ACTION_MODULE = {
  // --- auth / security ------------------------------------------------
  'auth.login': 'auth',
  'auth.logout': 'auth',
  'auth.tenant_switched': 'auth',

  // --- tenant administration / identity ----------------------------
  'tenant.updated': 'identity',
  'tenant.member.invited': 'identity',
  'tenant.member.invitation_accepted': 'identity',
  'tenant.member.suspended': 'identity',
  'tenant.member.reactivated': 'identity',
  'tenant.member.removed': 'identity',
  'tenant.member.role_added': 'identity',
  'tenant.member.role_removed': 'identity',

  // --- CRM ---------------------------------------------------------
  'crm.lead.created': 'crm',
  'crm.lead.updated': 'crm',
  'crm.lead.assigned': 'crm',
  'crm.lead.status_changed': 'crm',
  'crm.lead.qualified': 'crm',
  'crm.lead.call_attempted': 'crm',
  'crm.lead.followup_created': 'crm',
  'crm.lead.note_created': 'crm',

  // --- integrations ---------------------------------------------
  'integration.source.created': 'integrations',
  'integration.source.updated': 'integrations',
  'integration.source.secret_rotated': 'integrations',
  'integration.source.revoked': 'integrations',
  'integration.source.reactivated': 'integrations',
  'integration.event.replayed': 'integrations',

  // --- field operations --------------------------------------
  'field.visit.created': 'field',
  'field.visit.assigned': 'field',
  'field.visit.rescheduled': 'field',
  'field.visit.cancelled': 'field',
  'field.visit.checked_in': 'field',
  'field.visit.checked_out': 'field',
  'field.visit.survey_completed': 'field',
  'field.visit.completed': 'field',
  'field.lead.created': 'field',

  // --- supply (projects / procurement / inventory / logistics) --
  'project.created': 'supply',
  'project.updated': 'supply',
  'product.created': 'supply',
  'supplier.created': 'supply',
  'warehouse.created': 'supply',
  'inventory.received': 'supply',
  'inventory.allocated': 'supply',
  'inventory.dispatched': 'supply',
  'inventory.delivered': 'supply',
  'purchase_order.created': 'supply',
  'purchase_order.approved': 'supply',

  // --- commercial (customers / quotations / booking) ---------
  'customer.created': 'commercial',
  'customer.updated': 'commercial',
  'quotation.created': 'commercial',
  'quotation.updated': 'commercial',
  'quotation.sent': 'commercial',
  'quotation.accepted': 'commercial',
  'quotation.revised': 'commercial',
  'quotation.booked': 'commercial',
  'quotation.cancelled': 'commercial',
  'quotation.expired': 'commercial',

  // --- EPC execution ----------------------------------------
  'project.installation.assigned': 'execution',
  'project.installation.started': 'execution',
  'project.installation.completed': 'execution',
  'project.checklist.updated': 'execution',
  'project.qc.started': 'execution',
  'project.qc.passed': 'execution',
  'project.qc.failed': 'execution',
  'project.defect.created': 'execution',
  'project.defect.resolved': 'execution',
  'project.net_metering.updated': 'execution',
  'project.handover.updated': 'execution',
  'project.completed': 'execution',

  // --- notifications configuration -------------------------
  'notification.template.created': 'notifications',
  'notification.template.updated': 'notifications',
  'notification.rule.created': 'notifications',
  'notification.rule.updated': 'notifications',
  'notification.preference.updated': 'notifications',

  // --- finance --------------------------------------------
  'finance.invoice.created': 'finance',
  'finance.invoice.issued': 'finance',
  'finance.invoice.cancelled': 'finance',
  'finance.invoice.voided': 'finance',
  'finance.payment.recorded': 'finance',
  'finance.payment.allocated': 'finance',
  'finance.payment.reversed': 'finance',
  'finance.credit_note.created': 'finance',
  'finance.credit_note.issued': 'finance',
  'finance.credit_note.cancelled': 'finance',

  // --- settings / branding -------------------------------
  'settings.company.updated': 'settings',
  'settings.branding.updated': 'settings',
  'settings.logo.updated': 'settings',
  'settings.onboarding.updated': 'settings',
} as const satisfies Record<string, AuditModule>;

export type AuditAction = keyof typeof AUDIT_ACTION_MODULE;

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_MODULE) as AuditAction[];

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}

export function isAuditModule(value: unknown): value is AuditModule {
  return typeof value === 'string' && (AUDIT_MODULES as readonly string[]).includes(value);
}

/** The module a well-known action belongs to (keeps key + module in lockstep). */
export function moduleForAction(action: AuditAction): AuditModule {
  return AUDIT_ACTION_MODULE[action];
}
