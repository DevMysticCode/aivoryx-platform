'use client';

import { useMemo } from 'react';
import { useAccess } from './use-access';

/**
 * Which cross-module links and actions to OFFER the user (Phase 18). Every flag
 * needs BOTH the module entitlement and the permission of the module that owns
 * the destination — so having CRM never implies Field, and vice versa. This only
 * decides what to show: the API re-checks tenant + entitlement + permission +
 * data scope on every request, and answers 404 (never 403) for a record the
 * caller may not see, so a hidden link is convenience, not security.
 */
export interface CrossModuleAccess {
  /** open a CRM lead */
  crmLeads: boolean;
  /** see Field visits (lists, detail) */
  fieldVisits: boolean;
  /** schedule a Field visit from a lead — Field create, plus CRM lead access where CRM is enabled */
  scheduleVisit: boolean;
  /** pick a field agent when scheduling */
  assignAgent: boolean;
  /** see quotations */
  quotations: boolean;
  /** create a quotation for a lead — quotations.create, plus CRM lead access where CRM is enabled */
  createQuotation: boolean;
  /** see customers */
  customers: boolean;
  /** see projects */
  projects: boolean;
}

export function useCrossModuleAccess(): CrossModuleAccess {
  const a = useAccess();
  return useMemo(() => {
    const crmLeads = a.hasModule('CRM') && a.can('crm.leads.read');
    return {
      crmLeads,
      fieldVisits: a.hasModule('FIELD') && a.can('field.visits.read'),
      // where CRM is enabled the API also requires CRM lead access; where it is not, Field stands alone
      scheduleVisit:
        a.hasModule('FIELD') && a.can('field.visits.create') && (!a.hasModule('CRM') || crmLeads),
      assignAgent: a.hasModule('FIELD') && a.can('field.agents.manage'),
      quotations: a.hasModule('COMMERCIAL') && a.can('quotations.read'),
      createQuotation:
        a.hasModule('COMMERCIAL') &&
        a.can('quotations.create') &&
        (!a.hasModule('CRM') || crmLeads),
      customers: a.hasModule('COMMERCIAL') && a.can('customers.read'),
      projects: a.can('projects.read'),
    };
  }, [a]);
}
