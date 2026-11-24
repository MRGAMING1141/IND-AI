import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCodingIntent,
  detectFollowUpCodeEdit,
  runSandboxedJsCheck,
  verifyCodeBlocks,
} from './codeVerifier.ts';

test('analyzeCodingIntent classifies debugging, Roblox Luau, HTML build, and business prompts accurately', () => {
  const bug = analyzeCodingIntent(
    'Fix this TypeError: Cannot read properties of undefined (reading "map") in my React list',
    'auto'
  );
  assert.equal(bug.kind, 'fix_bug');
  assert.equal(bug.isCodingTask, true);
  assert.equal(bug.isDebuggingTask, true);
  assert.ok(bug.languages.includes('React'));

  const luau = analyzeCodingIntent(
    'Write a Roblox Luau coin pickup script using leaderstats',
    'auto'
  );
  assert.equal(luau.kind, 'roblox_luau');
  assert.equal(luau.isCodingTask, true);
  assert.ok(luau.languages.includes('Luau'));

  const biz = analyzeCodingIntent(
    'Draft a polite Hindi customer reply confirming their 20-jar water delivery tomorrow',
    'business'
  );
  assert.equal(biz.kind, 'business_ops');
  assert.equal(biz.isCodingTask, false);

  const portfolio = analyzeCodingIntent('make a portfolio website for a full-stack developer', 'auto');
  assert.equal(portfolio.kind, 'build_app');
  assert.equal(portfolio.isCodingTask, true);
  assert.equal(portfolio.isWebsiteOrFullStack, true);
  assert.equal(portfolio.wantsMultiFile, true);
});

test('verifyCodeBlocks catches broken JS syntax, inline HTML script errors, missing DOM IDs, and placeholders', () => {
  const brokenHtml = [
    '```html:index.html',
    '<!doctype html><html><body>',
    '<button id="saveBtn">Save</button>',
    '<script>',
    'const el = document.getElementById("missingBtn");',
    'const broken = [1, 2, ;',
    '</script>',
    '</body></html>',
    '```',
  ].join('\n');

  const report = verifyCodeBlocks(brokenHtml);
  assert.equal(report.passed, false);
  assert.ok(report.errorCount >= 2);
  assert.ok(report.issues.some((i) => i.message.includes('missingBtn')));

  const placeholderJs = '```js:app.js\nfunction calc() {\n  // TODO: implement\n}\n```';
  const placeholderReport = verifyCodeBlocks(placeholderJs);
  assert.equal(placeholderReport.passed, false);
  assert.ok(placeholderReport.issues.some((i) => i.message.toLowerCase().includes('placeholder')));
});

test('verifyCodeBlocks passes valid single-file HTML, TypeScript, and Roblox Luau', () => {
  const validReply = [
    '```html:index.html',
    '<!doctype html><html><body>',
    '<button id="runBtn">Run</button><div id="out"></div>',
    '<script>',
    'const btn = document.getElementById("runBtn");',
    'const out = document.getElementById("out");',
    'btn?.addEventListener("click", () => { if (out) out.textContent = "OK"; });',
    '</script>',
    '</body></html>',
    '```',
    '',
    '```luau:CoinPickup.luau',
    'local function awardCoin(player)',
    '  if player then',
    '    print(player.Name)',
    '  end',
    'end',
    '```',
  ].join('\n');

  const report = verifyCodeBlocks(validReply);
  assert.equal(report.filesChecked, 2);
  assert.equal(report.passed, true);
  assert.equal(report.errorCount, 0);
});

test('verifyCodeBlocks catches missing end in Luau and invalid JSON', () => {
  const badLuau = '```luau\nlocal function broken()\n  if true then\n    print("hi")\nend\n```';
  const luauReport = verifyCodeBlocks(badLuau);
  assert.equal(luauReport.passed, false);
  assert.ok(luauReport.issues.some((i) => i.message.includes('Missing')));

  const badJson = '```json\n{"a": 1,}\n```';
  const jsonReport = verifyCodeBlocks(badJson);
  assert.equal(jsonReport.passed, false);
});

