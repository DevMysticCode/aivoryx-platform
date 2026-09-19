'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { ArrowLeft, CalendarClock, Mail, MapPin, Pencil, Phone, UserRound } from 'lucide-react';
import { Button, buttonVariants } from '@aivoryx/ui';
import { useMembers } from '@/lib/admin/use-admin';
import { useVisits } from '@/lib/field/use-field';
import { useCrossModuleAccess } from '@/lib/navigation/use-cross-module';
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
  useUpdateLead,
  useUpdateNote,
} from '@/lib/crm/use-crm';
import { useProject, useProjects } from '@/lib/supply/use-supply';
import { useCreateQuotation, useLeadQuotations } from '@/lib/commercial/use-commercial';
import { Card, EmptyState, ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';
import { fmtDate, fmtMoney, fmtQty, SupplyStatusBadge } from '@/components/supply/ui';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { Confirm, ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { TabBar } from '@/components/ui/tab-bar';
import { RelatedLink } from '@/components/ui/related-link';
import { Badge } from '@/components/ui/status-badge';
import { HelperText } from '@/components/help/helper-text';
import { ScheduleVisitDialog } from '@/components/field/schedule-visit-dialog';
import { VisitOutcomeBadge, visitOutcomeLabel } from '@/components/field/visit-outcome';

const NEXT_STATUSES: Record<string, string[]> = {
  NEW: ['ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  ASSIGNED: ['CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  CONTACTED: ['QUALIFIED', 'DISQUALIFIED'],
  QUALIFIED: ['CONVERTED', 'DISQUALIFIED'],
  DISQUALIFIED: [],
  CONVERTED: [],
};

const TABS = ['Overview', 'Activity', 'Follow-ups', 'Notes', 'Related'] as const;
type Tab = (typeof TABS)[number];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const lead = useLead(id);
  const members = useMembers();
  const [tab, setTab] = useState<Tab>('Overview');
  const [editOpen, setEditOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);

  if (lead.isLoading) return <LoadingBlock />;
  if (lead.error) return <ErrorBlock error={lead.error} onRetry={() => lead.refetch()} />;
  if (!lead.data) return null;

  const l = lead.data;
  const assignee = l.assignee ? (l.assignee.name ?? l.assignee.email) : 'Unassigned';

  return (
    <section className="space-y-5">
      <Link
        href="/crm/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Leads
      </Link>

      {/* header */}
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{l.name ?? 'Unnamed lead'}</h1>
              <StatusBadge status={l.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {l.phone ? (
                <a
                  href={`tel:${l.phone}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Phone className="size-3.5" aria-hidden /> {l.phone}
                </a>
              ) : null}
              {l.email ? (
                <a
                  href={`mailto:${l.email}`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Mail className="size-3.5" aria-hidden /> {l.email}
                </a>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5" aria-hidden /> {assignee}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {l.sourceName ?? 'Manual'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {l.phone ? (
              <a
                href={`tel:${l.phone}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Phone className="size-4" aria-hidden /> Call
              </a>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setFollowupOpen(true)}>
              <CalendarClock className="size-4" aria-hidden /> Follow-up
            </Button>
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          </div>
        </div>
        <NextAction leadId={id} onSchedule={() => setFollowupOpen(true)} />
      </div>

      <TabBar tabs={TABS.map((t) => ({ key: t, label: t }))} active={tab} onChange={setTab} />

      {tab === 'Overview' ? (
        <OverviewTab leadId={id} members={members.data ?? []} />
      ) : tab === 'Activity' ? (
        <ActivityTab leadId={id} />
      ) : tab === 'Follow-ups' ? (
        <FollowupsTab leadId={id} />
      ) : tab === 'Notes' ? (
        <NotesTab leadId={id} />
      ) : (
        <RelatedTab leadId={id} leadName={l.name} leadStatus={l.status} />
      )}

      <EditLeadDialog leadId={id} open={editOpen} onClose={() => setEditOpen(false)} />
      <FollowupDialog leadId={id} open={followupOpen} onClose={() => setFollowupOpen(false)} />
    </section>
  );
}

/** The single most useful thing to do next: the earliest pending follow-up, or a prompt to schedule one. */
function NextAction({ leadId, onSchedule }: { leadId: string; onSchedule: () => void }) {
  const followups = useFollowups(leadId);
  if (!followups.data) return null;
  const next = followups.data
    .filter((f) => f.status === 'pending')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  const overdue = next ? new Date(next.dueAt).getTime() < Date.now() : false;
  return (
    <div
      data-testid="lead-next-action"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3 text-sm"
    >
      <div className="min-w-0">
        <span className="text-xs font-medium text-muted-foreground">Next action</span>
        {next ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Follow up {new Date(next.dueAt).toLocaleString()}</span>
            {overdue ? <Badge tone="danger">Overdue</Badge> : null}
            {next.note ? <span className="text-muted-foreground">{next.note}</span> : null}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Nothing scheduled. Schedule a follow-up so this lead doesn&apos;t go quiet.
          </p>
        )}
      </div>
      {!next ? (
        <Button variant="outline" size="sm" onClick={onSchedule}>
          Set a reminder
        </Button>
      ) : null}
    </div>
  );
}

// ---- Overview ---------------------------------------------------------

function OverviewTab({
  leadId,
  members,
}: {
  leadId: string;
  members: { membershipId: string; name: string | null; email: string }[];
}) {
  const lead = useLead(leadId);
  const assign = useAssignLead(leadId);
  const changeStatus = useChangeLeadStatus(leadId);
  const qualify = useQualifyLead(leadId);
  const logCall = useLogCallAttempt(leadId);
  const [callOutcome, setCallOutcome] = useState('connected');
  const [qualifyNote, setQualifyNote] = useState('');
  const l = lead.data;
  if (!l) return null;
  const nextStatuses = NEXT_STATUSES[l.status] ?? [];
  const canQualify = nextStatuses.includes('QUALIFIED') || nextStatuses.includes('DISQUALIFIED');
  const plainNext = nextStatuses.filter((s) => s !== 'QUALIFIED' && s !== 'DISQUALIFIED');

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Contact & details</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Detail label="Phone" value={l.phone} />
            <Detail label="Email" value={l.email} />
            <Detail label="City" value={l.city} />
            <Detail label="State" value={l.state} />
            <Detail label="Source" value={l.sourceName ?? 'Manual'} />
            <Detail label="Origin" value={l.origin} />
          </dl>
          {Object.keys(l.customFields).length > 0 ? (
            <div className="mt-3 border-t pt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Custom fields
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {Object.entries(l.customFields).map(([k, v]) => (
                  <Detail key={k} label={k} value={v == null ? null : String(v)} />
                ))}
              </dl>
            </div>
          ) : null}
          {l.qualificationNote ? (
            <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
              Qualification note: {l.qualificationNote}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Move the lead forward</h2>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Owner</span>
            <select
              className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={l.assignee?.membershipId ?? ''}
              onChange={(e) => e.target.value && assign.mutate(e.target.value)}
              disabled={assign.isPending}
            >
              <option value="" disabled>
                Assign to…
              </option>
              {members.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </label>
          {plainNext.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {plainNext.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate(s)}
                >
                  Mark {titleCase(s)}
                </Button>
              ))}
            </div>
          ) : null}
          {canQualify ? (
            <div className="mt-3 space-y-2 border-t pt-3">
              <input
                value={qualifyNote}
                onChange={(e) => setQualifyNote(e.target.value)}
                placeholder="Qualification note (optional)"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              />
              <div className="flex gap-2">
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
            </div>
          ) : null}
          <ErrorNote error={assign.error ?? changeStatus.error ?? qualify.error} />
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">Log a call</h2>
          <div className="flex items-center gap-2">
            <select
              value={callOutcome}
              onChange={(e) => setCallOutcome(e.target.value)}
              className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="connected">Connected</option>
              <option value="no_answer">No answer</option>
              <option value="busy">Busy</option>
              <option value="invalid_number">Invalid number</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={logCall.isPending}
              onClick={() => logCall.mutate({ outcome: callOutcome })}
            >
              {logCall.isPending ? 'Logging…' : 'Log'}
            </Button>
          </div>
          <ErrorNote error={logCall.error} />
        </div>
      </div>
    </div>
  );
}

// ---- Activity -------------------------------------------------------

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Lead created',
  assigned: 'Assigned',
  reassigned: 'Re-assigned',
  status_changed: 'Status changed',
  note: 'Note added',
  call_attempt: 'Call logged',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  followup_created: 'Follow-up scheduled',
  followup_completed: 'Follow-up completed',
  visit_scheduled: 'Visit scheduled',
  visit_checked_in: 'Checked in on site',
  visit_survey_completed: 'Survey completed',
  visit_checked_out: 'Checked out',
  visit_completed: 'Visit completed',
  visit_cancelled: 'Visit cancelled',
  quotation_created: 'Quotation created',
  quotation_sent: 'Quotation sent',
  quotation_accepted: 'Quotation accepted',
  quotation_booked: 'Quotation booked',
  project_completed: 'Project completed',
};

function ActivityTab({ leadId }: { leadId: string }) {
  const access = useCrossModuleAccess();
  const activities = useActivities(leadId);
  if (activities.isLoading) return <Skeleton rows={4} />;
  if (activities.error) return <ErrorNote error={activities.error} />;
  const items = activities.data ?? [];
  if (items.length === 0)
    return (
      <EmptyState title="No activity yet">
        Every call, note, status change and follow-up on this lead is recorded here. Log a call or
        add a note from the Overview and Notes tabs to start the timeline.
      </EmptyState>
    );

  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[1.42rem] top-1 size-2.5 rounded-full border-2 border-background bg-primary" />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {ACTIVITY_LABEL[a.type] ?? a.type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(a.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {a.actorName ?? a.actorEmail ?? 'System'}
            {describePayload(a.type, a.payload) ? ` · ${describePayload(a.type, a.payload)}` : ''}
          </p>
          <ActivityLink type={a.type} payload={a.payload} access={access} />
        </li>
      ))}
    </ol>
  );
}

