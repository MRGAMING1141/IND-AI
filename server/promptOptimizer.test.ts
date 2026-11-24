import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicOptimization,
  mergeGeminiOptimization,
  optimizePromptWithGemini,
} from './promptOptimizer.ts';

test('vague 2-word prompt scores low and gains technical context, constraints, and higher clarity score', () => {
  const result = buildDeterministicOptimization({
    message: 'make website',
    mode: 'auto',
    focus: 'balanced',
  });

  assert.equal(result.originalPrompt, 'make website');
  assert.ok(result.originalScore < 45, `expected low score for vague prompt, got ${result.originalScore}`);
  assert.ok(result.optimizedScore > result.originalScore + 20);
  assert.equal(result.detectedIntent, 'Website & Interactive App');
  assert.ok(result.suggestions.some((s) => s.category === 'technical_context'));
  assert.ok(result.suggestions.some((s) => s.category === 'constraints'));
  assert.ok(result.optimizedPrompt.length > result.originalPrompt.length);
  assert.ok(result.clarifyingQuestions.length >= 1);
});

test('already-detailed prompt scores high and receives lighter targeted polish', () => {
  const detailed =
    'Build a responsive React + TypeScript analytics dashboard for Acme Cloud with dark theme, live search filters, CSV export, WCAG AA contrast, error handling, and unit tests. No external chart libraries and no Lorem Ipsum.';
  const result = buildDeterministicOptimization({
    message: detailed,
    mode: 'coding',
    focus: 'technical',
  });

  assert.ok(result.originalScore >= 70, `expected high score for detailed prompt, got ${result.originalScore}`);
  assert.ok(result.optimizedScore >= result.originalScore);
  assert.ok(result.suggestions.some((s) => s.id === 'user-negative-constraints'));
});

test('prompt-writing request preserves prompt-only intent and never flips into HTML website build', () => {
  const result = buildDeterministicOptimization({
    message: 'write a prompt for a coffee shop website',
    mode: 'auto',
    focus: 'balanced',
  });

  assert.equal(result.detectedIntent, 'Prompt Writing');
  assert.ok(/prompt/i.test(result.optimizedPrompt));
  assert.ok(/do not (build|generate|output)/i.test(result.optimizedPrompt));
  assert.ok(result.suggestions.some((s) => s.id === 'prompt-only-guard'));
});

test('mergeGeminiOptimization guards prompt-writing invariant even if AI omits prompt wording', () => {
  const baseline = buildDeterministicOptimization({
    message: 'write a prompt for a portfolio website',
    mode: 'auto',
  });

  const merged = mergeGeminiOptimization(
    baseline,
    {
      baseCorePrompt: 'Build a sleek HTML portfolio site.',
      optimizedPrompt: 'Create a single-file HTML portfolio with dark mode.',
      summary: 'Rewrote request.',
      suggestions: [
        {
          id: 'clarity-1',
          category: 'clarity',
          title: 'Clarify audience',
          detail: 'Helps tailor tone.',
          snippet: 'Target senior engineering hiring managers.',
          recommended: true,
        },
        {
          id: 'format-1',
          category: 'output_format',
          title: 'Use structured prompt sections',
          detail: 'Organizes instructions clearly.',
          snippet: 'Format the prompt with Role, Goal, and Constraints headings.',
          recommended: true,
        },
      ],
    },
    120
  );

  assert.equal(merged.source, 'gemini');
  assert.ok(/prompt/i.test(merged.optimizedPrompt));
  assert.ok(/prompt/i.test(merged.baseCorePrompt));
  assert.equal(merged.suggestions.length, 2);
});

test('Hinglish and typo-filled prompt preserves brand name and clarifies intent', () => {
  const result = buildDeterministicOptimization({
    message: 'bhai coffie webste banao named "BrewVibe" no dark mode',
    mode: 'auto',
  });

  assert.equal(result.domain, 'Coffee Shop / Cafe');
  assert.ok(result.baseCorePrompt.includes('BrewVibe'));
  assert.ok(result.optimizedPrompt.toLowerCase().includes('no dark mode'));
});

test('follow-up code edit with conversation history adds preservation and complete-file constraints', () => {
  const result = buildDeterministicOptimization({
    message: 'fix the navbar button alignment',
    mode: 'coding',
    history: [
      { role: 'user', content: 'Build a coffee shop website' },
      {
        role: 'assistant',
        content: 'Here is your site:\n```html:index.html\n<!doctype html><html><body><nav><button>Menu</button></nav></body></html>\n```',
      },
    ],
  });

  assert.equal(result.detectedIntent, 'In-Place Code Update');
  assert.ok(result.suggestions.some((s) => s.id === 'preserve-existing'));
  assert.ok(result.suggestions.some((s) => s.id === 'return-complete-file'));
  assert.ok(result.optimizedPrompt.includes('index.html'));
});

test('optimizePromptWithGemini fails open to deterministic optimization when AI client is null', async () => {
  const result = await optimizePromptWithGemini(null, {
    message: 'build a todo app with localstorage',
    mode: 'coding',
    focus: 'concise',
  });

  assert.equal(result.source, 'heuristic');
  assert.equal(result.focus, 'concise');
  assert.ok(result.optimizedPrompt.length > 0);
  assert.ok(result.suggestions.length >= 2);
});
