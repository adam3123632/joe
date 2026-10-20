import test from 'node:test';
import assert from 'node:assert/strict';
import { createShareUrl, parseShareHash, MAX_SHARE_URL_LENGTH } from '../lib/share.ts';

test('share links round-trip Chinese, newlines and emoji without private local fields', async () => {
  const document = {title:'在书页之间 🌿', content:'你好，世界。\n\n第二段：Listen & read!'.repeat(30), id:'private-id', progress:0.7};
  const url = new URL(await createShareUrl(document, 'https://example.com/reader?private=query#old'));
  assert.equal(url.origin, 'https://example.com');
  assert.equal(url.pathname, '/reader');
  assert.equal(url.search, '');
  assert.deepEqual(await parseShareHash(url.hash), {title:document.title, content:document.content});
});

test('uncompressed fallback format also opens without compression support', async () => {
  const original = globalThis.CompressionStream;
  try {
    Object.defineProperty(globalThis, 'CompressionStream', {value:undefined, configurable:true, writable:true});
    const doc = {title:'短稿', content:'一小段文字。'};
    const url = new URL(await createShareUrl(doc, 'https://example.com/'));
    assert.match(url.hash, /^#read=u\./);
    assert.deepEqual(await parseShareHash(url.hash), doc);
  } finally {
    Object.defineProperty(globalThis, 'CompressionStream', {value:original, configurable:true, writable:true});
  }
});

test('unrelated hashes are ignored; damaged or schema-invalid payloads are rejected', async () => {
  assert.equal(await parseShareHash('#library'), null);
  for (const hash of ['#read=', '#read=g.***', '#read=x.abc', '#read=g.AA', '#read=u.' + btoa('{"title":"x","content":"","id":"not-allowed"}')]) {
    await assert.rejects(() => parseShareHash(hash));
  }
  await assert.rejects(() => parseShareHash('#read=u.' + 'A'.repeat(MAX_SHARE_URL_LENGTH)));
  await assert.rejects(() => createShareUrl({title:'x', content:'正文'}, 'javascript:alert(1)'));
});

test('oversized manuscripts and decompression bombs are rejected', async () => {
  await assert.rejects(() => createShareUrl({title:'超长', content:'文'.repeat(200_001)}, 'https://example.com/'));
  const bomb = await new Response(new Blob([' '.repeat(1_100_000)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const hash = '#read=g.' + Buffer.from(bomb).toString('base64url');
  await assert.rejects(() => parseShareHash(hash), /过大/);
});
