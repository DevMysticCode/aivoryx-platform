import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RelatedLink } from './related-link';

afterEach(cleanup);

describe('RelatedLink', () => {
  it('is a real link (not a clickable div) pointing at the owning module’s screen', () => {
    render(
      <RelatedLink href="/crm/leads/abc" kind="Lead" meta="Qualified">
        Ravi Menon
      </RelatedLink>,
    );
    const link = screen.getByRole('link', { name: /lead ravi menon/i });
    expect(link.getAttribute('href')).toBe('/crm/leads/abc');
    expect(link.textContent).toContain('Qualified');
  });
});
