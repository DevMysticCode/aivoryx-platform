import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { validateLogoFile, type LogoFileInput } from '../settings/tenant-logo.service.js';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import type { TenantScope } from '../supply/common.js';

const { customers } = schema;

/**
 * Optional customer logo (Phase 19). Bytes live in the provider-neutral object
 * storage under a tenant-namespaced opaque key; only the key + content type are
 * stored on the customer row and neither is ever returned to a client. Uses the
 * same validation as tenant logos. Reads are streamed by an authenticated,
 * tenant-scoped route; another tenant's customer id resolves to "not found".
 */
@Injectable()
export class CustomerLogoService {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(scope: TenantScope, customerId: string, file: LogoFileInput): Promise<void> {
    const meta = validateLogoFile(file);
    const ext = meta.format === 'image/png' ? 'png' : meta.format === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `tenants/${scope.tenantId}/customers/${customerId}/logo/${randomUUID()}.${ext}`;

    await withTenantContext(getDb(), scope, async (tx) => {
      const [existing] = await tx
        .select({ id: customers.id, logoObjectKey: customers.logoObjectKey })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, scope.tenantId)))
        .limit(1);
      if (!existing) throw new AppError('CUSTOMER_NOT_FOUND');

      await this.storage.putObject({ key, body: file.buffer, contentType: meta.format });
      await tx
        .update(customers)
        .set({ logoObjectKey: key, logoContentType: meta.format, logoUpdatedAt: new Date() })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, scope.tenantId)));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        actor: userActor(scope),
        metadata: {
          fields: ['logo'],
          operation: existing.logoObjectKey ? 'replaced' : 'added',
          contentType: meta.format,
          width: meta.width,
          height: meta.height,
        },
      });
      if (existing.logoObjectKey && existing.logoObjectKey !== key) {
        await this.storage.deleteObject(existing.logoObjectKey).catch(() => undefined);
      }
    });
  }

  async remove(scope: TenantScope, customerId: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ id: customers.id, logoObjectKey: customers.logoObjectKey })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, scope.tenantId)))
        .limit(1);
      if (!row) throw new AppError('CUSTOMER_NOT_FOUND');
      if (!row.logoObjectKey)
        throw new AppError('LOGO_NOT_FOUND', { details: { kind: 'customer' } });
      await tx
        .update(customers)
        .set({ logoObjectKey: null, logoContentType: null, logoUpdatedAt: new Date() })
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, scope.tenantId)));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        actor: userActor(scope),
        metadata: { fields: ['logo'], operation: 'removed' },
      });
      await this.storage.deleteObject(row.logoObjectKey).catch(() => undefined);
    });
  }

  async read(
    scope: { tenantId: string; userId: string },
    customerId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const obj = await withTenantContext(getDb(), scope, (tx) =>
      readCustomerLogo(tx, scope.tenantId, customerId, this.storage),
    );
    if (!obj) throw new AppError('LOGO_NOT_FOUND', { details: { kind: 'customer' } });
    return obj;
  }
}

/**
 * Load a customer's logo bytes inside an existing tenant-context transaction.
 * Returns null when the customer (in this tenant) has no logo. Also used by the
 * document render service, and ONLY when the tenant enables customer logos.
 */
export async function readCustomerLogo(
  tx: Tx,
  tenantId: string,
  customerId: string,
  storage: ObjectStorageService,
): Promise<{ body: Buffer; contentType: string } | null> {
  const [row] = await tx
    .select({ key: customers.logoObjectKey, contentType: customers.logoContentType })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  if (!row?.key) return null;
  const obj = await storage.getObject(row.key);
  return obj ? { body: obj.body, contentType: obj.contentType || row.contentType || '' } : null;
}
