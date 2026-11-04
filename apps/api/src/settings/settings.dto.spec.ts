import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCompanyProfileDto } from './settings.dto.js';

const errorsFor = async (body: Partial<UpdateCompanyProfileDto>) => {
  const dto = plainToInstance(UpdateCompanyProfileDto, body);
  return validate(dto);
};

describe('UpdateCompanyProfileDto timezone/defaultCurrency validation', () => {
  it('accepts a real IANA timezone', async () => {
    const errors = await errorsFor({ timezone: 'Asia/Kolkata' });
    expect(errors.filter((e) => e.property === 'timezone')).toHaveLength(0);
  });

  it('rejects a free-text string that is not a real IANA timezone', async () => {
    const errors = await errorsFor({ timezone: 'Not/AZone' });
    expect(errors.find((e) => e.property === 'timezone')).toBeTruthy();
  });

  it('accepts a real ISO-4217 currency code', async () => {
    const errors = await errorsFor({ defaultCurrency: 'USD' });
    expect(errors.filter((e) => e.property === 'defaultCurrency')).toHaveLength(0);
  });

  it('rejects a regex-shaped-but-fake currency code', async () => {
    const errors = await errorsFor({ defaultCurrency: 'XYZ' });
    expect(errors.find((e) => e.property === 'defaultCurrency')).toBeTruthy();
  });

  it('allows both fields to be omitted', async () => {
    const errors = await errorsFor({});
    expect(errors).toHaveLength(0);
  });
});
