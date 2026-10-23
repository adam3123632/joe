/* End-to-end manual-picker regression using synthetic ChatGPT markup. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const {expect} = require('playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const HOST = '#tingjian-chat-reader-ui';
const action = (page, name) => page.locator(`${HOST} [data-action="${name}"]`);
let passed = 0;

function installSpeechMock({throwVoices = false} = {}) {
  class Utterance extends EventTarget {
    constructor(text = '') {super(); this.text = text; this.rate = 1; this.volume = 1; this.voice = null;}
  }
  const synthesis = new EventTarget();
  const calls = {utterances: [], cancel: 0, pause: 0, resume: 0};
  Object.assign(synthesis, {
    speaking: false, paused: false,
    getVoices() {
      if (throwVoices) throw new Error('Synthetic unavailable voice enumeration');
      return [{voiceURI: 'picker-zh', name: '本地测试音色', lang: 'zh-CN', localService: true, default: true}];
    },
    speak(utterance) {
      calls.utterances.push(utterance); this.speaking = true; this.paused = false;
      queueMicrotask(() => utterance.onstart?.(new Event('start')));
    },
    cancel() {calls.cancel++; this.speaking = false; this.paused = false;},
    pause() {calls.pause++; this.paused = true;},
    resume() {calls.resume++; this.paused = false;},
  });
  Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: synthesis});
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable: true, value: Utterance});
  window.__pickerSpeech = calls;
}

async function main() {
  const [html, script] = await Promise.all([
    fs.readFile(path.join(__dirname, 'fixture.html'), 'utf8'),
    fs.readFile(path.join(ROOT, 'build/chat-reader-extension/content.js'), 'utf8'),
  ]);
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  const requests = [], errors = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && /^https:\/\/chatgpt\.com\//.test(request.url())) {
      return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
    }
    requests.push(request.url()); return route.abort('blockedbyclient');
  });
  const check = async (name, callback) => {await callback(); passed++; console.log(`  ✓ ${name}`);};
  const createPage = async (throwVoices = false) => {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
    await page.addInitScript(installSpeechMock, {throwVoices});
    await page.goto('https://chatgpt.com/c/picker-fixture', {waitUntil: 'domcontentloaded'});
    return page;
  };
  try {
    const page = await createPage();
    await page.evaluate(() => {
      // Keep native DOM nodes, but remove the unsupported layout's author/action metadata.
      for (const article of document.querySelectorAll('[data-fixture-id^="assistant-"]')) {
        article.removeAttribute('data-author');
        for (const node of article.querySelectorAll('[data-message-author-role], [data-message-id]')) {
          node.removeAttribute('data-message-author-role'); node.removeAttribute('data-message-id');
        }
        for (const button of article.querySelectorAll('[data-testid="good-response-turn-action-button"]')) {
          button.removeAttribute('data-testid'); button.removeAttribute('aria-label');
        }
      }
      window.__nativeClicks = {user: 0, input: 0, native: 0};
      document.querySelector('[data-fixture-id="user-1"] p').addEventListener('click', () => __nativeClicks.user++);
      document.getElementById('prompt-textarea').addEventListener('click', () => __nativeClicks.input++);
      document.querySelector('[data-fixture-id="assistant-long"] [data-testid="copy-turn-action-button"]').addEventListener('click', () => __nativeClicks.native++);
    });
    await page.addScriptTag({content: script});
    await page.locator(HOST).waitFor({state: 'attached'});
    await action(page, 'toggle-panel').click();

    await check('unknown layout starts with zero detected replies and no automatic speech', async () => {
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(0);
      await expect(action(page, 'toggle-play')).toBeDisabled();
      assert.equal(await page.evaluate(() => __pickerSpeech.utterances.length), 0);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
    });

    await check('picker rejects user text, composer, and native controls without triggering their click handlers', async () => {
      await action(page, 'pick-message').click();
      await expect(page.locator('html')).toHaveAttribute('data-tj-picking', 'true');
      await expect(page.locator('[data-tj-helper="pick-style"]')).toHaveCount(1);
      for (const target of [
        page.locator('[data-fixture-id="user-1"] p'),
        page.locator('#prompt-textarea'),
        page.locator('[data-fixture-id="assistant-long"] [data-testid="copy-turn-action-button"]'),
      ]) {
        await target.click();
        await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-tj-picking', 'true');
      }
      assert.deepEqual(await page.evaluate(() => __nativeClicks), {user: 0, input: 0, native: 0});
      assert.equal(await page.evaluate(() => __pickerSpeech.utterances.length), 0);
      assert.match(await page.locator('#prompt-textarea').inputValue(), /用户草稿必须保持原样/);
    });

    await check('Escape cancels picker cursor/style state while leaving the reading panel usable', async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('html')).not.toHaveAttribute('data-tj-picking', 'true');
      await expect(page.locator('[data-tj-helper="pick-style"]')).toHaveCount(0);
      await expect(page.locator(`${HOST} .panel`)).toBeVisible();
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(0);
    });

    await check('explicit paragraph pick selects the entire answer, survives rescan, and plays only on click', async () => {
      await action(page, 'pick-message').click();
      await page.locator('[data-fixture-id="assistant-long"] .markdown p').first().click();
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(1);
      await expect(page.locator(`${HOST} .toc-button`).first()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`${HOST} .toc-button`).first()).toHaveAttribute('aria-label', /第一章：把注意力带回文字/);
      await expect(page.locator(`${HOST} .chapter-button`)).toHaveCount(4);
      await expect(action(page, 'toggle-play')).toBeEnabled();
      await expect(page.locator('html')).not.toHaveAttribute('data-tj-picking', 'true');
      await expect(page.locator('[data-tj-helper="pick-style"]')).toHaveCount(0);
      assert.equal(await page.evaluate(() => __pickerSpeech.utterances.length), 0);
      await action(page, 'refresh').click();
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(1);
      await expect(page.locator('[data-tj-helper="message-toolbar"]')).toHaveCount(1);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
      await action(page, 'toggle-play').click();
      await expect(action(page, 'toggle-play')).toHaveAttribute('aria-label', '暂停朗读');
      assert.equal(await page.evaluate(() => __pickerSpeech.utterances.length), 1);
      assert.match(await page.evaluate(() => __pickerSpeech.utterances[0].text), /第一章/);
      await action(page, 'stop').click();
    });

    const voicesPage = await createPage(true);
    await voicesPage.addScriptTag({content: script});
    await voicesPage.locator(HOST).waitFor({state: 'attached'});
    await action(voicesPage, 'toggle-panel').click();
    await check('voice enumeration failure preserves automatic directory scanning and manual picker controls', async () => {
      await expect(voicesPage.locator(`${HOST} .toc-button`)).toHaveCount(2);
      await expect(voicesPage.locator('[data-tj-helper="message-toolbar"]')).toHaveCount(2);
      await expect(action(voicesPage, 'pick-message')).toBeEnabled();
      await expect(voicesPage.locator(`${HOST} .notice`)).toHaveText(/系统音色暂时无法读取/);
      await voicesPage.locator(`${HOST} .toc-button`).first().click();
      await expect(voicesPage.locator(`${HOST} .chapter-button`)).toHaveCount(4);
      assert.equal(await voicesPage.evaluate(() => __pickerSpeech.utterances.length), 0);
      assert.equal(await voicesPage.evaluate(() => fixture.originalIntegrity()), true);
    });

    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log(`\n${passed} content/UI picker checks passed in Chromium. Synthetic conversation and mock speech only.`);
  } finally {
    await context.close(); await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
