import type {
  AgentTaskStep,
  CodeVerificationSummary,
  InjectionAlert,
  MemoryFact,
  ModelChoice,
  PendingAction,
  ToolStatusSummary,
  UsageSummary,
  UserAccountSummary,
  UserPlan,
  WebSource,
} from '../types/agent';
import {
  GUEST_WINDOW_MESSAGE_LIMIT,
  USAGE_WINDOW_HOURS,
  evaluateUsageWindow,
} from './planEngine';

export class ApiError extends Error {
  title: string;
  status: number;
  code?: string;
  retryAfterSec?: number;
  attemptsMade?: number;

  constructor(
    message: string,
    options: {
      title?: string;
      status?: number;
      code?: string;
      retryAfterSec?: number;
      attemptsMade?: number;
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.title = options.title ?? 'Server Error';
    this.status = options.status ?? 0;
    this.code = options.code;
    this.retryAfterSec = options.retryAfterSec;
    this.attemptsMade = options.attemptsMade;
  }
}

export function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export interface NormalizedChatResponse {
  reply: string;
  createdActions: PendingAction[];
  toolsUsed: string[];
  injectionAlerts: InjectionAlert[];
  tasks: AgentTaskStep[];
  savedMemories: MemoryFact[];
  modelChoice: ModelChoice;
  modelLabel: string;
  fastMode: boolean;
  selfReviewApplied: boolean;
  codeVerification?: CodeVerificationSummary;
  webSources?: WebSource[];
  searchQueries?: string[];
  elapsedMs?: number;
  usage?: UsageSummary;
}

export function normalizeUsage(raw: unknown): UsageSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawUsed = typeof obj.used === 'number' && Number.isFinite(obj.used) ? Math.max(0, Math.floor(obj.used)) : 0;
  const rawWindowStart =
    typeof obj.windowStartedAtMs === 'number' && Number.isFinite(obj.windowStartedAtMs)
      ? Math.max(0, Math.floor(obj.windowStartedAtMs))
      : 0;
  const evaluated =
    rawWindowStart > 0
      ? evaluateUsageWindow(rawWindowStart, rawUsed)
      : {
          windowStartedAtMs: 0,
          used: rawUsed,
          resetsAt: typeof obj.resetsAt === 'string' && obj.resetsAt ? obj.resetsAt : null,
          expired: false,
        };

  const used = evaluated.used;
  const limit =
    obj.limit === null
      ? null
      : typeof obj.limit === 'number' && Number.isFinite(obj.limit)
        ? obj.limit
        : GUEST_WINDOW_MESSAGE_LIMIT;
  const remaining =
    limit === null
      ? null
      : typeof obj.remaining === 'number' && Number.isFinite(obj.remaining) && !evaluated.expired
        ? Math.max(0, Math.floor(obj.remaining))
        : Math.max(0, limit - used);
  const windowDurationHours =
    typeof obj.windowDurationHours === 'number' &&
    Number.isFinite(obj.windowDurationHours) &&
    obj.windowDurationHours > 0
      ? obj.windowDurationHours
      : USAGE_WINDOW_HOURS;

  return {
    used,
    limit,
    remaining,
    windowDurationHours,
    windowStartedAtMs: evaluated.windowStartedAtMs,
    resetsAt: evaluated.resetsAt,
  };
}

export function normalizeUserAccount(raw: unknown): UserAccountSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const plan: UserPlan = obj.plan === 'plus' ? 'plus' : 'free';
  const authType =
    obj.authType === 'google' || obj.authType === 'email' ? obj.authType : 'guest';
  const planExpiresAt =
    typeof obj.planExpiresAt === 'number' && Number.isFinite(obj.planExpiresAt) && obj.planExpiresAt > 0
      ? Math.floor(obj.planExpiresAt)
      : null;
  return {
    userId: typeof obj.userId === 'string' ? obj.userId : 'guest',
    authType,
    displayName: typeof obj.displayName === 'string' && obj.displayName ? obj.displayName : 'Guest User',
    email: typeof obj.email === 'string' ? obj.email : undefined,
    plan,
    planExpiresAt,
    usage: normalizeUsage(obj.usage),
  };
}

