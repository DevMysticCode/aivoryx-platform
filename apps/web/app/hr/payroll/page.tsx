'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { HrStatusBadge, TextField, money, fmtDate } from '@/components/hr/ui';
import { usePayrollPeriods, useCreatePayrollPeriod } from '@/lib/hr/use-hr';

export default function PayrollPage() {
  const perms = usePermissions();
  const canManage = perms.includes('hr.payroll.manage');
  const list = usePayrollPeriods();
  const create = useCreatePayrollPeriod();

  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    name: '',
    periodStart: '',
    periodEnd: '',
    payDate: '',
    currency: 'INR',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Operational payroll. Finalizing freezes an immutable snapshot per employee."
      >
        {canManage && (
          <Button size="sm" onClick={() => setShow((v) => !v)}>
            {show ? 'Close' : 'New period'}
          </Button>
        )}
      </PageHeader>

      {show && canManage && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            hint="e.g. October 2026"
          />
          <TextField
            label="Start"
            type="date"
            value={form.periodStart}
            onChange={(e) => set('periodStart', e.target.value)}
          />
          <TextField
            label="End"
            type="date"
            value={form.periodEnd}
            onChange={(e) => set('periodEnd', e.target.value)}
          />
          <TextField
            label="Pay date"
            type="date"
            value={form.payDate}
            onChange={(e) => set('payDate', e.target.value)}
          />
          <TextField
            label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || !form.periodStart || !form.periodEnd || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    periodStart: form.periodStart,
                    periodEnd: form.periodEnd,
                    payDate: form.payDate || undefined,
                    currency: form.currency || undefined,
                  },
                  { onSuccess: () => setShow(false) },
                )
              }
            >
              Create
            </Button>
          </div>
          {create.error && (
            <div className="lg:col-span-5">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}

      {list.isLoading && <Skeleton rows={4} />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Window</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Employees</th>
              <th className="px-3 py-2">Gross</th>
              <th className="px-3 py-2">Net</th>
              <th className="px-3 py-2">Paid / Pending</th>
            </tr>
          }
        >
          {list.data.items.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2">
                <Link
                  href={`/hr/payroll/${p.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {p.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
              </td>
              <td className="px-3 py-2">
                <HrStatusBadge status={p.status} />
              </td>
              <td className="px-3 py-2 tabular-nums">{p.employeeCount}</td>
              <td className="px-3 py-2 tabular-nums">{money(p.grossTotal, p.currency)}</td>
              <td className="px-3 py-2 font-medium tabular-nums">
                {money(p.netTotal, p.currency)}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {p.paidCount} / {p.pendingCount}
                {p.failedCount > 0 && (
                  <span className="ml-1 text-destructive">({p.failedCount} failed)</span>
                )}
              </td>
            </tr>
          ))}
          {list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                No payroll periods yet.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}
