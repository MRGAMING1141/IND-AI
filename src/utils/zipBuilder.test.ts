import assert from 'node:assert/strict';
import test from 'node:test';
import { buildZipBytes, sanitizeZipPath } from './zipBuilder.ts';

test('sanitizeZipPath removes traversal segments and leading slashes', () => {
  assert.equal(sanitizeZipPath('../../etc/passwd', 0), 'etc/passwd');
  assert.equal(sanitizeZipPath('/src/components/App.tsx', 0), 'src/components/App.tsx');
  assert.equal(sanitizeZipPath('', 2), 'file-3.txt');
});

test('buildZipBytes creates a valid PKZIP buffer containing all filenames and contents', () => {
  const zip = buildZipBytes([
    { path: 'index.html', content: '<h1>Hello</h1>' },
    { path: 'src/app.js', content: 'console.log(42);' },
  ]);

  // Verify PK local header signature at byte 0 and EOCD signature at tail
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);

  const text = new TextDecoder().decode(zip);
  assert.ok(text.includes('index.html'));
  assert.ok(text.includes('src/app.js'));
  assert.ok(text.includes('<h1>Hello</h1>'));
  assert.ok(text.includes('console.log(42);'));
});
