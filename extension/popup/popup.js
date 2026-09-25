const { PALETTES, PALETTE_ORDER, DEFAULTS, NOSTALGIA, PIXEL_SIZES, SCHEMA } = self.BIT8;

let S = { ...DEFAULTS };
let host = null;
let sel = 0;

const ITEMS = [
  { key: 'enabled', label: 'POWER', type: 'bool', cls: 'power' },
  { key: '__site', label: 'THIS SITE', type: 'site' },
  { sep: true },
  { key: 'nostalgia', label: 'NOSTALGIA', type: 'nostalgia', cls: 'big' },
  { sep: true, label: 'ADVANCED' },
  { key: 'palette', label: 'PALETTE', type: 'enum', opts: PALETTE_ORDER },
  { key: 'pixel', label: 'PIXEL SIZE', type: 'enum', opts: PIXEL_SIZES },
  { key: 'dither', label: 'DITHER PICS', type: 'range', max: 3 },
  { key: 'fonts', label: 'FONTS', type: 'enum', opts: ['pixel', 'terminal', 'original'] },
  { key: 'square', label: 'SQUARE CORNERS', type: 'bool' },
  { key: 'night', label: 'NIGHT MODE', type: 'bool' },
  { key: 'scrollFx', label: 'SCROLL FX', type: 'bool' },
  { key: 'warp', label: 'RGB WARP', type: 'bool' },
  { key: 'crt', label: 'CRT SCANLINES', type: 'bool' },
  { key: 'stars', label: 'STARFIELD', type: 'bool' },
  { key: 'hud', label: 'SCORE HUD', type: 'bool' },
  { key: 'intro', label: 'WORLD INTRO', type: 'bool' },
  { key: 'cursor', label: 'PIXEL CURSOR', type: 'bool' },
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

const siteOn = () => !S.disabledSites.includes(host);
// the slider shows CUSTOM once any setting it controls has been changed by hand
const isCustom = () => {
  const p = NOSTALGIA[S.nostalgia];
  return !p || Object.entries(p.set).some(([k, v]) => S[k] !== v);
};

function valueHtml(it) {
  const arr = (s) => `<span class="arr">${s}</span>`;
  const onOff = (v) => `<span class="val ${v ? 'on' : 'off'}">${arr('&#9664;')}${v ? 'ON ' : 'OFF'}${arr('&#9654;')}</span>`;
  switch (it.type) {
    case 'bool': return onOff(!!S[it.key]);
    case 'site': return host ? onOff(siteOn()) : `<span class="val off">N/A</span>`;
    case 'nostalgia': {
      let pips = '';
      for (let i = 1; i < NOSTALGIA.length; i++) pips += `<i class="${i <= S.nostalgia ? 'f' : ''}"></i>`;
      return `<span class="val">${arr('&#9664;')}<span class="pips big">${pips}</span>${arr('&#9654;')}</span>`;
    }
    case 'enum': {
      const v = S[it.key];
      if (it.key === 'palette') {
        const p = PALETTES[v];
        const cols = p.type === 'map' ? p.colors : previewColors(p);
        return `<span class="val">${arr('&#9664;')}<span class="sw">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${arr('&#9654;')}</span>`;
      }
      return `<span class="val">${arr('&#9664;')}${String(v).toUpperCase()}${it.key === 'pixel' ? 'PX' : ''}${arr('&#9654;')}</span>`;
    }
    case 'range': {
      let pips = '';
      for (let i = 1; i <= it.max; i++) pips += `<i class="${i <= S[it.key] ? 'f' : ''}"></i>`;
      return `<span class="val">${arr('&#9664;')}<span class="pips">${S[it.key] ? pips : 'OFF'}</span>${arr('&#9654;')}</span>`;
    }
  }
  return '';
}

// a few representative colors from a per-channel palette
function previewColors(p) {
  const hx = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const L = p.levels, top = (a) => a[a.length - 1], mid = (a) => a[Math.floor((a.length - 1) / 2)];
  return [hx(L.r[0], L.g[0], L.b[0]), hx(top(L.r), L.g[0], L.b[0]), hx(L.r[0], top(L.g), L.b[0]), hx(L.r[0], L.g[0], top(L.b)),
    hx(top(L.r), top(L.g), L.b[0]), hx(mid(L.r), mid(L.g), mid(L.b)), hx(top(L.r), top(L.g), top(L.b))];
}

function labelHtml(it) {
  if (it.key === 'palette') return `PALETTE <span class="dim">${PALETTES[S.palette].name}</span>`;
  if (it.key === 'nostalgia') return `NOSTALGIA <span class="year">${isCustom() ? 'CUSTOM' : NOSTALGIA[S.nostalgia].year}</span>`;
  return it.label;
}

function render() {
  const ul = document.getElementById('menu');
  ul.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const li = document.createElement('li');
    if (it.sep) {
      li.className = 'sep' + (it.label ? ' labeled' : '');
      if (it.label) li.textContent = it.label;
      ul.appendChild(li);
      return;
    }
    li.innerHTML = `<span class="cur">&#9654;</span><span class="lbl">${labelHtml(it)}</span>${valueHtml(it)}`;
    li.className = [it.cls, selectable[sel] === i ? 'sel' : '', !S.enabled && it.key !== 'enabled' ? 'disabled' : ''].filter(Boolean).join(' ');
    li.setAttribute('role', 'option');
    li.addEventListener('mouseenter', () => { if (selectable[sel] !== i) { sel = selectable.indexOf(i); beep(1200, 0.02); render(); } });
    li.addEventListener('click', (e) => {
      // click the left arrow half of a value to go backwards
      const val = li.querySelector('.val');
      const back = val && e.clientX < val.getBoundingClientRect().left + 12;
      change(it, back ? -1 : 1);
    });
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
    case 'nostalgia': {
      const n = NOSTALGIA.length - 1;
      const lvl = Math.min(n, Math.max(1, S.nostalgia + dir));
      Object.assign(patch, NOSTALGIA[lvl].set, { nostalgia: lvl });
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
  if (it.key === 'enabled' && on) [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => beep(f, 0.08), k * 70));
  else if (it.type === 'nostalgia') beep(300 + S.nostalgia * 180, 0.08);
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
  const stored = await chrome.storage.sync.get(null);
  if (stored.schema !== SCHEMA) {
    // settings from an older version meant different things
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(DEFAULTS);
    S = { ...DEFAULTS };
  } else {
    S = { ...DEFAULTS, ...stored };
  }
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
