importScripts('shared.js');
const { DEFAULTS, SCHEMA } = self.BIT8;

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

async function updateBadge() {
  const s = await getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: s.enabled ? '#ff2bd6' : '#333333' });
  await chrome.action.setBadgeText({ text: s.enabled ? '' : 'OFF' });
}

chrome.runtime.onInstalled.addListener(async () => {
  // settings from an older schema meant different things: start over
  let s = await chrome.storage.sync.get(null);
  if (s.schema !== SCHEMA) { await chrome.storage.sync.clear(); s = {}; }
  // fill in any missing keys without clobbering the user's choices
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in s)) missing[k] = v;
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-8bit') return;
  const s = await getSettings();
  await chrome.storage.sync.set({ enabled: !s.enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) updateBadge();
});
