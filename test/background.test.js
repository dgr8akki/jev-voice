import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

// Loads background.js against a chrome namespace shaped like an older Chrome,
// where storage.local.setAccessLevel is present but refuses the local area.
// The query string defeats the module cache so each case evaluates afresh.
async function load(name, setAccessLevel, store = {}) {
  const listeners = { message: [], installed: [] };
  globalThis.chrome = {
    sidePanel: { setPanelBehavior() {} },
    storage: { local: { get: async () => store, setAccessLevel } },
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
      assert.deepEqual(reply, { error: 'Something went wrong. Try again.' });
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
