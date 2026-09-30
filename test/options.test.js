import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../src/options/options.html', import.meta.url), 'utf8');

/** `chrome.storage.local` over a plain object, so tests can read what was saved. */
function fakeChrome(store) {
  return {
    store,
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.filter((name) => name in store).map((name) => [name, store[name]]));
        },
        async set(values) {
          Object.assign(store, values);
        },
        async remove(key) {
          delete store[key];
        },
      },
    },
  };
}

let restore = () => {};
let seq = 0;
const errors = [];
afterEach(() => {
  restore();
  delete globalThis.fetch;
  errors.length = 0;
});

/**
 * Loads the real options page against a fresh copy of options.js. `replies`
 * feed the key check in order: a Response, or an Error for fetch to throw.
 */
async function load({ store = {}, replies = [] } = {}) {
  const { window } = new JSDOM(html, { url: 'chrome-extension://test/options/options.html', pretendToBeVisual: true });
  const chrome = fakeChrome(store);
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'chrome', 'console'];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const quiet = { ...console, error: (...args) => errors.push(args) };
  for (const name of names) {
    define(name, name === 'window' ? window : name === 'chrome' ? chrome : name === 'console' ? quiet : window[name]);
  }
  restore = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  globalThis.fetch = async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  await import(`../src/options/options.js?case=${seq++}`);
  await settle();
  return { chrome, window, document: window.document, $: (id) => window.document.getElementById(id) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (status, body) => new Response(JSON.stringify(body), { status });
const answered = () => json(200, { answers: { ok: { type: 'choice', choice: 'yes', confidence: 0.99 } } });

async function connect({ $, window }, key) {
  $('api-key').value = key;
  $('key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  for (let i = 0; i < 4; i += 1) await settle();
}

describe('options page', () => {
  it('saves a key the provider answers for, then shows the connected card', async () => {
    const page = await load({ replies: [answered()] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.chrome.store.apiKey, 'vck_abcdefghijklmnop1234');
    assert.equal(page.$('key-form').hidden, true);
    assert.match(page.$('connected-status').textContent, /^Key works\./);
  });

  it('keeps the old key and shows an error when a 200 does not answer the question', async () => {
    const store = { apiKey: 'vck_oldoldoldoldold1234', provider: 'vercel' };
    const page = await load({ store, replies: [json(200, {}), json(200, { answers: { ok: { type: 'choice' } } })] });
    page.$('replace').click();
    await connect(page, 'vck_newnewnewnewnew5678');
    assert.equal(store.apiKey, 'vck_oldoldoldoldold1234', 'malformed reply must not save the key');
    assert.equal(page.$('key-form').hidden, false);
    assert.equal(page.$('key-status').textContent, 'Unexpected reply from ai-gateway.vercel.sh.');

    // A reply that answers, but without a choice, is just as useless for a key check.
    await connect(page, 'vck_newnewnewnewnew5678');
    assert.equal(store.apiKey, 'vck_oldoldoldoldold1234');
    assert.equal(page.$('key-status').textContent, 'Unexpected reply from ai-gateway.vercel.sh.');
  });

  it('explains a network failure without blaming the key', async () => {
    const page = await load({ replies: [new TypeError('Failed to fetch')] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.chrome.store.apiKey, undefined);
    assert.equal(
      page.$('key-status').textContent,
      "Can't reach ai-gateway.vercel.sh. Check your connection and try again.",
    );
    assert.notEqual(page.$('api-key').getAttribute('aria-invalid'), 'true');
    assert.deepEqual(errors, [], 'a network failure is expected, not a bug to log');
  });

  it('keeps keyboard focus on the page after Connect and after Cancel', async () => {
    const page = await load({ replies: [answered()] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.$('connected-title').getAttribute('tabindex'), '-1');
    assert.equal(page.document.activeElement, page.$('connected-title'), 'focus lands on the connected heading');

    page.$('replace').click();
    assert.equal(page.document.activeElement, page.$('api-key'));
    page.$('cancel').click();
    assert.equal(page.document.activeElement, page.$('replace'), 'Cancel returns focus to Replace');
  });

  it('marks the key invalid when the provider rejects it', async () => {
    const page = await load({ replies: [json(401, {})] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.$('api-key').getAttribute('aria-invalid'), 'true');
    assert.match(page.$('key-status').textContent, /key was rejected/);
  });
});
