/**
 * Runs one transcript end to end: snapshot the page, ask Jev, act.
 *
 * All browser access goes through the `browser` adapter (see background.js), so
 * the whole flow is unit-testable with a fake browser.
 *
 * @module lib/handler
 */

import { buildQuestions, navigationUrl, searchQuery, textCandidates, textQuestion, toCommand } from './commands.js';
import { clearLastTyped, clickElement, moveCursor, scrollPage, snapshot, typeInto } from './page.js';

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

/**
 * @typedef {object} Outcome
 * @property {string} [did] What happened, in plain words. Absent when nothing happened yet.
 * @property {number} [ms] Time from transcript to action.
 * @property {boolean} [early] Acted on a partial transcript.
 */

/**
 * @param {{ jev: import('./jev.js').JevClient, browser: Browser, now?: () => number }} deps
 */
export function createHandler({ jev, browser, now = () => performance.now() }) {
  /** Utterance ids already acted on. Partials race each other; the first confident answer wins. */
  const acted = new Set();

  /**
   * @param {{ text: string, final: boolean, id: string }} transcript
   * @returns {Promise<Outcome>}
   */
  return async function handle({ text, final, id }) {
    if (acted.has(id)) return {};
    const started = now();
    const tab = await browser.activeTab();
    // chrome:// and Web Store pages can't be scripted; commands that don't need the page still work.
    const elements = (await browser.run(tab.id, snapshot).catch(() => null)) ?? [];

    const answers = await jev.evaluate({
      state: { transcript: text, page: { url: tab.url, title: tab.title }, elements },
      questions: buildQuestions({ elements, final }),
    });
    const command = toCommand(answers, { final });
    if (!command || acted.has(id)) return {};
    acted.add(id);

    const did = await perform(command, { text, tab, elements });
    return { did, ms: Math.round(now() - started), early: !final };
  };

  async function perform({ action, target, site }, { text, tab, elements }) {
    const label = target === null ? null : elements[target];
    switch (action) {
      case 'navigate': {
        const url = navigationUrl(text, site);
        await browser.navigate(tab.id, url);
        return `Opened ${url}`;
      }
      case 'search': {
        const query = searchQuery(text);
        await browser.navigate(tab.id, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
        return `Searched for "${query}"`;
      }
      case 'click': {
        if (target === null) return "Couldn't find that on the page";
        await browser.run(tab.id, moveCursor, [target]);
        // Links that open a new tab are blocked as pop-ups when clicked by a script.
        const newTabUrl = await browser.run(tab.id, clickElement, [target]);
        if (newTabUrl) await browser.openTab(newTabUrl);
        return `Clicked ${label}`;
      }
      case 'type': {
        const { text: typed, submit } = await pickText(text);
        if (!typed) return "Didn't catch what to type";
        if (target !== null) await browser.run(tab.id, moveCursor, [target]);
        await browser.run(tab.id, typeInto, [target, typed, submit]);
        return `Typed "${typed}"${label ? ` into ${label}` : ''}${submit ? ' and submitted' : ''}`;
      }
      case 'retarget': {
        if (target === null) return 'Which field should it go in?';
        const moved = await browser.run(tab.id, clearLastTyped);
        if (!moved) return 'Nothing has been typed on this page yet';
        await browser.run(tab.id, moveCursor, [target]);
        await browser.run(tab.id, typeInto, [target, moved, false]);
        return `Moved "${moved}" to ${label}`;
      }
      case 'scroll_down':
      case 'scroll_up':
        await browser.run(tab.id, scrollPage, [action === 'scroll_down' ? 1 : -1]);
        return action === 'scroll_down' ? 'Scrolled down' : 'Scrolled up';
      case 'back':
        await browser.back(tab.id);
        return 'Went back';
      case 'forward':
        await browser.forward(tab.id);
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
    return { text: candidates[Number(answers.text.choice.slice(1))], submit };
  }
}
