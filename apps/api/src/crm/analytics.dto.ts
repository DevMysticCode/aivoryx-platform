import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'] as const;
const FUNNEL_STAGES = ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'CONVERTED'] as const;

export class AnalyticsOverviewQueryDto {
  @ApiProperty({ required: false, minimum: 7, maximum: 90, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(90)
  days?: number;
}

export class TrendPointDto {
  @ApiProperty() date!: string;
  @ApiProperty() count!: number;
}

export class TrendDeltaDto {
  @ApiProperty() thisWeek!: number;
  @ApiProperty() previousWeek!: number;
  @ApiProperty({ nullable: true, type: Number }) changePct!: number | null;
}

export class FunnelStageDto {
  @ApiProperty({ enum: FUNNEL_STAGES }) stage!: string;
  @ApiProperty() count!: number;
  @ApiProperty({ nullable: true, type: Number }) conversionFromStart!: number | null;
  @ApiProperty({ nullable: true, type: Number }) conversionFromPrevious!: number | null;
}

export class SourcePerformanceDto {
  @ApiProperty({ nullable: true, type: String }) sourceId!: string | null;
  @ApiProperty() sourceName!: string;
  @ApiProperty() total!: number;
  @ApiProperty() qualified!: number;
  @ApiProperty() converted!: number;
  @ApiProperty({ nullable: true, type: Number }) qualificationRate!: number | null;
  @ApiProperty({ nullable: true, type: Number }) conversionRate!: number | null;
}

export class FollowupItemDto {
  @ApiProperty({ format: 'uuid' }) followupId!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ nullable: true, type: String }) leadName!: string | null;
  @ApiProperty() dueAt!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

export class FollowupSummaryDto {
  @ApiProperty() overdueCount!: number;
  @ApiProperty() dueTodayCount!: number;
  @ApiProperty() upcomingCount!: number;
  @ApiProperty({ type: [FollowupItemDto] }) overdue!: FollowupItemDto[];
  @ApiProperty({ type: [FollowupItemDto] }) dueToday!: FollowupItemDto[];
  @ApiProperty({ type: [FollowupItemDto] }) upcoming!: FollowupItemDto[];
}

export class RecentLeadItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) sourceName!: string | null;
  @ApiProperty({ nullable: true, type: String }) assigneeName!: string | null;
  @ApiProperty() updatedAt!: string;
}

export class RecentActivityItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) leadId!: string;
  @ApiProperty({ nullable: true, type: String }) leadName!: string | null;
  @ApiProperty() type!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty() createdAt!: string;
}

export class TeamPerformanceRowDto {
  @ApiProperty({ format: 'uuid' }) membershipId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() email!: string;
  @ApiProperty() leads!: number;
  @ApiProperty() qualified!: number;
  @ApiProperty() converted!: number;
  @ApiProperty() pendingFollowups!: number;
}

export class TotalsDto {
  @ApiProperty() total!: number;
  @ApiProperty() open!: number;
  @ApiProperty() unassigned!: number;
  @ApiProperty({ type: Object, additionalProperties: { type: 'number' } })
  byStatus!: Record<string, number>;
}

export class CrmAnalyticsOverviewDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty() rangeDays!: number;
  @ApiProperty({ enum: SCOPES }) scope!: string;
  @ApiProperty({ type: TotalsDto }) totals!: TotalsDto;
  @ApiProperty({ type: [TrendPointDto] }) trend!: TrendPointDto[];
  @ApiProperty({ nullable: true, type: TrendDeltaDto }) trendDelta!: TrendDeltaDto | null;
  @ApiProperty({ type: [FunnelStageDto] }) funnel!: FunnelStageDto[];
  @ApiProperty({ type: [SourcePerformanceDto] }) sources!: SourcePerformanceDto[];
  @ApiProperty({ type: FollowupSummaryDto }) followups!: FollowupSummaryDto;
  @ApiProperty({ type: [RecentLeadItemDto] }) recent!: RecentLeadItemDto[];
  @ApiProperty({ type: [RecentActivityItemDto] }) recentActivity!: RecentActivityItemDto[];
  @ApiProperty({ nullable: true, type: [TeamPerformanceRowDto] })
  team!: TeamPerformanceRowDto[] | null;
}

export { SCOPES as ANALYTICS_SCOPES, FUNNEL_STAGES as ANALYTICS_FUNNEL_STAGES };
