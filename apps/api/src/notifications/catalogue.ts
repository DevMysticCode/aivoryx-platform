import { collectVariables } from './template.js';

/**
 * System default notification catalogue (ADR 0037).
 *
 * Rules and templates ship in code so the platform works with zero tenant
 * configuration. A tenant row in `notification_rules` / `notification_templates`
 * *overrides* a default by key — a tenant can enable/disable a rule, narrow its
 * channels, or re-word a template without an application change. This is NOT a
 * workflow engine: a rule is a fixed mapping
 * `event type -> template -> channel(s) -> recipient strategy`, nothing more.
 */

export type NotificationChannel = 'in_app' | 'email' | 'whatsapp' | 'sms';
export type NotificationType = 'info' | 'success' | 'warning' | 'action_required';
export type RecipientStrategy = 'USER' | 'ACTOR' | 'ASSIGNED_USER' | 'ROLE' | 'CUSTOMER';

/** Which business entity an ASSIGNED_USER / CUSTOMER strategy resolves through. */
export type RecipientEntity =
  | 'lead'
  | 'quotation_lead'
  | 'project_lead'
  | 'installation'
  | 'visit'
  | 'quotation_customer'
  | 'project_customer';

export interface DefaultTemplate {
  key: string;
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
  /** paths that MUST resolve or the render fails safe */
  requiredVars: string[];
}

export interface DefaultRule {
  key: string;
  eventType: string;
  templateKey: string;
  channels: NotificationChannel[];
  recipientStrategy: RecipientStrategy;
  /** for ROLE */
  roleKey?: string;
  /** for USER */
  membershipId?: string;
  /** for ASSIGNED_USER / CUSTOMER */
  entity?: RecipientEntity;
  notificationType: NotificationType;
  /** false => ignores per-user preferences (system-critical) */
  suppressible: boolean;
  /** app-relative click-through target; may contain `{{ vars }}` */
  deepLink?: string;
  description: string;
}

// --- default templates -------------------------------------------------

const RAW_TEMPLATES: Omit<DefaultTemplate, 'requiredVars'>[] = [
  {
    key: 'quotation_sent',
    title: 'Quotation {{quotation.number}} sent',
    body: 'Quotation {{quotation.number}} for {{customer.name}} was sent. Total {{quotation.total}}.',
    emailSubject: 'Your quotation {{quotation.number}} from {{tenant.name}}',
    emailBody:
      'Hello {{customer.name}},\n\n' +
      'Your quotation {{quotation.number}} has been sent for your review.\n\n' +
      'Total: {{quotation.total}}\n\n' +
      'Thank you,\n{{tenant.name}}',
  },
  {
    key: 'quotation_accepted',
    title: 'Quotation {{quotation.number}} accepted',
    body: '{{customer.name}} accepted quotation {{quotation.number}}.',
    emailSubject: 'Quotation {{quotation.number}} accepted',
    emailBody:
      'Quotation {{quotation.number}} for {{customer.name}} has been accepted.\n\n{{tenant.name}}',
  },
  {
    key: 'quotation_booked',
    title: 'Quotation {{quotation.number}} booked',
    body: 'Quotation {{quotation.number}} for {{customer.name}} was booked into a project.',
    emailSubject: 'Your order is confirmed — {{quotation.number}}',
    emailBody:
      'Hello {{customer.name}},\n\n' +
      'Your quotation {{quotation.number}} has been confirmed and your project is now being set up.\n\n' +
      'Thank you,\n{{tenant.name}}',
  },
  {
    key: 'project_completed',
    title: 'Project {{project.number}} completed',
    body: 'Project {{project.number}} for {{customer.name}} has been completed.',
    emailSubject: 'Your project {{project.number}} is complete',
    emailBody:
      'Hello {{customer.name}},\n\n' +
      'We are pleased to let you know that your project {{project.number}} is now complete.\n\n' +
      'Thank you for choosing {{tenant.name}}.',
  },
  {
    key: 'installation_assigned',
    title: 'Installation assigned — {{project.number}}',
    body: 'You have been assigned the installation for project {{project.number}}.',
    emailSubject: 'Installation assigned: {{project.number}}',
    emailBody:
      'You have been assigned the installation for project {{project.number}}.\n\n{{tenant.name}}',
  },
  {
    key: 'visit_assigned',
    title: 'Visit assigned — {{lead.name}}',
    body: 'You have a new site visit for {{lead.name}}.',
    emailSubject: 'Visit assigned: {{lead.name}}',
    emailBody: 'You have been assigned a site visit for {{lead.name}}.\n\n{{tenant.name}}',
  },
  {
    key: 'qc_failed',
    title: 'QC failed — {{project.number}}',
    body: 'A QC inspection failed for project {{project.number}}.',
    emailSubject: 'QC failed: {{project.number}}',
    emailBody: 'A QC inspection failed for project {{project.number}}. Rework is required.',
  },
  {
    key: 'defect_created',
    title: 'Defect raised — {{project.number}}',
    body: 'A {{defect.severity}} defect was raised on project {{project.number}}.',
    emailSubject: 'Defect raised: {{project.number}}',
    emailBody: 'A {{defect.severity}} defect was raised on project {{project.number}}.',
  },
  {
    key: 'dispatch_delivered',
    title: 'Dispatch {{dispatch.number}} delivered',
    body: 'Dispatch {{dispatch.number}} for project {{project.number}} was delivered.',
    emailSubject: 'Dispatch {{dispatch.number}} delivered',
    emailBody: 'Dispatch {{dispatch.number}} for project {{project.number}} has been delivered.',
  },
  {
    key: 'purchase_order_approved',
    title: 'Purchase order {{purchaseOrder.number}} approved',
    body: 'Purchase order {{purchaseOrder.number}} was approved.',
    emailSubject: 'Purchase order {{purchaseOrder.number}} approved',
    emailBody: 'Purchase order {{purchaseOrder.number}} has been approved.',
  },
  {
    key: 'lead_created',
    title: 'New lead — {{lead.name}}',
    body: 'A new lead {{lead.name}} was captured from {{lead.source}}.',
    emailSubject: 'New lead: {{lead.name}}',
    emailBody: 'A new lead {{lead.name}} was captured from {{lead.source}}.',
  },
];

