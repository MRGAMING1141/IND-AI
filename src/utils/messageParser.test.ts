import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPreviewableHtml,
  detectWebsiteArtifact,
  extractHtmlTitle,
  extractProjectFiles,
  getSuggestedFilename,
  parseAgentMessage,
} from './messageParser.ts';

test('parses prose, single-file HTML code block, and DRAFT block', () => {
  const sample = [
    'Task: Build a quick quote page and draft a client reply.',
    '',
    '```html',
    '<!doctype html><html><body><h1>Quote Calculator</h1></body></html>',
    '```',
    '',
    '```draft',
    'To: client@example.com',
    'Subject: Order Confirmation',
    'Language: English',
    '',
    'Hello, please confirm your order quantity and delivery date.',
    '```',
  ].join('\n');

  const segments = parseAgentMessage(sample);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].kind, 'prose');
  assert.equal(segments[1].kind, 'code');
  if (segments[1].kind === 'code') {
    assert.equal(segments[1].language, 'html');
    assert.equal(segments[1].isSingleFileHtml, true);
  }
  assert.equal(segments[2].kind, 'draft');
  if (segments[2].kind === 'draft') {
    assert.equal(segments[2].to, 'client@example.com');
    assert.equal(segments[2].subject, 'Order Confirmation');
    assert.equal(segments[2].language, 'English');
  }
});

test('extracts multi-file project paths from labeled fences and headings', () => {
  const sample = [
    'Plan complete. Generating multi-file app:',
    '',
    '```html:index.html',
    '<!doctype html><html><body><script src="app.js"></script></body></html>',
    '```',
    '',
    '### File: src/app.js',
    '```js',
    'console.log("ready");',
    '```',
  ].join('\n');

  const files = extractProjectFiles(sample);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'index.html');
  assert.equal(files[1].path, 'src/app.js');
  assert.equal(getSuggestedFilename('luau', 0), 'roblox-script-1.luau');

  const bundled = buildPreviewableHtml(files, files[0].content);
  assert.ok(bundled.includes('console.log("ready");'));
});

test('parses copyable prompt blocks across fenced, delimited, and prompt-introduced formats without polluting project files', () => {
  const sample = [
    'Here is a ready-to-copy prompt for your hero image:',
    '',
    '```prompt:Cinematic Product Shot',
    'Studio product photography of [PRODUCT_NAME] on brushed slate, soft rim lighting, 85mm lens.',
    '```',
    '',
    '--- PROMPT: System Architect ---',
    'Act as a Principal Architect reviewing [REPO_NAME].',
    '--- END PROMPT ---',
    '',
    '### Engineered Prompt',
    '```text',
    'Write a concise investor update for [COMPANY] covering MRR and retention.',
    '```',
  ].join('\n');

  const segments = parseAgentMessage(sample);
  const promptSegments = segments.filter((s) => s.kind === 'prompt');
  assert.equal(promptSegments.length, 3);

  if (promptSegments[0].kind === 'prompt') {
    assert.equal(promptSegments[0].title, 'Cinematic Product Shot');
    assert.ok(promptSegments[0].text.includes('[PRODUCT_NAME]'));
  }
  if (promptSegments[1].kind === 'prompt') {
    assert.equal(promptSegments[1].title, 'System Architect');
    assert.ok(promptSegments[1].text.includes('[REPO_NAME]'));
  }
  if (promptSegments[2].kind === 'prompt') {
    assert.equal(promptSegments[2].title, 'Engineered Prompt');
    assert.ok(promptSegments[2].text.includes('[COMPANY]'));
  }

  // Prompt cards must not be extracted as code project files
  assert.equal(extractProjectFiles(sample).length, 0);
});

test('detectWebsiteArtifact extracts HTML title and handles in-progress streaming HTML fences', () => {
  const completed = [
    'I designed a specialty coffee roastery website with an interactive roast selector.',
    '',
    '```html:index.html',
    '<!doctype html>',
    '<html><head><title>Velvet Roast — Artisanal Coffee</title></head><body><h1>Velvet Roast</h1></body></html>',
    '```',
  ].join('\n');

  assert.equal(extractHtmlTitle(completed), 'Velvet Roast — Artisanal Coffee');
  const artifact = detectWebsiteArtifact(completed);
  assert.ok(artifact);
  assert.equal(artifact.title, 'Velvet Roast — Artisanal Coffee');
  assert.equal(artifact.activePath, 'index.html');
  assert.equal(artifact.files.length, 1);

  const streaming = [
    'Building your interactive website now:',
    '',
    '```html:index.html',
    '<!doctype html>',
    '<html><head><title>Kora Studio</title></head>',
    '<body><main>Loading...',
  ].join('\n');

  const streamingSegments = parseAgentMessage(streaming);
  const streamSeg = streamingSegments.find((s) => s.kind === 'streaming_artifact');
  assert.ok(streamSeg);
  if (streamSeg && streamSeg.kind === 'streaming_artifact') {
    assert.equal(streamSeg.title, 'Kora Studio');
    assert.equal(streamSeg.lineCount, 3);
  }
});
