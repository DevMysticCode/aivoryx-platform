import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptCredentialBlob, encryptCredentialBlob } from './connector-credentials.service.js';

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);

describe('connector credential encryption (AES-256-GCM)', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = JSON.stringify({ appSecret: 'shh', pageAccessToken: 'tok-123' });
    const ciphertext = encryptCredentialBlob(KEY_A, plaintext);
    expect(decryptCredentialBlob(KEY_A, ciphertext)).toBe(plaintext);
  });

  it('never contains the plaintext as a substring of the ciphertext', () => {
    const plaintext = 'a-very-identifiable-secret-value-12345';
    const ciphertext = encryptCredentialBlob(KEY_A, plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const plaintext = 'same value';
    expect(encryptCredentialBlob(KEY_A, plaintext)).not.toBe(
      encryptCredentialBlob(KEY_A, plaintext),
    );
  });

  it('fails to decrypt with the wrong key (GCM auth tag check)', () => {
    const ciphertext = encryptCredentialBlob(KEY_A, 'secret');
    expect(() => decryptCredentialBlob(KEY_B, ciphertext)).toThrow();
  });

  it('fails to decrypt a tampered ciphertext (authenticated encryption catches it)', () => {
    const ciphertext = encryptCredentialBlob(KEY_A, 'secret');
    const [iv, tag, data] = ciphertext.split('.');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = [iv, tag, flipped.toString('base64')].join('.');
    expect(() => decryptCredentialBlob(KEY_A, tampered)).toThrow();
  });

  it('rejects a malformed ciphertext string', () => {
    expect(() => decryptCredentialBlob(KEY_A, 'not-the-right-shape')).toThrow(/malformed/);
  });
});
