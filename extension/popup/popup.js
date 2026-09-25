const { PALETTES, PALETTE_ORDER, DEFAULTS, PIXEL_SIZES } = self.BIT8;

let S = { ...DEFAULTS };
let host = null;
let sel = 0;

const ITEMS = [
  { key: 'enabled', label: 'POWER', type: 'bool', cls: 'power' },
  { key: '__site', label: 'THIS SITE', type: 'site' },
  { sep: true },
  { key: 'palette', label: 'PALETTE', type: 'enum', opts: PALETTE_ORDER },
  { key: 'pixel', label: 'PIXELS', type: 'range', max: PIXEL_SIZES.length - 1 },
  { key: 'dither', label: 'DITHER', type: 'range', max: 3 },
  { key: 'fonts', label: 'FONTS', type: 'enum', opts: ['pixel', 'terminal', 'original'] },
  { key: 'chunky', label: 'CHUNKY TEXT', type: 'bool' },
  { sep: true },
  { key: 'crt', label: 'CRT GLOW', type: 'bool' },
  { key: 'stars', label: 'STARFIELD', type: 'bool' },
  { key: 'scrollFx', label: 'SCROLL FX', type: 'bool' },
  { key: 'scroller', label: 'SINE SCROLL', type: 'bool' },
  { key: 'hud', label: 'HUD', type: 'bool' },
  { key: 'intro', label: 'INTRO', type: 'bool' },
  { key: 'cursor', label: 'CURSOR', type: 'bool' },
  { key: 'sound', label: 'SOUND', type: 'bool' },
];
const selectable = ITEMS.map((it, i) => (it.sep ? -1 : i)).filter((i) => i >= 0);

// --- tiny chiptune for menu feedback
let actx;
function beep(f = 880, d = 0.05, type = 'square') {
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.05, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + d + 0.02);
  } catch (e) { /* no audio */ }
}

function siteOn() { return !S.disabledSites.includes(host); }

function valueHtml(it) {
  const arr = (s) => `<span class="arr">${s}</span>`;
  switch (it.type) {
    case 'bool': {
      const v = !!S[it.key];
      return `<span class="val ${v ? 'on' : 'off'}">${arr('&#9664;')}${v ? 'ON ' : 'OFF'}${arr('&#9654;')}</span>`;
    }
    case 'site': {
      if (!host) return `<span class="val off">N/A</span>`;
      const v = siteOn();
      return `<span class="val ${v ? 'on' : 'off'}">${arr('&#9664;')}${v ? 'ON ' : 'OFF'}${arr('&#9654;')}</span>`;
    }
    case 'enum': {
      const v = S[it.key];
      if (it.key === 'palette') {
        const p = PALETTES[v];
        const cols = p.type === 'map' ? p.colors : [p.ui.bg, p.ui.purple, p.ui.pink, p.ui.cyan, p.ui.yellow, p.ui.fg];
        return `<span class="val">${arr('&#9664;')}<span class="sw">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${arr('&#9654;')}</span>`;
      }
      return `<span class="val">${arr('&#9664;')}${v.toUpperCase()}${arr('&#9654;')}</span>`;
    }
    case 'range': {
      const v = S[it.key];
      let pips = '';
      for (let i = 0; i <= it.max; i++) pips += `<i class="${i <= v ? 'f' : ''}"></i>`;
      return `<span class="val">${arr('&#9664;')}<span class="pips">${pips}</span>${arr('&#9654;')}</span>`;
    }
  }
  return '';
}

function render() {
  const ul = document.getElementById('menu');
  ul.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const li = document.createElement('li');
    if (it.sep) { li.className = 'sep'; ul.appendChild(li); return; }
    const label = it.key === 'palette' ? `PALETTE <span style="color:var(--dim)">${PALETTES[S.palette].name}</span>` : it.label;
    li.innerHTML = `<span class="cur">&#9654;</span><span class="lbl">${label}</span>${valueHtml(it)}`;
    li.className = [it.cls, selectable[sel] === i ? 'sel' : '', !S.enabled && it.key !== 'enabled' ? 'disabled' : ''].filter(Boolean).join(' ');
    li.setAttribute('role', 'option');
    li.addEventListener('mouseenter', () => { if (selectable[sel] !== i) { sel = selectable.indexOf(i); beep(1200, 0.02); render(); } });
    li.addEventListener('click', () => change(it, 1));
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); change(it, -1); });
    ul.appendChild(li);
  });
}

function change(it, dir) {
  const patch = {};
  switch (it.type) {
    case 'bool': patch[it.key] = !S[it.key]; break;
    case 'site': {
      if (!host) return;
      const list = new Set(S.disabledSites);
      if (list.has(host)) list.delete(host); else list.add(host);
      patch.disabledSites = [...list];
      break;
    }
    case 'enum': {
      const i = it.opts.indexOf(S[it.key]);
      patch[it.key] = it.opts[(i + dir + it.opts.length) % it.opts.length];
      break;
    }
    case 'range': {
      const n = it.max + 1;
      patch[it.key] = (S[it.key] + dir + n) % n;
      break;
    }
  }
  Object.assign(S, patch);
  chrome.storage.sync.set(patch);
  const on = it.type === 'bool' || it.type === 'site' ? Object.values(patch)[0] : true;
  if (it.key === 'enabled' && on) { [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => beep(f, 0.08), k * 70)); }
  else beep(on === false ? 330 : 990, 0.06);
  render();
}

document.addEventListener('keydown', (e) => {
  const it = ITEMS[selectable[sel]];
  if (e.key === 'ArrowDown') { sel = (sel + 1) % selectable.length; beep(1200, 0.02); render(); }
  else if (e.key === 'ArrowUp') { sel = (sel - 1 + selectable.length) % selectable.length; beep(1200, 0.02); render(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') change(it, 1);
  else if (e.key === 'ArrowLeft') change(it, -1);
  else return;
  e.preventDefault();
});

// --- pixel logo: a space invader squad on a starfield
function drawLogo() {
  const c = document.getElementById('logo'), g = c.getContext('2d');
  const inv = ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'];
  let frame = 0;
  const stars = Array.from({ length: 40 }, () => [Math.random() * 128 | 0, Math.random() * 32 | 0, Math.random()]);
  const draw = () => {
    g.fillStyle = '#0d0521'; g.fillRect(0, 0, 128, 32);
    stars.forEach((s) => { if ((s[2] + frame * 0.07) % 1 > 0.3) { g.fillStyle = s[2] > 0.5 ? '#22f1ff' : '#7a2cff'; g.fillRect(s[0], s[1], 1, 1); } });
    const cols = ['#ff2bd6', '#ffe600', '#22f1ff'];
    for (let k = 0; k < 3; k++) {
      const ox = 22 + k * 32 + (frame % 2) * 2, oy = 10 + (k % 2 ? 2 : 0);
      g.fillStyle = cols[k];
      inv.forEach((row, y) => [...row].forEach((ch, x) => {
        let on = ch === 'X';
        if (frame % 2 && y === 7) on = row[x] === 'X' ? false : (x === 1 || x === 9);
        if (on) g.fillRect(ox + x, oy + y, 1, 1);
      }));
    }
    frame++;
  };
  draw();
  setInterval(draw, 450);
}

async function init() {
  S = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab.url);
    if (/^https?:$|^file:$/.test(u.protocol)) host = u.hostname || 'local';
  } catch (e) { /* no tab access */ }
  document.getElementById('site').textContent = host ? `@ ${host}` : 'NO PAGE HERE';
  drawLogo();
  render();
}
init();
