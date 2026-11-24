import {
  ApiError,
  buildApiErrorFromPayload,
  normalizeArray,
  normalizeChatResponse,
  normalizeToolStatus,
  normalizeUserAccount,
  type NormalizedChatResponse,
} from '../utils/apiResponse';
import { auth } from './firebase';
import type {
  ActionType,
  AgentMode,
  AgentTaskStep,
  ChatAttachment,
  DriveFileItem,
  GmailMessageItem,
  MemoryFact,
  ModelChoice,
  PendingAction,
  PromptOptimizationFocus,
  PromptOptimizationResult,
  ToolStatusSummary,
  UserAccountSummary,
} from '../types/agent';

function buildHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'ind-agent',
  };
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function buildAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers = buildHeaders(includeJson);
  try {
    const current = auth.currentUser;
    if (current) {
      const token = await current.getIdToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {
    // Fallback cleanly to cookie-based session
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');

  let parsed: unknown = null;
  if (isJson) {
    try {
      parsed = await res.json();
    } catch {
      throw new ApiError(
        `The server sent malformed JSON (HTTP ${res.status}). Retry or check server logs.`,
        { title: 'Malformed Server Response', status: res.status, code: 'MALFORMED_JSON' }
      );
    }
  }

  if (!res.ok) {
    throw buildApiErrorFromPayload(res.status, parsed, contentType);
  }

  if (!isJson || parsed === null || typeof parsed !== 'object') {
    throw buildApiErrorFromPayload(res.status, parsed, contentType);
  }

  return parsed as T;
}

export async function fetchAccount(): Promise<UserAccountSummary> {
  const res = await fetch('/api/account', {
    headers: await buildAuthHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ account?: unknown }>(res);
  return normalizeUserAccount(data?.account);
}

export async function createFirebaseServerSession(
  idToken: string,
  cloudUsage?: { windowStartedAtMs: number; windowMessagesUsed: number }
): Promise<UserAccountSummary> {
  const res = await fetch('/api/auth/firebase/session', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ idToken, cloudUsage }),
  });
  const data = await handleResponse<{ account?: unknown }>(res);
  return normalizeUserAccount(data?.account);
}

export async function hydrateServerUsage(
  windowStartedAtMs: number,
  windowMessagesUsed: number
): Promise<UserAccountSummary> {
  const res = await fetch('/api/account/hydrate-usage', {
    method: 'POST',
    headers: await buildAuthHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ windowStartedAtMs, windowMessagesUsed }),
  });
  const data = await handleResponse<{ account?: unknown }>(res);
  return normalizeUserAccount(data?.account);
}

export async function logoutFirebaseServerSession(): Promise<UserAccountSummary> {
  const res = await fetch('/api/auth/firebase/logout', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
  });
  const data = await handleResponse<{ account?: unknown }>(res);
  return normalizeUserAccount(data?.account);
}

export async function fetchBillingDefaults(): Promise<{
  upiId: string;
  payeeName: string;
  priceInr: number;
}> {
  const res = await fetch('/api/billing/defaults', {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ upiId?: unknown; payeeName?: unknown; priceInr?: unknown }>(res);
  return {
    upiId: typeof data?.upiId === 'string' ? data.upiId : '',
    payeeName: typeof data?.payeeName === 'string' && data.payeeName ? data.payeeName : 'IND AGENT',
    priceInr: typeof data?.priceInr === 'number' && Number.isFinite(data.priceInr) ? data.priceInr : 200,
  };
}

export async function adminSetUserPlanOnServer(
  idToken: string,
  targetUid: string,
  plan: 'free' | 'plus',
  planExpiresAt?: number
): Promise<UserAccountSummary> {
  const res = await fetch('/api/admin/set-user-plan', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ idToken, targetUid, plan, planExpiresAt }),
  });
  const data = await handleResponse<{ account?: unknown }>(res);
  return normalizeUserAccount(data?.account);
}

