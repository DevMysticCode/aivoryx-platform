'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useMembers } from '@/lib/admin/use-admin';
import {
  useDeactivateFieldAgent,
  useDesignateFieldAgent,
  useFieldAgents,
} from '@/lib/field/use-field';
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/admin/ui';

/**
 * Minimum field-agent capability management (Phase 4, ADR 0033) — designate
 * or deactivate the field-agent flag on an existing membership. Not an HR
 * employee directory.
 */
export default function FieldAgentsPage() {
  const fieldAgents = useFieldAgents();
  const members = useMembers();
  const designate = useDesignateFieldAgent();
  const deactivate = useDeactivateFieldAgent();
  const [membershipId, setMembershipId] = useState('');

  const agentMembershipIds = new Set((fieldAgents.data ?? []).map((a) => a.membershipId));
  const eligibleMembers = (members.data ?? []).filter(
    (m) => m.status === 'active' && !agentMembershipIds.has(m.membershipId),
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Field agents"
        description="Designate which workspace members can work site visits from the field app."
      />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Designate a field agent</h2>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!membershipId) return;
            await designate.mutateAsync({ membershipId });
            setMembershipId('');
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Member</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={membershipId}
              onChange={(e) => setMembershipId(e.target.value)}
            >
              <option value="">Choose a member…</option>
              {eligibleMembers.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={designate.isPending || !membershipId}>
            {designate.isPending ? 'Designating…' : 'Designate'}
          </Button>
        </form>
        <ErrorNote error={designate.error} />
      </Card>

      {fieldAgents.isLoading ? (
        <Skeleton rows={4} />
      ) : fieldAgents.error ? (
        <ErrorNote error={fieldAgents.error} />
      ) : fieldAgents.data && fieldAgents.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Designated</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {fieldAgents.data.map((agent) => (
                <tr key={agent.membershipId}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{agent.userName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{agent.userEmail}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={agent.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(agent.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    {agent.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deactivate.isPending}
                        onClick={() => deactivate.mutate(agent.membershipId)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={designate.isPending}
                        onClick={() => designate.mutate({ membershipId: agent.membershipId })}
                      >
                        Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No field agents designated yet.</EmptyState>
      )}
      <ErrorNote error={deactivate.error} />
    </section>
  );
}
