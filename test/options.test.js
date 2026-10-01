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
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MutationObserver', 'chrome', 'console'];
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
  await import(`../src/options/options.js?case=${seq}`);
  await import(`../src/options/reveal.js?case=${seq++}`);
  await settle();
  return { chrome, window, document: window.document, $: (id) => window.document.getElementById(id) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A status line's words, without the whitespace around its cloned icon. */
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
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
    assert.match(text(page.$('connected-status')), /^Key works\./);
  });

  it('keeps the old key and shows an error when a 200 does not answer the question', async () => {
    const store = { apiKey: 'vck_oldoldoldoldold1234', provider: 'vercel' };
    const page = await load({ store, replies: [json(200, {}), json(200, { answers: { ok: { type: 'choice' } } })] });
    page.$('replace').click();
    await connect(page, 'vck_newnewnewnewnew5678');
    assert.equal(store.apiKey, 'vck_oldoldoldoldold1234', 'malformed reply must not save the key');
    assert.equal(page.$('key-form').hidden, false);
    assert.equal(text(page.$('key-status')), 'Unexpected reply from ai-gateway.vercel.sh.');

    // A reply that answers, but without a choice, is just as useless for a key check.
    await connect(page, 'vck_newnewnewnewnew5678');
    assert.equal(store.apiKey, 'vck_oldoldoldoldold1234');
    assert.equal(text(page.$('key-status')), 'Unexpected reply from ai-gateway.vercel.sh.');
  });

  it('explains a network failure without blaming the key', async () => {
    const page = await load({ replies: [new TypeError('Failed to fetch')] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.chrome.store.apiKey, undefined);
    assert.equal(text(page.$('key-status')), "Can't reach ai-gateway.vercel.sh. Check your connection and try again.");
    assert.notEqual(page.$('api-key').getAttribute('aria-invalid'), 'true');
    assert.deepEqual(errors, [], 'a network failure is expected, not a bug to log');
  });

  it('keeps keyboard focus on the page after Connect and after Cancel', async () => {
    const page = await load({ replies: [answered()] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.document.activeElement, page.$('test'), 'focus lands on the first action of the card');

    page.$('replace').click();
    assert.equal(page.document.activeElement, page.$('api-key'));
    page.$('cancel').click();
    assert.equal(page.document.activeElement, page.$('replace'), 'Cancel returns focus to Replace');
  });

  it('429', async () => {
    const page = await load({ replies: [json(429, {}, { 'retry-after': '30' })] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.chrome.store.apiKey, 'vck_abcdefghijklmnop1234', 'a rate limit means the key was accepted');
    assert.equal(page.$('key-form').hidden, true);
    assert.equal(text(page.$('connected-status')), 'Key accepted; the provider is busy right now.');
    assert.notEqual(page.$('connected-status').dataset.tone, 'ok');
  });

  it('does not carry a stale Test result through Replace and Cancel', async () => {
    const store = { apiKey: 'vck_oldoldoldoldold1234', provider: 'vercel' };
    const page = await load({ store, replies: [json(401, {})] });
    page.$('test').click();
    for (let i = 0; i < 4; i += 1) await settle();
    assert.match(text(page.$('connected-status')), /key was rejected/);
    page.$('replace').click();
    page.$('cancel').click();
    assert.equal(text(page.$('connected-status')), '');
  });

  it('removes only the key, keeps the provider, and moves focus to the field', async () => {
    const store = { apiKey: 'vck_oldoldoldoldold1234', provider: 'typesafe' };
    const page = await load({ store });
    page.$('remove').click();
    for (let i = 0; i < 3; i += 1) await settle();
    assert.equal(store.apiKey, undefined);
    assert.equal(store.provider, 'typesafe');
    assert.equal(page.$('key-form').hidden, false);
    assert.equal(text(page.$('key-status')), 'Key removed from this browser.');
    assert.equal(page.document.activeElement, page.$('api-key'));
  });

  it('lets the key be shown for checking, and hides it again once connected', async () => {
    const page = await load({ replies: [answered()] });
    const reveal = page.$('reveal');
    const input = page.$('api-key');
    assert.equal(reveal.tagName, 'BUTTON');
    assert.equal(reveal.getAttribute('aria-pressed'), 'false');
    assert.equal(input.type, 'password');
    reveal.click();
    assert.equal(input.type, 'text');
    assert.equal(reveal.getAttribute('aria-pressed'), 'true');
    assert.equal(reveal.textContent.trim(), 'Hide');
    reveal.click();
    assert.equal(input.type, 'password');
    reveal.click();
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(input.type, 'password', 'a shown key is hidden again once it is saved');
    assert.equal(reveal.getAttribute('aria-pressed'), 'false');
    assert.equal(reveal.textContent.trim(), 'Show');
  });

  it('marks the setup links that open a new tab', async () => {
    const page = await load();
    assert.match(page.$('steps').textContent, /opens in a new tab/);
    assert.ok(page.$('steps').querySelector('a[target=_blank] .external'));
  });

  it('marks the key invalid when the provider rejects it', async () => {
    const page = await load({ replies: [json(401, {})] });
    await connect(page, 'vck_abcdefghijklmnop1234');
    assert.equal(page.$('api-key').getAttribute('aria-invalid'), 'true');
    assert.match(text(page.$('key-status')), /key was rejected/);
    assert.equal(page.document.activeElement, page.$('api-key'), 'focus returns to the field to fix');
  });
});
