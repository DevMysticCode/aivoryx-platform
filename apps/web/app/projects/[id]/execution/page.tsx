'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { ChecklistItem, ExecutionView } from '@aivoryx/contracts';
import { fetchExecutionAttachmentBlob } from '@/lib/api/execution';
import { useMembers } from '@/lib/admin/use-admin';
import {
  useDeleteExecutionAttachment,
  useExecution,
  useExecutionActions,
  useExecutionAttachments,
  useQcInspection,
  useUploadExecutionAttachment,
} from '@/lib/execution/use-execution';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, Skeleton } from '@/components/admin/ui';
import { fmtDate, ProgressBar, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

const TABS = [
  'Overview',
  'Materials',
  'Installation',
  'QC',
  'Net Metering',
  'Handover',
  'Files',
] as const;
type Tab = (typeof TABS)[number];

export default function ProjectExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const can = (p: string) => perms.includes(p);

  const exec = useExecution(id);
  const actions = useExecutionActions(id);
  const [tab, setTab] = useState<Tab>('Overview');

  if (exec.isLoading) return <Skeleton rows={10} />;
  if (exec.error) return <ErrorNote error={exec.error} />;
  if (!exec.data) return <EmptyState>Project not found.</EmptyState>;
  const v = exec.data;

  if (!v.executionStarted) {
    return (
      <section className="space-y-6">
        <Header v={v} />
        <Card className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Execution has not been started for this project. Starting it creates the milestone
            checklist and the installation, net-metering and handover workflow records.
          </p>
          {can('projects.execution.update') ? (
            <Button onClick={() => actions.start.mutate()} disabled={actions.start.isPending}>
              {actions.start.isPending ? 'Starting…' : 'Start execution'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask a project manager to start execution.
            </p>
          )}
          <ErrorNote error={actions.start.error} />
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Header v={v} />
      <ProgressStrip v={v} />

      <nav className="flex flex-wrap gap-1 border-b pb-2 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              'rounded-md px-3 py-1.5 transition-colors ' +
              (tab === t
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')
            }
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Overview' && <OverviewTab v={v} can={can} actions={actions} />}
      {tab === 'Materials' && <MaterialsTab v={v} projectId={id} can={can} actions={actions} />}
      {tab === 'Installation' && (
        <InstallationTab v={v} projectId={id} can={can} actions={actions} />
      )}
      {tab === 'QC' && <QcTab v={v} projectId={id} can={can} actions={actions} />}
      {tab === 'Net Metering' && <NetMeteringTab v={v} can={can} actions={actions} />}
      {tab === 'Handover' && <HandoverTab v={v} projectId={id} can={can} actions={actions} />}
      {tab === 'Files' && <FilesTab projectId={id} can={can} />}
    </section>
  );
}

type Actions = ReturnType<typeof useExecutionActions>;

function Header({ v }: { v: ExecutionView }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link href={`/projects/${v.projectId}`} className="hover:underline">
              {v.projectNumber}
            </Link>
          </h1>
          <SupplyStatusBadge status={v.projectStatus} />
        </div>
        <p className="text-sm text-muted-foreground">
          {v.customerName ?? v.leadName ?? 'Project'} · Execution workspace ·{' '}
          <Link href={`/crm/leads/${v.leadId}`} className="text-primary hover:underline">
            CRM lead
          </Link>
        </p>
      </div>
    </div>
  );
}

function ProgressStrip({ v }: { v: ExecutionView }) {
  const p = v.progress;
  return (
    <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ProgressBar label="Materials" value={p.materials} />
      <ProgressBar label="Installation" value={p.installation} />
      <ProgressBar label="QC" value={p.qc} />
      <ProgressBar label="Net metering" value={p.netMetering} />
      <ProgressBar label="Handover" value={p.handover} />
      <ProgressBar label="Overall" value={p.overall} />
    </Card>
  );
}

function OverviewTab({
  v,
  can,
  actions,
}: {
  v: ExecutionView;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  return (
    <div className="space-y-6">
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Milestones</h2>
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Milestone</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Completed</th>
              <th className="px-3 py-2" />
            </tr>
          }
        >
          {v.milestones.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 capitalize">{m.key.replace(/_/g, ' ').toLowerCase()}</td>
              <td className="px-3 py-2">
                <SupplyStatusBadge status={m.status} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {m.completedAt
                  ? `${fmtDate(m.completedAt)}${m.completedByName ? ` · ${m.completedByName}` : ''}`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {can('projects.execution.update') && m.status !== 'done' ? (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => actions.completeMilestone.mutate({ milestoneId: m.id })}
                  >
                    Mark done
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Project completion</h2>
        {v.completionMissing.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {v.completionMissing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            All requirements met — the project can be completed.
          </p>
        )}
        {can('projects.complete') ? (
          <Button
            onClick={() => actions.completeProject.mutate()}
            disabled={!v.canComplete || actions.completeProject.isPending}
          >
            {actions.completeProject.isPending ? 'Completing…' : 'Complete project'}
          </Button>
        ) : null}
        <ErrorNote error={actions.completeProject.error} />
      </Card>

      <DefectsCard v={v} can={can} actions={actions} />
    </div>
  );
}

function MaterialsTab({
  v,
  can,
  actions,
}: {
  v: ExecutionView;
  projectId: string;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const r = v.readiness;
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Material readiness</h2>
          <SupplyStatusBadge status={r.state} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ['Required', r.requiredQty],
              ['Allocated', r.allocatedQty],
              ['Dispatched', r.dispatchedQty],
              ['Delivered', r.deliveredQty],
            ] as const
          ).map(([label, val]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {r.shortLines} of {r.totalLines} material lines still short of the required quantity. Read
          live from Phase 5 inventory —{' '}
          <Link href={`/projects/${v.projectId}`} className="text-primary hover:underline">
            manage materials
          </Link>
          .
        </p>
      </Card>

      {v.installation &&
      !v.installation.materialOverride &&
      r.state !== 'READY' &&
      can('projects.execution.update') ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Override material readiness</h2>
          <p className="text-xs text-muted-foreground">
            Lets installation start before every material is delivered. Recorded against the
            installation with your name and this reason.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-w-[280px]"
            />
            <Button
              disabled={!reason || actions.override.isPending}
              onClick={() => actions.override.mutate({ reason })}
            >
              Apply override
            </Button>
          </div>
          <ErrorNote error={actions.override.error} />
        </Card>
      ) : null}

      {v.installation?.materialOverride ? (
        <Card>
          <p className="text-sm">
            <span className="font-medium">Material override in place.</span>{' '}
            <span className="text-muted-foreground">{v.installation.materialOverrideReason}</span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function InstallationTab({
  v,
  projectId,
  can,
  actions,
}: {
  v: ExecutionView;
  projectId: string;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const members = useMembers();
  const inst = v.installation;
  const [assignId, setAssignId] = useState('');
  const [notes, setNotes] = useState('');
  const [equipment, setEquipment] = useState('');

  if (!inst) return <EmptyState>No installation record.</EmptyState>;

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Installation</h2>
          <SupplyStatusBadge status={inst.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {inst.assignedName ? `Assigned to ${inst.assignedName}` : 'Not assigned'}
          {inst.startedAt ? ` · started ${fmtDate(inst.startedAt)}` : ''}
          {inst.completedAt ? ` · completed ${fmtDate(inst.completedAt)}` : ''}
        </p>

        {can('projects.installation.assign') &&
        (inst.status === 'UNASSIGNED' || inst.status === 'ASSIGNED') ? (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Assign to field agent"
              value={assignId}
              onChange={(e) => setAssignId(e.target.value)}
            >
              <option value="">Select member…</option>
              {(members.data ?? []).map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
            <Button
              disabled={!assignId || actions.assign.isPending}
              onClick={() => actions.assign.mutate({ membershipId: assignId })}
            >
              {inst.status === 'ASSIGNED' ? 'Reassign' : 'Assign'}
            </Button>
            {inst.status === 'ASSIGNED' ? (
              <Button variant="ghost" onClick={() => actions.unassign.mutate()}>
                Unassign
              </Button>
            ) : null}
          </div>
        ) : null}

        {can('projects.installation.update') && inst.status === 'ASSIGNED' ? (
          <Button
            onClick={() => actions.startInstallation.mutate({})}
            disabled={actions.startInstallation.isPending}
          >
            Start installation
          </Button>
        ) : null}
        <ErrorNote
          error={
            actions.assign.error ||
            actions.startInstallation.error ||
            actions.completeInstallation.error
          }
        />
      </Card>

      <ChecklistCard
        title="Installation checklist"
        items={v.installationChecklist}
        canToggle={can('projects.installation.update')}
        onToggle={(itemId, status) => actions.toggleChecklistItem.mutate({ itemId, status })}
      />

      {can('projects.installation.complete') && inst.status === 'IN_PROGRESS' ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Complete installation</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Field
              label="Equipment installed"
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
            />
          </div>
          <Button
            onClick={() =>
              actions.completeInstallation.mutate({
                notes: notes || undefined,
                equipmentInstalled: equipment || undefined,
              })
            }
            disabled={actions.completeInstallation.isPending}
          >
            Mark installation complete
          </Button>
          <ErrorNote error={actions.completeInstallation.error} />
        </Card>
      ) : null}

      <ExecFiles
        projectId={projectId}
        entityKind="installation"
        entityId={inst.id}
        canManage={can('projects.installation.update')}
      />
    </div>
  );
}

function QcTab({
  v,
  projectId,
  can,
  actions,
}: {
  v: ExecutionView;
  projectId: string;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const latest = v.qcInspections[0];
  const insp = useQcInspection(projectId, latest?.id ?? '');
  const [failNote, setFailNote] = useState('');

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Quality control</h2>
          {latest ? <SupplyStatusBadge status={latest.status} /> : null}
        </div>
        {v.qcInspections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No QC inspection yet. Installation must be completed first.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {v.qcInspections.map((q) => (
              <li key={q.id} className="flex items-center justify-between">
                <span>
                  Inspection #{q.seq}
                  {q.inspectorName ? ` · ${q.inspectorName}` : ''}
                  {q.inspectedAt ? ` · ${fmtDate(q.inspectedAt)}` : ''}
                </span>
                <SupplyStatusBadge status={q.status} />
              </li>
            ))}
          </ul>
        )}
        {can('projects.qc.create') &&
        v.installation?.status === 'COMPLETED' &&
        (!latest || latest.status === 'FAILED') ? (
          <Button
            onClick={() => actions.createQc.mutate(undefined)}
            disabled={actions.createQc.isPending}
          >
            {v.qcInspections.length ? 'Start re-inspection' : 'Open QC inspection'}
          </Button>
        ) : null}
        <ErrorNote error={actions.createQc.error || actions.passQc.error || actions.failQc.error} />
      </Card>

      {latest && insp.data ? (
        <>
          <ChecklistCard
            title={`QC checklist (inspection #${latest.seq})`}
            items={insp.data.checklist}
            canToggle={
              can('projects.qc.update') &&
              (latest.status === 'PENDING' || latest.status === 'IN_PROGRESS')
            }
            onToggle={(itemId, status) =>
              actions.toggleQcItem.mutate({ inspectionId: latest.id, itemId, status })
            }
          />
          {can('projects.qc.approve') &&
          (latest.status === 'PENDING' || latest.status === 'IN_PROGRESS') ? (
            <Card className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => actions.passQc.mutate(latest.id)}
                  disabled={actions.passQc.isPending}
                >
                  Pass QC
                </Button>
                <div className="flex items-end gap-2">
                  <Field
                    label="Fail reason"
                    value={failNote}
                    onChange={(e) => setFailNote(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      actions.failQc.mutate({
                        inspectionId: latest.id,
                        resultNote: failNote || undefined,
                      })
                    }
                    disabled={actions.failQc.isPending}
                  >
                    Fail QC
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                QC cannot pass while required checks are incomplete or defects are unresolved.
              </p>
            </Card>
          ) : null}
          <ExecFiles
            projectId={projectId}
            entityKind="qc"
            entityId={latest.id}
            canManage={can('projects.qc.update')}
          />
        </>
      ) : null}

      <DefectsCard v={v} can={can} actions={actions} />
    </div>
  );
}

function DefectsCard({
  v,
  can,
  actions,
}: {
  v: ExecutionView;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const members = useMembers();
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [assignee, setAssignee] = useState('');

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Defects</h2>
      {v.defects.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Assignee</th>
              <th className="px-3 py-2" />
            </tr>
          }
        >
          {v.defects.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2">{d.description}</td>
              <td className="px-3 py-2">
                <SupplyStatusBadge status={d.severity} />
              </td>
              <td className="px-3 py-2">
                <SupplyStatusBadge status={d.status} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{d.assignedName ?? '—'}</td>
              <td className="px-3 py-2 text-right">
                {can('projects.defects.update') && d.status !== 'VERIFIED' ? (
                  <select
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      actions.updateDefect.mutate({
                        defectId: d.id,
                        status: e.target.value as never,
                      })
                    }
                  >
                    <option value="">Set status…</option>
                    {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED'].map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No defects raised.</p>
      )}
      {can('projects.defects.create') ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!desc) return;
            await actions.createDefect.mutateAsync({
              description: desc,
              severity: severity as never,
              assignedMembershipId: assignee || undefined,
            });
            setDesc('');
            setAssignee('');
          }}
          className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end"
        >
          <Field label="New defect" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['low', 'medium', 'high', 'critical'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select label="Assign to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {(members.data ?? []).map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!desc || actions.createDefect.isPending}>
            Raise
          </Button>
        </form>
      ) : null}
      <ErrorNote error={actions.createDefect.error || actions.updateDefect.error} />
    </Card>
  );
}

function NetMeteringTab({
  v,
  can,
  actions,
}: {
  v: ExecutionView;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const nm = v.netMetering;
  const [ref, setRef] = useState(nm?.referenceNumber ?? '');
  if (!nm) return <EmptyState>No net-metering record.</EmptyState>;
  const STATUSES = [
    'NOT_STARTED',
    'DOCUMENTS_PENDING',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
  ];
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Net metering / grid connection</h2>
        <SupplyStatusBadge status={nm.notRequired ? 'na' : nm.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Internal tracking only — no utility integration. Mark it not-required for off-grid projects.
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Reference</dt>
          <dd>{nm.referenceNumber ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Submitted</dt>
          <dd>{fmtDate(nm.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Approved</dt>
          <dd>{fmtDate(nm.approvedAt)}</dd>
        </div>
      </dl>
      {can('projects.net_metering.update') ? (
        <div className="space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Status"
              value={nm.status}
              onChange={(e) =>
                actions.updateNetMetering.mutate({ status: e.target.value as never })
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <Field label="Reference number" value={ref} onChange={(e) => setRef(e.target.value)} />
            <Button onClick={() => actions.updateNetMetering.mutate({ referenceNumber: ref })}>
              Save reference
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={nm.notRequired}
              onChange={(e) => actions.updateNetMetering.mutate({ notRequired: e.target.checked })}
            />
            Net metering is not required for this project
          </label>
          <ErrorNote error={actions.updateNetMetering.error} />
        </div>
      ) : null}
    </Card>
  );
}

function HandoverTab({
  v,
  projectId,
  can,
  actions,
}: {
  v: ExecutionView;
  projectId: string;
  can: (p: string) => boolean;
  actions: Actions;
}) {
  const ho = v.handover;
  const [ackName, setAckName] = useState(ho?.acknowledgedByName ?? '');
  const [notes, setNotes] = useState(ho?.notes ?? '');
  if (!ho) return <EmptyState>No handover record.</EmptyState>;
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Customer handover</h2>
          <SupplyStatusBadge status={ho.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          V1 records an internal customer acknowledgement — not an e-signature.
          {ho.handoverAt ? ` Handed over ${fmtDate(ho.handoverAt)}.` : ''}
        </p>
      </Card>

      <ChecklistCard
        title="Handover checklist"
        items={v.handoverChecklist}
        canToggle={can('projects.handover.update')}
        onToggle={(itemId, status) => actions.toggleChecklistItem.mutate({ itemId, status })}
      />

      {can('projects.handover.update') && ho.status !== 'COMPLETED' ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Record acknowledgement</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Acknowledged by (name)"
              value={ackName}
              onChange={(e) => setAckName(e.target.value)}
            />
            <Field label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                actions.updateHandover.mutate({
                  customerAcknowledged: true,
                  acknowledgedByName: ackName || undefined,
                  notes: notes || undefined,
                })
              }
            >
              Save acknowledgement
            </Button>
            {can('projects.handover.complete') ? (
              <Button
                onClick={() => actions.completeHandover.mutate()}
                disabled={actions.completeHandover.isPending}
              >
                Complete handover
              </Button>
            ) : null}
          </div>
          <ErrorNote error={actions.updateHandover.error || actions.completeHandover.error} />
        </Card>
      ) : null}

      <ExecFiles
        projectId={projectId}
        entityKind="handover"
        entityId={ho.id}
        canManage={can('projects.handover.update')}
      />
    </div>
  );
}

function FilesTab({ projectId, can }: { projectId: string; can: (p: string) => boolean }) {
  return (
    <ExecFiles
      projectId={projectId}
      canManage={can('projects.installation.update')}
      title="All execution files"
      entityKind={undefined}
      entityId={undefined}
      showKind
    />
  );
}

function ChecklistCard({
  title,
  items,
  canToggle,
  onToggle,
}: {
  title: string;
  items: ChecklistItem[];
  canToggle: boolean;
  onToggle: (itemId: string, status: 'pending' | 'done' | 'na') => void;
}) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items.</p>
      ) : (
        <ul className="divide-y text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 py-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!canToggle}
                  checked={it.status === 'done'}
                  onChange={(e) => onToggle(it.id, e.target.checked ? 'done' : 'pending')}
                />
                <span className={it.status === 'done' ? 'text-muted-foreground line-through' : ''}>
                  {it.label}
                </span>
                {it.required ? <span className="text-xs text-destructive">*</span> : null}
              </label>
              {canToggle ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => onToggle(it.id, it.status === 'na' ? 'pending' : 'na')}
                >
                  {it.status === 'na' ? 'clear N/A' : 'N/A'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExecFiles({
  projectId,
  entityKind,
  entityId,
  canManage,
  title = 'Files',
  showKind = false,
}: {
  projectId: string;
  entityKind?: string;
  entityId?: string;
  canManage: boolean;
  title?: string;
  showKind?: boolean;
}) {
  const list = useExecutionAttachments(projectId, entityKind, entityId);
  const upload = useUploadExecutionAttachment(projectId);
  const del = useDeleteExecutionAttachment(projectId);
  const [busy, setBusy] = useState(false);

  const view = async (attachmentId: string) => {
    const { objectUrl } = await fetchExecutionAttachmentBlob(projectId, attachmentId);
    window.open(objectUrl, '_blank', 'noopener');
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {list.isLoading ? (
        <Skeleton rows={2} />
      ) : list.data && list.data.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {list.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => view(a.id)}
              >
                {a.originalFilename ?? a.id.slice(0, 8)}
              </button>
              <span className="text-xs text-muted-foreground">
                {showKind ? `${a.entityKind} · ` : ''}
                {(a.fileSize / 1024).toFixed(0)} KB
                {canManage ? (
                  <button
                    type="button"
                    className="ml-3 text-destructive hover:underline"
                    onClick={() => del.mutate(a.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No files.</p>
      )}
      {canManage && entityKind && entityId ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                await upload.mutateAsync({ entityKind, entityId, file });
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
          />
          {busy ? 'Uploading…' : '+ Upload photo or PDF'}
        </label>
      ) : null}
      <ErrorNote error={upload.error || del.error} />
    </Card>
  );
}
