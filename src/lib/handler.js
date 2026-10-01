// One transcript end to end: snapshot the page, ask Jev, act. Browser access only through the adapter.

import {
  buildQuestions,
  cleanText,
  describeElement,
  localCommand,
  navigationUrl,
  searchQuery,
  textCandidates,
  textQuestion,
  toCommand,
} from './commands.js';
import { JevError } from './jev.js';
import { clearLastTyped, clearMarkers, clickElement, moveCursor, scrollPage, snapshot, typeInto } from './page.js';

/**
 * @typedef {object} Browser
 * @property {() => Promise<{ id: number, index: number, windowId: number, url?: string, title?: string }>} activeTab
 * @property {(tabId: number, func: Function, args?: unknown[]) => Promise<any>} run Runs an injected function.
 * @property {(tabId: number, url: string) => Promise<void>} navigate
 * @property {(url?: string) => Promise<void>} openTab
 * @property {(tabId: number) => Promise<void>} back
 * @property {(tabId: number) => Promise<void>} forward
 * @property {(tabId: number) => Promise<void>} reload
 * @property {(tabId: number) => Promise<void>} closeTab
 * @property {(tab: { index: number, windowId: number }, offset: 1 | -1) => Promise<void>} switchTab
 */

// Outcomes that didn't act; the side panel shows them as a miss, not a success.
const MISS = {
  noTarget: "Couldn't find that on the page",
  noText: "Didn't catch what to type",
  whichField: 'Which field should it go in?',
  nothingTyped: 'Nothing has been typed on this page yet',
  badNewTab: "That link opens a new tab in a way Chrome doesn't allow",
  needsKey: 'Connect Jev to click links, fill forms and search by voice',
};
const MISSES = new Set(Object.values(MISS));

// Actions that address a page element through the snapshot's index markers.
const PAGE_ACTIONS = new Set(['click', 'type', 'retarget']);

// chrome://, the Web Store and PDF viewers refuse executeScript; say so rather than "Couldn't find that".
const RESTRICTED = new JevError("Chrome doesn't let extensions see this page. Navigation and tab commands still work.");

/**
 * @param {object} deps
 * @param {import('./jev.js').JevClient} deps.jev
 * @param {Browser} deps.browser
 * @param {() => number} [deps.now]
 * @param {() => boolean | Promise<boolean>} [deps.hasKey] Whether Jev can be called at all.
 */
// How many utterance ids to remember. A phrase's partials arrive within seconds; fifty is hours of talking.
const ACTED_LIMIT = 50;

// Snapshots kept for in-progress utterances. Partials reuse theirs; a final looks again.
const SNAPSHOT_LIMIT = 3;

