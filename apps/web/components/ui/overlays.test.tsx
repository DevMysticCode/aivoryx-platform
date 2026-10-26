import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './overlays';

function Harness({
  initialOpen = false,
  onCloseSpy,
}: {
  initialOpen?: boolean;
  onCloseSpy?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onCloseSpy?.();
        }}
        title="Example dialog"
        description="An example description"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Confirm
            </button>
          </>
        }
      >
        <p>Dialog body content</p>
      </Dialog>
    </>
  );
}

/** A table row whose confirm dialog is the exact shape that produced the
 *  original bug: a `Dialog` rendered from inside `<tbody><tr>`. */
function TableRowWithDialog() {
  const [open, setOpen] = useState(false);
  return (
    <table>
      <tbody>
        <tr>
          <td>
            <button type="button" onClick={() => setOpen(true)}>
              Remove
            </button>
            <Dialog open={open} onClose={() => setOpen(false)} title="Remove row?">
              <p>This cannot be undone.</p>
            </Dialog>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Dialog', () => {
  it('renders nothing when closed, and opens on demand', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders into document.body via a portal, not as a DOM descendant of its caller', () => {
    const { container } = render(<Harness initialOpen />);
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('never produces invalid table markup when the caller is inside a <tbody>/<tr>', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });
    render(<TableRowWithDialog />);
    fireEvent.click(screen.getByText('Remove'));
    const dialog = screen.getByRole('dialog');
    // the dialog must not be a descendant of the <tbody>/<tr> it was triggered from
    const tbody = document.querySelector('tbody');
    expect(tbody?.contains(dialog)).toBe(false);
    expect(errors.some((e) => e.includes('cannot be a child of'))).toBe(false);
    spy.mockRestore();
  });

  it('is labelled by its title and description for assistive tech', () => {
    render(<Harness initialOpen />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Example dialog');
    expect(document.getElementById(describedBy!)?.textContent).toBe('An example description');
  });

  it('moves initial focus inside the dialog and restores it to the trigger on close', () => {
    render(<Harness />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).not.toBe('Open');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    const onCloseSpy = vi.fn();
    render(<Harness initialOpen onCloseSpy={onCloseSpy} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click, but not on a click inside the dialog content', () => {
    const onCloseSpy = vi.fn();
    render(<Harness initialOpen onCloseSpy={onCloseSpy} />);
    fireEvent.mouseDown(screen.getByText('Dialog body content'));
    expect(onCloseSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('confirm and cancel actions both close the dialog', () => {
    render(<Harness initialOpen />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unmounts cleanly, leaving no dialog node behind', () => {
    const { unmount } = render(<Harness initialOpen />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    unmount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Escape after unmount must not throw or call a torn-down handler
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
  });

  it('locks body scroll while open and restores it once closed', () => {
    const original = document.body.style.overflow;
    render(<Harness initialOpen />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('Cancel'));
    expect(document.body.style.overflow).toBe(original);
  });
});
