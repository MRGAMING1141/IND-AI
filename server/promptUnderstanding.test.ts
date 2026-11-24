import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePromptDeeply,
  detectResponseLanguage,
  extractBrandOrEntityNames,
  extractNegativeConstraints,
  isPromptWritingRequest,
  mergeAiUnderstandingBrief,
  normalizeUserPromptText,
} from './promptUnderstanding.ts';
import {
  analyzeCodingIntent,
  checkPromptRequirements,
  detectFollowUpCodeEdit,
  extractFencedCodeBlocks,
} from './codeVerifier.ts';
import { buildIndAgentSystemPrompt } from './systemPrompt.ts';

test('isPromptWritingRequest catches English, casual shorthand, and Hinglish prompt-writing requests even when topic is a website', () => {
  const positives = [
    'write a prompt for a portfolio website',
    'write prompt for web',
    'make a prompt for an ecommerce website',
    'give me a prompt to build a landing page',
    'prompt for website',
    'website ke liye prompt likho',
    'ek prompt banao coffee shop website ke liye',
    'improve my prompt for chatgpt',
    'system prompt for a customer support agent',
    'midjourney prompt for cyberpunk car',
    'only give me a prompt for making a SaaS dashboard',
  ];

  for (const p of positives) {
    assert.equal(isPromptWritingRequest(p), true, `Expected prompt-writing match for: "${p}"`);
    const codingIntent = analyzeCodingIntent(p, 'auto');
    assert.equal(codingIntent.kind, 'prompt_engineering', `Expected prompt_engineering kind for: "${p}"`);
    assert.equal(codingIntent.isWebsiteOrFullStack, false, `Must NOT trigger website build for: "${p}"`);
    assert.equal(codingIntent.isCodingTask, false, `Must NOT trigger coding task for: "${p}"`);
  }
});

test('isPromptWritingRequest does NOT false-positive on normal coding/UI prompt mentions', () => {
  const negatives = [
    'Make a website for portfolio',
    'build a web app with a confirmation prompt modal',
    'build a terminal command prompt simulator in HTML',
    'write a python function that prompts the user for their age',
    'add a login prompt to the navbar',
    'bhai ek ecommerce site banao shoes ke liye',
  ];

  for (const p of negatives) {
    assert.equal(isPromptWritingRequest(p), false, `Expected NOT prompt-writing for: "${p}"`);
  }
});

test('Prompt-writing request suppresses website-artifact instructions even in IND HYPER mode', () => {
  const msg = 'write a prompt for a modern portfolio website';
  const codingIntent = analyzeCodingIntent(msg, 'auto');
  const followUp = detectFollowUpCodeEdit(msg, [
    { role: 'user', content: 'make a website' },
    { role: 'assistant', content: '```html:index.html\n<!DOCTYPE html><html><body>Hi</body></html>\n```' },
  ]);
  assert.equal(followUp.isFollowUpEdit, false, 'Asking to write a prompt must NOT trigger follow-up HTML edit');

  const brief = analyzePromptDeeply({
    message: msg,
    mode: 'auto',
    codingIntent,
    followUpEdit: followUp,
    historyCount: 2,
  });
  assert.equal(brief.intentCategory, 'prompt_engineering');
  assert.equal(brief.isPromptEngineering, true);

  const sysPrompt = buildIndAgentSystemPrompt('auto', {
    gmail: false,
    drive: false,
    plan: 'plus',
    modelChoice: 'hyper',
    intent: codingIntent,
    promptBrief: brief,
    followUpEdit: followUp,
  });

  assert.match(sysPrompt, /PROMPT WRITING ONLY — STRICT NO-WEBSITE \/ NO-CODE RULE/);
  assert.doesNotMatch(sysPrompt, /CLAUDE-STYLE INTERACTIVE WEBSITE ARTIFACT/);
  assert.doesNotMatch(sysPrompt, /IN-PLACE SURGICAL FIX/);
});

