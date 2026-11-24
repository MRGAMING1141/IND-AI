import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Content, FunctionCall, Part } from '@google/genai';
import {
  AGENT_FUNCTION_DECLARATIONS,
  buildAutoDebugFixPrompt,
  buildHyperSelfReviewPrompt,
  buildIndAgentSystemPrompt,
} from './systemPrompt.ts';
import {
  IND_AGENT_DRIVE_FOLDER,
  createGmailDraft,
  listDriveFiles,
  readDriveFile,
  readGmailMessage,
  saveDriveFile,
  searchGmailMessages,
  sendGmailMessage,
  trashDriveFile,
  updateDriveFile,
} from './toolConnectors.ts';
import {
  analyzeCodingIntent,
  detectFollowUpCodeEdit,
  extractFencedCodeBlocks,
  runSandboxedJsCheck,
  verifyCodeBlocks,
} from './codeVerifier.ts';
import {
  analyzePromptDeeply,
  refinePromptUnderstandingWithAI,
  type PromptComplexity,
} from './promptUnderstanding.ts';
import {
  GeminiRateLimitError,
  extractRetryDelayMs,
  formatGeminiError,
  isQuotaOrRateLimitError,
  isRetryableGeminiError,
  withGeminiExponentialBackoff,
} from './geminiRetry.ts';
import { memoryStore } from './memoryStore.ts';
import {
  ALLOWED_BINARY_DOC_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TEXT_FILE_CHARS,
} from '../src/utils/attachments.ts';
import { getContextLimit } from '../src/utils/planEngine.ts';
import {
  isForbiddenDeleteAction,
  redactSecrets,
  wrapUntrustedData,
} from '../src/utils/safetyEngine.ts';
import type {
  ActionType,
  AgentMode,
  AgentTaskStep,
  ChatAttachment,
  CodeVerificationSummary,
  InjectionAlert,
  MemoryFact,
  ModelChoice,
  PendingAction,
  UserPlan,
  WebSource,
} from '../src/types/agent.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FAST_MODEL = 'gemini-3.1-flash-lite';

// Tracks temporary 60s cooldowns on models that just exhausted 429 quota so
// multi-pass refinement loops immediately route to healthy capacity instead of re-sleeping 28s per pass.
const modelQuotaCooldownUntil = new Map<string, number>();

function isModelInQuotaCooldown(model: string): boolean {
  const until = modelQuotaCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelQuotaCooldownUntil.delete(model);
    return false;
  }
  return true;
}

