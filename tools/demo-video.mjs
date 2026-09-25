// Launches the user's profile with the extension, plays the Big Buck Bunny video, keeps running.
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, pipe: true, defaultViewport: null,
  enableExtensions: [new URL('../extension', import.meta.url).pathname],
  userDataDir: new URL('../.chrome-profile', import.meta.url).pathname,
  args: ['--window-size=1400,950', '--hide-crash-restore-bubble', '--autoplay-policy=no-user-gesture-required'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [p] = await b.pages();
await p.goto('https://en.wikipedia.org/wiki/Big_Buck_Bunny', { waitUntil: 'networkidle2' });
const v = await p.$('video');
await v.evaluate((e) => e.scrollIntoView({ block: 'center' }));
await sleep(1500);
const box = await v.boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(3000);
await p.evaluate(() => { const v = [...document.querySelectorAll('video')].find((e) => !e.paused); if (v) v.currentTime = 60; });
console.log('READY pid', b.process().pid, JSON.stringify(await p.evaluate(() => ({ s: localStorage.getItem('__bit8_settings'), v: [...document.querySelectorAll('video')].map((e) => [e.paused, e.currentTime.toFixed(1)]) }))));
b.on('disconnected', () => process.exit(0));