test('normalizeUserPromptText, brand extraction, negative constraints, and Hinglish website understanding work together', () => {
  const messyPrompt =
    'bhai ek coffie shop webste banao name BrewVibe with menu and dark/light toggle, no purple color, use green';

  assert.match(normalizeUserPromptText(messyPrompt), /coffee shop website/);
  assert.equal(detectResponseLanguage(messyPrompt).isHinglishOrMultilingual, true);
  assert.deepEqual(extractBrandOrEntityNames(messyPrompt), ['BrewVibe']);

  const negatives = extractNegativeConstraints(normalizeUserPromptText(messyPrompt));
  assert.ok(negatives.some((c) => /no purple color/i.test(c)));

  const codingIntent = analyzeCodingIntent(messyPrompt, 'auto');
  assert.equal(codingIntent.isWebsiteOrFullStack, true);
  assert.equal(codingIntent.isCodingTask, true);

  const brief = analyzePromptDeeply({
    message: messyPrompt,
    mode: 'auto',
    codingIntent,
    followUpEdit: {
      isFollowUpEdit: false,
      previousFileNames: [],
      previousLineCount: 0,
      previousHasHtmlArtifact: false,
      wantsShrinkOrDelete: false,
      latestCodeBlocks: [],
    },
  });

  assert.equal(brief.intentCategory, 'website_artifact');
  assert.equal(brief.domain, 'Coffee Shop / Cafe');
  assert.equal(brief.isPromptEngineering, false);
  assert.ok(brief.brandNames.includes('BrewVibe'));
  assert.ok(brief.mustInclude.some((m) => /dark\/light/i.test(m)));
  assert.ok(brief.mustInclude.some((m) => /menu/i.test(m)));
  assert.ok(brief.stylePreferences.some((s) => /green/i.test(s)));
  assert.equal(brief.complexity, 'complex');
  assert.equal(brief.needsAiRefinement, true);
});

test('Hinglish and casual follow-up fixes trigger in-place edit detection', () => {
  const history = [
    { role: 'user' as const, content: 'Make a coffee shop website named BrewVibe' },
    {
      role: 'assistant' as const,
      content:
        '```html:index.html\n<!DOCTYPE html><html><head><title>BrewVibe</title></head><body><h1>BrewVibe</h1></body></html>\n```',
    },
  ];

  const followUps = [
    'ye button kaam nahi kar raha',
    'color green krdo aur pricing section add karo',
    'looks weird on mobile',
    'hero thik karo',
  ];

  for (const msg of followUps) {
    const res = detectFollowUpCodeEdit(msg, history);
    assert.equal(res.isFollowUpEdit, true, `Expected follow-up edit for: "${msg}"`);
    assert.equal(res.previousHasHtmlArtifact, true);
  }

  // Fresh start resets follow-up
  const fresh = detectFollowUpCodeEdit('ignore previous and build a brand new gym website', history);
  assert.equal(fresh.isFollowUpEdit, false);
});

test('checkPromptRequirements verifies requested brand names and sections', () => {
  const blocks = extractFencedCodeBlocks(
    '```html:index.html\n<!DOCTYPE html><html><body><h1>Generic Cafe</h1><p>Welcome</p></body></html>\n```'
  );
  const issues = checkPromptRequirements(
    'Make a coffee website named BrewVibe with pricing plans and FAQ accordion',
    blocks,
    { brandNames: ['BrewVibe'] }
  );

  assert.ok(issues.some((i) => /BrewVibe/.test(i.message)), 'Should flag missing BrewVibe brand');
  assert.ok(issues.some((i) => /pricing/i.test(i.message)), 'Should flag missing pricing section');
  assert.ok(issues.some((i) => /FAQ/i.test(i.message)), 'Should flag missing FAQ section');

  const completeBlocks = extractFencedCodeBlocks(
    '```html:index.html\n<!DOCTYPE html><html><body><h1>BrewVibe</h1><section id="pricing">$19/mo</section><details><summary>FAQ</summary></details></body></html>\n```'
  );
  const passIssues = checkPromptRequirements(
    'Make a coffee website named BrewVibe with pricing plans and FAQ accordion',
    completeBlocks,
    { brandNames: ['BrewVibe'] }
  );
  assert.equal(passIssues.length, 0);
});

test('mergeAiUnderstandingBrief preserves prompt_engineering lock and fails open cleanly', () => {
  const msg = 'write a prompt for building a fitness website';
  const base = analyzePromptDeeply({
    message: msg,
    mode: 'auto',
    codingIntent: analyzeCodingIntent(msg, 'auto'),
    followUpEdit: {
      isFollowUpEdit: false,
      previousFileNames: [],
      previousLineCount: 0,
      previousHasHtmlArtifact: false,
      wantsShrinkOrDelete: false,
      latestCodeBlocks: [],
    },
  });

  // Fail-open on null
  assert.equal(mergeAiUnderstandingBrief(base, null, false), base);

  // Even if AI planner erroneously returns website_artifact, deterministic prompt_engineering lock holds
  const merged = mergeAiUnderstandingBrief(
    base,
    {
      understoodGoal: 'Write a detailed reusable prompt for generating a modern fitness website',
      intentCategory: 'website_artifact',
      mustInclude: ['Role definition', 'Section breakdown', 'Responsive layout constraints'],
      isFollowUpEdit: true,
    },
    true
  );
  assert.equal(merged.intentCategory, 'prompt_engineering');
  assert.equal(merged.isPromptEngineering, true);
  assert.equal(merged.semanticFollowUpEdit, false);
  assert.equal(merged.refinedByAi, true);
  assert.ok(merged.mustInclude.includes('Role definition'));
});
