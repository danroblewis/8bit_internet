import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [url, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 1) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle2' });
await sleep(2000);
const fps = () => p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (now) => { n++; window.scrollBy(0, n % 80 < 40 ? 10 : -10); if (now - t0 < 1500) requestAnimationFrame(f); else res(Math.round(n / 1.5)); }; requestAnimationFrame(f); }));
const orig = await p.evaluate(() => document.getElementById('bit8-root').innerHTML);
console.log('dpr', await p.evaluate(() => devicePixelRatio), 'prims', await p.evaluate(() => document.getElementById('bit8-root').children.length));
console.log('full           ', await fps());
const variant = async (name, fn) => { await p.evaluate((o, fn) => { const f = document.getElementById('bit8-root'); f.innerHTML = o; new Function('f', fn)(f); }, orig, fn); await sleep(300); console.log(name.padEnd(15), await fps()); };
const n = await p.evaluate(() => document.getElementById('bit8-root').children.length);
for (let k = 4; k <= n; k += 4) {
  await variant('first ' + k + ' ' + (await p.evaluate((o, k) => { const d = document.createElement('div'); d.innerHTML = '<svg><filter>' + o + '</filter></svg>'; return d.querySelector('filter').children[k - 1].outerHTML.slice(0, 70); }, orig, k)), `while (f.children.length > ${k}) f.lastElementChild.remove();`);
}
await b.close();
