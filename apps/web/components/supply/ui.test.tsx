import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveBadge, fmtMoney, fmtQty, SupplyStatusBadge } from './ui';

describe('supply ui helpers', () => {
  it('trims trailing zeros from quantities and formats money to 2dp', () => {
    expect(fmtQty('10.5000')).toBe('10.5');
    expect(fmtQty('10.000')).toBe('10');
    expect(fmtQty(null)).toBe('—');
    expect(fmtMoney('1000')).toMatch(/1,?000\.00/);
  });

  it('renders status and active pills as semantic Badges', () => {
    render(
      <>
        <SupplyStatusBadge status="PARTIALLY_PAID" />
        <ActiveBadge active={false} />
      </>,
    );
    expect(screen.getByText('partially paid').className).toContain('bg-warning-soft');
    expect(screen.getByText('Inactive').className).toContain('bg-secondary');
  });
});
