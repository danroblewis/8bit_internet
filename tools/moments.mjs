// Captures the intro sequence, a mosaic reveal mid-animation, fast-scroll warp, and the popup.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const SP = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const worker = await sw.worker();
const extId = new URL(sw.url()).host;
await worker.evaluate(async (D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D }); }, DISK_DEFAULTS);
const p = await b.newPage();
p.goto('https://unsplash.com/t/architecture-interior').catch(() => {});
for (const t of [350, 900, 1250]) { await sleep(t === 350 ? 350 : t - (t === 900 ? 350 : 900)); await p.screenshot({ path: `${SP}/intro-${t}.png` }); }
await sleep(3000);
await p.mouse.move(640, 400);
for (let k = 0; k < 6; k++) { await p.mouse.wheel({ deltaY: 130 }); await sleep(30); }
await sleep(160);
await p.screenshot({ path: `${SP}/mosaic-mid.png` });
await sleep(1500);
// warp: very fast scroll
const warpShot = p.evaluate(() => new Promise((res) => { let n = 0; const f = () => { window.scrollBy(0, 90); if (++n < 30) requestAnimationFrame(f); else res(document.documentElement.hasAttribute('data-bit8-warp')); }; requestAnimationFrame(f); }));
await sleep(250);
await p.screenshot({ path: `${SP}/warp.png` });
console.log('warp attr during fast scroll:', await warpShot);
const pp = await b.newPage();
await pp.setViewport({ width: 380, height: 760 });
await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
await sleep(800);
await pp.keyboard.press('ArrowDown'); await pp.keyboard.press('ArrowDown'); await sleep(200);
await pp.screenshot({ path: `${SP}/popup.png` });
await b.close();
