export interface ChatParagraph {
  text: string;
  /** Offsets use the same UTF-16 units as speech boundary events. */
  start: number;
  end: number;
  element: HTMLElement;
}

export interface ChatMessage {
  id: string;
  element: HTMLElement;
  contentElement: HTMLElement;
  title: string;
  text: string;
  paragraphs: ChatParagraph[];
  isStreaming: boolean;
  charCount: number;
}

export interface MessageDecorationOptions {
  collapsed: boolean;
  onToggle: () => void;
  onRead: () => void;
}

export const LONG_MESSAGE_THRESHOLD = 600;

const STYLE_ID = 'tj-chatreader-dom-styles';
const COLLAPSED_CLASS = 'tj-chatreader-content-collapsed';
const HIGHLIGHT_CLASS = 'tj-chatreader-active-paragraph';
const EXCLUDED = [
  '[data-tj-helper]', 'script', 'style', 'noscript', 'template', 'pre',
  '[data-testid="code-block"]', 'button', '[role="button"]', 'input',
  'textarea', 'select', 'option', 'svg', 'canvas', 'iframe', 'audio', 'video',
  'nav', 'aside', 'footer', 'form', '[aria-hidden="true"]', '[hidden]',
  '[data-message-author-role="user"]', '[data-message-author-role="system"]', '[data-message-author-role="tool"]',
  '[data-testid*="citation"]', '[data-citation-index]',
].join(',');
const ATOMIC_BLOCK = /^(P|H[1-6]|TABLE)$/;
const LOGICAL_BLOCK = /^(LI|BLOCKQUOTE)$/;
const BLOCK_DESCENDANTS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, table';
const CONTAINER_BLOCK = /^(DIV|SECTION|ARTICLE|UL|OL|DL|DT|DD|FIGURE|FIGCAPTION|DETAILS|SUMMARY|TR)$/;
const fallbackIds = new WeakMap<HTMLElement, string>();
let nextFallbackId = 0;

interface Decoration {
  message: ChatMessage;
  options: MessageDecorationOptions;
  toolbar: HTMLDivElement;
  count: HTMLSpanElement;
  status: HTMLSpanElement;
  toggle: HTMLButtonElement;
  read: HTMLButtonElement;
  /** Following may reveal a folded message without changing its saved preference. */
  temporarilyExpanded: boolean;
}

const decorations = new Map<HTMLElement, Decoration>();
const ownedStyles = new Map<Document, HTMLStyleElement>();
const highlighted = new Set<HTMLElement>();
let highlightedMessage: HTMLElement | null = null;
let lastHighlightedParagraph: HTMLElement | null = null;

function isOwnHelper(element: Element): boolean {
  return !!element.closest('[data-tj-helper]');
}

function isExcluded(element: Element, cache: WeakMap<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  let result = element.matches(EXCLUDED) || element.classList.contains('sr-only');
  const view = element.ownerDocument.defaultView;
  if (!result && view) {
    const style = view.getComputedStyle(element);
    result = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  }
  cache.set(element, result);
  return result;
}

/** Read visible DOM nodes, never HTML, attributes, link destinations, or code blocks. */
function renderedText(node: Node, cache: WeakMap<Element, boolean>): string {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (isExcluded(element, cache)) return '';
  if (element.tagName === 'BR') return '\n';
  const content = Array.from(element.childNodes).map(child => renderedText(child, cache)).join('');
  return /^(TD|TH|TR)$/.test(element.tagName) ? `${content} ` : content;
}

