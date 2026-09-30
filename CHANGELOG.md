# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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

- Choose your Jev provider on a new settings page: TypeSafe directly (key from the TypeSafe console) or Vercel AI Gateway. Setup steps, key link and privacy line follow the choice.
- The settings page opens on install. A saved key is never shown again: it appears masked with Test, Replace and Remove.
- `npm run eval` uses `TYPESAFE_API_KEY` when set, otherwise `AI_GATEWAY_API_KEY`.

### Changed

- The side panel no longer has a key field; it shows "Connected via …" with **Change**, or **Connect Jev** until a key is saved.
- No new permissions: `<all_urls>` already covers `api.typesafe.ai`. Existing installs keep using Vercel until you switch.

## [1.0.0] - 2026-09-25

### Added

- Side panel with a microphone button, typed commands and an activity log.
- Voice commands to open sites (by name or spoken domain), search, click, type into fields, scroll, go back and forward, reload, and open, switch and close tabs.
- Form filling from natural phrasing ("surname Pahuja"), with "and press enter" to submit.
- Corrections that move the last typed text to another field.
- Word-by-word recognition that acts on unambiguous commands before you finish speaking.
- On-screen cursor that shows what is about to be clicked or typed into.
- On-device speech recognition on Chrome 139 and later.
- API key check on save; clear messages for rejected keys, exhausted budgets and rate limits.

[1.2.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.2.0
[1.1.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.1.0
[1.0.0]: https://github.com/dgr8akki/jev-voice/releases/tag/v1.0.0
