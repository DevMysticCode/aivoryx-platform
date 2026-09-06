import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static privacy guard (Phase 12, ADR 0041): the generated API contract must
 * never expose an unmasked bank account number, and salary / bank fields must
 * never appear on the employee list or detail response schemas. This runs on
 * the checked-in `openapi.json` so a regression fails CI before it ships.
 */
describe('HR bank-detail & salary privacy — contract', () => {
  const openapiPath = fileURLToPath(
    new URL('../../../../packages/contracts/openapi/openapi.json', import.meta.url),
  );
  const doc = JSON.parse(readFileSync(openapiPath, 'utf8')) as {
    components: {
      schemas: Record<string, { properties?: Record<string, unknown>; example?: unknown }>;
    };
  };
  const schemas = doc.components.schemas;

  it('the bank-details RESPONSE exposes only a masked account number', () => {
    const bank = schemas.BankDetailsDto;
    expect(bank, 'BankDetailsDto present').toBeDefined();
    const props = Object.keys(bank?.properties ?? {});
    expect(props).toContain('accountNumberMasked');
    expect(props).not.toContain('accountNumber');
    // the masked example must not contain 4+ consecutive real digits beyond the last-4 stub
    const example = String(
      (bank?.properties?.accountNumberMasked as { example?: string } | undefined)?.example ?? '',
    );
    expect(example).not.toMatch(/\d{5,}/);
  });

  it('the bank-details REQUEST carries no example account digits', () => {
    const upsert = schemas.UpsertBankDetailsDto;
    const acct = upsert?.properties?.accountNumber as { example?: string } | undefined;
    expect(acct?.example ?? '').not.toMatch(/\d{4,}/);
  });

  it('the employee list & detail response schemas carry no salary or bank fields', () => {
    for (const name of ['EmployeeListItemDto', 'EmployeeDetailDto']) {
      const props = Object.keys(schemas[name]?.properties ?? {});
      for (const banned of [
        'baseSalary',
        'salary',
        'compensation',
        'accountNumber',
        'accountNumberMasked',
        'bankName',
        'bankIdentifier',
        'swiftBic',
      ]) {
        expect(props, `${name}.${banned}`).not.toContain(banned);
      }
    }
  });

  it('no response schema anywhere re-introduces a raw accountNumber field', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      if (name === 'UpsertBankDetailsDto') continue; // the sole legitimate input
      expect(Object.keys(schema.properties ?? {}), name).not.toContain('accountNumber');
    }
  });
});