export async function fetchMemoryFacts(): Promise<MemoryFact[]> {
  const res = await fetch('/api/memory', {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ facts?: unknown }>(res);
  return normalizeArray<MemoryFact>(data?.facts);
}

export async function addMemoryFact(
  content: string,
  category: MemoryFact['category'] = 'context'
): Promise<MemoryFact[]> {
  const res = await fetch('/api/memory', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ content, category }),
  });
  const data = await handleResponse<{ facts?: unknown }>(res);
  return normalizeArray<MemoryFact>(data?.facts);
}

export async function deleteMemoryFact(id: string): Promise<MemoryFact[]> {
  const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ facts?: unknown }>(res);
  return normalizeArray<MemoryFact>(data?.facts);
}

export async function clearMemoryFacts(): Promise<MemoryFact[]> {
  const res = await fetch('/api/memory', {
    method: 'DELETE',
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ facts?: unknown }>(res);
  return normalizeArray<MemoryFact>(data?.facts);
}

export async function fetchToolStatus(): Promise<ToolStatusSummary> {
  const res = await fetch('/api/tools/status', {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<unknown>(res);
  return normalizeToolStatus(data);
}

export async function saveGmailServerSession(
  accessToken: string,
  email?: string,
  displayName?: string
): Promise<{ connected: boolean; accountLabel: string }> {
  const res = await fetch('/api/auth/gmail/session', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ accessToken, email, displayName }),
  });
  const data = await handleResponse<{ connected?: boolean; accountLabel?: string }>(res);
  return {
    connected: Boolean(data?.connected),
    accountLabel:
      typeof data?.accountLabel === 'string' ? data.accountLabel : email || 'Google account',
  };
}

export async function disconnectGmail(): Promise<void> {
  const res = await fetch('/api/auth/gmail/disconnect', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function saveDriveServerSession(
  accessToken: string,
  email?: string,
  displayName?: string
): Promise<{ connected: boolean; accountLabel: string; folderName: string }> {
  const res = await fetch('/api/auth/drive/session', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ accessToken, email, displayName }),
  });
  const data = await handleResponse<{
    connected?: boolean;
    accountLabel?: string;
    folderName?: string;
  }>(res);
  return {
    connected: Boolean(data?.connected),
    accountLabel:
      typeof data?.accountLabel === 'string' ? data.accountLabel : email || 'Google account',
    folderName: typeof data?.folderName === 'string' ? data.folderName : 'IND AGENT',
  };
}

export async function disconnectDrive(): Promise<void> {
  const res = await fetch('/api/auth/drive/disconnect', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
  });
  await handleResponse<{ ok: boolean }>(res);
}

