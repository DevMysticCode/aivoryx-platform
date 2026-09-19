import { webEnv } from '@/lib/env';

/**
 * Help topics (Phase 19). Each topic is addressable by a stable key and maps to
 * a path on the EXTERNAL documentation site (`NEXT_PUBLIC_HELP_BASE_URL`, e.g.
 * help.aivoryx.com). Nothing here assumes a domain: when the base URL is not
 * configured, `helpUrl()` returns null and the UI simply omits the link — the
 * Help Center still shows the in-app summary. Adding a topic is a one-line change.
 */
export type HelpCategory =
  | 'Getting started'
  | 'CRM'
  | 'Field Operations'
  | 'HR & Workforce'
  | 'Finance'
  | 'Administration';

export interface HelpTopic {
  category: HelpCategory;
  title: string;
  summary: string;
  /** path under the docs site: `crm/leads/managing-leads` */
  path: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
  'Getting started',
  'CRM',
  'Field Operations',
  'HR & Workforce',
  'Finance',
  'Administration',
];

export const HELP_TOPICS = {
  'start.workspace': {
    category: 'Getting started',
    title: 'Set up your workspace',
    summary: 'Add your company details, invite your team and choose what each person can see.',
    path: 'getting-started/workspace',
  },
  'start.navigation': {
    category: 'Getting started',
    title: 'Finding your way around',
    summary:
      'The sidebar lists the modules your company has enabled and your access allows. Press Ctrl/Cmd+K to jump anywhere.',
    path: 'getting-started/navigation',
  },
  'crm.leads': {
    category: 'CRM',
    title: 'Managing leads',
    summary:
      'Leads are prospects in your sales pipeline. Assign an owner, log calls, and qualify or disqualify after contact.',
    path: 'crm/leads/managing-leads',
  },
  'crm.followups': {
    category: 'CRM',
    title: 'Follow-ups',
    summary: 'Follow-ups keep every open lead moving: each has an owner and a due date.',
    path: 'crm/leads/follow-ups',
  },
  'field.visits': {
    category: 'Field Operations',
    title: 'Site visits and outcomes',
    summary:
      'Schedule a visit from a lead, capture findings on site, and record the outcome so the office knows what happens next.',
    path: 'field/visits',
  },
  'hr.leave': {
    category: 'HR & Workforce',
    title: 'Approving leave',
    summary: "Leave requests go to the employee's manager; approvers see them under Leave.",
    path: 'hr/leave/approving-leave',
  },
  'hr.attendance': {
    category: 'HR & Workforce',
    title: 'Attendance and clock in/out',
    summary: 'Employees clock in and out from My HR; managers review corrections.',
    path: 'hr/attendance',
  },
  'finance.invoices': {
    category: 'Finance',
    title: 'Invoices and payments',
    summary: 'Issue an invoice to freeze its amounts, record payments and allocate them.',
    path: 'finance/invoices',
  },
  'admin.data-scope': {
    category: 'Administration',
    title: 'Data scope',
    summary:
      "Data scope controls which records a person can access: their own, their team's, a department's or the whole company.",
    path: 'administration/data-scope',
  },
  'admin.access': {
    category: 'Administration',
    title: 'Profiles and permission sets',
    summary: "A profile is a person's base access; permission sets add capabilities on top.",
    path: 'administration/profiles-and-permission-sets',
  },
  'admin.branding': {
    category: 'Administration',
    title: 'Branding and themes',
    summary: 'Choose a theme, upload your logos and control how your documents look.',
    path: 'administration/branding',
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof HELP_TOPICS;

const base = (): string | null => webEnv.NEXT_PUBLIC_HELP_BASE_URL?.replace(/\/+$/, '') ?? null;

/** Deep link to a topic on the docs site, or null when no docs site is configured. */
export function helpUrl(key: HelpTopicKey): string | null {
  const b = base();
  return b ? `${b}/${HELP_TOPICS[key].path}` : null;
}

/** The docs site home (Documentation entry), or null when not configured. */
export function docsHomeUrl(): string | null {
  return base();
}

export function supportMailto(): string | null {
  const e = webEnv.NEXT_PUBLIC_SUPPORT_EMAIL;
  return e ? `mailto:${e}` : null;
}

export function searchHelpTopics(query: string): { key: HelpTopicKey; topic: HelpTopic }[] {
  const q = query.trim().toLowerCase();
  const all = (Object.keys(HELP_TOPICS) as HelpTopicKey[]).map((key) => ({
    key,
    topic: HELP_TOPICS[key] as HelpTopic,
  }));
  if (!q) return all;
  return all.filter(({ topic }) =>
    `${topic.title} ${topic.summary} ${topic.category}`.toLowerCase().includes(q),
  );
}

const PATH_TOPICS: [prefix: string, key: HelpTopicKey][] = [
  ['/crm/visits', 'field.visits'],
  ['/field', 'field.visits'],
  ['/crm', 'crm.leads'],
  ['/hr/leave', 'hr.leave'],
  ['/hr', 'hr.attendance'],
  ['/finance', 'finance.invoices'],
  ['/admin/access', 'admin.access'],
  ['/admin', 'admin.data-scope'],
  ['/settings/branding', 'admin.branding'],
  ['/', 'start.navigation'],
];

/** The help topic that best matches the current route (used by the Help Center). */
export function helpTopicForPath(pathname: string): HelpTopicKey {
  return PATH_TOPICS.find(([p]) => (p === '/' ? true : pathname.startsWith(p)))![1];
}
