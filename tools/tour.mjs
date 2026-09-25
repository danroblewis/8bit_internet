// Usage: node tools/tour.mjs <outdir> <settingsJSON> <name=url>...
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const [outdir, settingsArg, ...sites] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920', '--hide-crash-restore-bubble'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: +(process.env.DPR || 1) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const worker = await sw.worker();
await worker.evaluate(async (s, D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set({ ...D, ...s }); }, JSON.parse(settingsArg), DISK_DEFAULTS);
for (const site of sites) {
  const [name, url] = site.split(/=(.+)/);
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /bit8/i.test(m.text() + (m.location()?.url || ''))) errs.push(m.text()); });
  try {
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    await sleep(2500);
    await p.screenshot({ path: `${outdir}/${name}-0.png` });
    await p.mouse.move(640, 400);
    for (let k = 0; k < 10; k++) { await p.mouse.wheel({ deltaY: 120 }); await sleep(40); }
    await sleep(1400);
    await p.screenshot({ path: `${outdir}/${name}-1.png` });
    const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; window.scrollBy(0, 12); if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(Math.round(n / 1.5)); }; requestAnimationFrame(f); }));
    const dark = await p.evaluate(() => sessionStorage.getItem('__bit8_dark_' + location.hostname));
    console.log(name, 'fps', fps, 'dark', dark, errs.slice(0, 5).join(' | '));
  } catch (e) { console.log(name, 'ERR', e.message); }
  await p.close();
}
await b.close();
