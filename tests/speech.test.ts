import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateSpeechSeconds, locateSpeechOffset, NarrationController, normalizeSpeechOffset, splitSpeechText} from '../lib/speech.ts';

class FakeSynthesis {
  speaking = false;
  paused = false;
  utterances: SpeechSynthesisUtterance[] = [];
  speak(utterance: SpeechSynthesisUtterance) { this.utterances.push(utterance); this.speaking = true; }
  cancel() { this.speaking = false; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
}

function fixture(text = '第一句。第二句！第三句。') {
  const synthesis = new FakeSynthesis();
  const controller = new NarrationController(synthesis, text => ({text} as SpeechSynthesisUtterance), () => {});
  controller.setDocument(text, 'test');
  return {synthesis, controller, utterance: () => synthesis.utterances.at(-1)!};
}

test('Chinese sentences and whitespace retain original offsets', () => {
  const text = '  第一段。\n 第二段！  最后一句';
  const chunks = splitSpeechText(text);
  assert.deepEqual(chunks.map(chunk => chunk.text), ['第一段。', '第二段！', '最后一句']);
  for (const chunk of chunks) assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
  assert.deepEqual(locateSpeechOffset(chunks, 6), {index: 1, offset: 8});
  assert.equal(locateSpeechOffset(chunks, text.length), null);
});

test('long blocks are bounded and emoji are not split in half', () => {
  const text = '甲'.repeat(19) + '😀' + '乙'.repeat(30);
  const chunks = splitSpeechText(text, 20);
  assert.equal(chunks.map(chunk => chunk.text).join(''), text);
  assert.equal(chunks.some(chunk => /^[\uDC00-\uDFFF]/.test(chunk.text)), false);
  assert.equal(normalizeSpeechOffset(text, 20), 19);
});

test('rate affects estimated duration, empty text has no duration', () => {
  assert.equal(estimateSpeechSeconds('  '), 0);
  assert.equal(estimateSpeechSeconds('慢慢读完这段文字。', 2), estimateSpeechSeconds('慢慢读完这段文字。', 1) / 2);
});

test('actual boundary and end events advance across the document', () => {
  const {controller, synthesis, utterance} = fixture();
  controller.play();
  assert.equal(utterance().text, '第一句。');
  utterance().onboundary!({charIndex: 2} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset, 2);
  utterance().onend!({} as SpeechSynthesisEvent);
  assert.equal(utterance().text, '第二句！');
  utterance().onend!({} as SpeechSynthesisEvent);
  assert.equal(utterance().text, '第三句。');
  utterance().onend!({} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().progress, 1);
  assert.equal(controller.getSnapshot().isPlaying, false);
  assert.equal(synthesis.utterances.length, 3);
});

test('pause/resume uses native engine and seek preserves paused position', () => {
  const {controller, synthesis, utterance} = fixture();
  controller.play();
  controller.pause();
  assert.equal(controller.getSnapshot().isPaused, true);
  controller.play();
  assert.equal(synthesis.paused, false);
  assert.equal(synthesis.utterances.length, 1);
  controller.pause();
  controller.seek(0.5);
  assert.equal(controller.getSnapshot().currentOffset, 6);
  assert.equal(controller.getSnapshot().isPaused, true);
  controller.play();
  assert.equal(utterance().text, '句！');
  controller.dispose();
});

test('seek and speed changes restart at the current offset and ignore canceled events', () => {
  const {controller, synthesis, utterance} = fixture();
  controller.play();
  const original = utterance();
  original.onboundary!({charIndex: 1} as SpeechSynthesisEvent);
  controller.setRate(1.5);
  assert.equal(utterance().rate, 1.5);
  assert.equal(utterance().text, '一句。');
  original.onend!({} as SpeechSynthesisEvent);
  original.onerror!({error: 'interrupted'} as SpeechSynthesisErrorEvent);
  assert.equal(synthesis.utterances.length, 2);
  assert.equal(controller.getSnapshot().error, null);
  controller.seek(2 / 3);
  assert.equal(utterance().text, '第三句。');
});

test('voice changes are applied and errors stop playback with a useful message', () => {
  const {controller, utterance} = fixture();
  controller.setVoice({voiceURI: 'Chinese', lang: 'zh-CN'} as SpeechSynthesisVoice);
  controller.play();
  assert.equal(utterance().voice?.voiceURI, 'Chinese');
  utterance().onerror!({error: 'synthesis-unavailable'} as SpeechSynthesisErrorEvent);
  assert.equal(controller.getSnapshot().isPlaying, false);
  assert.match(controller.getSnapshot().error!, /朗读服务/);
});

test('switching document cancels old callbacks and returns progress to start', () => {
  const {controller, utterance} = fixture();
  controller.play();
  const previous = utterance();
  controller.setDocument('新的内容。', 'new');
  previous.onboundary!({charIndex: 3} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().currentOffset, 0);
  assert.equal(controller.getSnapshot().documentId, 'new');
  assert.equal(controller.getSnapshot().isPlaying, false);
  controller.play();
  assert.equal(utterance().text, '新的内容。');
});

test('progress snapshots always identify the document they belong to', () => {
  const {controller, utterance} = fixture();
  assert.equal(controller.getSnapshot().documentId, 'test');
  controller.play();
  const previous = utterance();
  controller.setDocument('替换后的内容。', 'replacement');
  controller.seek(0.5);
  previous.onend!({} as SpeechSynthesisEvent);
  assert.equal(controller.getSnapshot().documentId, 'replacement');
  assert.ok(controller.getSnapshot().progress > 0);
  controller.stop();
  assert.equal(controller.getSnapshot().documentId, 'replacement');
});
