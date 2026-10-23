import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedSpeechPort} from '../chat-reader/speech-port.ts';
import {NarrationController, type SpeechScheduler} from '../lib/speech.ts';

class FakeSynthesis {
  speaking = false;
  paused = false;
  cancelCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  utterances: SpeechSynthesisUtterance[] = [];
  onSpeak: ((utterance: SpeechSynthesisUtterance) => void) | null = null;
  onCancel: (() => void) | null = null;
  speak(utterance: SpeechSynthesisUtterance) {
    this.utterances.push(utterance);this.speaking = true;this.onSpeak?.(utterance);
  }
  cancel() {this.cancelCount++;this.speaking = false;this.onCancel?.();}
  pause() {this.pauseCount++;this.paused = true;}
  resume() {this.resumeCount++;this.paused = false;}
}

class FakeScheduler implements SpeechScheduler {
  clock = 0;
  serial = 0;
  jobs = new Map<number, {callback: () => void; due: number}>();
  now = () => this.clock;
  setTimeout(callback: () => void, delay: number) {
    const id = ++this.serial;this.jobs.set(id, {callback, due: this.clock + delay});return id;
  }
  clearTimeout(id: unknown) {this.jobs.delete(id as number);}
  advance(milliseconds: number) {
    const until = this.clock + milliseconds;
    while (true) {
      const next = Array.from(this.jobs.entries()).filter(([,job]) => job.due <= until).sort((a,b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.jobs.delete(next[0]);this.clock = next[1].due;next[1].callback();
    }
    this.clock = until;
  }
}

const utterance = (text = '测试正文') => ({text, onend: null, onerror: null} as SpeechSynthesisUtterance);
const endEvent = () => ({charIndex: 0} as SpeechSynthesisEvent);
const errorEvent = () => ({error: 'synthesis-failed'} as SpeechSynthesisErrorEvent);

function fixture(text = '第一句。第二句。') {
  const synthesis = new FakeSynthesis(), scheduler = new FakeScheduler();
  const port = createOwnedSpeechPort(synthesis);
  const controller = new NarrationController(port, utterance, () => {}, scheduler);
  controller.setDocument(text, 'chat-message');
  const current = () => synthesis.utterances.at(-1)!;
  const end = () => {synthesis.speaking = false;const value = current();value.onend!.call(value, endEvent());};
  return {synthesis, scheduler, port, controller, current, end};
}

test('idle port hides external speech and never cancels, pauses or resumes it', () => {
  const synthesis = new FakeSynthesis();synthesis.speaking = true;synthesis.paused = true;
  const port = createOwnedSpeechPort(synthesis);
  assert.equal(port.ownsSpeech, false);assert.equal(port.speaking, false);assert.equal(port.paused, false);
  port.cancel();port.pause();port.resume();
  assert.deepEqual([synthesis.cancelCount, synthesis.pauseCount, synthesis.resumeCount], [0, 0, 0]);
  assert.equal(synthesis.speaking, true);assert.equal(synthesis.paused, true);
});

test('unplayed controller selection, seeking, preferences, stop and disposal leave external speech untouched', () => {
  const {synthesis, port, controller} = fixture();
  synthesis.speaking = true;synthesis.paused = true;
  controller.setDocument('另一条回答。', 'another-message');controller.seek(0.4);
  controller.setRate(1.5);controller.setVolume(0.3);
  controller.setVoice({voiceURI:'zh-CN', lang:'zh-CN'} as SpeechSynthesisVoice);
  controller.stop();controller.dispose();
  assert.equal(port.ownsSpeech, false);
  assert.deepEqual([synthesis.cancelCount, synthesis.pauseCount, synthesis.resumeCount], [0, 0, 0]);
  assert.equal(synthesis.speaking, true);assert.equal(synthesis.paused, true);
});

test('owned speech reports native state and only performs necessary pause/resume/cancel operations', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis);
  port.speak(utterance());assert.equal(port.ownsSpeech, true);assert.equal(port.speaking, true);
  port.resume();assert.equal(synthesis.resumeCount, 0);
  port.pause();port.pause();assert.equal(port.paused, true);assert.equal(synthesis.pauseCount, 1);
  port.resume();port.resume();assert.equal(port.paused, false);assert.equal(synthesis.resumeCount, 1);
  port.cancel();port.cancel();assert.equal(synthesis.cancelCount, 1);
  assert.equal(port.ownsSpeech, false);assert.equal(port.speaking, false);
});

test('a queued owned utterance can pause before the synthesizer reports speaking', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis);
  port.speak(utterance());synthesis.speaking = false;
  port.pause();assert.equal(synthesis.pauseCount, 1);assert.equal(port.paused, true);
});

test('end/error release matching ownership before invoking the original handler with its receiver and event', () => {
  for (const kind of ['end', 'error'] as const) {
    const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis), value = utterance();
    const event = kind === 'end' ? endEvent() : errorEvent();
    let calls = 0;
    const handler = function(this: SpeechSynthesisUtterance, received: Event) {
      calls++;assert.equal(this, value);assert.equal(received, event);assert.equal(port.ownsSpeech, false);
    };
    if (kind === 'end') value.onend = handler;else value.onerror = handler;
    port.speak(value);
    if (kind === 'end') value.onend!.call(value, event as SpeechSynthesisEvent);
    else value.onerror!.call(value, event as SpeechSynthesisErrorEvent);
    assert.equal(calls, 1);assert.equal(port.ownsSpeech, false);
    synthesis.speaking = true;synthesis.paused = true;port.cancel();port.pause();port.resume();
    assert.deepEqual([synthesis.cancelCount, synthesis.pauseCount, synthesis.resumeCount], [0, 0, 0]);
  }
});

