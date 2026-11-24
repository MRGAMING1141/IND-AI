import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUpSuggestions } from './followUpSuggestions.ts';

test('buildFollowUpSuggestions returns Luau-specific next steps for Lua UI libraries', () => {
  const suggestions = buildFollowUpSuggestions(
    'Here is your library:\n```luau:UILibrary.luau\nlocal TweenService = game:GetService("TweenService")\n```',
    'make lua ui library'
  );
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.some((s) => /ColorPicker|Keybind/i.test(s.label)));
});

test('buildFollowUpSuggestions returns web/full-stack suggestions for HTML outputs', () => {
  const suggestions = buildFollowUpSuggestions(
    '```html:public/index.html\n<!doctype html><html><body>Hi</body></html>\n```',
    'make a portfolio'
  );
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.some((s) => /accessibility|mobile/i.test(s.label)));
});

test('buildFollowUpSuggestions returns email localization options for draft blocks', () => {
  const suggestions = buildFollowUpSuggestions(
    '```draft\nTo: a@b.com\nSubject: Quote\n\nHello\n```',
    'draft a customer email'
  );
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.some((s) => /Hindi/i.test(s.label)));
});
