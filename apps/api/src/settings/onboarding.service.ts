import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import type { SecurityContext } from '../security/security-context.js';
import type { TenantScope } from '../supply/common.js';
import type { OnboardingDto, OnboardingStepDto } from './settings.dto.js';
import { CompanyProfileService } from './company-profile.service.js';

const { tenants, tenantOnboarding, tenantAssets, userTenantMemberships, customers, leadSources } =
  schema;

interface StepSpec {
  key: string;
  title: string;
  description: string;
  href: string;
  /** permission the user needs to act on this step */
  permission: string;
}

const STEPS: StepSpec[] = [
  {
    key: 'company_profile',
    title: 'Company profile',
    description: 'Add your company name, address and tax registration so documents look official.',
    href: '/settings/company',
    permission: 'settings.company.update',
  },
  {
    key: 'branding',
    title: 'Upload your logo',
    description: 'Add your logo and brand colour so the workspace and documents feel like yours.',
    href: '/settings/company',
    permission: 'settings.company.update',
  },
  {
    key: 'first_member',
    title: 'Add your first team member',
    description: 'Invite a colleague so you are not working alone.',
    href: '/admin/members',
    permission: 'users.create',
  },
  {
    key: 'first_customer',
    title: 'Add your first customer',
    description: 'Create a customer to quote, invoice and collect payments against.',
    href: '/customers',
    permission: 'customers.create',
  },
  {
    key: 'first_lead_source',
    title: 'Configure a lead source',
    description: 'Set up a lead source so incoming enquiries are captured and attributed.',
    href: '/admin/integrations',
    permission: 'crm.integrations.manage',
  },
];

/**
 * Tenant onboarding checklist (Phase 10, ADR 0039). The steps are DERIVED live
 * from existing data — member/customer/lead-source counts and whether the
 * company profile + a logo exist — so there is no workflow engine and no
 * arbitrary state. The only persisted value is an admin's dismissal. The
 * checklist is role-aware: a user only sees steps they hold the permission to
 * act on (RBAC, not a new permission system).
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly profiles: CompanyProfileService) {}

  async get(scope: TenantScope, ctx: SecurityContext): Promise<OnboardingDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [tenant] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId))
        .limit(1);
      const [ob] = await tx
        .select({ dismissedAt: tenantOnboarding.dismissedAt })
        .from(tenantOnboarding)
        .where(eq(tenantOnboarding.tenantId, scope.tenantId))
        .limit(1);

      const profile = await this.profiles.loadProfile(tx, scope.tenantId);
      const [memberRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.tenantId, scope.tenantId),
            sql`${userTenantMemberships.status} in ('active','invited')`,
          ),
        );
      const [customerRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(eq(customers.tenantId, scope.tenantId));
      const [sourceRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leadSources)
        .where(eq(leadSources.tenantId, scope.tenantId));
      const [logoRow] = await tx
        .select({ id: tenantAssets.id })
        .from(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, 'logo')))
        .limit(1);

      const profileDone = !!(
        profile?.displayName?.trim() &&
        profile.addressLine?.trim() &&
        (profile.email?.trim() || profile.phone?.trim())
      );
      const brandingDone = !!(logoRow || profile?.primaryColor);
      const done: Record<string, boolean> = {
        company_profile: profileDone,
        branding: brandingDone,
        first_member: (memberRow?.n ?? 0) > 1,
        first_customer: (customerRow?.n ?? 0) > 0,
        first_lead_source: (sourceRow?.n ?? 0) > 0,
      };

      const steps: OnboardingStepDto[] = STEPS.filter((s) => ctx.permissions.has(s.permission)).map(
        (s) => ({
          key: s.key,
          title: s.title,
          description: s.description,
          done: done[s.key] ?? false,
          href: s.href,
        }),
      );

      const complete = steps.length > 0 && steps.every((s) => s.done);
      const dismissed = !!ob?.dismissedAt;
      return {
        workspaceName: tenant?.name ?? 'Workspace',
        complete,
        dismissed,
        show: steps.length > 0 && !complete && !dismissed,
        steps,
      };
    });
  }

  async dismiss(scope: TenantScope): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await tx
        .insert(tenantOnboarding)
        .values({
          tenantId: scope.tenantId,
          dismissedAt: new Date(),
          dismissedByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoUpdate({
          target: tenantOnboarding.tenantId,
          set: {
            dismissedAt: new Date(),
            dismissedByMembershipId: scope.actorMembershipId,
            updatedAt: new Date(),
          },
        });
    });
  }
}
