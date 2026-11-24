import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiError,
  buildApiErrorFromPayload,
  extractErrorDisplay,
  normalizeArray,
  normalizeChatResponse,
  normalizeToolStatus,
  normalizeUserAccount,
} from './apiResponse.ts';

test('normalizeChatResponse never throws on empty, null, or undefined payloads', () => {
  for (const input of [undefined, null, {}, { reply: 123, createdActions: null }]) {
    const out = normalizeChatResponse(input);
    assert.equal(Array.isArray(out.createdActions), true);
    assert.equal(out.createdActions.length, 0);
    assert.equal(Array.isArray(out.toolsUsed), true);
    assert.equal(out.toolsUsed.length, 0);
    assert.equal(Array.isArray(out.injectionAlerts), true);
    assert.equal(out.injectionAlerts.length, 0);
    assert.equal(out.modelChoice, 'standard');
  }
});

test('normalizeToolStatus safely fills Gmail and Drive defaults', () => {
  const status = normalizeToolStatus({});
  assert.equal(status.gmail.connected, false);
  assert.equal(status.drive.connected, false);
  assert.equal(status.drive.folderName, 'IND AGENT');
});

test('normalizeUserAccount defaults safely to free guest account with 5-hour window', () => {
  const account = normalizeUserAccount({});
  assert.equal(account.plan, 'free');
  assert.equal(account.authType, 'guest');
  assert.equal(account.usage.used, 0);
  assert.equal(account.usage.limit, 10);
  assert.equal(account.usage.windowDurationHours, 5);
  assert.equal(account.usage.resetsAt, null);
});

test('normalizeArray returns empty array for non-array values', () => {
  assert.deepEqual(normalizeArray(undefined), []);
  assert.deepEqual(normalizeArray(null), []);
  assert.deepEqual(normalizeArray({ length: 5 }), []);
  assert.deepEqual(normalizeArray(['a', 'b']), ['a', 'b']);
});

test('buildApiErrorFromPayload handles non-JSON HTML and Plus-required errors clearly', () => {
  const htmlErr = buildApiErrorFromPayload(200, null, 'text/html; charset=utf-8');
  assert.equal(htmlErr instanceof ApiError, true);
  assert.equal(htmlErr.title, 'Invalid Server Response');

  const plusErr = buildApiErrorFromPayload(
    403,
    { error: 'Upgrade to Plus to use IND HYPER CODING MODEL.', code: 'PLUS_REQUIRED' },
    'application/json'
  );
  const display = extractErrorDisplay(plusErr);
  assert.equal(display.title, 'Plus Plan Required');
  assert.equal(display.code, 'PLUS_REQUIRED');
});

test('buildApiErrorFromPayload preserves rate-limit retryAfterSec and attemptsMade metadata', () => {
  const rateErr = buildApiErrorFromPayload(
    429,
    {
      error: 'Gemini API quota is temporarily busy after automatic retries.',
      code: 'RATE_LIMITED',
      retryAfterSec: 18,
      attemptsMade: 4,
    },
    'application/json'
  );
  const display = extractErrorDisplay(rateErr);
  assert.equal(display.title, 'AI Quota Cooldown');
  assert.equal(display.code, 'RATE_LIMITED');
  assert.equal(display.retryAfterSec, 18);
  assert.equal(display.attemptsMade, 4);
});
