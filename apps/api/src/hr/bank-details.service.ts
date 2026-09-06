import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { HrScope } from './common.js';
import type { BankDetailsDto, UpsertBankDetailsDto } from './hr.dto.js';

const { employeeBankDetails, employees } = schema;

/**
 * Employee bank / payment details (Phase 12, ADR 0041) — HIGHLY SENSITIVE.
 *
 * Protection model (documented in HR-WORKFORCE.md):
 *  - dedicated narrow permissions `hr.bank_details.read` / `hr.bank_details.manage`,
 *    NOT implied by general HR-read;
 *  - the account number is MASKED in every DTO (last 4 digits only) and is never
 *    returned in full through any API in this phase;
 *  - it never enters audit metadata, notification payloads or logs;
 *  - tenant RLS + a composite FK keep it isolated per tenant;
 *  - at-rest encryption is provided by the managed Postgres infrastructure
 *    (Railway); no bespoke application crypto is introduced.
 */
@Injectable()
export class BankDetailsService {
  constructor(private readonly audit: AuditService) {}

  get(scope: HrScope, employeeId: string): Promise<BankDetailsDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, employeeId);
      const [row] = await tx
        .select()
        .from(employeeBankDetails)
        .where(
          and(
            eq(employeeBankDetails.tenantId, scope.tenantId),
            eq(employeeBankDetails.employeeId, employeeId),
          ),
        )
        .limit(1);
      if (!row) throw new AppError('HR_BANK_DETAILS_NOT_FOUND');
      return this.toDto(row);
    });
  }

  async upsert(
    scope: HrScope,
    employeeId: string,
    body: UpsertBankDetailsDto,
  ): Promise<BankDetailsDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireEmployee(tx, scope.tenantId, employeeId);
      const values = {
        tenantId: scope.tenantId,
        employeeId,
        accountHolderName: body.accountHolderName.trim(),
        bankName: body.bankName?.trim() || null,
        accountNumber: body.accountNumber.trim(),
        branch: body.branch?.trim() || null,
        bankIdentifier: body.bankIdentifier?.trim() || null,
        swiftBic: body.swiftBic?.trim() || null,
        preferredMethod: (body.preferredMethod as 'BANK_TRANSFER') ?? 'BANK_TRANSFER',
        updatedByMembershipId: scope.actorMembershipId,
      };
      const [row] = await tx
        .insert(employeeBankDetails)
        .values(values)
        .onConflictDoUpdate({
          target: [employeeBankDetails.tenantId, employeeBankDetails.employeeId],
          set: {
            accountHolderName: values.accountHolderName,
            bankName: values.bankName,
            accountNumber: values.accountNumber,
            branch: values.branch,
            bankIdentifier: values.bankIdentifier,
            swiftBic: values.swiftBic,
            preferredMethod: values.preferredMethod,
            updatedByMembershipId: scope.actorMembershipId,
            updatedAt: new Date(),
          },
        })
        .returning();

      // audit records the EVENT only — never the account number or any digits
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.bank_details.updated',
        entityType: 'employee_bank_details',
        entityId: employeeId,
        actor: userActor(scope),
        metadata: { preferredMethod: values.preferredMethod, bankNameSet: !!values.bankName },
      });
      return this.toDto(row!);
    });
  }

  private toDto(r: schema.EmployeeBankDetailsRow): BankDetailsDto {
    const acct = r.accountNumber ?? '';
    const last4 = acct.slice(-4);
    return {
      accountHolderName: r.accountHolderName,
      bankName: r.bankName,
      accountNumberMasked:
        acct.length > 4 ? `${'•'.repeat(Math.min(acct.length - 4, 12))}${last4}` : '••••',
      branch: r.branch,
      bankIdentifier: r.bankIdentifier,
      swiftBic: r.swiftBic,
      preferredMethod: r.preferredMethod,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async requireEmployee(tx: Tx, tenantId: string, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .limit(1);
    if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
  }
}