function extractParagraphs(contentElement: HTMLElement): {text: string; paragraphs: ChatParagraph[]} {
  const cache = new WeakMap<Element, boolean>();
  const blocks: {text: string; element: HTMLElement}[] = [];
  const emit = (text: string, element: HTMLElement) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized) blocks.push({text: normalized, element});
  };

  // Containers such as a list item or quotation can contain headings, paragraphs,
  // nested lists, and their own bare text. Flush only the bare text around each
  // child block so no enclosing node repeats its descendants' words.
  const walk = (container: HTMLElement, owner: HTMLElement) => {
    if (isExcluded(container, cache)) return;
    let buffer = '';
    const flush = () => {emit(buffer, owner); buffer = '';};
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeType === 3) {buffer += child.textContent || ''; continue;}
      if (child.nodeType !== 1) continue;
      const element = child as HTMLElement;
      if (isExcluded(element, cache)) continue;
      if (ATOMIC_BLOCK.test(element.tagName)) {
        flush(); emit(renderedText(element, cache), element);
      } else if (LOGICAL_BLOCK.test(element.tagName) || CONTAINER_BLOCK.test(element.tagName) || element.querySelector(BLOCK_DESCENDANTS)) {
        flush(); walk(element, element);
      } else {
        buffer += renderedText(element, cache);
      }
    }
    flush();
  };

  if (ATOMIC_BLOCK.test(contentElement.tagName)) emit(renderedText(contentElement, cache), contentElement);
  else walk(contentElement, contentElement);
  let text = '';
  const paragraphs = blocks.map(block => {
    if (text) text += '\n\n';
    const start = text.length;
    text += block.text;
    return {...block, start, end: text.length};
  });
  return {text, paragraphs};
}

function contentFor(element: HTMLElement): HTMLElement {
  const preferred = '[data-message-content], .markdown, .prose';
  if (element.matches(preferred)) return element;
  const matches = Array.from(element.querySelectorAll<HTMLElement>(preferred)).filter(node => !isOwnHelper(node));
  const outer = matches.filter(node => !matches.some(other => other !== node && other.contains(node)));
  if (!outer.length) return element;
  let common = outer[0];
  while (!outer.every(node => common.contains(node)) && common.parentElement && common !== element) common = common.parentElement;
  return element.contains(common) ? common : element;
}

function stableId(element: HTMLElement): string {
  const own = element.getAttribute('data-message-id');
  if (own) return own;
  const container = element.closest<HTMLElement>('[data-message-id]');
  if (container?.dataset.messageId) return container.dataset.messageId;
  const article = element.closest<HTMLElement>('article, [role="article"]');
  if (article?.id) return article.id;
  if (article?.dataset.turnId) return article.dataset.turnId;
  let fallback = fallbackIds.get(element);
  if (!fallback) {fallback = `tj-message-${++nextFallbackId}`; fallbackIds.set(element, fallback);}
  return fallback;
}

function hasStreamingSignal(element: HTMLElement): boolean {
  const selectors = '[data-is-streaming="true"], [data-streaming="true"], [data-status="streaming"], [aria-busy="true"], .result-streaming';
  const article = element.closest('article, [role="article"]');
  return element.matches(selectors) || !!element.querySelector(selectors)
    || !!article?.matches(selectors) || !!article?.querySelector(selectors);
}

function isVisibleControl(element: Element, cache = new WeakMap<Element, boolean>()): boolean {
  const view = element.ownerDocument.defaultView;
  const visited: Element[] = [];
  let visible = true;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const known = cache.get(current);
    if (known !== undefined) {visible = known; break;}
    visited.push(current);
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') {visible = false; break;}
    if (view) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {visible = false; break;}
    }
  }
  for (const current of visited) cache.set(current, visible);
  return visible;
}

