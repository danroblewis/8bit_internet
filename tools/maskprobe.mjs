import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const DISK_DEFAULTS = (() => { const self = {}; new Function('self', fs.readFileSync(new URL('../extension/shared.js', import.meta.url), 'utf8'))(self); return self.BIT8.DEFAULTS; })();
const SP = '/private/tmp/claude-501/-Users-danroblewis-8bit-internet/856099cb-2157-4bef-aa91-85c476f45266/scratchpad';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: ['/Users/danroblewis/8bit_internet/extension'], userDataDir: '/Users/danroblewis/8bit_internet/.chrome-profile-test',
  args: ['--window-size=1320,920'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 800 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
await (await sw.worker()).evaluate(async (D) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(D); }, DISK_DEFAULTS);
const p = await b.newPage();
await p.goto('https://en.wikipedia.org/wiki/Demoscene', { waitUntil: 'networkidle2' });
await sleep(2500);
const shot = async (name, js) => {
  await p.evaluate((js) => { const f = document.getElementById('bit8-root'); new Function('f', js)(f); }, js);
  await sleep(500); await p.screenshot({ path: `${SP}/mp-${name}.png` });
  console.log(name, await p.evaluate(() => { const c = document.createElement('canvas'); return 1; }));
};
// output = mask image, via plain href
await shot('href', `const ns='http://www.w3.org/2000/svg'; const fl=document.createElementNS(ns,'feFlood'); fl.setAttribute('flood-color','#000'); fl.setAttribute('result','blk'); f.appendChild(fl); const m=document.createElementNS(ns,'feMerge'); m.innerHTML='<feMergeNode in="blk"/><feMergeNode in="mask"/>'; f.appendChild(m);`);
// xlink:href
await shot('xlink', `const im=f.querySelector('feImage'); im.removeAttribute('href'); im.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href','#bit8-mask');`);
// reference a rect directly, outside <defs>
await shot('rect', `const svg=document.getElementById('bit8-defs'); let r=document.getElementById('probe-rect'); if(!r){r=document.createElementNS('http://www.w3.org/2000/svg','rect'); r.id='probe-rect'; r.setAttribute('x',100);r.setAttribute('y',100);r.setAttribute('width',400);r.setAttribute('height',300);r.setAttribute('fill','#fff'); svg.appendChild(r);} const im=f.querySelector('feImage'); im.setAttribute('href','#probe-rect'); im.removeAttributeNS('http://www.w3.org/1999/xlink','href');`);
await b.close();