export function createHandler({ jev, browser, now = () => performance.now(), hasKey = () => true }) {
  /**
   * Utterance ids already acted on. Partials race each other; the first confident answer wins.
   * Kept in insertion order and capped so it cannot grow for the life of the worker. It is lost
   * when Chrome restarts the worker; a final arriving right then could repeat a partial's action,
   * which is accepted over persisting it.
   */
  const acted = new Set();
  const remember = (id) => {
    acted.add(id);
    if (acted.size > ACTED_LIMIT) acted.delete(acted.values().next().value);
  };

  const snapshots = new Map();
  async function lookAtPage(tabId, id, final) {
    if (!final && snapshots.has(id)) return snapshots.get(id);
    // chrome:// and Web Store pages can't be scripted; commands that don't need the page still work.
    const seen = await browser.run(tabId, snapshot).then(
      (elements) => ({ elements: elements ?? [], restricted: false }),
      () => ({ elements: [], restricted: true }),
    );
    snapshots.delete(id);
    snapshots.set(id, seen);
    if (snapshots.size > SNAPSHOT_LIMIT) snapshots.delete(snapshots.keys().next().value);
    return seen;
  }

  /**
   * @param {{ text: string, final: boolean, id: string }} transcript
   * @returns {Promise<{ did?: string, ms?: number, early?: boolean, miss?: boolean, needsKey?: boolean }>}
   */
  return async function handle({ text, final, id }) {
    if (acted.has(id)) return {};
    const started = now();
    // Scroll, history, tabs and "open <site>" are decided here, so they work before a key is connected.
    const local = localCommand(text, { final });
    if (!local && !(await hasKey())) return final ? { did: MISS.needsKey, miss: true, needsKey: true } : {};

    const tab = await browser.activeTab();
    let command = local;
    let elements = [];
    let restricted = false;
    if (!command) {
      ({ elements, restricted } = await lookAtPage(tab.id, id, final));
      // The state carries the same cleaned labels as the criteria: raw page text never leaves the browser.
      const answers = await jev.evaluate({
        state: {
          transcript: text,
          page: { url: tab.url, title: cleanText(tab.title) },
          elements: elements.map(describeElement),
        },
        questions: buildQuestions({ elements, final, text }),
      });
      command = toCommand(answers, { final });
    }
    if (!command || acted.has(id)) return {};
    remember(id);
    if (restricted && PAGE_ACTIONS.has(command.action)) throw RESTRICTED;

    const did = await perform(command, { text, tab, elements });
    // The index markers have done their job once the action has run; leave the page as it was.
    if (PAGE_ACTIONS.has(command.action) && !MISSES.has(did)) await browser.run(tab.id, clearMarkers).catch(() => {});
    return { did, ms: Math.round(now() - started), early: !final, miss: MISSES.has(did) };
  };

  async function perform({ action, target: picked, site }, { text, tab, elements }) {
    // Jev's pick is only usable if it names an element that was actually listed.
    const target = Number.isInteger(picked) && picked >= 0 && picked < elements.length ? picked : null;
    const label = target === null ? null : elements[target];
    switch (action) {
      case 'navigate': {
        const url = navigationUrl(text, site);
        await browser.navigate(tab.id, url);
        const looked = new URL(url).searchParams.get('btnI') ? new URL(url).searchParams.get('q') : null;
        // No known site or spoken domain: it went through a search, so say what was searched.
        if (looked) return `Opened the top result for "${looked}"`;
        return `Opened ${new URL(url).hostname.replace(/^www\./, '')}`;
      }
      case 'search': {
        const query = searchQuery(text);
        await browser.navigate(tab.id, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
        return `Searched for "${query}"`;
      }
      case 'click': {
        if (target === null) return MISS.noTarget;
        await browser.run(tab.id, moveCursor, [target, 'click']);
        // Links that open a new tab are blocked as pop-ups when clicked by a script.
        const result = await browser.run(tab.id, clickElement, [target]);
        if (!result) return MISS.noTarget; // the marker was gone by the time the click ran
        if (result.blocked) return MISS.badNewTab;
        if (result.newTab) await browser.openTab(result.newTab);
        return `Clicked ${label}`;
      }
      case 'type': {
        const { text: typed, submit } = await pickText(text);
        if (!typed) return MISS.noText;
        if (target !== null) await browser.run(tab.id, moveCursor, [target, 'type']);
        await browser.run(tab.id, typeInto, [target, typed, submit]);
        return `Typed "${typed}"${label ? ` into ${label}` : ''}${submit ? ' and submitted' : ''}`;
      }
      case 'retarget': {
        if (target === null) return MISS.whichField;
        const moved = await browser.run(tab.id, clearLastTyped);
        if (!moved) return MISS.nothingTyped;
        await browser.run(tab.id, moveCursor, [target, 'type']);
        await browser.run(tab.id, typeInto, [target, moved, false]);
        return `Moved "${moved}" to ${label}`;
      }
      case 'scroll_down':
      case 'scroll_up':
        await browser.run(tab.id, scrollPage, [action === 'scroll_down' ? 1 : -1]).catch(() => {
          throw RESTRICTED;
        });
        return action === 'scroll_down' ? 'Scrolled down' : 'Scrolled up';
      case 'back':
        // tabs.goBack rejects at the start of history; that is an answer, not a fault.
        await browser.back(tab.id).catch(() => {
          throw new JevError('Nothing to go back to.');
        });
        return 'Went back';
      case 'forward':
        await browser.forward(tab.id).catch(() => {
          throw new JevError('Nothing to go forward to.');
        });
        return 'Went forward';
      case 'reload':
        await browser.reload(tab.id);
        return 'Reloaded the page';
      case 'new_tab':
        await browser.openTab();
        return 'Opened a new tab';
      case 'close_tab':
        await browser.closeTab(tab.id);
        return 'Closed the tab';
      case 'next_tab':
      case 'prev_tab':
        await browser.switchTab(tab, action === 'next_tab' ? 1 : -1);
        return action === 'next_tab' ? 'Switched to the next tab' : 'Switched to the previous tab';
      default:
        return 'Ignored';
    }
  }

  /** Second, small Jev call: which span of the command is the text to type. */
  async function pickText(transcript) {
    const { candidates, submit } = textCandidates(transcript);
    if (candidates.length < 2) return { text: candidates[0] ?? '', submit };
    const answers = await jev.evaluate({ state: { command: transcript }, questions: textQuestion(candidates) });
    const pick = answers?.text?.choice;
    const index = /^t\d+$/.test(pick ?? '') ? Number(pick.slice(1)) : -1;
    return { text: candidates[index] ?? '', submit };
  }
}
