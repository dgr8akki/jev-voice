import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandler } from '../src/lib/handler.js';
import { choice, fakeJev, yesNo } from './helpers.js';

const ELEMENTS = [
  'field: Search',
  'link: Alan Turing - Wikipedia',
  'link: Britannica',
  'field: First name',
  'field: Surname',
];

/** A browser double that records every call; injected functions are identified by name. */
function fakeBrowser({ elements = ELEMENTS, injected = {} } = {}) {
  const calls = [];
  const record =
    (name) =>
    async (...args) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    activeTab: async () => ({
      id: 7,
      index: 0,
      windowId: 1,
      url: 'https://www.google.com/search?q=turing',
      title: 'turing',
    }),
    async run(tabId, func, args = []) {
      calls.push([func.name, ...args]);
      if (func.name === 'snapshot') {
        if (elements instanceof Error) throw elements;
        return elements;
      }
      return injected[func.name] ?? null;
    },
    navigate: record('navigate'),
    openTab: record('openTab'),
    back: record('back'),
    forward: record('forward'),
    reload: record('reload'),
    closeTab: record('closeTab'),
    switchTab: async (tab, offset) => calls.push(['switchTab', offset]),
  };
}

/** Jev double: the first call gets `main`, a second call (text picking) gets `text`. */
function jevAnswering(main, text) {
  let call = 0;
  return fakeJev(() => {
    call += 1;
    if (call === 1) {
      return {
        action: choice(main.action, main.confidence ?? 0.95),
        target: choice(main.target ?? 'none'),
        site: choice(main.site ?? 'other'),
        complete: yesNo(main.complete ?? 0.9),
      };
    }
    return { text: choice(text) };
  });
}

const run = async ({ said, final = true, id = said, jev, browser = fakeBrowser() }) => {
  const handle = createHandler({ jev, browser, now: () => 0 });
  return { outcome: await handle({ text: said, final, id }), browser, jev, handle };
};

const withoutSnapshot = (calls) => calls.filter(([name]) => name !== 'snapshot');

