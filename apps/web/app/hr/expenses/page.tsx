'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table, Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import type { HrExpenseClaim } from '@aivoryx/contracts';
import { HrStatusBadge, TextField, TabBar, money, fmtDate } from '@/components/hr/ui';
import {
  useExpenseCategories,
  useMyExpenseClaims,
  useExpenseClaims,
  useCreateExpenseCategory,
  useCreateExpenseClaim,
} from '@/lib/hr/use-hr';

type Tab = 'mine' | 'approvals' | 'reimbursements' | 'categories';

export default function ExpensesPage() {
  const perms = usePermissions();
  const canApprove = perms.includes('hr.expense.approve');
  const canReimburse = perms.includes('hr.expense.reimburse');
  const canManage = perms.includes('hr.expense.manage');
  const [tab, setTab] = useState<Tab>('mine');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mine', label: 'My claims' },
    ...(canApprove ? ([{ key: 'approvals', label: 'Approval queue' }] as const) : []),
    ...(canReimburse ? ([{ key: 'reimbursements', label: 'Reimbursements' }] as const) : []),
    { key: 'categories', label: 'Categories' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Claims → approval → reimbursement. HR owns the claim; Finance owns settlement."
      />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'mine' && <MyClaims />}
      {tab === 'approvals' && canApprove && (
        <ClaimList status="SUBMITTED" title="Awaiting approval" />
      )}
      {tab === 'reimbursements' && canReimburse && (
        <ClaimList status="APPROVED" title="Approved — awaiting reimbursement" />
      )}
      {tab === 'categories' && <Categories canManage={canManage} />}
    </div>
  );
}

function MyClaims() {
  const cats = useExpenseCategories();
  const mine = useMyExpenseClaims();
  const create = useCreateExpenseClaim();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    categoryId: '',
    expenseDate: '',
    amount: '',
    description: '',
    merchant: '',
    distanceKm: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setShow((v) => !v)}>
        {show ? 'Close' : 'New claim'}
      </Button>
      {show && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">—</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.defaultMileageRate ? ` (mileage ${c.defaultMileageRate}/km)` : ''}
              </option>
            ))}
          </Select>
          <TextField
            label="Expense date"
            type="date"
            value={form.expenseDate}
            onChange={(e) => set('expenseDate', e.target.value)}
          />
          <TextField
            label="Amount"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
          <TextField
            label="Merchant"
            value={form.merchant}
            onChange={(e) => set('merchant', e.target.value)}
          />
          <TextField
            label="Distance (km)"
            value={form.distanceKm}
            onChange={(e) => set('distanceKm', e.target.value)}
            hint="For mileage categories"
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.categoryId || !form.expenseDate || !form.amount || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    categoryId: form.categoryId,
                    expenseDate: form.expenseDate,
                    amount: form.amount,
                    description: form.description || undefined,
                    merchant: form.merchant || undefined,
                    distanceKm: form.distanceKm || undefined,
                  },
                  { onSuccess: () => setShow(false) },
                )
              }
            >
              Create draft
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-2 lg:col-span-3">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {mine.isLoading && <Skeleton rows={4} />}
      {mine.error && <ErrorNote error={mine.error} />}
      {mine.data && <ClaimTable rows={mine.data.items} />}
    </div>
  );
}

function ClaimList({ status, title }: { status: string; title: string }) {
  const q = useExpenseClaims({ status, pageSize: 50 });
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      {q.isLoading && <Skeleton rows={4} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && <ClaimTable rows={q.data.items} withEmployee />}
    </div>
  );
}

function ClaimTable({ rows, withEmployee }: { rows: HrExpenseClaim[]; withEmployee?: boolean }) {
  return (
    <Table
      head={
        <tr>
          <th className="px-3 py-2">Number</th>
          {withEmployee && <th className="px-3 py-2">Employee</th>}
          <th className="px-3 py-2">Category</th>
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Amount</th>
          <th className="px-3 py-2">Reimbursable</th>
          <th className="px-3 py-2">Status</th>
        </tr>
      }
    >
      {rows.map((c) => (
        <tr key={c.id}>
          <td className="px-3 py-2">
            <Link href={`/hr/expenses/${c.id}`} className="text-primary hover:underline">
              {c.claimNumber}
            </Link>
          </td>
          {withEmployee && (
            <td className="px-3 py-2">
              {c.employeeName}{' '}
              <span className="text-xs text-muted-foreground">{c.employeeNumber}</span>
            </td>
          )}
          <td className="px-3 py-2">{c.categoryName}</td>
          <td className="px-3 py-2">{fmtDate(c.expenseDate)}</td>
          <td className="px-3 py-2 tabular-nums">{money(c.amount, c.currency)}</td>
          <td className="px-3 py-2 tabular-nums">
            {money(c.approvedAmount ?? c.reimbursementAmount, c.currency)}
          </td>
          <td className="px-3 py-2">
            <HrStatusBadge status={c.status} />
          </td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
            No claims.
          </td>
        </tr>
      )}
    </Table>
  );
}

function Categories({ canManage }: { canManage: boolean }) {
  const cats = useExpenseCategories();
  const create = useCreateExpenseCategory();
  const [form, setForm] = useState({ name: '', code: '', defaultMileageRate: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-4">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Code" value={form.code} onChange={(e) => set('code', e.target.value)} />
          <TextField
            label="Mileage rate / km"
            value={form.defaultMileageRate}
            onChange={(e) => set('defaultMileageRate', e.target.value)}
            hint="Leave blank for a normal category"
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || !form.code || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    code: form.code,
                    defaultMileageRate: form.defaultMileageRate || undefined,
                  },
                  { onSuccess: () => setForm({ name: '', code: '', defaultMileageRate: '' }) },
                )
              }
            >
              Add
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {cats.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Mileage rate</th>
              <th className="px-3 py-2">Receipt</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {cats.data.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{c.code}</td>
              <td className="px-3 py-2 tabular-nums">{c.defaultMileageRate ?? '—'}</td>
              <td className="px-3 py-2">{c.requiresReceipt ? 'Required' : 'Optional'}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
