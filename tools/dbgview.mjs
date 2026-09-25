// Usage: node tools/dbgview.mjs <out.png> <resultName> [url] [settingsJSON]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [out, name, url = 'https://en.wikipedia.org/wiki/Demoscene', settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 1) } });
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.evaluateOnNewDocument((n) => { try { localStorage.setItem('__bit8_debug', n); } catch (e) {} }, name);
await p.goto(url, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: out });
console.log(await p.evaluate(() => { const i = document.querySelector('#bit8-root feImage'); return i && i.outerHTML; }));
await b.close();
