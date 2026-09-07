'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import type { AccessRole, AvailablePermission } from '@aivoryx/contracts';
import { Dialog } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { PermissionPicker } from './permission-picker';
import { useCreateAccessRole, useUpdateAccessRole } from '@/lib/access/use-access-admin';

type Kind = 'profiles' | 'permission-sets';

/** Create / edit a Profile or Permission Set (§14, §15). */
export function RoleEditor({
  kind,
  role,
  open,
  onClose,
  available,
}: {
  kind: Kind;
  role: AccessRole | null;
  open: boolean;
  onClose: () => void;
  available: AvailablePermission[];
}) {
  const toast = useToast();
  const create = useCreateAccessRole(kind);
  const update = useUpdateAccessRole(kind);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(role?.name ?? '');
      setDescription(role?.description ?? '');
      setSelected(new Set(role?.permissionKeys ?? []));
      setError(null);
    }
  }, [open, role]);

  const label = kind === 'profiles' ? 'profile' : 'permission set';
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give this ' + label + ' a name.');
      return;
    }
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      permissionKeys: [...selected],
    };
    try {
      if (role) await update.mutateAsync({ roleId: role.id, body });
      else await create.mutateAsync(body);
      toast.success(role ? `${label} updated` : `${label} created`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCESS_PERMISSION_NOT_AVAILABLE') {
        const mod = (err.body?.error.details as { module?: string })?.module;
        setError(
          `That permission belongs to ${mod ?? 'a module'} your company is not entitled to. Ask your Aivoryx contact to enable it first.`,
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={role ? `Edit ${role.name}` : `New ${label}`}
      description={
        kind === 'permission-sets'
          ? 'Permission sets are additive — they grant extra access on top of a member’s profile.'
          : 'A profile is a member’s baseline access, assigned with a data scope.'
      }
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
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Saving…' : role ? 'Save changes' : `Create ${label}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={kind === 'profiles' ? 'Sales Executive' : 'CRM Read Only'}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Optional"
            />
          </label>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium">
            Permissions <span className="text-muted-foreground">({selected.size} selected)</span>
          </p>
          <PermissionPicker available={available} selected={selected} onChange={setSelected} />
        </div>
      </div>
    </Dialog>
  );
}
