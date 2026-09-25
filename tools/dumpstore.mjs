import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pipe: true,
  enableExtensions: [new URL('../extension', import.meta.url).pathname], userDataDir: new URL('../' + (process.argv[2] || '.chrome-profile'), import.meta.url).pathname });
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
const w = await sw.worker();
console.log('ext url', sw.url());
console.log('sync', JSON.stringify(await w.evaluate(() => chrome.storage.sync.get(null))));
console.log('shared.js on disk as served:', (await w.evaluate(async () => (await (await fetch(chrome.runtime.getURL('shared.js'))).text()).match(/SCHEMA = \d|pixel: [\d.]+, palette: '\w+'/g))).join(' | '));
console.log('manifest cs', JSON.stringify(await w.evaluate(() => chrome.runtime.getManifest().content_scripts)));
await b.close();
