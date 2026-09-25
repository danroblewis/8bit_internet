import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 500, height: 620 });
await p.goto('file:///Users/danroblewis/8bit_internet/tools/testpages/feimage.html'); await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: '/private/tmp/claude-501/-Users-danroblewis-8bit-internet/856099cb-2157-4bef-aa91-85c476f45266/scratchpad/feimg.png' });
await b.close();
