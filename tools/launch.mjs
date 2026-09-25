// Opens Chrome with the extension loaded in an isolated profile (.chrome-profile).
// Branded Chrome 137+ ignores --load-extension, so this loads it over the DevTools pipe.
// Usage: npm start [url]
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'https://en.wikipedia.org/wiki/Video_game_graphics';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false, pipe: true, defaultViewport: null,
  enableExtensions: [new URL('../extension', import.meta.url).pathname],
  userDataDir: new URL('../.chrome-profile', import.meta.url).pathname,
  args: ['--window-size=1400,950', '--hide-crash-restore-bubble'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const [page] = await b.pages();
await page.goto(url).catch(() => {});
console.log('8-BIT INTERNET running. Close the Chrome window to exit.');
b.on('disconnected', () => process.exit(0));
