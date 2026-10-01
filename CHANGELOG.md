# Changelog

One section per release, the newest on top. Version numbers are semver. A release gets a Fixed heading only when it repaired something that had actually been broken; otherwise it lists additions and changes.

## [1.2.1] - 2026-09-30

### Added

- Scrolling, history, tabs and "open <site>" work before a key is connected. The panel says what a key adds; the first command that needs Jev asks for one.
- A "Working on …" card while a command runs, and a Show/Hide button on the key field.
- The store title and summary live in `_locales`, so a title change is a one-file swap.

### Changed

- Store title is now "Jev Voice: browse by voice", and the summary says "your browser" rather than naming Chrome.
- Host permissions narrowed from all URLs to `http://*/*` and `https://*/*`.
- "Opened github.com" instead of the full URL; when nothing matched, "Opened the top result for …".
- Partials wait 250 ms after the last word before being sent, and share one snapshot per phrase.
- The on-page highlight is drawn over the target instead of restyling it, and the index markers are removed once an action has run.
- The on-page marker is two colours now, the brand accent over a dark keyline, without the diagonal tick.
- New icon: a microphone on a round badge; the settings page mark uses the same glyph.
- Every page declares `color-scheme` in its head, so form controls never flash the wrong scheme before the stylesheet loads.

### Fixed

- The service worker died on Chrome 116 to 139 because `storage.local.setAccessLevel` throws there; the call is now guarded.
- Field values, password fields and editor text no longer appear in the labels sent to the provider; labels are cut to 60 characters and lose quotes and line breaks, and every candidate carries its position on the page.
- A 200 reply that did not answer the question no longer passes as "Key works."; a 429 during Connect saves the key but says the provider was busy.
- A request that never left the machine now reports "Can't reach <host>" rather than the browser's bare "Failed to fetch". The options page also stops flagging the key as invalid when that happens.
- `chrome://`, Web Store and PDF pages say Chrome does not let extensions see the page instead of "Couldn't find that"; an empty history says so instead of "Something went wrong".
- `recognition.start()` failures no longer leave the button on "Listening" with no audio; a failed restart retries once, then stops with a message.
- Screen readers: the transcript is announced once per phrase rather than on every word; the mic button is never `aria-disabled`; Settings is a real heading; the panel has a `main` landmark; focus stays on the page after Connect and Cancel.
- The panel and settings page no longer scroll sideways at 320 px and 200 % zoom.
- "open readme.md" no longer navigates to `https://readme.md`.

## [1.2.0] - 2026-09-28

### Changed

- Redesigned the side panel, settings and microphone pages, with light and dark themes and bundled Inter.
- The microphone is a large button with clear idle, listening, unavailable and blocked states, and a level meter while listening.
- What you say streams in word by word. When a command runs before you finish, the words that triggered it are underlined.
- The newest activity entry is a last-action card. Successes, misses ("Couldn't find that on the page") and errors differ by icon and shape as well as colour. Commands that ran early are tagged "before you finished".
- In browsers without speech recognition, the typed command field becomes the main control.
- "What can I say?" is grouped by verb and stays open until your first command.
- The on-page marker is now a ring, so it can't be mistaken for your real pointer. It lands beside the target instead of on its label, shows a caret when typing, and reads on light, dark and busy pages.
- New extension icon.

## [1.1.0] - 2026-09-27

### Added

- A settings page for the key, with a choice between calling TypeSafe directly and going through Vercel AI Gateway. The steps, key link and privacy line change with the provider you pick.
- The page opens on install. A saved key appears only in masked form beside Test, Replace and Remove buttons, and is never written back into the input.
- `npm run live` takes `TYPESAFE_API_KEY` when it is set and uses `AI_GATEWAY_API_KEY` otherwise.

### Changed

- The key field left the side panel; its place is a one-line "Connected via …" status with a Change button, replaced by a Connect Jev prompt while no key is stored.
- Existing installs keep using Vercel until you switch. Calling TypeSafe directly needed no new permission.

### Fixed

- TypeSafe answers yes/no questions as `noul`, not `boolean`; the client translates both ways so the same questions work with either provider.
- Brave ships the speech recognition API without a service behind it, so `available()` never settles; the listener now gives up after three seconds and reports Brave as unsupported, and typing takes over as the main control.
- Links with `target="_blank"` were swallowed by the pop-up blocker when clicked from a script; the extension now opens the address in a new tab itself.

## [1.0.0] - 2026-09-25

### Added

- Side panel with a microphone button, typed commands and an activity log.
- Voice commands to open sites (by name or spoken domain), search, click, type into fields, scroll, go back and forward, reload, and open, switch and close tabs.
- Form filling from natural phrasing ("surname Pahuja"), with "and press enter" to submit.
- Corrections that move the last typed text to another field.
- Word-by-word recognition that acts on unambiguous commands before you finish speaking.
- On-screen cursor that shows what is about to be clicked or typed into.
- Speech is recognised locally when Chrome is version 139 or newer.
- Saving a key first sends a test request. A refused key, a spent budget and a rate limit each produce their own message.

[1.2.1]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.2.1
[1.2.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.2.0
[1.1.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.1.0
[1.0.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.0.0
