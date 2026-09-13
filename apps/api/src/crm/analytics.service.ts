import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import type { DataScope } from '@aivoryx/db';
import {
  bucketDailyCounts,
  computeFunnel,
  computeSourcePerformance,
  followupBucket,
  weekOverWeekDelta,
  type DailyCount,
  type FunnelStageResult,
  type SourcePerformanceResult,
} from './analytics-calc.js';

const {
  leads,
  leadSources,
  leadFollowups,
  leadActivities,
  membershipRoles,
  roles,
  users,
  userTenantMemberships,
} = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

export interface FollowupItem {
  followupId: string;
  leadId: string;
  leadName: string | null;
  dueAt: string;
  note: string | null;
}

export interface RecentLeadItem {
  id: string;
  name: string | null;
  phone: string | null;
  status: string;
  sourceName: string | null;
  assigneeName: string | null;
  updatedAt: string;
}

export interface RecentActivityItem {
  id: string;
  leadId: string;
  leadName: string | null;
  type: string;
  actorName: string | null;
  createdAt: string;
}

export interface TeamPerformanceRow {
  membershipId: string;
  name: string | null;
  email: string;
  leads: number;
  qualified: number;
  converted: number;
  pendingFollowups: number;
}

export interface CrmAnalyticsOverview {
  generatedAt: string;
  rangeDays: number;
  scope: DataScope;
  totals: {
    total: number;
    open: number;
    unassigned: number;
    byStatus: Record<string, number>;
  };
  trend: DailyCount[];
  trendDelta: ReturnType<typeof weekOverWeekDelta>;
  funnel: FunnelStageResult[];
  sources: SourcePerformanceResult[];
  followups: {
    overdueCount: number;
    dueTodayCount: number;
    upcomingCount: number;
    overdue: FollowupItem[];
    dueToday: FollowupItem[];
    upcoming: FollowupItem[];
  };
  recent: RecentLeadItem[];
  recentActivity: RecentActivityItem[];
  /** null when the caller's data scope is OWN — team analytics are not computed, not merely hidden */
  team: TeamPerformanceRow[] | null;
}

const ITEM_CAP = 5;
const RECENT_LEADS_CAP = 8;
const RECENT_ACTIVITY_CAP = 8;

/**
 * Read-only CRM analytics (Phase 13D). One dedicated aggregation service —
 * not a generic analytics engine. Every number is derived from an actual
 * query; nothing is fabricated. Tenant-scoped (RLS via `withTenantContext`)
 * and additionally scoped by the caller's CRM **data scope**: `OWN` restricts
 * every section (including omitting team performance entirely — the backend
 * never computes data it should not disclose); `TEAM`/`DEPARTMENT`/`COMPANY`
 * see the full tenant view. This reuses the existing `roles.kind='profile'` +
 * `membership_roles.data_scope` model — no second authorization system.
 */
