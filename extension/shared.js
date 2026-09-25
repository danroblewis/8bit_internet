// Shared between the content script, popup and service worker.
//
// Palette types:
//   rgb:   each channel snaps to the nearest of a few levels (real 8-bit hardware palettes
//          like the Master System's 4x4x4 or the CPC's 3x3x3 work exactly this way), so
//          colors stay as close to the original page as the hardware allows.
//   map:   luminance -> palette entry (Game Boy / CGA / 1-bit). Changes colors a lot.
//   grade: saturate, then per-channel levels (the old neon look).
// `ui` holds colors for the extras we draw ourselves (HUD, particles, intro).
(function (root) {
  const STD_UI = { bg: '#000000', fg: '#ffffff', pink: '#ff55ff', cyan: '#55ffff', yellow: '#ffff55', purple: '#5555ff' };
  const lv = (n) => Array.from({ length: n }, (_, i) => i / (n - 1));

  const PALETTES = {
    msx: {
      name: 'MSX2 256', type: 'rgb',
      levels: { r: lv(8), g: lv(8), b: lv(4) }, // RGB332, SCREEN 8
      ui: STD_UI,
    },
    sms: {
      name: 'MASTER SYSTEM 64', type: 'rgb',
      levels: { r: lv(4), g: lv(4), b: lv(4) },
      ui: STD_UI,
    },
    cpc: {
      name: 'AMSTRAD CPC 27', type: 'rgb',
      levels: { r: lv(3), g: lv(3), b: lv(3) },
      ui: STD_UI,
    },
    bbc: {
      name: 'BBC MICRO 8', type: 'rgb',
      levels: { r: lv(2), g: lv(2), b: lv(2) },
      ui: { ...STD_UI, pink: '#ff00ff', cyan: '#00ffff', yellow: '#ffff00', purple: '#0000ff' },
    },
    gameboy: { name: 'GAME BOY', type: 'map', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    cga: { name: 'CGA MODE 4', type: 'map', colors: ['#000000', '#ff55ff', '#55ffff', '#ffffff'] },
    onebit: { name: '1-BIT', type: 'map', colors: ['#0a0a12', '#e9e6f5'] },
    neon: {
      name: 'NEON', type: 'grade', sat: 1.9, imgSat: 1.35,
      levels: { r: [0.05, 0.42, 0.86, 1.0], g: [0.02, 0.26, 0.78, 1.0], b: [0.17, 0.52, 0.9, 1.0] },
      ui: { bg: '#0d0521', fg: '#f4f0ff', pink: '#ff2bd6', cyan: '#22f1ff', yellow: '#ffe600', purple: '#7a2cff' },
    },
  };

  for (const p of Object.values(PALETTES)) {
    if (p.type !== 'map') continue;
    const c = p.colors, n = c.length;
    p.ui = { bg: c[0], fg: c[n - 1], pink: c[Math.max(1, n - 3)] || c[n - 1], cyan: c[n - 2] || c[n - 1], yellow: c[n - 1], purple: c[Math.min(1, n - 1)] };
  }

  const PALETTE_ORDER = ['msx', 'sms', 'cpc', 'bbc', 'gameboy', 'cga', 'onebit', 'neon'];
  const PIXEL_SIZES = [1, 1.5, 2.5, 3.5, 4.5, 5.5]; // CSS px (odd device px on Retina)

  // Nostalgia presets: one slider that sets everything below it.
  const NOSTALGIA = [
    null,
    { year: '1995', set: { pixel: 1.5, palette: 'msx', dither: 1, fonts: 'original', square: false, scrollFx: false, crt: false, warp: false, hud: false, intro: false, cursor: false, stars: false } },
    { year: '1990', set: { pixel: 1.5, palette: 'sms', dither: 2, fonts: 'pixel', square: true, scrollFx: true, crt: false, warp: false, hud: false, intro: false, cursor: false, stars: false } },
    { year: '1987', set: { pixel: 2.5, palette: 'cpc', dither: 2, fonts: 'pixel', square: true, scrollFx: true, crt: false, warp: false, hud: false, intro: false, cursor: false, stars: false } },
    { year: '1984', set: { pixel: 2.5, palette: 'bbc', dither: 3, fonts: 'pixel', square: true, scrollFx: true, crt: true, warp: false, hud: false, intro: false, cursor: false, stars: false } },
    { year: '1982', set: { pixel: 3.5, palette: 'bbc', dither: 3, fonts: 'terminal', square: true, scrollFx: true, crt: true, warp: true, hud: true, intro: true, cursor: true, stars: true } },
  ];

  const SCHEMA = 3; // bump when stored settings change meaning; older ones get reset
  const DEFAULTS = {
    schema: SCHEMA,
    enabled: true,
    disabledSites: [],
    nostalgia: 2,
    ...NOSTALGIA[2].set,
    night: false,      // flip light pages to dark
    sound: false,
  };

  root.BIT8 = { PALETTES, PALETTE_ORDER, DEFAULTS, NOSTALGIA, PIXEL_SIZES, SCHEMA };
})(typeof self !== 'undefined' ? self : this);
