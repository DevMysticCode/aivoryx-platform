'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { ReportChart } from '@/components/charts/report-chart';
import { useAccess } from '@/lib/navigation/use-access';
import { getReport } from '@/lib/reports/registry';

/**
 * The standalone report view (Phase 19): the SAME report definition the
 * dashboard widget renders, in a dedicated full-width context that suits
 * "open in new tab". Offered only when the workspace has the module and the
 * user holds the report's permission; the API enforces both regardless.
 */
export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const access = useAccess();
  const def = getReport(id);

  if (access.isLoading) return <LoadingBlock />;

  if (!def || !access.hasModule(def.module) || !access.can(def.permission)) {
    return (
      <ErrorBlock
        error={new Error('This report is not available in your workspace or to your account.')}
        title="Report unavailable"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={def.title} description={def.description}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Dashboard
        </Link>
      </PageHeader>
      <section className="rounded-lg border bg-surface p-4 sm:p-6">
        <ReportChart id={def.id} standalone />
      </section>
    </div>
  );
}
