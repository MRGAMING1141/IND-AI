import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SIGNED_IN_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  canUseModel,
  checkWindowQuota,
  evaluateUsageWindow,
  formatResetCountdown,
} from '../src/utils/planEngine.ts';
import { PLUS_PRICE_INR, isPlusSubscriptionActive } from '../src/utils/paymentEngine.ts';
import type {
  ModelChoice,
  UserAccountSummary,
  UserPlan,
} from '../src/types/agent.ts';

export interface UserAccountRecord {
  userId: string;
  authType: 'guest' | 'google' | 'email';
  displayName: string;
  email?: string;
  plan: UserPlan;
  planExpiresAt?: number;
  windowStartedAtMs: number;
  windowMessagesUsed: number;
  createdAt: string;
}

export interface CloudUsageSnapshot {
  windowStartedAtMs?: number;
  windowMessagesUsed?: number;
}

export class UserStore {
  private readonly users = new Map<string, UserAccountRecord>();
  private readonly persistPath?: string;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (this.persistPath) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return;
      for (const [userId, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const rec = value as Record<string, unknown>;
        const authType =
          rec.authType === 'google' || rec.authType === 'email' ? rec.authType : 'guest';
        const plan: UserPlan = rec.plan === 'plus' ? 'plus' : 'free';
        const planExpiresAt =
          typeof rec.planExpiresAt === 'number' &&
          Number.isFinite(rec.planExpiresAt) &&
          rec.planExpiresAt > 0
            ? Math.floor(rec.planExpiresAt)
            : undefined;
        this.users.set(userId, {
          userId,
          authType,
          displayName:
            typeof rec.displayName === 'string' && rec.displayName
              ? rec.displayName
              : authType === 'guest'
                ? 'Guest Workspace'
                : 'Google Account',
          email: typeof rec.email === 'string' ? rec.email : undefined,
          plan,
          planExpiresAt,
          windowStartedAtMs:
            typeof rec.windowStartedAtMs === 'number' && Number.isFinite(rec.windowStartedAtMs)
              ? Math.max(0, Math.floor(rec.windowStartedAtMs))
              : 0,
          windowMessagesUsed:
            typeof rec.windowMessagesUsed === 'number' && Number.isFinite(rec.windowMessagesUsed)
              ? Math.max(0, Math.floor(rec.windowMessagesUsed))
              : 0,
          createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
        });
      }
    } catch {
      // Ignore corrupt cache; Firebase Firestore remains authoritative for signed-in users
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const serialized: Record<string, UserAccountRecord> = {};
      // Bound disk cache to most recent 500 records
      const entries = Array.from(this.users.entries()).slice(-500);
      for (const [key, rec] of entries) {
        serialized[key] = rec;
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(serialized), 'utf8');
    } catch {
      // Non-fatal cache write failure
    }
  }

  private getEffectivePlan(record: UserAccountRecord, nowMs: number): UserPlan {
    return isPlusSubscriptionActive(record.plan, record.planExpiresAt, nowMs) ? 'plus' : 'free';
  }

  getOrCreateUser(userId: string, now: Date = new Date()): UserAccountRecord {
    const nowMs = now.getTime();
    let record = this.users.get(userId);
    if (!record) {
      const isSignedIn = userId.startsWith('fb_');
      record = {
        userId,
        authType: isSignedIn ? 'google' : 'guest',
        displayName: isSignedIn ? 'Google Account' : 'Guest Workspace',
        plan: 'free',
        windowStartedAtMs: 0,
        windowMessagesUsed: 0,
        createdAt: now.toISOString(),
      };
      this.users.set(userId, record);
      return record;
    }

    let dirty = false;
    if (record.plan === 'plus' && !isPlusSubscriptionActive(record.plan, record.planExpiresAt, nowMs)) {
      record.plan = 'free';
      dirty = true;
    }

    const evaluated = evaluateUsageWindow(
      record.windowStartedAtMs,
      record.windowMessagesUsed,
      nowMs
    );
    if (
      evaluated.windowStartedAtMs !== record.windowStartedAtMs ||
      evaluated.used !== record.windowMessagesUsed
    ) {
      record.windowStartedAtMs = evaluated.windowStartedAtMs;
      record.windowMessagesUsed = evaluated.used;
      dirty = true;
    }

    if (dirty) {
      this.saveToDisk();
    }

    return record;
  }

  /**
   * Updates identity metadata when a user connects Google Workspace or signs in with Firebase Auth.
   */
  updateIdentity(
    userId: string,
    identity: { email?: string; displayName?: string; authType?: 'guest' | 'google' | 'email' }
  ): UserAccountRecord {
    const record = this.getOrCreateUser(userId);
    if (identity.email && !record.email) {
      record.email = identity.email;
    }
    if (identity.displayName) {
      record.displayName = identity.displayName;
    }
    if (identity.authType) {
      record.authType = identity.authType;
    }
    this.saveToDisk();
    return record;
  }

  /**
   * Hydrates persisted 5-hour usage window loaded from Firebase Firestore `/users/{uid}`
   * so restarting the server never wipes a signed-in user's usage count.
   * Monotonic within an active window so a stale tab or client cannot downgrade usage.
   */
  hydrateUsageFromCloud(
    userId: string,
    cloudUsage: CloudUsageSnapshot | undefined,
    now: Date = new Date()
  ): UserAccountSummary {
    const record = this.getOrCreateUser(userId, now);
    if (!cloudUsage) {
      return this.getAccountSummary(userId, now);
    }

    const nowMs = now.getTime();
    const rawStart =
      typeof cloudUsage.windowStartedAtMs === 'number' &&
      Number.isFinite(cloudUsage.windowStartedAtMs) &&
      cloudUsage.windowStartedAtMs > 0
        ? Math.floor(cloudUsage.windowStartedAtMs)
        : 0;
    const rawUsed =
      typeof cloudUsage.windowMessagesUsed === 'number' &&
      Number.isFinite(cloudUsage.windowMessagesUsed) &&
      cloudUsage.windowMessagesUsed > 0
        ? Math.min(10_000, Math.floor(cloudUsage.windowMessagesUsed))
        : 0;

    const cloudEval = evaluateUsageWindow(rawStart, rawUsed, nowMs);
    if (cloudEval.windowStartedAtMs <= 0 || cloudEval.used <= 0) {
      return this.getAccountSummary(userId, now);
    }

    if (record.windowStartedAtMs <= 0 || record.windowMessagesUsed <= 0) {
      // Fresh server memory after restart: adopt Firestore's active 5-hour window directly
      record.windowStartedAtMs = cloudEval.windowStartedAtMs;
      record.windowMessagesUsed = cloudEval.used;
      this.saveToDisk();
    } else if (cloudEval.used > record.windowMessagesUsed) {
      // Another tab or persisted cloud state has higher usage in an active window
      record.windowStartedAtMs = Math.min(record.windowStartedAtMs, cloudEval.windowStartedAtMs);
      record.windowMessagesUsed = cloudEval.used;
      this.saveToDisk();
    }

    return this.getAccountSummary(userId, now);
  }

  /**
   * Authoritative server-side plan update (used after verifying Firestore profile or admin approval).
   */
  setUserPlanInternal(
    userId: string,
    plan: UserPlan,
    planExpiresAt?: number | null
  ): UserAccountRecord {
    const record = this.getOrCreateUser(userId);
    record.plan = plan;
    record.planExpiresAt =
      typeof planExpiresAt === 'number' && Number.isFinite(planExpiresAt) && planExpiresAt > 0
        ? Math.floor(planExpiresAt)
        : undefined;
    this.saveToDisk();
    return record;
  }

  getAccountSummary(userId: string, now: Date = new Date()): UserAccountSummary {
    const nowMs = now.getTime();
    const record = this.getOrCreateUser(userId, now);
    const effectivePlan = this.getEffectivePlan(record, nowMs);
    const evaluated = evaluateUsageWindow(
      record.windowStartedAtMs,
      record.windowMessagesUsed,
      nowMs
    );
    const quota = checkWindowQuota(effectivePlan, evaluated.used, record.authType);
    return {
      userId: record.userId,
      authType: record.authType,
      displayName: record.displayName,
      email: record.email,
      plan: effectivePlan,
      planExpiresAt: effectivePlan === 'plus' ? (record.planExpiresAt ?? null) : null,
      usage: {
        used: evaluated.used,
        limit: quota.limit,
        remaining: quota.remaining,
        windowDurationHours: USAGE_WINDOW_HOURS,
        windowStartedAtMs: evaluated.windowStartedAtMs,
        resetsAt: evaluated.resetsAt,
      },
    };
  }

  checkMessageAllowance(
    userId: string,
    modelChoice: ModelChoice,
    now: Date = new Date()
  ):
    | { allowed: true; record: UserAccountRecord }
    | { allowed: false; status: 403 | 429; code: 'PLUS_REQUIRED' | 'USAGE_LIMIT_REACHED'; error: string } {
    const nowMs = now.getTime();
    const record = this.getOrCreateUser(userId, now);
    const effectivePlan = this.getEffectivePlan(record, nowMs);

    if (!canUseModel(effectivePlan, modelChoice)) {
      return {
        allowed: false,
        status: 403,
        code: 'PLUS_REQUIRED',
        error: `IND HYPER CODING MODEL is available on IND AGENT Plus (₹${PLUS_PRICE_INR} / month via UPI / FamPay). Upgrade in Plans & Usage or switch to Standard Coding Model.`,
      };
    }

    const evaluated = evaluateUsageWindow(
      record.windowStartedAtMs,
      record.windowMessagesUsed,
      nowMs
    );
    const quota = checkWindowQuota(effectivePlan, evaluated.used, record.authType);
    if (!quota.allowed) {
      const countdown = formatResetCountdown(evaluated.resetsAt, nowMs) ?? `${USAGE_WINDOW_HOURS} hours`;
      const error =
        record.authType === 'guest'
          ? `You reached the Free Guest limit (${quota.limit} messages per ${USAGE_WINDOW_HOURS} hours). Resets in ${countdown}, or sign in with Google for ${SIGNED_IN_WINDOW_MESSAGE_LIMIT} messages / ${USAGE_WINDOW_HOURS} hours and Firebase Cloud sync.`
          : `You reached your ${quota.limit} messages per ${USAGE_WINDOW_HOURS} hours limit. Your usage resets in ${countdown}, or upgrade to IND AGENT Plus (₹${PLUS_PRICE_INR} / month via UPI / FamPay) for unlimited messages.`;
      return {
        allowed: false,
        status: 429,
        code: 'USAGE_LIMIT_REACHED',
        error,
      };
    }

    return { allowed: true, record };
  }

  recordMessageUsage(userId: string, now: Date = new Date()): UserAccountSummary {
    const record = this.getOrCreateUser(userId, now);
    const nowMs = now.getTime();
    if (record.windowStartedAtMs <= 0 || record.windowMessagesUsed <= 0) {
      record.windowStartedAtMs = nowMs;
      record.windowMessagesUsed = 1;
    } else {
      record.windowMessagesUsed += 1;
    }
    this.saveToDisk();
    return this.getAccountSummary(userId, now);
  }
}

const RUNTIME_CACHE_PATH = path.join(os.tmpdir(), 'ind-agent-usage-window-v2.json');
export const userStore = new UserStore(RUNTIME_CACHE_PATH);
