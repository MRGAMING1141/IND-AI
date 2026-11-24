import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  formatBytes,
  stripAttachmentPayloadsForHistory,
  validateAttachmentCandidate,
} from './attachments.ts';

test('validateAttachmentCandidate accepts valid images, PDFs, and code files', () => {
  const img = validateAttachmentCandidate({
    name: 'mockup.png',
    mimeType: 'image/png',
    size: 512_000,
    existingCount: 0,
  });
  assert.equal(img.ok, true);
  if (img.ok) assert.equal(img.kind, 'image');

  const code = validateAttachmentCandidate({
    name: 'script.luau',
    mimeType: '',
    size: 12_000,
    existingCount: 1,
  });
  assert.equal(code.ok, true);
  if (code.ok) {
    assert.equal(code.kind, 'file');
    assert.equal(code.isPdf, false);
  }

  const pdf = validateAttachmentCandidate({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    size: 200_000,
    existingCount: 2,
  });
  assert.equal(pdf.ok, true);
  if (pdf.ok) assert.equal(pdf.isPdf, true);
});

test('validateAttachmentCandidate rejects oversized files, bad MIME types, and > max count', () => {
  const tooMany = validateAttachmentCandidate({
    name: 'a.png',
    mimeType: 'image/png',
    size: 100,
    existingCount: MAX_ATTACHMENTS_PER_MESSAGE,
  });
  assert.equal(tooMany.ok, false);

  const tooBig = validateAttachmentCandidate({
    name: 'huge.png',
    mimeType: 'image/png',
    size: MAX_IMAGE_BYTES + 1,
    existingCount: 0,
  });
  assert.equal(tooBig.ok, false);

  const badExt = validateAttachmentCandidate({
    name: 'malware.exe',
    mimeType: 'application/octet-stream',
    size: 1000,
    existingCount: 0,
  });
  assert.equal(badExt.ok, false);
});

test('stripAttachmentPayloadsForHistory removes base64/text payloads and formats bytes', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  const stripped = stripAttachmentPayloadsForHistory([
    {
      id: 'att_1',
      kind: 'image',
      name: 'ui.png',
      mimeType: 'image/png',
      size: 1234,
      dataBase64: 'AAAA',
      previewUrl: 'data:image/png;base64,AAAA',
    },
  ]);
  assert.ok(stripped);
  assert.equal(stripped.length, 1);
  assert.equal('dataBase64' in stripped[0], false);
  assert.equal('previewUrl' in stripped[0], false);
});