/** A real link from a Field / Commercial event to the record it is about — only when the caller may open it. */
function ActivityLink({
  type,
  payload,
  access,
}: {
  type: string;
  payload: Record<string, unknown>;
  access: { fieldVisits: boolean; quotations: boolean };
}) {
  if (type.startsWith('visit_') && access.fieldVisits && typeof payload.visitId === 'string') {
    return (
      <RelatedLink kind="Visit" href={`/crm/visits/${payload.visitId}`} className="mt-0.5 text-xs">
        Open visit
      </RelatedLink>
    );
  }
  if (
    type.startsWith('quotation_') &&
    access.quotations &&
    typeof payload.quotationId === 'string'
  ) {
    return (
      <RelatedLink
        kind="Quotation"
        href={`/quotations/${payload.quotationId}`}
        className="mt-0.5 text-xs"
      >
        Open quotation
      </RelatedLink>
    );
  }
  return null;
}

function describePayload(type: string, payload: Record<string, unknown>): string {
  if (type === 'visit_completed' && typeof payload.outcome === 'string') {
    return visitOutcomeLabel(payload.outcome) || payload.outcome.replace(/_/g, ' ');
  }
  if (payload.from && payload.to) return `${String(payload.from)} → ${String(payload.to)}`;
  if (payload.outcome) return String(payload.outcome).replace(/_/g, ' ');
  if (typeof payload.note === 'string' && payload.note) return payload.note;
  return '';
}

