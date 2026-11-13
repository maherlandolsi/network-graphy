/*
 * Relays socket events from content scripts to the DevTools page of the same tab,
 * and tells content scripts whether Network+ is currently inspecting their tab.
 */
'use strict';

const devtoolsPorts = new Map(); // tabId -> Set<Port>

function notifyTab(tabId, value) {
  browser.tabs.sendMessage(tabId, { type: 'np-inspected', value }).catch(() => { /* no content script */ });
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('np-devtools-')) {
    const tabId = Number(port.name.slice('np-devtools-'.length));
    if (!devtoolsPorts.has(tabId)) devtoolsPorts.set(tabId, new Set());
    devtoolsPorts.get(tabId).add(port);
    notifyTab(tabId, true);
    port.onDisconnect.addListener(() => {
      const set = devtoolsPorts.get(tabId);
      if (!set) return;
      set.delete(port);
      if (!set.size) {
        devtoolsPorts.delete(tabId);
        notifyTab(tabId, false);
      }
    });
    return;
  }

  if (port.name === 'np-relay') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    const frameId = (port.sender && port.sender.frameId) || 0;
    port.onMessage.addListener((msg) => {
      const set = devtoolsPorts.get(tabId);
      if (!set) return;
      for (const p of set) {
        try { p.postMessage(Object.assign({ frameId }, msg)); } catch (e) { /* port closed */ }
      }
    });
  }
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'np-is-inspected') {
    const tabId = sender.tab && sender.tab.id;
    return Promise.resolve(!!(devtoolsPorts.get(tabId) && devtoolsPorts.get(tabId).size));
  }
  return undefined;
});
