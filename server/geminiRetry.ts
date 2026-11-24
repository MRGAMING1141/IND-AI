export interface RetryAttemptInfo {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  isQuota: boolean;
  reason: string;
}

export interface BackoffConfig {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryHintMs?: number;
  random?: () => number;
}

export interface ExponentialRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxTotalWaitMs?: number;
  jitterRatio?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (info: RetryAttemptInfo) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class GeminiRateLimitError extends Error {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  readonly retryAfterSec: number;
  readonly attemptsMade: number;

  constructor(message: string, options: { retryAfterSec?: number; attemptsMade?: number } = {}) {
    super(message);
    this.name = 'GeminiRateLimitError';
    this.retryAfterSec = Math.max(5, Math.min(120, Math.round(options.retryAfterSec ?? 20)));
    this.attemptsMade = Math.max(1, Math.floor(options.attemptsMade ?? 1));
  }
}

export function extractRetryDelayMs(err: unknown): number {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const secMatch = raw.match(/retry(?:Delay| in|After)["':\s]+(\d+(?:\.\d+)?)s?/i);
  if (secMatch) {
    const secs = Number(secMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(30_000, Math.ceil(secs * 1000) + 300);
    }
  }
  return 0;
}

export function isQuotaOrRateLimitError(err: unknown): boolean {
  if (err instanceof GeminiRateLimitError) return true;
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    raw.includes('429') ||
    raw.includes('resource_exhausted') ||
    raw.includes('quota') ||
    raw.includes('rate limit') ||
    raw.includes('rate-limits')
  );
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (isQuotaOrRateLimitError(err)) return true;
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    raw.includes('503') ||
    raw.includes('unavailable') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('abort') ||
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    raw.includes('econnreset') ||
    raw.includes('etimedout')
  );
}

export function formatGeminiError(err: unknown): string {
  if (err instanceof GeminiRateLimitError) {
    return err.message;
  }
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown AI error');
  let extractedMessage = raw;
  let statusCode: number | undefined;
  let statusText = '';

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as {
        error?: { message?: string; code?: number; status?: string };
      };
      if (parsed?.error?.message) {
        extractedMessage = parsed.error.message;
      }
      if (typeof parsed?.error?.code === 'number') {
        statusCode = parsed.error.code;
      }
      if (typeof parsed?.error?.status === 'string') {
        statusText = parsed.error.status;
      }
    } catch {
      // Fall back to raw message
    }
  }

  const lower = `${extractedMessage} ${statusText} ${raw}`.toLowerCase();
  if (
    statusCode === 429 ||
    statusText === 'RESOURCE_EXHAUSTED' ||
    lower.includes('resource_exhausted') ||
    lower.includes('exceeded your current quota')
  ) {
    return 'Gemini API quota is temporarily busy after automatic exponential backoff retries. We will retry shortly, or you can switch to Standard (Fast Mode) for lighter quota usage.';
  }

  if (statusCode === 503 || lower.includes('high demand') || lower.includes('overloaded')) {
    return 'Gemini servers are experiencing high demand right now (503). Automatic retries did not clear the queue — please retry in a few seconds.';
  }

  return extractedMessage.trim() || 'AI generation failed. Please retry.';
}

/**
 * Pure exponential backoff delay calculator with bounded jitter and optional server retryDelay hint.
 * Attempt is 1-indexed (attempt 1 = first retry after initial failure).
 */
export function computeExponentialBackoffMs(attempt: number, config: BackoffConfig = {}): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const baseDelayMs = Math.max(100, config.baseDelayMs ?? 1500);
  const maxDelayMs = Math.max(baseDelayMs, config.maxDelayMs ?? 16_000);
  const jitterRatio = Math.max(0, Math.min(0.5, config.jitterRatio ?? 0.15));
  const random = config.random ?? Math.random;

  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, safeAttempt - 1));
  const hint =
    typeof config.retryHintMs === 'number' && Number.isFinite(config.retryHintMs) && config.retryHintMs > 0
      ? Math.min(maxDelayMs, config.retryHintMs)
      : 0;
  const target = Math.max(exponential, hint);

  if (jitterRatio === 0) {
    return Math.round(target);
  }
  const offset = (random() * 2 - 1) * jitterRatio * target;
  return Math.max(100, Math.min(maxDelayMs, Math.round(target + offset)));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes an async Gemini API operation with exponential backoff retries on 429 / 503 / transient errors.
 * Non-retryable errors (e.g., 400 invalid argument, 401/403 auth errors) fail fast without waiting.
 */
export async function withGeminiExponentialBackoff<T>(
  operation: (attemptIndex: number) => Promise<T>,
  options: ExponentialRetryOptions = {}
): Promise<{ result: T; attemptsMade: number }> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 3));
  const baseDelayMs = options.baseDelayMs ?? 1500;
  const maxDelayMs = options.maxDelayMs ?? 16_000;
  const maxTotalWaitMs = options.maxTotalWaitMs ?? 35_000;
  const jitterRatio = options.jitterRatio ?? 0.15;
  const shouldRetry = options.shouldRetry ?? isRetryableGeminiError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let totalWaitedMs = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await operation(attempt);
      return { result, attemptsMade: attempt + 1 };
    } catch (err) {
      lastError = err;
      const retriesUsed = attempt;
      if (retriesUsed >= maxRetries || !shouldRetry(err)) {
        break;
      }

      const retryNumber = attempt + 1;
      const isQuota = isQuotaOrRateLimitError(err);
      const retryHintMs = extractRetryDelayMs(err);
      const remainingBudgetMs = Math.max(0, maxTotalWaitMs - totalWaitedMs);
      if (remainingBudgetMs < 200) {
        break;
      }

      const rawDelayMs = computeExponentialBackoffMs(retryNumber, {
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
        retryHintMs,
        random,
      });
      const delayMs = Math.min(rawDelayMs, remainingBudgetMs);

      options.onRetry?.({
        attempt: retryNumber,
        maxRetries,
        delayMs,
        isQuota,
        reason: isQuota ? '429 quota/rate limit' : 'transient upstream error',
      });

      totalWaitedMs += delayMs;
      await sleep(delayMs);
    }
  }

  throw lastError;
}
