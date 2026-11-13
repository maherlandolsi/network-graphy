/*
 * Isolated-world content script. Forwards socket events from content/hook.js to
 * the background script, but only while DevTools with Network+ is open on this tab.
 */
(() => {
  'use strict';
  const MAX_PENDING = 500;
  let inspected = null; // null = unknown yet, then true/false
  let pending = [];
  let port = null;

  function send(msg) {
    try {
      if (!port) {
        port = browser.runtime.connect({ name: 'np-relay' });
        port.onDisconnect.addListener(() => { port = null; });
      }
      port.postMessage(msg);
    } catch (e) {
      port = null;
    }
  }

  function setInspected(value) {
    const was = inspected;
    inspected = !!value;
    if (inspected && was === null) {
      pending.forEach(send); // events captured while we didn't know yet
    } else if (inspected && was === false) {
      window.postMessage({ source: 'network-plus-relay', kind: 'replay' }, '*');
    }
    pending = [];
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'network-plus-hook') return;
    const { source, ...msg } = e.data;
    if (inspected) send(msg);
    else if (inspected === null) {
      pending.push(msg);
      if (pending.length > MAX_PENDING) pending.shift();
    }
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'np-inspected') setInspected(msg.value);
  });

  browser.runtime.sendMessage({ type: 'np-is-inspected' })
    .then((v) => { if (inspected === null) setInspected(v); })
    .catch(() => { if (inspected === null) setInspected(false); });
})();
