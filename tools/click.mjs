import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [out, url, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, intro: false, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url, { waitUntil: 'networkidle2' });
await sleep(1500);
await p.mouse.click(700, 300); await sleep(120);
await p.keyboard.press('ArrowUp'); for (const k of ['ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']) await p.keyboard.press(k);
await sleep(300);
await p.screenshot({ path: out });
console.log('party:', await p.evaluate(() => document.documentElement.hasAttribute('data-bit8-party')), errs.join('|'));
await b.close();
