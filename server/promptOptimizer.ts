import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentMode,
  PromptOptimizationCategory,
  PromptOptimizationFocus,
  PromptOptimizationResult,
  PromptOptimizationSuggestion,
} from '../src/types/agent.ts';
import {
  analyzeCodingIntent,
  detectFollowUpCodeEdit,
  type CodingIntentAnalysis,
  type FollowUpCodeEditContext,
} from './codeVerifier.ts';
import {
  analyzePromptDeeply,
  isPromptWritingRequest,
  normalizeUserPromptText,
  type DeepIntentCategory,
  type PromptUnderstandingBrief,
} from './promptUnderstanding.ts';
import { withGeminiExponentialBackoff } from './geminiRetry.ts';

const OPTIMIZER_MODEL = 'gemini-3.1-flash-lite';
const OPTIMIZER_TIMEOUT_MS = 12_000;

export interface OptimizePromptInput {
  message: string;
  mode?: AgentMode;
  focus?: PromptOptimizationFocus;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ClarityScoreBreakdown {
  score: number;
  rating: 'vague' | 'fair' | 'clear' | 'strong';
  missingDimensions: PromptOptimizationCategory[];
}

const VALID_CATEGORIES = new Set<PromptOptimizationCategory>([
  'technical_context',
  'constraints',
  'output_format',
  'clarity',
  'edge_cases',
]);

const INTENT_HUMAN_LABELS: Record<DeepIntentCategory, string> = {
  website_artifact: 'Website & Interactive App',
  followup_edit: 'In-Place Code Update',
  bug_fix: 'Debugging & Root-Cause Fix',
  code_build: 'Software Engineering',
  luau_build: 'Roblox Luau Engineering',
  prompt_engineering: 'Prompt Writing',
  business_ops: 'Business Communication & Ops',
  explain_or_qa: 'Explanation & Analysis',
  general: 'General Assistant Request',
};

export function normalizeFocus(value: unknown): PromptOptimizationFocus {
  if (value === 'technical' || value === 'concise' || value === 'balanced') {
    return value;
  }
  return 'balanced';
}

export function getIntentDisplayLabel(category: DeepIntentCategory): string {
  return INTENT_HUMAN_LABELS[category] ?? 'General Assistant Request';
}

/**
 * Pure deterministic rubric that evaluates how clear and actionable a raw user
 * prompt is for Gemini across 5 dimensions (0–100).
 */
export function scorePromptClarity(
  rawPrompt: string,
  brief: PromptUnderstandingBrief,
  codingIntent: CodingIntentAnalysis,
  followUpEdit: FollowUpCodeEditContext
): ClarityScoreBreakdown {
  const trimmed = (rawPrompt ?? '').trim();
  const normalized = brief.normalizedPrompt;
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lower = normalized.toLowerCase();

  const missingDimensions: PromptOptimizationCategory[] = [];

  // 1. Goal & clarity specificity (0–25)
  let clarityPts = 8;
  if (wordCount >= 6) clarityPts += 6;
  if (wordCount >= 14) clarityPts += 6;
  if (wordCount >= 28) clarityPts += 5;
  const hadTypos = normalized.toLowerCase() !== trimmed.replace(/\s+/g, ' ').toLowerCase();
  if (hadTypos) clarityPts = Math.max(5, clarityPts - 4);
  if (wordCount < 10 || hadTypos) {
    missingDimensions.push('clarity');
  }

  // 2. Domain / brand / audience / tone context (0–20)
  let contextPts = 4;
  if (brief.domain !== 'General Software & Productivity') contextPts += 7;
  if (brief.brandNames.length > 0) contextPts += 5;
  if (brief.stylePreferences.length > 0) contextPts += 4;
  if (/\b(for\s+(?:a|an|my|our|b2b|startup|developers?|students?|customers?|clients?|beginners?|executives?)|audience|tone|persona)\b/i.test(lower)) {
    contextPts += 4;
  }
  contextPts = Math.min(20, contextPts);

  // 3. Technical stack / functional features (0–20)
  let techPts = 4;
  if (codingIntent.languages.length > 0) techPts += 6;
  if (/\b(html|css|tailwind|react|next\.?js|typescript|javascript|node\.?js|python|sql|api|rest|graphql|luau|json|markdown|csv)\b/i.test(lower)) {
    techPts += 5;
  }
  techPts += Math.min(9, brief.mustInclude.length * 4);
  techPts = Math.min(20, techPts);
  if (
    techPts < 12 &&
    (brief.intentCategory === 'website_artifact' ||
      brief.intentCategory === 'code_build' ||
      brief.intentCategory === 'luau_build' ||
      brief.intentCategory === 'bug_fix')
  ) {
    missingDimensions.push('technical_context');
  }

  // 4. Constraints / negative rules / preservation / edge cases (0–20)
  let constraintPts = 2;
  if (brief.mustAvoid.length > 0) constraintPts += 7;
  if (/\b(mobile|responsive|accessible|wcag|keyboard|validation|error\s*handling|edge\s*cases?|offline|performance|security|preserve|keep\s+existing|don'?t\s+break|budget|word\s*limit|under\s+\d+)\b/i.test(lower)) {
    constraintPts += 7;
  }
  if (followUpEdit.isFollowUpEdit && /\b(keep|preserve|only\s+change|without\s+breaking|existing)\b/i.test(lower)) {
    constraintPts += 4;
  }
  constraintPts = Math.min(20, constraintPts);
  if (constraintPts < 10) {
    missingDimensions.push('constraints');
  }
  if (!/\b(edge\s*case|empty\s*state|error\s*handling|validation|loading\s*state|fallback|responsive|mobile)\b/i.test(lower)) {
    missingDimensions.push('edge_cases');
  }

  // 5. Explicit output format / deliverable structure (0–15)
  let formatPts = 2;
  if (/\b(single\s*file|multi[- ]?file|json|table|bullet|step[- ]?by[- ]?step|checklist|markdown|code\s*block|copy[- ]?ready|prompt\s*only|email\s*draft|subject\s*line|sections?)\b/i.test(lower)) {
    formatPts += 9;
  }
  if (/\n|:\s|1\.\s|-\s/.test(trimmed)) {
    formatPts += 4;
  }
  formatPts = Math.min(15, formatPts);
  if (formatPts < 8) {
    missingDimensions.push('output_format');
  }

  const rawScore = clarityPts + contextPts + techPts + constraintPts + formatPts;
  const score = Math.max(12, Math.min(95, Math.round(rawScore)));

  let rating: ClarityScoreBreakdown['rating'] = 'vague';
  if (score >= 80) rating = 'strong';
  else if (score >= 60) rating = 'clear';
  else if (score >= 40) rating = 'fair';

  return { score, rating, missingDimensions };
}

function buildCoreSentence(
  rawPrompt: string,
  brief: PromptUnderstandingBrief,
  followUpEdit: FollowUpCodeEditContext,
  focus: PromptOptimizationFocus
): string {
  const normalized = brief.normalizedPrompt;
  const brandClause = brief.brandNames.length > 0 ? ` for "${brief.brandNames[0]}"` : '';
  const styleClause =
    brief.stylePreferences.length > 0
      ? ` with a ${brief.stylePreferences.slice(0, 2).join(' and ').toLowerCase()}`
      : '';
  const featureClause =
    brief.mustInclude.length > 0
      ? `, including ${brief.mustInclude.slice(0, 3).map((f) => f.toLowerCase()).join(', ')}`
      : '';

  if (brief.isPromptEngineering) {
    return `Write a ready-to-use, well-structured prompt${brandClause} for this request: "${normalized}". Return only the prompt text itself (do not build or output website/application code).`;
  }

  if (followUpEdit.isFollowUpEdit) {
    const targetFile = followUpEdit.previousFileNames[0] || 'the existing code';
    return `Update ${targetFile} in place to apply this change: ${normalized}. Preserve all existing working sections, styling, and behavior that were not asked to change.`;
  }

  if (brief.intentCategory === 'website_artifact') {
    const domainText =
      brief.domain !== 'General Software & Productivity' ? brief.domain.toLowerCase() : 'web';
    const concisenessHint =
      focus === 'concise'
        ? `Build a clean, responsive ${domainText} website${brandClause}${styleClause}${featureClause}.`
        : `Build a complete, responsive ${domainText} website${brandClause}${styleClause}${featureClause} with real interactive controls and domain-authentic content.`;
    return concisenessHint;
  }

  if (brief.intentCategory === 'luau_build') {
    return `Write a complete, modular Roblox Luau implementation for: ${normalized}.`;
  }

  if (brief.intentCategory === 'bug_fix') {
    return `Diagnose the exact root cause and provide a complete, verified fix for: ${normalized}.`;
  }

  if (brief.intentCategory === 'code_build') {
    return `Implement a complete, production-ready solution for: ${normalized}.`;
  }

  if (brief.intentCategory === 'business_ops') {
    return `Draft a polished, ready-to-send business deliverable${brandClause} in ${brief.responseLanguage} for: ${normalized}.`;
  }

  if (brief.intentCategory === 'explain_or_qa') {
    return `Explain clearly and accurately: ${normalized}.`;
  }

  // Fallback for general prompts: preserve normalized phrasing clearly
  const cleanFirst = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return cleanFirst.endsWith('.') || cleanFirst.endsWith('?') ? cleanFirst : `${cleanFirst}.`;
}

function buildSuggestionsForIntent(
  brief: PromptUnderstandingBrief,
  codingIntent: CodingIntentAnalysis,
  followUpEdit: FollowUpCodeEditContext,
  focus: PromptOptimizationFocus
): { suggestions: PromptOptimizationSuggestion[]; clarifyingQuestions: string[] } {
  const suggestions: PromptOptimizationSuggestion[] = [];
  const clarifyingQuestions: string[] = [];

  const add = (item: PromptOptimizationSuggestion) => {
    if (!suggestions.some((s) => s.id === item.id)) {
      suggestions.push(item);
    }
  };

  if (brief.isPromptEngineering) {
    add({
      id: 'prompt-only-guard',
      category: 'output_format',
      title: 'Enforce prompt-only output (no code build)',
      detail: 'Prevents the model from accidentally building an HTML page instead of writing your prompt.',
      snippet: 'Output only a copy-ready prompt block with clear sections (Role, Goal, Requirements, Constraints, Output Format) — do not generate HTML/CSS/JS code.',
      recommended: true,
    });
    add({
      id: 'prompt-target-model',
      category: 'technical_context',
      title: 'Specify target audience and reusable placeholders',
      detail: 'Makes the generated prompt immediately reusable across projects with bracketed variables.',
      snippet: 'Include clear [placeholders] for brand name, target audience, and tech stack so the prompt can be customized quickly.',
      recommended: true,
    });
    add({
      id: 'prompt-constraints',
      category: 'constraints',
      title: 'Add quality guardrails to the generated prompt',
      detail: 'Ensures the prompt itself instructs downstream models to avoid generic filler and verify edge cases.',
      snippet: 'Instruct the target model to avoid placeholder text, explain trade-offs concisely, and validate edge cases.',
      recommended: focus !== 'concise',
    });
    clarifyingQuestions.push(
      'Which AI tool or model will you paste this prompt into (Gemini, ChatGPT, Midjourney, coding agent)?',
      'What tone or level of detail should the final prompt produce?'
    );
    return { suggestions, clarifyingQuestions };
  }

  if (followUpEdit.isFollowUpEdit) {
    const fileLabel = followUpEdit.previousFileNames[0] || 'existing file';
    add({
      id: 'preserve-existing',
      category: 'constraints',
      title: `Preserve working code in ${fileLabel}`,
      detail: 'Stops the model from restarting from zero or dropping existing sections during a fix.',
      snippet: `Keep all existing working layout, styles, brand identity, and unrelated features in ${fileLabel} intact; apply only the requested update.`,
      recommended: true,
    });
    add({
      id: 'return-complete-file',
      category: 'output_format',
      title: 'Require complete updated file (no omitted lines)',
      detail: 'Avoids truncated snippets like "// ... rest of code" that break live previews.',
      snippet: `Return the complete updated ${fileLabel} with zero placeholder or omission comments, plus a 1–2 sentence summary of what changed.`,
      recommended: true,
    });
    add({
      id: 'verify-regression',
      category: 'edge_cases',
      title: 'Check mobile layout and interactive regressions',
      detail: 'Confirms existing buttons, modals, and responsive breakpoints still work after the change.',
      snippet: 'Verify that all interactive handlers, state transitions, and mobile (390px) layout remain free of console errors.',
      recommended: focus === 'technical',
    });
    clarifyingQuestions.push(
      'Are there any specific existing sections or styles that must remain completely untouched?'
    );
    return { suggestions, clarifyingQuestions };
  }

  if (brief.intentCategory === 'website_artifact') {
    add({
      id: 'web-tech-stack',
      category: 'technical_context',
      title: 'Define responsive layout and clean interactive stack',
      detail: 'Gives Gemini exact viewport targets (mobile 390px + desktop 1440px) and clean architecture.',
      snippet:
        focus === 'technical'
          ? 'Deliver a self-contained semantic HTML5/CSS3/ES6 artifact using responsive CSS Grid/Flexbox for 390px mobile and 1440px desktop, with accessible focus states and WCAG AA contrast.'
          : 'Make the layout fully responsive for mobile (390px) and desktop (1440px) with clean typography, high contrast, and working interactive JavaScript controls.',
      recommended: true,
    });
    add({
      id: 'web-no-placeholders',
      category: 'constraints',
      title: 'Ban Lorem Ipsum and dead buttons',
      detail: 'Ensures realistic domain copy and working click/form handlers across every section.',
      snippet: 'Use realistic domain-specific copy (no Lorem Ipsum or generic filler) and wire every button, tab, filter, and form with real interactive feedback.',
      recommended: true,
    });
    add({
      id: 'web-sections',
      category: 'output_format',
      title: 'Specify clear section structure',
      detail: 'Prevents overcrowded or missing sections by defining a crisp visual hierarchy upfront.',
      snippet: 'Organize the page into a focused top navigation bar, clear hero section, primary interactive feature/showcase area, and clean footer.',
      recommended: focus !== 'concise',
    });
    add({
      id: 'web-edge-cases',
      category: 'edge_cases',
      title: 'Include form validation and empty states',
      detail: 'Prevents silent form errors or broken filters when users interact with edge inputs.',
      snippet: 'Add inline validation feedback on forms, graceful empty states for filters/search, and zero browser alert() popups.',
      recommended: focus === 'technical',
    });

    if (brief.brandNames.length === 0) {
      clarifyingQuestions.push('Do you have a specific brand name, location, or target audience?');
    }
    if (brief.stylePreferences.length === 0) {
      clarifyingQuestions.push('Do you prefer a light editorial palette, dark theme, or specific brand colors?');
    }
    if (brief.mustInclude.length === 0) {
      clarifyingQuestions.push('Which interactive features matter most (search/filters, booking form, pricing calculator, cart)?');
    }
    return { suggestions, clarifyingQuestions: clarifyingQuestions.slice(0, 3) };
  }

  if (brief.intentCategory === 'bug_fix') {
    add({
      id: 'bug-root-cause',
      category: 'clarity',
      title: 'Request root-cause explanation before the patch',
      detail: 'Keeps Gemini from guessing symptoms and ensures the underlying defect is fixed.',
      snippet: 'Identify the exact root cause first in 2–3 sentences, then provide the complete corrected code.',
      recommended: true,
    });
    add({
      id: 'bug-edge-cases',
      category: 'edge_cases',
      title: 'Cover null, empty, and boundary inputs',
      detail: 'Prevents the fix from introducing secondary regressions on unexpected inputs.',
      snippet: 'Handle edge cases (null/undefined inputs, network/async failures, and boundary values) without swallowing errors silently.',
      recommended: true,
    });
    add({
      id: 'bug-verification',
      category: 'output_format',
      title: 'Include verification steps or test cases',
      detail: 'Gives concrete reproduction checks so you can immediately verify the bug is gone.',
      snippet: 'Include 2–3 concise verification test cases confirming the bug is resolved and existing behavior still passes.',
      recommended: focus !== 'concise',
    });
    clarifyingQuestions.push(
      'What exact error message, stack trace, or unexpected behavior are you seeing?',
      'Which language, framework, or runtime version are you targeting?'
    );
    return { suggestions, clarifyingQuestions };
  }

  if (brief.intentCategory === 'code_build' || brief.intentCategory === 'luau_build') {
    const langText =
      codingIntent.languages.length > 0 ? codingIntent.languages.join(', ') : 'clean, idiomatic code';
    add({
      id: 'code-architecture',
      category: 'technical_context',
      title: 'Specify target language, types, and modularity',
      detail: 'Guides Gemini to structure clean, typed, maintainable modules instead of a monolith.',
      snippet: `Use ${langText} with clean modular structure, explicit types/interfaces, and clear separation of pure logic from I/O.`,
      recommended: true,
    });
    add({
      id: 'code-error-handling',
      category: 'edge_cases',
      title: 'Add input validation and error handling',
      detail: 'Produces production-grade code that handles invalid inputs and failure paths gracefully.',
      snippet: 'Validate all external inputs, handle failure/timeout paths gracefully, and avoid hardcoded secrets or unsafe patterns.',
      recommended: true,
    });
    add({
      id: 'code-output-format',
      category: 'output_format',
      title: 'Request runnable code plus usage example',
      detail: 'Ensures complete files with zero TODO stubs and a clear example you can run right away.',
      snippet: 'Provide complete runnable code with zero TODO placeholders, followed by a brief usage example and edge-case test snippet.',
      recommended: focus !== 'concise',
    });
    if (codingIntent.languages.length === 0) {
      clarifyingQuestions.push('Which programming language, framework, or runtime version should be used?');
    }
    clarifyingQuestions.push('Are there specific performance limits, APIs, or data schemas to integrate with?');
    return { suggestions, clarifyingQuestions: clarifyingQuestions.slice(0, 3) };
  }

  if (brief.intentCategory === 'business_ops') {
    add({
      id: 'biz-audience-tone',
      category: 'clarity',
      title: 'Specify recipient context and tone',
      detail: 'Aligns formality, warmth, and directness so the message is ready to send without heavy editing.',
      snippet: 'Keep the tone clear, respectful, and concise with an unambiguous call to action and concrete next steps.',
      recommended: true,
    });
    add({
      id: 'biz-structure',
      category: 'output_format',
      title: 'Use a clean, scannable business format',
      detail: 'Structures subject line, key facts, numbers, and closing neatly for busy readers.',
      snippet: 'Include a clear subject/title, structured key points or line items, and explicit placeholders only where missing personal data is required.',
      recommended: true,
    });
    add({
      id: 'biz-constraints',
      category: 'constraints',
      title: 'Avoid filler clichés and verify numbers',
      detail: 'Eliminates robotic phrasing and ensures dates, amounts, and GST/totals stay accurate.',
      snippet: 'Avoid generic corporate filler phrases and double-check all figures, dates, and currency formatting.',
      recommended: focus !== 'concise',
    });
    clarifyingQuestions.push(
      'Who is the recipient and what single action do you want them to take?',
      'Are there exact dates, prices, or policies that must be mentioned?'
    );
    return { suggestions, clarifyingQuestions };
  }

  // General or Explanation / Q&A
  add({
    id: 'qa-depth-audience',
    category: 'clarity',
    title: 'Define depth and practical focus',
    detail: 'Prevents overly generic essays by anchoring the answer to concrete examples.',
    snippet: 'Provide a direct answer first, followed by concrete real-world examples and actionable takeaways.',
    recommended: true,
  });
  add({
    id: 'qa-structure',
    category: 'output_format',
    title: 'Request structured comparison or step-by-step layout',
    detail: 'Makes complex explanations fast to scan and apply.',
    snippet:
      focus === 'concise'
        ? 'Keep the response concise and scannable using short bullet points (no fluff).'
        : 'Structure the response with clear headings, concise bullet points, and a quick summary of trade-offs or common pitfalls.',
    recommended: true,
  });
  add({
    id: 'qa-constraints',
    category: 'constraints',
    title: 'State assumptions and edge cases explicitly',
    detail: 'Reduces hallucinations by asking Gemini to call out caveats clearly.',
    snippet: 'Explicitly state any key assumptions, limitations, or edge cases instead of guessing.',
    recommended: focus === 'technical',
  });

  clarifyingQuestions.push(
    'What is your familiarity level with this topic (beginner, intermediate, advanced)?',
    'Are you applying this to a specific project, industry, or constraint?'
  );

  return { suggestions, clarifyingQuestions };
}

/**
 * Instant, deterministic, zero-API prompt optimizer.
 * Also serves as a reliable fail-open fallback when Gemini hits 429 quota or times out.
 */
export function buildDeterministicOptimization(
  input: OptimizePromptInput
): PromptOptimizationResult {
  const startedAt = Date.now();
  const rawPrompt = (input.message ?? '').trim();
  const mode: AgentMode = input.mode ?? 'auto';
  const focus = normalizeFocus(input.focus);
  const history = Array.isArray(input.history) ? input.history : [];

  const codingIntent = analyzeCodingIntent(rawPrompt, mode);
  const followUpEdit = detectFollowUpCodeEdit(rawPrompt, history);
  const brief = analyzePromptDeeply({
    message: rawPrompt,
    mode,
    codingIntent,
    followUpEdit,
    historyCount: history.length,
  });

  const scoreInfo = scorePromptClarity(rawPrompt, brief, codingIntent, followUpEdit);
  const baseCorePrompt = buildCoreSentence(rawPrompt, brief, followUpEdit, focus);
  const { suggestions, clarifyingQuestions } = buildSuggestionsForIntent(
    brief,
    codingIntent,
    followUpEdit,
    focus
  );

  // Preserve any user-specified negative constraints directly inside suggestions if present
  if (brief.mustAvoid.length > 0 && !suggestions.some((s) => s.id === 'user-negative-constraints')) {
    suggestions.unshift({
      id: 'user-negative-constraints',
      category: 'constraints',
      title: 'Preserve your explicit exclusions',
      detail: 'Highlights your "do not / avoid" rules so Gemini strictly respects them.',
      snippet: `Strictly respect these exclusions: ${brief.mustAvoid.join('; ')}.`,
      recommended: true,
    });
  }

  const recommended = suggestions.filter((s) => s.recommended);
  const optimizedLines: string[] = [baseCorePrompt];
  if (recommended.length > 0) {
    optimizedLines.push('');
    optimizedLines.push('Requirements & Constraints:');
    for (const s of recommended) {
      optimizedLines.push(`- ${s.snippet}`);
    }
  }
  const optimizedPrompt = optimizedLines.join('\n').trim();

  // Compute honest improved score
  const lift = scoreInfo.score >= 82 ? 6 : scoreInfo.score >= 60 ? 18 : 42;
  const optimizedScore = Math.min(95, Math.max(scoreInfo.score + 4, scoreInfo.score + lift));

  const addedTopics = recommended
    .slice(0, 3)
    .map((s) => s.title.toLowerCase())
    .join(', ');
  const summary = addedTopics
    ? `Clarified intent and added ${addedTopics}.`
    : 'Normalized phrasing and structured your request for clearer Gemini execution.';

  return {
    originalPrompt: rawPrompt,
    baseCorePrompt,
    optimizedPrompt,
    originalScore: scoreInfo.score,
    optimizedScore,
    clarityRating: scoreInfo.rating,
    detectedIntent: getIntentDisplayLabel(brief.intentCategory),
    domain: brief.domain,
    summary,
    focus,
    suggestions: suggestions.slice(0, 5),
    clarifyingQuestions: clarifyingQuestions.slice(0, 3),
    source: 'heuristic',
    elapsedMs: Math.max(1, Date.now() - startedAt),
  };
}

interface GeminiOptimizerPayload {
  baseCorePrompt?: string;
  optimizedPrompt?: string;
  summary?: string;
  detectedIntent?: string;
  domain?: string;
  optimizedScore?: number;
  suggestions?: Array<{
    id?: string;
    category?: string;
    title?: string;
    detail?: string;
    snippet?: string;
    recommended?: boolean;
  }>;
  clarifyingQuestions?: string[];
}

function sanitizeSuggestionId(raw: string, fallbackIndex: number): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || `improvement-${fallbackIndex + 1}`;
}

function sanitizeCategory(raw: unknown): PromptOptimizationCategory {
  if (typeof raw === 'string' && VALID_CATEGORIES.has(raw as PromptOptimizationCategory)) {
    return raw as PromptOptimizationCategory;
  }
  return 'clarity';
}

/**
 * Merges and validates Gemini's structured optimization output against deterministic
 * invariants (preserving prompt-writing intent, brand names, and sane score bounds).
 */
export function mergeGeminiOptimization(
  baseline: PromptOptimizationResult,
  rawPayload: GeminiOptimizerPayload,
  elapsedMs: number
): PromptOptimizationResult {
  const isPromptOnly = isPromptWritingRequest(baseline.originalPrompt);

  let baseCorePrompt =
    typeof rawPayload.baseCorePrompt === 'string' && rawPayload.baseCorePrompt.trim().length >= 8
      ? rawPayload.baseCorePrompt.trim()
      : baseline.baseCorePrompt;

  let optimizedPrompt =
    typeof rawPayload.optimizedPrompt === 'string' && rawPayload.optimizedPrompt.trim().length >= 12
      ? rawPayload.optimizedPrompt.trim()
      : baseline.optimizedPrompt;

  // Belt-and-suspenders guard: never allow an optimizer rewrite to turn a "write a prompt" request
  // into a direct "build the HTML website" command.
  if (isPromptOnly) {
    if (!/\bprompt\b/i.test(baseCorePrompt)) {
      baseCorePrompt = baseline.baseCorePrompt;
    }
    if (!/\bprompt\b/i.test(optimizedPrompt)) {
      optimizedPrompt = baseline.optimizedPrompt;
    }
  }

  const parsedSuggestions: PromptOptimizationSuggestion[] = [];
  if (Array.isArray(rawPayload.suggestions)) {
    const seenIds = new Set<string>();
    for (let i = 0; i < rawPayload.suggestions.length && parsedSuggestions.length < 5; i += 1) {
      const s = rawPayload.suggestions[i];
      const title = typeof s?.title === 'string' ? s.title.trim() : '';
      const detail = typeof s?.detail === 'string' ? s.detail.trim() : '';
      const snippet = typeof s?.snippet === 'string' ? s.snippet.trim() : '';
      if (!title || !snippet) continue;
      let id = sanitizeSuggestionId(typeof s?.id === 'string' ? s.id : title, i);
      if (seenIds.has(id)) id = `${id}-${i + 1}`;
      seenIds.add(id);
      parsedSuggestions.push({
        id,
        category: sanitizeCategory(s?.category),
        title: title.slice(0, 90),
        detail: (detail || 'Clarifies expectations for more accurate output.').slice(0, 180),
        snippet: snippet.slice(0, 260),
        recommended: typeof s?.recommended === 'boolean' ? s.recommended : i < 3,
      });
    }
  }

  const finalSuggestions = parsedSuggestions.length >= 2 ? parsedSuggestions : baseline.suggestions;
  const clarifyingQuestions = Array.isArray(rawPayload.clarifyingQuestions)
    ? rawPayload.clarifyingQuestions
        .filter((q): q is string => typeof q === 'string' && q.trim().length >= 8)
        .map((q) => q.trim().slice(0, 140))
        .slice(0, 3)
    : baseline.clarifyingQuestions;

  const rawOptScore =
    typeof rawPayload.optimizedScore === 'number' && Number.isFinite(rawPayload.optimizedScore)
      ? Math.round(rawPayload.optimizedScore)
      : baseline.optimizedScore;
  const optimizedScore = Math.max(
    baseline.originalScore + 3,
    Math.min(97, Math.max(rawOptScore, baseline.originalScore + 5))
  );

  return {
    originalPrompt: baseline.originalPrompt,
    baseCorePrompt,
    optimizedPrompt,
    originalScore: baseline.originalScore,
    optimizedScore,
    clarityRating: baseline.clarityRating,
    detectedIntent:
      typeof rawPayload.detectedIntent === 'string' && rawPayload.detectedIntent.trim().length >= 3
        ? rawPayload.detectedIntent.trim().slice(0, 60)
        : baseline.detectedIntent,
    domain:
      typeof rawPayload.domain === 'string' && rawPayload.domain.trim().length >= 3
        ? rawPayload.domain.trim().slice(0, 60)
        : baseline.domain,
    summary:
      typeof rawPayload.summary === 'string' && rawPayload.summary.trim().length >= 8
        ? rawPayload.summary.trim().slice(0, 220)
        : baseline.summary,
    focus: baseline.focus,
    suggestions: finalSuggestions,
    clarifyingQuestions,
    source: 'gemini',
    elapsedMs: Math.max(1, elapsedMs),
  };
}

/**
 * Analyzes a user's raw prompt with Gemini (structured JSON schema) to suggest
 * concrete technical context, constraints, edge cases, and output format improvements
 * before final submission. Fails open to deterministic analysis if rate-limited or offline.
 */
export async function optimizePromptWithGemini(
  ai: GoogleGenAI | null,
  input: OptimizePromptInput
): Promise<PromptOptimizationResult> {
  const startedAt = Date.now();
  const baseline = buildDeterministicOptimization(input);

  if (!ai || !baseline.originalPrompt) {
    return baseline;
  }

  const normalized = normalizeUserPromptText(baseline.originalPrompt);
  const recentContext = Array.isArray(input.history) && input.history.length > 0
    ? input.history
        .slice(-2)
        .map((h) => `${h.role.toUpperCase()}: ${h.content.slice(0, 220)}`)
        .join('\n')
    : 'None (new conversation)';

  const focusDirective: Record<PromptOptimizationFocus, string> = {
    balanced:
      'Balanced optimization: make the prompt clear, specific, and practical without bloat (around 4–7 crisp lines).',
    technical:
      'Technical depth focus: add architecture, stack/typing details, validation, accessibility, edge cases, and verification criteria.',
    concise:
      'Concise high-signal focus: tighten phrasing, remove ambiguity, and keep the optimized prompt crisp and compact (2–4 sentences or short bullets).',
  };

  const isPromptOnly = isPromptWritingRequest(baseline.originalPrompt);
  const intentGuard = isPromptOnly
    ? 'CRITICAL INVARIANT: The user is asking Gemini to WRITE A PROMPT (text prompt), NOT to build code or a website. Keep the optimized prompt strictly requesting a copy-ready prompt text (explicitly telling Gemini NOT to generate HTML/code).'
    : 'Preserve the exact goal, brand names, language preference, and any negative constraints ("no X", "without Y") from the raw input.';

  const systemInstruction = [
    'You are a System Prompt Optimizer for an AI coding & business workspace powered by Gemini.',
    'Analyze the user\'s raw draft prompt and return structured improvements that make it clearer, less ambiguous, and higher-signal BEFORE final submission.',
    focusDirective[baseline.focus],
    intentGuard,
    'Rules:',
    '- Return 3 to 5 concrete, non-generic improvement suggestions (each with a short human-readable title, a 1-sentence reason why it helps Gemini, and a single crisp instruction snippet that can be toggled on/off).',
    '- Mark the 2–3 highest-impact suggestions as recommended: true and the rest as recommended: false.',
    '- baseCorePrompt should be the cleaned-up, clear 1–2 sentence core request WITHOUT the optional suggestion bullets.',
    '- optimizedPrompt should be the polished, ready-to-submit prompt combining baseCorePrompt and the recommended suggestions cleanly.',
    '- Never invent fake project names or contradict user constraints. Keep clarifyingQuestions to 0–3 short, genuinely useful questions.',
  ].join('\n');

  const userPayload = [
    `Workspace mode: ${input.mode ?? 'auto'}`,
    `Optimization focus: ${baseline.focus}`,
    `Detected intent: ${baseline.detectedIntent} (${baseline.domain})`,
    `Recent conversation context:\n${recentContext}`,
    `Raw user prompt:\n"""\n${baseline.originalPrompt}\n"""`,
    normalized !== baseline.originalPrompt ? `Typo-normalized hint: ${normalized}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('OPTIMIZER_TIMEOUT')), OPTIMIZER_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });

    const geminiPromise = withGeminiExponentialBackoff(
      () =>
        ai.models.generateContent({
          model: OPTIMIZER_MODEL,
          contents: [{ role: 'user', parts: [{ text: userPayload }] }],
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                baseCorePrompt: { type: Type.STRING },
                optimizedPrompt: { type: Type.STRING },
                summary: { type: Type.STRING },
                detectedIntent: { type: Type.STRING },
                domain: { type: Type.STRING },
                optimizedScore: { type: Type.NUMBER },
                suggestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        enum: [
                          'technical_context',
                          'constraints',
                          'output_format',
                          'clarity',
                          'edge_cases',
                        ],
                      },
                      title: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      snippet: { type: Type.STRING },
                      recommended: { type: Type.BOOLEAN },
                    },
                    required: ['id', 'category', 'title', 'detail', 'snippet', 'recommended'],
                  },
                },
                clarifyingQuestions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'baseCorePrompt',
                'optimizedPrompt',
                'summary',
                'suggestions',
              ],
            },
          },
        }),
      { maxRetries: 1, maxTotalWaitMs: 4500 }
    );

    const response = await Promise.race([geminiPromise, timeoutPromise]);
    const rawText = (response?.result?.text ?? '').trim();
    if (!rawText) {
      return { ...baseline, elapsedMs: Date.now() - startedAt };
    }

    const parsed = JSON.parse(rawText) as GeminiOptimizerPayload;
    return mergeGeminiOptimization(baseline, parsed, Date.now() - startedAt);
  } catch {
    // Fail open cleanly to deterministic optimizer so pre-submission flow never blocks the user
    return { ...baseline, elapsedMs: Date.now() - startedAt };
  }
}

export async function runPromptOptimization(
  input: OptimizePromptInput
): Promise<PromptOptimizationResult> {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;
  return optimizePromptWithGemini(ai, input);
}

