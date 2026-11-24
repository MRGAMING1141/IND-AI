import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRetryDelayMs,
  formatGeminiError,
  isQuotaOrRateLimitError,
} from './agentService.ts';

test('formatGeminiError turns raw 429 RESOURCE_EXHAUSTED JSON into a clean human-readable message', () => {
  const raw = new Error(
    '{ "error": { "code": 429, "message": "You exceeded your current quota, please check your plan and billing details.", "status": "RESOURCE_EXHAUSTED" } }'
  );
  assert.equal(isQuotaOrRateLimitError(raw), true);
  const formatted = formatGeminiError(raw);
  assert.match(formatted, /rate limit|quota/i);
  assert.doesNotMatch(formatted, /RESOURCE_EXHAUSTED/);
  assert.doesNotMatch(formatted, /"error"/);
});

test('extractRetryDelayMs parses retryDelay seconds and caps safely', () => {
  assert.equal(extractRetryDelayMs(new Error('Please retry in 3.5s.')), 3800);
  assert.equal(extractRetryDelayMs(new Error('{"retryDelay":"60s"}')), 30000);
  assert.equal(extractRetryDelayMs(new Error('No retry hint')), 0);
});
