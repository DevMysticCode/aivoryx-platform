'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useCreateCustomField, useCustomFields } from '@/lib/crm/use-crm';
import { useFieldAgents, useScheduleVisit, useVisits } from '@/lib/field/use-field';
import {
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/admin/ui';

const STATUSES = ['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const SURVEY_DATA_TYPES = ['text', 'number', 'boolean', 'date', 'select'] as const;

export default function VisitsPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const visits = useVisits({ status: status || undefined, page, pageSize });
  const fieldAgents = useFieldAgents();
  const scheduleVisit = useScheduleVisit();

  const [leadId, setLeadId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [assignedMembershipId, setAssignedMembershipId] = useState('');

  const surveyFields = useCustomFields('visit');
  const createSurveyField = useCreateCustomField();
  const [surveyKey, setSurveyKey] = useState('');
  const [surveyLabel, setSurveyLabel] = useState('');
  const [surveyType, setSurveyType] = useState<(typeof SURVEY_DATA_TYPES)[number]>('text');
  const [surveyOptions, setSurveyOptions] = useState('');
  const [surveyRequired, setSurveyRequired] = useState(false);

  const totalPages = visits.data ? Math.max(1, Math.ceil(visits.data.total / pageSize)) : 1;

  return (
    <section className="space-y-6">
      <PageHeader title="Site visits" description="Schedule, assign, and track field visits." />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Schedule a visit</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!leadId || !scheduledAt) return;
            const visit = await scheduleVisit.mutateAsync({
              leadId,
              scheduledAt: new Date(scheduledAt).toISOString(),
              assignedMembershipId: assignedMembershipId || undefined,
            });
            setLeadId('');
            setScheduledAt('');
            setAssignedMembershipId('');
            router.push(`/crm/visits/${visit.id}`);
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          <Field
            label="Lead id"
            hint="Paste the lead's id from its detail page"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
          />
          <Field
            label="Scheduled for"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Assign to (optional)</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={assignedMembershipId}
              onChange={(e) => setAssignedMembershipId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {(fieldAgents.data ?? [])
                .filter((a) => a.status === 'active')
                .map((a) => (
                  <option key={a.membershipId} value={a.membershipId}>
                    {a.userName ?? a.userEmail}
                  </option>
                ))}
            </select>
          </label>
          <Button type="submit" disabled={scheduleVisit.isPending || !leadId || !scheduledAt}>
            {scheduleVisit.isPending ? 'Scheduling…' : 'Schedule'}
          </Button>
        </form>
        <ErrorNote error={scheduleVisit.error} />
      </Card>

      <Card className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <span className="text-sm text-muted-foreground">
            {visits.data ? `${visits.data.total} visit${visits.data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </Card>

      {visits.isLoading ? (
        <Skeleton rows={6} />
      ) : visits.error ? (
        <ErrorNote error={visits.error} />
      ) : visits.data && visits.data.items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Scheduled</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visits.data.items.map((visit) => (
                  <tr key={visit.id} className="hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <Link
                        href={`/crm/visits/${visit.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {visit.leadName ?? visit.leadPhone ?? 'Lead'}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={visit.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(visit.scheduledAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {visit.assignee
                        ? (visit.assignee.name ?? visit.assignee.email)
                        : 'Unassigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <EmptyState>No visits match these filters yet.</EmptyState>
      )}

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Site survey questions</h2>
        <p className="text-xs text-muted-foreground">
          Tenant-configurable fields field agents fill in on-site — the same custom-field engine
          used for leads (ADR 0033), not a form builder.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!surveyKey || !surveyLabel) return;
            await createSurveyField.mutateAsync({
              key: surveyKey,
              label: surveyLabel,
              dataType: surveyType,
              isRequired: surveyRequired,
              options:
                surveyType === 'select'
                  ? surveyOptions
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean)
                  : undefined,
              entity: 'visit',
            });
            setSurveyKey('');
            setSurveyLabel('');
            setSurveyOptions('');
            setSurveyRequired(false);
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end"
        >
          <Field
            label="Key"
            placeholder="roof_type"
            value={surveyKey}
            onChange={(e) => setSurveyKey(e.target.value)}
          />
          <Field
            label="Label"
            placeholder="Roof type"
            value={surveyLabel}
            onChange={(e) => setSurveyLabel(e.target.value)}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Type</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={surveyType}
              onChange={(e) => setSurveyType(e.target.value as (typeof SURVEY_DATA_TYPES)[number])}
            >
              {SURVEY_DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={surveyRequired}
              onChange={(e) => setSurveyRequired(e.target.checked)}
            />
            Required
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={createSurveyField.isPending || !surveyKey || !surveyLabel}
          >
            Add question
          </Button>
          {surveyType === 'select' ? (
            <div className="sm:col-span-5">
              <Field
                label="Options (comma-separated)"
                value={surveyOptions}
                onChange={(e) => setSurveyOptions(e.target.value)}
              />
            </div>
          ) : null}
        </form>
        <ErrorNote error={createSurveyField.error} />
        {surveyFields.data && surveyFields.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {surveyFields.data.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between border-b py-1 last:border-b-0"
              >
                <span>
                  {f.label} <span className="text-xs text-muted-foreground">({f.key})</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {f.dataType}
                  {f.isRequired ? ' · required' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No survey questions defined yet.</p>
        )}
      </Card>
    </section>
  );
}
