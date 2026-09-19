/**
 * Short feature tours (Phase 19) — 3 to 5 steps each, always skippable, always
 * re-runnable from the Help Center. A step may point at an element via a
 * `data-tour="…"` attribute; if the element is not on screen (or the module is
 * not available to this user) the step is shown without a highlight, never
 * skipped silently or blocked.
 */
export interface TourStep {
  title: string;
  body: string;
  /** value of a `data-tour` attribute to highlight */
  target?: string;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: 'workspace',
    title: 'Getting around Aivoryx',
    description: 'A 30-second look at the navigation, search and help.',
    steps: [
      {
        title: 'Your modules',
        body: 'The sidebar lists the modules your company has enabled and your access allows. You can collapse it to a narrow rail.',
        target: 'sidebar',
      },
      {
        title: 'Search and jump',
        body: 'Press Ctrl/Cmd+K to search leads and customers or jump to any screen.',
        target: 'search',
      },
      {
        title: 'Appearance',
        body: 'Choose Light, Dark or System from the account menu. Your choice is remembered on this device.',
        target: 'account',
      },
      {
        title: 'Help is one click away',
        body: 'Open Help for short guides, or restart this tour at any time.',
        target: 'help',
      },
    ],
  },
  {
    id: 'crm-leads',
    title: 'Working your leads',
    description: 'From a new lead to a scheduled site visit.',
    steps: [
      {
        title: 'Filter and search',
        body: 'Use the search and filters to focus on the leads that need attention.',
        target: 'lead-filters',
      },
      {
        title: 'Open a lead',
        body: 'A lead shows its next action, activity, visits and quotations in one place.',
      },
      {
        title: 'Schedule a visit',
        body: 'Qualified leads can be sent to Field Operations for a site visit; the outcome comes back to the lead.',
      },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

export const START_TOUR_EVENT = 'aivoryx:start-tour';

/** Ask the mounted <FeatureTourHost> to run a tour. */
export function startTour(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: { id } }));
}
