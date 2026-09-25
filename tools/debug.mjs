// Usage: node tools/debug.mjs <url> <scrollPx> <js-expression>
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [url, scroll, expr, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const worker = await sw.worker();
await worker.evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
p.on('console', (m) => console.log('console.' + m.type() + ': ' + m.text()));
await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2000);
await p.mouse.move(640, 400);
for (let y = 0; y < +scroll; y += 120) { await p.mouse.wheel({ deltaY: 120 }); await sleep(30); }
await sleep(1500);
console.log(JSON.stringify(await p.evaluate(expr), null, 1));
await b.close();
