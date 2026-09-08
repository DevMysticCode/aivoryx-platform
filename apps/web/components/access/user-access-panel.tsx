'use client';

import { useState } from 'react';
import { Check, Minus, ShieldCheck } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import type { AccessRole } from '@aivoryx/contracts';
import { useToast } from '@/components/ui/toast';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import {
  useEffectiveAccess,
  useAssignProfile,
  useAddPermissionSet,
  useRemovePermissionSet,
} from '@/lib/access/use-access-admin';

const SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'] as const;
const SCOPE_HELP: Record<(typeof SCOPES)[number], string> = {
  OWN: 'Only records they own',
  TEAM: 'Their team’s records',
  DEPARTMENT: 'Their department’s records',
  COMPANY: 'All company records',
};

/**
 * The per-user access editor (§16, §17): assign a profile + data scope, add or
 * remove permission sets, and read the resulting effective access per module —
 * entitlement-aware, with data scope shown where it applies.
 */
export function UserAccessPanel({
  membershipId,
  memberName,
  profiles,
  permissionSets,
}: {
  membershipId: string;
  memberName: string;
  profiles: AccessRole[];
  permissionSets: AccessRole[];
}) {
  const toast = useToast();
  const effective = useEffectiveAccess(membershipId);
  const assign = useAssignProfile(membershipId);
  const addSet = useAddPermissionSet(membershipId);
  const removeSet = useRemovePermissionSet(membershipId);
  const [profileId, setProfileId] = useState('');
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('COMPANY');

  const data = effective.data;
  const currentSetIds = new Set(data?.permissionSets.map((s) => s.id) ?? []);

  return (
    <div className="space-y-5">
      <p className="rounded-md border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        Access is determined by your company’s enabled modules, this member’s profile, any
        additional permission sets, and the profile’s data scope.
      </p>

      {effective.isLoading ? (
        <LoadingBlock lines={4} />
      ) : effective.error ? (
        <ErrorBlock error={effective.error} onRetry={() => effective.refetch()} />
      ) : data ? (
        <>
          {/* profile */}
          <section className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Profile</div>
            <div className="space-y-3 p-4">
              {data.profile ? (
                <p className="text-sm">
                  <span className="font-medium">{data.profile.name}</span>
                  <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {data.profile.dataScope}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No profile assigned.</p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Assign profile</span>
                  <select
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">Data scope</span>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {s} — {SCOPE_HELP[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!profileId || assign.isPending}
                  onClick={async () => {
                    try {
                      await assign.mutateAsync({ roleId: profileId, dataScope: scope });
                      toast.success('Profile assigned');
                    } catch {
                      toast.error('Could not assign profile');
                    }
                  }}
                  className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {assign.isPending ? 'Assigning…' : 'Apply'}
                </button>
              </div>
            </div>
          </section>

          {/* permission sets */}
          <section className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">
              Additional permission sets
            </div>
            <ul className="divide-y">
              {permissionSets.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No permission sets defined yet.
                </li>
              ) : (
                permissionSets.map((s) => {
                  const on = currentSetIds.has(s.id);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="text-sm font-medium">{s.name}</span>
                        {s.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {s.description}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        disabled={addSet.isPending || removeSet.isPending}
                        onClick={async () => {
                          try {
                            if (on) await removeSet.mutateAsync(s.id);
                            else await addSet.mutateAsync(s.id);
                            toast.success(on ? 'Removed' : 'Added');
                          } catch {
                            toast.error('Could not update');
                          }
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                          on
                            ? 'hover:bg-destructive/10 hover:text-destructive'
                            : 'hover:bg-primary/10 hover:text-primary',
                        )}
                      >
                        {on ? (
                          <>
                            <Minus className="size-3" /> Remove
                          </>
                        ) : (
                          <>
                            <Check className="size-3" /> Add
                          </>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          {/* effective access */}
          <section className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">
              Effective access — {memberName}
            </div>
            <ul className="divide-y">
              {data.modules.map((m) => {
                const granted = m.permissions.filter((p) => p.granted);
                return (
                  <li key={m.moduleKey} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{m.displayName}</span>
                      {!m.entitled ? (
                        <span className="text-xs text-muted-foreground">
                          Not available for this company
                        </span>
                      ) : granted.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No access</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <ShieldCheck className="size-3.5" aria-hidden />
                          {m.dataScope ?? 'COMPANY'}
                        </span>
                      )}
                    </div>
                    {m.entitled && granted.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {granted.map((p) => (
                          <span
                            key={p.key}
                            className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                            title={p.description}
                          >
                            {p.resource.replace(/[._]/g, ' ')} · {p.action.replace(/[._]/g, ' ')}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