/** Only positively attributed assistant messages are eligible, including fallbacks. */
export function scanMessages(root: Document = document): ChatMessage[] {
  const visibility = new WeakMap<Element, boolean>();
  const candidates = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>([
    '[data-message-author-role="assistant"]',
    'article[data-turn="assistant"]', '[role="article"][data-turn="assistant"]',
    'article[data-author="assistant"]', '[role="article"][data-author="assistant"]',
    '[data-testid="assistant-message"]',
  ].join(',')));
  // Some older layouts expose the author only as an accessible turn label.
  for (const article of root.querySelectorAll<HTMLElement>('article, [role="article"]')) {
    if (!isVisibleControl(article, visibility)) continue;
    const label = article.getAttribute('aria-label') || '';
    const heading = article.querySelector<HTMLElement>('.sr-only, [data-testid="author-label"]')?.textContent || '';
    if ([label, heading].some(value => /^(?:ChatGPT|assistant|助手)(?:\s|[:：]|说|回复|回答|$)/i.test(value.trim())) && article.querySelector('.markdown, .prose')) candidates.add(article);
  }
  const eligible = Array.from(candidates).filter(element => {
    if (!isVisibleControl(element, visibility)) return false;
    if (isOwnHelper(element) || element.closest('aside, nav, [role="navigation"], [data-testid*="sidebar"], #stage-slideover-sidebar')) return false;
    if (element.closest('[data-message-author-role="user"], [data-turn="user"], [data-author="user"]')) return false;
    return !element.closest('pre, [data-testid="code-block"]');
  });
  // Prefer actual author nodes over their attributed article wrapper. Excluded
  // helper descendants must never cause their genuine parent to be discarded.
  const ordered = eligible.filter(element => !eligible.some(other => other !== element && element.contains(other)))
    .sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
  const stopSelectors = '[data-testid="stop-button"], [data-testid="stop-generating-button"], button[aria-label*="Stop generating"], button[aria-label*="Stop streaming"], button[aria-label*="停止生成"], button[aria-label*="停止回复"]';
  const generationActive = Array.from(root.querySelectorAll(stopSelectors)).some(button => !isOwnHelper(button) && isVisibleControl(button, visibility));
  return ordered.map((element, index) => {
    const contentElement = contentFor(element);
    const {text, paragraphs} = extractParagraphs(contentElement);
    const heading = paragraphs.find(paragraph => /^H[1-6]$/.test(paragraph.element.tagName));
    const title = Array.from(heading?.text || paragraphs[0]?.text || 'ChatGPT 回复').slice(0, 48).join('');
    return {
      id: stableId(element), element, contentElement, title, text, paragraphs,
      isStreaming: index === ordered.length - 1 && (generationActive || hasStreamingSignal(element)),
      charCount: Array.from(text.replace(/\s/g, '')).length,
    };
  }).filter(message => message.charCount > 0);
}

function ensureStyles(root: Document) {
  if (ownedStyles.get(root)?.isConnected) return;
  const existing = root.getElementById(STYLE_ID);
  if (existing?.getAttribute('data-tj-helper') === 'styles') return;
  const style = root.createElement('style');
  style.id = STYLE_ID;
  style.dataset.tjHelper = 'styles';
  style.textContent = `
.tj-chatreader-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0 14px;font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#76746d}
.tj-chatreader-toolbar button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:30px;padding:4px 10px;border:1px solid #d5d4cc;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.tj-chatreader-toolbar [hidden]{display:none!important}
.tj-chatreader-toolbar button:hover:not(:disabled){background:rgba(128,128,128,.1);border-color:#9b9b90}
.tj-chatreader-toolbar button:focus-visible{outline:2px solid #bd704d;outline-offset:2px}
.tj-chatreader-toolbar button:disabled{opacity:.5;cursor:default}
.tj-chatreader-toolbar .tj-chatreader-read{color:#a75e3c;border-color:rgba(167,94,60,.35)}
.tj-chatreader-toolbar .tj-chatreader-status{font-size:11px}
.tj-chatreader-content-collapsed{max-height:160px!important;overflow:hidden!important;mask-image:linear-gradient(to bottom,#000 55%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,#000 55%,transparent 100%)}
.tj-chatreader-active-paragraph{background:rgba(224,173,105,.2)!important;box-shadow:inset 3px 0 0 #bd704d;border-radius:4px;scroll-margin-top:100px;transition:background-color .15s ease}
@media(prefers-color-scheme:dark){.tj-chatreader-toolbar{color:#bcbab2}.tj-chatreader-toolbar button{border-color:#565650}.tj-chatreader-toolbar .tj-chatreader-read{color:#e0ae88;border-color:#82664e}}
@media(prefers-reduced-motion:reduce){.tj-chatreader-active-paragraph{transition:none}}
`;
  (root.head || root.documentElement).appendChild(style);
  ownedStyles.set(root, style);
}

function updateDecoration(record: Decoration) {
  const long = record.message.charCount >= LONG_MESSAGE_THRESHOLD;
  const folded = long && record.options.collapsed && !record.message.isStreaming && !record.temporarilyExpanded;
  record.message.contentElement.classList.toggle(COLLAPSED_CLASS, folded);
  record.toolbar.dataset.tjMessageId = record.message.id;
  record.count.textContent = `${record.message.charCount.toLocaleString('zh-CN')} 字`;
  record.toggle.hidden = !long;
  record.toggle.disabled = record.message.isStreaming;
  record.toggle.setAttribute('aria-expanded', String(!folded));
  record.toggle.textContent = record.temporarilyExpanded && record.options.collapsed ? '保持展开' : folded ? '展开全文' : '折叠正文';
  record.status.textContent = record.message.isStreaming ? '生成中，完成后可折叠' : record.temporarilyExpanded && record.options.collapsed ? '跟读时临时展开' : '';
}

