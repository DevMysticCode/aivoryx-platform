'use client';

import type { ModuleKey } from '@aivoryx/shared';
import type { ChartData } from '@/components/charts/chart-model';
import type { RangeOption } from '@/components/charts/interactive-chart';
import { useCrmAnalytics } from '@/lib/crm/use-crm-analytics';
import { useHrDashboard } from '@/lib/hr/use-hr';

/**
 * Reports that have a meaningful standalone representation (Phase 19). A report
 * is a chart definition — a title, the module + permission that gate it, and a
 * data hook returning an already-authorised dataset. The dashboard widget and the
 * dedicated `/reports/[id]` page render the SAME definition through
 * `<ReportChart>`, so there is no second copy of the logic. The API remains the
 * authority: the data hooks call permissioned endpoints, and the page only
 * decides whether to *offer* the report.
 */
export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  module: ModuleKey;
  permission: string;
  ranges?: RangeOption[];
  defaultRange?: number;
  useData: (range: number) => {
    data: ChartData | null;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
  };
}

const CRM_RANGES: RangeOption[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];
const asDays = (n: number): 7 | 30 | 90 => (n === 7 || n === 90 ? n : 30);

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
};

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const REPORTS: ReportDefinition[] = [
  {
    id: 'crm-lead-trend',
    title: 'Lead activity',
    description: 'Leads created per day.',
    module: 'CRM',
    permission: 'crm.leads.read',
    ranges: CRM_RANGES,
    defaultRange: 30,
    useData: (range) => {
      const q = useCrmAnalytics(asDays(range));
      return {
        data: q.data
          ? {
              shape: 'timeseries',
              points: q.data.trend.map((p) => ({ label: shortDate(p.date), value: p.count })),
            }
          : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'crm-pipeline',
    title: 'Pipeline by stage',
    description: 'Open and converted leads at each stage.',
    module: 'CRM',
    permission: 'crm.leads.read',
    useData: () => {
      const q = useCrmAnalytics(30);
      return {
        data: q.data
          ? {
              shape: 'categorical',
              points: q.data.funnel.map((s) => ({
                label: STAGE_LABEL[s.stage] ?? s.stage,
                value: s.count,
              })),
            }
          : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'crm-lead-sources',
    title: 'Leads by source',
    description: 'Where your leads come from.',
    module: 'CRM',
    permission: 'crm.leads.read',
    ranges: CRM_RANGES,
    defaultRange: 30,
    useData: (range) => {
      const q = useCrmAnalytics(asDays(range));
      return {
        data: q.data
          ? {
              shape: 'categorical',
              points: q.data.sources.map((s) => ({ label: s.sourceName, value: s.total })),
            }
          : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'crm-conversion-rate',
    title: 'Lead conversion',
    description: 'Share of new leads that reached Converted (as reported by the CRM funnel).',
    module: 'CRM',
    permission: 'crm.leads.read',
    useData: () => {
      const q = useCrmAnalytics(30);
      const converted = q.data?.funnel.find((s) => s.stage === 'CONVERTED');
      const first = q.data?.funnel[0]?.count ?? 0;
      const rate = converted?.conversionFromStart ?? null;
      return {
        data:
          rate === null
            ? null
            : {
                shape: 'target',
                label: 'New → converted',
                value: rate,
                min: 0,
                max: 100,
                unit: '%',
                secondary: `${converted?.count ?? 0} of ${first} new leads`,
              },
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'hr-attendance-trend',
    title: 'Attendance trend',
    description: 'Employees present per day over the last 14 days.',
    module: 'HR',
    permission: 'hr.employee.read',
    useData: () => {
      const q = useHrDashboard();
      return {
        data: q.data
          ? {
              shape: 'timeseries',
              points: q.data.attendanceTrend.map((d) => ({
                label: shortDate(d.date),
                value: d.present,
              })),
            }
          : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'hr-department-headcount',
    title: 'Headcount by department',
    description: 'Active employees per department.',
    module: 'HR',
    permission: 'hr.employee.read',
    useData: () => {
      const q = useHrDashboard();
      return {
        data: q.data
          ? {
              shape: 'categorical',
              points: q.data.departmentDistribution.map((d) => ({ label: d.name, value: d.count })),
            }
          : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
  {
    id: 'hr-attendance-rate',
    title: 'Attendance today',
    description: 'Employees present today as a share of active employees.',
    module: 'HR',
    permission: 'hr.employee.read',
    useData: () => {
      const q = useHrDashboard();
      const d = q.data;
      return {
        data:
          d && d.activeEmployees > 0
            ? {
                shape: 'target',
                label: 'Attendance today',
                value: Math.round((d.presentToday / d.activeEmployees) * 100),
                min: 0,
                max: 100,
                unit: '%',
                secondary: `${d.presentToday} of ${d.activeEmployees} active employees`,
              }
            : null,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      };
    },
  },
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export const reportHref = (id: string) => `/reports/${id}`;
