export type AgentMode = 'auto' | 'coding' | 'business';

export type ModelChoice = 'standard' | 'hyper';

export type UserPlan = 'free' | 'plus';

export type WorkspaceView = 'command' | 'approvals' | 'tools' | 'business' | 'plans';

export type WorkspaceCategory = 'Product & Web' | 'Client Operations' | 'Side Projects';

export type ActionType =
  | 'gmail_create_draft'
  | 'gmail_send_email'
  | 'drive_save_file'
  | 'drive_update_file'
  | 'drive_delete_file';

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'failed';

export interface PendingAction {
  id: string;
  type: ActionType;
  title: string;
  summary: string;
  riskLevel: 'standard' | 'elevated';
  warning?: string;
  payload: Record<string, unknown>;
  previewText: string;
  createdAt: string;
  status: ActionStatus;
  executedAt?: string;
  resultMessage?: string;
  resultUrl?: string;
  errorMessage?: string;
}

export interface InjectionAlert {
  source: string;
  matches: string[];
}

export interface GeneratedProjectFile {
  path: string;
  language: string;
  content: string;
}

export interface ChatAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  /** Base64 payload (without data URL prefix) for images/PDFs when sent in a request. */
  dataBase64?: string;
  /** UTF-8 text content for code/text files. */
  textContent?: string;
  /** Ephemeral browser preview data URL (never persisted to localStorage). */
  previewUrl?: string;
}

export interface AgentTaskStep {
  id: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  durationMs?: number;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: 'preference' | 'project' | 'context';
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  mode: AgentMode;
  messages: ChatMessage[];
}

export interface CodeVerificationSummary {
  passed: boolean;
  filesChecked: number;
  passesRun: number;
  issuesFixed: number;
  remainingIssues: number;
  intentLabel?: string;
}

export interface WebSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: AgentMode;
  modelChoice?: ModelChoice;
  modelLabel?: string;
  fastMode?: boolean;
  selfReviewApplied?: boolean;
  codeVerification?: CodeVerificationSummary;
  elapsedMs?: number;
  createdAt: string;
  attachments?: Array<Pick<ChatAttachment, 'id' | 'kind' | 'name' | 'mimeType' | 'size' | 'previewUrl'>>;
  tasks?: AgentTaskStep[];
  actionIds?: string[];
  toolsUsed?: string[];
  webSources?: WebSource[];
  searchQueries?: string[];
  injectionAlerts?: InjectionAlert[];
  error?: boolean;
  errorTitle?: string;
  errorCode?: string;
  retryAfterSec?: number;
  retryAttempts?: number;
  retryPrompt?: string;
  skillCommand?: string;
}

export interface SkillDefinition {
  id: string;
  command: string; // e.g. "/prompt"
  name: string; // e.g. "Make Prompt"
  description: string;
  mode: AgentMode;
  instructions: string;
  placeholder?: string;
  builtIn?: boolean;
  forceDebugLoop?: boolean;
  isPromptEngineer?: boolean;
}

export interface ArtifactVersion {
  version: number;
  label: string;
  createdAt: string;
  files: GeneratedProjectFile[];
  activePath: string;
  sourceMessageId?: string;
}

export interface ArtifactSession {
  id: string;
  title: string;
  files: GeneratedProjectFile[];
  activePath: string;
  sourceMessageId?: string;
  versions?: ArtifactVersion[];
  currentVersion?: number;
}

export interface CustomInstructionsConfig {
  text: string;
  enabled: boolean;
}

export interface ToolStatusSummary {
  gmail: {
    connected: boolean;
    accountLabel?: string;
  };
  drive: {
    connected: boolean;
    accountLabel?: string;
    folderName: string;
  };
}

export interface UsageSummary {
  used: number;
  limit: number | null;
  remaining: number | null;
  windowDurationHours: number;
  windowStartedAtMs: number;
  resetsAt: string | null;
}

export interface UserAccountSummary {
  userId: string;
  authType: 'guest' | 'google' | 'email';
  displayName: string;
  email?: string;
  plan: UserPlan;
  planExpiresAt?: number | null;
  usage: UsageSummary;
}

export interface BillingSettings {
  upiId: string;
  payeeName: string;
  priceInr: number;
  updatedAt?: string;
}

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequestRecord {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  plan: 'plus';
  amountInr: number;
  utr: string;
  payerUpi?: string;
  status: PaymentRequestStatus;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GmailMessageItem {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
  injectionFlagged?: boolean;
  injectionMatches?: string[];
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  content?: string;
  injectionFlagged?: boolean;
  injectionMatches?: string[];
}

export interface BusinessTask {
  id: string;
  workspace: WorkspaceCategory;
  category: 'Order' | 'Support' | 'Invoice' | 'Marketing' | 'To-Do';
  title: string;
  customerName?: string;
  customerEmail?: string;
  language?: 'English' | 'Hindi' | 'Gujarati';
  amountInr?: number | null;
  dueDate?: string;
  status: 'open' | 'in_progress' | 'done';
  notes: string;
  createdAt: string;
}

export interface QuoteLineItem {
  id: string;
  description: string;
  quantity: number | '';
  unitPriceInr: number | '';
}

export type PromptOptimizationFocus = 'balanced' | 'technical' | 'concise';

export type PromptOptimizationCategory =
  | 'technical_context'
  | 'constraints'
  | 'output_format'
  | 'clarity'
  | 'edge_cases';

export interface PromptOptimizationSuggestion {
  id: string;
  category: PromptOptimizationCategory;
  title: string;
  detail: string;
  snippet: string;
  recommended: boolean;
}

export interface PromptOptimizationResult {
  originalPrompt: string;
  baseCorePrompt: string;
  optimizedPrompt: string;
  originalScore: number;
  optimizedScore: number;
  clarityRating: 'vague' | 'fair' | 'clear' | 'strong';
  detectedIntent: string;
  domain: string;
  summary: string;
  focus: PromptOptimizationFocus;
  suggestions: PromptOptimizationSuggestion[];
  clarifyingQuestions: string[];
  source: 'gemini' | 'heuristic';
  elapsedMs: number;
}

