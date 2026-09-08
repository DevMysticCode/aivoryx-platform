'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, Mail, MapPin, Pencil, Phone, UserRound } from 'lucide-react';
import { cn } from '@aivoryx/ui';
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
  useUpdateLead,
  useUpdateNote,
} from '@/lib/crm/use-crm';
import { useProject, useProjects } from '@/lib/supply/use-supply';
import { useCreateQuotation, useLeadQuotations } from '@/lib/commercial/use-commercial';
import { ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';
import { fmtDate, fmtMoney, fmtQty, SupplyStatusBadge } from '@/components/supply/ui';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { LoadingBlock } from '@/components/ui/kit';

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
  if (lead.error) return <ErrorNote error={lead.error} />;
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
              <h1 className="text-lg font-semibold tracking-tight">{l.name ?? 'Unnamed lead'}</h1>
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
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <Phone className="size-4" aria-hidden /> Call
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setFollowupOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <CalendarClock className="size-4" aria-hidden /> Follow-up
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Pencil className="size-4" aria-hidden /> Edit
            </button>
          </div>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <OverviewTab leadId={id} members={members.data ?? []} />
      ) : tab === 'Activity' ? (
        <ActivityTab leadId={id} />
      ) : tab === 'Follow-ups' ? (
        <FollowupsTab leadId={id} />
      ) : tab === 'Notes' ? (
        <NotesTab leadId={id} />
      ) : (
        <RelatedTab leadId={id} />
      )}

      <EditLeadDialog leadId={id} open={editOpen} onClose={() => setEditOpen(false)} />
      <FollowupDialog leadId={id} open={followupOpen} onClose={() => setFollowupOpen(false)} />
    </section>
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
  const toast = useToast();
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
              onClick={() => {
                logCall.mutate({ outcome: callOutcome });
                toast.success('Call logged');
              }}
            >
              Log
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
  const activities = useActivities(leadId);
  if (activities.isLoading) return <Skeleton rows={4} />;
  if (activities.error) return <ErrorNote error={activities.error} />;
  const items = activities.data ?? [];
  if (items.length === 0)
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        No activity yet.
      </p>
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
            {describePayload(a.payload) ? ` · ${describePayload(a.payload)}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

function describePayload(payload: Record<string, unknown>): string {
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
        <span className="text-[11px] uppercase text-muted-foreground">{f.status}</span>
      </div>
      {f.note ? <p className="mt-0.5 text-sm text-muted-foreground">{f.note}</p> : null}
      {f.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => complete.mutate({ followupId: f.id, body: {} })}
          >
            Complete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              reschedule.mutate({
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
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
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
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
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
          Add
        </Button>
      </form>
      <ErrorNote error={create.error} />
      {notes.isLoading ? (
        <Skeleton rows={3} />
      ) : (notes.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
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
                      onClick={() => {
                        update.mutate({ noteId: n.id, body: { body: editingBody } });
                        setEditingId(null);
                      }}
                    >
                      Save
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
                        className="hover:text-destructive hover:underline"
                        onClick={() => del.mutate(n.id)}
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

function RelatedTab({ leadId }: { leadId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <LeadVisitsCard leadId={leadId} />
      <LeadQuotationsCard leadId={leadId} />
      <LeadProjectCard leadId={leadId} />
    </div>
  );
}

function LeadVisitsCard({ leadId }: { leadId: string }) {
  const visits = useVisits({ leadId, pageSize: 10 });
  if (visits.error) return null;
  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-2 text-sm font-semibold">Site visits</h2>
      {visits.isLoading ? (
        <Skeleton rows={2} />
      ) : (visits.data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No site visits scheduled yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {visits.data!.items.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
            >
              <Link
                href={`/crm/visits/${v.id}`}
                className="font-medium text-primary hover:underline"
              >
                {new Date(v.scheduledAt).toLocaleDateString()}
              </Link>
              <StatusBadge status={v.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadProjectCard({ leadId }: { leadId: string }) {
  const projects = useProjects({ leadId, pageSize: 1 });
  const first = projects.data?.items[0];
  const detail = useProject(first?.id ?? '');
  if (projects.error || (projects.data && projects.data.items.length === 0)) return null;
  if (projects.isLoading || !first) {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-semibold">Project / operations</h2>
        <Skeleton rows={2} />
      </div>
    );
  }
  const materials = detail.data?.materials ?? [];
  const sum = (key: 'requiredQty' | 'deliveredQty') =>
    materials.reduce((acc, m) => acc + Number(m[key] || 0), 0);
  const required = sum('requiredQty');
  const readiness = required > 0 ? Math.round((sum('deliveredQty') / required) * 100) : 0;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
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
        <p className="mt-1 text-xs text-muted-foreground">
          Required {fmtQty(String(required))} · material readiness {readiness}%
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No material requirements yet.</p>
      )}
    </div>
  );
}

function LeadQuotationsCard({ leadId }: { leadId: string }) {
  const router = useRouter();
  const quotes = useLeadQuotations(leadId);
  const create = useCreateQuotation();
  if (quotes.error) return null;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Quotations</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={async () => {
            const q = await create.mutateAsync({ leadId });
            router.push(`/quotations/${q.id}`);
          }}
        >
          {create.isPending ? 'Creating…' : 'New'}
        </Button>
      </div>
      <ErrorNote error={create.error} />
      {quotes.isLoading ? (
        <Skeleton rows={2} />
      ) : (quotes.data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No quotations yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {quotes.data!.items.map((q) => (
            <li
              key={q.id}
              className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
            >
              <div>
                <Link
                  href={`/quotations/${q.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {q.number}
                </Link>
                <div className="text-xs text-muted-foreground">
                  rev {q.currentRevisionNo} · {fmtMoney(q.total)}
                  {q.validityDate ? ` · valid to ${fmtDate(q.validityDate)}` : ''}
                </div>
              </div>
              <SupplyStatusBadge status={q.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
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
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
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
        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}
