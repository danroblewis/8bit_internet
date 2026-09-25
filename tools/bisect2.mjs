// Profiles pipeline stages at DPR 2 by rewiring filter inputs (unused primitives are pruned).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [url, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 2) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, intro: false, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle2' });
await sleep(5000);
const fps = () => p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (now) => { n++; window.scrollBy(0, n % 80 < 40 ? 10 : -10); if (now - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / 2)); }; requestAnimationFrame(f); }));
const snapshot = await p.evaluate(() => [...document.getElementById('bit8-root').children].map((e) => [...e.attributes].map((a) => [a.name, a.value])));
const reset = () => p.evaluate((snap) => { [...document.getElementById('bit8-root').children].forEach((e, i) => { [...e.attributes].forEach((a) => e.removeAttribute(a.name)); snap[i].forEach(([n, v]) => e.setAttribute(n, v)); }); }, snapshot);
const V = async (name, js) => { await reset(); await p.evaluate((js) => { const f = document.getElementById('bit8-root'); new Function('f', 'q', js)(f, (s) => f.querySelector(s)); }, js); await sleep(400); await p.screenshot({ path: `/private/tmp/claude-501/-Users-danroblewis-8bit-internet/856099cb-2157-4bef-aa91-85c476f45266/scratchpad/bis-${name.replace(/\W+/g, '_')}.png`, clip: { x: 250, y: 150, width: 300, height: 120 } }); console.log(name.padEnd(30), await fps()); };
const consumerOf = (r) => `[...f.children].find(e=>e.getAttribute('in')==='${r}' || e.getAttribute('in2')==='${r}')`;
await V('full', '');
for (const sd of ['0.6', '2', '3', '4', '6', '10']) await V('blur sd ' + sd, `q('feGaussianBlur').setAttribute('stdDeviation','${sd}')`);
await p.evaluate(() => document.documentElement.removeAttribute('data-bit8')); await sleep(400);
console.log('extension off'.padEnd(30), await fps());
await b.close();
