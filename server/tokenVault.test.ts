import assert from 'node:assert/strict';
import test from 'node:test';
import { PerUserTokenVault } from './tokenVault.ts';

test('encrypts Gmail and Google Drive tokens with AES-256-GCM and isolates users strictly', () => {
  const vault = new PerUserTokenVault('unit-test-encryption-secret-32bytes!');

  vault.setToken('user_alpha', 'drive', {
    accessToken: 'ya29.alpha-drive-secret-token',
    accountLabel: 'alpha@example.com',
    connectedAt: '2026-11-21T00:00:00.000Z',
  });
  vault.setToken('user_beta', 'gmail', {
    accessToken: 'ya29.beta-gmail-secret-token',
    accountLabel: 'beta@example.com',
    connectedAt: '2026-11-21T00:00:00.000Z',
  });

  const cipherAlpha = vault.getRawCiphertextForTest('user_alpha', 'drive');
  assert.ok(cipherAlpha && !cipherAlpha.includes('ya29.alpha-drive-secret-token'));

  const recAlpha = vault.getToken('user_alpha', 'drive');
  assert.equal(recAlpha?.accessToken, 'ya29.alpha-drive-secret-token');
  assert.equal(recAlpha?.accountLabel, 'alpha@example.com');

  // Strict per-user isolation
  assert.equal(vault.getToken('user_alpha', 'gmail'), null);
  assert.equal(vault.getToken('user_beta', 'drive'), null);

  // Disconnecting wipes stored token
  vault.deleteToken('user_alpha', 'drive');
  assert.equal(vault.getToken('user_alpha', 'drive'), null);
});