test('runSandboxedJsCheck verifies pure JS logic, catches bugs, and blocks process access & infinite loops', () => {
  const pass = runSandboxedJsCheck({
    language: 'typescript',
    code: 'function sum(nums: number[]): number { return nums.reduce((a, b) => a + b, 0); }',
    testCode: 'assertEqual(sum([2, 3, 5]), 10); console.log("ok");',
  });
  assert.equal(pass.syntaxOk, true);
  assert.equal(pass.runtimeOk, true);
  assert.deepEqual(pass.logs, ['ok']);

  const fail = runSandboxedJsCheck({
    language: 'javascript',
    code: 'function sum(nums) { return nums.reduce((a, b) => a + b, 1); }',
    testCode: 'assertEqual(sum([2, 3]), 5);',
  });
  assert.equal(fail.syntaxOk, true);
  assert.equal(fail.runtimeOk, false);
  assert.ok(fail.error?.includes('Expected 5, got 6'));

  const blocked = runSandboxedJsCheck({
    language: 'javascript',
    code: 'const x = typeof process;',
    testCode: 'assertEqual(x, "undefined");',
  });
  assert.equal(blocked.runtimeOk, true);

  const timeout = runSandboxedJsCheck({
    language: 'javascript',
    code: 'while (true) {}',
    testCode: 'console.log("never");',
  });
  assert.equal(timeout.runtimeOk, false);
});

test('verifyCodeBlocks with requireFullStackWebsite catches stub placeholders, alert(), missing @media, and sparse HTML', () => {
  const stubSite = [
    '```html:public/index.html',
    '<!doctype html><html><body>',
    '<h1>Studio</h1><div>Visual Placeholder</div>',
    '<div><h3>Project Alpha</h3></div>',
    '<script>function send(){ alert("Sent!"); }</script>',
    '</body></html>',
    '```',
  ].join('\n');

  const report = verifyCodeBlocks(stubSite, { requireFullStackWebsite: true });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.message.includes('Visual/Image Placeholder')));
  assert.ok(report.issues.some((i) => i.message.includes('Project Alpha')));
  assert.ok(report.issues.some((i) => i.message.includes('alert()')));
  assert.ok(report.issues.some((i) => i.message.includes('@media')));
  assert.ok(report.issues.some((i) => i.message.includes('<svg>')));
  assert.ok(report.issues.some((i) => i.message.includes('server.js')));
});

test('analyzeCodingIntent detects lua ui library and verifyCodeBlocks rejects short toy Lua snippets', () => {
  const intent = analyzeCodingIntent('make lua ui library', 'auto');
  assert.equal(intent.kind, 'roblox_luau');
  assert.equal(intent.isCodingTask, true);
  assert.equal(intent.isLuaUiLibrary, true);
  assert.equal(intent.isHighLevelBuild, true);

  const tinyLua = [
    '```luau:UILib.luau',
    'local Lib = {}',
    'function Lib:Window(name)',
    '  local f = Instance.new("Frame")',
    '  return f',
    'end',
    'return Lib',
    '```',
  ].join('\n');

  const report = verifyCodeBlocks(tinyLua, {
    requireHighLevelCode: true,
    requireLuaUiLibrary: true,
  });
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((i) => i.message.includes('too short')));
  assert.ok(report.issues.some((i) => i.message.includes('missing core high-level components')));
});

test('verifyCodeBlocks skips prompt blocks and allows frontend-only Tailwind website artifacts while enforcing Hyper depth', () => {
  const promptOnly = '```prompt:Hero Image\nCinematic sunrise over Kyoto rooftop\n```';
  const promptReport = verifyCodeBlocks(promptOnly);
  assert.equal(promptReport.filesChecked, 0);
  assert.equal(promptReport.passed, true);

  const landingIntent = analyzeCodingIntent('build a specialty coffee website', 'auto');
  assert.equal(landingIntent.isWebsiteOrFullStack, true);
  assert.equal(landingIntent.wantsBackend, false);

  const shortTailwindSite = [
    '```html:index.html',
    '<!doctype html><html><head><title>Roast Lab</title><script src="https://cdn.tailwindcss.com"></script></head>',
    '<body class="grid grid-cols-1 md:grid-cols-2"><svg viewBox="0 0 24 24"></svg></body></html>',
    '```',
  ].join('\n');

  const hyperReport = verifyCodeBlocks(shortTailwindSite, {
    requireFullStackWebsite: true,
    requireBackend: false,
    isHyper: true,
  });
  assert.equal(hyperReport.passed, false);
  // Does not demand server.js when requireBackend is false, and accepts Tailwind responsive classes
  assert.ok(!hyperReport.issues.some((i) => i.message.includes('server.js')));
  assert.ok(!hyperReport.issues.some((i) => i.message.includes('@media')));
  // Enforces Hyper line depth
  assert.ok(hyperReport.issues.some((i) => i.message.includes('IND HYPER website artifact is too short')));
});

