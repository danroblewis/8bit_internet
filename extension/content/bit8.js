/* 8-BIT INTERNET — content script
 *
 * Rendering pipeline (live SVG filter on <html>, no screenshots):
 *
 *   1. THE PIXEL: the page is resampled onto one global grid of P x P CSS-px blocks.
 *      Each block takes the min or the max of its pixels, whichever stands out from the
 *      local background, so hairlines and thin text strokes become full pixels instead of
 *      vanishing (point sampling) or turning into faint half-tones (averaging).
 *   2. [night mode: flip light pages dark]  [neon: saturate]
 *   3. ordered 4x4 Bayer dither, one threshold cell per pixel
 *   4. snap each channel to the nearest level of the palette (hardware-style palettes)
 *   5. [warp: RGB split along the scroll axis]
 *
 * Colors we paint ourselves (HUD, particles) go through pre(), the inverse of step 2.
 */
(() => {
  'use strict';
  if (window.__bit8Loaded) return;
  if (!(document.documentElement instanceof HTMLHtmlElement)) return;
  if (location.protocol === 'chrome-extension:') return;

  // Cross-site iframes render out-of-process, and SVG reference filters on the parent
  // don't reach into them. Those frames filter themselves ("frame mode": no HUD/overlay).
  // Same-site frames are already covered by the parent's filter, so they bail out.
  const siteOf = (h) => {
    const p = h.split('.');
    const n = p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu|ne|or)$/.test(p[p.length - 2]) ? 3 : 2;
    return p.slice(-n).join('.');
  };
  const FRAME = window.top !== window;
  if (FRAME) {
    const parent = location.ancestorOrigins && location.ancestorOrigins[0];
    if (!parent || !location.hostname) return;
    try { if (siteOf(new URL(parent).hostname) === siteOf(location.hostname)) return; } catch (e) { return; }
  }
  window.__bit8Loaded = true;

  const { PALETTES, DEFAULTS } = self.BIT8;
  const docEl = document.documentElement;
  const HOST = location.hostname || 'local';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LS_KEY = '__bit8_settings';

  let S = { ...DEFAULTS };
  let active = false;
  let pageLight = true;       // page background is light
  let invert = false;         // night mode is on and the page is light
  let started = false;
  let P;                      // current palette object

  // ---------------------------------------------------------------- color math
  // Affine color transforms {A: 3x3, b: [3]} operating on sRGB 0..1.
  const ID = { A: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], b: [0, 0, 0] };
  const INVERT = { A: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]], b: [1, 1, 1] };
  const LUM = [0.2126, 0.7152, 0.0722];
  const GRAY = { A: [LUM, LUM, LUM], b: [0, 0, 0] };

  const lin = (A) => ({ A, b: [0, 0, 0] });
  const mm = (X, Y) => X.map((r) => [0, 1, 2].map((j) => r[0] * Y[0][j] + r[1] * Y[1][j] + r[2] * Y[2][j]));
  const mv = (X, v) => X.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const comp = (f, g) => ({ A: mm(f.A, g.A), b: mv(f.A, g.b).map((v, i) => v + f.b[i]) }); // f∘g
  const apply = (f, c) => mv(f.A, c).map((v, i) => v + f.b[i]);
  function inv3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  }
  const invAff = (f) => { const Ai = inv3(f.A); return { A: Ai, b: mv(Ai, f.b).map((v) => -v) }; };
  const isId = (f) => f.A.every((r, i) => r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-6)) && f.b.every((v) => Math.abs(v) < 1e-6);
  function hueMat(deg) {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return [
      [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
      [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
      [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
    ];
  }
  const satMat = (s) => [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  const DARKMODE = comp(lin(hueMat(180)), INVERT); // invert lightness, keep hue
  const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const rgbCss = (c, a = 1) => `rgba(${c.map((v) => Math.round(clamp01(v) * 255)).join(',')},${a})`;
  const fe = (f) => f.A.map((r, i) => `${r.map((v) => v.toFixed(5)).join(' ')} 0 ${f.b[i].toFixed(5)}`).join(' ') + ' 0 0 0 1 0';

  // Derived transforms for the current palette/night state.
  let M_DARK, M_ROOT, M_COUNTER, M_PRE;
  function computeMatrices() {
    invert = !!S.night && pageLight;
    M_DARK = invert ? DARKMODE : ID;
    if (P.type === 'grade') {
      M_ROOT = comp(lin(satMat(P.sat)), M_DARK);
      M_PRE = invAff(M_ROOT);
      M_COUNTER = comp(M_PRE, lin(satMat(P.imgSat))); // media: undo root, then a bit of pop
    } else if (P.type === 'map') {
      M_ROOT = comp(GRAY, M_DARK);
      M_PRE = invAff(M_DARK);                          // gray is not invertible; luminance maps anyway
      M_COUNTER = M_PRE;
    } else {
      M_ROOT = M_DARK;
      M_PRE = invAff(M_DARK);
      M_COUNTER = M_PRE;
    }
  }

  // Color that, once the root filter runs over it, lands on `hex`.
  function pre(hex, a = 1) {
    const c = hex2rgb(hex);
    if (P.type === 'map') {
      let best = 0, bd = 1e9;
      P.colors.forEach((h, i) => {
        const p = hex2rgb(h);
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      const g = (best + 0.5) / P.colors.length;
      return rgbCss(apply(M_PRE, [g, g, g]), a);
    }
    return rgbCss(apply(M_PRE, c), a);
  }

  // When neither html nor body sets a background, Chrome paints the default white canvas
  // *outside* html's filter. Giving html an explicit copy of the page's root color moves it
  // inside the filter, so it gets transformed like everything else.
  let rootBg = [1, 1, 1];

  // ---------------------------------------------------------------- SVG filters
  let defs, stylesEl;
  let dprBuilt = 0;
  const pixelSize = () => Math.max(1, Math.min(8, +S.pixel || 1));

  // THE PIXEL. Filters run at device resolution, so blocks are sized in device pixels
  // (u = one device px in CSS units). Block sizes are odd so every window below can be
  // centered exactly on a block with no seams.
  //
  // Skia doesn't cache shared intermediate results inside a filter graph: anything read
  // twice is computed twice. So every expensive result is consumed exactly once; only
  // single-primitive nodes (erode/dilate of the source) are read more than once.
  function blockSize(Pz) {
    const dpr = Math.max(1, devicePixelRatio || 1);
    return { W: 2 * Math.ceil((Pz * dpr - 1) / 2 - 1e-6) + 1, u: 1 / dpr };
  }
  function pixelXml(Pz, input) {
    const { W, u } = blockSize(Pz);
    const c = (W - 1) / 2;            // block center, in device px
    const r = (c * u).toFixed(4);     // morphology radius covering exactly one block
    const B = W * u;                  // block size in CSS px
    const bg = rgbCss(rootBg);
    const x = `
      <feMorphology in="${input}" operator="erode" radius="${r}" result="mn"/>
      <feMorphology in="${input}" operator="dilate" radius="${r}" result="mx"/>
      <feGaussianBlur in="${input}" stdDeviation="${Math.max(3.5, B * 1.2).toFixed(3)}" result="mean"/>
      <feFlood flood-color="${bg}" result="pbg"/>
      <feComposite in="mean" in2="pbg" operator="arithmetic" k2="0.75" k3="0.25" result="ref"/>
      <feComposite in="mn" in2="mx" operator="arithmetic" k2="0.5" k3="0.5" result="mid"/>
      <feComposite in="ref" in2="mid" operator="arithmetic" k1="1" k2="60" k3="-60" result="cmp"/>
      <feComponentTransfer in="cmp" result="s"><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer>
      <feBlend in="mx" in2="mn" mode="difference" result="rng"/>
      <feBlend in="s" in2="rng" mode="multiply" result="sd"/>
      <feBlend in="mx" in2="sd" mode="difference" result="sel"/>
      <feFlood x="${c * u}" y="${c * u}" width="${u}" height="${u}" flood-color="#fff" result="dot"/>
      <feComposite in="dot" in2="dot" operator="over" x="0" y="0" width="${B}" height="${B}" result="cell"/>
      <feTile in="cell" result="grid"/>
      <feComposite in="sel" in2="grid" operator="in" result="pts"/>
      <feMorphology in="pts" operator="dilate" radius="${r}" result="px"/>`;
    // How the pick works, per channel: the block's extreme (min or max) that lies farther
    // from `ref` (local average nudged toward the page background) is the detail.
    // The blur is wide on purpose: it estimates the surrounding background (a header bar,
    // not a single letter), and Skia downsamples big sigmas, which makes it ~4x cheaper.
    // cmp = ref*mid + 60*(ref - mid) is ~1 when ref > mid (min is the outlier), else ~0;
    // sel = mx - s*(mx - mn).
    return { xml: x, out: 'px', cell: B };
  }

  // 4x4 ordered-dither threshold map built from floods (no data: URLs -> CSP-proof).
  function bayerXml(d) {
    const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    let x = '', names = [];
    m.forEach((v, i) => {
      const g = ((v + 0.5) / 16) * 100;
      x += `<feFlood x="${(i % 4) * d}" y="${(i >> 2) * d}" width="${d}" height="${d}" flood-color="rgb(${g}%,${g}%,${g}%)" result="b${i}"/>`;
      names.push(`<feMergeNode in="b${i}"/>`);
    });
    return x + `<feMerge x="0" y="0" width="${4 * d}" height="${4 * d}">${names.join('')}</feMerge><feTile result="bayer"/>`;
  }

  // Nearest-level lookup per channel, as a 64-step discrete table.
  const nearestTable = (levels) => Array.from({ length: 64 }, (_, i) => {
    const v = (i + 0.5) / 64;
    return levels.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  }).map((v) => v.toFixed(4)).join(' ');

  function quantXml(input) {
    if (P.type === 'map') {
      const cs = P.colors.map(hex2rgb), t = (k) => cs.map((c) => c[k].toFixed(4)).join(' ');
      return `<feComponentTransfer in="${input}" result="q"><feFuncR type="discrete" tableValues="${t(0)}"/><feFuncG type="discrete" tableValues="${t(1)}"/><feFuncB type="discrete" tableValues="${t(2)}"/></feComponentTransfer>`;
    }
    const L = P.levels;
    return `<feComponentTransfer in="${input}" result="q"><feFuncR type="discrete" tableValues="${nearestTable(L.r)}"/><feFuncG type="discrete" tableValues="${nearestTable(L.g)}"/><feFuncB type="discrete" tableValues="${nearestTable(L.b)}"/></feComponentTransfer>`;
  }

  // dither amplitude = fraction of the distance between adjacent levels
  function ditherAmp() {
    const n = P.type === 'map' ? P.colors.length : Math.min(P.levels.r.length, P.levels.g.length, P.levels.b.length);
    const step = P.type === 'map' ? 1 / n : 1 / (n - 1);
    return [0, 0.5, 0.8, 1.0][S.dither] * step * (P.type === 'map' ? 0.9 : 1);
  }

  let cellSize = 1;
  function rootXml(id, warp) {
    const Pz = pixelSize();
    let x = '', src = 'SourceGraphic';
    cellSize = Pz;
    if (blockSize(Pz).W > 1) {
      const px = pixelXml(Pz, src);
      x += px.xml; src = px.out; cellSize = px.cell;
    }
    if (!isId(M_ROOT)) { x += `<feColorMatrix in="${src}" type="matrix" values="${fe(M_ROOT)}" result="c"/>`; src = 'c'; }
    x += quantXml(src);
    if (warp) {
      // red one way, green+blue the other (q is read twice, not three times)
      x += `<feColorMatrix in="q" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/>
        <feOffset dx="0" dy="0" result="R2" class="wr"/>
        <feColorMatrix in="q" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
        <feOffset dx="0" dy="0" result="GB2" class="wb"/>
        <feBlend in="R2" in2="GB2" mode="screen"/>`;
    }
    // debugging: localStorage.__bit8_debug = '<result name>' shows that intermediate
    try {
      const dbg = localStorage.getItem('__bit8_debug');
      if (dbg && !warp) x += `<feFlood flood-color="#f0f" result="dbgbg"/><feMerge><feMergeNode in="dbgbg"/><feMergeNode in="${dbg}"/></feMerge>`;
    } catch (e) {}
    // userSpaceOnUse + a huge region: pages with html{height:100%} overflow their own box.
    return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20000" y="-20000" width="80000" height="4000000" color-interpolation-filters="sRGB">${x}</filter>`;
  }

  // Scroll-in mosaic for images (SNES style): coarse point-sampled blocks that shrink away.
  function mosaicXml(id, Px) {
    const h = (Px - 1) / 2;
    let x = `<feFlood x="${h}" y="${h}" width="1" height="1" flood-color="#fff"/>
      <feComposite width="${Px}" height="${Px}"/><feTile result="grid"/>
      <feComposite in="SourceGraphic" in2="grid" operator="in"/>
      <feMorphology operator="dilate" radius="${h}"/>`;
    if (!isId(M_COUNTER)) x += `<feColorMatrix type="matrix" values="${fe(M_COUNTER)}"/>`;
    return `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB" primitiveUnits="userSpaceOnUse">${x}</filter>`;
  }
  // Pictures get dithered; text and UI snap to flat nearest colors, the way 8-bit
  // programmers drew them. Each picture adds ordered-dither noise itself, with cells lined up
  // with the global pixel grid: one filter per grid phase (element offset mod block size).
  function ditherXml(id, phx, phy) {
    const B = cellSize, amp = ditherAmp();
    let x = '';
    if (invert || P.type === 'grade') x += `<feColorMatrix type="matrix" values="${fe(M_COUNTER)}" result="src"/>`;
    const src = x ? 'src' : 'SourceGraphic';
    const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const nodes = [];
    m.forEach((v, i) => {
      const g = ((v + 0.5) / 16) * 100;
      x += `<feFlood x="${(i % 4) * B - phx}" y="${(i >> 2) * B - phy}" width="${B}" height="${B}" flood-color="rgb(${g}%,${g}%,${g}%)" result="b${i}"/>`;
      nodes.push(`<feMergeNode in="b${i}"/>`);
    });
    x += `<feMerge x="${-phx}" y="${-phy}" width="${4 * B}" height="${4 * B}">${nodes.join('')}</feMerge><feTile result="bayer"/>
      <feComposite in="${src}" in2="bayer" operator="arithmetic" k2="1" k3="${amp.toFixed(4)}" k4="${(-amp / 2).toFixed(4)}" result="d"/>
      <feComposite in="d" in2="SourceGraphic" operator="in"/>`;
    return `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB" primitiveUnits="userSpaceOnUse">${x}</filter>`;
  }
  const counterXml = (id) => `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${fe(M_COUNTER)}"/></filter>`;

  const MOSAIC_POOL = 6;
  function buildDefs() {
    if (!defs) {
      defs = document.createElementNS(SVGNS, 'svg');
      defs.id = 'bit8-defs';
      defs.setAttribute('aria-hidden', 'true');
      defs.setAttribute('style', 'position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important;left:-9999px!important');
    }
    let mos = '';
    for (let i = 0; i < MOSAIC_POOL; i++) mos += mosaicXml(`bit8-mos-${i}`, 31);
    ditherPhases.clear();
    defs.innerHTML =
      rootXml('bit8-root', false) +
      (S.warp && !REDUCED ? rootXml('bit8-root-warp', true) : '') +
      counterXml('bit8-counter') +
      mos;
    dprBuilt = devicePixelRatio;
    if (!defs.isConnected) docEl.appendChild(defs);
  }

  // ---------------------------------------------------------------- CSS
  const ICONISH = ':not(i):not([class*="icon" i]):not([class*="fa-"]):not([class^="fa"]):not([class*="material" i]):not([class*="glyph" i]):not([class*="symbol" i]):not([class*="octicon"]):not([class*="codicon"]):not([data-icon]):not(svg):not(svg *)';

  function css() {
    const on = 'html[data-bit8~="on"]';
    const fonts = S.fonts;
    const F = {
      body: fonts === 'terminal' ? "'Bit8 Mono', monospace" : "'Bit8 Body', 'Bit8 Mono', monospace",
      head: fonts === 'terminal' ? "'Bit8 Mono', monospace" : "'Bit8 Display', monospace",
      ui: fonts === 'terminal' ? "'Bit8 Mono', monospace" : "'Bit8 UI', monospace",
      mono: "'Bit8 Mono', monospace",
    };
    const fontCss = fonts === 'original' ? '' : `
      ${on} body, ${on} body :where(*)${ICONISH} { font-family: ${F.body} !important; }
      ${on} body :is(h1, h2)${ICONISH}, ${on} body :is(h1, h2) :where(*)${ICONISH} {
        font-family: ${F.head} !important; font-size-adjust: ${fonts === 'terminal' ? 'ex-height 0.42' : 'ch-width 0.62'} !important;
        line-height: 1.35 !important; letter-spacing: 0 !important; }
      ${on} body :is(h3, h4, h5, h6, button, th, label, summary, [role="button"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"])${ICONISH} {
        font-family: ${F.ui} !important; font-size-adjust: ${fonts === 'terminal' ? 'ex-height 0.42' : 'ex-height 0.52'} !important; letter-spacing: 0.02em !important; }
      ${on} body :is(pre, code, kbd, samp, tt, textarea)${ICONISH}, ${on} body :is(pre, code) :where(*)${ICONISH} {
        font-family: ${F.mono} !important; font-size-adjust: ex-height 0.5 !important; }
      ${on} body :where(*)${ICONISH} { font-size-adjust: ${fonts === 'terminal' ? 'ex-height 0.46' : 'ex-height 0.53'}; -webkit-font-smoothing: none; }`;

    const counter = !isId(M_COUNTER);
    return `
      ${on} { filter: url(#bit8-root) !important; background-color: ${rgbCss(rootBg)} !important; }
      ${on}[data-bit8-warp] { filter: url(#bit8-root-warp) !important; }
      ${on}[data-bit8-party] { animation: bit8-party 1.6s linear infinite !important; }
      @keyframes bit8-party { ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${i * 12.5}% { filter: url(#bit8-root) hue-rotate(${i * 45}deg); }`).join(' ')} }

      ${counter ? `
      /* night mode: media keep their real colors */
      ${on} :is(img, video, canvas, [data-bit8-bg], iframe[data-bit8-embed]):not(#bit8-stars) { filter: url(#bit8-counter) !important; }
      ${on} [data-bit8-bg] :is(img, video, canvas) { filter: none !important; }` : ''}
      ${phaseCss}

      ${S.square ? `${on} body *:not(input[type="radio"]) { border-radius: 0 !important; }` : ''}

      ${fontCss}

      /* scroll reveal states (pending state must not use clip-path: IO ignores fully clipped targets) */
      ${on}[data-bit8-fx] [data-bit8-rv="h"] { opacity: 0; }
      ${on}[data-bit8-fx] [data-bit8-rv="h-go"] { animation: bit8-type .55s steps(14, end) both; }
      ${on}[data-bit8-fx] [data-bit8-rv="r"] { opacity: 0; }
      ${on}[data-bit8-fx] [data-bit8-rv="r-go"] { animation: bit8-rise .42s steps(4, end) both; }
      @keyframes bit8-type { from { clip-path: inset(0 100% 0 0); opacity: 1; } to { clip-path: inset(0 0 0 0); opacity: 1; } }
      @keyframes bit8-rise { from { opacity: 0; transform: translateY(${cellSize * 8}px); } to { opacity: 1; transform: none; } }

      ${on}[data-bit8-cursor], ${on}[data-bit8-cursor] body { cursor: ${cursorCss.arrow} !important; }
      ${on}[data-bit8-cursor] body :is(a[href], button, [role="button"], summary, select, label[for], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"]) { cursor: ${cursorCss.hand} !important; }
      ${on}[data-bit8-cursor] body :is(input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], textarea, [contenteditable="true"]) { cursor: text !important; }

      #bit8-stars { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: -1 !important; pointer-events: none !important; image-rendering: pixelated !important; filter: none !important; }

      @media print { ${on} { filter: none !important; } #bit8-stars, #bit8-hud-host { display: none !important; } }
    `;
  }

  function buildStyles() {
    if (!stylesEl) { stylesEl = document.createElement('style'); stylesEl.id = 'bit8-style'; }
    stylesEl.textContent = css();
    if (!stylesEl.isConnected) (document.head || docEl).appendChild(stylesEl);
  }

  // ---------------------------------------------------------------- fonts
  let fontsLoaded = false;
  async function loadFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    const list = [
      ['Bit8 Display', 'PressStart2P.woff2', {}],
      ['Bit8 UI', 'Silkscreen.woff2', { weight: '400' }],
      ['Bit8 UI', 'Silkscreen-Bold.woff2', { weight: '700' }],
      ['Bit8 Body', 'PixelifySans.woff2', { weight: '400 700' }],
      ['Bit8 Mono', 'VT323.woff2', {}],
      ['Bit8 Tiny', 'Tiny5.woff2', {}],
    ];
    await Promise.all(list.map(async ([fam, file, desc]) => {
      try {
        const buf = await (await fetch(chrome.runtime.getURL('fonts/' + file))).arrayBuffer();
        const face = new FontFace(fam, buf, { display: 'swap', ...desc });
        await face.load();
        document.fonts.add(face);
      } catch (e) { /* page keeps its own fonts */ }
    }));
  }

  // ---------------------------------------------------------------- pixel cursor
  const cursorCss = { arrow: 'auto', hand: 'pointer' };
  function makeCursors() {
    const draw = (rows, colors, scale, hx, hy, fallback) => {
      const h = rows.length, w = rows[0].length;
      const c = document.createElement('canvas');
      c.width = w * scale; c.height = h * scale;
      const g = c.getContext('2d');
      rows.forEach((r, y) => [...r].forEach((ch, x) => {
        if (ch === '.') return;
        g.fillStyle = colors[ch]; g.fillRect(x * scale, y * scale, scale, scale);
      }));
      return `url(${c.toDataURL()}) ${hx * scale} ${hy * scale}, ${fallback}`;
    };
    const arrow = [
      'K...........', 'KK..........', 'KWK.........', 'KWWK........', 'KWWWK.......', 'KWWWWK......',
      'KWWWWWK.....', 'KWWWWWWK....', 'KWWWWWWWK...', 'KWWWWWWWWK..', 'KWWWWWWWWWK.', 'KWWWWWKKKKKK',
      'KWWKWWK.....', 'KWK.KWWK....', 'KK..KWWK....', 'K....KWWK...', '.....KWWK...', '......KK....',
    ];
    const hand = [
      '....KK..........', '...KWWK.........', '...KWWK.........', '...KWWK.........', '...KWWKKK.......',
      '...KWWKWWKKK....', '...KWWKWWKWWKK..', 'KK.KWWKWWKWWKWK.', 'KWKKWWWWWWWWKWK.', 'KWWKWWWWWWWWWWK.',
      '.KWWWWWWWWWWWWK.', '..KWWWWWWWWWWWK.', '..KWWWWWWWWWWK..', '...KWWWWWWWWWK..', '....KWWWWWWWK...',
      '....KKKKKKKKK...',
    ];
    cursorCss.arrow = draw(arrow, { K: '#000000', W: '#ffffff' }, 2, 0, 0, 'auto');
    cursorCss.hand = draw(hand, { K: '#000000', W: '#ffffff' }, 2, 4, 0, 'pointer');
  }

  // ---------------------------------------------------------------- page background detection
  function parseColor(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 };
  }
  const relLum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  function bgOf(el) {
    for (; el && el.nodeType === 1 && el !== docEl; el = el.parentElement) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return null;
  }
  function pageRootBg() {
    // what the canvas would show: html bg, else body bg (propagated), else UA default
    const own = (el) => { const c = el && parseColor(getComputedStyle(el).backgroundColor); return c && c.a > 0.5 ? c : null; };
    // our own !important rule sets html's bg, so read the page's value with it lifted
    docEl.removeAttribute('data-bit8');
    const c = own(docEl) || own(document.body);
    const cs = getComputedStyle(docEl).colorScheme;
    if (active) docEl.setAttribute('data-bit8', 'on');
    return c ? c : /dark/.test(cs) && !/light/.test(cs) ? { r: 0.07, g: 0.07, b: 0.07, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
  }
  function pageIsLight() {
    if (!document.body) return null;
    const votes = [];
    const root = pageRootBg();
    rootBg = [root.r, root.g, root.b];
    votes.push(relLum(root));
    const w = innerWidth, h = innerHeight;
    for (const [x, y] of [[0.5, 0.5], [0.5, 0.2], [0.25, 0.6], [0.75, 0.4], [0.5, 0.85]]) {
      const el = document.elementFromPoint(w * x, h * y);
      if (!el || el.closest('#bit8-hud-host')) continue;
      const c = bgOf(el);
      votes.push(c ? relLum(c) : votes[0]);
    }
    votes.sort((a, b) => a - b);
    return votes[votes.length >> 1] >= 0.4;
  }
  function checkPage() {
    const prevBg = rootBg.join(), prevLight = pageLight;
    const light = pageIsLight();
    if (light === null) return;
    pageLight = light;
    try {
      sessionStorage.setItem('__bit8_light_' + HOST, light ? '1' : '0');
      sessionStorage.setItem('__bit8_bg_' + HOST, rootBg.join());
    } catch (e) {}
    if (active && (prevLight !== pageLight || prevBg !== rootBg.join())) refresh();
  }

  // ---------------------------------------------------------------- picture dithering
  const bgMedia = new Set();       // decorative background-image elements (no text)
  const ditherPhases = new Set();  // phase filters present in defs
  let ditherRaf = 0;
  function scheduleDither() {
    if (ditherRaf || !active) return;
    ditherRaf = requestAnimationFrame(() => { ditherRaf = 0; updateDither(); });
  }
  function updateDither() {
    if (!defs || !active) return;
    const on = ditherAmp() > 0;
    const els = [...document.querySelectorAll('img, video, canvas, svg image'), ...bgMedia];
    const dpr = Math.max(1, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(cellSize * dpr));
    let added = '';
    for (const el of els) {
      if (!el.isConnected || el.id === 'bit8-stars') continue;
      if (!on) { el.removeAttribute('data-bit8-ph'); continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) { el.removeAttribute('data-bit8-ph'); continue; }
      const px = ((Math.round((r.left + scrollX) * dpr) % W) + W) % W;
      const py = ((Math.round((r.top + scrollY) * dpr) % W) + W) % W;
      const ph = `${px}-${py}`;
      if (!ditherPhases.has(ph)) {
        ditherPhases.add(ph);
        added += ditherXml(`bit8-dith-${ph}`, px / dpr, py / dpr);
      }
      if (el.getAttribute('data-bit8-ph') !== ph) el.setAttribute('data-bit8-ph', ph);
    }
    if (added) defs.insertAdjacentHTML('beforeend', added);
    if (on) ensurePhaseCss(W);
  }
  let phaseCssW = 0;
  function ensurePhaseCss(W) {
    if (phaseCssW === W && stylesEl && stylesEl.textContent.includes('data-bit8-ph')) return;
    phaseCssW = W;
    let rules = '';
    for (let a = 0; a < W; a++) for (let b = 0; b < W; b++) {
      rules += `html[data-bit8~="on"] [data-bit8-ph="${a}-${b}"]:not([data-bit8-rv]) { filter: url(#bit8-dith-${a}-${b}) !important; }\n`;
    }
    phaseCss = rules;
    buildStyles();
  }
  let phaseCss = '';

  // ---------------------------------------------------------------- media tagging
  const tagged = new WeakSet();
  const EMBED_RE = /youtube|youtu\.be|vimeo|twitch|player|video|dailymotion|streamable/i;
  function tagMedia(rootNode) {
    const els = (rootNode.querySelectorAll ? rootNode : document).querySelectorAll('img, iframe');
    for (const el of els) {
      if (el.tagName === 'IFRAME') {
        if (EMBED_RE.test(el.src || '')) el.setAttribute('data-bit8-embed', '');
        continue;
      }
      if (!tagged.has(el)) { tagged.add(el); reveal.observeMedia(el); }
    }
  }

  // Background-image elements count as pictures (dither mask); in night mode they're also
  // counter-inverted so photos aren't negatives.
  const bgChecked = new WeakSet();
  function scanBackgrounds() {
    if (!document.body) return;
    const all = document.body.querySelectorAll('div, section, header, figure, a, span, li, article, aside, main, footer, picture');
    let i = 0;
    const step = (deadline) => {
      let n = 0;
      while (i < all.length && (deadline.timeRemaining() > 2 || n < 40)) {
        const el = all[i++]; n++;
        if (bgChecked.has(el)) continue;
        bgChecked.add(el);
        const bi = getComputedStyle(el).backgroundImage;
        if (!bi || bi === 'none' || !bi.includes('url(')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) continue;
        const hasText = (el.textContent || '').trim().length > 1;
        if (!hasText) bgMedia.add(el);
        if (invert) el.setAttribute('data-bit8-bg', '');
      }
      if (i < all.length) requestIdleCallback(step, { timeout: 1000 });
      else scheduleDither();
    };
    requestIdleCallback(step, { timeout: 1000 });
  }

  // ---------------------------------------------------------------- sound (WebAudio chiptune)
  const sfx = {
    ctx: null,
    ensure() {
      if (!S.sound) return null;
      if (!this.ctx) {
        try { this.ctx = new AudioContext(); } catch (e) { return null; }
        this.master = this.ctx.createGain(); this.master.gain.value = 0.07; this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, { type = 'square', at = 0, to = null, vol = 1 } = {}) {
      const ctx = this.ensure(); if (!ctx) return;
      const t = ctx.currentTime + at;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    blip() { this.tone(1320, 0.04, { vol: 0.35 }); },
    tick() { this.tone(2600, 0.012, { vol: 0.12 }); },
    coin() { this.tone(988, 0.07); this.tone(1319, 0.28, { at: 0.07 }); },
    jump() { this.tone(300, 0.18, { to: 900 }); },
    clear() {
      const seq = [392, 523, 659, 784, 1047, 1319, 1568];
      seq.forEach((f, i) => this.tone(f, 0.1, { at: i * 0.08, vol: 0.6 }));
      this.tone(1568, 0.5, { at: seq.length * 0.08, vol: 0.8 });
    },
    powerup() { [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => this.tone(262 * Math.pow(2, i / 5), 0.06, { at: i * 0.045, vol: 0.5 })); },
  };

  // ---------------------------------------------------------------- overlay (shadow DOM)
  let host, shadow, hud, fxCanvas, fxCtx, toastEl, introCanvas;
  function buildOverlay() {
    if (!host) {
      host = document.createElement('div');
      host.id = 'bit8-hud-host';
      host.setAttribute('style', 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;contain:strict!important;');
      shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style id="s"></style>
        <div id="crt"><div id="scan"></div><div id="vig"></div></div>
        <canvas id="fx"></canvas>
        <div id="toast"></div>
        <div id="hud" class="win">
          <div class="tb"><b>PLAYER 1</b><button id="snd" title="Sound">SND OFF</button><button id="min" title="Minimize">_</button></div>
          <div class="body">
            <div class="row"><span class="lbl">SCORE</span><span id="score" class="num">000000</span></div>
            <div class="row"><span class="lbl">HI</span><span id="hi" class="num">000000</span><span class="lbl">WORLD</span><span id="world" class="num">1-1</span></div>
            <div class="row stage"><span id="stage">&#9654; START</span></div>
            <div class="bar"><i id="prog"></i></div>
            <div class="row small"><span id="pct">0%</span><span id="lives">&#9829;x3</span><span id="fps">60 FPS</span></div>
          </div>
        </div>
        <button id="pill" title="Show HUD">P1 &#9650;</button>
        <canvas id="intro"></canvas>`;
      hud = shadow.getElementById('hud');
      fxCanvas = shadow.getElementById('fx'); fxCtx = fxCanvas.getContext('2d');
      toastEl = shadow.getElementById('toast');
      introCanvas = shadow.getElementById('intro');
      shadow.getElementById('snd').addEventListener('click', (e) => {
        e.stopPropagation();
        S.sound = !S.sound;
        chrome.storage.sync.set({ sound: S.sound });
        if (S.sound) { sfx.ensure(); sfx.coin(); }
        updateHudButtons();
      });
      shadow.getElementById('min').addEventListener('click', (e) => { e.stopPropagation(); setHudMin(true); sfx.blip(); });
      shadow.getElementById('pill').addEventListener('click', (e) => { e.stopPropagation(); setHudMin(false); sfx.blip(); });
    }
    shadow.getElementById('s').textContent = overlayCss();
    hud.classList.toggle('min', hudMin);
    shadow.getElementById('pill').classList.toggle('on', hudMin);
    if (!host.isConnected) docEl.appendChild(host);
    updateHudButtons();
    resizeCanvases();
  }

  function overlayCss() {
    const u = P.ui;
    const k = (h, a) => pre(h, a);
    const c = cellSize; // borders and offsets in whole pixels
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      canvas { position: absolute; left: 0; pointer-events: none; image-rendering: pixelated; }
      #fx { top: 0; width: 100%; height: 100%; }
      #intro { top: 0; width: 100%; height: 100%; display: none; }
      #crt { position: absolute; inset: 0; display: ${S.crt ? 'block' : 'none'}; }
      #scan { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0 ${c}px, ${k(u.bg, 0.18)} ${c}px ${c * 2}px); }
      #vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 60%, ${k(u.bg, 0.5)} 100%); }
      #toast { position: absolute; left: 50%; top: 22%; transform: translate(-50%, -50%); font: 16px/1.6 'Bit8 Display', monospace;
        color: ${k(u.yellow)}; background: ${k(u.bg)}; padding: ${c * 4}px ${c * 6}px; border: ${c * 2}px solid ${k(u.fg)};
        text-align: center; white-space: pre; opacity: 0; }
      #toast.show { animation: toast 2.4s steps(1, end) both; }
      @keyframes toast { 0% { opacity: 1; } 10% { opacity: 0; } 18% { opacity: 1; } 28% { opacity: .0; } 36%, 88% { opacity: 1; } 100% { opacity: 0; } }
      .win { position: absolute; left: ${c * 6}px; bottom: ${c * 6}px; width: 240px; pointer-events: auto;
        background: ${k(u.bg)}; border: ${c * 2}px solid ${k(u.fg)}; box-shadow: ${c * 2}px ${c * 2}px 0 0 ${k(u.bg)};
        font: 10px/1.2 'Bit8 Display', monospace; color: ${k(u.fg)}; display: ${S.hud ? 'block' : 'none'}; user-select: none; }
      .win.min { display: none; }
      .tb { display: flex; align-items: center; gap: ${c * 2}px; padding: ${c * 2}px; background: ${k(u.fg)}; color: ${k(u.bg)}; }
      .tb b { font: 9px 'Bit8 Display', monospace; flex: 1; padding: 0 ${c}px; }
      button { all: unset; cursor: pointer; font: 700 8px 'Bit8 UI', monospace; background: ${k(u.bg)}; color: ${k(u.fg)}; padding: ${c}px ${c * 2}px; }
      button:hover { background: ${k(u.cyan)}; color: ${k(u.bg)}; }
      .body { padding: ${c * 3}px; display: grid; gap: ${c * 3}px; }
      .row { display: flex; gap: ${c * 3}px; align-items: baseline; }
      .lbl { color: ${k(u.cyan)}; }
      #world { color: ${k(u.yellow)}; }
      .stage { color: ${k(u.fg)}; font: 15px 'Bit8 Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
      .bar { position: relative; height: ${c * 5}px; border: ${c}px solid ${k(u.fg)}; }
      .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: ${k(u.yellow)}; }
      .small { justify-content: space-between; font: 14px 'Bit8 Mono', monospace; }
      #lives { color: ${k(u.pink)}; }
      #pill { position: absolute; left: ${c * 6}px; bottom: ${c * 6}px; pointer-events: auto; display: none; border: ${c * 2}px solid ${k(u.fg)};
        font: 9px 'Bit8 Display', monospace; padding: ${c * 3}px; }
      #pill.on { display: ${S.hud ? 'block' : 'none'}; }
    `;
  }

  let hudMin = false;
  function setHudMin(v) {
    hudMin = v;
    hud.classList.toggle('min', v);
    shadow.getElementById('pill').classList.toggle('on', v);
    chrome.storage.local.set({ hudMin: v });
  }
  function updateHudButtons() {
    if (shadow) shadow.getElementById('snd').textContent = S.sound ? 'SND ON' : 'SND OFF';
  }
  function resizeCanvases() {
    if (!fxCanvas) return;
    fxCanvas.width = innerWidth; fxCanvas.height = innerHeight;
  }

  // ---------------------------------------------------------------- particles & floating text
  const parts = [];
  let fxRaf = 0;
  function burst(x, y, n = 14) {
    const u = P.ui, cols = [u.pink, u.cyan, u.yellow, u.fg].map((c) => pre(c));
    const c = Math.max(2, cellSize);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, life: 30 + Math.random() * 20, s: c * (1 + ((Math.random() * 2) | 0)), c: cols[i % cols.length] });
    }
    kickFx();
  }
  function floatText(x, y, text) {
    parts.push({ text, x, y, vy: -1.4, life: 50, c: pre(P.ui.yellow), sh: pre(P.ui.bg) });
    kickFx();
  }
  function kickFx() {
    if (fxRaf) return;
    const loop = () => {
      const g = Math.max(1, cellSize);
      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life--; p.y += p.vy;
        if (p.text) {
          fxCtx.font = "14px 'Bit8 Display', monospace";
          fxCtx.fillStyle = p.sh; fxCtx.fillText(p.text, Math.round(p.x) + g, Math.round(p.y) + g);
          fxCtx.fillStyle = p.c; fxCtx.fillText(p.text, Math.round(p.x), Math.round(p.y));
        } else {
          p.x += p.vx; p.vy += 0.35; p.vx *= 0.98;
          fxCtx.fillStyle = p.c;
          fxCtx.fillRect(Math.round(p.x / g) * g, Math.round(p.y / g) * g, p.s, p.s);
        }
        if (p.life <= 0) parts.splice(i, 1);
      }
      fxRaf = parts.length ? requestAnimationFrame(loop) : 0;
      if (!fxRaf) fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    };
    fxRaf = requestAnimationFrame(loop);
  }

  let toastTimer;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  // ---------------------------------------------------------------- starfield (dark pages only)
  let starsCanvas, starsCtx, stars = [], starsTimer;
  const pageDark = () => invert || !pageLight;
  function buildStars() {
    if (!S.stars || !pageDark()) { if (starsCanvas) starsCanvas.remove(); return; }
    if (!starsCanvas) {
      starsCanvas = document.createElement('canvas');
      starsCanvas.id = 'bit8-stars';
      starsCanvas.setAttribute('aria-hidden', 'true');
      starsCtx = starsCanvas.getContext('2d');
    }
    if (!starsCanvas.isConnected) docEl.insertBefore(starsCanvas, docEl.firstChild);
    sizeStars();
    if (!starsTimer) starsTimer = setInterval(() => drawStars(true), 280);
  }
  function sizeStars() {
    if (!starsCanvas) return;
    const sc = Math.max(2, cellSize);
    starsCanvas.width = Math.ceil(innerWidth / sc);
    starsCanvas.height = Math.ceil(innerHeight / sc);
    stars = [];
    const n = Math.round((starsCanvas.width * starsCanvas.height) / 260);
    for (let i = 0; i < n; i++) stars.push({ x: Math.random() * starsCanvas.width, y: Math.random() * 4000, z: [0.08, 0.2, 0.45][i % 3], tw: Math.random() });
    drawStars();
  }
  function drawStars(twinkle) {
    if (!starsCtx || !active || !S.stars || !starsCanvas.isConnected) return;
    const sc = Math.max(2, cellSize);
    const w = starsCanvas.width, h = starsCanvas.height, sy = scrollY / sc;
    starsCtx.clearRect(0, 0, w, h);
    const u = P.ui, cols = [pre(u.fg), pre(u.cyan), pre(u.pink), pre(u.yellow)];
    for (const s of stars) {
      if (twinkle && Math.random() < 0.04) s.tw = Math.random();
      if (s.tw < 0.12) continue;
      const y = (((s.y - sy * s.z) % h) + h) % h;
      starsCtx.fillStyle = cols[Math.floor(s.tw * 4) % 4];
      starsCtx.fillRect(s.x | 0, y | 0, 1, 1);
    }
  }

  // ---------------------------------------------------------------- intro (WORLD x-y + pixel iris)
  function worldOf() {
    let h = 0; for (const c of HOST) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const depth = location.pathname.split('/').filter(Boolean).length;
    return `${(h % 8) + 1}-${Math.min(depth + 1, 4)}`;
  }
  function runIntro() {
    if (!S.intro || REDUCED || !introCanvas) return;
    let seen = false;
    try { seen = sessionStorage.getItem('__bit8_intro_' + HOST) === '1'; sessionStorage.setItem('__bit8_intro_' + HOST, '1'); } catch (e) {}
    const cv = introCanvas, g = cv.getContext('2d');
    const SC = 8;
    cv.width = Math.ceil(innerWidth / SC); cv.height = Math.ceil(innerHeight / SC);
    cv.style.display = 'block';
    const bg = pre(P.ui.bg);
    const hold = seen ? 120 : 900;
    const dur = seen ? 380 : 650;
    const t0 = performance.now();
    const title = document.createElement('div');
    if (!seen) {
      title.setAttribute('style', `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;font:22px/1.4 'Bit8 Display',monospace;color:${pre(P.ui.fg)};text-align:center;pointer-events:none;`);
      title.innerHTML = `<div>WORLD <span style="color:${pre(P.ui.yellow)}">${worldOf()}</span></div><div style="font-size:13px;color:${pre(P.ui.cyan)};max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${HOST.toUpperCase().replace(/[<>&]/g, '')}</div><div style="font-size:14px;color:${pre(P.ui.pink)}">&#9829; x 3</div>`;
      shadow.appendChild(title);
    }
    const maxR = Math.hypot(cv.width, cv.height) / 2 + 2;
    const frame = (now) => {
      const el = now - t0;
      const p = Math.max(0, Math.min(1, (el - hold) / dur));
      const r = Math.round(maxR * (p * p) * 1.02);
      g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
      if (r > 0) {
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(cv.width / 2, cv.height / 2, r, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
      }
      if (el > hold && title.isConnected) title.remove();
      if (p < 1) requestAnimationFrame(frame);
      else cv.style.display = 'none';
    };
    requestAnimationFrame(frame);
    if (!seen) setTimeout(() => sfx.powerup(), hold);
  }

  // ---------------------------------------------------------------- scroll reveal + mosaic
  const reveal = (() => {
    let io, ioHeads;
    const freeMos = [...Array(MOSAIC_POOL).keys()];
    const pending = new WeakSet();

    function mosaic(el) {
      if (!freeMos.length) return;
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 60) return;
      const i = freeMos.pop();
      const id = `bit8-mos-${i}`;
      const steps = [31, 23, 17, 13, 9, 7, 5];
      let k = 0;
      el.style.setProperty('filter', `url(#${id})`, 'important');
      const f = () => {
        const node = defs && defs.querySelector('#' + id);
        if (!node || !active) return done();
        node.outerHTML = mosaicXml(id, steps[k]);
        if (++k >= steps.length) return setTimeout(done, 70);
        setTimeout(f, 70);
      };
      const done = () => { el.style.removeProperty('filter'); freeMos.push(i); };
      f();
    }

    function onEnter(entries) {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        const kind = el.getAttribute('data-bit8-rv');
        if (kind === 'h') {
          el.setAttribute('data-bit8-rv', 'h-go');
          sfx.tick(); setTimeout(() => sfx.tick(), 120); setTimeout(() => sfx.tick(), 240);
          setTimeout(() => el.getAttribute('data-bit8-rv') === 'h-go' && el.removeAttribute('data-bit8-rv'), 700);
        } else if (kind === 'r') {
          el.setAttribute('data-bit8-rv', 'r-go');
          setTimeout(() => el.getAttribute('data-bit8-rv') === 'r-go' && el.removeAttribute('data-bit8-rv'), 600);
        } else if (pending.has(el)) {
          pending.delete(el);
          mosaic(el);
        }
      }
    }

    function stageEnter(entries) {
      for (const e of entries) {
        if (!e.isIntersecting || e.boundingClientRect.top > innerHeight * 0.5) continue;
        const txt = e.target.textContent.trim().replace(/\s+/g, ' ');
        if (txt) game.enterStage(txt);
      }
    }

    return {
      init() {
        if (io) return;
        io = new IntersectionObserver(onEnter, { rootMargin: '0px 0px -6% 0px' });
        ioHeads = new IntersectionObserver(stageEnter, { rootMargin: '0px 0px -55% 0px' });
      },
      observeMedia(el) {
        if (!io || !S.scrollFx || REDUCED) return;
        const r = el.getBoundingClientRect();
        if (r.top > innerHeight) { pending.add(el); io.observe(el); }
      },
      scan() {
        if (!io || !document.body) return;
        const vh = innerHeight;
        document.querySelectorAll('h1, h2').forEach((h) => { if (!h.__bit8s) { h.__bit8s = 1; ioHeads.observe(h); } });
        if (!S.scrollFx || REDUCED) return;
        const els = document.body.querySelectorAll('h1, h2, h3, p, blockquote, pre, figure, table, li:not(nav li):not(li li):not([role="menuitem"])');
        let n = 0;
        for (const el of els) {
          if (el.__bit8r || n > 800) continue;
          el.__bit8r = 1; n++;
          const r = el.getBoundingClientRect();
          if (r.top < vh || r.height === 0 || r.height > vh * 1.3) continue;
          if (el.closest('[data-bit8-rv], nav, header, [role="navigation"], [aria-hidden="true"]')) continue;
          el.setAttribute('data-bit8-rv', /^H[1-3]$/.test(el.tagName) ? 'h' : 'r');
          io.observe(el);
        }
      },
      clear() {
        document.querySelectorAll('[data-bit8-rv]').forEach((e) => e.removeAttribute('data-bit8-rv'));
      },
    };
  })();

  // ---------------------------------------------------------------- game layer: score, HUD, warp
  const game = (() => {
    let score = 0, hi = 0, maxDepth = 0, cleared = false, stage = '', lastY = scrollY, lastT = performance.now(), vel = 0;
    let warpOn = false, warpDy = 0, raf = 0, frames = 0, fpsT = performance.now(), fps = 60;
    const pad = (n) => String(Math.min(999999, Math.floor(n))).padStart(6, '0');

    function add(n) {
      score += n;
      if (score > hi) { hi = score; saveHi(); }
    }
    let hiTimer;
    function saveHi() { clearTimeout(hiTimer); hiTimer = setTimeout(() => chrome.storage.local.set({ ['hi:' + HOST]: Math.floor(hi) }), 800); }

    function onScroll() {
      const now = performance.now(), y = scrollY;
      const dt = Math.max(1, now - lastT);
      vel = vel * 0.6 + (Math.abs(y - lastY) / dt) * 1000 * 0.4;
      lastY = y; lastT = now;
      if (y > maxDepth) { add((y - maxDepth) / 8); maxDepth = y; }
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      if (S.hud && !cleared && max > innerHeight * 1.5 && y >= max - 4) {
        cleared = true; add(5000); toast('COURSE CLEAR!\n+5000'); sfx.clear();
        burst(innerWidth / 2, innerHeight * 0.3, 40);
      }
      kick();
    }

    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    function tick(now) {
      raf = 0;
      frames++;
      if (now - fpsT > 1000) { frames = 0; fpsT = now; } // loop was asleep: restart the window
      else if (now - fpsT > 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
      if (now - lastT > 60) vel *= 0.8;
      const can = S.warp && !REDUCED;
      if (can && (vel > 2600 || (warpOn && vel > 900))) {
        const dy = Math.max(1, Math.min(4, Math.round(vel / 1400))) * Math.max(1, cellSize);
        if (!warpOn) { warpOn = true; docEl.setAttribute('data-bit8-warp', ''); }
        if (dy !== warpDy && defs) {
          warpDy = dy;
          defs.querySelectorAll('.wr').forEach((n) => n.setAttribute('dy', dy));
          defs.querySelectorAll('.wb').forEach((n) => n.setAttribute('dy', -dy));
        }
      } else if (warpOn) { warpOn = false; warpDy = 0; docEl.removeAttribute('data-bit8-warp'); }
      drawStars();
      renderHud();
      if (vel > 5 || warpOn) raf = requestAnimationFrame(tick);
    }

    function renderHud() {
      if (!shadow || !S.hud) return;
      const $ = (id) => shadow.getElementById(id);
      $('score').textContent = pad(score);
      $('hi').textContent = pad(hi);
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const pct = Math.round((Math.min(scrollY, max) / max) * 100);
      $('prog').style.width = Math.round(pct / 5) * 5 + '%';
      $('pct').textContent = pct + '%';
      $('fps').textContent = fps + ' FPS';
    }

    setInterval(() => {
      if (!active || !S.hud) return;
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); else { fps = Math.round((n * 1000) / (performance.now() - t0)); renderHud(); } };
      requestAnimationFrame(f);
    }, 2000);

    return {
      init(h) { hi = h || 0; if (shadow) shadow.getElementById('world').textContent = worldOf(); renderHud(); },
      onScroll,
      add,
      enterStage(txt) {
        if (txt === stage) return;
        stage = txt;
        if (shadow) shadow.getElementById('stage').textContent = '▶ ' + txt.toUpperCase();
        add(100);
      },
      render: renderHud,
    };
  })();

  // ---------------------------------------------------------------- input handlers
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiPos = 0;
  function onKey(e) {
    if (!active) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiPos = k === KONAMI[konamiPos] ? konamiPos + 1 : k === KONAMI[0] ? 1 : 0;
    if (konamiPos === KONAMI.length) {
      konamiPos = 0;
      const on = !docEl.hasAttribute('data-bit8-party');
      if (on) docEl.setAttribute('data-bit8-party', ''); else docEl.removeAttribute('data-bit8-party');
      toast(on ? 'CHEAT ACTIVATED\n30 LIVES' : 'CHEAT OFF');
      if (shadow) shadow.getElementById('lives').innerHTML = on ? '&#9829;x30' : '&#9829;x3';
      sfx.powerup(); game.add(30000);
      burst(innerWidth / 2, innerHeight / 2, 60);
    }
  }
  // click feedback belongs to the game layer (HUD on); sounds only when sound is on
  function onPointerDown(e) {
    if (!active || e.button !== 0) return;
    const a = e.target.closest && e.target.closest('a[href], button, [role="button"], input[type="submit"]');
    if (a) { sfx.coin(); game.add(100); } else sfx.jump();
    if (!S.hud) return;
    burst(e.clientX, e.clientY, a ? 16 : 8);
    if (a) floatText(e.clientX + 8, e.clientY - 10, '+100');
  }
  let lastHover = null;
  function onPointerOver(e) {
    if (!active || !S.sound) return;
    const a = e.target.closest && e.target.closest('a[href], button, [role="button"]');
    if (a && a !== lastHover) { lastHover = a; sfx.blip(); }
    else if (!a) lastHover = null;
  }

  // ---------------------------------------------------------------- lifecycle
  let mo, rescanTimer, listenersOn = false;
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      if (!active) return;
      tagMedia(document);
      if (!FRAME) reveal.scan();
      scanBackgrounds();
      scheduleDither();
      // re-attach our nodes if a framework wiped them
      if (defs && !defs.isConnected) docEl.appendChild(defs);
      if (stylesEl && !stylesEl.isConnected) (document.head || docEl).appendChild(stylesEl);
      if (host && !host.isConnected) docEl.appendChild(host);
    }, 350);
  }

  function refresh() {
    P = PALETTES[S.palette] || PALETTES.sms;
    computeMatrices();
    buildDefs();
    phaseCssW = 0;
    buildStyles();
    docEl.setAttribute('data-bit8', 'on');
    if (FRAME) { updateDither(); return; }
    buildOverlay();
    buildStars();
    toggleAttr('data-bit8-fx', S.scrollFx && !REDUCED);
    toggleAttr('data-bit8-cursor', S.cursor);
    if (invert) scanBackgrounds();
    updateDither();
    game.render();
  }
  const toggleAttr = (n, v) => (v ? docEl.setAttribute(n, '') : docEl.removeAttribute(n));

  function activate() {
    active = true;
    refresh();
    if (!listenersOn) {
      listenersOn = true;
      // zoom changes devicePixelRatio, and the pixel grid is built in device pixels
      addEventListener('resize', () => {
        if (!active) return;
        if (devicePixelRatio !== dprBuilt) refresh();
        scheduleDither();
        if (!FRAME) { resizeCanvases(); sizeStars(); }
      }, { passive: true });
      // picture rects move when images load or fixed elements scroll
      addEventListener('load', scheduleDither, { capture: true, passive: true });
      let scrollEnd;
      addEventListener('scroll', () => { clearTimeout(scrollEnd); scrollEnd = setTimeout(scheduleDither, 150); }, { passive: true });
      if (!FRAME) {
        addEventListener('scroll', game.onScroll, { passive: true });
        addEventListener('keydown', onKey, true);
        addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
        addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
      }
    }
    loadFonts();
    if (!FRAME) reveal.init();
    const onReady = () => {
      if (!active) return;
      checkPage();
      tagMedia(document);
      if (!FRAME) reveal.scan();
      scanBackgrounds();
      scheduleDither();
      if (!mo) {
        mo = new MutationObserver((ms) => {
          for (const m of ms) if (m.addedNodes.length) { scheduleRescan(); break; }
        });
        mo.observe(document.body || docEl, { childList: true, subtree: true });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();
    addEventListener('load', () => { checkPage(); scheduleRescan(); }, { once: true });
    setInterval(() => active && !document.hidden && scheduleDither(), 2000); // late layout shifts
    setTimeout(checkPage, 1500);
  }

  function deactivate() {
    active = false;
    ['data-bit8', 'data-bit8-warp', 'data-bit8-party', 'data-bit8-fx', 'data-bit8-cursor'].forEach((a) => docEl.removeAttribute(a));
    if (host) host.remove();
    if (starsCanvas) starsCanvas.remove();
    reveal.clear();
  }

  function isOnHere(s) { return s.enabled && !(s.disabledSites || []).includes(HOST); }

  function applySettings(next, first) {
    const prev = S;
    S = { ...DEFAULTS, ...next };
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
    const want = isOnHere(S);
    if (want && !active) { activate(); if (first && !FRAME) runIntro(); }
    else if (!want && active) deactivate();
    else if (want && active) {
      refresh();
      if (prev.scrollFx !== S.scrollFx) { if (!S.scrollFx) reveal.clear(); else reveal.scan(); }
    }
  }

  // ---- boot: apply cached settings synchronously to avoid a flash, then sync with storage
  const current = (s) => s && s.schema === DEFAULTS.schema;
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (current(cached)) S = { ...DEFAULTS, ...cached };
  } catch (e) {}
  try {
    const l = sessionStorage.getItem('__bit8_light_' + HOST);
    if (l !== null) pageLight = l === '1';
    const bg = sessionStorage.getItem('__bit8_bg_' + HOST);
    if (bg) rootBg = bg.split(',').map(Number);
  } catch (e) {}
  makeCursors();
  if (isOnHere(S)) { activate(); started = true; if (!FRAME) runIntro(); }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    chrome.storage.local.get(['hi:' + HOST, 'hudMin'], (loc) => {
      if (loc.hudMin) hudMin = true;
      applySettings(current(stored) ? stored : DEFAULTS, !started);
      if (FRAME) return;
      game.init(loc['hi:' + HOST]);
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...S };
    for (const [k, v] of Object.entries(changes)) if (v.newValue !== undefined) next[k] = v.newValue;
    applySettings(next, false);
    updateHudButtons();
  });
})();
