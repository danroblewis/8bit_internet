import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [out, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920', '--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, intro: false, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.goto('https://en.wikipedia.org/wiki/Demoscene', { waitUntil: 'networkidle2' });
const v = await p.$('video');
if (!v) { console.log('no video element'); }
await v.evaluate((e) => e.scrollIntoView({ block: 'center' }));
await sleep(1500);
const box = await v.boundingBox(); console.log('video box', JSON.stringify(box));
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(4000);
await p.screenshot({ path: out });
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('video')].map((e) => {
  const chain = []; for (let x = e; x; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.filter !== 'none' || cs.position === 'fixed' || x.tagName === 'DIALOG') chain.push(x.tagName + '.' + (x.className || '').toString().slice(0, 40) + ' f=' + cs.filter.slice(0, 25) + ' pos=' + cs.position); }
  const r = e.getBoundingClientRect();
  return { paused: e.paused, t: e.currentTime.toFixed(1), ready: e.readyState, w: e.videoWidth, rect: [r.x, r.y, r.width, r.height].map(Math.round), src: (e.currentSrc || '').slice(-40), top: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName, chain };
})), null, 1));
await b.close();
