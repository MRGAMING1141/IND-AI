import type { ModelChoice, UserPlan } from '../types/agent';

export interface PlanSpec {
  id: UserPlan;
  name: string;
  priceInrMonthly: number;
  priceDisplay: string;
  yearlyPlaceholder?: string;
  tagline: string;
  windowMessageLimit: number | null; // null = unlimited
  windowDurationHours: number;
  contextMessageLimit: number;
  allowsHyperModel: boolean;
  allowsMultiFileZip: boolean;
  features: string[];
}

export const USAGE_WINDOW_HOURS = 5;
export const USAGE_WINDOW_MS = USAGE_WINDOW_HOURS * 60 * 60 * 1000;
export const GUEST_WINDOW_MESSAGE_LIMIT = 10;
export const SIGNED_IN_WINDOW_MESSAGE_LIMIT = 20;
export const STANDARD_CONTEXT_MESSAGE_LIMIT = 40;
export const HYPER_CONTEXT_MESSAGE_LIMIT = 100;

export const PLAN_SPECS: Record<UserPlan, PlanSpec> = {
  free: {
    id: 'free',
    name: 'Free',
    priceInrMonthly: 0,
    priceDisplay: '₹0 / month',
    tagline: `${GUEST_WINDOW_MESSAGE_LIMIT} messages / ${USAGE_WINDOW_HOURS} hrs as Guest · Sign in with Google for ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} messages / ${USAGE_WINDOW_HOURS} hrs & Firebase Cloud Storage.`,
    windowMessageLimit: SIGNED_IN_WINDOW_MESSAGE_LIMIT,
    windowDurationHours: USAGE_WINDOW_HOURS,
    contextMessageLimit: STANDARD_CONTEXT_MESSAGE_LIMIT,
    allowsHyperModel: false,
    allowsMultiFileZip: false,
    features: [
      'Standard coding model',
      `${GUEST_WINDOW_MESSAGE_LIMIT} messages / ${USAGE_WINDOW_HOURS} hours (Free Guest) · ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} messages / ${USAGE_WINDOW_HOURS} hours (Signed In)`,
      `Rolling ${USAGE_WINDOW_HOURS}-hour reset window saved in Firebase Firestore`,
      'Cloud Storage sync for chats, usage, memory, skills & custom instructions',
      `Expanded context length (${STANDARD_CONTEXT_MESSAGE_LIMIT} messages)`,
      'Gmail + Google Drive connections & Live Artifacts Workbench',
    ],
  },
  plus: {
    id: 'plus',
    name: 'IND AGENT Plus',
    priceInrMonthly: 200,
    priceDisplay: '₹200 / month',
    yearlyPlaceholder: '₹2,000 / year',
    tagline: 'IND HYPER CODING MODEL, deep architecture planning, 100-message context, and unlimited messages.',
    windowMessageLimit: null,
    windowDurationHours: USAGE_WINDOW_HOURS,
    contextMessageLimit: HYPER_CONTEXT_MESSAGE_LIMIT,
    allowsHyperModel: true,
    allowsMultiFileZip: true,
    features: [
      'IND HYPER CODING MODEL access (plan + self-review pass)',
      'Unlimited messages (no 5-hour usage cap)',
      `Ultra-long context length (${HYPER_CONTEXT_MESSAGE_LIMIT} messages)`,
      'Multi-file project generation with ZIP download',
      'Instant UPI / FamPay checkout (30-day Plus pass)',
      'Full Firebase Cloud Storage sync & priority response speed',
    ],
  },
};

export function canUseModel(plan: UserPlan, modelChoice: ModelChoice): boolean {
  if (modelChoice === 'hyper') {
    return PLAN_SPECS[plan].allowsHyperModel;
  }
  return true;
}

export function getContextLimit(plan: UserPlan): number {
  return PLAN_SPECS[plan].contextMessageLimit;
}

export function getWindowMessageLimit(
  plan: UserPlan,
  authType: 'guest' | 'google' | 'email' = 'google'
): number | null {
  if (plan === 'plus') return null;
  return authType === 'guest' ? GUEST_WINDOW_MESSAGE_LIMIT : SIGNED_IN_WINDOW_MESSAGE_LIMIT;
}

export interface EvaluatedUsageWindow {
  windowStartedAtMs: number;
  used: number;
  resetsAt: string | null;
  expired: boolean;
}

/**
 * Evaluates a 5-hour rolling usage window against `nowMs`.
 * If no window has started (`windowStartedAtMs <= 0`) or 5 hours have elapsed,
 * the counter automatically resets to 0.
 */
export function evaluateUsageWindow(
  windowStartedAtMs: number | undefined,
  usedCount: number | undefined,
  nowMs: number = Date.now()
): EvaluatedUsageWindow {
  const safeStart =
    typeof windowStartedAtMs === 'number' &&
    Number.isFinite(windowStartedAtMs) &&
    windowStartedAtMs > 0
      ? Math.floor(windowStartedAtMs)
      : 0;
  const safeUsed =
    typeof usedCount === 'number' && Number.isFinite(usedCount) && usedCount > 0
      ? Math.floor(usedCount)
      : 0;

  if (safeStart <= 0 || safeUsed <= 0) {
    return {
      windowStartedAtMs: 0,
      used: 0,
      resetsAt: null,
      expired: false,
    };
  }

  // Guard against wildly future timestamps caused by malformed data (allow 10m clock-skew between phone & server)
  if (safeStart > nowMs + 600_000) {
    return {
      windowStartedAtMs: 0,
      used: 0,
      resetsAt: null,
      expired: true,
    };
  }

  const resetMs = safeStart + USAGE_WINDOW_MS;
  if (nowMs >= resetMs) {
    return {
      windowStartedAtMs: 0,
      used: 0,
      resetsAt: null,
      expired: true,
    };
  }

  return {
    windowStartedAtMs: safeStart,
    used: safeUsed,
    resetsAt: new Date(resetMs).toISOString(),
    expired: false,
  };
}

export function checkWindowQuota(
  plan: UserPlan,
  usedInWindow: number,
  authType: 'guest' | 'google' | 'email' = 'google'
): { allowed: boolean; limit: number | null; remaining: number | null } {
  const limit = getWindowMessageLimit(plan, authType);
  if (limit === null) {
    return { allowed: true, limit: null, remaining: null };
  }
  const safeUsed = Math.max(0, Math.floor(usedInWindow));
  const remaining = Math.max(0, limit - safeUsed);
  return {
    allowed: safeUsed < limit,
    limit,
    remaining,
  };
}

/**
 * Formats remaining time until the 5-hour usage window resets (e.g. "4h 52m" or "18m").
 */
export function formatResetCountdown(
  resetsAtIso: string | null | undefined,
  nowMs: number = Date.now()
): string | null {
  if (!resetsAtIso) return null;
  const targetMs = Date.parse(resetsAtIso);
  if (!Number.isFinite(targetMs)) return null;
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'Resetting now';

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}