test('cancel releases ownership before a synchronous native end callback reenters cancel', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis), value = utterance();
  let ownershipInCallback = true;
  value.onend = () => {ownershipInCallback = port.ownsSpeech;port.cancel();};
  port.speak(value);
  synthesis.onCancel = () => value.onend!.call(value, endEvent());
  port.cancel();
  assert.equal(ownershipInCallback, false);assert.equal(synthesis.cancelCount, 1);
});

test('late end/error from an old utterance cannot release newer ownership', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis);
  const first = utterance('旧'), second = utterance('新');
  port.speak(first);const lateEnd = first.onend!, lateError = first.onerror!;
  port.cancel();port.speak(second);
  lateEnd.call(first, endEvent());lateError.call(first, errorEvent());
  assert.equal(port.ownsSpeech, true);assert.equal(port.speaking, true);
  port.pause();assert.equal(synthesis.pauseCount, 1);
  second.onend!.call(second, endEvent());assert.equal(port.ownsSpeech, false);
});

test('reusing an utterance still creates a new ownership session', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis), value = utterance();
  port.speak(value);const oldEnd = value.onend!;
  port.cancel();port.speak(value);oldEnd.call(value, endEvent());
  assert.equal(port.ownsSpeech, true);
  value.onend!.call(value, endEvent());assert.equal(port.ownsSpeech, false);
});

test('native speak exceptions are rethrown and clear ownership without a global cancel', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis), failure = new Error('blocked');
  synthesis.onSpeak = () => {throw failure;};
  assert.throws(() => port.speak(utterance()), error => error === failure);
  assert.equal(port.ownsSpeech, false);port.cancel();assert.equal(synthesis.cancelCount, 0);
});

test('an exception from an older reentrant speak does not clear newer speech', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis);
  const first = utterance('旧'), second = utterance('新'), failure = new Error('older speak failed');
  synthesis.onSpeak = value => {if (value === first) {port.speak(second);throw failure;}};
  assert.throws(() => port.speak(first), error => error === failure);
  assert.equal(port.ownsSpeech, true);port.cancel();assert.equal(synthesis.cancelCount, 1);
});

test('controller own play, pause, resume, seek and stop operate on owned speech', () => {
  const {synthesis, controller, port} = fixture();
  controller.play();assert.equal(port.ownsSpeech, true);assert.equal(synthesis.cancelCount, 0);
  controller.pause();assert.equal(synthesis.pauseCount, 1);
  controller.play();assert.equal(synthesis.resumeCount, 1);
  controller.seek(0.6);assert.equal(synthesis.cancelCount, 1);assert.equal(port.ownsSpeech, true);
  controller.stop();assert.equal(synthesis.cancelCount, 2);assert.equal(port.ownsSpeech, false);
  controller.dispose();assert.equal(synthesis.cancelCount, 2);
});

for (const action of ['seek', 'stop', 'settings'] as const) {
  test(`own pause then ${action} then play recovers engines whose cancel preserves paused state`, () => {
    const {synthesis, controller, port} = fixture();
    controller.play();controller.pause();assert.equal(synthesis.paused, true);
    if (action === 'seek') controller.seek(0.6);
    if (action === 'stop') controller.stop();
    if (action === 'settings') {controller.setRate(1.5);controller.setVolume(0.4);}
    assert.equal(port.ownsSpeech, false);assert.equal(port.paused, false);
    assert.equal(synthesis.resumeCount, 0);
    controller.play();
    assert.equal(port.ownsSpeech, true);assert.equal(synthesis.paused, false);
    assert.equal(synthesis.resumeCount, 1);assert.equal(synthesis.utterances.length, 2);
  });
}

test('external paused state is not resumed when it was not initiated by the reader', () => {
  const synthesis = new FakeSynthesis(), port = createOwnedSpeechPort(synthesis);
  synthesis.paused = true;synthesis.speaking = true;
  port.speak(utterance());assert.equal(synthesis.resumeCount, 0);
  assert.equal(synthesis.paused, true);
});

test('natural controller gaps release ownership; gap settings/stop do not disturb later external speech', () => {
  const {synthesis, controller, port, end, scheduler} = fixture();
  controller.play();end();assert.equal(port.ownsSpeech, false);
  synthesis.speaking = true;synthesis.paused = true;
  controller.pause();controller.setRate(2);controller.setVolume(0.5);controller.stop();controller.dispose();
  scheduler.advance(1000);
  assert.deepEqual([synthesis.cancelCount, synthesis.pauseCount, synthesis.resumeCount], [0, 0, 0]);
  assert.equal(synthesis.utterances.length, 1);assert.equal(synthesis.speaking, true);assert.equal(synthesis.paused, true);
});

test('natural completion stays at 100% and later external speech survives idle controller actions', () => {
  const {synthesis, controller, port, end, scheduler} = fixture();
  controller.play();end();scheduler.advance(100);assert.equal(port.ownsSpeech, true);end();
  assert.equal(controller.getSnapshot().progress, 1);assert.equal(port.ownsSpeech, false);
  synthesis.speaking = true;controller.seek(0);controller.setRate(1.25);controller.dispose();
  assert.equal(synthesis.cancelCount, 0);assert.equal(synthesis.speaking, true);
});

test('controller speech errors release ownership before its error cleanup', () => {
  const {synthesis, controller, port, current} = fixture();controller.play();
  const value = current();value.onerror!.call(value, errorEvent());
  assert.equal(port.ownsSpeech, false);assert.equal(synthesis.cancelCount, 0);
  assert.equal(controller.getSnapshot().isPlaying, false);assert.match(controller.getSnapshot().error!, /朗读服务/);
});
