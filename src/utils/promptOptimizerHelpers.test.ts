import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composePromptFromSelections,
  estimateSelectedClarityScore,
  formatOptimizationCategory,
  getClarityLabel,
  getDefaultSelectedSuggestionIds,
} from './promptOptimizerHelpers.ts';
import type { PromptOptimizationResult } from '../types/agent.ts';

function makeSampleResult(): PromptOptimizationResult {
  return {
    originalPrompt: 'make a coffee shop website',
    baseCorePrompt: 'Build a responsive coffee shop website with clear branding and interactive menu.',
    optimizedPrompt:
      'Build a responsive coffee shop website with clear branding, interactive menu filtering, and accessible mobile navigation.',
    originalScore: 28,
    optimizedScore: 86,
    clarityRating: 'vague',
    detectedIntent: 'Website & Interactive App',
    domain: 'Coffee Shop / Cafe',
    summary: 'Added responsive layout, interactive menu scope, and clear deliverable format.',
    focus: 'balanced',
    suggestions: [
      {
        id: 'tech-stack',
        category: 'technical_context',
        title: 'Specify responsive layout and stack',
        detail: 'Clarifies modern semantic HTML, CSS, and vanilla JS with mobile breakpoints.',
        snippet: 'Use semantic HTML, responsive CSS (mobile 390px and desktop 1440px), and clean interactive JavaScript.',
        recommended: true,
      },
      {
        id: 'constraints',
        category: 'constraints',
        title: 'Prevent placeholders and dead controls',
        detail: 'Ensures every menu filter, cart action, and form works end-to-end.',
        snippet: 'Avoid Lorem Ipsum placeholders and ensure every button, filter, and form has real working interactivity.',
        recommended: true,
      },
      {
        id: 'edge-cases',
        category: 'edge_cases',
        title: 'Handle empty states and accessibility',
        detail: 'Adds keyboard focus rings, contrast checks, and empty filter states.',
        snippet: 'Include WCAG AA color contrast, visible focus states, and graceful empty states for filters.',
        recommended: false,
      },
    ],
    clarifyingQuestions: ['Do you have a specific brand name or city for the cafe?'],
    source: 'heuristic',
    elapsedMs: 12,
  };
}

test('returns optimizedPrompt verbatim when default recommended suggestions are selected', () => {
  const result = makeSampleResult();
  const defaults = getDefaultSelectedSuggestionIds(result.suggestions);
  assert.deepEqual(defaults, ['tech-stack', 'constraints']);

  const composed = composePromptFromSelections(result, defaults);
  assert.equal(composed, result.optimizedPrompt);
});

test('re-composes cleanly when user toggles suggestions on or off', () => {
  const result = makeSampleResult();

  const withExtra = composePromptFromSelections(result, ['tech-stack', 'constraints', 'edge-cases']);
  assert.ok(withExtra.includes(result.baseCorePrompt));
  assert.ok(withExtra.includes('WCAG AA color contrast'));

  const withOnlyOne = composePromptFromSelections(result, ['constraints']);
  assert.ok(withOnlyOne.includes('Avoid Lorem Ipsum placeholders'));
  assert.ok(!withOnlyOne.includes('Use semantic HTML'));

  const withNone = composePromptFromSelections(result, []);
  assert.equal(withNone, result.baseCorePrompt);
});

test('appends clarifying notes cleanly when supplied', () => {
  const result = makeSampleResult();
  const defaults = getDefaultSelectedSuggestionIds(result.suggestions);
  const composed = composePromptFromSelections(result, defaults, ['Brand name: BrewVibe Mumbai']);
  assert.ok(composed.includes('Additional Context:'));
  assert.ok(composed.includes('Brand name: BrewVibe Mumbai'));
});

test('estimateSelectedClarityScore rises monotonically with selected suggestions', () => {
  const result = makeSampleResult();
  const none = estimateSelectedClarityScore(result, []);
  const one = estimateSelectedClarityScore(result, ['tech-stack']);
  const two = estimateSelectedClarityScore(result, ['tech-stack', 'constraints']);
  const three = estimateSelectedClarityScore(result, ['tech-stack', 'constraints', 'edge-cases']);

  assert.ok(none >= result.originalScore);
  assert.ok(one > none);
  assert.ok(two >= one);
  assert.ok(three >= two);
  assert.ok(three <= 98);
});

test('category labels and clarity labels return clean human prose', () => {
  assert.equal(formatOptimizationCategory('technical_context'), 'Technical context');
  assert.equal(formatOptimizationCategory('output_format'), 'Output format');
  assert.equal(getClarityLabel(25), 'Vague');
  assert.equal(getClarityLabel(50), 'Fair');
  assert.equal(getClarityLabel(70), 'Clear');
  assert.equal(getClarityLabel(88), 'Strong');
});
