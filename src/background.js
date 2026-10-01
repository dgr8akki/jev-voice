/**
 * Service worker: receives transcripts from the side panel, runs them through
 * the handler, and acts on the browser. The API key never leaves extension pages.
 */

import { createHandler } from './lib/handler.js';
import { JevError, createJevClient, sessionPauseStore } from './lib/jev.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
// Older Chrome refuses setAccessLevel on storage.local (sync throw or rejected
// promise). Uncaught, that kills the worker before onMessage registers below.
try {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch?.(() => {});
} catch {
  // No content scripts in this extension, and the functions it injects never
  // touch storage, so nothing untrusted reads the key without the lock either.
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

const jev = createJevClient({
  getKey: async () => (await chrome.storage.local.get('apiKey')).apiKey ?? '',
  getProvider: async () => (await chrome.storage.local.get('provider')).provider,
  // A 429 pause held in memory dies with the worker when Chrome shuts it down for idling; chrome.storage.session outlives it.
  pauseStore: sessionPauseStore(chrome.storage.session),
});

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

const handle = createHandler({
  jev,
  browser,
  hasKey: async () => Boolean((await chrome.storage.local.get('apiKey')).apiKey),
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'transcript') return false;
  handle(message).then(reply, (error) => {
    // Anything that is not a JevError is a bug or an API change; the generic line hides it, so log it.
    if (!(error instanceof JevError)) console.error('Jev Voice: command failed', error);
    // Partials are speculative: only a final transcript is worth an error line.
    const text = error instanceof JevError ? error.message : "Couldn't run that. Try once more.";
    reply(message.final ? { error: text } : {});
  });
  return true;
});
