export interface SpeechChunk {
  text: string;
  start: number;
  end: number;
}

/** Keep original UTF-16 offsets: browser speech boundary events use the same units. */
export function splitSpeechText(text: string, maxLength = 130): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const limit = Math.max(20, Math.floor(maxLength));
  let start = 0;
  let cursor = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    if (raw.trim()) chunks.push({text: raw.trim(), start: start + leading, end: end - trailing});
    start = end;
  };
  while (cursor < text.length) {
    const codePoint = text.codePointAt(cursor)!;
    const char = String.fromCodePoint(codePoint);
    cursor += char.length;
    if (/[。！？!?；;\n]/.test(char) || cursor - start >= limit) push(cursor);
  }
  if (start < text.length) push(text.length);
  return chunks;
}

export function normalizeSpeechOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, Number.isFinite(offset) ? Math.round(offset) : 0));
  // Never start a new utterance on the second half of a surrogate pair.
  if (value > 0 && value < text.length && /[\uDC00-\uDFFF]/.test(text[value])) value--;
  return value;
}

export function locateSpeechOffset(chunks: SpeechChunk[], offset: number): {index: number; offset: number} | null {
  for (let index = 0; index < chunks.length; index++) {
    if (offset < chunks[index].end) return {index, offset: Math.max(offset, chunks[index].start)};
  }
  return null;
}

/** A reading estimate, not a prerecorded audio duration. */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  const chinese = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  const punctuation = (text.match(/[。！？!?；;，,、：:\n]/g) || []).length;
  const seconds = chinese / 4.2 + words / 2.6 + punctuation * 0.2;
  return text.trim() ? Math.max(1, seconds / Math.max(0.5, rate)) : 0;
}

export interface NarrationSnapshot {
  documentId: string;
  isPlaying: boolean;
  isPaused: boolean;
  currentOffset: number;
  progress: number;
  durationSeconds: number;
  elapsedSeconds: number;
  rate: number;
  voiceId: string;
  error: string | null;
}

interface SynthesisPort {
  speaking: boolean;
  paused: boolean;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export const emptyNarrationSnapshot: NarrationSnapshot = {
  documentId: '',
  isPlaying: false, isPaused: false, currentOffset: 0, progress: 0,
  durationSeconds: 0, elapsedSeconds: 0, rate: 1, voiceId: '', error: null,
};

const errors: Record<string, string> = {
  'not-allowed': '浏览器暂不允许朗读，请点击播放按钮后重试。',
  'voice-unavailable': '所选声音暂不可用，请切换其他声音。',
  'language-unavailable': '设备尚未安装对应语言的朗读声音。',
  'synthesis-unavailable': '设备没有可用的朗读服务，请安装系统语音或换用其他浏览器。',
  'synthesis-failed': '朗读服务启动失败，请切换声音，或检查设备是否已安装中文语音。',
  'network': '当前声音需要网络连接，请检查网络或选择设备上的其他声音。',
  'audio-busy': '设备音频正在被占用，请稍后重试。',
  'audio-hardware': '设备音频不可用，请检查声音输出设置。',
  'text-too-long': '朗读服务无法处理这段文字，请重新播放。',
};

/** Small event-driven speech engine, independent of React for deterministic testing. */
export class NarrationController {
  private text = '';
  private documentId = '';
  private chunks: SpeechChunk[] = [];
  private state: NarrationSnapshot = {...emptyNarrationSnapshot};
  private generation = 0;
  private utterance: SpeechSynthesisUtterance | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private synthesis: SynthesisPort;
  private makeUtterance: (text: string) => SpeechSynthesisUtterance;
  private onChange: (snapshot: NarrationSnapshot) => void;

  constructor(
    synthesis: SynthesisPort,
    makeUtterance: (text: string) => SpeechSynthesisUtterance,
    onChange: (snapshot: NarrationSnapshot) => void,
  ) {
    this.synthesis = synthesis;
    this.makeUtterance = makeUtterance;
    this.onChange = onChange;
  }

  getSnapshot(): NarrationSnapshot { return {...this.state}; }

  private emit(update: Partial<NarrationSnapshot> = {}) {
    this.state = {...this.state, ...update, documentId: this.documentId};
    this.state.durationSeconds = estimateSpeechSeconds(this.text, this.state.rate);
    this.state.progress = this.text.length ? this.state.currentOffset / this.text.length : 0;
    this.state.elapsedSeconds = this.state.durationSeconds * this.state.progress;
    if (!this.disposed) this.onChange(this.getSnapshot());
  }

