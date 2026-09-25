// Badge + keyboard toggle only. Deliberately doesn't import shared.js: MV3 service workers
// cache importScripts() files, so a stale copy would write outdated defaults. Settings
// migration lives in the content script and popup, which always load fresh code.
async function updateBadge() {
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  await chrome.action.setBadgeBackgroundColor({ color: '#333333' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-8bit') return;
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  await chrome.storage.sync.set({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'enabled' in changes) updateBadge();
});
