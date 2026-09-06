/**
 * Contextual help copy, versioned in code (Phase 10, ADR 0039). No CMS: changing
 * help ships as a normal code change and review. Keep entries concise — one or
 * two sentences plus, where useful, an ordered list of first steps.
 */

export interface HelpEntry {
  /** short screen title used as the guidance heading */
  title: string;
  /** what this screen is for and why it matters */
  body: string;
  /** optional first-run steps */
  steps?: { title: string; detail?: string }[];
  /** optional primary next action */
  action?: { label: string; href: string };
}

export const HELP_CONTENT = {
  'crm-leads': {
    title: 'Working leads',
    body: 'Leads arrive here from your website, ad platforms and manual entry. Assign each lead to a telecaller, then qualify or disqualify it after contact.',
    steps: [
      { title: 'Assign the lead', detail: 'pick an available telecaller' },
      { title: 'Log the call outcome', detail: 'record what the prospect said' },
      { title: 'Qualify or disqualify', detail: 'qualified leads move to a site visit' },
    ],
  },
  'field-visits': {
    title: 'Site visits',
    body: 'Visits capture what your team saw on site — photos, measurements and notes — even with no signal. Drafts sync when the device is back online.',
  },
  procurement: {
    title: 'Purchase orders',
    body: 'Raise purchase orders against suppliers, send them for approval, and track what has been received. Approved orders feed goods-in at the warehouse.',
  },
  inventory: {
    title: 'Inventory',
    body: 'Track products, stock on hand per warehouse, and suppliers. Stock levels update from goods receipts and dispatches — they are not edited by hand.',
  },
  quotations: {
    title: 'Quotations',
    body: 'Build a priced quotation for a customer, revise it as the scope changes, and send it for acceptance. An accepted quotation can be booked into a project.',
    steps: [
      { title: 'Add line items', detail: 'products, quantities and pricing' },
      { title: 'Send for acceptance' },
      { title: 'Book the project', detail: 'creates the delivery project' },
    ],
  },
  projects: {
    title: 'Projects',
    body: 'A project is the delivery of a booked quotation: installation, quality checks and handover. Status reflects real progress reported by your team.',
  },
  finance: {
    title: 'Finance',
    body: 'Operational invoicing and payments — not a full accounting system. Issue invoices, record customer payments, allocate them, and raise credit notes.',
    steps: [
      { title: 'Issue an invoice', detail: 'freezes its amounts' },
      { title: 'Record the payment' },
      { title: 'Allocate payment to invoices' },
    ],
  },
  notifications: {
    title: 'Notifications',
    body: 'Choose how you are notified. System-critical alerts are always delivered regardless of these preferences.',
  },
  'settings-company': {
    title: 'Company profile & branding',
    body: 'Your company details, logo and brand colour appear in the app, on your documents (quotations, invoices, receipts) and in notification emails. They never change security, tenancy or permissions.',
  },
} satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof HELP_CONTENT;

export function help(key: HelpKey): HelpEntry {
  return HELP_CONTENT[key];
}