function removeDecoration(record: Decoration) {
  record.message.contentElement.classList.remove(COLLAPSED_CLASS);
  record.toolbar.remove();
}

/** Add an independent sibling toolbar; never move or rewrite React-owned content. */
export function decorateMessage(message: ChatMessage, options: MessageDecorationOptions): void {
  for (const [element, record] of decorations) {
    if (!element.isConnected) {removeDecoration(record); decorations.delete(element);}
  }
  ensureStyles(message.element.ownerDocument);
  let record = decorations.get(message.element);
  if (!record) {
    const root = message.element.ownerDocument;
    const toolbar = root.createElement('div');
    toolbar.className = 'tj-chatreader-toolbar';
    toolbar.dataset.tjHelper = 'message-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', '听笺消息工具');
    const count = root.createElement('span');
    const status = root.createElement('span'); status.className = 'tj-chatreader-status';
    const toggle = root.createElement('button'); toggle.type = 'button';
    const read = root.createElement('button'); read.type = 'button'; read.className = 'tj-chatreader-read'; read.textContent = '本助手朗读';
    toolbar.append(count, toggle, read, status);
    record = {message, options, toolbar, count, status, toggle, read, temporarilyExpanded: false};
    const current = record;
    toggle.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); current.options.onToggle();});
    read.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); current.options.onRead();});
    decorations.set(message.element, record);
  } else {
    if (record.message.contentElement !== message.contentElement) record.message.contentElement.classList.remove(COLLAPSED_CLASS);
    if (record.options.collapsed !== options.collapsed) record.temporarilyExpanded = false;
    record.message = message;
    record.options = options;
  }
  if (record.toolbar.parentElement !== message.contentElement.parentElement || record.toolbar.nextElementSibling !== message.contentElement) {
    message.contentElement.insertAdjacentElement('beforebegin', record.toolbar);
  }
  updateDecoration(record);
}

export function clearHighlights(): void {
  for (const element of highlighted) element.classList.remove(HIGHLIGHT_CLASS);
  highlighted.clear(); highlightedMessage = null; lastHighlightedParagraph = null;
  for (const record of decorations.values()) {
    if (record.temporarilyExpanded) {record.temporarilyExpanded = false; updateDecoration(record);}
  }
}

export function highlightParagraph(message: ChatMessage, offset: number, follow: boolean): void {
  if (!message.paragraphs.length) {clearHighlights(); return;}
  if (highlightedMessage && highlightedMessage !== message.element) clearHighlights();
  const position = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const paragraph = message.paragraphs.find(item => position < item.end) || message.paragraphs.at(-1)!;
  const changed = lastHighlightedParagraph !== paragraph.element;
  if (changed) {
    for (const element of highlighted) element.classList.remove(HIGHLIGHT_CLASS);
    highlighted.clear();
    paragraph.element.classList.add(HIGHLIGHT_CLASS); highlighted.add(paragraph.element);
    lastHighlightedParagraph = paragraph.element;
  }
  highlightedMessage = message.element;
  if (!follow) return;
  const record = decorations.get(message.element);
  if (record?.options.collapsed && !record.message.isStreaming) {
    record.temporarilyExpanded = true; updateDecoration(record);
  }
  const rect = paragraph.element.getBoundingClientRect();
  const view = paragraph.element.ownerDocument.defaultView;
  const outside = !!view && (rect.bottom < 80 || rect.top > view.innerHeight - 100);
  if (changed || outside) {
    const reducedMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    paragraph.element.scrollIntoView({behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest'});
  }
}

export function scrollToMessage(message: ChatMessage): void {
  message.element.scrollIntoView({behavior: 'smooth', block: 'start', inline: 'nearest'});
}

export function cleanupDecorations(): void {
  clearHighlights();
  for (const record of decorations.values()) removeDecoration(record);
  decorations.clear();
  for (const style of ownedStyles.values()) style.remove();
  ownedStyles.clear();
}