@Injectable()
export class CrmAnalyticsService {
  async overview(scope: TenantScope, rangeDays: number): Promise<CrmAnalyticsOverview> {
    const days = Math.min(Math.max(rangeDays, 7), 90);
    const now = new Date();

    return withTenantContext(getDb(), scope, async (tx) => {
      const dataScope = await this.resolveDataScope(tx, scope);
      const mine = dataScope === 'OWN' ? scope.actorMembershipId : null;

      const [byStatus, trendRows, sourceRows, followupRows, recentRows, activityRows, teamRows] =
        await Promise.all([
          this.statusCounts(tx, mine),
          this.dailyCreatedCounts(tx, days, now, mine),
          this.sourceCounts(tx, mine),
          this.pendingFollowups(tx, mine),
          this.recentLeads(tx, mine),
          this.recentActivity(tx, mine),
          mine ? Promise.resolve(null) : this.teamPerformance(tx),
        ]);

      const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
      const open = (byStatus.NEW ?? 0) + (byStatus.ASSIGNED ?? 0) + (byStatus.CONTACTED ?? 0);
      const unassigned = await this.unassignedCount(tx, mine);

      const trend = bucketDailyCounts(trendRows, days, now);

      const buckets: Record<'overdue' | 'today' | 'upcoming', FollowupItem[]> = {
        overdue: [],
        today: [],
        upcoming: [],
      };
      const bucketCounts = { overdue: 0, today: 0, upcoming: 0 };
      for (const row of followupRows) {
        const bucket = followupBucket(row.dueAt, now);
        bucketCounts[bucket] += 1;
        if (buckets[bucket].length < ITEM_CAP) {
          buckets[bucket].push({
            followupId: row.id,
            leadId: row.leadId,
            leadName: row.leadName,
            dueAt: row.dueAt.toISOString(),
            note: row.note,
          });
        }
      }

      return {
        generatedAt: now.toISOString(),
        rangeDays: days,
        scope: dataScope,
        totals: { total, open, unassigned, byStatus },
        trend,
        trendDelta: weekOverWeekDelta(trend),
        funnel: computeFunnel(byStatus),
        sources: computeSourcePerformance(sourceRows),
        followups: {
          overdueCount: bucketCounts.overdue,
          dueTodayCount: bucketCounts.today,
          upcomingCount: bucketCounts.upcoming,
          overdue: buckets.overdue,
          dueToday: buckets.today,
          upcoming: buckets.upcoming,
        },
        recent: recentRows,
        recentActivity: activityRows,
        team: teamRows,
      };
    });
  }

  /** The caller's CRM data scope: the assigned profile's scope, or COMPANY when no profile is assigned (e.g. TENANT_ADMIN). Mirrors AccessService.effectiveAccess — no second model. */
  private async resolveDataScope(tx: Tx, scope: TenantScope): Promise<DataScope> {
    const [row] = await tx
      .select({ dataScope: membershipRoles.dataScope })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(
        and(eq(membershipRoles.membershipId, scope.actorMembershipId), eq(roles.kind, 'profile')),
      )
      .limit(1);
    return row?.dataScope ?? 'COMPANY';
  }

