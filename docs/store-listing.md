# Chrome Web Store listing

Paste-in copy for each Developer Dashboard field. Character counts follow each limited field. The title and summary come from `src/_locales/en/messages.json`; change them there, not here, and rebuild.

## Store listing tab

### Title (45 max)

Jev Voice: browse by voice

(26 characters. If TypeSafe objects to "Jev" in the title, see RELEASING.md for the one-file swap.)

### Summary (132 max)

Control your browser by voice: open sites, search, click links and fill in forms by saying what you want.

(105 characters. Read from the manifest at upload time; the dashboard cannot edit it.)

### Detailed description (16,000 max, plain text)

```text
Say what you want the browser to do and it does it. Open a site, search, click a link, fill in a form.

Jev Voice adds a side panel with one microphone button. Press it and talk. Chrome turns your speech into text a word at a time, and short commands such as "go back" or "scroll down" run before you have finished the sentence; the panel underlines the words it acted on. Before it clicks or types, a marker appears next to the element it picked, so you can see what it understood.

Example commands
"Open wikipedia" or "go to rte dot ie" opens the site.
"Search for train times to Cork" runs a Google search.
"Click the first result" or "open the pricing link" clicks the matching link or button.
"Type hello in the email field and press enter" types into that field, then submits.
"Surname Pahuja" or "in first name put Akash" fills the named field.
"No, that's the first name" moves what it just typed to the right field.
"Scroll down", "go back", "reload", "new tab", "close this tab" work as you would expect.

When a command needs the page, Jev Voice reads the labels of the links, buttons and fields on screen (up to 100) and picks the one you meant. You can also type any command in the box under the microphone.

Works without a key
Scrolling, going back and forward, tabs, and opening a site by name ("open github") work the moment the extension is installed. Clicking, typing and searching need a Jev key, described below.

Who chooses what
Commands are interpreted by Jev, TypeSafe's decision model, and Jev does not write anything. The extension builds the lists: which action, which visible element, which known site, which run of your own words to type. Jev picks one item from each. It cannot invent a web address or a selector. When it is not confident, nothing happens and the panel says so.

Setting up a key
Clicking, typing and searching run on a Jev key that you supply, issued either by TypeSafe (console.typesafe.ai/keys) or by Vercel AI Gateway (vercel.com/docs/ai-gateway). Settings opens by itself after install: choose your provider, paste the key and press Connect. Jev Voice tests the key with one request before storing it and only ever shows it masked afterwards. Expect about 0.01 cents per command on your own bill; Vercel lets you cap the spend. Use Google Chrome. Brave has the speech API without a working service behind it, so there you can only type. On Chrome 139 and later, speech recognition can run on your device.

Accessibility
Jev Voice is built for use without a mouse or keyboard. Every control in the panel has a name and a visible focus ring, the activity list is a live region that reads each outcome once, outcomes are told apart by icon and shape as well as colour, the panel works at 320 pixels wide and 200 % zoom, and nothing moves when you have asked your system for reduced motion.

Data sent
Jev Voice has no server of its own. Each phrase sends three things to TypeSafe, either directly or relayed by Vercel AI Gateway if that is the provider you picked: the words, the current tab's full address and title, and the labels of the visible links, buttons and fields, such as "field: Email address". While you are still speaking, the same phrase may be sent several times, once per pause, so a command can run before you finish. What you have typed into fields, page text, cookies and history are never sent. Audio is never recorded; on Chrome 139 and later the speech model is downloaded once from Google. The key sits in chrome.storage.local and travels only to its own provider. Full policy: github.com/dgr8akki/jev-voice/blob/main/PRIVACY.md

What it can't do
It only sees what is on screen, and it cannot see inside other sites' frames or the Web Store, chrome:// pages and PDFs.
Clicks are synthetic, so a few sites that insist on a real mouse will ignore them.

Bugs and ideas: github.com/dgr8akki/jev-voice/issues
Open source, MIT licence: github.com/dgr8akki/jev-voice
```

(3,935 characters.)

### Category and language

Category: Accessibility. Language: English (United Kingdom), to match the British spelling of the text. Extra listing variants for en-US, en-AU and en-IN can reuse this text unchanged.

### Screenshots, promo tile, marquee

Five 1280x800 shots (with 640x400 copies), a 440x280 tile and a 1400x560 marquee are under `screenshots/jev-voice/store/` in the reports folder, retaken on 1 October 2026 against this release on a real page (the Wikipedia article on sourdough). They show the mic label, the "Opened github.com" outcome and the new icon. The README beside them has the caption for each.

