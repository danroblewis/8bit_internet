// Usage: node tools/shoot.mjs <outprefix> <url> [scrollSteps] [settingsJSON]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [out, url, stepsArg = '3', settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'],
  userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920', '--hide-crash-restore-bubble'],
  ignoreDefaultArgs: ['--enable-automation'],
  defaultViewport: { width: 1280, height: 800 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// wait for the service worker, then push settings into chrome.storage.sync
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 10000 });
const worker = await sw.worker();
const settings = JSON.parse(settingsArg);
await worker.evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, settings, DISK_DEFAULTS);
const p = await b.newPage();
const errs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errs.push('goto: ' + e.message));
await sleep(2500);
const steps = +stepsArg;
for (let i = 0; i <= steps; i++) {
  await p.screenshot({ path: `${out}-${i}.png` });
  if (i < steps) { await p.mouse.move(640, 400); for (let k = 0; k < 8; k++) { await p.mouse.wheel({ deltaY: 110 }); await sleep(40); } await sleep(1300); }
}
const info = await p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-bit8'), defs: !!document.getElementById('bit8-defs'), fonts: [...document.fonts].filter((f) => f.family.includes('Bit8')).map((f) => f.family + ':' + f.status).join(','), dark: sessionStorage.getItem('__bit8_dark_' + location.hostname) }));
console.log(JSON.stringify(info));
console.log(errs.filter((e) => /bit8|chrome-extension|8-BIT/i.test(e) || errs.length < 8).slice(0, 15).join('\n'));
await b.close();
