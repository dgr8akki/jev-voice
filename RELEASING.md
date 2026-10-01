# Releasing

1. Bump `version` in `package.json` and `src/manifest.json` (a test checks they match) and add a CHANGELOG entry.
2. `npm run check`, then `npm run live` with a key in `.env`, then `npm run package`.
3. Upload `dist/jev-voice-<version>.zip` to the Chrome Web Store and attach it to a GitHub release titled `Jev Voice v<version>: <one line>`.

## The title lives in one file

The store title and summary are `appName` and `appDesc` in `src/_locales/en/messages.json` (and `en_GB`), not in the manifest. If TypeSafe objects to "Jev" in the title, set `appName` to `Voice Cue: browse by talking` (28 characters) and replace `appDesc` with this 128-character summary, since the limit is 132 and the old one has no room for the affiliation line:

`Browse by talking: open sites, search, click links and fill in forms by saying what you want. Built on Jev by TypeSafe. Not affiliated.`

Then update the two places that repeat the title in prose: the 1.2.1 entry in `CHANGELOG.md` and the Title section of `docs/store-listing.md`. The manifest test reads the title from the messages file, so it needs no change.

Listing text, permission justifications and the data-usage answers are in `docs/store-listing.md`.
