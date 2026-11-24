import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiRateLimitError,
  computeExponentialBackoffMs,
  extractRetryDelayMs,
  formatGeminiError,
  isQuotaOrRateLimitError,
  withGeminiExponentialBackoff,
} from './geminiRetry.ts';

test('computeExponentialBackoffMs grows exponentially, caps at maxDelayMs, and honors retryHintMs', () => {
  const noJitter = { baseDelayMs: 1000, maxDelayMs: 10_000, jitterRatio: 0 };
  assert.equal(computeExponentialBackoffMs(1, noJitter), 1000);
  assert.equal(computeExponentialBackoffMs(2, noJitter), 2000);
  assert.equal(computeExponentialBackoffMs(3, noJitter), 4000);
  assert.equal(computeExponentialBackoffMs(4, noJitter), 8000);
  assert.equal(computeExponentialBackoffMs(5, noJitter), 10_000);

  // Server retryDelay hint overrides smaller exponential delay
  assert.equal(
    computeExponentialBackoffMs(1, { ...noJitter, retryHintMs: 5500 }),
    5500
  );

  // Jitter stays within +/-15% bounds
  const low = computeExponentialBackoffMs(2, {
    baseDelayMs: 2000,
    maxDelayMs: 16_000,
    jitterRatio: 0.15,
    random: () => 0,
  });
  const high = computeExponentialBackoffMs(2, {
    baseDelayMs: 2000,
    maxDelayMs: 16_000,
    jitterRatio: 0.15,
    random: () => 1,
  });
  assert.equal(low, 3400);
  assert.equal(high, 4600);
});

test('withGeminiExponentialBackoff recovers seamlessly after transient 429 RESOURCE_EXHAUSTED errors', async () => {
  const delays: number[] = [];
  const events: Array<{ attempt: number; isQuota: boolean }> = [];
  let calls = 0;

  const { result, attemptsMade } = await withGeminiExponentialBackoff(
    async () => {
      calls += 1;
      if (calls <= 2) {
        throw new Error(
          '{ "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "You exceeded your current quota." } }'
        );
      }
      return 'recovered-reply';
    },
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      jitterRatio: 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
      onRetry: (info) => {
        events.push({ attempt: info.attempt, isQuota: info.isQuota });
      },
    }
  );

  assert.equal(result, 'recovered-reply');
  assert.equal(attemptsMade, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(events, [
    { attempt: 1, isQuota: true },
    { attempt: 2, isQuota: true },
  ]);
});

test('withGeminiExponentialBackoff fails fast on non-retryable 400 errors without sleeping', async () => {
  const delays: number[] = [];
  let calls = 0;

  await assert.rejects(
    async () => {
      await withGeminiExponentialBackoff(
        async () => {
          calls += 1;
          throw new Error('400 INVALID_ARGUMENT: malformed content');
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          sleep: async (ms) => {
            delays.push(ms);
          },
        }
      );
    },
    /INVALID_ARGUMENT/
  );

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('extractRetryDelayMs, isQuotaOrRateLimitError, and formatGeminiError sanitize raw 429 payloads', () => {
  const raw = new Error(
    '{ "error": { "code": 429, "message": "You exceeded your current quota.", "status": "RESOURCE_EXHAUSTED" } }'
  );
  assert.equal(isQuotaOrRateLimitError(raw), true);
  assert.equal(extractRetryDelayMs(new Error('Please retry in 4.2s')), 4500);
  const formatted = formatGeminiError(raw);
  assert.match(formatted, /exponential backoff|quota/i);
  assert.doesNotMatch(formatted, /"error"/);

  const rlErr = new GeminiRateLimitError('Rate limited', { retryAfterSec: 18, attemptsMade: 4 });
  assert.equal(rlErr.code, 'RATE_LIMITED');
  assert.equal(rlErr.retryAfterSec, 18);
  assert.equal(rlErr.attemptsMade, 4);
});