export interface OptimizePromptRequestPayload {
  message: string;
  mode: AgentMode;
  focus?: PromptOptimizationFocus;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function optimizeUserPrompt(
  payload: OptimizePromptRequestPayload
): Promise<PromptOptimizationResult> {
  const res = await fetch('/api/agent/optimize-prompt', {
    method: 'POST',
    headers: await buildAuthHeaders(true),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return handleResponse<PromptOptimizationResult>(res);
}

export interface AgentChatRequestPayload {
  message: string;
  mode: AgentMode;
  modelChoice: ModelChoice;
  fastMode: boolean;
  debugLoop: boolean;
  memoryEnabled: boolean;
  customInstructions?: string;
  skipAutoCodeVerify?: boolean;
  attachments?: ChatAttachment[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function sendAgentChat(
  payload: AgentChatRequestPayload
): Promise<NormalizedChatResponse> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: await buildAuthHeaders(true),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const raw = await handleResponse<unknown>(res);
  return normalizeChatResponse(raw);
}

async function pollChatJobUntilComplete(
  jobId: string,
  callbacks: {
    onTask?: (task: AgentTaskStep) => void;
    onReplace?: (text: string) => void;
    onMemory?: (fact: MemoryFact) => void;
  },
  jobToken?: string
): Promise<NormalizedChatResponse> {
  const startedAt = Date.now();
  const maxPollMs = 8 * 60 * 1000;
  let consecutiveFetchErrors = 0;
  let consecutiveNotFound = 0;
  const deliveredMemoryIds = new Set<string>();
  let lastPartialText = '';
  let pollCount = 0;

  while (Date.now() - startedAt < maxPollMs) {
    // Poll quickly at first (500ms -> 850ms) so live tasks and responses feel instant
    const waitMs = pollCount === 0 ? 350 : pollCount < 4 ? 650 : 900;
    pollCount += 1;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const headers = await buildAuthHeaders();
      if (jobToken) {
        headers['X-Job-Token'] = jobToken;
      }
      const res = await fetch(`/api/agent/chat/jobs/${encodeURIComponent(jobId)}`, {
        headers,
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.status === 404) {
        consecutiveNotFound += 1;
        if (consecutiveNotFound >= 3) {
          throw new ApiError(
            'The server restarted while processing your request. Click Retry to run it again.',
            {
              title: 'Session Interrupted',
              status: 502,
              code: 'JOB_EXPIRED',
            }
          );
        }
        continue;
      }

      if (!res.ok) {
        consecutiveFetchErrors += 1;
        if (consecutiveFetchErrors >= 10) {
          throw new ApiError(
            'Connection was interrupted while waiting for IND AGENT. Please retry.',
            {
              title: 'Connection Interrupted',
              status: res.status,
              code: 'POLL_FAILED',
            }
          );
        }
        continue;
      }

      consecutiveFetchErrors = 0;
      consecutiveNotFound = 0;
      const data = (await res.json()) as {
        status?: 'running' | 'done' | 'error';
        tasks?: AgentTaskStep[];
        partialText?: string;
        savedMemories?: MemoryFact[];
        payload?: unknown;
        error?: string;
        code?: string;
        retryAfterSec?: number;
        attemptsMade?: number;
      };

      if (Array.isArray(data.tasks)) {
        for (const task of data.tasks) {
          callbacks.onTask?.(task);
        }
      }
      if (Array.isArray(data.savedMemories)) {
        for (const fact of data.savedMemories) {
          if (fact?.id && !deliveredMemoryIds.has(fact.id)) {
            deliveredMemoryIds.add(fact.id);
            callbacks.onMemory?.(fact);
          }
        }
      }
      if (typeof data.partialText === 'string' && data.partialText !== lastPartialText) {
        lastPartialText = data.partialText;
        callbacks.onReplace?.(data.partialText);
      }

      if (data.status === 'done' && data.payload) {
        return normalizeChatResponse(data.payload);
      }

      if (data.status === 'error') {
        const errCode = typeof data.code === 'string' ? data.code : 'STREAM_ERROR';
        const retryAfterSec =
          typeof data.retryAfterSec === 'number' && Number.isFinite(data.retryAfterSec)
            ? Math.max(1, Math.round(data.retryAfterSec))
            : undefined;
        const attemptsMade =
          typeof data.attemptsMade === 'number' && Number.isFinite(data.attemptsMade)
            ? Math.max(1, Math.round(data.attemptsMade))
            : undefined;
        throw new ApiError(
          typeof data.error === 'string' ? data.error : 'Generation failed on the server.',
          {
            title:
              errCode === 'CONFIG_ERROR'
                ? 'Server Configuration Error'
                : errCode === 'RATE_LIMITED'
                  ? 'AI Quota Cooldown'
                  : 'Upstream Service Error',
            status: errCode === 'RATE_LIMITED' ? 429 : 502,
            code: errCode,
            retryAfterSec,
            attemptsMade,
          }
        );
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      consecutiveFetchErrors += 1;
      if (consecutiveFetchErrors >= 10) {
        throw new ApiError(
          'Network connection was lost while waiting for IND AGENT. Please retry.',
          {
            title: 'Network Error',
            status: 502,
            code: 'NETWORK_LOST',
          }
        );
      }
    }
  }

  throw new ApiError(
    'IND AGENT took longer than expected. Please retry with a slightly shorter request.',
    {
      title: 'Request Timed Out',
      status: 504,
      code: 'POLL_TIMEOUT',
    }
  );
}

export async function sendAgentChatStream(
  payload: AgentChatRequestPayload,
  callbacks: {
    onTask?: (task: AgentTaskStep) => void;
    onDelta?: (text: string) => void;
    onReplace?: (text: string) => void;
    onMemory?: (fact: MemoryFact) => void;
  }
): Promise<NormalizedChatResponse> {
  // Primary transport: decoupled background job (POST /api/agent/chat/jobs -> short-poll with X-Job-Token).
  // Immune to mobile disconnects, iframe third-party cookie blocking, and reverse proxy 60s stream cutoffs.
  try {
    const startRes = await fetch('/api/agent/chat/jobs', {
      method: 'POST',
      headers: await buildAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (startRes.status !== 404) {
      const startCt = startRes.headers.get('content-type') ?? '';
      let startParsed: unknown = null;
      if (startCt.toLowerCase().includes('application/json')) {
        try {
          startParsed = await startRes.json();
        } catch {
          startParsed = null;
        }
      }
      if (!startRes.ok) {
        throw buildApiErrorFromPayload(startRes.status, startParsed, startCt);
      }
      const jobObj =
        startParsed && typeof startParsed === 'object'
          ? (startParsed as { jobId?: unknown; jobToken?: unknown })
          : {};
      if (typeof jobObj.jobId === 'string' && jobObj.jobId) {
        return pollChatJobUntilComplete(
          jobObj.jobId,
          callbacks,
          typeof jobObj.jobToken === 'string' ? jobObj.jobToken : undefined
        );
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Fall through to streaming fallback only if the jobs endpoint itself was unreachable
  }

  // Fallback NDJSON stream transport
  const res = await fetch('/api/agent/chat/stream', {
    method: 'POST',
    headers: await buildAuthHeaders(true),
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let parsed: unknown = null;
    if (contentType.toLowerCase().includes('application/json')) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    }
    throw buildApiErrorFromPayload(res.status, parsed, contentType);
  }

  if (!res.body) {
    return sendAgentChat(payload);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let jobId: string | null = null;
  let jobToken: string | undefined;
  let finalResponse: NormalizedChatResponse | null = null;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    if (frame.type === 'ping') {
      return;
    } else if (frame.type === 'job' && typeof frame.jobId === 'string') {
      jobId = frame.jobId;
      if (typeof frame.jobToken === 'string') {
        jobToken = frame.jobToken;
      }
    } else if (frame.type === 'task' && frame.task && typeof frame.task === 'object') {
      callbacks.onTask?.(frame.task as AgentTaskStep);
    } else if (frame.type === 'delta' && typeof frame.text === 'string') {
      callbacks.onDelta?.(frame.text);
    } else if (frame.type === 'replace' && typeof frame.text === 'string') {
      callbacks.onReplace?.(frame.text);
    } else if (frame.type === 'memory' && frame.fact && typeof frame.fact === 'object') {
      callbacks.onMemory?.(frame.fact as MemoryFact);
    } else if (frame.type === 'done' && frame.payload) {
      finalResponse = normalizeChatResponse(frame.payload);
    } else if (frame.type === 'error') {
      const errCode = typeof frame.code === 'string' ? frame.code : 'STREAM_ERROR';
      const retryAfterSec =
        typeof frame.retryAfterSec === 'number' && Number.isFinite(frame.retryAfterSec)
          ? Math.max(1, Math.round(frame.retryAfterSec))
          : undefined;
      const attemptsMade =
        typeof frame.attemptsMade === 'number' && Number.isFinite(frame.attemptsMade)
          ? Math.max(1, Math.round(frame.attemptsMade))
          : undefined;
      throw new ApiError(
        typeof frame.error === 'string' ? frame.error : 'Streaming request failed.',
        {
          title:
            errCode === 'CONFIG_ERROR'
              ? 'Server Configuration Error'
              : errCode === 'RATE_LIMITED'
                ? 'AI Quota Cooldown'
                : 'Upstream Service Error',
          status: errCode === 'RATE_LIMITED' ? 429 : 502,
          code: errCode,
          retryAfterSec,
          attemptsMade,
        }
      );
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    }

    if (buffer.trim()) {
      processLine(buffer);
    }
  } catch (err) {
    // If the server explicitly sent an ApiError frame, propagate it immediately
    if (err instanceof ApiError) throw err;
    // Otherwise (proxy reset, mobile network blip), seamlessly resume the running server job!
    if (jobId) {
      return pollChatJobUntilComplete(jobId, callbacks, jobToken);
    }
    throw err;
  }

  if (!finalResponse) {
    // Proxy cleanly closed the HTTP stream before the final 'done' frame — resume server job automatically!
    if (jobId) {
      return pollChatJobUntilComplete(jobId, callbacks, jobToken);
    }
    throw new ApiError('Connection ended early before finishing. Please retry.', {
      title: 'Connection Interrupted',
      status: 502,
      code: 'STREAM_INCOMPLETE',
    });
  }

  return finalResponse;
}

export async function fetchActions(): Promise<PendingAction[]> {
  const res = await fetch('/api/actions', {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ actions?: unknown }>(res);
  return normalizeArray<PendingAction>(data?.actions);
}

export async function queueManualAction(input: {
  type: ActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  previewText: string;
  riskLevel?: 'standard' | 'elevated';
  warning?: string;
}): Promise<PendingAction> {
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ action?: PendingAction }>(res);
  if (!data?.action) {
    throw new ApiError('Server did not return the queued action preview.', {
      title: 'Queue Error',
      status: res.status,
    });
  }
  return data.action;
}

export async function approveAction(id: string): Promise<PendingAction> {
  const res = await fetch(`/api/actions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
    body: JSON.stringify({ confirmed: true }),
  });
  const data = await handleResponse<{ action?: PendingAction }>(res);
  if (!data?.action) {
    throw new ApiError('Server did not return the updated action status.', {
      title: 'Approval Error',
      status: res.status,
    });
  }
  return data.action;
}

export async function rejectAction(id: string): Promise<PendingAction> {
  const res = await fetch(`/api/actions/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: buildHeaders(true),
    credentials: 'include',
  });
  const data = await handleResponse<{ action?: PendingAction }>(res);
  if (!data?.action) {
    throw new ApiError('Server did not return the rejected action status.', {
      title: 'Rejection Error',
      status: res.status,
    });
  }
  return data.action;
}

export async function fetchGmailMessages(query = ''): Promise<GmailMessageItem[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await fetch(`/api/gmail/messages${qs}`, {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ messages?: unknown }>(res);
  return normalizeArray<GmailMessageItem>(data?.messages);
}

export async function fetchGmailMessageDetail(id: string): Promise<GmailMessageItem> {
  const res = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}`, {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ message?: GmailMessageItem }>(res);
  if (!data?.message) {
    throw new ApiError('Email details could not be loaded.', {
      title: 'Gmail Error',
      status: res.status,
    });
  }
  return data.message;
}

export async function fetchDriveFiles(query = ''): Promise<DriveFileItem[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await fetch(`/api/drive/files${qs}`, {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ files?: unknown }>(res);
  return normalizeArray<DriveFileItem>(data?.files);
}

export async function fetchDriveFileDetail(fileId: string): Promise<DriveFileItem> {
  const res = await fetch(`/api/drive/files/${encodeURIComponent(fileId)}`, {
    headers: buildHeaders(),
    credentials: 'include',
  });
  const data = await handleResponse<{ file?: DriveFileItem }>(res);
  if (!data?.file) {
    throw new ApiError('Google Drive file details could not be loaded.', {
      title: 'Google Drive Error',
      status: res.status,
    });
  }
  return data.file;
}
