import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDisplayLanguageLabel,
  normalizePrismLanguage,
  tokenizeCodeLines,
} from './syntaxHighlight.ts';

test('normalizePrismLanguage maps luau, html, ts, py, and unknown languages cleanly', () => {
  assert.equal(normalizePrismLanguage('luau'), 'lua');
  assert.equal(normalizePrismLanguage('Lua'), 'lua');
  assert.equal(normalizePrismLanguage('html'), 'markup');
  assert.equal(normalizePrismLanguage('tsx'), 'tsx');
  assert.equal(normalizePrismLanguage('py'), 'python');
  assert.equal(normalizePrismLanguage('unknown-xyz'), 'plaintext');
  assert.equal(getDisplayLanguageLabel('luau'), 'Luau');
  assert.equal(getDisplayLanguageLabel('tsx'), 'TSX');
});

test('tokenizeCodeLines highlights Luau keywords, strings, comments, and functions across lines', () => {
  const sample = [
    '-- UI Library comment',
    'local function CreateWindow(title)',
    '  return "Hello " .. title',
    'end',
  ].join('\n');

  const lines = tokenizeCodeLines(sample, 'luau');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].some((s) => s.tokenType === 'comment' && s.text.includes('UI Library')));
  assert.ok(lines[1].some((s) => s.tokenType === 'keyword' && s.text === 'local'));
  assert.ok(lines[1].some((s) => s.tokenType === 'function' && s.text === 'CreateWindow'));
  assert.ok(lines[2].some((s) => s.tokenType === 'string' && s.text.includes('Hello')));
  assert.ok(lines[3].some((s) => s.tokenType === 'keyword' && s.text === 'end'));
});

test('tokenizeCodeLines splits multiline comments and template strings without losing token type', () => {
  const sample = ['/* line one', 'line two */', 'const count: number = 42;'].join('\n');
  const lines = tokenizeCodeLines(sample, 'typescript');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].every((s) => s.tokenType === 'comment'));
  assert.ok(lines[1].every((s) => s.tokenType === 'comment'));
  assert.ok(lines[2].some((s) => s.tokenType === 'number' && s.text === '42'));
});

test('tokenizeCodeLines handles HTML markup tags and attributes', () => {
  const lines = tokenizeCodeLines('<button id="save" class="primary">Save</button>', 'html');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].some((s) => s.tokenType === 'tag'));
  assert.ok(lines[0].some((s) => s.tokenType === 'string'));
});
