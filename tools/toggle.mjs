import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const w = await sw.worker();
await w.evaluate(async (D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, intro: false, sound: true }); }, DISK_DEFAULTS);
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('https://en.wikipedia.org/wiki/Chiptune', { waitUntil: 'networkidle2' });
await sleep(1000);
for (let i = 0; i < 5; i++) { await p.mouse.move(300 + i * 60, 200 + i * 40); await p.mouse.click(300 + i * 60, 400); await sleep(100); }
const state = () => p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-bit8'), host: !!document.getElementById('bit8-hud-host'), stars: !!document.getElementById('bit8-stars'), filter: getComputedStyle(document.documentElement).filter, rv: document.querySelectorAll('[data-bit8-rv]').length, font: getComputedStyle(document.querySelector('p')).fontFamily.slice(0, 30) }));
console.log('on     ', JSON.stringify(await state()));
await w.evaluate(() => chrome.storage.sync.set({ enabled: false })); await sleep(500);
console.log('off    ', JSON.stringify(await state()));
await w.evaluate(() => chrome.storage.sync.set({ enabled: true, palette: 'gameboy' })); await sleep(500);
console.log('on/gb  ', JSON.stringify(await state()));
await w.evaluate(() => chrome.storage.sync.set({ disabledSites: ['en.wikipedia.org'] })); await sleep(500);
console.log('site off', JSON.stringify(await state()));
console.log('badge:', await w.evaluate(() => chrome.action.getBadgeText({})));
console.log('errors:', errs.filter(e => !/Failed to load resource/.test(e)).join(' | ') || 'none');
await b.close();
