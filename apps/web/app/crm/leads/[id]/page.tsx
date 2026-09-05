'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useMembers } from '@/lib/admin/use-admin';
import { useVisits } from '@/lib/field/use-field';
import {
  useActivities,
  useAssignLead,
  useChangeLeadStatus,
  useCompleteFollowup,
  useCreateFollowup,
  useCreateNote,
  useDeleteNote,
  useFollowups,
  useLead,
  useLogCallAttempt,
  useNotes,
  useQualifyLead,
  useRescheduleFollowup,
  useUpdateNote,
} from '@/lib/crm/use-crm';
import { useProject, useProjects } from '@/lib/supply/use-supply';
import { Card, ErrorNote, Field, PageHeader, Skeleton, StatusBadge } from '@/components/admin/ui';
import { fmtQty, SupplyStatusBadge } from '@/components/supply/ui';

const NEXT_STATUSES: Record<string, string[]> = {
  NEW: ['ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  ASSIGNED: ['CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  CONTACTED: ['QUALIFIED', 'DISQUALIFIED'],
  QUALIFIED: ['CONVERTED', 'DISQUALIFIED'],
  DISQUALIFIED: [],
  CONVERTED: [],
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const lead = useLead(id);
  const activities = useActivities(id);
  const notes = useNotes(id);
  const followups = useFollowups(id);
  const visits = useVisits({ leadId: id, pageSize: 10 });
  const members = useMembers();

  const assign = useAssignLead(id);
  const changeStatus = useChangeLeadStatus(id);
  const qualify = useQualifyLead(id);
  const logCall = useLogCallAttempt(id);
  const createNote = useCreateNote(id);
  const updateNote = useUpdateNote(id);
  const deleteNote = useDeleteNote(id);
  const createFollowup = useCreateFollowup(id);
  const completeFollowup = useCompleteFollowup(id);
  const rescheduleFollowup = useRescheduleFollowup(id);

  const [noteBody, setNoteBody] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [callOutcome, setCallOutcome] = useState('connected');
  const [callNote, setCallNote] = useState('');
  const [qualifyNote, setQualifyNote] = useState('');
  const [followupDue, setFollowupDue] = useState('');
  const [followupNote, setFollowupNote] = useState('');

  if (lead.isLoading) return <Skeleton rows={6} />;
  if (lead.error) return <ErrorNote error={lead.error} />;
  if (!lead.data) return null;

  const nextStatuses = NEXT_STATUSES[lead.data.status] ?? [];
  const canQualify = ['QUALIFIED', 'DISQUALIFIED'].some((s) => nextStatuses.includes(s));

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={lead.data.name ?? 'Unnamed lead'}
          description={lead.data.sourceName ?? 'Manually created'}
        />
        <StatusBadge status={lead.data.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Contact</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Phone" value={lead.data.phone ?? ''} readOnly />
              <Field label="Email" value={lead.data.email ?? ''} readOnly />
              <Field label="City" value={lead.data.city ?? ''} readOnly />
              <Field label="State" value={lead.data.state ?? ''} readOnly />
            </dl>
            {Object.keys(lead.data.customFields).length > 0 ? (
              <div className="space-y-1 border-t pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Custom fields
                </p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(lead.data.customFields).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd>{String(value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {lead.data.qualificationNote ? (
              <p className="border-t pt-3 text-sm text-muted-foreground">
                Qualification note: {lead.data.qualificationNote}
              </p>
            ) : null}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Actions</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={lead.data.assignee?.membershipId ?? ''}
                onChange={(e) => e.target.value && assign.mutate(e.target.value)}
                disabled={assign.isPending}
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {(members.data ?? []).map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>

              {nextStatuses
                .filter((s) => s !== 'QUALIFIED' && s !== 'DISQUALIFIED')
                .map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    disabled={changeStatus.isPending}
                    onClick={() => changeStatus.mutate(s)}
                  >
                    Mark {s}
                  </Button>
                ))}
            </div>
            <ErrorNote error={assign.error ?? changeStatus.error} />

            {canQualify ? (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <Field
                  label="Qualification note (optional)"
                  value={qualifyNote}
                  onChange={(e) => setQualifyNote(e.target.value)}
                  className="min-w-[220px]"
                />
                <Button
                  size="sm"
                  disabled={qualify.isPending}
                  onClick={() =>
                    qualify.mutate({ outcome: 'QUALIFIED', note: qualifyNote || undefined })
                  }
                >
                  Qualify
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={qualify.isPending}
                  onClick={() =>
                    qualify.mutate({ outcome: 'DISQUALIFIED', note: qualifyNote || undefined })
                  }
                >
                  Disqualify
                </Button>
              </div>
            ) : null}
            <ErrorNote error={qualify.error} />

            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Call outcome</span>
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={callOutcome}
                  onChange={(e) => setCallOutcome(e.target.value)}
                >
                  <option value="connected">Connected</option>
                  <option value="no_answer">No answer</option>
                  <option value="busy">Busy</option>
                  <option value="invalid_number">Invalid number</option>
                </select>
              </label>
              <Field label="Note" value={callNote} onChange={(e) => setCallNote(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                disabled={logCall.isPending}
                onClick={() => {
                  logCall.mutate({ outcome: callOutcome, note: callNote || undefined });
                  setCallNote('');
                }}
              >
                Log call
              </Button>
            </div>
            <ErrorNote error={logCall.error} />
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Site visits</h2>
            {visits.isLoading ? (
              <Skeleton rows={2} />
            ) : visits.error ? (
              <ErrorNote error={visits.error} />
            ) : visits.data && visits.data.items.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {visits.data.items.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between border-b pb-2 last:border-b-0"
                  >
                    <div>
                      <Link
                        href={`/crm/visits/${v.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {new Date(v.scheduledAt).toLocaleString()}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {v.assignee ? (v.assignee.name ?? v.assignee.email) : 'Unassigned'}
                      </div>
                    </div>
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No site visits scheduled yet.</p>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Timeline</h2>
            {activities.isLoading ? (
              <Skeleton rows={3} />
            ) : activities.error ? (
              <ErrorNote error={activities.error} />
            ) : (
              <ol className="space-y-2 text-sm">
                {(activities.data ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0"
                  >
                    <div>
                      <span className="font-medium">{a.type.replace(/_/g, ' ')}</span>
                      {Object.keys(a.payload).length > 0 ? (
                        <span className="ml-2 text-muted-foreground">
                          {JSON.stringify(a.payload)}
                        </span>
                      ) : null}
                      <div className="text-xs text-muted-foreground">
                        {a.actorName ?? a.actorEmail ?? 'System'}
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <LeadProjectCard leadId={id} />

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Notes</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteBody.trim()) return;
                createNote.mutate({ body: noteBody });
                setNoteBody('');
              }}
              className="space-y-2"
            >
              <Field
                label="Add a note"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={createNote.isPending || !noteBody.trim()}>
                Add note
              </Button>
            </form>
            <ErrorNote error={createNote.error} />
            <ul className="space-y-2 text-sm">
              {(notes.data ?? []).map((n) => (
                <li key={n.id} className="rounded border p-2">
                  {editingNoteId === n.id ? (
                    <div className="space-y-2">
                      <Field
                        label=""
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            updateNote.mutate({ noteId: n.id, body: { body: editingBody } });
                            setEditingNoteId(null);
                          }}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{n.body}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                        <span className="flex gap-2">
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditingBody(n.body);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="hover:text-destructive hover:underline"
                            onClick={() => deleteNote.mutate(n.id)}
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Follow-ups</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!followupDue) return;
                createFollowup.mutate({
                  dueAt: new Date(followupDue).toISOString(),
                  note: followupNote || undefined,
                });
                setFollowupDue('');
                setFollowupNote('');
              }}
              className="space-y-2"
            >
              <Field
                label="Due"
                type="datetime-local"
                value={followupDue}
                onChange={(e) => setFollowupDue(e.target.value)}
              />
              <Field
                label="Note"
                value={followupNote}
                onChange={(e) => setFollowupNote(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={createFollowup.isPending || !followupDue}>
                Schedule
              </Button>
            </form>
            <ErrorNote error={createFollowup.error} />
            <ul className="space-y-2 text-sm">
              {(followups.data ?? []).map((f) => (
                <li key={f.id} className="rounded border p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{new Date(f.dueAt).toLocaleString()}</span>
                    <span className="text-xs uppercase text-muted-foreground">{f.status}</span>
                  </div>
                  {f.note ? <p className="text-muted-foreground">{f.note}</p> : null}
                  {f.status === 'pending' ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => completeFollowup.mutate({ followupId: f.id, body: {} })}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          rescheduleFollowup.mutate({
                            followupId: f.id,
                            body: { dueAt: new Date(Date.now() + 86_400_000).toISOString() },
                          })
                        }
                      >
                        +1 day
                      </Button>
                    </div>
                  ) : f.result ? (
                    <p className="mt-1 text-xs text-muted-foreground">Result: {f.result}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}

/**
 * Operational readiness for this lead — the linked Phase 5 project (ADR 0034),
 * its lifecycle status, and how far its materials have progressed from required
 * through delivered. Hidden entirely when the member cannot see projects or no
 * project exists yet.
 */
function LeadProjectCard({ leadId }: { leadId: string }) {
  const projects = useProjects({ leadId, pageSize: 1 });
  const first = projects.data?.items[0];
  const detail = useProject(first?.id ?? '');

  // 403 (no projects.read) or no project yet → render nothing.
  if (projects.error || (projects.data && projects.data.items.length === 0)) return null;
  if (projects.isLoading || !first) {
    return (
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Project / operations</h2>
        <Skeleton rows={2} />
      </Card>
    );
  }

  const materials = detail.data?.materials ?? [];
  const sum = (key: 'requiredQty' | 'allocatedQty' | 'dispatchedQty' | 'deliveredQty') =>
    materials.reduce((acc, m) => acc + Number(m[key] || 0), 0);
  const required = sum('requiredQty');
  const readiness = required > 0 ? Math.round((sum('deliveredQty') / required) * 100) : 0;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Project / operations</h2>
        <SupplyStatusBadge status={first.status} />
      </div>
      <Link
        href={`/projects/${first.id}`}
        className="block font-medium text-primary hover:underline"
      >
        {first.number}
      </Link>
      {materials.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Required</dt>
            <dd>{fmtQty(String(sum('requiredQty')))}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Allocated</dt>
            <dd>{fmtQty(String(sum('allocatedQty')))}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Dispatched</dt>
            <dd>{fmtQty(String(sum('dispatchedQty')))}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Delivered</dt>
            <dd>{fmtQty(String(sum('deliveredQty')))}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No material requirements captured yet.</p>
      )}
      <p className="text-xs text-muted-foreground">Material readiness: {readiness}%</p>
    </Card>
  );
}
