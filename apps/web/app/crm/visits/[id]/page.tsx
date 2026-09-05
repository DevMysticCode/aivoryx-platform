'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useAssignVisit,
  useCancelVisit,
  useFieldAgents,
  useRescheduleVisit,
  useVisit,
  useVisitActivities,
  useVisitAttachments,
  useVisitNotes,
  useVisitSurvey,
} from '@/lib/field/use-field';
import { Card, ErrorNote, Field, PageHeader, Skeleton, StatusBadge } from '@/components/admin/ui';
import { AttachmentThumb } from '@/components/field/attachment-thumb';

export default function VisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const visit = useVisit(id);
  const activities = useVisitActivities(id);
  const notes = useVisitNotes(id);
  const survey = useVisitSurvey(id);
  const attachments = useVisitAttachments(id);
  const fieldAgents = useFieldAgents();

  const assign = useAssignVisit(id);
  const reschedule = useRescheduleVisit(id);
  const cancel = useCancelVisit(id);

  const [rescheduleAt, setRescheduleAt] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  if (visit.isLoading) return <Skeleton rows={6} />;
  if (visit.error) return <ErrorNote error={visit.error} />;
  if (!visit.data) return null;

  const v = visit.data;
  const canReassignOrReschedule = v.status === 'SCHEDULED' || v.status === 'ASSIGNED';
  const canCancel = v.status !== 'COMPLETED' && v.status !== 'CANCELLED';

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={v.leadName ?? 'Site visit'}
          description={`Scheduled for ${new Date(v.scheduledAt).toLocaleString()}`}
        />
        <StatusBadge status={v.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Site</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Address" value={v.addressLine ?? ''} readOnly />
              <Field label="City" value={v.city ?? ''} readOnly />
              <Field label="State" value={v.state ?? ''} readOnly />
              <Field
                label="Site coordinates"
                value={v.siteLat && v.siteLng ? `${v.siteLat}, ${v.siteLng}` : 'Not set'}
                readOnly
              />
            </dl>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Assignment &amp; scheduling</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={v.assignee?.membershipId ?? ''}
                onChange={(e) => e.target.value && assign.mutate({ membershipId: e.target.value })}
                disabled={assign.isPending || !canReassignOrReschedule}
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {(fieldAgents.data ?? [])
                  .filter((a) => a.status === 'active')
                  .map((a) => (
                    <option key={a.membershipId} value={a.membershipId}>
                      {a.userName ?? a.userEmail}
                    </option>
                  ))}
              </select>
              {!canReassignOrReschedule ? (
                <span className="text-xs text-muted-foreground">
                  Locked once the visit is in progress or finished.
                </span>
              ) : null}
            </div>
            <ErrorNote error={assign.error} />

            {canReassignOrReschedule ? (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <Field
                  label="Reschedule to"
                  type="datetime-local"
                  value={rescheduleAt}
                  onChange={(e) => setRescheduleAt(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reschedule.isPending || !rescheduleAt}
                  onClick={() => {
                    reschedule.mutate({ scheduledAt: new Date(rescheduleAt).toISOString() });
                    setRescheduleAt('');
                  }}
                >
                  Reschedule
                </Button>
              </div>
            ) : null}
            <ErrorNote error={reschedule.error} />

            {canCancel ? (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <Field
                  label="Cancellation reason (optional)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ reason: cancelReason || undefined })}
                >
                  Cancel visit
                </Button>
              </div>
            ) : null}
            <ErrorNote error={cancel.error} />
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">GPS &amp; travel</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field
                label="Checked in"
                value={v.checkInAt ? new Date(v.checkInAt).toLocaleString() : 'Not yet'}
                readOnly
              />
              <Field
                label="Checked out"
                value={v.checkOutAt ? new Date(v.checkOutAt).toLocaleString() : 'Not yet'}
                readOnly
              />
              <Field
                label="GPS distance (straight-line)"
                value={v.gpsDistanceMeters != null ? `${Math.round(v.gpsDistanceMeters)} m` : '—'}
                readOnly
              />
              <Field
                label="Travel (operator-entered)"
                value={v.travelKm != null ? `${v.travelKm} km` : '—'}
                readOnly
              />
            </dl>
            {v.travelNotes ? (
              <p className="border-t pt-3 text-sm text-muted-foreground">{v.travelNotes}</p>
            ) : null}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Site survey</h2>
            {survey.isLoading ? (
              <Skeleton rows={3} />
            ) : survey.error ? (
              <ErrorNote error={survey.error} />
            ) : survey.data && survey.data.length > 0 ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {survey.data.map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd>{f.value === null || f.value === '' ? '—' : String(f.value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No survey questions configured.</p>
            )}
            {v.surveyCompletedAt ? (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Completed {new Date(v.surveyCompletedAt).toLocaleString()}
              </p>
            ) : null}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Photos</h2>
            {attachments.isLoading ? (
              <Skeleton rows={2} />
            ) : attachments.data && attachments.data.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {attachments.data.map((a) => (
                  <AttachmentThumb key={a.id} visitId={id} attachment={a} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
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
            <ul className="space-y-2 text-sm">
              {(notes.data ?? []).map((n) => (
                <li key={n.id} className="rounded border p-2">
                  <p>{n.body}</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {n.authorName ?? 'Field agent'} · {new Date(n.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
              {(notes.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No notes yet.</p>
              ) : null}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
