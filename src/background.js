/**
 * Service worker: receives transcripts from the side panel, runs them through
 * the handler, and acts on the browser. The API key never leaves extension pages.
 */

import { createHandler } from './lib/handler.js';
import { JevError, createJevClient } from './lib/jev.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const jev = createJevClient({
  getKey: async () => (await chrome.storage.local.get('apiKey')).apiKey ?? '',
});

/** @type {import('./lib/handler.js').Browser} */
const browser = {
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) throw new JevError('No active tab.');
    return tab;
  },
  async run(tabId, func, args = []) {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return injection?.result;
  },
  navigate: (tabId, url) => chrome.tabs.update(tabId, { url }),
  openTab: (url) => chrome.tabs.create(url ? { url } : {}),
  back: (tabId) => chrome.tabs.goBack(tabId),
  forward: (tabId) => chrome.tabs.goForward(tabId),
  reload: (tabId) => chrome.tabs.reload(tabId),
  closeTab: (tabId) => chrome.tabs.remove(tabId),
  async switchTab(tab, offset) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const index = (tab.index + offset + tabs.length) % tabs.length;
    const next = tabs.find((t) => t.index === index);
    if (next) await chrome.tabs.update(next.id, { active: true });
  },
};

const handle = createHandler({ jev, browser });

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'transcript') return false;
  handle(message).then(reply, (error) => {
    // Partials are speculative: only a final transcript is worth an error line.
    const text = error instanceof JevError ? error.message : 'Something went wrong. Try again.';
    reply(message.final ? { error: text } : {});
  });
  return true; // reply asynchronously
});