export function normalizeChatResponse(raw: unknown): NormalizedChatResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const reply = typeof obj.reply === 'string' ? obj.reply : '';
  const createdActions = normalizeArray<PendingAction>(obj.createdActions).filter(
    (item) => Boolean(item) && typeof item.id === 'string'
  );
  const toolsUsed = normalizeArray<unknown>(obj.toolsUsed).filter(
    (t): t is string => typeof t === 'string'
  );
  const injectionAlerts = normalizeArray<InjectionAlert>(obj.injectionAlerts)
    .filter((a) => Boolean(a) && typeof a.source === 'string')
    .map((a) => ({
      source: a.source,
      matches: normalizeArray<string>(a.matches),
    }));
  const tasks = normalizeArray<AgentTaskStep>(obj.tasks).filter(
    (t) => Boolean(t) && typeof t.id === 'string' && typeof t.label === 'string'
  );
  const savedMemories = normalizeArray<MemoryFact>(obj.savedMemories).filter(
    (m) => Boolean(m) && typeof m.id === 'string' && typeof m.content === 'string'
  );
  const modelChoice: ModelChoice = obj.modelChoice === 'hyper' ? 'hyper' : 'standard';
  const fastMode = Boolean(obj.fastMode);
  const modelLabel =
    typeof obj.modelLabel === 'string' && obj.modelLabel
      ? obj.modelLabel
      : modelChoice === 'hyper'
        ? 'IND HYPER CODING MODEL'
        : fastMode
          ? 'Standard (Fast)'
          : 'Standard Coding Model';

  const rawCv =
    obj.codeVerification && typeof obj.codeVerification === 'object'
      ? (obj.codeVerification as Record<string, unknown>)
      : null;
  const codeVerification: CodeVerificationSummary | undefined = rawCv
    ? {
        passed: Boolean(rawCv.passed),
        filesChecked:
          typeof rawCv.filesChecked === 'number' && Number.isFinite(rawCv.filesChecked)
            ? rawCv.filesChecked
            : 0,
        passesRun:
          typeof rawCv.passesRun === 'number' && Number.isFinite(rawCv.passesRun)
            ? rawCv.passesRun
            : 1,
        issuesFixed:
          typeof rawCv.issuesFixed === 'number' && Number.isFinite(rawCv.issuesFixed)
            ? rawCv.issuesFixed
            : 0,
        remainingIssues:
          typeof rawCv.remainingIssues === 'number' && Number.isFinite(rawCv.remainingIssues)
            ? rawCv.remainingIssues
            : 0,
        intentLabel: typeof rawCv.intentLabel === 'string' ? rawCv.intentLabel : undefined,
      }
    : undefined;

  const webSources = normalizeArray<WebSource>(obj.webSources).filter(
    (s) => Boolean(s) && typeof s.uri === 'string' && s.uri.trim().length > 0
  ).map((s) => ({
    title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : s.uri.trim(),
    uri: s.uri.trim(),
  }));
  const searchQueries = normalizeArray<unknown>(obj.searchQueries).filter(
    (q): q is string => typeof q === 'string' && q.trim().length > 0
  );

  return {
    reply:
      reply ||
      (createdActions.length > 0 ? 'Prepared an action preview for your approval.' : ''),
    createdActions,
    toolsUsed,
    injectionAlerts,
    tasks,
    savedMemories,
    modelChoice,
    modelLabel,
    fastMode,
    selfReviewApplied: Boolean(obj.selfReviewApplied),
    codeVerification,
    webSources: webSources.length > 0 ? webSources : undefined,
    searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
    elapsedMs: typeof obj.elapsedMs === 'number' ? obj.elapsedMs : undefined,
    usage: obj.usage ? normalizeUsage(obj.usage) : undefined,
  };
}

export function normalizeToolStatus(raw: unknown): ToolStatusSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const gmail =
    obj.gmail && typeof obj.gmail === 'object' ? (obj.gmail as Record<string, unknown>) : {};
  const drive =
    obj.drive && typeof obj.drive === 'object' ? (obj.drive as Record<string, unknown>) : {};

  return {
    gmail: {
      connected: Boolean(gmail.connected),
      accountLabel: typeof gmail.accountLabel === 'string' ? gmail.accountLabel : undefined,
    },
    drive: {
      connected: Boolean(drive.connected),
      accountLabel: typeof drive.accountLabel === 'string' ? drive.accountLabel : undefined,
      folderName:
        typeof drive.folderName === 'string' && drive.folderName ? drive.folderName : 'IND AGENT',
    },
  };
}

