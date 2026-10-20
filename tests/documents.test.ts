import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, loadDocuments, saveDocuments, sampleDocuments, STORAGE_KEY, MAX_CONTENT_LENGTH } from '../lib/documents.ts';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STORAGE_KEY, initial);
  return {values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}};
}

test('first visit receives independent sample documents; intentionally empty libraries stay empty', () => {
  const first = loadDocuments(memoryStorage());
  assert.equal(first.documents.length, 3);
  assert.notEqual(first.documents[0], sampleDocuments[0]);
  assert.deepEqual(loadDocuments(memoryStorage('[]')), {documents: [], error: null});
});

test('document validation, generated title and persisted progress survive reload', () => {
  const storage = memoryStorage();
  const doc = createDocument('', '第一行标题\n你好，世界 🌏');
  assert.equal(doc.title, '第一行标题');
  doc.progress = 0.63;
  assert.equal(saveDocuments([doc], storage).ok, true);
  assert.deepEqual(loadDocuments(storage), {documents: [doc], error: null});
  assert.throws(() => createDocument('空稿', '   '));
  assert.throws(() => createDocument('长稿', '文'.repeat(MAX_CONTENT_LENGTH + 1)));
});

test('corrupt data is never overwritten during load and is backed up on explicit save', () => {
  const storage = memoryStorage('{unfinished');
  assert.match(loadDocuments(storage).error!, /无法读取/);
  assert.equal(storage.getItem(STORAGE_KEY), '{unfinished');
  const doc = createDocument('新稿', '新的文字');
  assert.equal(saveDocuments([doc], storage).ok, true);
  assert.equal([...storage.values.entries()].find(([key]) => key.includes('.recovery.'))?.[1], '{unfinished');
});

test('invalid records are reported while valid manuscripts remain readable', () => {
  const valid = createDocument('可读', '这段文字保留下来');
  const storage = memoryStorage(JSON.stringify([valid, {...valid, id:'bad', progress: 5}]));
  const result = loadDocuments(storage);
  assert.deepEqual(result.documents, [valid]);
  assert.ok(result.error);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)!).length, 2);
});

test('denied/quota-exhausted storage returns an actionable failure', () => {
  const storage = {getItem() {throw new Error('denied');}, setItem() {throw new Error('quota');}};
  assert.ok(loadDocuments(storage).error);
  assert.equal(saveDocuments([createDocument('稿件', '正文')], storage).ok, false);
  const old = memoryStorage('{broken');
  const backupDenied = {...old, setItem() {throw new Error('quota');}};
  assert.equal(saveDocuments([], backupDenied).ok, false);
  assert.equal(old.getItem(STORAGE_KEY), '{broken');
});
