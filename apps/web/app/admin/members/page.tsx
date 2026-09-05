'use client';

import { useState } from 'react';
import type { InviteMemberResponse, Member } from '@aivoryx/contracts';
import { Button, cn } from '@aivoryx/ui';
import {
  useAssignRole,
  useInviteMember,
  useMembers,
  useRemoveMember,
  useRemoveRole,
  useRoles,
  useSetMemberStatus,
} from '@/lib/admin/use-admin';
import {
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  RoleChip,
  Skeleton,
  StatusBadge,
} from '@/components/admin/ui';

export default function MembersPage() {
  const members = useMembers();
  const roles = useRoles();
  const invite = useInviteMember();
  const [handoff, setHandoff] = useState<InviteMemberResponse | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    const res = await invite.mutateAsync({
      email: email.trim(),
      name: name.trim() || undefined,
    });
    setHandoff(res);
    setEmail('');
    setName('');
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Members"
        description="Invite people, manage their access, and assign platform roles. Access is enforced by the server."
      />

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Invite a member</h2>
        <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={invite.isPending || email.trim().length === 0}>
            {invite.isPending ? 'Inviting…' : 'Send invite'}
          </Button>
        </form>
        <ErrorNote error={invite.error} />
        {handoff ? (
          <InvitationHandoff handoff={handoff} onDismiss={() => setHandoff(null)} />
        ) : null}
      </Card>

      {members.isLoading || roles.isLoading ? (
        <Skeleton rows={5} />
      ) : members.error ? (
        <ErrorNote error={members.error} />
      ) : members.data && members.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Roles</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.data.map((member) => (
                <MemberRow
                  key={member.membershipId}
                  member={member}
                  availableRoles={(roles.data ?? []).map((r) => ({ key: r.key, name: r.name }))}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No members yet. Invite someone above to get started.</EmptyState>
      )}
    </section>
  );
}

function InvitationHandoff({
  handoff,
  onDismiss,
}: {
  handoff: InviteMemberResponse;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const acceptUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/accept-invitation?token=${encodeURIComponent(handoff.invitation.token)}`
      : handoff.invitation.token;

  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="font-medium">Invitation created for {handoff.member.email}</p>
      <p className="text-muted-foreground">
        No email provider is configured. Copy this one-time link and send it to the invitee — it is
        shown only once.
      </p>
      <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
        {acceptUrl}
      </code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(acceptUrl);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  availableRoles,
}: {
  member: Member;
  availableRoles: { key: string; name: string }[];
}) {
  const setStatus = useSetMemberStatus();
  const remove = useRemoveMember();
  const assignRole = useAssignRole();
  const removeRole = useRemoveRole();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const heldKeys = new Set(member.roles.map((r) => r.key));
  const assignable = availableRoles.filter((r) => !heldKeys.has(r.key));
  const busy =
    setStatus.isPending || remove.isPending || assignRole.isPending || removeRole.isPending;
  const rowError = setStatus.error ?? remove.error ?? assignRole.error ?? removeRole.error ?? null;

  return (
    <>
      <tr className={cn(busy && 'opacity-60')}>
        <td className="px-3 py-2">
          <div className="font-medium">{member.name ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{member.email}</div>
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={member.status} />
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {member.roles.length === 0 ? (
              <span className="text-xs text-muted-foreground">None</span>
            ) : (
              member.roles.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  title={`Remove ${r.name}`}
                  disabled={busy}
                  onClick={() =>
                    removeRole.mutate({ membershipId: member.membershipId, roleKey: r.key })
                  }
                  className="group"
                >
                  <RoleChip>
                    {r.key}{' '}
                    <span className="text-muted-foreground group-hover:text-destructive">×</span>
                  </RoleChip>
                </button>
              ))
            )}
            {assignable.length > 0 ? (
              <select
                aria-label={`Add role to ${member.email}`}
                disabled={busy}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    assignRole.mutate({
                      membershipId: member.membershipId,
                      roleKey: e.target.value,
                    });
                  }
                }}
                className="h-6 rounded border bg-transparent px-1 text-xs"
              >
                <option value="">+ role</option>
                {assignable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.key}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {new Date(member.joinedAt).toLocaleDateString()}
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-2">
            {member.status === 'suspended' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ membershipId: member.membershipId, status: 'active' })
                }
              >
                Reactivate
              </Button>
            ) : member.status === 'active' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setStatus.mutate({ membershipId: member.membershipId, status: 'suspended' })
                }
              >
                Suspend
              </Button>
            ) : null}
            {confirmRemove ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => remove.mutate(member.membershipId)}
                >
                  Confirm remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </Button>
            )}
          </div>
        </td>
      </tr>
      {rowError ? (
        <tr>
          <td colSpan={5} className="px-3 pb-2">
            <ErrorNote error={rowError} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
