import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

// Loads background.js against a chrome namespace shaped like an older Chrome,
// where storage.local.setAccessLevel is present but refuses the local area.
// The query string defeats the module cache so each case evaluates afresh.
async function load(name, setAccessLevel, store = {}, session = {}) {
  const listeners = { message: [], installed: [] };
  globalThis.chrome = {
    sidePanel: { setPanelBehavior() {} },
    storage: {
      local: { get: async () => store, setAccessLevel },
      session: {
        get: async (key) => ({ [key]: session[key] }),
        set: async (items) => Object.assign(session, items),
      },
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      openOptionsPage() {},
    },
    tabs: {},
    scripting: {},
  };
  let unhandled;
  const onUnhandled = (reason) => (unhandled = reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await import(`../src/background.js?${name}`);
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return { listeners, unhandled };
}

describe('background service worker', () => {
  it('registers its listeners when setAccessLevel throws synchronously', async () => {
    const { listeners } = await load('throws', () => {
      throw new TypeError('Access level is not supported for storage.local');
    });
    assert.equal(listeners.message.length, 1);
    assert.equal(listeners.installed.length, 1);
  });

  it('registers its listeners when setAccessLevel rejects, with no unhandled rejection', async () => {
    const { listeners, unhandled } = await load('rejects', () =>
      Promise.reject(new Error('Access level is not supported for storage.local')),
    );
    assert.equal(listeners.message.length, 1);
    assert.equal(unhandled, undefined);
  });

  it('logs failures that are not Jev errors and answers with the generic line', async () => {
    // chrome.tabs.query is missing from the stub, so the handler dies with a TypeError.
    const logged = [];
    const { error } = console;
    console.error = (...args) => logged.push(args);
    try {
      const { listeners } = await load('logs', () => {}, { apiKey: 'vck_test' });
      const [onMessage] = listeners.message;
      const reply = await new Promise((resolve) => {
        onMessage({ type: 'transcript', text: 'click the thing', final: true, id: 't1' }, {}, resolve);
      });
      assert.deepEqual(reply, { error: "Couldn't run that. Try once more." });
      assert.equal(logged.length, 1);
      assert.ok(
        logged[0].some((arg) => arg instanceof TypeError),
        'the original error is logged',
      );

      const partial = await new Promise((resolve) => {
        onMessage({ type: 'transcript', text: 'click the thing', final: false, id: 't2' }, {}, resolve);
      });
      assert.deepEqual(partial, {}, 'partials never show an error line');
      assert.equal(logged.length, 2, 'but the failure is still logged');
    } finally {
      console.error = error;
    }
  });

  it('keeps a 429 pause across a worker restart, in session storage', async () => {
    const fetches = [];
    globalThis.fetch = async (...args) => {
      fetches.push(args);
      return new Response('{}', { status: 429, headers: { 'retry-after': '40' } });
    };
    try {
      const session = {};
      const first = await load('pause1', () => {}, { apiKey: 'vck_test' }, session);
      globalThis.chrome.tabs = { query: async () => [{ id: 1, index: 0, windowId: 1, url: 'https://x.example/' }] };
      globalThis.chrome.scripting = { executeScript: async () => [{ result: ['link: Docs'] }] };
      const ask = (listeners, id) =>
        new Promise((resolve) => {
          listeners.message[0]({ type: 'transcript', text: 'click docs', final: true, id }, {}, resolve);
        });
      assert.match((await ask(first.listeners, 'p1')).error, /busy.*40s/);
      assert.equal(fetches.length, 1);
      assert.ok(session['jev:pausedUntil'] > Date.now(), 'the pause was written to chrome.storage.session');

      // A fresh worker: module state is gone, the session area is not.
      const second = await load('pause2', () => {}, { apiKey: 'vck_test' }, session);
      globalThis.chrome.tabs = { query: async () => [{ id: 1, index: 0, windowId: 1, url: 'https://x.example/' }] };
      globalThis.chrome.scripting = { executeScript: async () => [{ result: ['link: Docs'] }] };
      assert.match((await ask(second.listeners, 'p2')).error, /busy/);
      assert.equal(fetches.length, 1, 'no request while the persisted pause runs');
    } finally {
      delete globalThis.fetch;
    }
  });

  it('wraps around when switching past the last or first tab', async () => {
    const updates = [];
    const tabs = [
      { id: 1, index: 0, windowId: 1 },
      { id: 2, index: 1, windowId: 1 },
      { id: 3, index: 2, windowId: 1 },
    ];
    const store = { apiKey: 'vck_test' };
    const { listeners } = await load('tabs', () => {}, store);
    globalThis.chrome.tabs = {
      query: async ({ active }) => (active ? [tabs[2]] : tabs),
      update: async (id, props) => updates.push([id, props]),
    };
    const [onMessage] = listeners.message;
    const send = (text, id) =>
      new Promise((resolve) => onMessage({ type: 'transcript', text, final: true, id }, {}, resolve));
    assert.equal((await send('next tab', 'n1')).did, 'Switched to the next tab');
    assert.deepEqual(updates.at(-1), [1, { active: true }], 'after the last tab comes the first');
    globalThis.chrome.tabs.query = async ({ active }) => (active ? [tabs[0]] : tabs);
    assert.equal((await send('previous tab', 'n2')).did, 'Switched to the previous tab');
    assert.deepEqual(updates.at(-1), [3, { active: true }], 'before the first tab comes the last');
  });

  it('answers "No active tab." when there is none', async () => {
    const { listeners } = await load('notab', () => {}, { apiKey: 'vck_test' });
    globalThis.chrome.tabs = { query: async () => [] };
    const [onMessage] = listeners.message;
    const reply = await new Promise((resolve) => {
      onMessage({ type: 'transcript', text: 'go back', final: true, id: 't9' }, {}, resolve);
    });
    assert.deepEqual(reply, { error: 'No active tab.' });
  });

  it('ignores messages that are not transcripts', async () => {
    const { listeners } = await load('messages', () => {});
    const [onMessage] = listeners.message;
    assert.equal(
      onMessage({ type: 'ping' }, {}, () => {}),
      false,
    );
    assert.equal(
      onMessage(undefined, {}, () => {}),
      false,
    );
  });
});
