/* Real Chromium regression against a synthetic conversation; speech stays mocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const {expect} = require('playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'build/chat-reader-extension');
const HOST = '#tingjian-chat-reader-ui';
const TOOLBAR = '[data-tj-helper="message-toolbar"]';
const COLLAPSED = 'tj-chatreader-content-collapsed';
const ACTIVE = '.tj-chatreader-active-paragraph';
const CHAT = 'https://chatgpt.com/c/fixture-a';
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
let passed = 0;
let skipped = 0;

function installSpeechMock() {
  const voices = [
    {voiceURI: 'fixture-zh', name: '本地测试中文', lang: 'zh-CN', localService: true, default: true},
    {voiceURI: 'fixture-en', name: 'Local test English', lang: 'en-US', localService: true, default: false},
  ];
  class Utterance extends EventTarget {
    constructor(text = '') {
      super(); this.text = text; this.rate = 1; this.volume = 1; this.lang = ''; this.voice = null;
    }
  }
  const synthesis = new EventTarget();
  const state = {
    utterances: [], cancelCount: 0, pauseCount: 0, resumeCount: 0,
    // Another page tool is already speaking. Scanning/selection/close must not interrupt it.
    externalActive: true,
    boundary(index = 0) {
      const utterance = this.utterances.at(-1);
      if (!utterance) throw new Error('No utterance for boundary event');
      const event = new Event('boundary');
      Object.defineProperties(event, {charIndex: {value: index}, name: {value: 'word'}});
      utterance.onboundary?.(event); utterance.dispatchEvent(event);
    },
    end() {
      const utterance = this.utterances.at(-1);
      if (!utterance) throw new Error('No utterance to finish');
      synthesis.speaking = false;
      const event = new Event('end');
      utterance.onend?.(event); utterance.dispatchEvent(event);
    },
    external() {this.externalActive = true; synthesis.speaking = true; synthesis.paused = false;},
  };
  Object.assign(synthesis, {
    speaking: true, paused: false, pending: false,
    getVoices: () => voices,
    speak(utterance) {
      state.utterances.push(utterance); state.externalActive = false;
      this.speaking = true; this.paused = false;
      queueMicrotask(() => {
        const event = new Event('start');
        utterance.onstart?.(event); utterance.dispatchEvent(event);
      });
    },
    cancel() {state.cancelCount++; state.externalActive = false; this.speaking = false; this.paused = false;},
    pause() {state.pauseCount++; this.paused = true;},
    resume() {state.resumeCount++; this.paused = false;},
  });
  Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: synthesis});
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable: true, value: Utterance});
  window.__speech = state;
  window.__networkCalls = [];
  const rejectNetwork = (type, url) => {
    window.__networkCalls.push({type, url: String(url)});
    throw new Error(`Unexpected network operation: ${type}`);
  };
  window.fetch = (url) => {rejectNetwork('fetch', url);};
  XMLHttpRequest.prototype.open = function(method, url) {rejectNetwork('xhr', url);};
  navigator.sendBeacon = (url) => {rejectNetwork('beacon', url);};
  window.WebSocket = function(url) {rejectNetwork('websocket', url);};
  window.EventSource = function(url) {rejectNetwork('eventsource', url);};
}

async function eventually(page, callback, argument) {
  await page.waitForFunction(callback, argument, {timeout: 7000});
}
async function check(name, body) {
  await body(); passed++;
  console.log(`  ✓ ${name}`);
}
const action = (page, name) => page.locator(`${HOST} [data-action="${name}"]`);
const long = page => page.locator('[data-fixture-id="assistant-long"]');
const stream = page => page.locator('[data-fixture-id="assistant-stream"]');
const speech = page => page.evaluate(() => ({count: __speech.utterances.length, cancel: __speech.cancelCount, pause: __speech.pauseCount, resume: __speech.resumeCount, external: __speech.externalActive, speaking: speechSynthesis.speaking, lastText: __speech.utterances.at(-1)?.text, rate: __speech.utterances.at(-1)?.rate, volume: __speech.utterances.at(-1)?.volume, voice: __speech.utterances.at(-1)?.voice?.voiceURI}));
async function inputRange(locator, value) {
  await locator.evaluate((node, next) => {node.value = String(next); node.dispatchEvent(new Event('input', {bubbles: true})); node.dispatchEvent(new Event('change', {bubbles: true}));}, value);
}
async function routeFixture(context, html, requests) {
  await context.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && /^https:\/\/chatgpt\.com\//.test(request.url())) {
      return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
    }
    requests.push({method: request.method(), url: request.url()});
    return route.abort('blockedbyclient');
  });
}
async function inject(page, script) {
  await page.addScriptTag({content: script});
  await page.locator(HOST).waitFor({state: 'attached', timeout: 7000});
  await eventually(page, () => document.querySelectorAll('[data-tj-helper="message-toolbar"]').length === 2);
}

async function main() {
  const [html, script] = await Promise.all([
    fs.readFile(path.join(__dirname, 'fixture.html'), 'utf8'),
    fs.readFile(path.join(BUILD, 'content.js'), 'utf8'),
  ]);
  const browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox']});
  const errors = [], requests = [];
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await routeFixture(context, html, requests);
  await context.addInitScript(installSpeechMock);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {if (message.type() === 'error') errors.push(`console: ${message.text()}`);});
  try {
    await page.goto(CHAT, {waitUntil: 'domcontentloaded'});
    await inject(page, script);
    await check('only assistant replies receive helpers; source nodes and native controls survive', async () => {
      assert.equal(await page.locator(TOOLBAR).count(), 2);
      assert.equal(await page.locator('[data-author="user"] ' + TOOLBAR).count(), 0);
      assert.equal(await page.locator('[data-author="user"] .' + COLLAPSED).count(), 0);
      assert.equal(await long(page).locator('.markdown').evaluate((node, css) => node.classList.contains(css), COLLAPSED), true);
      assert.equal(await page.locator('[data-fixture-id="assistant-short"] .markdown').evaluate((node, css) => node.classList.contains(css), COLLAPSED), false);
      assert.equal(await page.locator('article nav button').count(), 6);
      assert.equal(await page.locator('#native-send').isVisible(), true);
      assert.match(await page.locator('#prompt-textarea').inputValue(), /用户草稿必须保持原样/);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
      assert.deepEqual(await speech(page).then(({count,cancel,external}) => ({count,cancel,external})), {count: 0, cancel: 0, external: true});
    });

    await check('directory selection, panel close, and chapter navigation do not cancel external speech', async () => {
      await action(page, 'toggle-panel').click();
      assert.equal(await page.locator(`${HOST} .toc-button`).count(), 2);
      await page.locator(`${HOST} .toc-button`).nth(1).click();
      await expect(page.locator(`${HOST} .toc-button`).nth(1)).toHaveAttribute('aria-pressed', 'true');
      await action(page, 'close').click();
      await action(page, 'toggle-panel').click();
      await page.locator(`${HOST} .toc-button`).first().click();
      await expect(page.locator(`${HOST} .chapter-button`)).toHaveCount(4);
      await page.locator(`${HOST} .chapter-button`).nth(2).click();
      await eventually(page, () => {
        const node = [...document.querySelectorAll('[data-fixture-id="assistant-long"] h2')][1];
        const rect = node.getBoundingClientRect(); return rect.top >= -5 && rect.top < innerHeight - 30;
      });
      assert.equal((await speech(page)).cancel, 0);
      assert.equal((await speech(page)).count, 0);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
    });

    await check('explicit playback and boundary events update original paragraph highlight and paragraph number', async () => {
      await page.locator(`${HOST} .chapter-button`).first().click();
      await action(page, 'toggle-play').click();
      await eventually(page, () => __speech.utterances.length > 0);
      assert.match((await speech(page)).lastText, /第一章/);
      await expect(action(page, 'toggle-play')).toHaveAttribute('aria-label', '暂停朗读');
      await page.evaluate(() => __speech.boundary(2));
      await expect(page.locator(ACTIVE)).toHaveText(/第一章/);
      await expect(page.locator(`${HOST} .track-status`)).toHaveText(/第 1 \/ \d+ 段/);
      const baseline = (await speech(page)).count;
      await page.evaluate(() => __speech.end());
      await eventually(page, count => __speech.utterances.length > count, baseline);
      await page.evaluate(() => __speech.boundary(5));
      await expect(page.locator(ACTIVE)).toHaveText(/清晨的窗边/);
      await expect(page.locator(`${HOST} .track-status`)).toHaveText(/第 2 \/ \d+ 段/);
      assert.ok(Number(await action(page, 'seek').inputValue()) > 0);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
    });

    await check('pause/resume, voice, speed, volume, text progress, and paragraph navigation work with mock speech', async () => {
      await action(page, 'toggle-play').click();
      await expect(action(page, 'toggle-play')).toHaveAttribute('aria-label', '继续朗读');
      assert.equal((await speech(page)).pause, 1);
      await action(page, 'toggle-play').click();
      assert.equal((await speech(page)).resume, 1);
      await action(page, 'voice').selectOption('fixture-zh');
      await action(page, 'rate').selectOption('1.5');
      await inputRange(action(page, 'volume'), 35);
      await eventually(page, () => __speech.utterances.at(-1)?.rate === 1.5 && __speech.utterances.at(-1)?.volume === .35);
      assert.equal((await speech(page)).voice, 'fixture-zh');
      await inputRange(action(page, 'seek'), 650);
      await eventually(page, () => Number(document.querySelector('#tingjian-chat-reader-ui').shadowRoot.querySelector('[data-action="seek"]').value) >= 600);
      const beforeNext = await page.locator(`${HOST} .track-status`).textContent();
      await action(page, 'next-paragraph').click();
      await expect(page.locator(`${HOST} .track-status`)).not.toHaveText(beforeNext);
      await action(page, 'previous-paragraph').click();
      await expect(page.locator(`${HOST} .track-status`)).toHaveText(beforeNext);
      await action(page, 'stop').click();
      assert.equal((await speech(page)).speaking, false);
    });

    await check('rerender transfers active highlight; switching replies preserves the old reading position', async () => {
      await action(page, 'toggle-play').click();
      await inputRange(action(page, 'seek'), 550);
      await expect(action(page, 'seek')).toHaveValue(/5\d\d/);
      await expect(page.locator(ACTIVE)).toHaveCount(1);
      const beforeReplacement = await speech(page);
      const oldParagraph = await page.locator(ACTIVE).elementHandle();
      await page.evaluate(() => fixture.replaceAssistantContent());
      await eventually(page, () => document.querySelectorAll('.tj-chatreader-active-paragraph').length === 1);
      assert.equal(await oldParagraph.evaluate(node => node.isConnected), false);
      assert.equal((await speech(page)).count, beforeReplacement.count);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
      const savedProgress = Number(await action(page, 'seek').inputValue());
      const savedText = (await speech(page)).lastText;
      await page.locator(`${HOST} .toc-button`).nth(1).click();
      await expect(page.locator(`${HOST} .toc-button`).nth(1)).toHaveAttribute('aria-pressed', 'true');
      assert.equal((await speech(page)).speaking, false);
      await page.locator(`${HOST} .toc-button`).first().click();
      await expect(action(page, 'seek')).toHaveValue(String(savedProgress));
      const beforeResume = (await speech(page)).count;
      await action(page, 'toggle-play').click();
      await eventually(page, count => __speech.utterances.length > count, beforeResume);
      assert.equal((await speech(page)).lastText, savedText);
      assert.ok(Number(await action(page, 'seek').inputValue()) >= savedProgress);
      await action(page, 'stop').click();
    });

    await check('streaming replies stay expanded, refuse playback, and are recognized when completed', async () => {
      await page.evaluate(() => fixture.appendStreaming());
      await eventually(page, () => document.querySelectorAll('[data-tj-helper="message-toolbar"]').length === 3);
      assert.equal(await stream(page).locator('.markdown').evaluate((node, css) => node.classList.contains(css), COLLAPSED), false);
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(3);
      await page.locator(`${HOST} .toc-button`).last().click();
      const baseline = (await speech(page)).count;
      if (await action(page, 'toggle-play').isEnabled()) await action(page, 'toggle-play').click();
      assert.equal((await speech(page)).count, baseline);
      await expect(page.locator(`${HOST} .toc-button`).last()).toHaveAttribute('aria-label', /，正在生成$/);
      await page.evaluate(() => fixture.streamMore());
      assert.equal(await stream(page).locator('.markdown').evaluate((node, css) => node.classList.contains(css), COLLAPSED), false);
      // Generation can finish by changing attributes, without replacing nodes.
      await page.evaluate(() => fixture.finishStreaming({attributesOnly: true}));
      await eventually(page, css => document.querySelector('[data-fixture-id="assistant-stream"] .markdown').classList.contains(css), COLLAPSED);
      await expect(page.locator(`${HOST} .toc-button`).last()).not.toHaveAttribute('aria-label', /，正在生成$/);
      assert.equal(await page.locator('#native-stop').isVisible(), false);
      assert.equal((await speech(page)).count, baseline);
      await page.evaluate(() => document.getElementById('native-stop').remove());
    });

    await check('duplicate injection and source rerender keep one panel and one helper per reply', async () => {
      await page.addScriptTag({content: script});
      assert.equal(await page.locator(HOST).count(), 1);
      assert.equal(await page.locator(TOOLBAR).count(), 3);
      await page.evaluate(() => fixture.render());
      await eventually(page, () => document.querySelectorAll('[data-tj-helper="message-toolbar"]').length === 2);
      assert.equal(await page.locator(HOST).count(), 1);
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(2);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
    });

    await check('preferences survive reload without storing manuscript text', async () => {
      await action(page, 'rate').selectOption('1.25');
      await inputRange(action(page, 'volume'), 60);
      await action(page, 'auto-collapse').uncheck();
      await action(page, 'follow').uncheck();
      await eventually(page, () => localStorage.getItem('tingjian.chat-reader.v1')?.includes('1.25'));
      const stored = await page.evaluate(() => localStorage.getItem('tingjian.chat-reader.v1'));
      assert.ok(stored); assert.equal(stored.includes('清晨的窗边'), false);
      await page.reload({waitUntil: 'domcontentloaded'});
      await inject(page, script);
      await action(page, 'toggle-panel').click();
      await expect(action(page, 'rate')).toHaveValue('1.25');
      await expect(action(page, 'volume')).toHaveValue('60');
      await expect(action(page, 'auto-collapse')).not.toBeChecked();
      await expect(action(page, 'follow')).not.toBeChecked();
      await expect(action(page, 'voice')).toHaveValue('fixture-zh');
      assert.equal((await speech(page)).cancel, 0);
      assert.equal((await speech(page)).count, 0);
    });

    await check('SPA conversation changes stop owned narration and leave the next conversation intact', async () => {
      await page.locator(`${HOST} .toc-button`).first().click();
      await action(page, 'toggle-play').click();
      await eventually(page, () => __speech.utterances.length > 0);
      const baseline = (await speech(page)).cancel;
      await page.evaluate(() => fixture.navigate());
      await eventually(page, count => __speech.cancelCount > count && !speechSynthesis.speaking, baseline);
      await eventually(page, () => document.querySelectorAll('[data-tj-helper="message-toolbar"]').length === 1);
      await expect(page.locator(`${HOST} .toc-button`)).toHaveCount(1);
      assert.equal(await page.locator(ACTIVE).count(), 0);
      assert.equal(await page.evaluate(() => fixture.originalIntegrity()), true);
      await page.evaluate(() => __speech.external());
      const nextBaseline = (await speech(page)).cancel;
      await action(page, 'refresh').click();
      await page.locator(`${HOST} .toc-button`).first().click();
      await action(page, 'close').click();
      assert.equal((await speech(page)).cancel, nextBaseline);
      assert.equal((await speech(page)).external, true);
    });

    await check('390px narrow desktop window keeps the panel and controls within the viewport', async () => {
      await page.setViewportSize({width: 390, height: 844});
      await action(page, 'toggle-panel').click();
      const dimensions = await page.evaluate(() => {
        const host = document.getElementById('tingjian-chat-reader-ui');
        const panel = host.shadowRoot.querySelector('.panel');
        const bounds = panel.getBoundingClientRect();
        return {left: bounds.left, right: bounds.right, width: innerWidth, scroll: document.documentElement.scrollWidth,
          overflow: [...host.shadowRoot.querySelectorAll('button,input,select')].filter(node => !node.closest('[hidden]') && node.getBoundingClientRect().width).some(node => node.getBoundingClientRect().left < 0 || node.getBoundingClientRect().right > innerWidth + 1)};
      });
      assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.width);
      assert.ok(dimensions.scroll <= dimensions.width);
      assert.equal(dimensions.overflow, false);
    });

    await check('no chat network export, console errors, or uncaught injected exceptions', async () => {
      assert.deepEqual(await page.evaluate(() => __networkCalls), []);
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
    });
  } catch (error) {
    const screenshot = path.join(os.tmpdir(), `tingjian-chat-reader-failure-${process.pid}.png`);
    await page.screenshot({path: screenshot, fullPage: true}).catch(() => {});
    console.error(`Failure screenshot: ${screenshot}`);
    throw error;
  } finally {
    await context.close(); await browser.close();
  }

  // Load the actual MV3 directory too: validate automatic isolated-world injection
  // and chrome.storage.local, without pretending the main-world speech mock applies.
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'tingjian-extension-test-'));
  let extensionContext;
  try {
    extensionContext = await chromium.launchPersistentContext(profile, {
      executablePath, headless: true, viewport: {width: 1280, height: 900}, reducedMotion: 'reduce',
      ignoreDefaultArgs: ['--disable-extensions'],
      // Enable the CDP extension-test API only in this disposable profile.
      // Chromium's enterprise extension-install policies are still enforced.
      args: ['--no-sandbox', '--enable-unsafe-extension-debugging', `--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
    });
    const extensionSession = await extensionContext.browser().newBrowserCDPSession();
    let administratorBlocked = false;
    try {
      await extensionSession.send('Extensions.loadUnpacked', {path: BUILD});
    } catch (error) {
      if (!/Loading of unpacked extensions is disabled by the administrator/i.test(error.message)) throw error;
      administratorBlocked = true; skipped++;
      console.log('  ↷ SKIP actual MV3 installation/storage smoke: Chromium reports unpacked extensions are disabled by the administrator.');
    }
    if (!administratorBlocked) {
    const extensionRequests = [];
    await routeFixture(extensionContext, html, extensionRequests);
    const extensionPage = await extensionContext.newPage();
    const extensionErrors = [];
    extensionPage.on('pageerror', error => extensionErrors.push(error.message));
    await extensionPage.goto(CHAT, {waitUntil: 'domcontentloaded'});
    await check('actual MV3 content script injects automatically and restores extension storage preferences', async () => {
      await extensionPage.locator(HOST).waitFor({state: 'attached', timeout: 7000});
      await eventually(extensionPage, () => document.querySelectorAll('[data-tj-helper="message-toolbar"]').length === 2);
      await action(extensionPage, 'toggle-panel').click();
      await action(extensionPage, 'auto-collapse').uncheck();
      // The public UI debounces preference writes for 250ms.
      await extensionPage.waitForTimeout(500);
      await extensionPage.reload({waitUntil: 'domcontentloaded'});
      await extensionPage.locator(HOST).waitFor({state: 'attached', timeout: 7000});
      await action(extensionPage, 'toggle-panel').click();
      await expect(action(extensionPage, 'auto-collapse')).not.toBeChecked();
      assert.equal(await extensionPage.locator(TOOLBAR).count(), 2);
      assert.equal(await extensionPage.evaluate(() => fixture.originalIntegrity()), true);
      assert.equal(await extensionPage.evaluate(() => localStorage.getItem('tingjian.chat-reader.v1')), null);
      assert.deepEqual(extensionRequests, []);
      assert.deepEqual(extensionErrors, []);
    });
    }
  } finally {
    await extensionContext?.close();
    await fs.rm(profile, {recursive: true, force: true});
  }
  console.log(`\n${passed} Chromium regression checks passed; ${skipped} skipped. Synthetic ChatGPT fixture; mocked speech; no real account or mobile-device claim.`);
}

main().catch(error => {console.error(error); process.exitCode = 1;});