function markModelQuotaCooldown(model: string, durationMs = 60_000): void {
  modelQuotaCooldownUntil.set(model, Date.now() + durationMs);
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Check your API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Per-user isolated action approval queues: userId -> (actionId -> PendingAction)
const userActionsStore = new Map<string, Map<string, PendingAction>>();

function getUserActionMap(userId: string): Map<string, PendingAction> {
  let map = userActionsStore.get(userId);
  if (!map) {
    map = new Map<string, PendingAction>();
    userActionsStore.set(userId, map);
  }
  return map;
}

export function listActionsForUser(userId: string): PendingAction[] {
  const map = userActionsStore.get(userId);
  if (!map) return [];
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function createPendingActionForUser(
  userId: string,
  input: {
    type: ActionType;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    previewText: string;
    riskLevel?: 'standard' | 'elevated';
    warning?: string;
  }
): PendingAction {
  if (isForbiddenDeleteAction(input.type)) {
    throw new Error('Safety Rule: Email deletion is permanently disabled.');
  }

  const action: PendingAction = {
    id: `act_${crypto.randomBytes(6).toString('hex')}`,
    type: input.type,
    title: input.title,
    summary: input.summary,
    riskLevel: input.riskLevel ?? 'standard',
    warning: input.warning,
    payload: input.payload,
    previewText: redactSecrets(input.previewText),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  getUserActionMap(userId).set(action.id, action);
  return action;
}

export function rejectPendingActionForUser(userId: string, id: string): PendingAction {
  const map = getUserActionMap(userId);
  const action = map.get(id);
  if (!action) {
    throw new Error('Action not found for your session.');
  }
  if (action.status !== 'pending') {
    throw new Error(`Action is already ${action.status}.`);
  }
  action.status = 'rejected';
  action.executedAt = new Date().toISOString();
  action.resultMessage = 'Rejected — no external changes were made.';
  map.set(id, action);
  return action;
}

export interface ToolCredentials {
  gmailToken?: string;
  driveToken?: string;
}

export async function approveAndExecuteActionForUser(
  userId: string,
  id: string,
  creds: ToolCredentials
): Promise<PendingAction> {
  const map = getUserActionMap(userId);
  const action = map.get(id);
  if (!action) {
    throw new Error('Action not found for your session.');
  }
  if (action.status !== 'pending') {
    throw new Error(`Action is already ${action.status}.`);
  }
  if (isForbiddenDeleteAction(action.type)) {
    throw new Error('Safety Rule: This delete action is permanently disabled.');
  }

  try {
    const p = action.payload ?? {};

    switch (action.type) {
      case 'gmail_create_draft': {
        if (!creds.gmailToken) {
          throw new Error(
            'Gmail is not connected. Click "Connect Gmail" in the Tools tab, then retry approval.'
          );
        }
        const res = await createGmailDraft(creds.gmailToken, {
          to: String(p.to ?? ''),
          subject: String(p.subject ?? ''),
          body: String(p.body ?? ''),
        });
        action.resultMessage = `Saved Gmail draft (ID: ${res.draftId}).`;
        action.resultUrl = res.url;
        break;
      }

      case 'gmail_send_email': {
        if (!creds.gmailToken) {
          throw new Error(
            'Gmail is not connected. Click "Connect Gmail" in the Tools tab, then retry approval.'
          );
        }
        const res = await sendGmailMessage(creds.gmailToken, {
          to: String(p.to ?? ''),
          subject: String(p.subject ?? ''),
          body: String(p.body ?? ''),
        });
        action.resultMessage = `Email sent via Gmail (ID: ${res.messageId}).`;
        action.resultUrl = res.url;
        break;
      }

      case 'drive_save_file': {
        if (!creds.driveToken) {
          throw new Error(
            'Google Drive is not connected. Click "Connect Google Drive" in the Tools tab, then retry approval.'
          );
        }
        const res = await saveDriveFile(creds.driveToken, {
          name: String(p.name ?? 'ind-agent-file.txt'),
          content: String(p.content ?? ''),
          mimeType: typeof p.mimeType === 'string' ? p.mimeType : undefined,
        });
        action.resultMessage = `Saved "${res.name}" to Google Drive folder "${IND_AGENT_DRIVE_FOLDER}".`;
        action.resultUrl = res.webViewLink;
        break;
      }

      case 'drive_update_file': {
        if (!creds.driveToken) {
          throw new Error(
            'Google Drive is not connected. Click "Connect Google Drive" in the Tools tab, then retry approval.'
          );
        }
        const res = await updateDriveFile(creds.driveToken, {
          fileId: String(p.fileId ?? ''),
          name: typeof p.name === 'string' ? p.name : undefined,
          content: String(p.content ?? ''),
          mimeType: typeof p.mimeType === 'string' ? p.mimeType : undefined,
        });
        action.resultMessage = `Updated "${res.name}" in Google Drive.`;
        action.resultUrl = res.webViewLink;
        break;
      }

      case 'drive_delete_file': {
        if (!creds.driveToken) {
          throw new Error(
            'Google Drive is not connected. Click "Connect Google Drive" in the Tools tab, then retry approval.'
          );
        }
        const res = await trashDriveFile(creds.driveToken, String(p.fileId ?? ''));
        action.resultMessage = `Moved "${res.name}" to Google Drive Trash.`;
        action.resultUrl = 'https://drive.google.com/drive/trash';
        break;
      }

      default:
        throw new Error(`Unsupported action type: ${String(action.type)}`);
    }

    action.status = 'approved';
    action.executedAt = new Date().toISOString();
    action.errorMessage = undefined;
    map.set(id, action);
    return action;
  } catch (err) {
    const safeError = redactSecrets(err instanceof Error ? err.message : 'Execution failed.');
    action.errorMessage = safeError;
    map.set(id, action);
    throw new Error(safeError);
  }
}

export type AgentStreamEvent =
  | { type: 'task'; task: AgentTaskStep }
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'memory'; fact: MemoryFact };

export interface AgentChatTurnInput {
  userId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  mode: AgentMode;
  plan: UserPlan;
  modelChoice: ModelChoice;
  fastMode?: boolean;
  debugLoop?: boolean;
  memoryEnabled?: boolean;
  customInstructions?: string;
  skipAutoCodeVerify?: boolean;
  attachments?: ChatAttachment[];
  creds: ToolCredentials;
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AgentChatTurnResult {
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
  elapsedMs: number;
}

export {
  GeminiRateLimitError,
  extractRetryDelayMs,
  formatGeminiError,
  isQuotaOrRateLimitError,
};

const TOOL_LABELS: Record<string, string> = {
  gmail_search_emails: 'Searching Gmail messages',
  gmail_read_email: 'Reading Gmail message',
  propose_gmail_draft: 'Preparing Gmail draft preview',
  propose_gmail_send: 'Preparing Gmail send preview',
  drive_list_files: 'Listing Google Drive files',
  drive_read_file: 'Reading Google Drive file',
  propose_drive_save_file: 'Preparing Google Drive save preview',
  propose_drive_update_file: 'Preparing Google Drive overwrite preview',
  propose_drive_delete_file: 'Preparing Google Drive trash preview',
  save_memory_fact: 'Saving fact to Chat Memory',
  verify_code_snippet: 'Testing & debugging code in sandbox',
};

function sanitizeAttachmentsToParts(
  attachments: ChatAttachment[] | undefined,
  injectionAlerts: InjectionAlert[]
): { parts: Part[]; count: number; names: string[] } {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { parts: [], count: 0, names: [] };
  }

  const parts: Part[] = [];
  const names: string[] = [];

  for (const att of attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    if (!att || typeof att.name !== 'string') continue;
    const safeName = att.name.slice(0, 140);
    const mime = typeof att.mimeType === 'string' ? att.mimeType.toLowerCase() : '';

    if (
      (ALLOWED_IMAGE_MIME_TYPES.has(mime) || ALLOWED_BINARY_DOC_MIME_TYPES.has(mime)) &&
      typeof att.dataBase64 === 'string' &&
      att.dataBase64.length > 0 &&
      att.dataBase64.length <= 6_000_000
    ) {
      parts.push({
        inlineData: {
          mimeType: mime,
          data: att.dataBase64,
        },
      });
      parts.push({
        text: `[Attached ${mime.startsWith('image/') ? 'image' : 'document'}: ${safeName}]`,
      });
      names.push(safeName);
      continue;
    }

    if (typeof att.textContent === 'string' && att.textContent.length > 0) {
      const clipped = att.textContent.slice(0, MAX_TEXT_FILE_CHARS);
      const wrapped = wrapUntrustedData(`Attached file: ${safeName}`, clipped);
      if (wrapped.flagged) {
        injectionAlerts.push({
          source: `Attached file: ${safeName}`,
          matches: wrapped.matches,
        });
      }
      parts.push({
        text: `Attached file "${safeName}":\n${wrapped.wrapped}`,
      });
      names.push(safeName);
    }
  }

  return { parts, count: names.length, names };
}

async function generateStreamWithFallback(
  ai: GoogleGenAI,
  contents: Content[],
  systemInstruction: string,
  options: {
    useTools: boolean;
    enableWebSearch?: boolean;
    excludeVerifyTool?: boolean;
    isHyper: boolean;
    fastMode: boolean;
    preferPrimaryCoding?: boolean;
    complexity?: PromptComplexity;
    isLargeGeneration?: boolean;
    thinkingLevelOverride?: ThinkingLevel;
    onDelta?: (chunkText: string) => void;
    onRetryStatus?: (label: string, detail: string) => void;
  }
): Promise<{
  text: string;
  functionCalls: FunctionCall[];
  modelParts: Part[];
  modelUsed: string;
  webSources: WebSource[];
  searchQueries: string[];
}> {
  const activeDeclarations = options.excludeVerifyTool
    ? AGENT_FUNCTION_DECLARATIONS.filter((fn) => fn.name !== 'verify_code_snippet')
    : AGENT_FUNCTION_DECLARATIONS;

  const enableWebSearch = options.enableWebSearch !== false;

  const buildToolsConfig = (includeBuiltInSearch: boolean) => {
    const toolsList: Array<Record<string, unknown>> = [];
    if (includeBuiltInSearch) {
      toolsList.push({ googleSearch: {} });
      toolsList.push({ urlContext: {} });
    }
    if (options.useTools) {
      toolsList.push({ functionDeclarations: activeDeclarations });
    }
    const hasHybrid = includeBuiltInSearch && options.useTools;
    return {
      tools: toolsList.length > 0 ? toolsList : undefined,
      toolConfig: hasHybrid ? { includeServerSideToolInvocations: true } : undefined,
    };
  };

  // Respect Fast Mode (snappy FAST_MODEL first with MEDIUM reasoning for complex/coding prompts)
  // vs Deep/Hyper (flagship PRIMARY_MODEL first). If the preferred model just hit 429 quota cooldown,
  // immediately prioritize the healthy alternate model so multi-pass refinement stays fast.
  const preferPrimaryFirst = options.isHyper || !options.fastMode;
  const baseOrder = preferPrimaryFirst
    ? [PRIMARY_MODEL, FAST_MODEL]
    : [FAST_MODEL, PRIMARY_MODEL];
  const attemptModels =
    isModelInQuotaCooldown(baseOrder[0]) && !isModelInQuotaCooldown(baseOrder[1])
      ? [baseOrder[1], baseOrder[0]]
      : baseOrder;

  let lastError: unknown;
  let totalAttempts = 0;

  for (let modelIdx = 0; modelIdx < attemptModels.length; modelIdx += 1) {
    const model = attemptModels[modelIdx];
    const isLastModel = modelIdx === attemptModels.length - 1;
    // Try with live Google Search + URL Context first; if search grounding hits 429 or 400, gracefully retry without built-in search
    const searchModes = enableWebSearch ? [true, false] : [false];

    for (const includeSearch of searchModes) {
      const thinkingLevel =
        model === PRIMARY_MODEL
          ? (options.thinkingLevelOverride ??
            (options.isHyper
              ? ThinkingLevel.HIGH
              : options.complexity === 'complex' || options.preferPrimaryCoding
                ? ThinkingLevel.MEDIUM
                : ThinkingLevel.LOW))
          : options.isHyper
            ? ThinkingLevel.HIGH
            : options.isLargeGeneration || options.preferPrimaryCoding || options.complexity === 'complex'
              ? ThinkingLevel.MEDIUM
              : ThinkingLevel.LOW;

      const thinkingConfig = thinkingLevel ? { thinkingLevel } : undefined;
      const { tools, toolConfig } = buildToolsConfig(includeSearch);

      // When an alternate model is still available (!isLastModel), fail over quickly after 1 short backoff;
      // on the final model, run full exponential backoff retries before surfacing the cooldown card.
      const maxRetries = includeSearch ? 1 : isLastModel ? 3 : 1;

      try {
        const { result, attemptsMade } = await withGeminiExponentialBackoff(
          async () => {
            totalAttempts += 1;
            const controller = new AbortController();
            const firstChunkTimeoutMs = options.isHyper
              ? 180_000
              : isLastModel
                ? 60_000
                : options.isLargeGeneration
                  ? 55_000
                  : options.fastMode
                    ? 25_000
                    : 40_000;
            let receivedAnyChunk = false;

            const watchdog = setTimeout(() => {
              if (!receivedAnyChunk) {
                controller.abort();
              }
            }, firstChunkTimeoutMs);

            try {
              const stream = await ai.models.generateContentStream({
                model,
                contents,
                config: {
                  systemInstruction,
                  ...(tools ? { tools: tools as never } : {}),
                  ...(toolConfig ? { toolConfig: toolConfig as never } : {}),
                  ...(thinkingConfig ? { thinkingConfig } : {}),
                  abortSignal: controller.signal,
                },
              });

              let fullText = '';
              const functionCalls: FunctionCall[] = [];
              const modelParts: Part[] = [];
              const webSourcesMap = new Map<string, WebSource>();
              const searchQueriesSet = new Set<string>();

              for await (const chunk of stream) {
                const chunkCalls = Array.isArray(chunk?.functionCalls) ? chunk.functionCalls : [];
                if (chunkCalls.length > 0) {
                  functionCalls.push(...chunkCalls);
                }

                const candidate = chunk?.candidates?.[0];
                const candidateParts = candidate?.content?.parts;
                if (Array.isArray(candidateParts)) {
                  for (const part of candidateParts) {
                    modelParts.push(part);
                  }
                }

                // Extract live Google Search grounding sources & queries
                const grounding = candidate?.groundingMetadata;
                if (grounding) {
                  if (Array.isArray(grounding.webSearchQueries)) {
                    for (const q of grounding.webSearchQueries) {
                      if (typeof q === 'string' && q.trim()) {
                        searchQueriesSet.add(q.trim());
                      }
                    }
                  }
                  if (Array.isArray(grounding.groundingChunks)) {
                    for (const gChunk of grounding.groundingChunks) {
                      const uri = gChunk?.web?.uri;
                      const title = gChunk?.web?.title;
                      if (typeof uri === 'string' && uri.trim() && !webSourcesMap.has(uri.trim())) {
                        webSourcesMap.set(uri.trim(), {
                          uri: uri.trim(),
                          title:
                            typeof title === 'string' && title.trim()
                              ? title.trim()
                              : uri.trim().replace(/^https?:\/\/(www\.)?/, '').slice(0, 60),
                        });
                      }
                    }
                  }
                }

                const chunkText = chunk?.text ?? '';
                if (!receivedAnyChunk && (chunkText.length > 0 || chunkCalls.length > 0)) {
                  receivedAnyChunk = true;
                  clearTimeout(watchdog);
                }

                if (chunkText) {
                  fullText += chunkText;
                  if (functionCalls.length === 0) {
                    options.onDelta?.(chunkText);
                  }
                }
              }

              clearTimeout(watchdog);
              return {
                text: fullText,
                functionCalls,
                modelParts,
                modelUsed: model,
                webSources: Array.from(webSourcesMap.values()),
                searchQueries: Array.from(searchQueriesSet.values()),
              };
            } catch (err) {
              clearTimeout(watchdog);
              throw controller.signal.aborted
                ? new Error(`${model} timed out waiting for first token`)
                : err;
            }
          },
          {
            maxRetries,
            baseDelayMs: includeSearch ? 1200 : isLastModel ? 1800 : 1500,
            maxDelayMs: includeSearch ? 4000 : isLastModel ? 16_000 : 4500,
            maxTotalWaitMs: includeSearch ? 5000 : isLastModel ? 28_000 : 6000,
            shouldRetry: (err) => {
              // If hybrid search tools were explicitly rejected (400), immediately drop search without sleeping
              if (includeSearch) {
                const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
                if (raw.includes('400') || raw.includes('invalid_argument')) {
                  return false;
                }
              }
              return isRetryableGeminiError(err);
            },
            onRetry: (info) => {
              const waitSec = (info.delayMs / 1000).toFixed(1);
              options.onRetryStatus?.(
                info.isQuota
                  ? `API quota busy — exponential backoff retry (${info.attempt}/${info.maxRetries})`
                  : `Temporary upstream pause — retrying (${info.attempt}/${info.maxRetries})`,
                `Waiting ${waitSec}s on ${model}${includeSearch ? ' (live search)' : ''}`
              );
            },
          }
        );

        if (attemptsMade > 1) {
          options.onRetryStatus?.(
            'Recovered automatically after backoff',
            `Succeeded on attempt ${attemptsMade} via ${model}`
          );
        }

        return result;
      } catch (err) {
        lastError = err;
        const rawErrText = (
          lastError instanceof Error ? lastError.message : String(lastError ?? '')
        ).toLowerCase();
        const isQuotaErr = isQuotaOrRateLimitError(lastError);

        // If built-in web search hit 429 quota or 400 unsupported, retry SAME model without built-in search
        const canFallbackWithoutSearch =
          includeSearch &&
          (isQuotaErr ||
            rawErrText.includes('400') ||
            rawErrText.includes('invalid_argument') ||
            rawErrText.includes('tool') ||
            rawErrText.includes('search') ||
            rawErrText.includes('unsupported'));
        if (canFallbackWithoutSearch) {
          if (isQuotaErr) {
            options.onRetryStatus?.(
              'Web search quota busy — continuing with core model',
              `Retrying ${model} without search grounding`
            );
          }
          continue;
        }

        if (!isRetryableGeminiError(lastError) || isLastModel) {
          if (isQuotaErr) {
            const hintSec = Math.ceil(extractRetryDelayMs(lastError) / 1000);
            throw new GeminiRateLimitError(redactSecrets(formatGeminiError(lastError)), {
              retryAfterSec: hintSec > 0 ? Math.max(10, hintSec) : 20,
              attemptsMade: totalAttempts,
            });
          }
          throw new Error(redactSecrets(formatGeminiError(lastError)));
        }

        // Fail over to alternate model after exhausting backoff on current model
        if (isQuotaErr) {
          markModelQuotaCooldown(model, 60_000);
        }
        const nextModel = attemptModels[modelIdx + 1];
        options.onRetryStatus?.(
          isQuotaErr
            ? 'Switching model capacity after quota backoff'
            : 'Switching to fallback model',
          `Trying ${nextModel} automatically`
        );
        break;
      }
    }
  }

  if (isQuotaOrRateLimitError(lastError)) {
    const hintSec = Math.ceil(extractRetryDelayMs(lastError) / 1000);
    throw new GeminiRateLimitError(redactSecrets(formatGeminiError(lastError)), {
      retryAfterSec: hintSec > 0 ? Math.max(10, hintSec) : 20,
      attemptsMade: Math.max(1, totalAttempts),
    });
  }
  throw new Error(redactSecrets(formatGeminiError(lastError)));
}

export async function runAgentChatTurn(
  input: AgentChatTurnInput
): Promise<AgentChatTurnResult> {
  const turnStart = Date.now();
  const ai = getGeminiClient();
  const isHyper = input.modelChoice === 'hyper' && input.plan === 'plus';
  const fastMode = isHyper ? false : input.fastMode !== false;
  const debugLoop = input.debugLoop !== false;
  const memoryEnabled = input.memoryEnabled !== false;

  const tasks: AgentTaskStep[] = [];
  const taskStartTimes = new Map<string, number>();

  const startTask = (label: string, detail?: string): string => {
    const id = `step_${tasks.length + 1}_${Date.now()}`;
    const step: AgentTaskStep = {
      id,
      label,
      detail,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    taskStartTimes.set(id, Date.now());
    tasks.push(step);
    input.onEvent?.({ type: 'task', task: { ...step } });
    return id;
  };

  const finishTask = (id: string, status: 'done' | 'error' = 'done', detail?: string) => {
    const step = tasks.find((t) => t.id === id);
    if (!step) return;
    step.status = status;
    if (detail !== undefined) step.detail = detail;
    const started = taskStartTimes.get(id) ?? Date.now();
    step.durationMs = Math.max(1, Date.now() - started);
    input.onEvent?.({ type: 'task', task: { ...step } });
  };

  let activeRetryTaskId: string | null = null;
  const finishActiveRetryTask = () => {
    if (activeRetryTaskId) {
      finishTask(activeRetryTaskId, 'done');
      activeRetryTaskId = null;
    }
  };
  const onRetryStatus = (label: string, detail: string) => {
    finishActiveRetryTask();
    activeRetryTaskId = startTask(label, detail);
  };

  const createdActions: PendingAction[] = [];
  const toolsUsed: string[] = [];
  const injectionAlerts: InjectionAlert[] = [];
  const savedMemories: MemoryFact[] = [];
  const collectedWebSources = new Map<string, WebSource>();
  const collectedSearchQueries = new Set<string>();

  const customInstructions =
    typeof input.customInstructions === 'string'
      ? input.customInstructions.trim().slice(0, 1500)
      : '';
  const skipAutoCodeVerify = Boolean(input.skipAutoCodeVerify);

  const safeHistory = Array.isArray(input.history) ? input.history : [];

  // Check if history already has executable code blocks (for semantic follow-up edit fallback)
  let latestHistoryCodeBlocks: Array<{ language: string; fileName: string; code: string }> = [];
  for (let i = safeHistory.length - 1; i >= 0; i -= 1) {
    const turn = safeHistory[i];
    if (turn?.role === 'assistant' && typeof turn.content === 'string' && turn.content.includes('```')) {
      const blocks = extractFencedCodeBlocks(turn.content);
      if (blocks.length > 0) {
        latestHistoryCodeBlocks = blocks;
        break;
      }
    }
  }

  let followUpEdit = skipAutoCodeVerify
    ? {
        isFollowUpEdit: false,
        previousFileNames: [] as string[],
        previousLineCount: 0,
        previousHasHtmlArtifact: false,
        wantsShrinkOrDelete: false,
        latestCodeBlocks: [] as Array<{ language: string; fileName: string; code: string }>,
      }
    : detectFollowUpCodeEdit(input.message, safeHistory);

  // Step 0: Deep 2-Layer Prompt Understanding (Layer 1 instant analyzer + Layer 2 fast semantic JSON planner)
  const rawIntent = analyzeCodingIntent(input.message, input.mode, input.attachments);
  const intentTaskId = startTask('Understanding prompt intent', rawIntent.summary);

  const baseBrief = analyzePromptDeeply({
    message: input.message,
    mode: input.mode,
    attachments: input.attachments,
    codingIntent: rawIntent,
    followUpEdit,
    historyCount: safeHistory.length,
  });

  const promptBrief = await refinePromptUnderstandingWithAI(ai, {
    rawMessage: input.message,
    history: safeHistory,
    baseBrief,
    hasPreviousCodeInHistory: latestHistoryCodeBlocks.length > 0,
    previousFileNames: latestHistoryCodeBlocks.map((b) => b.fileName),
  });

  // If Layer-2 AI planner detected a subtle/Hinglish follow-up edit to previous code (and NOT prompt writing), activate in-place editing
  if (
    !skipAutoCodeVerify &&
    !promptBrief.isPromptEngineering &&
    !followUpEdit.isFollowUpEdit &&
    promptBrief.semanticFollowUpEdit === true &&
    latestHistoryCodeBlocks.length > 0
  ) {
    followUpEdit = {
      isFollowUpEdit: true,
      previousFileNames: latestHistoryCodeBlocks.map((b) => b.fileName),
      previousLineCount: latestHistoryCodeBlocks.reduce(
        (sum, b) => sum + b.code.trim().split('\n').length,
        0
      ),
      previousHasHtmlArtifact: latestHistoryCodeBlocks.some(
        (b) =>
          (b.language === 'html' || b.language === 'htm') &&
          (/<!doctype\s+html/i.test(b.code) || /<html[\s>]/i.test(b.code))
      ),
      wantsShrinkOrDelete: false,
      latestCodeBlocks: latestHistoryCodeBlocks,
    };
  }

  // If the user asked to write a prompt, strictly enforce prompt-only mode (never build a website!)
  const isPromptEngineeringRequest =
    skipAutoCodeVerify || promptBrief.isPromptEngineering || rawIntent.kind === 'prompt_engineering';
  if (isPromptEngineeringRequest && followUpEdit.isFollowUpEdit) {
    followUpEdit = {
      isFollowUpEdit: false,
      previousFileNames: [],
      previousLineCount: 0,
      previousHasHtmlArtifact: false,
      wantsShrinkOrDelete: false,
      latestCodeBlocks: [],
    };
  }

  const effectiveSkipAutoCodeVerify = skipAutoCodeVerify || isPromptEngineeringRequest;

  const intent = isPromptEngineeringRequest
    ? {
        ...rawIntent,
        kind: 'prompt_engineering' as const,
        isWebsiteOrFullStack: false,
        isLuaUiLibrary: false,
        isHighLevelBuild: false,
        isCodingTask: false,
        isDebuggingTask: false,
        wantsBackend: false,
        wantsMultiFile: false,
        summary: promptBrief.summaryLine || 'Prompt engineering & structured copyable prompt',
      }
    : followUpEdit.isFollowUpEdit
      ? {
          ...rawIntent,
          isCodingTask: true,
          isDebuggingTask:
            rawIntent.isDebuggingTask ||
            /\b(fix|bug|broken|error|crash|repair|debug|thik|kaam\s*nahi)\b/i.test(input.message),
          isWebsiteOrFullStack:
            rawIntent.isWebsiteOrFullStack || followUpEdit.previousHasHtmlArtifact,
          summary: `In-place update to ${followUpEdit.previousFileNames[0] || 'existing code'} · ${promptBrief.primaryGoal.slice(0, 70)}`,
        }
      : promptBrief.intentCategory === 'website_artifact'
        ? {
            ...rawIntent,
            kind: 'build_app' as const,
            isCodingTask: true,
            isWebsiteOrFullStack: true,
            isHighLevelBuild: true,
            summary: promptBrief.summaryLine,
          }
        : {
            ...rawIntent,
            summary: promptBrief.summaryLine || rawIntent.summary,
          };

  finishTask(
    intentTaskId,
    'done',
    promptBrief.refinedByAi ? `${intent.summary} (verified)` : intent.summary
  );

  const preferPrimaryCoding = intent.isCodingTask;
  const modelLabel = isHyper
    ? 'IND HYPER CODING MODEL'
    : preferPrimaryCoding
      ? fastMode
        ? 'Coding Engine (Fast · Verified)'
        : 'Coding Engine (Deep · Verified)'
      : fastMode
        ? 'Standard (Fast)'
        : 'Standard Coding Model';

  // Step 1: Chat memory lookup
  const memoryFacts = memoryEnabled ? memoryStore.listFacts(input.userId) : [];
  if (memoryEnabled) {
    const memTaskId = startTask(
      'Loading chat memory',
      memoryFacts.length > 0
        ? `${memoryFacts.length} saved fact${memoryFacts.length === 1 ? '' : 's'} active`
        : 'Memory active (no saved facts yet)'
    );
    finishTask(memTaskId, 'done');
  }

  // Step 2: Inspect attachments (files & images)
  const attachmentBundle = sanitizeAttachmentsToParts(input.attachments, injectionAlerts);
  if (attachmentBundle.count > 0) {
    const attTaskId = startTask(
      `Inspecting ${attachmentBundle.count} attachment${attachmentBundle.count === 1 ? '' : 's'}`,
      attachmentBundle.names.join(', ')
    );
    finishTask(attTaskId, 'done');
  }

  const systemInstruction = buildIndAgentSystemPrompt(input.mode, {
    gmail: Boolean(input.creds.gmailToken),
    drive: Boolean(input.creds.driveToken),
    plan: input.plan,
    modelChoice: isHyper ? 'hyper' : 'standard',
    fastMode,
    debugLoop,
    memoryEnabled,
    memoryFacts,
    intent,
    promptBrief,
    followUpEdit,
    customInstructions,
  });

  const maxHistory = getContextLimit(input.plan);
  const contents: Content[] = [];
  for (const msg of safeHistory.slice(-maxHistory)) {
    if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    // Never start conversation history with a stray model turn
    if (contents.length === 0 && role === 'model') continue;
    // Coalesce consecutive turns of the same role (e.g. after a retried error)
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      prev.parts = [...(prev.parts ?? []), { text: `\n\n${msg.content}` }];
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content }],
      });
    }
  }

  const userParts: Part[] = [...attachmentBundle.parts];
  if (input.message.trim()) {
    userParts.push({ text: input.message });
  } else if (userParts.length > 0) {
    userParts.push({ text: 'Analyze the attached file(s)/image(s) and summarize or help with them.' });
  }

  // Ensure current user prompt doesn't create adjacent user turns
  const lastContent = contents[contents.length - 1];
  if (lastContent && lastContent.role === 'user') {
    lastContent.parts = [...(lastContent.parts ?? []), { text: '\n\n' }, ...userParts];
  } else {
    contents.push({
      role: 'user',
      parts: userParts,
    });
  }

  const maxToolRounds = 8;

  for (let round = 0; round < maxToolRounds; round += 1) {
    if (round > 0) {
      // Clear any pre-tool narration before streaming the post-tool answer
      input.onEvent?.({ type: 'replace', text: '' });
    }
    const genTaskId = startTask(
      round === 0
        ? isHyper
          ? intent.isWebsiteOrFullStack
            ? 'Designing art direction & building epic website artifact (IND HYPER)'
            : 'Deep-architecting epic implementation (IND HYPER CODING MODEL)'
          : intent.isDebuggingTask
            ? 'Diagnosing root cause & writing fix'
            : intent.isCodingTask
              ? 'Architecting & generating code'
              : fastMode
                ? 'Generating fast response'
                : 'Analyzing & generating response'
        : `Refining response (tool loop ${round + 1})`,
      isHyper
        ? 'Deep architecture & visual craft reasoning (HIGH)'
        : intent.isCodingTask
          ? fastMode
            ? 'Fast coding engine'
            : 'Balanced coding engine'
          : fastMode
            ? 'Fast Mode'
            : 'Balanced Mode'
    );

    const promptNeedsLiveWebLookup =
      /https?:\/\/|\b(latest|current|today|news|weather|price|stock|exchange\s*rate|release|version|docs|documentation|search\s+the\s+web|google|look\s+up|find\s+online|who\s+is|what\s+is\s+the\s+latest|2025|2026)\b/i.test(
        input.message
      );
    const shouldEnableWebSearch =
      !isPromptEngineeringRequest &&
      !followUpEdit.isFollowUpEdit &&
      (promptNeedsLiveWebLookup ||
        (!intent.isWebsiteOrFullStack && !intent.isLuaUiLibrary));

    let streamed;
    try {
      streamed = await generateStreamWithFallback(ai, contents, systemInstruction, {
        useTools: !isPromptEngineeringRequest,
        enableWebSearch: shouldEnableWebSearch,
        excludeVerifyTool:
          (intent.isWebsiteOrFullStack || intent.isHighLevelBuild) && !intent.isDebuggingTask,
        isHyper,
        fastMode,
        preferPrimaryCoding,
        complexity: promptBrief.complexity,
        isLargeGeneration:
          !isPromptEngineeringRequest &&
          (intent.isWebsiteOrFullStack ||
            intent.isHighLevelBuild ||
            intent.wantsMultiFile ||
            followUpEdit.previousLineCount >= 120),
        onDelta: (chunkText) => {
          finishActiveRetryTask();
          input.onEvent?.({ type: 'delta', text: chunkText });
        },
        onRetryStatus,
      });
      finishActiveRetryTask();
      for (const src of streamed.webSources) {
        if (!collectedWebSources.has(src.uri)) {
          collectedWebSources.set(src.uri, src);
        }
      }
      for (const q of streamed.searchQueries) {
        collectedSearchQueries.add(q);
      }
      if (streamed.webSources.length > 0 || streamed.searchQueries.length > 0) {
        if (!toolsUsed.includes('google_search')) {
          toolsUsed.push('google_search');
        }
        const searchStepId = startTask(
          'Searched live web sources',
          streamed.searchQueries.length > 0
            ? `${streamed.searchQueries.slice(0, 2).join(' · ')} (${streamed.webSources.length} source${streamed.webSources.length === 1 ? '' : 's'})`
            : `${streamed.webSources.length} verified web source${streamed.webSources.length === 1 ? '' : 's'}`
        );
        finishTask(searchStepId, 'done');
      }
      finishTask(
        genTaskId,
        'done',
        streamed.functionCalls.length > 0
          ? `Requested ${streamed.functionCalls.length} tool${streamed.functionCalls.length === 1 ? '' : 's'}`
          : streamed.modelUsed
      );
    } catch (err) {
      finishActiveRetryTask();
      finishTask(genTaskId, 'error', err instanceof Error ? err.message : 'Generation failed');
      throw err;
    }

    const functionCalls = Array.isArray(streamed.functionCalls) ? streamed.functionCalls : [];

    if (functionCalls.length === 0) {
      let finalReply = (streamed.text ?? '').trim();
      let selfReviewApplied = false;
      let codeVerification: CodeVerificationSummary | undefined;

      // Belt-and-suspenders guard: if user asked to WRITE A PROMPT, NEVER return an accidental HTML website!
      if (
        isPromptEngineeringRequest &&
        finalReply &&
        (/```(?:html|htm)\b/i.test(finalReply) || /<!doctype\s+html/i.test(finalReply)) &&
        !/```prompt\b/i.test(finalReply)
      ) {
        const promptFixTaskId = startTask(
          'Formatting copy-ready prompt (text prompt only)',
          'Preventing unintended website build'
        );
        try {
          const rewriteRes = await generateStreamWithFallback(
            ai,
            [
              {
                role: 'user',
                parts: [
                  {
                    text: `The user asked you to WRITE A PROMPT (NOT build a website or code):\n"${input.message}"\n\nConvert your answer into ONLY a clean, rich, copy-ready prompt inside a \`\`\`prompt:<Descriptive Title> fenced block (with zero HTML/CSS/JS code blocks).`,
                  },
                ],
              },
            ],
            'You are an expert Prompt Engineer. Output ONLY a brief 1-line intro, one deeply structured ```prompt:<Title> fenced block with [PLACEHOLDERS], and 2 short usage tips outside the block. NEVER output HTML, CSS, or JavaScript code.',
            {
              useTools: false,
              enableWebSearch: false,
              isHyper: false,
              fastMode: false,
              complexity: 'standard',
              thinkingLevelOverride: ThinkingLevel.LOW,
              onRetryStatus,
            }
          );
          finishActiveRetryTask();
          if (rewriteRes.text?.trim()) {
            finalReply = rewriteRes.text.trim();
            input.onEvent?.({ type: 'replace', text: finalReply });
          }
          finishTask(promptFixTaskId, 'done', 'Delivered copyable prompt');
        } catch {
          finishActiveRetryTask();
          finishTask(promptFixTaskId, 'done');
        }
      }

      // IND HYPER CODING MODEL (Plus only): smart Pass 2 Visual Design & Engineering Elevation Pass
      // Runs automatically when Pass 1 is shorter than epic target depth or has any verification issues,
      // while avoiding a redundant 90s full-file rewrite when Pass 1 already delivered a rich, verified build.
      const hasCodeBlocks = /```/.test(finalReply);
      const verifyOptsPreCheck = {
        requireFullStackWebsite: intent.isWebsiteOrFullStack,
        requireBackend: intent.wantsBackend,
        requireHighLevelCode: intent.isHighLevelBuild,
        requireLuaUiLibrary: intent.isLuaUiLibrary,
        isHyper,
        userPrompt: input.message,
        brandNames: promptBrief.brandNames,
        mustAvoid: promptBrief.mustAvoid,
        followUpEditContext: followUpEdit.isFollowUpEdit ? followUpEdit : undefined,
      };
      const pass1LineCount = finalReply.split('\n').length;
      const epicTargetLines = intent.isWebsiteOrFullStack
        ? 480
        : intent.isLuaUiLibrary
          ? 440
          : intent.isHighLevelBuild
            ? 280
            : 180;
      const pass1Report =
        isHyper && hasCodeBlocks && !effectiveSkipAutoCodeVerify
          ? verifyCodeBlocks(finalReply, verifyOptsPreCheck)
          : null;
      const needsHyperElevation =
        isHyper &&
        Boolean(finalReply) &&
        !effectiveSkipAutoCodeVerify &&
        !followUpEdit.isFollowUpEdit &&
        (hasCodeBlocks || input.mode === 'coding') &&
        (pass1LineCount < epicTargetLines || Boolean(pass1Report && !pass1Report.passed));

      if (needsHyperElevation) {
        const reviewTaskId = startTask(
          intent.isWebsiteOrFullStack
            ? 'Elevating visual craft, interactivity & code quality (IND HYPER Pass 2)'
            : 'Running IND HYPER architecture & depth elevation pass',
          intent.isWebsiteOrFullStack
            ? 'Expanding depth, bespoke SVGs, animations & edge cases'
            : 'Deepening completeness, syntax, imports & edge cases'
        );
        try {
          const reviewContents: Content[] = [
            {
              role: 'user',
              parts: [
                {
                  text: `Original user request:\n${input.message}\n\nDraft response to review, elevate, and expand where thin (NEVER shorten):\n${finalReply}`,
                },
              ],
            },
          ];
          let startedPass2Stream = false;
          const reviewResponse = await generateStreamWithFallback(
            ai,
            reviewContents,
            buildHyperSelfReviewPrompt(intent.isWebsiteOrFullStack),
            {
              useTools: false,
              enableWebSearch: false,
              isHyper: true,
              fastMode: false,
              preferPrimaryCoding: true,
              isLargeGeneration: true,
              thinkingLevelOverride: ThinkingLevel.MEDIUM,
              onDelta: (chunkText) => {
                finishActiveRetryTask();
                if (!startedPass2Stream) {
                  startedPass2Stream = true;
                  input.onEvent?.({ type: 'replace', text: '' });
                }
                input.onEvent?.({ type: 'delta', text: chunkText });
              },
              onRetryStatus,
            }
          );
          finishActiveRetryTask();
          const reviewedText = (reviewResponse.text ?? '').trim();
          if (reviewedText) {
            finalReply = reviewedText;
            selfReviewApplied = true;
            input.onEvent?.({ type: 'replace', text: finalReply });
          }
          finishTask(reviewTaskId, 'done', 'Elevation pass complete');
        } catch {
          finishActiveRetryTask();
          input.onEvent?.({ type: 'replace', text: finalReply });
          finishTask(reviewTaskId, 'done', 'Kept Pass 1 output');
        }
      }

      // Automatic Iterative Code Verification, Requirement-Satisfaction & Self-Debugging Loop
      // Runs up to 4 paced repair/expansion passes inside 1 single message until all user requirements & quality checks pass.
      if (!effectiveSkipAutoCodeVerify && debugLoop && finalReply && /```/.test(finalReply)) {
        const maxDebugLoops = 5; // 1 initial check + up to 4 paced iterative repair/expansion passes
        const loopStartMs = Date.now();
        const maxLoopBudgetMs = isHyper ? 165_000 : 105_000;
        let passesRun = 0;
        let initialErrorCount = 0;
        const verifyOpts = {
          requireFullStackWebsite: intent.isWebsiteOrFullStack,
          requireBackend: intent.wantsBackend,
          requireHighLevelCode: intent.isHighLevelBuild,
          requireLuaUiLibrary: intent.isLuaUiLibrary,
          isHyper,
          userPrompt: input.message,
          brandNames: promptBrief.brandNames,
          mustAvoid: promptBrief.mustAvoid,
          followUpEditContext: followUpEdit.isFollowUpEdit ? followUpEdit : undefined,
        };
        let latestReport = verifyCodeBlocks(finalReply, verifyOpts);
        let bestReply = finalReply;
        let bestReport = latestReport;
        let lastErrorSignature = '';
        let stalledCount = 0;

        if (latestReport.filesChecked > 0) {
          for (let attempt = 1; attempt <= maxDebugLoops; attempt += 1) {
            passesRun = attempt;
            const verifyTaskId = startTask(
              attempt === 1
                ? intent.isWebsiteOrFullStack
                  ? 'Verifying syntax, DOM wiring & prompt requirements'
                  : intent.isHighLevelBuild
                    ? 'Verifying syntax, depth & prompt requirements'
                    : 'Verifying code syntax & prompt requirements'
                : `Re-verifying upgraded code (pass ${attempt}/${maxDebugLoops})`,
              `${latestReport.filesChecked} block${latestReport.filesChecked === 1 ? '' : 's'}`
            );

            if (attempt > 1) {
              latestReport = verifyCodeBlocks(finalReply, verifyOpts);
              if (latestReport.errorCount < bestReport.errorCount) {
                bestReply = finalReply;
                bestReport = latestReport;
              }
            } else {
              initialErrorCount = latestReport.errorCount;
            }

            if (latestReport.passed) {
              bestReply = finalReply;
              bestReport = latestReport;
              finishTask(verifyTaskId, 'done', latestReport.summary);
              break;
            }

            finishTask(
              verifyTaskId,
              'done',
              `Found ${latestReport.errorCount} unmet requirement/issue${latestReport.errorCount === 1 ? '' : 's'} — continuing in loop`
            );

            const errorSignature = latestReport.issues
              .filter((i) => i.severity === 'error')
              .map((i) => i.message)
              .sort()
              .join('|');
            if (errorSignature && errorSignature === lastErrorSignature) {
              stalledCount += 1;
            } else {
              stalledCount = 0;
              lastErrorSignature = errorSignature;
            }

            if (
              attempt === maxDebugLoops ||
              stalledCount >= 2 ||
              Date.now() - loopStartMs >= maxLoopBudgetMs
            ) {
              break;
            }

            // Short pacing cooldown break between repair passes inside the same single message
            const breakMs = Math.min(3000, 1200 + (attempt - 1) * 600);
            const breakTaskId = startTask(
              `Short cooldown break before refinement pass ${attempt}/${maxDebugLoops - 1}`,
              `Pacing ${(breakMs / 1000).toFixed(1)}s to keep quality & API quota healthy`
            );
            await new Promise((resolve) => setTimeout(resolve, breakMs));
            finishTask(breakTaskId, 'done', 'Resuming repair loop');

            const fixTaskId = startTask(
              `Refining & fixing code to satisfy prompt (pass ${attempt}/${maxDebugLoops - 1})`,
              latestReport.issues
                .filter((i) => i.severity === 'error')
                .slice(0, 2)
                .map((i) => i.message)
                .join('; ')
            );

            try {
              const baselineSection =
                followUpEdit.isFollowUpEdit && followUpEdit.latestCodeBlocks.length > 0
                  ? `\n\nBaseline working code BEFORE this fix (preserve ALL existing structure, branding, styles, and features — apply ONLY the user's fix and return the COMPLETE file):\n${followUpEdit.latestCodeBlocks
                      .map((b) => `\`\`\`${b.language}:${b.fileName}\n${b.code}\n\`\`\``)
                      .join('\n\n')}`
                  : '';
              const fixContents: Content[] = [
                {
                  role: 'user',
                  parts: [
                    {
                      text: `Original user request:\n${input.message}${baselineSection}\n\nPrevious response containing unmet requirements/errors:\n${finalReply}`,
                    },
                  ],
                },
              ];

              const fixRes = await generateStreamWithFallback(
                ai,
                fixContents,
                buildAutoDebugFixPrompt(
                  latestReport.issues.filter((i) => i.severity === 'error'),
                  attempt,
                  {
                    brandNames: promptBrief.brandNames,
                    mustAvoid: promptBrief.mustAvoid,
                    mustInclude: promptBrief.mustInclude,
                  }
                ),
                {
                  useTools: false,
                  enableWebSearch: false,
                  isHyper,
                  fastMode: false,
                  preferPrimaryCoding: true,
                  isLargeGeneration:
                    intent.isWebsiteOrFullStack ||
                    intent.isHighLevelBuild ||
                    intent.wantsMultiFile ||
                    followUpEdit.previousLineCount >= 120,
                  thinkingLevelOverride: ThinkingLevel.MEDIUM,
                  onRetryStatus,
                }
              );
              finishActiveRetryTask();

              const repaired = (fixRes.text ?? '').trim();
              if (repaired) {
                finalReply = repaired;
                selfReviewApplied = true;
                input.onEvent?.({ type: 'replace', text: finalReply });
              }
              finishTask(fixTaskId, 'done', 'Applied iterative upgrade pass');
            } catch {
              finishActiveRetryTask();
              finishTask(fixTaskId, 'error', 'Refinement pass skipped — kept best version');
              break;
            }
          }

          // Always keep the highest-quality version across all loop iterations
          if (bestReply !== finalReply) {
            finalReply = bestReply;
            latestReport = bestReport;
            input.onEvent?.({ type: 'replace', text: finalReply });
          }

          codeVerification = {
            passed: latestReport.passed,
            filesChecked: latestReport.filesChecked,
            passesRun,
            issuesFixed: Math.max(0, initialErrorCount - latestReport.errorCount),
            remainingIssues: latestReport.errorCount,
            intentLabel: intent.summary,
          };
        }
      }

      const finalWebSources = Array.from(collectedWebSources.values());
      const finalSearchQueries = Array.from(collectedSearchQueries.values());

      return {
        reply:
          finalReply ||
          (createdActions.length > 0
            ? 'Queued the preview below. Review it and click Approve & Execute when ready.'
            : 'Done. Let me know what you want to do next.'),
        createdActions,
        toolsUsed,
        injectionAlerts,
        tasks,
        savedMemories,
        modelChoice: isHyper ? 'hyper' : 'standard',
        modelLabel,
        fastMode,
        selfReviewApplied,
        codeVerification,
        webSources: finalWebSources.length > 0 ? finalWebSources : undefined,
        searchQueries: finalSearchQueries.length > 0 ? finalSearchQueries : undefined,
        elapsedMs: Math.max(1, Date.now() - turnStart),
      };
    }

    if (streamed.modelParts.length > 0) {
      contents.push({ role: 'model', parts: streamed.modelParts });
    }

    const responseParts: Part[] = [];

    for (const call of functionCalls) {
      const name = call?.name ?? '';
      const args = (call?.args ?? {}) as Record<string, unknown>;
      if (!name) continue;
      toolsUsed.push(name);

      const toolTaskId = startTask(TOOL_LABELS[name] ?? `Running ${name}`);
      let resultPayload: Record<string, unknown>;

      try {
        resultPayload = await executeToolOrProposal(
          input.userId,
          name,
          args,
          input.creds,
          createdActions,
          injectionAlerts,
          savedMemories,
          memoryEnabled,
          input.onEvent
        );
        const detail =
          resultPayload.connected === false
            ? 'Not connected'
            : resultPayload.queued === true
              ? 'Queued for approval'
              : resultPayload.saved === true
                ? 'Saved to memory'
                : typeof resultPayload.runtimeOk === 'boolean'
                  ? resultPayload.syntaxOk && resultPayload.runtimeOk
                    ? 'Passed sandbox check'
                    : `Found issue: ${String(resultPayload.error ?? 'failed').slice(0, 80)}`
                  : 'Completed';
        finishTask(
          toolTaskId,
          resultPayload.runtimeOk === false || resultPayload.syntaxOk === false ? 'error' : 'done',
          detail
        );
      } catch (err) {
        const safeErr = redactSecrets(err instanceof Error ? err.message : 'Tool call failed.');
        resultPayload = { error: safeErr };
        finishTask(toolTaskId, 'error', safeErr);
      }

      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: resultPayload,
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  const fallbackWebSources = Array.from(collectedWebSources.values());
  const fallbackSearchQueries = Array.from(collectedSearchQueries.values());

  return {
    reply:
      createdActions.length > 0
        ? 'I prepared the preview below for your approval. Check the details before confirming.'
        : 'Finished tool checks. Let me know how you want to proceed.',
    createdActions,
    toolsUsed,
    injectionAlerts,
    tasks,
    savedMemories,
    modelChoice: isHyper ? 'hyper' : 'standard',
    modelLabel,
    fastMode,
    selfReviewApplied: false,
    webSources: fallbackWebSources.length > 0 ? fallbackWebSources : undefined,
    searchQueries: fallbackSearchQueries.length > 0 ? fallbackSearchQueries : undefined,
    elapsedMs: Math.max(1, Date.now() - turnStart),
  };
}

async function executeToolOrProposal(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  creds: ToolCredentials,
  createdActions: PendingAction[],
  injectionAlerts: InjectionAlert[],
  savedMemories: MemoryFact[],
  memoryEnabled: boolean,
  onEvent?: (event: AgentStreamEvent) => void
): Promise<Record<string, unknown>> {
  switch (name) {
    // --- Sandboxed Coding Verifier & Debugger ---
    case 'verify_code_snippet': {
      const check = runSandboxedJsCheck({
        language: typeof args.language === 'string' ? args.language : 'javascript',
        code: String(args.code ?? ''),
        testCode: typeof args.testCode === 'string' ? args.testCode : undefined,
      });
      return {
        syntaxOk: check.syntaxOk,
        runtimeOk: check.runtimeOk,
        logs: check.logs,
        returnValue: check.returnValue,
        error: check.error,
        line: check.line,
        column: check.column,
      };
    }

    // --- Chat Memory ---
    case 'save_memory_fact': {
      if (!memoryEnabled) {
        return {
          saved: false,
          note: 'Chat memory is currently turned off by the user.',
        };
      }
      const rawContent = String(args.content ?? '').trim();
      const rawCat = String(args.category ?? 'context').toLowerCase();
      const category: MemoryFact['category'] =
        rawCat === 'preference' || rawCat === 'project' ? rawCat : 'context';
      const fact = memoryStore.addFact(userId, redactSecrets(rawContent), category);
      savedMemories.push(fact);
      onEvent?.({ type: 'memory', fact });
      return {
        saved: true,
        id: fact.id,
        content: fact.content,
        category: fact.category,
      };
    }

    // --- Gmail read-only ---
    case 'gmail_search_emails': {
      if (!creds.gmailToken) {
        return {
          connected: false,
          error:
            'Gmail is not connected yet. Tell the user to click "Connect Gmail" in the Tools tab first.',
        };
      }
      const messages = await searchGmailMessages(
        creds.gmailToken,
        String(args.query ?? ''),
        Number(args.maxResults ?? 6)
      );
      const safeMessages = Array.isArray(messages) ? messages : [];
      const sanitized = safeMessages.map((m) => {
        if (m.injectionFlagged && Array.isArray(m.injectionMatches) && m.injectionMatches.length > 0) {
          injectionAlerts.push({
            source: `Gmail: ${m.subject}`,
            matches: m.injectionMatches,
          });
        }
        return {
          id: m.id,
          from: m.from,
          subject: m.subject,
          date: m.date,
          snippet: wrapUntrustedData(`Gmail snippet (${m.id})`, m.snippet).wrapped,
          injectionFlagged: Boolean(m.injectionFlagged),
        };
      });
      return { count: sanitized.length, messages: sanitized };
    }

    case 'gmail_read_email': {
      if (!creds.gmailToken) {
        return {
          connected: false,
          error:
            'Gmail is not connected yet. Tell the user to click "Connect Gmail" in the Tools tab first.',
        };
      }
      const msg = await readGmailMessage(creds.gmailToken, String(args.messageId ?? ''));
      const wrapped = wrapUntrustedData(`Gmail message ${msg.id}`, msg.body ?? msg.snippet ?? '');
      if (wrapped.flagged) {
        injectionAlerts.push({
          source: `Gmail: ${msg.subject}`,
          matches: wrapped.matches,
        });
      }
      return {
        id: msg.id,
        from: msg.from,
        subject: msg.subject,
        date: msg.date,
        body: wrapped.wrapped,
        injectionFlagged: wrapped.flagged,
      };
    }

    // --- Gmail preview-first proposals ---
    case 'propose_gmail_draft': {
      const to = String(args.to ?? '').trim();
      const subject = String(args.subject ?? '').trim();
      const body = String(args.body ?? '').trim();
      const language = String(args.language ?? 'English').trim();

      const action = createPendingActionForUser(userId, {
        type: 'gmail_create_draft',
        title: `Save Gmail draft to ${to || 'recipient'}`,
        summary: `Subject: ${subject || '(No subject)'} · ${language}`,
        payload: { to, subject, body, language },
        previewText: `To: ${to}\nSubject: ${subject}\nLanguage: ${language}\n\n${body}`,
        riskLevel: 'standard',
        warning: !creds.gmailToken
          ? 'Gmail is not connected yet. Connect Gmail in the Tools tab before clicking Approve.'
          : undefined,
      });
      createdActions.push(action);
      return {
        queued: true,
        actionId: action.id,
        gmailConnected: Boolean(creds.gmailToken),
        note: 'Queued for user approval. Show the full draft and ask for confirmation.',
      };
    }

    case 'propose_gmail_send': {
      const to = String(args.to ?? '').trim();
      const subject = String(args.subject ?? '').trim();
      const body = String(args.body ?? '').trim();
      const language = String(args.language ?? 'English').trim();

      const action = createPendingActionForUser(userId, {
        type: 'gmail_send_email',
        title: `Send email to ${to || 'recipient'}`,
        summary: `Subject: ${subject || '(No subject)'} · ${language}`,
        payload: { to, subject, body, language },
        previewText: `To: ${to}\nSubject: ${subject}\nLanguage: ${language}\n\n${body}`,
        riskLevel: 'elevated',
        warning:
          'This will immediately send an external email upon approval. Prefer saving as a draft unless ready to send.',
      });
      createdActions.push(action);
      return {
        queued: true,
        actionId: action.id,
        gmailConnected: Boolean(creds.gmailToken),
        note: 'Queued for explicit send confirmation. Show the full draft and wait.',
      };
    }

    // --- Google Drive read-only (drive.file) ---
    case 'drive_list_files': {
      if (!creds.driveToken) {
        return {
          connected: false,
          error:
            'Google Drive is not connected yet. Tell the user to click "Connect Google Drive" in the Tools tab first.',
        };
      }
      const files = await listDriveFiles(
        creds.driveToken,
        typeof args.query === 'string' ? args.query : '',
        Number(args.limit ?? 20)
      );
      const safeFiles = Array.isArray(files) ? files : [];
      return {
        folderName: IND_AGENT_DRIVE_FOLDER,
        count: safeFiles.length,
        files: safeFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          webViewLink: f.webViewLink,
        })),
      };
    }

    case 'drive_read_file': {
      if (!creds.driveToken) {
        return {
          connected: false,
          error:
            'Google Drive is not connected yet. Tell the user to click "Connect Google Drive" in the Tools tab first.',
        };
      }
      const file = await readDriveFile(creds.driveToken, String(args.fileId ?? ''));
      const wrapped = wrapUntrustedData(`Google Drive file ${file.name}`, file.content ?? '');
      if (wrapped.flagged) {
        injectionAlerts.push({
          source: `Google Drive: ${file.name}`,
          matches: wrapped.matches,
        });
      }
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        content: wrapped.wrapped,
        injectionFlagged: wrapped.flagged,
      };
    }

    // --- Google Drive preview-first proposals ---
    case 'propose_drive_save_file': {
      const fileName = String(args.name ?? 'ind-agent-file.txt').trim() || 'ind-agent-file.txt';
      const content = String(args.content ?? '');
      const mimeType = typeof args.mimeType === 'string' ? args.mimeType : undefined;

      const action = createPendingActionForUser(userId, {
        type: 'drive_save_file',
        title: `Save "${fileName}" to Google Drive`,
        summary: `Folder: ${IND_AGENT_DRIVE_FOLDER} · ${content.length} chars`,
        payload: { name: fileName, content, mimeType },
        previewText: `Folder: ${IND_AGENT_DRIVE_FOLDER}\nFile: ${fileName}\n\n${content.slice(0, 3000)}${
          content.length > 3000 ? '\n... (preview truncated)' : ''
        }`,
        riskLevel: 'standard',
        warning: !creds.driveToken
          ? 'Google Drive is not connected yet. Connect Google Drive in the Tools tab before clicking Approve.'
          : undefined,
      });
      createdActions.push(action);
      return {
        queued: true,
        actionId: action.id,
        driveConnected: Boolean(creds.driveToken),
        note: 'Queued for user confirmation before saving to Google Drive.',
      };
    }

    case 'propose_drive_update_file': {
      const fileId = String(args.fileId ?? '').trim();
      const fileName = String(args.name ?? 'file.txt').trim() || 'file.txt';
      const content = String(args.content ?? '');
      const mimeType = typeof args.mimeType === 'string' ? args.mimeType : undefined;

      const action = createPendingActionForUser(userId, {
        type: 'drive_update_file',
        title: `Overwrite "${fileName}" in Google Drive`,
        summary: `File ID: ${fileId} · ${content.length} chars`,
        payload: { fileId, name: fileName, content, mimeType },
        previewText: `Overwrite File: ${fileName}\nFile ID: ${fileId}\n\n${content.slice(0, 3000)}${
          content.length > 3000 ? '\n... (preview truncated)' : ''
        }`,
        riskLevel: 'elevated',
        warning: 'This will overwrite the existing file content in your Google Drive upon approval.',
      });
      createdActions.push(action);
      return {
        queued: true,
        actionId: action.id,
        driveConnected: Boolean(creds.driveToken),
        note: 'Queued for explicit overwrite confirmation before modifying Google Drive.',
      };
    }

    case 'propose_drive_delete_file': {
      const fileId = String(args.fileId ?? '').trim();
      const fileName = String(args.name ?? fileId).trim();

      const action = createPendingActionForUser(userId, {
        type: 'drive_delete_file',
        title: `Move "${fileName}" to Google Drive Trash`,
        summary: `File ID: ${fileId}`,
        payload: { fileId, name: fileName },
        previewText: `Action: Move file to Google Drive Trash\nFile: ${fileName}\nFile ID: ${fileId}`,
        riskLevel: 'elevated',
        warning: 'Confirm carefully: this moves the file to your Google Drive Trash.',
      });
      createdActions.push(action);
      return {
        queued: true,
        actionId: action.id,
        driveConnected: Boolean(creds.driveToken),
        note: 'Queued for explicit delete confirmation before moving the file to Trash.',
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