/** Required vars are inferred from the in-app title + body (the parts every
 *  channel shows); email-only vars are best-effort. */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = RAW_TEMPLATES.map((t) => ({
  ...t,
  requiredVars: collectVariables(t.title, t.body),
}));

const TEMPLATE_BY_KEY = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, t]));

// --- default rules ---------------------------------------------------

export const DEFAULT_RULES: DefaultRule[] = [
  {
    key: 'quotation_sent.customer',
    eventType: 'quotation.sent',
    templateKey: 'quotation_sent',
    channels: ['email'],
    recipientStrategy: 'CUSTOMER',
    entity: 'quotation_customer',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/quotations/{{quotation.id}}',
    description: 'Email the customer when their quotation is sent.',
  },
  {
    key: 'quotation_sent.owner',
    eventType: 'quotation.sent',
    templateKey: 'quotation_sent',
    channels: ['in_app'],
    recipientStrategy: 'ASSIGNED_USER',
    entity: 'quotation_lead',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/quotations/{{quotation.id}}',
    description: 'Notify the lead owner in-app when a quotation is sent.',
  },
  {
    key: 'quotation_accepted.owner',
    eventType: 'quotation.accepted',
    templateKey: 'quotation_accepted',
    channels: ['in_app'],
    recipientStrategy: 'ASSIGNED_USER',
    entity: 'quotation_lead',
    notificationType: 'success',
    suppressible: true,
    deepLink: '/quotations/{{quotation.id}}',
    description: 'Notify the lead owner in-app when a quotation is accepted.',
  },
  {
    key: 'quotation_booked.customer',
    eventType: 'quotation.booked',
    templateKey: 'quotation_booked',
    channels: ['email'],
    recipientStrategy: 'CUSTOMER',
    entity: 'quotation_customer',
    notificationType: 'success',
    suppressible: true,
    description: 'Email the customer when their quotation is booked.',
  },
  {
    key: 'quotation_booked.owner',
    eventType: 'quotation.booked',
    templateKey: 'quotation_booked',
    channels: ['in_app'],
    recipientStrategy: 'ASSIGNED_USER',
    entity: 'quotation_lead',
    notificationType: 'success',
    suppressible: true,
    deepLink: '/quotations/{{quotation.id}}',
    description: 'Notify the lead owner in-app when a quotation is booked.',
  },
  {
    key: 'project_completed.customer',
    eventType: 'project.completed',
    templateKey: 'project_completed',
    channels: ['email'],
    recipientStrategy: 'CUSTOMER',
    entity: 'project_customer',
    notificationType: 'success',
    suppressible: true,
    description: 'Email the customer when their project is completed.',
  },
  {
    key: 'project_completed.admins',
    eventType: 'project.completed',
    templateKey: 'project_completed',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'success',
    suppressible: true,
    deepLink: '/projects/{{project.id}}',
    description: 'Notify workspace admins in-app when a project is completed.',
  },
  {
    key: 'installation_assigned.agent',
    eventType: 'installation.assigned',
    templateKey: 'installation_assigned',
    channels: ['in_app', 'email'],
    recipientStrategy: 'ASSIGNED_USER',
    entity: 'installation',
    notificationType: 'action_required',
    suppressible: true,
    deepLink: '/field/projects/{{project.id}}',
    description: 'Notify the assigned field agent when an installation is assigned to them.',
  },
  {
    key: 'visit_assigned.agent',
    eventType: 'visit.assigned',
    templateKey: 'visit_assigned',
    channels: ['in_app'],
    recipientStrategy: 'ASSIGNED_USER',
    entity: 'visit',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/field/visits/{{visit.id}}',
    description: 'Notify the assigned field agent when a visit is assigned to them.',
  },
  {
    key: 'qc_failed.admins',
    eventType: 'qc.failed',
    templateKey: 'qc_failed',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'warning',
    suppressible: true,
    deepLink: '/projects/{{project.id}}/execution',
    description: 'Notify workspace admins in-app when a QC inspection fails.',
  },
  {
    key: 'defect_created.admins',
    eventType: 'defect.created',
    templateKey: 'defect_created',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'warning',
    suppressible: true,
    deepLink: '/projects/{{project.id}}/execution',
    description: 'Notify workspace admins in-app when a defect is raised.',
  },
  {
    key: 'dispatch_delivered.admins',
    eventType: 'dispatch.delivered',
    templateKey: 'dispatch_delivered',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/logistics/dispatches/{{dispatch.id}}',
    description: 'Notify workspace admins in-app when a dispatch is delivered.',
  },
  {
    key: 'purchase_order_approved.admins',
    eventType: 'purchase_order.approved',
    templateKey: 'purchase_order_approved',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/procurement/purchase-orders/{{purchaseOrder.id}}',
    description: 'Notify workspace admins in-app when a purchase order is approved.',
  },
  {
    key: 'lead_created.admins',
    eventType: 'lead.created',
    templateKey: 'lead_created',
    channels: ['in_app'],
    recipientStrategy: 'ROLE',
    roleKey: 'TENANT_ADMIN',
    notificationType: 'info',
    suppressible: true,
    deepLink: '/crm/leads/{{lead.id}}',
    description: 'Notify workspace admins in-app when a new lead is captured.',
  },
];

