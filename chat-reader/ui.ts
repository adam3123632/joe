export interface PanelMessage {
  id: string;
  title: string;
  charCount: number;
  collapsed: boolean;
  isStreaming: boolean;
}

export interface PanelSection {
  messageId: string;
  title: string;
  offset: number;
  level: number;
}

export interface PanelVoice {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface PanelState {
  messages: PanelMessage[];
  sections?: PanelSection[];
  selectedId: string;
  activeTitle: string;
  supported: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  progress: number;
  rate: number;
  volume: number;
  voices: PanelVoice[];
  voiceId: string;
  error: string | null;
  autoCollapse: boolean;
  follow: boolean;
  notice: string | null;
  /** One-based paragraph number; zero means reading has not started. */
  currentParagraph: number;
  totalParagraphs: number;
}

export interface PanelActions {
  onSelect(id: string): void;
  onJumpSection(messageId: string, offset: number): void;
  onTogglePlay(): void;
  onPreviousParagraph(): void;
  onNextParagraph(): void;
  onStop(): void;
  onSeek(progress: number): void;
  onRate(rate: number): void;
  onVolume(volume: number): void;
  onVoice(id: string): void;
  onAutoCollapse(enabled: boolean): void;
  onFollow(enabled: boolean): void;
  onExpandAll(): void;
  onCollapseAll(): void;
  onRefresh(): void;
  onPickMessage?(): void;
  onClose?(): void;
}

export interface PanelView {
  update(state: PanelState): void;
  destroy(): void;
  setOpen(open: boolean): void;
}

const CSS = `
:host{all:initial;position:fixed;right:22px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:2147483646;display:block;width:360px;max-width:calc(100vw - 32px);pointer-events:none;color-scheme:light;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#354034}
*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button,input,select{-webkit-tap-highlight-color:transparent}button:disabled,input:disabled,select:disabled{cursor:not-allowed;opacity:.45}button{transition:background .15s,color .15s,border-color .15s}button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:3px solid #ce805d80;outline-offset:3px}button{color:inherit}button svg{pointer-events:none;flex-shrink:0}svg{display:block;width:18px;height:18px;flex-shrink:0}[hidden]{display:none!important}
.panel{pointer-events:auto;display:flex;flex-direction:column;max-height:75vh;max-height:min(75vh,740px);max-height:min(75dvh,740px);border:1px solid #e7e5da;border-radius:18px;background:#fffef9;box-shadow:0 15px 60px #17251627,0 3px 12px #26322612;overflow:hidden;isolation:isolate}
.directory-actions{display:flex;align-items:center;gap:4px}.pick-message{display:flex;align-items:center;justify-content:center;min-height:44px;padding:7px 9px;border:1px solid #e1e5d6;border-radius:8px;background:#f7f8ef;color:#869774;font-size:11px;white-space:nowrap}.pick-message:hover:not(:disabled){background:#f7eee3;color:#a16e48;border-color:#e1c9ae}
.panel:focus{outline:none}.header{display:flex;align-items:center;gap:10px;padding:16px 16px 12px;border-bottom:1px solid #eeede4;background:#f8f7ef;flex-shrink:0}.mark{width:35px;height:35px;display:grid;place-items:center;border-radius:11px;background:#ce704f;color:#fff8ed}.mark svg{width:21px;height:21px}.brand{min-width:0;flex:1}.brand h2{font-size:15px;font-weight:650;letter-spacing:.5px;line-height:1.5;margin:0;color:#4c5944}.brand p{font-size:10px;color:#99a188;letter-spacing:1.2px;margin:2px 0 0}.icon-button{display:grid;place-items:center;width:44px;height:44px;min-width:44px;border:0;border-radius:10px;background:transparent;color:#91a07f;padding:0}.icon-button:hover:not(:disabled){color:#aa6e48;background:#eeeade}.header .icon-button{width:36px;min-width:36px;height:40px}.body{padding:0 16px 16px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ced5bf transparent}.body::-webkit-scrollbar{width:4px}.body::-webkit-scrollbar-thumb{background:#ced5bf;border-radius:4px}.block{padding-top:17px}.block+.block{border-top:1px solid #eeeee4;margin-top:15px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.section-heading h3{font-size:12px;font-weight:600;letter-spacing:.3px;color:#7b8a67;margin:0}.section-heading h3 span{font-size:10px;font-weight:400;margin-left:7px;color:#a2ac92}.section-heading .icon-button{width:36px;min-width:36px;height:36px}.directory,.chapters{padding:0;margin:0;list-style:none;max-height:220px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#d6dccb transparent}.directory li+li{margin-top:5px}.toc-button{width:100%;display:flex;gap:9px;align-items:flex-start;text-align:left;border:1px solid transparent;background:transparent;border-radius:9px;min-height:54px;padding:9px;color:#7c8870}.toc-button:hover{background:#f6f5eb;border-color:#e9e8dc}.toc-button.is-selected{background:#f8eee3;border-color:#ead6c1;color:#94643d}.toc-number{width:20px;min-width:20px;margin-top:1px;font-size:10px;color:#a4af95;font-variant-numeric:tabular-nums}.toc-text{min-width:0;flex:1}.toc-title{display:block;font-size:12px;line-height:1.7;color:inherit;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.toc-meta{display:flex;gap:7px;align-items:center;color:#a7b198;font-size:10px;line-height:1.6;margin-top:2px}.stream{color:#af865c}.empty{padding:18px 14px;text-align:center;font-size:11px;line-height:1.9;background:#f7f7ef;border:1px dashed #e0e5d5;border-radius:9px;color:#a0ac90}.chapters{max-height:180px}.chapter-button{display:block;width:100%;text-align:left;border:0;border-left:2px solid #e4e8db;border-radius:0 6px 6px 0;background:transparent;color:#8d9b7c;font-size:11px;line-height:1.7;padding:10px 10px 10px calc(10px + var(--indent,0)*11px);min-height:44px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.chapter-button:hover{background:#f4f5eb;color:#a7754b;border-color:#c49b70}.track{padding:12px;border:1px solid #e8e9dd;background:#f6f7ee;border-radius:10px;margin-bottom:11px}.track-label{display:flex;align-items:center;gap:6px;font-size:10px;color:#97a387;margin-bottom:5px}.track-label svg{width:13px;height:13px}.track-title{font-size:13px;line-height:1.7;color:#627354;font-weight:550;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track-status{font-size:10px;color:#a1ad90;margin-top:4px;font-variant-numeric:tabular-nums}.progress-heading,.field-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#899875;font-size:11px}.progress-heading label,.field-heading label{cursor:pointer}.value{color:#b07953;font-size:11px;font-variant-numeric:tabular-nums}.range{appearance:none;-webkit-appearance:none;display:block;min-width:0;width:100%;height:44px;border:0;border-radius:6px;margin:0;padding:0;background:linear-gradient(to right,#cc7652 var(--fill,0%),#e4e8d8 var(--fill,0%)) center/100% 4px no-repeat;accent-color:#cc7652;cursor:pointer;touch-action:manipulation}.range::-webkit-slider-runnable-track{height:4px;background:transparent;border:0;border-radius:4px}.range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:16px;height:16px;border:3px solid #fffef9;border-radius:50%;background:#cc7652;box-shadow:0 0 0 1px #d79c7c;margin-top:-6px}.range::-moz-range-track{height:4px;background:transparent;border:0}.range::-moz-range-thumb{box-sizing:border-box;width:16px;height:16px;border:3px solid #fffef9;border-radius:50%;background:#cc7652;box-shadow:0 0 0 1px #d79c7c}.play-actions{display:flex;gap:8px;margin:2px 0 16px}.play-button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;flex:1;border:1px solid #c96a48;border-radius:9px;background:#ce704f;color:#fff8ee;font-size:12px;font-weight:550}.play-button:hover:not(:disabled){background:#b85e3e}.play-button svg{width:17px;height:17px}.stop-button{border:1px solid #e2e7d7;border-radius:9px;background:#f4f6eb;color:#91a07e}.stop-button:hover:not(:disabled){background:#eaf0dd}.volume-row{display:flex;align-items:center;gap:8px}.mute{background:#f6f6ed;border:1px solid #e6e9db;border-radius:8px}.mute[aria-pressed="true"]{color:#bb7952;background:#faf0e5;border-color:#e5cbb4}.volume-row .range{flex:1}.settings-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:10px}.select-row{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#899875;font-size:11px}.select-row>label{flex-shrink:0}.select{display:block;width:100%;min-width:0;min-height:44px;border:1px solid #e0e7d3;border-radius:8px;padding:9px 25px 9px 10px;background:#fafbf5;color:#768a61;font-size:11px;text-overflow:ellipsis}.rate-select{width:145px}.voice-row{display:block}.voice-row>label{display:block;margin-bottom:8px}.toggle{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:10px 0;cursor:pointer;min-height:49px}.toggle+.toggle{border-top:1px solid #eeeee4}.toggle-text{min-width:0}.toggle strong{display:block;font-size:11px;font-weight:500;color:#7c8d68;line-height:1.6}.toggle small{display:block;font-size:10px;color:#a3ae93;line-height:1.7;margin-top:2px}.switch{appearance:none;-webkit-appearance:none;flex-shrink:0;width:34px;height:20px;position:relative;border:1px solid #dce2d1;border-radius:20px;background:#e5e9dc;cursor:pointer;margin:0;transition:background .15s}.switch::before{content:"";display:block;position:absolute;width:14px;height:14px;background:#fffef9;border-radius:50%;left:2px;top:2px;box-shadow:0 1px 3px #5e724521;transition:transform .15s}.switch:checked{background:#a3b58a;border-color:#96a77d}.switch:checked::before{transform:translateX(14px)}.bulk-actions{display:flex;gap:8px;margin-top:11px}.small-button{flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #e1e7d4;border-radius:8px;color:#859673;background:#fbfcf5;font-size:11px}.small-button svg{width:14px;height:14px}.small-button:hover:not(:disabled){background:#eef2e4;color:#6e8359}.notice,.error{font-size:11px;line-height:1.85;padding:10px 11px;border-radius:8px;margin:12px 0 0;overflow-wrap:anywhere}.notice{color:#8b976f;background:#f1f5e8;border:1px solid #e0e8d2}.error{color:#ad7252;background:#fcf0e5;border:1px solid #edd9c4}.hint{display:flex;gap:6px;align-items:flex-start;font-size:10px;color:#a7af9a;line-height:1.85;margin:14px 0 0}.hint svg{width:12px;height:12px;margin-top:3px}.launcher{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;margin:11px 0 0 auto;padding:0 17px;border:1px solid #d9ddce;border-radius:24px;background:#fffef9;color:#859470;box-shadow:0 4px 20px #26362318;font-size:12px;font-weight:550;letter-spacing:.2px}.launcher svg{width:18px;height:18px}.launcher:hover{background:#f7f5e9;color:#aa6e48;border-color:#d3b693}.launcher[aria-expanded="true"]{background:#eeeedd;color:#8d916c}.launcher.is-playing{border-color:#d5b99c;color:#b57b51}.launcher .playing-dot{width:5px;height:5px;border-radius:50%;background:#cb8660;box-shadow:0 0 0 3px #f5e9d8}
@media(max-width:480px){:host{right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));width:calc(100vw - 24px);max-width:none}.panel{max-height:72vh;max-height:72dvh;border-radius:17px}.header{padding:12px 14px 10px}.body{padding:0 14px 14px}.header .icon-button{width:44px;height:44px;min-width:44px}.brand h2{font-size:14px}.brand p{font-size:9px}.launcher{min-height:46px;font-size:12px}.directory{max-height:180px}.chapters{max-height:160px}.toggle strong,.field-heading,.progress-heading,.select-row{font-size:12px}.toggle small{font-size:11px}.hint{font-size:10px}}
@media(max-width:350px){.brand p{letter-spacing:.5px}.header{gap:8px}.mark{width:31px;height:33px}.brand h2{font-size:13px}.body{padding-left:12px;padding-right:12px}.rate-select{width:120px}.launcher{padding:0 14px}.toc-button{padding:8px}.toc-title{font-size:12px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;scroll-behavior:auto!important}}
`;

type IconName = 'headphones' | 'close' | 'refresh' | 'play' | 'pause' | 'stop' | 'previous' | 'next' | 'volume' | 'muted' | 'expand' | 'collapse' | 'info';
const PATHS: Record<IconName, string> = {
  headphones: 'M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v7h5v-7H4Zm16 0h1v7h-5v-7h4Z',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
  play: 'm9 5 11 7-11 7V5Z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6Z',
  previous: 'm16 5-9 7 9 7V5ZM4 5v14',
  next: 'm8 5 9 7-9 7V5Zm12 0v14',
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm13-2a7 7 0 0 1 0 10m-2-7a3 3 0 0 1 0 4',
  muted: 'M4 9v6h4l5 4V5L8 9H4Zm13 0 5 6m0-6-5 6',
  expand: 'm8 7 4-4 4 4m-8 10 4 4 4-4M5 12h14',
  collapse: 'm8 3 4 4 4-4m-8 18 4-4 4 4M5 12h14',
  info: 'M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'pause' ? '3.5' : '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  if (name === 'play' || name === 'stop') path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

function button(label: string, className: string, onClick: () => void, iconName?: IconName): HTMLButtonElement {
  const node = make('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  if (iconName) node.append(icon(iconName));
  node.addEventListener('click', onClick);
  return node;
}

function labelFor(text: string, id: string): HTMLLabelElement {
  const label = make('label', '', text);
  label.htmlFor = id;
  return label;
}

function setText(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function mountPanel(actions: PanelActions): PanelView {
  const host = make('div');
  host.id = 'tingjian-chat-reader-ui';
  host.dataset.tingjianUi = 'true';
  host.dataset.tingjianRoot = 'true';
  const shadow = host.attachShadow({mode: 'open'});
  const style = make('style');
  style.textContent = CSS;
  shadow.append(style);
  const panel = make('section', 'panel');
  panel.id = 'tingjian-panel';
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'tingjian-panel-title');
  const header = make('header', 'header');
  const mark = make('span', 'mark');
  mark.append(icon('headphones'));
  const brand = make('div', 'brand');
  const title = make('h2', '', '听笺 · 聊天阅读助手');
  title.id = 'tingjian-panel-title';
  brand.append(title, make('p', '', '在当前对话里，慢慢听、轻轻读'));
  const close = button('收起阅读面板', 'icon-button', () => setOpen(false), 'close');
  close.dataset.action = 'close';
  header.append(mark, brand, close);
  const body = make('div', 'body');
  panel.append(header, body);

  const directoryBlock = make('section', 'block');
  const directoryHeading = make('div', 'section-heading');
  const directoryTitle = make('h3', '', '对话目录');
  const messageCount = make('span', '', '0 条');
  directoryTitle.append(messageCount);
  const refresh = button('刷新扫描对话', 'icon-button', () => actions.onRefresh(), 'refresh');
  refresh.dataset.action = 'refresh';
  const directoryActions = make('div', 'directory-actions');
  const pickMessage = button('点选页面回答', 'pick-message', () => actions.onPickMessage?.());
  pickMessage.dataset.action = 'pick-message';
  pickMessage.append(make('span', '', '点选页面回答'));
  pickMessage.disabled = !actions.onPickMessage;
  directoryActions.append(pickMessage, refresh);
  directoryHeading.append(directoryTitle, directoryActions);
  const directory = make('ol', 'directory');
  directory.setAttribute('aria-label', 'ChatGPT 回复目录');
  const empty = make('p', 'empty', '没有识别到回答。可点右上角刷新，或使用「点选页面回答」再点击原文。');
  directoryBlock.append(directoryHeading, directory, empty);
  body.append(directoryBlock);

  const chapterBlock = make('section', 'block');
  chapterBlock.hidden = true;
  const chapterHeading = make('div', 'section-heading');
  chapterHeading.append(make('h3', '', '本篇章节'));
  const chapters = make('ol', 'chapters');
  chapters.setAttribute('aria-label', '当前回复的章节目录');
  chapterBlock.append(chapterHeading, chapters);
  body.append(chapterBlock);

  const player = make('section', 'block');
  const playerHeading = make('div', 'section-heading');
  playerHeading.append(make('h3', '', '文字朗读'));
  const track = make('div', 'track');
  const trackLabel = make('div', 'track-label');
  trackLabel.append(icon('headphones'), make('span', '', '当前选中'));
  const trackTitle = make('p', 'track-title', '从目录选择一条回复');
  const trackStatus = make('div', 'track-status', '随时开始');
  track.append(trackLabel, trackTitle, trackStatus);
  const progressHeading = make('div', 'progress-heading');
  const progressValue = make('span', 'value', '0%');
  progressHeading.append(labelFor('朗读进度', 'tingjian-progress'), progressValue);
  const progress = make('input', 'range');
  progress.id = 'tingjian-progress';
  progress.dataset.action = 'seek';
  progress.type = 'range';
  progress.min = '0';
  progress.max = '1000';
  progress.step = '1';
  progress.value = '0';
  progress.setAttribute('aria-label', '朗读进度');
  const playActions = make('div', 'play-actions');
  const previous = button('上一段', 'icon-button stop-button', () => actions.onPreviousParagraph(), 'previous');
  previous.dataset.action = 'previous-paragraph';
  const play = button('开始朗读', 'play-button', () => actions.onTogglePlay());
  play.dataset.action = 'toggle-play';
  const playIcon = make('span');
  playIcon.append(icon('play'));
  const playLabel = make('span', '', '开始朗读');
  play.append(playIcon, playLabel);
  const stop = button('停止朗读', 'icon-button stop-button', () => actions.onStop(), 'stop');
  stop.dataset.action = 'stop';
  const next = button('下一段', 'icon-button stop-button', () => actions.onNextParagraph(), 'next');
  next.dataset.action = 'next-paragraph';
  playActions.append(previous, play, next, stop);
  const volumeHeading = make('div', 'field-heading');
  const volumeValue = make('span', 'value', '100%');
  volumeHeading.append(labelFor('朗读音量', 'tingjian-volume'), volumeValue);
  const volumeRow = make('div', 'volume-row');
  const mute = button('静音', 'icon-button mute', () => actions.onVolume(latest?.volume ? 0 : lastNonZeroVolume), 'volume');
  mute.dataset.action = 'mute';
  mute.setAttribute('aria-pressed', 'false');
  const volume = make('input', 'range');
  volume.id = 'tingjian-volume';
  volume.dataset.action = 'volume';
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '1';
  volume.value = '100';
  volume.setAttribute('aria-label', '朗读音量');
  volumeRow.append(mute, volume);
  const settings = make('div', 'settings-grid');
  const rateRow = make('div', 'select-row');
  const rate = make('select', 'select rate-select');
  rate.id = 'tingjian-rate';
  rate.dataset.action = 'rate';
  rate.setAttribute('aria-label', '朗读倍速');
  for (const value of [0.75, 1, 1.25, 1.5, 2]) {
    const option = make('option', '', `${value}×`);
    option.value = String(value);
    option.selected = value === 1;
    rate.append(option);
  }
  rateRow.append(labelFor('朗读倍速', rate.id), rate);
  const voiceRow = make('div', 'select-row voice-row');
  const voice = make('select', 'select');
  voice.id = 'tingjian-voice';
  voice.dataset.action = 'voice';
  voice.setAttribute('aria-label', '朗读声音');
  voiceRow.append(labelFor('朗读声音', voice.id), voice);
  settings.append(rateRow, voiceRow);
  player.append(playerHeading, track, progressHeading, progress, playActions, volumeHeading, volumeRow, settings);
  body.append(player);

  const preferences = make('section', 'block');
  const toggleRow = (text: string, hint: string, id: string, action: (value: boolean) => void) => {
    const label = make('label', 'toggle');
    label.htmlFor = id;
    const textGroup = make('span', 'toggle-text');
    textGroup.append(make('strong', '', text), make('small', '', hint));
    const input = make('input', 'switch');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', text);
    input.addEventListener('change', () => action(input.checked));
    label.append(textGroup, input);
    preferences.append(label);
    return input;
  };
  const autoCollapse = toggleRow('自动折叠较早回复', '保留完整内容，需要时随时展开', 'tingjian-auto-collapse', value => actions.onAutoCollapse(value));
  const follow = toggleRow('跟随朗读段落', '自动滚动到正在高亮的文字', 'tingjian-follow', value => actions.onFollow(value));
  autoCollapse.dataset.action = 'auto-collapse';
  follow.dataset.action = 'follow';
  const bulk = make('div', 'bulk-actions');
  const expand = button('展开全部回复', 'small-button', () => actions.onExpandAll(), 'expand');
  expand.append(make('span', '', '展开全部'));
  const collapse = button('折叠全部回复', 'small-button', () => actions.onCollapseAll(), 'collapse');
  expand.dataset.action = 'expand-all';
  collapse.dataset.action = 'collapse-all';
  collapse.append(make('span', '', '折叠全部'));
  bulk.append(expand, collapse);
  preferences.append(bulk);
  const notice = make('p', 'notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const error = make('p', 'error');
  error.hidden = true;
  error.setAttribute('role', 'alert');
  const hint = make('p', 'hint');
  hint.append(icon('info'), make('span', '', '高亮和进度使用系统朗读；ChatGPT 自带朗读可照常使用。声音由设备提供，最大响度受系统音量限制。'));
  preferences.append(notice, error, hint);
  body.append(preferences);

  const launcher = button('打开目录和朗读面板', 'launcher', () => setOpen(!open), 'headphones');
  launcher.dataset.action = 'toggle-panel';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', panel.id);
  const launcherLabel = make('span', '', '目录 · 朗读');
  const playingDot = make('span', 'playing-dot');
  playingDot.hidden = true;
  launcher.append(launcherLabel, playingDot);
  shadow.append(panel, launcher);
  (document.body || document.documentElement).append(host);

  let latest: PanelState | null = null;
  let open = false;
  let destroyed = false;
  let lastNonZeroVolume = 1;
  let previousPlaying = false;
  let previousMuted = false;
  let voicesSignature = '';
  const activeRanges = new Set<HTMLInputElement>();
  const messageNodes = new Map<string, {item: HTMLLIElement; button: HTMLButtonElement; number: HTMLSpanElement; title: HTMLSpanElement; count: HTMLSpanElement; collapsed: HTMLSpanElement; stream: HTMLSpanElement}>();
  const chapterNodes = new Map<string, {item: HTMLLIElement; button: HTMLButtonElement}>();

  function setOpen(value: boolean): void {
    if (destroyed || open === value) return;
    open = value;
    panel.hidden = !value;
    launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? '收起目录和朗读面板' : '打开目录和朗读面板');
    launcher.title = value ? '收起目录和朗读面板' : '打开目录和朗读面板';
    if (value) panel.focus({preventScroll: true});
    else {
      launcher.focus({preventScroll: true});
      actions.onClose?.();
    }
  }

  function rangeInput(node: HTMLInputElement, action: (value: number) => void, divisor: number, valueLabel: HTMLSpanElement): void {
    node.addEventListener('pointerdown', () => activeRanges.add(node));
    node.addEventListener('input', () => {
      const value = unit(Number(node.value) / divisor);
      node.style.setProperty('--fill', `${Math.round(value * 100)}%`);
      setText(valueLabel, `${Math.round(value * 100)}%`);
      node.setAttribute('aria-valuetext', `${Math.round(value * 100)}%`);
      action(value);
    });
  }
  rangeInput(progress, value => actions.onSeek(value), 1000, progressValue);
  rangeInput(volume, value => actions.onVolume(value), 100, volumeValue);
  const releaseRanges = () => {
    if (!activeRanges.size) return;
    activeRanges.clear();
    if (latest) update(latest);
  };
  window.addEventListener('pointerup', releaseRanges);
  window.addEventListener('pointercancel', releaseRanges);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  shadow.addEventListener('keydown', onKeyDown);
  rate.addEventListener('change', () => actions.onRate(Number(rate.value)));
  voice.addEventListener('change', () => actions.onVoice(voice.value));
  voice.addEventListener('blur', () => {if (latest) renderVoices(latest);});

  function renderVoices(state: PanelState): void {
    if (shadow.activeElement === voice) return;
    const signature = JSON.stringify(state.voices.map(item => [item.voiceURI, item.name, item.lang]));
    if (signature !== voicesSignature || !voice.options.length) {
      const defaultOption = make('option', '', '系统默认声音');
      defaultOption.value = '';
      const options: HTMLOptionElement[] = [defaultOption];
      const ids = new Set<string>();
      for (const item of state.voices) {
        if (ids.has(item.voiceURI)) continue;
        ids.add(item.voiceURI);
        const option = make('option', '', `${item.name} · ${item.lang}`);
        option.value = item.voiceURI;
        options.push(option);
      }
      voice.replaceChildren(...options);
      voicesSignature = signature;
    }
    voice.value = state.voiceId;
    if (voice.selectedIndex < 0) voice.value = '';
  }

  function renderDirectory(state: PanelState): void {
    const kept = new Set<string>();
    state.messages.forEach((message, index) => {
      if (kept.has(message.id)) return;
      kept.add(message.id);
      let nodes = messageNodes.get(message.id);
      if (!nodes) {
        const item = make('li');
        const choice = button('', 'toc-button', () => actions.onSelect(message.id));
        choice.dataset.messageId = message.id;
        const number = make('span', 'toc-number');
        number.setAttribute('aria-hidden', 'true');
        const text = make('span', 'toc-text');
        const messageTitle = make('span', 'toc-title');
        const meta = make('span', 'toc-meta');
        const count = make('span');
        const collapsed = make('span', '', '已折叠');
        const stream = make('span', 'stream', '生成中');
        meta.append(count, collapsed, stream);
        text.append(messageTitle, meta);
        choice.append(number, text);
        item.append(choice);
        nodes = {item, button: choice, number, title: messageTitle, count, collapsed, stream};
        messageNodes.set(message.id, nodes);
      }
      setText(nodes.number, String(index + 1).padStart(2, '0'));
      setText(nodes.title, message.title || `第 ${index + 1} 条回复`);
      setText(nodes.count, `${Math.max(0, Math.round(message.charCount)).toLocaleString()} 字`);
      nodes.collapsed.hidden = !message.collapsed;
      nodes.stream.hidden = !message.isStreaming;
      const selected = state.selectedId === message.id;
      nodes.button.classList.toggle('is-selected', selected);
      nodes.button.setAttribute('aria-pressed', String(selected));
      const label = `第 ${index + 1} 条：${message.title || '未命名回复'}${message.isStreaming ? '，正在生成' : ''}`;
      nodes.button.setAttribute('aria-label', label);
      nodes.button.title = message.title || '未命名回复';
      const position = directory.children[index];
      if (position !== nodes.item) directory.insertBefore(nodes.item, position || null);
    });
    for (const [id, nodes] of messageNodes) {
      if (kept.has(id)) continue;
      nodes.item.remove();
      messageNodes.delete(id);
    }
    empty.hidden = state.messages.length > 0;
    setText(messageCount, `${state.messages.length} 条`);
  }

  function renderChapters(state: PanelState): void {
    const sections = (state.sections || []).filter(section => section.messageId === state.selectedId).slice(0, 50);
    chapterBlock.hidden = !sections.length;
    const kept = new Set<string>();
    sections.forEach((section, index) => {
      const key = `${section.messageId}:${section.offset}`;
      if (kept.has(key)) return;
      kept.add(key);
      let nodes = chapterNodes.get(key);
      if (!nodes) {
        const item = make('li');
        const choice = button('', 'chapter-button', () => actions.onJumpSection(section.messageId, section.offset));
        choice.dataset.messageId = section.messageId;
        choice.dataset.sectionOffset = String(section.offset);
        item.append(choice);
        nodes = {item, button: choice};
        chapterNodes.set(key, nodes);
      }
      setText(nodes.button, section.title || `章节 ${index + 1}`);
      nodes.button.title = section.title;
      nodes.button.setAttribute('aria-label', `定位章节：${section.title || index + 1}`);
      nodes.button.style.setProperty('--indent', String(Math.min(3, Math.max(0, section.level - 1))));
      const position = chapters.children[index];
      if (position !== nodes.item) chapters.insertBefore(nodes.item, position || null);
    });
    for (const [key, nodes] of chapterNodes) {
      if (kept.has(key)) continue;
      nodes.item.remove();
      chapterNodes.delete(key);
    }
  }

  function update(state: PanelState): void {
    if (destroyed) return;
    latest = state;
    renderDirectory(state);
    renderChapters(state);
    const hasSelection = !!state.selectedId;
    const isStreaming = state.messages.some(message => message.id === state.selectedId && message.isStreaming);
    setText(trackTitle, state.activeTitle || '从目录选择一条回复');
    trackTitle.title = state.activeTitle || '';
    const status = state.isPlaying ? '正在朗读' : state.isPaused ? '已暂停' : '随时开始';
    const total = Math.max(0, Math.round(state.totalParagraphs));
    const current = Math.min(total, Math.max(0, Math.round(state.currentParagraph)));
    const paragraphStatus = total ? current ? `第 ${current} / ${total} 段` : `共 ${total} 段` : '选择一条回复开始';
    setText(trackStatus, `${status} · ${paragraphStatus}`);
    if (!activeRanges.has(progress)) {
      const value = unit(state.progress);
      progress.value = String(Math.round(value * 1000));
      progress.style.setProperty('--fill', `${Math.round(value * 100)}%`);
      progress.setAttribute('aria-valuetext', `已读 ${Math.round(value * 100)}%`);
      setText(progressValue, `${Math.round(value * 100)}%`);
    }
    const nextPlayLabel = state.isPlaying ? '暂停朗读' : state.isPaused ? '继续朗读' : '开始朗读';
    setText(playLabel, nextPlayLabel);
    play.setAttribute('aria-label', nextPlayLabel);
    play.title = nextPlayLabel;
    if (previousPlaying !== state.isPlaying || !playIcon.firstChild) playIcon.replaceChildren(icon(state.isPlaying ? 'pause' : 'play'));
    previousPlaying = state.isPlaying;
    play.disabled = !state.supported || !hasSelection || isStreaming;
    previous.disabled = !state.supported || !hasSelection || isStreaming || current <= 1;
    next.disabled = !state.supported || !hasSelection || isStreaming || !total || current >= total;
    stop.disabled = !state.supported || !hasSelection || !(state.isPlaying || state.isPaused || state.progress > 0);
    progress.disabled = !state.supported || !hasSelection || isStreaming;
    const volumeUnit = unit(state.volume);
    if (volumeUnit > 0) lastNonZeroVolume = volumeUnit;
    if (!activeRanges.has(volume)) {
      volume.value = String(Math.round(volumeUnit * 100));
      volume.style.setProperty('--fill', `${Math.round(volumeUnit * 100)}%`);
      volume.setAttribute('aria-valuetext', `${Math.round(volumeUnit * 100)}%`);
      setText(volumeValue, `${Math.round(volumeUnit * 100)}%`);
    }
    const muted = volumeUnit === 0;
    if (previousMuted !== muted) mute.replaceChildren(icon(muted ? 'muted' : 'volume'));
    previousMuted = muted;
    mute.setAttribute('aria-pressed', String(muted));
    mute.setAttribute('aria-label', muted ? '取消静音' : '静音');
    mute.title = muted ? '恢复上次音量' : '静音';
    volume.disabled = mute.disabled = rate.disabled = voice.disabled = !state.supported;
    if (shadow.activeElement !== rate) {
      const value = String(state.rate);
      if (!Array.from(rate.options).some(option => option.value === value)) {
        const option = make('option', '', `${state.rate}×`);
        option.value = value;
        rate.append(option);
      }
      rate.value = value;
    }
    renderVoices(state);
    autoCollapse.checked = state.autoCollapse;
    follow.checked = state.follow;
    expand.disabled = collapse.disabled = !state.messages.length;
    const errorText = state.error || (!state.supported ? '当前浏览器不支持系统朗读。请尝试新版 Chrome 或 Edge；目录与折叠仍可使用。' : '');
    setText(error, errorText);
    error.hidden = !errorText;
    setText(notice, state.notice || '');
    notice.hidden = !state.notice;
    launcher.classList.toggle('is-playing', state.isPlaying);
    playingDot.hidden = !state.isPlaying;
  }

  renderVoices({voices: [], voiceId: ''} as PanelState);
  play.disabled = stop.disabled = progress.disabled = previous.disabled = next.disabled = true;

  return {
    update,
    setOpen,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('pointerup', releaseRanges);
      window.removeEventListener('pointercancel', releaseRanges);
      shadow.removeEventListener('keydown', onKeyDown);
      activeRanges.clear();
      host.remove();
    },
  };
}
