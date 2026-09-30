import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../src/sidepanel/sidepanel.html', import.meta.url), 'utf8');

let restore = () => {};
let seq = 0;
afterEach(() => restore());

/**
 * Loads the real side panel against a fresh copy of sidepanel.js, with a
 * `chrome` double and, unless `speech` is false, a fake recognizer whose
 * results the test feeds in by hand.
 */
async function load({ store = {}, speech = true, reply = async () => ({}) } = {}) {
  const { window } = new JSDOM(html, {
    url: 'chrome-extension://test/sidepanel/sidepanel.html',
    pretendToBeVisual: true,
  });
  const opened = [];
  const sent = [];
  const chrome = {
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(
            [keys]
              .flat()
              .filter((k) => k in store)
              .map((k) => [k, store[k]]),
          ),
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      openOptionsPage: () => opened.push('options'),
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: async (message) => {
        sent.push(message);
        return reply(message);
      },
    },
    tabs: { create: () => {} },
  };
  const recognizers = [];
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'chrome', 'SpeechRecognition'];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const Recognition = class {
    constructor() {
      recognizers.push(this);
    }
    start() {
      this.onstart?.();
    }
    stop() {}
  };
  for (const name of names) {
    const value =
      name === 'window'
        ? window
        : name === 'chrome'
          ? chrome
          : name === 'SpeechRecognition'
            ? Recognition
            : window[name];
    if (name === 'SpeechRecognition' && !speech) continue;
    define(name, value);
  }
  restore = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  await import(`../src/sidepanel/sidepanel.js?case=${seq++}`);
  await settle();
  const $ = (id) => window.document.getElementById(id);
  /** Speaks `text` through the fake recognizer as one interim or final result. */
  const hear = (text, final) => {
    const result = Object.assign([{ transcript: text }], { isFinal: final });
    recognizers.at(-1).onresult({ results: [result] });
  };
  return { $, document: window.document, window, opened, sent, hear, recognizers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const KEY = 'vck_abcdefghijklmnop1234';

describe('side panel', () => {
  it('works without a key: the mic is idle and a banner offers to connect', async () => {
    const { $, opened } = await load();
    assert.equal($('mic').dataset.state, 'idle');
    assert.equal($('mic').getAttribute('aria-disabled'), 'false');
    assert.equal($('connect-banner').hidden, false);
    assert.match($('connect-banner').textContent, /Connect Jev to click links, fill forms and search by voice/);
    $('connect-banner').querySelector('button').click();
    assert.deepEqual(opened, ['options']);
  });

  it('starts listening without a key instead of opening settings', async () => {
    const { $, opened, recognizers } = await load();
    $('mic').click();
    await settle();
    await settle();
    assert.equal(recognizers.length, 1, 'a recognizer was started');
    assert.deepEqual(opened, []);
    assert.equal($('mic').dataset.state, 'listening');
  });

  it('announces a phrase once, when it is final, and keeps spaces between the words', async () => {
    const { $, hear } = await load({ store: { apiKey: KEY } });
    assert.equal($('heard').hasAttribute('aria-live'), false, 'the growing line must not be a live region');
    $('mic').click();
    await settle();
    await settle();

    hear('go to', false);
    hear('go to wikipedia', false);
    assert.equal($('heard').textContent, 'go to wikipedia', 'words are separated for the accessible name');
    assert.equal($('heard').querySelectorAll('span').length, 3);
    assert.equal($('heard-final').textContent, '', 'nothing announced while the phrase is still growing');

    hear('go to wikipedia', true);
    assert.equal($('heard-final').textContent, 'Heard: go to wikipedia');
    assert.equal($('heard-final').getAttribute('role'), 'status');
    assert.ok($('heard-final').classList.contains('visually-hidden'));
    // Let the queued message round-trip finish while the page globals still exist.
    await settle();
    await settle();
  });

  it('hides the banner once a key is saved', async () => {
    const { $ } = await load({ store: { apiKey: KEY } });
    assert.equal($('connect-banner').hidden, true);
    assert.equal($('mic').dataset.state, 'idle');
  });
});