  private cancelCurrent() {
    this.generation++;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.utterance = null;
    this.synthesis.cancel();
  }

  setDocument(text: string, documentId: string) {
    if (this.text === text && this.documentId === documentId) return;
    this.cancelCurrent();
    this.text = text;
    this.documentId = documentId;
    this.chunks = splitSpeechText(text);
    this.emit({currentOffset: 0, isPlaying: false, isPaused: false, error: null});
  }

  private startAt(offset: number) {
    if (this.disposed) return;
    this.cancelCurrent();
    // Some engines retain a paused global state after cancel().
    if (this.synthesis.paused) this.synthesis.resume();
    const position = locateSpeechOffset(this.chunks, normalizeSpeechOffset(this.text, offset));
    if (!position) {
      this.emit({currentOffset: this.text.length, isPlaying: false, isPaused: false});
      return;
    }
    const token = this.generation;
    const chunk = this.chunks[position.index];
    const segmentOffset = position.offset;
    const spokenText = this.text.slice(segmentOffset, chunk.end);
    const utterance = this.makeUtterance(spokenText);
    this.utterance = utterance;
    utterance.lang = this.voice?.lang || 'zh-CN';
    utterance.rate = this.state.rate;
    utterance.voice = this.voice;
    const current = () => !this.disposed && token === this.generation;
    utterance.onboundary = event => {
      if (!current()) return;
      this.emit({currentOffset: Math.min(chunk.end, segmentOffset + Math.max(0, event.charIndex))});
    };
    utterance.onend = () => {
      if (!current()) return;
      this.utterance = null;
      if (this.state.isPaused) {
        this.emit({currentOffset: chunk.end});
        return;
      }
      this.startAt(chunk.end);
    };
    utterance.onerror = event => {
      if (!current()) return;
      this.utterance = null;
      this.emit({isPlaying: false, isPaused: false, error: errors[event.error] || '朗读已中断，请点击播放重新开始。'});
    };
    this.emit({currentOffset: segmentOffset, isPlaying: true, isPaused: false, error: null});
    try {
      this.synthesis.speak(utterance);
    } catch {
      if (current()) this.emit({isPlaying: false, isPaused: false, error: '无法启动朗读，请检查设备的语音设置。'});
    }
  }

  play() {
    if (!this.text.trim() || this.disposed || this.state.isPlaying) return;
    if (this.state.isPaused && this.utterance && this.synthesis.speaking) {
      const token = this.generation;
      this.synthesis.resume();
      this.emit({isPlaying: true, isPaused: false, error: null});
      this.resumeTimer = setTimeout(() => {
        if (token === this.generation && this.state.isPlaying && this.synthesis.paused) this.startAt(this.state.currentOffset);
      }, 250);
      return;
    }
    this.startAt(this.state.currentOffset >= this.text.length ? 0 : this.state.currentOffset);
  }

  pause() {
    if (!this.state.isPlaying || this.disposed) return;
    this.synthesis.pause();
    this.emit({isPlaying: false, isPaused: true});
  }

  toggle() { this.state.isPlaying ? this.pause() : this.play(); }

  seek(progress: number) {
    const offset = normalizeSpeechOffset(this.text, Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * this.text.length);
    const {isPlaying, isPaused} = this.state;
    if (isPlaying) this.startAt(offset);
    else {
      this.cancelCurrent();
      this.emit({currentOffset: offset, isPaused: isPaused && offset < this.text.length, error: null});
    }
  }

  setRate(rate: number) {
    if (!Number.isFinite(rate)) return;
    const value = Math.max(0.5, Math.min(2.5, rate));
    if (value === this.state.rate) return;
    const {isPlaying, currentOffset, isPaused} = this.state;
    this.emit({rate: value});
    if (isPlaying) this.startAt(currentOffset);
    else if (isPaused) { this.cancelCurrent(); this.emit({isPaused: true}); }
  }

  setVoice(voice: SpeechSynthesisVoice | null) {
    const nextId = voice?.voiceURI || '';
    if (nextId === this.state.voiceId) return;
    this.voice = voice;
    const {isPlaying, currentOffset, isPaused} = this.state;
    this.emit({voiceId: nextId});
    if (isPlaying) this.startAt(currentOffset);
    else if (isPaused) { this.cancelCurrent(); this.emit({isPaused: true}); }
  }

  stop() {
    this.cancelCurrent();
    this.emit({isPlaying: false, isPaused: false, currentOffset: 0, error: null});
  }

  dispose() {
    this.disposed = true;
    this.cancelCurrent();
  }
}
