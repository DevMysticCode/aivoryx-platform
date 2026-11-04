import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantRequestDto } from './platform.dto.js';

const BASE = {
  name: 'Acme Field Services',
  solutionKey: 'SOLAR_EPC',
  adminEmail: 'admin@acme-field.test',
};

const errorsFor = async (over: Partial<CreateTenantRequestDto>) => {
  const dto = plainToInstance(CreateTenantRequestDto, { ...BASE, ...over });
  return validate(dto);
};

describe('CreateTenantRequestDto timezone/currency validation', () => {
  it('accepts a real IANA timezone and ISO-4217 currency', async () => {
    const errors = await errorsFor({ timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(
      errors.filter((e) => e.property === 'timezone' || e.property === 'currency'),
    ).toHaveLength(0);
  });

  it('rejects a free-text string that is not a real IANA timezone', async () => {
    const errors = await errorsFor({ timezone: 'Not/AZone' });
    expect(errors.find((e) => e.property === 'timezone')).toBeTruthy();
  });

  it('rejects a regex-shaped-but-fake currency code', async () => {
    const errors = await errorsFor({ currency: 'XYZ' });
    expect(errors.find((e) => e.property === 'currency')).toBeTruthy();
  });

  it('allows both fields to be omitted', async () => {
    const errors = await errorsFor({});
    expect(errors).toHaveLength(0);
  });
});
