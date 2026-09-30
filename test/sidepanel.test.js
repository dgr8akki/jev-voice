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
    if (name === 'SpeechRecognition' && !speech) {
      delete globalThis.SpeechRecognition; // a browser without the API, whatever an earlier test defined
      continue;
    }
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
  it('renders the mic as idle, listening and off, carrying state in the label alone', async () => {
    const { $ } = await load({ store: { apiKey: KEY } });
    const mic = $('mic');
    assert.equal(mic.dataset.state, 'idle');
    assert.equal(mic.hasAttribute('aria-disabled'), false, 'a working button is never announced as disabled');
    assert.equal(mic.hasAttribute('aria-pressed'), false, 'state is in the label, not doubled as pressed');
    assert.equal($('mic-label').textContent, 'Start listening');
    mic.click();
    await settle();
    await settle();
    assert.equal(mic.dataset.state, 'listening');
    assert.equal($('mic-label').textContent, 'Stop listening');
    mic.click();
    assert.equal(mic.dataset.state, 'idle');
    assert.equal($('mic-label').textContent, 'Start listening');
  });

  it('renders the mic as off, but still operable, where there is no speech recognition', async () => {
    const { $ } = await load({ speech: false });
    assert.equal($('mic').dataset.state, 'off');
    assert.equal($('mic').hasAttribute('aria-disabled'), false);
    assert.ok($('mic').hasAttribute('data-slash'));
    assert.ok($('notice').textContent.includes('Type commands instead'));
  });

  it('closes "What can I say?" on the first command unless the user has toggled it', async () => {
    const typed = async (page, text) => {
      page.$('command').value = text;
      page.$('command-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
      for (let i = 0; i < 3; i += 1) await settle();
    };
    const untouched = await load({ store: { apiKey: KEY }, reply: async () => ({ did: 'Scrolled down', ms: 5 }) });
    assert.equal(untouched.$('examples').open, true);
    await typed(untouched, 'scroll down');
    assert.equal(untouched.$('examples').open, false, 'nobody was reading it');

    const reading = await load({ store: { apiKey: KEY }, reply: async () => ({ did: 'Scrolled down', ms: 5 }) });
    reading.$('examples').querySelector('summary').click(); // the user opened or closed it themselves
    reading.$('examples').open = true;
    await typed(reading, 'scroll down');
    assert.equal(reading.$('examples').open, true, 'left as the user set it');
  });

  it('keeps at most thirty activity entries, newest first', async () => {
    let n = 0;
    const { $, window } = await load({
      store: { apiKey: KEY },
      reply: async () => ({ did: `Done ${(n += 1)}`, ms: 1 }),
    });
    for (let i = 0; i < 31; i += 1) {
      $('command').value = `command ${i}`;
      $('command-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      for (let j = 0; j < 3; j += 1) await settle();
    }
    const list = $('activity');
    assert.equal(list.children.length, 30);
    assert.equal(list.firstElementChild.querySelector('.text').textContent, 'Done 31');
    assert.equal(list.lastElementChild.querySelector('.text').textContent, 'Done 2', 'the oldest entry was dropped');
    assert.equal($('activity-empty').hidden, true);
  });

  it('gives Settings and Activity real headings at the same level', async () => {
    const { document } = await load();
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent.trim());
    assert.deepEqual(headings, ['Settings', 'Activity']);
    assert.ok(document.querySelector('#settings h2.kicker'), 'the kicker look stays; only the element changes');
  });

  it('keeps the controls and the activity inside one main landmark', async () => {
    const { document } = await load();
    const main = document.querySelector('main');
    assert.equal(document.querySelectorAll('main').length, 1);
    for (const selector of ['.input-block', '#command-form', '#examples', '.activity']) {
      assert.ok(main.querySelector(selector), `${selector} is inside <main>`);
    }
    assert.ok(!main.querySelector('header'), 'the top bar stays a banner of its own');
  });

  it('works without a key: the mic is idle and a banner offers to connect', async () => {
    const { $, opened } = await load();
    assert.equal($('mic').dataset.state, 'idle');
    assert.equal($('mic').hasAttribute('aria-disabled'), false);
    assert.equal($('connect-banner').hidden, false);
    assert.equal($('connect-banner').tagName, 'ASIDE', 'a landmark, so the banner is not content outside any region');
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

  it('waits for a pause before sending a partial, and sends finals at once', async () => {
    const { $, hear, sent } = await load({ store: { apiKey: KEY } });
    $('mic').click();
    await settle();
    await settle();
    hear('go', false);
    hear('go to', false);
    hear('go to wikipedia', false);
    assert.equal(sent.length, 0, 'nothing sent while words are still arriving');
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'go to wikipedia');
    assert.equal(sent[0].final, false);

    hear('scroll', false);
    hear('scroll down', true);
    await settle();
    assert.equal(sent.length, 2, 'the final went straight through');
    assert.equal(sent[1].final, true);
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal(sent.length, 2, 'the pending partial was dropped by its final');
  });

  it('shows "The extension restarted" for a final only, never for a partial', async () => {
    const { $, hear } = await load({
      store: { apiKey: KEY },
      reply: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });
    $('mic').click();
    await settle();
    await settle();
    hear('scroll', false);
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.equal($('activity').children.length, 0, 'a partial sent to a sleeping worker is not an error');
    hear('scroll down', true);
    for (let i = 0; i < 3; i += 1) await settle();
    assert.equal($('activity').children.length, 1);
    assert.equal($('activity').firstElementChild.dataset.kind, 'error');
    assert.equal($('activity').querySelector('.text').textContent, 'The extension restarted. Try again.');
  });

  it('shows a pending card while a command runs and fills it in place', async () => {
    let release;
    const reply = () => new Promise((resolve) => (release = () => resolve({ did: 'Scrolled down', ms: 640 })));
    const { $, window } = await load({ store: { apiKey: KEY }, reply });
    $('command').value = 'scroll down';
    $('command-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
    const list = $('activity');
    assert.equal(list.getAttribute('aria-busy'), 'true');
    assert.equal(list.children.length, 1);
    const card = list.firstElementChild;
    assert.equal(card.dataset.kind, 'pending');
    assert.equal(card.querySelector('.text').textContent, 'Working on “scroll down”…');

    release();
    for (let i = 0; i < 3; i += 1) await settle();
    assert.equal(list.getAttribute('aria-busy'), 'false');
    assert.equal(list.children.length, 1, 'the outcome replaces the pending card, it does not stack');
    assert.equal(list.firstElementChild, card, 'same node, updated in place');
    assert.equal(card.dataset.kind, 'ok');
    assert.equal(card.querySelector('.text').textContent, 'Scrolled down');
    assert.equal(card.querySelector('.tail').textContent, 'in 640 ms');
  });

  it('hides the banner once a key is saved and shows the masked key in its own span', async () => {
    const { $ } = await load({ store: { apiKey: KEY } });
    assert.equal($('connect-banner').hidden, true);
    assert.equal($('mic').dataset.state, 'idle');
    assert.match($('connection').textContent, /^Connected via Vercel AI Gateway/);
    assert.equal($('connection').querySelector('.mono')?.textContent, 'vck_…1234');
    assert.equal($('open-settings').textContent, 'Change');
    // "Change" alone means nothing in a button list; the connection line completes it.
    assert.equal($('open-settings').getAttribute('aria-describedby'), 'connection');
    assert.ok($('open-settings').classList.contains('btn-secondary'));
    assert.ok($('open-settings').classList.contains('btn'), 'base class survives the state toggle');
  });
});