### URLs

Official URL: leave empty (needs a Search Console verified site). Homepage URL: https://github.com/dgr8akki/jev-voice. Support URL: https://github.com/dgr8akki/jev-voice/issues.

## Privacy practices tab

### Single purpose

Jev Voice lets the user control the current browser tab by voice or by a typed command from a side panel: open a site, search, click a visible link or button, type into a visible field, scroll, move through history and manage tabs. Page-dependent commands are interpreted by the Jev model with the user's own API key; scroll, history, tab and open-site commands are decided in the extension itself. It does nothing until the user gives a command.

(446 characters.)

### Permission justifications

sidePanel (`src/manifest.json`, `src/background.js`)

Jev Voice's whole interface is a side panel (`sidepanel/sidepanel.html`) with the microphone button, a typed-command field and the activity list. Without the permission there is nowhere to show it: sidePanel lets the worker register that page and open it from the toolbar icon. There is no popup and no on-page interface beyond a marker shown for about a second around the element being clicked or typed into.

storage (`src/background.js`, `src/options/options.js`, `src/lib/connection.js`)

Keeps two values in chrome.storage.local: the user's API key for TypeSafe or Vercel AI Gateway, and which provider they chose. chrome.storage.session holds one timestamp, the end of a rate-limit pause, so a restarted worker does not repeat a refused request. The worker asks for the TRUSTED_CONTEXTS access level where Chrome supports it and carries on where it does not; the extension has no content scripts, and the functions it injects never touch storage. No browsing data, transcripts or page content are stored. Removing the extension deletes the values.

scripting (`src/background.js`, `src/lib/handler.js`, functions in `src/lib/page.js`)

Used with chrome.scripting.executeScript on the active tab, only in response to a user command, to run seven self-contained functions: snapshot() lists the labels of visible links, buttons and fields (attributes and label text only, never field values or editor content, capped at 100 elements; labels are cut to 60 characters before they leave the browser); moveCursor() shows a marker beside the target; clickElement() clicks it; typeInto() types the user's own dictated words into a field; clearLastTyped() moves text after a correction; scrollPage() scrolls; clearMarkers() removes the index attributes afterwards. There are no declared content scripts. No code touches a page before the user speaks or types a command.

Host permissions: `http://*/*` and `https://*/*` (`src/manifest.json`, `src/background.js`, `src/lib/jev.js`)

Needed for three things. First, executeScript must target whatever page the user is controlling; people navigate by voice to arbitrary sites, and after "go to wikipedia" the next command ("click the first result") runs on a page the extension itself navigated to, which activeTab would no longer cover. Second, the active tab's URL and title are read (chrome.tabs.query) as context for each command. Third, the service worker's POST requests go to one of two provider hosts, https://api.typesafe.ai or https://ai-gateway.vercel.sh. file:// and other schemes are not requested. No content is read from any page except the element labels described under scripting, and only when the user issues a command.

Remote code: No. Every script is loaded from the package itself. The code never calls eval or new Function and never imports a module from a URL, and no script tag points outside the extension. Responses from the model API are JSON probabilities, parsed as data and never executed. Inter is bundled as a local font file.

Neither content_scripts nor web_accessible_resources appears in the manifest.

Microphone: no manifest permission. The extension calls getUserMedia once from an extension tab (`src/permission/permission.js`) so Chrome shows its own prompt; audio goes to the browser's speech recogniser and nowhere else.

### Data usage

Tick: Personally identifiable information (dictated form text travels inside the transcript), Authentication information (the API key, stored locally; every model request presents it, as a bearer token, to the provider that owns it), Web history (the active tab's URL and title accompany each command), User activity (voice and typed commands), Website content (labels of visible links, buttons and fields).

Leave unticked: Health, Financial and payment, Personal communications, Location.

Certifications: all three are true. Data goes to TypeSafe or Vercel only to provide the single purpose; there is no analytics; nothing is used for creditworthiness or lending.

### Privacy policy URL

https://github.com/dgr8akki/jev-voice/blob/main/PRIVACY.md

## Distribution tab

Visibility: Unlisted at first; Public after that upload clears review. Regions: all. Pricing: free. Mature content: no.

## Release notes (GitHub release body; 300 max if reused in the description)

1.2.1: Scroll, tabs, history and "open <site>" now work without a key. Field labels only, never what you typed. Clear messages when offline, on rate limits, and on pages Chrome will not let extensions see. Screen-reader fixes throughout, and the panel fits 320 px at 200 % zoom.

(278 characters.)