export function buildApiErrorFromPayload(
  status: number,
  payload: unknown,
  contentType: string
): ApiError {
  const isJson = contentType.toLowerCase().includes('application/json');
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const serverMessage = typeof obj.error === 'string' && obj.error.trim() ? obj.error.trim() : '';
  const code = typeof obj.code === 'string' ? obj.code : undefined;

  if (!isJson) {
    return new ApiError(
      `The server returned a non-JSON response (HTTP ${status || 'unknown'}). Reload the page or verify the backend API is running.`,
      { title: 'Invalid Server Response', status, code: 'NON_JSON_RESPONSE' }
    );
  }

  if (code === 'PLUS_REQUIRED') {
    return new ApiError(
      serverMessage || 'IND HYPER CODING MODEL requires IND AGENT Plus (₹200 / month via UPI / FamPay).',
      { title: 'Plus Plan Required', status, code }
    );
  }

  if (code === 'USAGE_LIMIT_REACHED' || code === 'DAILY_LIMIT_REACHED') {
    return new ApiError(
      serverMessage || 'You have reached your 5-hour usage limit. Wait for reset or check Plans.',
      { title: '5-Hour Usage Limit Reached', status, code: 'USAGE_LIMIT_REACHED' }
    );
  }

  if (status === 401) {
    return new ApiError(
      serverMessage || 'This integration is not connected. Connect your account in the Tools tab first.',
      { title: 'Integration Not Connected', status, code: code ?? 'UNAUTHORIZED' }
    );
  }

  if (status === 403) {
    return new ApiError(
      serverMessage || 'This action was blocked by plan permissions or safety checks.',
      { title: 'Action Blocked', status, code: code ?? 'FORBIDDEN' }
    );
  }

  if (status === 400) {
    return new ApiError(
      serverMessage || 'The request was missing required fields or parameters.',
      { title: 'Invalid Request', status, code: code ?? 'BAD_REQUEST' }
    );
  }

  if (status === 404) {
    return new ApiError(
      serverMessage || 'The requested API endpoint could not be found.',
      { title: 'Endpoint Not Found', status, code: code ?? 'NOT_FOUND' }
    );
  }

  if (status === 429) {
    const retryAfterSec =
      typeof obj.retryAfterSec === 'number' && Number.isFinite(obj.retryAfterSec)
        ? Math.max(1, Math.round(obj.retryAfterSec))
        : undefined;
    const attemptsMade =
      typeof obj.attemptsMade === 'number' && Number.isFinite(obj.attemptsMade)
        ? Math.max(1, Math.round(obj.attemptsMade))
        : undefined;
    return new ApiError(
      serverMessage || 'Gemini API quota is temporarily busy. Retrying automatically after cooldown.',
      {
        title: 'AI Quota Cooldown',
        status,
        code: code ?? 'RATE_LIMITED',
        retryAfterSec,
        attemptsMade,
      }
    );
  }

  if (status >= 500) {
    return new ApiError(
      serverMessage || `Upstream service error (HTTP ${status}). Try again in a few seconds.`,
      {
        title: code === 'CONFIG_ERROR' ? 'Server Configuration Error' : 'Upstream Service Error',
        status,
        code: code ?? 'SERVER_ERROR',
      }
    );
  }

  return new ApiError(serverMessage || `Unexpected HTTP ${status} response.`, {
    title: 'Request Error',
    status,
    code,
  });
}

export function extractErrorDisplay(err: unknown): {
  title: string;
  message: string;
  code?: string;
  retryAfterSec?: number;
  attemptsMade?: number;
} {
  if (err instanceof ApiError) {
    return {
      title: err.title,
      message: err.message,
      code: err.code,
      retryAfterSec: err.retryAfterSec,
      attemptsMade: err.attemptsMade,
    };
  }
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return {
      title: 'Network Connection Error',
      message: 'Could not reach the IND AGENT server. Check your connection and retry.',
    };
  }
  if (err instanceof Error) {
    return {
      title: 'Request Error',
      message: err.message || 'An unexpected error occurred.',
    };
  }
  return {
    title: 'Request Error',
    message: 'An unexpected error occurred.',
  };
}
