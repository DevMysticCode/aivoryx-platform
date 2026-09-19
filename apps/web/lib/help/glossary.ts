import type { HelpTopicKey } from './topics';

/** Definitions surfaced by <ContextualHelp> — one source, reused wherever a concept appears. */
export interface GlossaryEntry {
  title: string;
  intro?: string;
  items: { term: string; description: string }[];
  topic?: HelpTopicKey;
}

export const GLOSSARY = {
  dataScope: {
    title: 'Data scope',
    intro: 'Controls which records this user can access.',
    items: [
      { term: 'Own', description: 'Records assigned to the user.' },
      { term: 'Team', description: 'The user and their direct reports.' },
      { term: 'Department', description: "Records in the user's department." },
      { term: 'Company', description: 'All accessible records in the company.' },
    ],
    topic: 'admin.data-scope',
  },
  profile: {
    title: 'Profile',
    intro: "A person's base access. Every member has exactly one.",
    items: [
      { term: 'Permission sets', description: 'Add extra capabilities on top of the profile.' },
      { term: 'Modules', description: 'Only modules your company has enabled can be granted.' },
    ],
    topic: 'admin.access',
  },
  visitOutcome: {
    title: 'Visit outcome',
    items: [
      { term: 'Suitable', description: 'A good fit, ready for a quotation.' },
      { term: 'Not suitable', description: 'The site or customer is not a fit.' },
      { term: 'Follow-up required', description: 'Creates a follow-up for the lead owner in CRM.' },
    ],
    topic: 'field.visits',
  },
  quotationStates: {
    title: 'Quotation status',
    items: [
      { term: 'Draft', description: 'Being prepared, not yet visible to the customer.' },
      { term: 'Sent', description: 'Shared with the customer, awaiting a decision.' },
      { term: 'Accepted', description: 'Approved by the customer; can be booked into a project.' },
    ],
  },
  invoiceStates: {
    title: 'Invoice status',
    items: [
      {
        term: 'Draft',
        description: 'Being prepared. Lines can still be edited; the customer cannot pay it yet.',
      },
      {
        term: 'Issued',
        description: 'Sent to the customer and awaiting payment. Amounts can no longer be edited.',
      },
      {
        term: 'Partially paid',
        description: 'Some payments are allocated; a balance is still outstanding.',
      },
      { term: 'Paid', description: 'Fully settled by payments and credit notes.' },
      { term: 'Overdue', description: 'Past its due date with a balance outstanding.' },
      {
        term: 'Void',
        description: 'Cancelled. It no longer counts towards invoiced or outstanding totals.',
      },
    ],
  },
  leaveStates: {
    title: 'Leave status',
    items: [
      { term: 'Pending', description: 'Waiting for the approver.' },
      { term: 'Approved', description: 'Confirmed and deducted from the balance.' },
      { term: 'Rejected', description: 'Declined; the balance is unchanged.' },
    ],
    topic: 'hr.leave',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
