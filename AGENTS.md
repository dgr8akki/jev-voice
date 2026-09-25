# AGENTS.md

Guidance for AI coding agents (and humans) working on Jev Voice.

## What this is

A Manifest V3 Chrome extension for voice control of the browser. The side panel captures speech; the service worker decides what to do with Jev (TypeSafe's System One model, via Vercel AI Gateway's `/v1/evaluate`) and acts on the active tab.

## Commands

```sh
npm install
npm run check      # must pass before every commit: lint + format check + unit tests
npm test           # unit tests only (offline, ~1s)
npm run eval       # live Jev evaluation; needs AI_GATEWAY_API_KEY in .env; waits out 429s
npm run package    # dist/jev-voice-<version>.zip
npm run icons      # re-render src/icons from assets/icon.svg (needs Google Chrome)
```

There is no build step. `src/` is loaded as-is by Chrome, so it must stay plain ES modules that run in the browser without bundling.

## Architecture

| Path                         | Responsibility                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/lib/commands.js`        | Vocabulary (`ACTIONS`, `SITES`), question building, `toCommand` rules, `THRESHOLDS`, text candidates. Pure. |
| `src/lib/handler.js`         | One transcript end to end. Talks to the browser only through the `Browser` adapter.                         |
| `src/lib/page.js`            | Functions injected with `chrome.scripting.executeScript`.                                                   |
| `src/lib/jev.js`             | HTTP client: one 5xx retry, pauses on 429 using `Retry-After`, user-facing errors.                          |
| `src/lib/queue.js`           | One request in flight; newest partial wins, finals are never dropped.                                       |
| `src/lib/speech.js`          | Speech recognition wrapper (on-device first, word-by-word partials).                                        |
| `src/background.js`          | The real `Browser` adapter and message routing. Keep logic out of here.                                     |
| `src/sidepanel/sidepanel.js` | UI wiring only.                                                                                             |

Message protocol: the side panel sends `{ type: 'transcript', text, final, id }`; the service worker replies with `{ did, ms, early }`, `{ error }`, or `{}` (partial not ready).

## Rules

1. **Jev picks, it never writes.** URLs, selectors and typed text come from lists our code built: `SITES`, the page snapshot, transcript spans. Never add a question that expects Jev to produce free text.
2. **Injected functions are self-contained.** Anything in `src/lib/page.js` is serialised by Chrome on its own: no imports, no closures over module scope.
3. **Every browser effect goes through the adapter.** `handler.js` must not call `chrome.*`, so it stays testable with the fake browser in `test/handler.test.js`.
4. **Partial transcripts are speculative.** Free-text actions (`WAIT_FOR_FINAL`) never run early. One utterance id acts at most once. Errors from partials are not shown.
5. **Privacy is a feature.** The snapshot sends element labels only, never field values or page text. Keep it that way, and update `PRIVACY.md` if what is sent changes.
6. **Copy is plain and specific.** Outcomes read as past-tense sentences ("Clicked link: Pricing"). Errors say what happened and what to do.

## Testing

- `test/helpers.js` provides `fakeJev()`, `choice()`, `yesNo()`, `installDom()` and `response()`.
- When you change `ACTIONS`, question wording or `THRESHOLDS`, run `npm run eval` and keep it at 100%. Add an eval case for any new phrasing you expect to work, including partials that must wait.
- A 429 from TypeSafe is not a failure; the eval runner waits and retries.

## Releasing

1. Bump `version` in both `package.json` and `src/manifest.json` (a test enforces they match).
2. Add an entry to `CHANGELOG.md`.
3. `npm run check && npm run eval && npm run package`, then upload `dist/*.zip` to the Chrome Web Store and attach it to a GitHub release.
