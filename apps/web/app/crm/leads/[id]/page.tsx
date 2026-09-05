'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useMembers } from '@/lib/admin/use-admin';
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
import { Card, ErrorNote, Field, PageHeader, Skeleton, StatusBadge } from '@/components/admin/ui';

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
