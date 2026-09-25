import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [url, settingsArg = '{}'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 1) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, intro: false, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
await sleep(6000);
const run = (px, force) => p.evaluate((px, force) => new Promise((res) => {
  const d = document.documentElement;
  let n = 0; const t0 = performance.now(); let worst = 0, last = t0;
  const f = (now) => { worst = Math.max(worst, now - last); last = now; n++; if (force === 'on') d.setAttribute('data-bit8-warp', ''); if (force === 'off') d.removeAttribute('data-bit8-warp');
    window.scrollBy(0, px * (Math.floor(n / 40) % 2 ? -1 : 1)); if (now - t0 < 2000) requestAnimationFrame(f); else res({ fps: Math.round(n / 2), worstMs: Math.round(worst) }); };
  requestAnimationFrame(f); }), px, force);
console.log('filter:', await p.evaluate(() => [devicePixelRatio, document.getElementById('bit8-root').querySelector('feMorphology').getAttribute('radius'), document.getElementById('bit8-root').children.length, document.documentElement.getAttribute('data-bit8-warp')]));
for (let i = 0; i < 2; i++) console.log('slow scroll (normal)      ', JSON.stringify(await run(10, 'off')));
await p.evaluate(() => { const f = document.getElementById('bit8-root'); f.innerHTML = f.innerHTML; });
console.log('after innerHTML reset     ', JSON.stringify(await run(10, 'off')));
console.log('fast scroll, warp blocked ', JSON.stringify(await run(80, 'off')));
console.log('fast scroll, warp forced  ', JSON.stringify(await run(80, 'on')));
console.log('static, warp forced       ', JSON.stringify(await run(0, 'on')));
await b.close();