const RULE_BY_KEY = new Map(DEFAULT_RULES.map((r) => [r.key, r]));

/** Every outbox event type the engine currently reacts to. */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_RULES.map((r) => r.eventType),
);

export function defaultTemplate(key: string): DefaultTemplate | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

export function defaultRule(key: string): DefaultRule | undefined {
  return RULE_BY_KEY.get(key);
}

export function defaultRulesForEvent(eventType: string): DefaultRule[] {
  return DEFAULT_RULES.filter((r) => r.eventType === eventType);
}

// --- effective (default merged with tenant override) ----------------

export interface TenantRuleOverride {
  key: string;
  isActive: boolean;
  channels: NotificationChannel[] | null;
}

export interface EffectiveRule extends DefaultRule {
  isActive: boolean;
  /** true when a tenant row exists for this rule key */
  overridden: boolean;
}

export function mergeRule(
  base: DefaultRule,
  override: TenantRuleOverride | undefined,
): EffectiveRule {
  if (!override) return { ...base, isActive: true, overridden: false };
  const channels =
    override.channels && override.channels.length > 0
      ? base.channels.filter((c) => override.channels!.includes(c))
      : base.channels;
  return {
    ...base,
    channels: channels.length > 0 ? channels : base.channels,
    isActive: override.isActive,
    overridden: true,
  };
}

export function effectiveRules(overrides: TenantRuleOverride[]): EffectiveRule[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return DEFAULT_RULES.map((base) => mergeRule(base, byKey.get(base.key)));
}

export function effectiveRulesForEvent(
  eventType: string,
  overrides: TenantRuleOverride[],
): EffectiveRule[] {
  return effectiveRules(overrides).filter((r) => r.eventType === eventType);
}

export interface TenantTemplateOverride {
  key: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  emailSubject: string | null;
  emailBody: string | null;
  isActive: boolean;
}

export interface EffectiveTemplate {
  key: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
  requiredVars: string[];
  overridden: boolean;
}

export function mergeTemplate(
  templateKey: string,
  channel: NotificationChannel,
  override: TenantTemplateOverride | undefined,
): EffectiveTemplate | undefined {
  const base = TEMPLATE_BY_KEY.get(templateKey);
  if (!base) return undefined;
  if (!override || !override.isActive) {
    return {
      key: base.key,
      channel,
      title: base.title,
      body: base.body,
      emailSubject: base.emailSubject,
      emailBody: base.emailBody,
      requiredVars: base.requiredVars,
      overridden: false,
    };
  }
  return {
    key: base.key,
    channel,
    title: override.title,
    body: override.body,
    emailSubject: override.emailSubject ?? base.emailSubject,
    emailBody: override.emailBody ?? base.emailBody,
    requiredVars: collectVariables(override.title, override.body),
    overridden: true,
  };
}
