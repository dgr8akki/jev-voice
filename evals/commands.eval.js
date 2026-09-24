// Live evaluation against the real Jev model: runs spoken commands through the
// real handler with a recording browser, on a fixed search-results page.
// Needs AI_GATEWAY_API_KEY (see .env.example); not run in CI.
//
//   npm run eval
//
// TypeSafe rate-limits bursts and has brief outages, so each case waits and retries.
import { createHandler } from '../src/lib/handler.js';
import { createJevClient } from '../src/lib/jev.js';

const MAX_ATTEMPTS = 6;

const ELEMENTS = [
  'field: Search',
  'link: Alan Turing - Wikipedia',
  'link: Alan Turing | Britannica',
  'link: The Imitation Game (2014) - IMDb',
  'button: Images',
  'button: Videos',
  'field: Email address',
  'field: First name',
  'field: Surname',
];

// [said, final?, expectation on { outcome, calls }]
const cases = [
  ['go to', false, ({ outcome }) => !outcome.did],
  ['go to youtube', false, ({ outcome }) => outcome.did === 'Opened https://www.youtube.com'],
  ['click the', false, ({ outcome }) => !outcome.did],
  ['click the first result', false, ({ outcome }) => outcome.did === 'Clicked link: Alan Turing - Wikipedia'],
  ['search for', false, ({ outcome }) => !outcome.did],
  ['search for alan turing', false, ({ outcome }) => !outcome.did],
  ['scroll down', false, ({ outcome }) => outcome.did === 'Scrolled down'],
  ['type hello', false, ({ outcome }) => !outcome.did],
  ['go to wikipedia', true, ({ outcome }) => outcome.did === 'Opened https://en.wikipedia.org'],
  ['go to facebook.com', true, ({ outcome }) => outcome.did === 'Opened https://facebook.com'],
  ['search for alan turing', true, ({ outcome }) => outcome.did === 'Searched for "alan turing"'],
  ['click the first result', true, ({ outcome }) => outcome.did === 'Clicked link: Alan Turing - Wikipedia'],
  ['open the britannica one', true, ({ outcome }) => outcome.did === 'Clicked link: Alan Turing | Britannica'],
  ['scroll down a bit', true, ({ outcome }) => outcome.did === 'Scrolled down'],
  [
    'type enigma machine and press enter',
    true,
    ({ outcome }) => outcome.did?.startsWith('Typed "enigma machine"') && outcome.did.endsWith('and submitted'),
  ],
  ['type hello in this email bar', true, ({ outcome }) => outcome.did === 'Typed "hello" into field: Email address'],
  ['type meet me in the lobby', true, ({ outcome }) => outcome.did?.startsWith('Typed "meet me in the lobby"')],
  ['surname babuja', true, ({ outcome }) => outcome.did === 'Typed "babuja" into field: Surname'],
  ['on the first name put Akash', true, ({ outcome }) => outcome.did === 'Typed "Akash" into field: First name'],
  [
    'this is not the surname this is the first name',
    true,
    ({ outcome }) => outcome.did === 'Moved "Akash" to field: First name',
  ],
  ['go back', true, ({ outcome }) => outcome.did === 'Went back'],
  ['close this tab', true, ({ outcome }) => outcome.did === 'Closed the tab'],
  ['um yeah so anyway', true, ({ outcome }) => outcome.did === 'Ignored'],
];

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Set AI_GATEWAY_API_KEY (see .env.example) to run the live evaluation.');
  process.exit(1);
}
const jev = createJevClient({ getKey: () => process.env.AI_GATEWAY_API_KEY });

/** Records actions instead of performing them; injected functions are identified by name. */
function recordingBrowser(calls) {
  const record =
    (name) =>
    async (...args) => {
      calls.push([name, ...args]);
    };
  return {
    activeTab: async () => ({
      id: 1,
      index: 0,
      windowId: 1,
      url: 'https://www.google.com/search?q=alan+turing',
      title: 'alan turing - Google Search',
    }),
    async run(_tabId, func, args = []) {
      calls.push([func.name, ...args]);
      if (func.name === 'snapshot') return ELEMENTS;
      if (func.name === 'clearLastTyped') return 'Akash';
      return null;
    },
    navigate: record('navigate'),
    openTab: record('openTab'),
    back: record('back'),
    forward: record('forward'),
    reload: record('reload'),
    closeTab: record('closeTab'),
    switchTab: record('switchTab'),
  };
}

async function withRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      // Rate limits and TypeSafe outages are infrastructure, not wrong answers: wait and retry.
      const outage = error.status >= 500;
      if (!(error.busy || outage) || attempt === MAX_ATTEMPTS) throw error;
      const wait = error.retryAfter || 5 * attempt;
      process.stdout.write(`  (${outage ? 'service unavailable' : 'rate-limited'}, waiting ${wait}s)\n`);
      await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    }
  }
}

let failures = 0;
for (const [index, [said, final, expect]] of cases.entries()) {
  const name = `${final ? '' : '(partial) '}"${said}"`;
  const calls = [];
  // A fresh handler per case, so each utterance is independent.
  const handle = createHandler({ jev, browser: recordingBrowser(calls) });
  try {
    const outcome = await withRetry(() => handle({ text: said, final, id: `case-${index}` }));
    const ok = expect({ outcome, calls });
    failures += ok ? 0 : 1;
    console.log(
      `${ok ? 'pass' : 'FAIL'}  ${name.padEnd(52)} ${outcome.did ?? 'waits'}${outcome.ms ? ` (${outcome.ms}ms)` : ''}`,
    );
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name.padEnd(52)} ${error.message}`);
  }
}

console.log(failures ? `\n${failures} failed` : `\nAll ${cases.length} passed`);
process.exit(failures ? 1 : 0);
