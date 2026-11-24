import type {
  PromptOptimizationCategory,
  PromptOptimizationResult,
  PromptOptimizationSuggestion,
} from '../types/agent.ts';

const CATEGORY_LABELS: Record<PromptOptimizationCategory, string> = {
  technical_context: 'Technical context',
  constraints: 'Constraints',
  output_format: 'Output format',
  clarity: 'Clarity',
  edge_cases: 'Edge cases',
};

export function formatOptimizationCategory(category: PromptOptimizationCategory): string {
  return CATEGORY_LABELS[category] ?? 'Clarity';
}

export function getDefaultSelectedSuggestionIds(
  suggestions: PromptOptimizationSuggestion[]
): string[] {
  const recommended = suggestions.filter((s) => s.recommended).map((s) => s.id);
  if (recommended.length > 0) return recommended;
  return suggestions.slice(0, 3).map((s) => s.id);
}

/**
 * Checks whether the current selected suggestion IDs exactly match the initial
 * recommended set (so we can preserve Gemini's naturally woven prose when unmodified).
 */
export function matchesDefaultSelection(
  suggestions: PromptOptimizationSuggestion[],
  selectedIds: string[]
): boolean {
  const defaults = getDefaultSelectedSuggestionIds(suggestions);
  if (defaults.length !== selectedIds.length) return false;
  const set = new Set(selectedIds);
  return defaults.every((id) => set.has(id));
}

/**
 * Composes an editable, well-structured prompt from the optimization result and
 * the user's active suggestion selections (plus any optional clarifying note lines).
 */
export function composePromptFromSelections(
  result: PromptOptimizationResult,
  selectedIds: string[],
  clarifyingNotes: string[] = []
): string {
  const cleanNotes = clarifyingNotes
    .map((n) => n.trim())
    .filter(Boolean);

  if (
    matchesDefaultSelection(result.suggestions, selectedIds) &&
    cleanNotes.length === 0 &&
    result.optimizedPrompt.trim().length > 0
  ) {
    return result.optimizedPrompt.trim();
  }

  const selectedSet = new Set(selectedIds);
  const chosen = result.suggestions.filter((s) => selectedSet.has(s.id));

  const core = (result.baseCorePrompt || result.originalPrompt).trim();
  if (chosen.length === 0 && cleanNotes.length === 0) {
    return core;
  }

  const lines: string[] = [core];

  if (chosen.length > 0) {
    lines.push('');
    lines.push('Requirements & Constraints:');
    for (const item of chosen) {
      const snippet = item.snippet.trim().replace(/^[-•*]\s*/, '');
      if (snippet) {
        lines.push(`- ${snippet}`);
      }
    }
  }

  if (cleanNotes.length > 0) {
    lines.push('');
    lines.push('Additional Context:');
    for (const note of cleanNotes) {
      lines.push(`- ${note.replace(/^[-•*]\s*/, '')}`);
    }
  }

  return lines.join('\n').trim();
}

/**
 * Estimates the live clarity score as the user toggles individual suggestions on or off.
 */
export function estimateSelectedClarityScore(
  result: PromptOptimizationResult,
  selectedIds: string[]
): number {
  const base = Math.max(0, Math.min(100, Math.round(result.originalScore)));
  const target = Math.max(base, Math.min(100, Math.round(result.optimizedScore)));
  const total = result.suggestions.length;

  if (total === 0) return target;

  const selectedCount = result.suggestions.filter((s) => selectedIds.includes(s.id)).length;
  if (selectedCount === 0) {
    // Even with zero optional suggestions checked, baseCorePrompt cleanup gives a modest lift
    return Math.min(target, base + Math.min(8, Math.round((target - base) * 0.2)));
  }

  const recommendedCount = Math.max(
    1,
    getDefaultSelectedSuggestionIds(result.suggestions).length
  );
  const ratio = Math.min(1.08, selectedCount / recommendedCount);
  const interpolated = base + Math.round((target - base) * ratio);
  return Math.max(base, Math.min(98, interpolated));
}

export function getClarityLabel(score: number): 'Vague' | 'Fair' | 'Clear' | 'Strong' {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Clear';
  if (score >= 40) return 'Fair';
  return 'Vague';
}