  private async statusCounts(tx: Tx, mine: string | null): Promise<Record<string, number>> {
    const rows = await tx
      .select({ status: leads.status, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(mine ? eq(leads.assignedMembershipId, mine) : undefined)
      .groupBy(leads.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  private async unassignedCount(tx: Tx, mine: string | null): Promise<number> {
    if (mine) return 0; // "my" view has no concept of unassigned
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(isNull(leads.assignedMembershipId));
    return row?.n ?? 0;
  }

  private async dailyCreatedCounts(
    tx: Tx,
    days: number,
    now: Date,
    mine: string | null,
  ): Promise<{ day: string; count: number }[]> {
    const since = new Date(now);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);
    const rows = await tx
      .select({
        day: sql<string>`to_char(date_trunc('day', ${leads.createdAt}), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(
        and(gte(leads.createdAt, since), mine ? eq(leads.assignedMembershipId, mine) : undefined),
      )
      .groupBy(sql`date_trunc('day', ${leads.createdAt})`);
    return rows.map((r) => ({ day: r.day, count: r.n }));
  }

  private async sourceCounts(
    tx: Tx,
    mine: string | null,
  ): Promise<
    {
      sourceId: string | null;
      sourceName: string;
      total: number;
      qualified: number;
      converted: number;
    }[]
  > {
    const rows = await tx
      .select({
        sourceId: leads.sourceId,
        sourceName: sql<string>`coalesce(${leadSources.name}, 'Manual')`,
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where ${leads.status} in ('QUALIFIED','CONVERTED'))::int`,
        converted: sql<number>`count(*) filter (where ${leads.status} = 'CONVERTED')::int`,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .where(mine ? eq(leads.assignedMembershipId, mine) : undefined)
      .groupBy(leads.sourceId, leadSources.name)
      .orderBy(desc(sql`count(*)`));
    return rows;
  }

  private async pendingFollowups(
    tx: Tx,
    mine: string | null,
  ): Promise<
    { id: string; leadId: string; leadName: string | null; dueAt: Date; note: string | null }[]
  > {
    return tx
      .select({
        id: leadFollowups.id,
        leadId: leadFollowups.leadId,
        leadName: leads.name,
        dueAt: leadFollowups.dueAt,
        note: leadFollowups.note,
      })
      .from(leadFollowups)
      .innerJoin(leads, eq(leads.id, leadFollowups.leadId))
      .where(
        and(
          eq(leadFollowups.status, 'pending'),
          mine ? eq(leadFollowups.assignedMembershipId, mine) : undefined,
        ),
      )
      .orderBy(leadFollowups.dueAt);
  }

  private async recentLeads(tx: Tx, mine: string | null): Promise<RecentLeadItem[]> {
    const rows = await tx
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        status: leads.status,
        sourceName: leadSources.name,
        assigneeName: users.name,
        assigneeEmail: users.email,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, leads.assignedMembershipId))
      .leftJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(mine ? eq(leads.assignedMembershipId, mine) : undefined)
      .orderBy(desc(leads.updatedAt))
      .limit(RECENT_LEADS_CAP);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      status: r.status,
      sourceName: r.sourceName,
      assigneeName: r.assigneeName ?? r.assigneeEmail,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async recentActivity(tx: Tx, mine: string | null): Promise<RecentActivityItem[]> {
    const rows = await tx
      .select({
        id: leadActivities.id,
        leadId: leadActivities.leadId,
        leadName: leads.name,
        type: leadActivities.type,
        actorName: users.name,
        actorEmail: users.email,
        createdAt: leadActivities.createdAt,
        assignedMembershipId: leads.assignedMembershipId,
      })
      .from(leadActivities)
      .innerJoin(leads, eq(leads.id, leadActivities.leadId))
      .leftJoin(
        userTenantMemberships,
        eq(userTenantMemberships.id, leadActivities.actorMembershipId),
      )
      .leftJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(mine ? eq(leads.assignedMembershipId, mine) : undefined)
      .orderBy(desc(leadActivities.createdAt))
      .limit(RECENT_ACTIVITY_CAP);
    return rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      leadName: r.leadName,
      type: r.type,
      actorName: r.actorName ?? r.actorEmail ?? 'System',
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async teamPerformance(tx: Tx): Promise<TeamPerformanceRow[]> {
    const leadRows = await tx
      .select({
        membershipId: leads.assignedMembershipId,
        name: users.name,
        email: users.email,
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where ${leads.status} in ('QUALIFIED','CONVERTED'))::int`,
        converted: sql<number>`count(*) filter (where ${leads.status} = 'CONVERTED')::int`,
      })
      .from(leads)
      .innerJoin(userTenantMemberships, eq(userTenantMemberships.id, leads.assignedMembershipId))
      .innerJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(sql`${leads.assignedMembershipId} is not null`)
      .groupBy(leads.assignedMembershipId, users.name, users.email)
      .orderBy(desc(sql`count(*)`));

    const followupRows = await tx
      .select({
        membershipId: leadFollowups.assignedMembershipId,
        n: sql<number>`count(*)::int`,
      })
      .from(leadFollowups)
      .where(
        and(
          eq(leadFollowups.status, 'pending'),
          sql`${leadFollowups.assignedMembershipId} is not null`,
        ),
      )
      .groupBy(leadFollowups.assignedMembershipId);
    const followupByMember = new Map(followupRows.map((r) => [r.membershipId, r.n]));

    return leadRows.map((r) => ({
      membershipId: r.membershipId!,
      name: r.name,
      email: r.email,
      leads: r.total,
      qualified: r.qualified,
      converted: r.converted,
      pendingFollowups: followupByMember.get(r.membershipId!) ?? 0,
    }));
  }
}