test('detectFollowUpCodeEdit identifies in-place fixes and verifyCodeBlocks rejects partial/truncated fix snippets', () => {
  const fullHtmlLines = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Kova Studio</title><style>body{margin:0;font-family:sans-serif;}</style></head>',
    '<body>',
    '<header id="top"><button id="menuBtn">Menu</button></header>',
    ...Array.from({ length: 95 }, (_, idx) => `<section class="sec-${idx}"><h2>Section ${idx}</h2><p>Authentic studio details ${idx}.</p></section>`),
    '<script>document.getElementById("menuBtn").addEventListener("click", () => {});</script>',
    '</body></html>',
  ].join('\n');

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: 'Build a studio portfolio website' },
    { role: 'assistant', content: `Here is your site:\n\`\`\`html:index.html\n${fullHtmlLines}\n\`\`\`` },
  ];

  // Follow-up fix is detected accurately
  const followUp = detectFollowUpCodeEdit('fix the mobile menu button click handler', history);
  assert.equal(followUp.isFollowUpEdit, true);
  assert.equal(followUp.previousHasHtmlArtifact, true);
  assert.ok(followUp.previousLineCount >= 95);

  // Explicit start-over is NOT treated as an in-place edit
  const startFresh = detectFollowUpCodeEdit('start over from scratch and build a coffee shop', history);
  assert.equal(startFresh.isFollowUpEdit, false);

  // Partial 8-line snippet with omission comment is rejected as an error
  const partialFix = [
    'Fixed the button:',
    '```html:index.html',
    '<!-- ... existing html unchanged -->',
    '<button id="menuBtn">Toggle Menu</button>',
    '<script>',
    '// ... rest of code unchanged',
    'document.getElementById("menuBtn").addEventListener("click", () => console.log("ok"));',
    '</script>',
    '```',
  ].join('\n');

  const badReport = verifyCodeBlocks(partialFix, { followUpEditContext: followUp });
  assert.equal(badReport.passed, false);
  assert.ok(badReport.issues.some((i) => /omission|partial snippet/i.test(i.message)));

  // Complete in-place updated HTML passes cleanly
  const goodFix = `Fixed the menu toggle:\n\`\`\`html:index.html\n${fullHtmlLines.replace('() => {}', '() => document.body.classList.toggle("menu-open")')}\n\`\`\``;
  const goodReport = verifyCodeBlocks(goodFix, { followUpEditContext: followUp });
  assert.equal(goodReport.passed, true);
});

test('verifyCodeBlocks catches unmet userPrompt requirements (theme toggle, cart, form) and passes once satisfied', () => {
  const prompt = 'Build a coffee shop website with dark/light theme toggle, shopping cart drawer, and contact form';
  const missingFeaturesHtml = [
    '```html:index.html',
    '<!doctype html><html><head><title>Bean</title><style>body{margin:0;}</style></head>',
    '<body><h1>Bean Coffee</h1><p>Fresh beans</p></body></html>',
    '```',
  ].join('\n');

  const missingReport = verifyCodeBlocks(missingFeaturesHtml, { userPrompt: prompt });
  assert.equal(missingReport.passed, false);
  assert.ok(missingReport.issues.some((i) => i.message.includes('theme toggle')));
  assert.ok(missingReport.issues.some((i) => i.message.includes('cart')));
  assert.ok(missingReport.issues.some((i) => i.message.includes('form')));

  const completeFeaturesHtml = [
    '```html:index.html',
    '<!doctype html><html><head><title>Bean</title><style>body{margin:0;}</style></head>',
    '<body><button id="themeBtn">Theme</button><aside id="cartDrawer" class="drawer">Cart</aside><form id="contactForm"></form>',
    '<script>document.getElementById("themeBtn").onclick=()=>document.body.classList.toggle("dark");const cart=[];document.getElementById("contactForm").onsubmit=(e)=>e.preventDefault();</script>',
    '</body></html>',
    '```',
  ].join('\n');

  const satisfiedReport = verifyCodeBlocks(completeFeaturesHtml, { userPrompt: prompt });
  assert.equal(satisfiedReport.passed, true);
});





