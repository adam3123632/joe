/* DOM compatibility regression in real Chromium; no real ChatGPT account. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {build} = require('esbuild');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const assistantActions = '<nav aria-label="原生回答操作"><button data-testid="copy-turn-action-button">复制</button><button data-testid="good-response-turn-action-button">赞</button><button data-testid="bad-response-turn-action-button">不赞</button><button data-testid="read-aloud-button" aria-label="Read aloud">朗读</button></nav>';
const copyOnly = '<nav><button data-testid="copy-turn-action-button">复制</button></nav>';
const markdown = (text, id = '') => `<div class="markdown prose"${id ? ` id="${id}"` : ''}><h2>本地兼容测试</h2><p>${text}</p></div>`;
const turn = (id, body, actions = assistantActions, attributes = '') => `<article id="${id}" data-testid="conversation-turn-${id}" ${attributes}>${body}${actions}</article>`;
let passed = 0;

async function main() {
  const output = await build({
    entryPoints: [path.join(ROOT, 'chat-reader/dom.ts')], bundle: true, write: false,
    format: 'iife', globalName: 'TJDom', platform: 'browser', target: ['chrome100'],
  });
  const source = output.outputFiles[0].text;
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1200, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  const requests = [], errors = [];
  await context.route('**/*', route => {requests.push(route.request().url()); return route.abort('blockedbyclient');});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  const fixture = async body => {
    await page.goto('about:blank');
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px/1.8 sans-serif}main{max-width:760px;margin:auto}article{padding:16px;margin:12px;background:#f7f7f2}button{min-height:30px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body>${body}</body></html>`);
    await page.addScriptTag({content: source});
  };
  const check = async (name, callback) => {await callback(); passed++; console.log(`  ✓ ${name}`);};
  try {
    await check('unattributed conversation turns use native assistant controls; copy-only user turns stay excluded', async () => {
      await fixture(`<main>${turn('copy-only-user', markdown('USER_COPY_ONLY_NEVER_READ'), copyOnly)}${turn('assistant-good', markdown('GOOD_ASSISTANT_BODY'), '<button data-testid="good-response-turn-action-button">赞</button>')}${turn('assistant-bad', markdown('BAD_ASSISTANT_BODY'), '<button data-testid="bad-response-turn-action-button">不赞</button>')}${turn('assistant-read', markdown('READ_ASSISTANT_BODY'), '<button data-testid="read-aloud-button" aria-label="Read aloud">朗读</button>')}</main>`);
      const messages = await page.evaluate(() => TJDom.scanMessages().map(message => ({id: message.id, text: message.text})));
      assert.deepEqual(messages.map(message => message.id), ['assistant-good', 'assistant-bad', 'assistant-read']);
      assert.ok(messages.every(message => !message.text.includes('USER_COPY_ONLY_NEVER_READ')));
      assert.ok(messages.every(message => !message.text.includes('朗读')));
    });

    await check('explicit user attribution defeats forged assistant descendants and assistant-looking controls', async () => {
      await fixture(`<main>${turn('explicit-user', `<div data-message-author-role="user"><div data-message-author-role="assistant" data-testid="assistant-message">${markdown('FORGED_USER_BODY_NEVER_READ')}</div>${assistantActions}</div>`, '')}${turn('user-article', markdown('USER_ARTICLE_NEVER_READ'), assistantActions, 'data-turn="user"')}${turn('genuine-assistant', markdown('GENUINE_ASSISTANT_BODY'), assistantActions, 'data-message-author-role="assistant"')}</main>`);
      const messages = await page.evaluate(() => TJDom.scanMessages().map(message => ({id: message.id, text: message.text})));
      assert.equal(messages.length, 1);
      assert.match(messages[0].text, /GENUINE_ASSISTANT_BODY/);
      assert.doesNotMatch(messages[0].text, /NEVER_READ/);
    });

    await check('visually visible aria-hidden ancestors are compatible; CSS-hidden and hidden-attribute turns stay excluded', async () => {
      await fixture(`<main><div aria-hidden="true">${turn('visible-aria-hidden', markdown('VISIBLE_ARIA_BODY'), assistantActions, 'data-message-author-role="assistant"')}</div><div style="display:none">${turn('display-none', markdown('DISPLAY_NONE_NEVER_READ'), assistantActions, 'data-message-author-role="assistant"')}</div><div hidden>${turn('hidden-attribute', markdown('HIDDEN_ATTRIBUTE_NEVER_READ'), assistantActions, 'data-message-author-role="assistant"')}</div><div style="visibility:hidden">${turn('visibility-hidden', markdown('VISIBILITY_HIDDEN_NEVER_READ'), assistantActions, 'data-message-author-role="assistant"')}</div></main>`);
      const result = await page.evaluate(() => ({
        visible: document.querySelector('#visible-aria-hidden').getBoundingClientRect().height > 0,
        messages: TJDom.scanMessages().map(message => ({id: message.id, text: message.text})),
      }));
      assert.equal(result.visible, true);
      assert.deepEqual(result.messages.map(message => message.id), ['visible-aria-hidden']);
      assert.match(result.messages[0].text, /VISIBLE_ARIA_BODY/);
      assert.doesNotMatch(result.messages[0].text, /NEVER_READ/);
    });

    await check('fallback detection ignores sidebars, navigation, and helper clones', async () => {
      await fixture(`<aside>${turn('sidebar-fallback', markdown('SIDEBAR_NEVER_READ'))}</aside><div data-testid="history-sidebar">${turn('sidebar-attributed', markdown('SIDEBAR_ROLE_NEVER_READ'), assistantActions, 'data-message-author-role="assistant"')}</div><nav>${turn('navigation-fallback', markdown('NAVIGATION_NEVER_READ'))}</nav><div data-tj-helper="preview">${turn('helper-fallback', markdown('HELPER_NEVER_READ'))}</div><main>${turn('main-fallback', markdown('MAIN_VISIBLE_BODY'))}</main>`);
      const result = await page.evaluate(() => TJDom.scanMessages().map(message => ({id: message.id, text: message.text})));
      assert.deepEqual(result.map(message => message.id), ['main-fallback']);
      assert.match(result[0].text, /MAIN_VISIBLE_BODY/);
      assert.doesNotMatch(result[0].text, /NEVER_READ/);
    });

    await check('empty assistant markers and split markdown blocks belong to one complete conversation turn', async () => {
      await fixture(`<main>${turn('empty-marker', '<div data-message-author-role="assistant" data-message-id="marker-id"></div><div class="markdown"><h2>空标记旁的完整回答</h2><p>EMPTY_MARKER_SIBLING_BODY</p></div>', copyOnly)}${turn('split-markdown', '<div data-message-author-role="assistant"><div class="markdown"><p>SPLIT_FIRST_BODY</p></div><div><div class="markdown"><p>SPLIT_SECOND_BODY</p></div></div></div>')}</main>`);
      const result = await page.evaluate(() => TJDom.scanMessages().map(message => ({
        text: message.text, paragraphs: message.paragraphs.map(paragraph => paragraph.text),
        turn: message.element.closest('[data-testid^="conversation-turn-"]')?.id,
      })));
      assert.equal(result.length, 2);
      assert.match(result[0].text, /EMPTY_MARKER_SIBLING_BODY/);
      assert.equal(result[0].turn, 'empty-marker');
      assert.equal(result[1].turn, 'split-markdown');
      assert.deepEqual(result[1].paragraphs, ['SPLIT_FIRST_BODY', 'SPLIT_SECOND_BODY']);
      assert.equal(result[1].text.match(/SPLIT_FIRST_BODY/g).length, 1);
      assert.equal(result[1].text.match(/SPLIT_SECOND_BODY/g).length, 1);
    });

    await check('structural markdown role=button wrappers preserve prose while real control labels stay excluded', async () => {
      await fixture(`<main>${turn('button-wrapper', '<div role="button"><div class="markdown"><p>OUTER_BUTTON_WRAPPER_BODY</p><button id="inner-control">REAL_BUTTON_NEVER_READ</button></div></div>')}${turn('markdown-button', '<div class="markdown" role="button"><p id="role-button-paragraph">MARKDOWN_BUTTON_WRAPPER_BODY</p><button>INNER_BUTTON_NEVER_READ</button></div>')}</main>`);
      const result = await page.evaluate(() => ({
        messages: TJDom.scanMessages().map(message => message.text),
        picked: TJDom.pickMessageAt(document.getElementById('role-button-paragraph'))?.text || null,
        actualButton: TJDom.pickMessageAt(document.getElementById('inner-control')),
      }));
      assert.equal(result.messages.length, 2);
      assert.match(result.messages[0], /OUTER_BUTTON_WRAPPER_BODY/);
      assert.match(result.messages[1], /MARKDOWN_BUTTON_WRAPPER_BODY/);
      assert.ok(result.messages.every(text => !text.includes('NEVER_READ')));
      assert.match(result.picked, /MARKDOWN_BUTTON_WRAPPER_BODY/);
      assert.equal(result.actualButton, null);
    });

    await check('manual picking reads the whole chosen unknown-author reply and refuses user/composer/sidebar/helper/code/control targets', async () => {
      await fixture(`<aside><div class="markdown"><p id="pick-sidebar">SIDEBAR_PICK_NEVER_READ</p></div></aside><div data-tj-helper="manual"><p id="pick-helper">HELPER_PICK_NEVER_READ</p></div><main>${turn('manual-unknown', '<div class="markdown"><h2>用户主动点选的正文</h2><p>MANUAL_FIRST_BODY <strong id="pick-prose">选中的词</strong></p><p>MANUAL_SECOND_BODY</p><pre><code id="pick-code">CODE_PICK_NEVER_READ</code></pre><button><span id="pick-control">CONTROL_PICK_NEVER_READ</span></button><div role="button"><span id="pick-role-control">ROLE_CONTROL_PICK_NEVER_READ</span></div></div>', copyOnly)}${turn('manual-explicit-user', '<div class="markdown"><p id="pick-user">EXPLICIT_USER_PICK_NEVER_READ</p></div>', assistantActions, 'data-message-author-role="user"')}<form><div contenteditable="true"><p id="pick-editor">EDITOR_PICK_NEVER_READ</p></div><textarea id="pick-textarea">TEXTAREA_PICK_NEVER_READ</textarea></form><div contenteditable="plaintext-only"><p id="pick-plaintext-editor">PLAINTEXT_EDITOR_PICK_NEVER_READ</p></div><div contenteditable><p id="pick-empty-editor">EMPTY_EDITOR_PICK_NEVER_READ</p></div></main>`);
      const result = await page.evaluate(() => {
        const selected = TJDom.pickMessageAt(document.getElementById('pick-prose'));
        const rejectedIds = ['pick-sidebar', 'pick-helper', 'pick-code', 'pick-control', 'pick-role-control', 'pick-user', 'pick-editor', 'pick-textarea', 'pick-plaintext-editor', 'pick-empty-editor'];
        return {
          selected: selected && {text: selected.text, turn: selected.element.closest('[data-testid^="conversation-turn-"]')?.id},
          rejected: rejectedIds.map(id => ({id, rejected: TJDom.pickMessageAt(document.getElementById(id)) === null})),
          automaticallyReadUnknown: TJDom.scanMessages().some(message => message.text.includes('MANUAL_FIRST_BODY')),
        };
      });
      assert.equal(result.selected?.turn, 'manual-unknown');
      assert.match(result.selected.text, /MANUAL_FIRST_BODY/);
      assert.match(result.selected.text, /MANUAL_SECOND_BODY/);
      assert.doesNotMatch(result.selected.text, /NEVER_READ/);
      assert.equal(result.automaticallyReadUnknown, false);
      assert.deepEqual(result.rejected.filter(target => !target.rejected), []);
    });

    await check('scanning, folding, highlighting, and cleanup retain original text, nodes, and native buttons', async () => {
      await fixture(`<main>${turn('source-preserved', `<div class="markdown"><h2 id="source-title">原文标题</h2><p id="source-p">${'这是本地构造的长文，只用于确认扫描和辅助样式不会重写聊天内容。'.repeat(30)}<strong id="source-emphasis">保留强调节点</strong></p><blockquote><p id="source-quote">保留引用文字</p></blockquote><ul><li id="source-item">保留列表项目</li></ul></div>`)}</main><textarea id="composer">用户草稿始终保持原样</textarea>`);
      const result = await page.evaluate(() => {
        const article = document.getElementById('source-preserved');
        const content = article.querySelector('.markdown');
        const originals = [...content.querySelectorAll('*')].map(node => ({node, parent: node.parentNode}));
        const buttons = [...article.querySelectorAll('button')];
        const text = content.textContent;
        const message = TJDom.scanMessages()[0];
        TJDom.decorateMessage(message, {collapsed: true, onToggle() {}, onRead() {}});
        const folded = content.classList.contains('tj-chatreader-content-collapsed');
        TJDom.highlightParagraph(message, message.paragraphs[1].start, true);
        const highlightIsOriginal = originals.some(({node}) => node.classList.contains('tj-chatreader-active-paragraph'));
        TJDom.clearHighlights();
        TJDom.cleanupDecorations();
        return {
          folded, highlightIsOriginal, unchangedText: text === content.textContent,
          sameContent: article.querySelector('.markdown') === content,
          unchangedNodes: originals.every(({node, parent}) => node.isConnected && node.parentNode === parent),
          unchangedButtons: buttons.every(button => button.isConnected && button.closest('article') === article),
          draft: document.getElementById('composer').value,
          leftoverHelpers: document.querySelectorAll('[data-tj-helper="message-toolbar"]').length,
        };
      });
      assert.deepEqual(result, {folded: true, highlightIsOriginal: true, unchangedText: true, sameContent: true, unchangedNodes: true, unchangedButtons: true, draft: '用户草稿始终保持原样', leftoverHelpers: 0});
    });

    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log(`\n${passed} DOM compatibility checks passed in Chromium. Synthetic markup; no logged-in ChatGPT or real speech claim.`);
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
