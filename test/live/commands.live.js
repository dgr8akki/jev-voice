// The spoken cases, run against the real model. Each one goes through the real
// handler with a browser double that records what would have happened, on a
// fixed Google results page for "alan turing" plus a small sign-up form.
//
//   npm run live        (needs TYPESAFE_API_KEY or AI_GATEWAY_API_KEY in .env)
//
// Not part of `npm test`: it costs money and TypeSafe rate-limits bursts, so a
// 429 or a 5xx here is a pause, not a failure. Most of the phrases are ones I
// said while building this; the misspelt "babuja" is a real recogniser output.
import { createHandler } from '../../src/lib/handler.js';
import { createJevClient } from '../../src/lib/jev.js';

/** How long to wait between attempts when the provider is busy, in seconds; the last entry is the give-up point. */
const BACKOFF_S = [5, 10, 20, 40, 60];

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
  ['go to youtube', false, ({ outcome }) => outcome.did === 'Opened youtube.com'],
  ['click the', false, ({ outcome }) => !outcome.did],
  ['click the first result', false, ({ outcome }) => outcome.did === 'Clicked link: Alan Turing - Wikipedia'],
  ['search for', false, ({ outcome }) => !outcome.did],
  ['search for alan turing', false, ({ outcome }) => !outcome.did],
  ['scroll down', false, ({ outcome }) => outcome.did === 'Scrolled down'],
  ['type hello', false, ({ outcome }) => !outcome.did],
  ['go to wikipedia', true, ({ outcome }) => outcome.did === 'Opened en.wikipedia.org'],
  ['go to facebook.com', true, ({ outcome }) => outcome.did === 'Opened facebook.com'],
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
  // Said at my desk; the first two never reach Jev.
  ['go to rte dot ie', true, ({ outcome }) => outcome.did === 'Opened rte.ie'],
  ['open hacker news', true, ({ outcome }) => outcome.did === 'Opened news.ycombinator.com'],
  ['open the imdb one', true, ({ outcome }) => outcome.did === 'Clicked link: The Imitation Game (2014) - IMDb'],
  ['click images', true, ({ outcome }) => outcome.did === 'Clicked button: Images'],
  ['open britannica', true, ({ outcome }) => outcome.did?.startsWith('Clicked link: Alan Turing | Britannica')],
];

// TYPESAFE_API_KEY calls TypeSafe directly; otherwise AI_GATEWAY_API_KEY goes through Vercel.
const provider = process.env.TYPESAFE_API_KEY ? 'typesafe' : 'vercel';
const key = process.env.TYPESAFE_API_KEY || process.env.AI_GATEWAY_API_KEY;
if (!key) {
  console.error('Set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY (see .env.example) to run the live evaluation.');
  process.exit(1);
}
console.log(`Provider: ${provider}\n`);
const jev = createJevClient({ getKey: () => key, getProvider: () => provider });

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
      if (func.name === 'clickElement') return { clicked: true };
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

/** Runs `fn`, sitting out rate limits and 5xx along BACKOFF_S (or the provider's own Retry-After). Anything else is the case's problem. */
async function patiently(fn) {
  for (const [attempt, fallback] of BACKOFF_S.entries()) {
    try {
      return await fn();
    } catch (error) {
      const transient = error.busy || error.status >= 500;
      if (!transient || attempt === BACKOFF_S.length - 1) throw error;
      const wait = error.retryAfter || fallback;
      process.stdout.write(`  (${error.busy ? 'rate-limited' : 'provider error'}, back in ${wait}s)\n`);
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
    const outcome = await patiently(() => handle({ text: said, final, id: `case-${index}` }));
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
