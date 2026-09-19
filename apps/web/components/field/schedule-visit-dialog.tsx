'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { Visit } from '@aivoryx/contracts';
import { Dialog } from '@/components/ui/overlays';
import { ErrorNote } from '@/components/admin/ui';
import { useFieldAgents, useScheduleVisit } from '@/lib/field/use-field';
import { useCrossModuleAccess } from '@/lib/navigation/use-cross-module';

const field =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Schedule a Field visit FROM a CRM lead (Phase 18). The lead is the context — its
 * contact and site address stay in CRM and are referenced, never re-typed. The
 * caller sees this only with BOTH CRM lead access and Field create permission
 * (`useCrossModuleAccess().scheduleVisit`); the API enforces the same, plus the
 * caller's CRM data scope.
 */
export function ScheduleVisitDialog({
  open,
  onClose,
  lead,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  lead: { id: string; name: string | null };
  onScheduled?: (visit: Visit) => void;
}) {
  const access = useCrossModuleAccess();
  const schedule = useScheduleVisit();
  const agents = useFieldAgents();
  const [scheduledAt, setScheduledAt] = useState('');
  const [agentId, setAgentId] = useState('');
  const [instructions, setInstructions] = useState('');

  const activeAgents = (agents.data ?? []).filter((a) => a.status === 'active');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Schedule a site visit"
      description={`For ${lead.name ?? 'this lead'} — the lead's contact and address stay in CRM.`}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!scheduledAt) return;
          schedule.mutate(
            {
              leadId: lead.id,
              scheduledAt: new Date(scheduledAt).toISOString(),
              ...(agentId ? { assignedMembershipId: agentId } : {}),
              ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
            },
            {
              onSuccess: (visit) => {
                setScheduledAt('');
                setAgentId('');
                setInstructions('');
                onClose();
                onScheduled?.(visit);
              },
            },
          );
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Date and time</span>
          <input
            type="datetime-local"
            required
            className={field}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
        {access.assignAgent ? (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Field agent (optional)</span>
            <select className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Unassigned — assign later</option>
              {activeAgents.map((a) => (
                <option key={a.membershipId} value={a.membershipId}>
                  {a.userName ?? a.userEmail}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Instructions for the agent (optional)</span>
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={2000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Access details, what to measure, who to ask for…"
          />
        </label>
        <ErrorNote error={schedule.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={schedule.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={schedule.isPending}
            loadingText="Scheduling…"
            disabled={!scheduledAt || schedule.isPending}
          >
            Schedule visit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
