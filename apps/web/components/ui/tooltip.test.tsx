import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@aivoryx/ui';

afterEach(cleanup);

describe('Tooltip', () => {
  it('shows on keyboard focus, is described-by the trigger, and hides on blur / Escape', () => {
    render(
      <Tooltip label="Schedule field visit" delay={0}>
        <button type="button">Go</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(btn);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Schedule field visit');
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on hover and still calls the trigger own handlers', () => {
    let entered = 0;
    render(
      <Tooltip label="Help" delay={0}>
        <button type="button" onMouseEnter={() => (entered += 1)}>
          ?
        </button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(entered).toBe(1);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
});