// ---- Follow-ups ---------------------------------------------------

function FollowupsTab({ leadId }: { leadId: string }) {
  const followups = useFollowups(leadId);
  const complete = useCompleteFollowup(leadId);
  const reschedule = useRescheduleFollowup(leadId);
  const [open, setOpen] = useState(false);

  if (followups.isLoading) return <Skeleton rows={3} />;
  if (followups.error) return <ErrorNote error={followups.error} />;
  const all = followups.data ?? [];
  const now = Date.now();
  const overdue = all.filter((f) => f.status === 'pending' && new Date(f.dueAt).getTime() < now);
  const upcoming = all.filter((f) => f.status === 'pending' && new Date(f.dueAt).getTime() >= now);
  const done = all.filter((f) => f.status !== 'pending');

  const Row = ({ f }: { f: (typeof all)[number] }) => (
    <li className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{new Date(f.dueAt).toLocaleString()}</span>
        <Badge tone={f.status === 'completed' ? 'success' : 'neutral'}>{f.status}</Badge>
      </div>
      {f.note ? <p className="mt-0.5 text-sm text-muted-foreground">{f.note}</p> : null}
      {f.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={complete.isPending}
            onClick={() => complete.mutate({ followupId: f.id, body: {} })}
          >
            {complete.isPending ? 'Completing…' : 'Complete'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={reschedule.isPending}
            onClick={() =>
              reschedule.mutate({
                followupId: f.id,
                body: { dueAt: new Date(Date.now() + 86_400_000).toISOString() },
              })
            }
          >
            {reschedule.isPending ? 'Saving…' : '+1 day'}
          </Button>
        </div>
      ) : f.result ? (
        <p className="mt-1 text-xs text-muted-foreground">Result: {f.result}</p>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Schedule follow-up
        </button>
      </div>
      {overdue.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-danger">
            Overdue ({overdue.length})
          </h3>
          <ul className="space-y-2">
            {overdue.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Upcoming ({upcoming.length})
        </h3>
        {upcoming.length > 0 ? (
          <ul className="space-y-2">
            {upcoming.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing scheduled">
            Follow-ups are reminders to contact this lead again. Use the Schedule follow-up button
            above so it doesn&apos;t go quiet.
          </EmptyState>
        )}
      </section>
      {done.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Completed ({done.length})
          </h3>
          <ul className="space-y-2">
            {done.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ) : null}
      <FollowupDialog leadId={leadId} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

// ---- Notes -------------------------------------------------------

function NotesTab({ leadId }: { leadId: string }) {
  const notes = useNotes(leadId);
  const create = useCreateNote(leadId);
  const update = useUpdateNote(leadId);
  const del = useDeleteNote(leadId);
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          create.mutate({ body });
          setBody('');
        }}
        className="flex gap-2"
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
        />
        <Button size="sm" type="submit" disabled={create.isPending || !body.trim()}>
          {create.isPending ? 'Adding…' : 'Add'}
        </Button>
      </form>
      <ErrorNote error={create.error} />
      <Confirm
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => {
          if (!deletingId) return;
          del.mutate(deletingId, { onSuccess: () => setDeletingId(null) });
        }}
        title="Delete this note?"
        body="This note will be permanently removed."
        confirmLabel="Delete note"
        danger
        pending={del.isPending}
      />
      {notes.isLoading ? (
        <Skeleton rows={3} />
      ) : (notes.data ?? []).length === 0 ? (
        <EmptyState title="No notes yet">
          Notes are a shared record of what you learned about this lead. Add the first one above.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {(notes.data ?? []).map((n) => (
            <li key={n.id} className="rounded-lg border p-3 text-sm">
              {editingId === n.id ? (
                <div className="space-y-2">
                  <input
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate(
                          { noteId: n.id, body: { body: editingBody } },
                          { onSuccess: () => setEditingId(null) },
                        )
                      }
                    >
                      {update.isPending ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
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
                          setEditingId(n.id);
                          setEditingBody(n.body);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hover:text-danger hover:underline"
                        onClick={() => setDeletingId(n.id)}
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
      )}
    </div>
  );
}

// ---- Related ---------------------------------------------------
// Cross-module cards render ONLY for a user with the owning module's entitlement
// and permission, and their queries are disabled otherwise — so a CRM-only user
// makes no Field / Commercial / Execution requests at all.

type VisitList = ReturnType<typeof useVisits>;
type QuoteList = ReturnType<typeof useLeadQuotations>;

function RelatedTab({
  leadId,
  leadName,
  leadStatus,
}: {
  leadId: string;
  leadName: string | null;
  leadStatus: string;
}) {
  const access = useCrossModuleAccess();
  const visits = useVisits({ leadId, pageSize: 10 }, { enabled: access.fieldVisits });
  const quotes = useLeadQuotations(leadId, { enabled: access.quotations });

  const customer =
    access.customers && access.quotations
      ? (quotes.data?.items ?? []).find((q) => q.customerId)
      : undefined;

  if (!access.fieldVisits && !access.quotations && !access.projects) {
    return (
      <EmptyState>
        Visits, quotations and projects for this lead appear here when your workspace and role
        include those areas.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {customer?.customerId ? (
        <div>
          <RelatedLink kind="Customer" href={`/customers/${customer.customerId}`}>
            {customer.customerName ?? 'Open customer'}
          </RelatedLink>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {access.fieldVisits ? (
          <LeadVisitsCard
            visits={visits}
            leadId={leadId}
            leadName={leadName}
            leadStatus={leadStatus}
          />
        ) : null}
        {access.quotations ? (
          <LeadQuotationsCard leadId={leadId} quotes={quotes} visits={visits} />
        ) : null}
        {access.projects ? <LeadProjectCard leadId={leadId} /> : null}
      </div>
    </div>
  );
}

function LeadVisitsCard({
  visits,
  leadId,
  leadName,
  leadStatus,
}: {
  visits: VisitList;
  leadId: string;
  leadName: string | null;
  leadStatus: string;
}) {
  const access = useCrossModuleAccess();
  const [scheduling, setScheduling] = useState(false);
  const canSchedule =
    access.scheduleVisit && leadStatus !== 'DISQUALIFIED' && leadStatus !== 'CONVERTED';
  const items = visits.data?.items ?? [];
  const scheduleButton = (
    <Button size="sm" variant="outline" onClick={() => setScheduling(true)}>
      Schedule visit
    </Button>
  );

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Site visits</h2>
        {canSchedule && items.length > 0 ? scheduleButton : null}
      </div>
      {visits.isLoading ? (
        <Skeleton rows={2} />
      ) : visits.error ? (
        <ErrorNote error={visits.error} />
      ) : items.length === 0 ? (
        <EmptyState title="No site visits yet" action={canSchedule ? scheduleButton : undefined}>
          A site visit is when someone goes to the customer&apos;s location to survey. Schedule one
          once the lead is qualified.
        </EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"
            >
              <div className="min-w-0">
                <RelatedLink kind="Visit" href={`/crm/visits/${v.id}`}>
                  {new Date(v.scheduledAt).toLocaleString()}
                </RelatedLink>
                <div className="text-xs text-muted-foreground">
                  {v.assignee ? (v.assignee.name ?? v.assignee.email) : 'Unassigned'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={v.status} />
                <VisitOutcomeBadge outcome={v.outcome} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {canSchedule ? (
        <ScheduleVisitDialog
          open={scheduling}
          onClose={() => setScheduling(false)}
          lead={{ id: leadId, name: leadName }}
        />
      ) : null}
    </Card>
  );
}

function LeadProjectCard({ leadId }: { leadId: string }) {
  const projects = useProjects({ leadId, pageSize: 1 });
  const first = projects.data?.items[0];
  const detail = useProject(first?.id ?? '');
  if (projects.data && projects.data.items.length === 0) return null;
  if (projects.error) {
    return (
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Project / operations</h2>
        <ErrorNote error={projects.error} />
      </Card>
    );
  }
  if (projects.isLoading || !first) {
    return (
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Project / operations</h2>
        <Skeleton rows={2} />
      </Card>
    );
  }
  const materials = detail.data?.materials ?? [];
  const sum = (key: 'requiredQty' | 'deliveredQty') =>
    materials.reduce((acc, m) => acc + Number(m[key] || 0), 0);
  const required = sum('requiredQty');
  const readiness = required > 0 ? Math.round((sum('deliveredQty') / required) * 100) : 0;
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Project / operations</h2>
        <SupplyStatusBadge status={first.status} />
      </div>
      <RelatedLink kind="Project" href={`/projects/${first.id}`}>
        {first.number}
      </RelatedLink>
      {materials.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Required {fmtQty(String(required))} · material readiness {readiness}%
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No material requirements yet.</p>
      )}
    </Card>
  );
}

function LeadQuotationsCard({
  leadId,
  quotes,
  visits,
}: {
  leadId: string;
  quotes: QuoteList;
  visits: VisitList;
}) {
  const router = useRouter();
  const access = useCrossModuleAccess();
  const create = useCreateQuotation();
  const selectId = useId();
  const [visitChoice, setVisitChoice] = useState<string | null>(null);

  // most recent COMPLETED visit first — only known when the caller can see Field visits
  const completed = access.fieldVisits
    ? [...(visits.data?.items ?? [])]
        .filter((v) => v.status === 'COMPLETED')
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    : [];
  const visitId = visitChoice ?? completed[0]?.id ?? '';

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Quotations</h2>
        {access.createQuotation ? (
          <div className="flex flex-wrap items-center gap-2">
            {completed.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <label htmlFor={selectId} className="text-xs text-muted-foreground">
                  Prepared from visit
                </label>
                <select
                  id={selectId}
                  className="h-8 max-w-44 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  value={visitId}
                  onChange={(e) => setVisitChoice(e.target.value)}
                >
                  {completed.map((v) => (
                    <option key={v.id} value={v.id}>
                      {new Date(v.scheduledAt).toLocaleDateString()}
                      {v.outcome ? ` · ${visitOutcomeLabel(v.outcome)}` : ''}
                    </option>
                  ))}
                  <option value="">No visit reference</option>
                </select>
              </div>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={create.isPending}
              onClick={async () => {
                const q = await create.mutateAsync({ leadId, ...(visitId ? { visitId } : {}) });
                router.push(`/quotations/${q.id}`);
              }}
            >
              {create.isPending ? 'Creating…' : 'New'}
            </Button>
          </div>
        ) : null}
      </div>
      <ErrorNote error={create.error} />
      {quotes.isLoading ? (
        <Skeleton rows={2} />
      ) : quotes.error ? (
        <ErrorNote error={quotes.error} />
      ) : (quotes.data?.items ?? []).length === 0 ? (
        <EmptyState title="No quotations yet">
          {access.createQuotation
            ? 'Quotations priced for this lead appear here. Use New above to start one.'
            : 'Quotations prepared for this lead will appear here.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {quotes.data!.items.map((q) => (
            <li
              key={q.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"
            >
              <div className="min-w-0">
                <RelatedLink kind="Quotation" href={`/quotations/${q.id}`}>
                  {q.number}
                </RelatedLink>
                <div className="text-xs text-muted-foreground">
                  rev {q.currentRevisionNo} · {fmtMoney(q.total)}
                  {q.validityDate ? ` · valid to ${fmtDate(q.validityDate)}` : ''}
                </div>
                {q.visit ? (
                  <div className="text-xs text-muted-foreground">
                    From visit {new Date(q.visit.scheduledAt).toLocaleDateString()}
                    {q.visit.outcome ? ` · ${visitOutcomeLabel(q.visit.outcome)}` : ''}
                  </div>
                ) : null}
              </div>
              <SupplyStatusBadge status={q.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---- dialogs -----------------------------------------------------

function EditLeadDialog({
  leadId,
  open,
  onClose,
}: {
  leadId: string;
  open: boolean;
  onClose: () => void;
}) {
  const lead = useLead(leadId);
  const update = useUpdateLead(leadId);
  const toast = useToast();
  const l = lead.data;
  const [form, setForm] = useState({ name: '', phone: '', email: '', city: '', state: '' });

  useEffect(() => {
    if (open && l) {
      setForm({
        name: l.name ?? '',
        phone: l.phone ?? '',
        email: l.email ?? '',
        city: l.city ?? '',
        state: l.state ?? '',
      });
    }
  }, [open, l]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit lead"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-lead-form"
            disabled={update.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="edit-lead-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await update.mutateAsync({
              name: form.name || undefined,
              phone: form.phone || undefined,
              email: form.email || undefined,
              city: form.city || undefined,
              state: form.state || undefined,
            });
            toast.success('Lead updated');
            onClose();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not save');
          }
        }}
        className="space-y-4"
      >
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contact
          </legend>
          <LabelledInput
            label="Name"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <LabelledInput
              label="Phone"
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
            <LabelledInput
              label="Email"
              value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
            />
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Location
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <LabelledInput
              label="City"
              value={form.city}
              onChange={(v) => setForm((f) => ({ ...f, city: v }))}
            />
            <LabelledInput
              label="State"
              value={form.state}
              onChange={(v) => setForm((f) => ({ ...f, state: v }))}
            />
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Industry-specific details live in custom fields, configured under workspace settings.
        </p>
      </form>
    </Dialog>
  );
}

function FollowupDialog({
  leadId,
  open,
  onClose,
}: {
  leadId: string;
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateFollowup(leadId);
  const toast = useToast();
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setDue('');
      setNote('');
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Schedule a follow-up"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!due || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  dueAt: new Date(due).toISOString(),
                  note: note || undefined,
                });
                toast.success('Follow-up scheduled');
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not schedule');
              }
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {create.isPending ? 'Scheduling…' : 'Schedule'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <LabelledInput label="Due" type="datetime-local" value={due} onChange={setDue} />
        <LabelledInput label="Note (optional)" value={note} onChange={setNote} />
        <HelperText>What should you raise or check when you follow up?</HelperText>
      </div>
    </Dialog>
  );
}

// ---- small helpers -------------------------------------------------

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value || '—'}</dd>
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
    </label>
  );
}
