import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProviderCredentialForm } from './provider-credential-form';

afterEach(() => cleanup());

const META_FIELDS = [
  { key: 'appSecret', label: 'App Secret', secret: true },
  { key: 'pageAccessToken', label: 'Page Access Token', secret: true },
  { key: 'verifyToken', label: 'Webhook Verify Token', secret: true },
];

describe('ProviderCredentialForm', () => {
  it('disables Save on an empty form and never calls onSubmit, even via a direct form submit', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={onSubmit} />);
    const save = screen.getByRole('button', { name: 'Save credentials' });
    expect(save).toHaveProperty('disabled', true);

    // defense-in-depth: a direct form submit (e.g. Enter in a field) must also no-op
    fireEvent.submit(screen.getByLabelText('App Secret').closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Save disabled while any required field is still blank', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'secret-1' } });
    fireEvent.change(screen.getByLabelText('Page Access Token'), { target: { value: 'token-1' } });
    // verifyToken still blank
    const save = screen.getByRole('button', { name: 'Save credentials' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only values as not filled in', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={onSubmit} />);
    for (const f of META_FIELDS) {
      fireEvent.change(screen.getByLabelText(f.label), {
        target: { value: f.key === 'verifyToken' ? '   ' : 'value' },
      });
    }
    expect(screen.getByRole('button', { name: 'Save credentials' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('submits every field, trimmed, only once the full set is filled in', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: ' secret-1 ' } });
    fireEvent.change(screen.getByLabelText('Page Access Token'), { target: { value: 'token-1' } });
    fireEvent.change(screen.getByLabelText('Webhook Verify Token'), {
      target: { value: 'verify-1' },
    });
    const save = screen.getByRole('button', { name: 'Save credentials' });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      appSecret: 'secret-1',
      pageAccessToken: 'token-1',
      verifyToken: 'verify-1',
    });
  });

  it('never pre-fills a stored value — every field starts empty', () => {
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={vi.fn()} />);
    for (const f of META_FIELDS) {
      expect(screen.getByLabelText(f.label)).toHaveProperty('value', '');
    }
  });

  it('secret fields render as password inputs', () => {
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={vi.fn()} />);
    for (const f of META_FIELDS) {
      expect(screen.getByLabelText(f.label)).toHaveProperty('type', 'password');
    }
  });

  it('a non-secret field (hypothetical future provider) renders as plain text', () => {
    const fields = [{ key: 'accountId', label: 'Account ID', secret: false }];
    render(<ProviderCredentialForm fields={fields} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Account ID')).toHaveProperty('type', 'text');
  });

  it('disables Save while the mutation is pending, even with every field filled in', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={onSubmit} pending />);
    for (const f of META_FIELDS) {
      fireEvent.change(screen.getByLabelText(f.label), { target: { value: 'x' } });
    }
    const save = screen.getByRole('button', { name: 'Saving…' });
    expect(save).toHaveProperty('disabled', true);
  });

  it('a provider with zero credential fields is vacuously complete (the host page never mounts this for Pabbly)', () => {
    const onSubmit = vi.fn();
    render(<ProviderCredentialForm fields={[]} onSubmit={onSubmit} />);
    const save = screen.getByRole('button', { name: 'Save credentials' });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('states plainly that saving replaces the whole credential set, with no partial-update claim', () => {
    render(<ProviderCredentialForm fields={META_FIELDS} onSubmit={vi.fn()} />);
    expect(screen.getByText(/replaces the complete credential set/i)).toBeTruthy();
    expect(screen.queryByText(/left unchanged/i)).toBeNull();
    expect(screen.queryByText(/unless you type a new one/i)).toBeNull();
  });
});