describe('createHandler', () => {
  it('sends the page and its elements to Jev', async () => {
    const { jev } = await run({ said: 'scroll down', jev: jevAnswering({ action: 'scroll_down' }) });
    assert.deepEqual(jev.calls[0].state, {
      transcript: 'scroll down',
      page: { url: 'https://www.google.com/search?q=turing', title: 'turing' },
      elements: ELEMENTS,
    });
  });

  it('opens a known site', async () => {
    const { outcome, browser } = await run({
      said: 'go to wikipedia',
      jev: jevAnswering({ action: 'navigate', site: 'wikipedia' }),
    });
    assert.deepEqual(withoutSnapshot(browser.calls), [['navigate', 7, 'https://en.wikipedia.org']]);
    assert.equal(outcome.did, 'Opened https://en.wikipedia.org');
  });

  it('opens a spoken domain directly', async () => {
    const { browser } = await run({ said: 'go to facebook.com', jev: jevAnswering({ action: 'navigate' }) });
    assert.deepEqual(withoutSnapshot(browser.calls), [['navigate', 7, 'https://facebook.com']]);
  });

  it('searches with the spoken query', async () => {
    const { outcome } = await run({ said: 'search for alan turing', jev: jevAnswering({ action: 'search' }) });
    assert.equal(outcome.did, 'Searched for "alan turing"');
  });

  it('moves the cursor, then clicks the element Jev picked', async () => {
    const { outcome, browser } = await run({
      said: 'open the britannica one',
      jev: jevAnswering({ action: 'click', target: 'e2' }),
    });
    assert.deepEqual(withoutSnapshot(browser.calls), [
      ['moveCursor', 2],
      ['clickElement', 2],
    ]);
    assert.equal(outcome.did, 'Clicked link: Britannica');
  });

  it('opens new-tab links itself so they are not blocked as pop-ups', async () => {
    const browser = fakeBrowser({ injected: { clickElement: 'https://en.wikipedia.org/wiki/Alan_Turing' } });
    await run({ said: 'click the first result', browser, jev: jevAnswering({ action: 'click', target: 'e1' }) });
    assert.deepEqual(browser.calls.at(-1), ['openTab', 'https://en.wikipedia.org/wiki/Alan_Turing']);
  });

  it('says so when a click has no target', async () => {
    const { outcome, browser } = await run({ said: 'click the thing', jev: jevAnswering({ action: 'click' }) });
    assert.equal(outcome.did, "Couldn't find that on the page");
    assert.deepEqual(withoutSnapshot(browser.calls), []);
  });

  it('types the span Jev picked into the field it picked', async () => {
    const jev = jevAnswering({ action: 'type', target: 'e4' }, 't2');
    const { outcome, browser } = await run({ said: 'surname Pahuja', jev });
    assert.deepEqual(withoutSnapshot(browser.calls), [
      ['moveCursor', 4],
      ['typeInto', 4, 'Pahuja', false],
    ]);
    assert.equal(outcome.did, 'Typed "Pahuja" into field: Surname');
    assert.deepEqual(Object.values(jev.calls[1].questions.text.criteria), [
      '"surname Pahuja"',
      '"surname"',
      '"Pahuja"',
    ]);
  });

  it('submits when asked to press enter', async () => {
    const jev = jevAnswering({ action: 'type', target: 'e0' }, 't0');
    const { outcome } = await run({ said: 'type turing and press enter', jev });
    assert.match(outcome.did, /and submitted$/);
  });

  it('moves the last typed text to another field', async () => {
    const browser = fakeBrowser({ injected: { clearLastTyped: 'Akash' } });
    const { outcome } = await run({
      said: "no that's the first name",
      browser,
      jev: jevAnswering({ action: 'retarget', target: 'e3' }),
    });
    assert.deepEqual(withoutSnapshot(browser.calls), [
      ['clearLastTyped'],
      ['moveCursor', 3],
      ['typeInto', 3, 'Akash', false],
    ]);
    assert.equal(outcome.did, 'Moved "Akash" to field: First name');
  });

  it('explains a correction when nothing was typed yet', async () => {
    const { outcome } = await run({
      said: 'put it in the first name',
      jev: jevAnswering({ action: 'retarget', target: 'e3' }),
    });
    assert.equal(outcome.did, 'Nothing has been typed on this page yet');
  });

  it('handles scrolling, history and tabs', async () => {
    const cases = [
      ['scroll_up', ['scrollPage', -1], 'Scrolled up'],
      ['back', ['back', 7], 'Went back'],
      ['forward', ['forward', 7], 'Went forward'],
      ['reload', ['reload', 7], 'Reloaded the page'],
      ['new_tab', ['openTab'], 'Opened a new tab'],
      ['close_tab', ['closeTab', 7], 'Closed the tab'],
      ['prev_tab', ['switchTab', -1], 'Switched to the previous tab'],
    ];
    for (const [action, call, did] of cases) {
      const { outcome, browser } = await run({ said: action, jev: jevAnswering({ action }) });
      assert.deepEqual(withoutSnapshot(browser.calls), [call], action);
      assert.equal(outcome.did, did, action);
    }
  });

  it('reports chatter as ignored', async () => {
    const { outcome } = await run({ said: 'um yeah so anyway', jev: jevAnswering({ action: 'none' }) });
    assert.equal(outcome.did, 'Ignored');
  });

  it('still works on pages it cannot script', async () => {
    const browser = fakeBrowser({ elements: new Error('Cannot access a chrome:// URL') });
    const { outcome, jev } = await run({ said: 'go back', browser, jev: jevAnswering({ action: 'back' }) });
    assert.equal(outcome.did, 'Went back');
    assert.deepEqual(jev.calls[0].state.elements, []);
  });

  it('waits on an incomplete partial and acts once per utterance', async () => {
    const browser = fakeBrowser();
    const handle = createHandler({ jev: jevAnswering({ action: 'back', complete: 0.2 }), browser, now: () => 0 });
    assert.deepEqual(await handle({ text: 'go back', final: false, id: 'u1' }), {});

    const eager = createHandler({ jev: jevAnswering({ action: 'back' }), browser, now: () => 0 });
    assert.deepEqual(await eager({ text: 'go back', final: false, id: 'u2' }), {
      did: 'Went back',
      ms: 0,
      early: true,
    });
    assert.deepEqual(await eager({ text: 'go back to the list', final: true, id: 'u2' }), {}, 'same utterance');
  });
});
