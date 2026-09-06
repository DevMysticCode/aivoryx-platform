'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { Card, EmptyState, ErrorNote, Skeleton, PageHeader } from '@/components/admin/ui';
import { fmtMoney, fmtDate, SupplyStatusBadge } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useCreditNote, useCreditNoteAction } from '@/lib/finance/use-finance';

export default function CreditNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const q = useCreditNote(id);
  const actions = useCreditNoteAction(id);

  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <EmptyState>Credit note not found.</EmptyState>;
  const cn = q.data;

  const canIssue = perms.includes('finance.credit_notes.issue') && cn.status === 'DRAFT';
  const canCancel =
    perms.includes('finance.credit_notes.cancel') && ['DRAFT', 'ISSUED'].includes(cn.status);

  return (
    <div className="space-y-6">
      <PageHeader title={cn.number} description={cn.customerName ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <SupplyStatusBadge status={cn.status} />
          {canIssue && (
            <Button
              size="sm"
              onClick={() => actions.issue.mutate()}
              disabled={actions.issue.isPending}
            >
              {actions.issue.isPending ? 'Issuing…' : 'Issue'}
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('Cancel this credit note?')) actions.cancel.mutate();
              }}
              disabled={actions.cancel.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </PageHeader>

      <ErrorNote error={actions.issue.error ?? actions.cancel.error} />

      <Card className="space-y-1 text-sm">
        <Row label="Amount" value={`${fmtMoney(cn.amount)} ${cn.currency}`} />
        <Row label="Reason" value={cn.reason} />
        <Row label="Issue date" value={fmtDate(cn.issueDate)} />
        {cn.invoiceId && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice</span>
            <Link href={`/finance/invoices/${cn.invoiceId}`} className="text-primary">
              {cn.invoiceNumber ?? cn.invoiceId.slice(0, 8)}
            </Link>
          </div>
        )}
        {cn.notes && (
          <p className="border-t pt-2 text-muted-foreground whitespace-pre-wrap">{cn.notes}</p>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        An issued credit note reduces the linked invoice’s receivable. To correct one, cancel it and
        raise a new one.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
