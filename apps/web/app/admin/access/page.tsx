'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import type { AccessRole } from '@aivoryx/contracts';
import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock, Confirm } from '@/components/ui/kit';
import { useToast } from '@/components/ui/toast';
import { useMembers } from '@/lib/admin/use-admin';
import {
  useAccessRoles,
  useAvailablePermissions,
  useDeleteAccessRole,
} from '@/lib/access/use-access-admin';
import { RoleEditor } from '@/components/access/role-editor';
import { UserAccessPanel } from '@/components/access/user-access-panel';

type Tab = 'users' | 'profiles' | 'permission-sets';

const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'profiles', label: 'Profiles' },
  { key: 'permission-sets', label: 'Permission sets' },
];

export default function AccessPage() {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Access"
        description="Define what people in your workspace can do — through profiles, permission sets, and data scope."
      />

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t.key
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' ? <UsersTab /> : <RolesTab kind={tab} />}
    </div>
  );
}

function UsersTab() {
  const members = useMembers();
  const profiles = useAccessRoles('profiles');
  const sets = useAccessRoles('permission-sets');
  const [selected, setSelected] = useState<string | null>(null);

  if (members.isLoading) return <LoadingBlock />;
  if (members.error) return <ErrorBlock error={members.error} onRetry={() => members.refetch()} />;

  const active = (members.data ?? []).filter((m) => m.status !== 'invited');
  const current = active.find((m) => m.membershipId === selected) ?? active[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <ul className="space-y-1 lg:max-h-[70vh] lg:overflow-y-auto lg:border-r lg:pr-2">
        {active.map((m) => (
          <li key={m.membershipId}>
            <button
              type="button"
              onClick={() => setSelected(m.membershipId)}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm',
                (current?.membershipId ?? '') === m.membershipId
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span className="block truncate">{m.name ?? m.email}</span>
              <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
            </button>
          </li>
        ))}
      </ul>

      {current ? (
        <UserAccessPanel
          key={current.membershipId}
          membershipId={current.membershipId}
          memberName={current.name ?? current.email}
          profiles={profiles.data ?? []}
          permissionSets={sets.data ?? []}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No members to configure yet.</p>
      )}
    </div>
  );
}

function RolesTab({ kind }: { kind: 'profiles' | 'permission-sets' }) {
  const roles = useAccessRoles(kind);
  const available = useAvailablePermissions();
  const del = useDeleteAccessRole(kind);
  const toast = useToast();
  const [editing, setEditing] = useState<AccessRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AccessRole | null>(null);

  const label = kind === 'profiles' ? 'profile' : 'permission set';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {kind === 'profiles'
            ? 'A profile is a member’s baseline capability set.'
            : 'Permission sets grant extra access on top of a profile — they are additive.'}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden /> New {label}
        </button>
      </div>

      {roles.isLoading ? (
        <LoadingBlock />
      ) : roles.error ? (
        <ErrorBlock error={roles.error} onRetry={() => roles.refetch()} />
      ) : (roles.data ?? []).length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm">
          <p className="font-medium">No {label}s yet</p>
          <p className="mt-1 text-muted-foreground">
            Create one to start assigning access to members.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {roles.data!.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.description || `${r.permissionKeys.length} permissions`} · {r.assignedCount}{' '}
                  member{r.assignedCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  aria-label={`Edit ${r.name}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(r)}
                  aria-label={`Delete ${r.name}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RoleEditor
        kind={kind}
        role={editing}
        open={!!editing || creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        available={available.data ?? []}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(`${label} deleted`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete');
          } finally {
            setDeleting(null);
          }
        }}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete"
        danger
        pending={del.isPending}
        body={
          deleting?.assignedCount
            ? `This ${label} is assigned to ${deleting.assignedCount} member(s). Remove it from them first.`
            : `This ${label} will be permanently removed.`
        }
      />
    </div>
  );
}
