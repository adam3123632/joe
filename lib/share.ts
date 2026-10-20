import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from './documents.ts';

export interface SharedDocument {
  title: string;
  content: string;
}

export const MAX_SHARE_URL_LENGTH = 24_000;
const MAX_DECODED_BYTES = 1_000_000;

function validatePayload(value: unknown): SharedDocument {
  if (!value || typeof value !== 'object') throw new Error('分享内容格式不正确。');
  const doc = value as SharedDocument;
  if (Object.keys(doc).some(key => !['title', 'content'].includes(key))
    || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > MAX_TITLE_LENGTH
    || typeof doc.content !== 'string' || !doc.content.trim() || doc.content.length > MAX_CONTENT_LENGTH) {
    throw new Error('分享稿件无效或超出长度限制。');
  }
  return {title: doc.title, content: doc.content};
}

function encodeBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64url(encoded: string): Uint8Array {
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error('分享链接不完整或已损坏。');
  }
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('分享稿件过大，请拆分后重新分享。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** The link contains the complete manuscript. Recipients need no account or server storage. */
export async function createShareUrl(document: SharedDocument, baseUrl: string): Promise<string> {
  const payload = validatePayload({title: document.title, content: document.content});
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_DECODED_BYTES) throw new Error('稿件过长，请分篇分享。');
  let packed = bytes;
  let format = 'u';
  if (typeof CompressionStream !== 'undefined') {
    const compressed = await readLimited(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), MAX_DECODED_BYTES);
    if (compressed.length < bytes.length) {
      packed = compressed;
      format = 'g';
    }
  }
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请在网页中创建分享链接。');
  url.search = '';
  url.hash = `read=${format}.${encodeBase64url(packed)}`;
  if (url.href.length > MAX_SHARE_URL_LENGTH) {
    throw new Error('这篇稿件生成的链接较长，请分篇分享，或下载稿件后发送给朋友。');
  }
  return url.href;
}

export async function parseShareHash(hash: string): Promise<SharedDocument | null> {
  if (!hash.startsWith('#read=')) return null;
  if (hash.length > MAX_SHARE_URL_LENGTH) throw new Error('分享链接过长或已损坏。');
  try {
    const packed = hash.slice('#read='.length);
    const match = /^([gu])\.([A-Za-z0-9_-]+)$/.exec(packed);
    if (!match) throw new Error('分享链接格式不正确。');
    const bytes = decodeBase64url(match[2]);
    let unpacked = bytes;
    if (match[1] === 'g') {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('此浏览器暂不支持压缩分享链接，请使用新版 Chrome、Edge 或 Safari 打开。');
      }
      unpacked = await readLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_DECODED_BYTES);
    }
    if (unpacked.length > MAX_DECODED_BYTES) throw new Error('分享稿件过大。');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(unpacked);
    return validatePayload(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error && /分享|浏览器/.test(error.message)) throw error;
    throw new Error('无法读取分享链接，链接可能不完整或已经损坏。');
  }
}
