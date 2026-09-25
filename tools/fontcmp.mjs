// Renders the same Wikipedia crop with different body fonts under the current filter.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [out, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.goto('https://en.wikipedia.org/wiki/Demoscene', { waitUntil: 'networkidle2' });
await sleep(2500);
const fams = ["'Bit8 Body'", "'Bit8 UI'", "'Bit8 Mono'", "'Bit8 Tiny'", "'Bit8 Display'"];
for (const [i, f] of fams.entries()) {
  await p.evaluate((f) => { let s = document.getElementById('fcmp'); if (!s) { s = document.createElement('style'); s.id = 'fcmp'; document.head.append(s); } s.textContent = `#mw-content-text p, #mw-content-text p * { font-family: ${f} !important; }`; }, f);
  await sleep(500);
  await p.screenshot({ path: `${out}-${i}.png`, clip: { x: 260, y: 205, width: 430, height: 110 } });
}
await b.close();
